"""Existing 업무포탈 private-mail endpoint and persistent per-part receipts."""

import base64
import json
import os
import re
import struct
import tempfile
import uuid
from datetime import datetime
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from collector import SEOUL, decode, encode

APP_URL = "https://sajoansan.vercel.app/portal/?view=briefing"
SERVICE = "https://vvrppotrnpwrwpwqaiet.supabase.co"


class PortalError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class Portal:
    def __init__(self, root):
        self.file = root / "portal-session.json"
        self.key = (root / "portal-public-key").read_text().strip() if (root / "portal-public-key").exists() else ""
        self.session = None

    def request(self, path, payload, token=None):
        if not self.key:
            raise PortalError("PORTAL_PUBLIC_KEY_REQUIRED")
        request = Request(SERVICE + path, data=encode(payload).encode(), headers={
            "apikey": self.key, "Authorization": "Bearer " + (token or self.key),
            "Content-Type": "application/json", "Accept": "application/json",
        })
        try:
            with build_opener(NoRedirect()).open(request, timeout=70) as response:
                result = json.load(response)
        except HTTPError as error:
            with error:
                try:
                    code = json.loads(error.read(4096)).get("error")
                except (ValueError, AttributeError):
                    code = None
            if error.code == 401:
                raise PortalError("PORTAL_RELOGIN") from None
            suffix = "_" + code if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,64}", code) else ""
            raise PortalError(f"HTTP_{error.code}{suffix}") from None
        if not isinstance(result, dict):
            raise PortalError("PORTAL_INVALID_RESPONSE")
        return result

    def save_session(self, session):
        actor = str(uuid.UUID(session["user"]["id"]))
        self.session = {
            "actor": actor, "access_token": session["access_token"], "refresh_token": session["refresh_token"],
            "expires_at": datetime.now().timestamp() + int(session.get("expires_in", 3600)),
        }
        with tempfile.NamedTemporaryFile(mode="w", dir=self.file.parent, delete=False) as output:
            output.write(encode(self.session))
        os.replace(output.name, self.file)
        return actor

    def login(self, identifier, password):
        if "@" in identifier:
            value = self.request("/auth/v1/token?grant_type=password", {"email": identifier, "password": password})
        else:
            value = self.request("/functions/v1/username-auth", {
                "action": "login", "username": identifier.strip().lower(), "password": password,
            })["session"]
        return self.save_session(value)

    def action(self, action, payload):
        if self.session is None:
            if not self.file.is_file():
                raise PortalError("PORTAL_RELOGIN")
            self.session = decode(self.file.read_text())
        if self.session["expires_at"] < datetime.now().timestamp() + 90:
            actor = self.session["actor"]
            value = self.request("/auth/v1/token?grant_type=refresh_token",
                                 {"refresh_token": self.session["refresh_token"]})
            if str(uuid.UUID(value["user"]["id"])) != actor:
                raise PortalError("PORTAL_ACCOUNT_CHANGED")
            self.save_session(value)
        return self.request("/functions/v1/onedrive-auth/private-mail-manual-" + action,
                            payload, self.session["access_token"])

    def capability(self):
        try:
            result = self.action("kakao-capability", {})
        except PortalError as error:
            if str(error).startswith(("HTTP_400", "HTTP_404")):
                raise PortalError("PORTAL_KAKAO_DEPLOY_REQUIRED") from None
            raise
        if result.get("version") != 1:
            raise PortalError("PORTAL_KAKAO_DEPLOY_REQUIRED")


def utf16(text):
    return len(text.encode("utf-16-le")) // 2


def chunks(rows, room, aliases, mode, split_photos):
    groups = []
    group = []
    for row in rows:
        if group and (len(group) >= 12 or split_photos(group + [row])):
            groups.append(group)
            group = []
        group.append(row)
    if group:
        groups.append(group)
    for group in groups:
        day, lines = None, []
        dates = {datetime.fromisoformat(row["occurred"]).astimezone(SEOUL).date().isoformat()
                 if row["occurred"] else None for row in group if row["fresh"]}
        if len(dates) == 1 and None not in dates:
            day = dates.pop()
        meta = {"room": room, "mode": mode, "aliases": aliases, "dateVerified": bool(day)}
        header = "[kakao-collector:v1] " + encode(meta)
        for row in group:
            scope = "새 자료" if row["fresh"] else "문맥 전용"
            lines.append(f"[{scope} · {row['sender']} · {row['occurred'] or '작성 시각 미확인'}]\n{row['text']}")
        text = header + "\n" + "\n\n".join(lines)
        if utf16(text) > 12000 and len(group) > 1:
            pivot = len(group) // 2
            yield from chunks(group[:pivot], room, aliases, mode, split_photos)
            yield from chunks(group[pivot:], room, aliases, mode, split_photos)
        elif utf16(text) > 12000 or split_photos(group):
            raise PortalError("PORTAL_SOURCE_LIMIT")
        elif any(row["fresh"] for row in group):
            yield day, text, [row for row in group if row.get("image")]


def image_limits(rows):
    images = [row["image"] for row in rows if row.get("image")]
    if len(images) > 3 or sum(map(len, images)) > 8000000:
        return True
    total = 0
    for image in images:
        if len(image) > 6000000 or len(image) < 24 or image[:8] != b"\x89PNG\r\n\x1a\n":
            return True
        width, height = struct.unpack(">II", image[16:24])
        pixels = width * height
        if max(width, height) > 8000 or pixels > 13000000 or not pixels:
            return True
        total += pixels
    return total > 16000000


def prepare(store, batch, actor, mode, aliases):
    if store.db.execute("SELECT 1 FROM portal_parts WHERE batch=?", (batch["id"],)).fetchone():
        return
    fresh = set(decode(batch["fresh"]))
    rows = []
    for message in store.context(batch):
        raw = decode(message["row_json"])
        image = None
        if raw["kind"] == "attachment":
            record = store.db.execute("SELECT bytes FROM captures WHERE message=?", (message["id"],)).fetchone()
            image = record[0] if record else None
            if not image and message["id"] in fresh:
                raise PortalError("PORTAL_PHOTO_PENDING")
            if message["id"] not in fresh:
                image = None
        rows.append({"id": message["id"], "fresh": message["id"] in fresh, "image": image,
                     "text": raw.get("text") or ("[카카오톡 창 영역 사진 캡처]" if image else "[AX 본문 미확인]"),
                     "sender": raw.get("sender") or "작성자 미확인", "occurred": message["occurred"]})
    room = store.db.execute("SELECT name FROM rooms WHERE id=?", (batch["room"],)).fetchone()[0]
    parts = list(chunks(rows, room[:150], aliases, mode, image_limits))
    with store.db:
        for number, (day, text, images) in enumerate(parts):
            request = str(uuid.uuid5(uuid.UUID(batch["id"]), f"kakao-portal-v1/{number}"))
            store.db.execute("INSERT INTO portal_parts(batch,number,request,actor,payload) VALUES (?,?,?,?,?)",
                             (batch["id"], number, request, actor, encode({
                                 "clientRequestId": request, "referenceDate": day, "text": text,
                                 "images": [r["id"] for r in images],
                             })))
        store.db.execute("UPDATE batches SET state='portal_wait',error=NULL WHERE id=?", (batch["id"],))


def sync(store, portal):
    if not store.setting("portal_enabled", False):
        return
    actor = store.setting("portal_actor")
    if not actor:
        raise PortalError("PORTAL_RELOGIN")
    batches = store.db.execute("""SELECT * FROM batches
        WHERE state IN ('queued','photo_review','portal_wait')
        AND (state='portal_wait' OR error IS NULL OR error='PORTAL_PHOTO_PENDING')
        AND coalesce(error,'') NOT LIKE 'HTTP_4%'
        ORDER BY created LIMIT 10""").fetchall()
    if not batches:
        return
    portal.capability()
    if portal.session["actor"] != actor:
        raise PortalError("PORTAL_ACCOUNT_CHANGED")
    for batch in batches:
        try:
            prepare(store, batch, actor, store.setting("portal_mode", "preview"), store.setting("portal_aliases", []))
        except PortalError as error:
            with store.db:
                store.db.execute("UPDATE batches SET error=? WHERE id=?", (str(error), batch["id"]))
            continue
        parts = store.db.execute("SELECT * FROM portal_parts WHERE batch=? ORDER BY number", (batch["id"],)).fetchall()
        statuses = []
        for part in parts:
            if part["actor"] != actor:
                raise PortalError("PORTAL_ACCOUNT_CHANGED")
            if part["entry"] and part["state"] == "ready":
                statuses.append(decode(part["result"]))
                continue
            if part["entry"]:
                result = portal.action("status", {"entryId": part["entry"]})["entry"]
            else:
                payload = decode(part["payload"])
                image_ids = payload.pop("images")
                if image_ids:
                    payload["images"] = [
                        {"name": f"kakao-capture-{identifier}.png", "data": base64.b64encode(store.db.execute(
                            "SELECT bytes FROM captures WHERE message=?", (identifier,)
                        ).fetchone()[0]).decode("ascii")}
                        for identifier in image_ids
                    ]
                    payload["privacyConfirmed"] = True
                try:
                    result = portal.action("enqueue", payload)
                except PortalError as error:
                    if str(error).startswith(("HTTP_400", "HTTP_409", "HTTP_413", "HTTP_422")):
                        with store.db:
                            store.db.execute("UPDATE batches SET error=? WHERE id=?", (str(error), batch["id"]))
                        break
                    raise
            entry = str(uuid.UUID(result["entryId"]))
            with store.db:
                store.db.execute("UPDATE portal_parts SET entry=?,state=?,result=? WHERE request=?",
                                 (entry, result["status"], encode(result), part["request"]))
            statuses.append(result)
        if len(statuses) == len(parts) and statuses:
            ready = all(s["status"] == "ready" for s in statuses)
            state = "portal_ready" if ready else "portal_wait"
            with store.db:
                store.db.execute("UPDATE batches SET state=?,result=?,error=? WHERE id=?",
                                 (state, encode(statuses), next((s.get("error") for s in statuses if s.get("error")), None),
                                  batch["id"]))
