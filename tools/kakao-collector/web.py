"""Loopback-only browser controls for the local Kakao collector."""

import argparse
import hashlib
import html
import os
import re
import plistlib
import subprocess
import tempfile
import sqlite3
import secrets
import threading
import webbrowser
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

from vpn_remote import serve_private, same_owner_peer
from ax_source import list_rooms, native, probe, unique_room
from collector import DEFAULT_ROOT, Store, decode, encode, now
from drive_store import deliver, drive_ready
from portal import APP_URL
from kakao import REASONS, STATES, agent, batches, batch_number, kst, locked, run_collection

PAGE = """<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>카카오톡 업무 수집</title>
<style>
:root{font:15px/1.55 -apple-system,BlinkMacSystemFont,sans-serif;color:#20251f;background:#f1f3ed}
*{box-sizing:border-box}body{margin:0}main{max-width:1080px;margin:auto;padding:46px 24px 60px}
header{display:flex;justify-content:space-between;align-items:end;border-bottom:2px solid #253925;margin-bottom:24px}
h1{font-size:30px;line-height:1.2;margin:0 0 13px}h2{font-size:19px;margin:0 0 14px}
h3{font-size:16px;margin:8px 0}a{color:#345b37;text-underline-offset:3px}
section{background:#fff;padding:22px;margin:16px 0;border:1px solid #d6ddd2;border-radius:10px}
form{margin:4px 0}form.inline{display:inline-block;margin-right:6px}
button,input{font:inherit}button{background:#e8efe3;color:#233923;border:1px solid #c8d5c5;
border-radius:6px;padding:7px 12px;cursor:pointer}button.primary{background:#2e5132;color:#fff}
input:not([type=checkbox]){border:1px solid #aebdad;border-radius:6px;padding:7px;max-width:100%}
small,.muted{color:#536453}table{width:100%;border-collapse:collapse;text-align:left}
td,th{padding:9px 8px;border-bottom:1px solid #e3e9e2;vertical-align:top}th{font-size:13px;color:#465747}
.notice{padding:10px 14px;background:#fcf4dd;border:1px solid #efe0b5;border-radius:6px}
.rooms{min-width:0;border:0;margin:12px 0;padding:0}.rooms label{display:flex;align-items:center;gap:10px;
padding:8px 4px;border-bottom:1px solid #e3e9e2;cursor:pointer;overflow-wrap:anywhere}.rooms input{width:18px;height:18px;flex:none;accent-color:#2e5132}
.rooms label:focus-within{outline:2px solid #2e5132}.savebar{position:sticky;bottom:0;background:#fff;padding:10px 0;border-top:1px solid #c8d5c5}
.meta{font-size:13px;color:#546553}.message{border-left:2px solid #c9dcc7;margin:12px 0;padding-left:12px}
.message p{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}.message img{max-width:100%;max-height:400px}
nav{display:flex;gap:14px;margin-bottom:14px}@media(max-width:620px){main{padding:20px 12px}section{padding:12px}td,th{padding:6px 3px}}
</style><main><header><h1>카카오톡 업무 수집</h1><nav><a href="/rooms">수집할 방 선택</a><a href="/">수집 현황</a></nav></header>
"""


def esc(value):
    return html.escape(str(value or ""), quote=True)


def issue(code):
    return esc(REASONS.get(code, code))


class Dashboard(ThreadingHTTPServer):
    def __init__(self, port, root):
        super().__init__(("127.0.0.1", port), Handler)
        self.root = root
        self.token = secrets.token_urlsafe(32)
        self.task_lock = threading.Lock()
        self.note = ""
        self.available = None
        self.vpn_status = ""
        self.vpn_url = ""
        self.vpn_last_visit = None

    def background(self, actions, lock_name):
        while True:
            try:
                with Store(self.root) as store, locked(store, lock_name):
                    actions(store)
                    if store.setting(lock_name + "_error"):
                        store.configure(lock_name + "_error", None)
            except (sqlite3.Error, OSError, ValueError, RuntimeError) as error:
                if str(error) != "수집기 작업이 진행 중입니다":
                    with Store(self.root) as store:
                        store.configure(lock_name + "_error", type(error).__name__)
            threading.Event().wait(15)

    def workers(self):
        collect = lambda store: run_collection(store, SimpleNamespace(command="tick"))
        for action, lock_name in ((collect, "collector"), (deliver, "drive")):
            threading.Thread(target=self.background, args=(action, lock_name), daemon=True).start()

    @property
    def host(self):
        return f"127.0.0.1:{self.server_port}"

    def act(self, action, data):
        def run():
            try:
                with Store(self.root) as store:
                    self.run_action(store, action, data)
                self.note = "완료 · 아래에 최신 결과를 표시합니다."
            except Exception as error:
                # Display recognized diagnostics and never print credentials or message bodies.
                code = str(error)
                self.note = REASONS.get(code, code) if re.fullmatch(r"[\w .·-]{1,100}", code) else type(error).__name__
            finally:
                self.task_lock.release()

        if self.task_lock.acquire(blocking=False):
            self.note = "처리 중 · 잠시 뒤 새로고침해 주세요."
            threading.Thread(target=run, daemon=True).start()

    def run_action(self, store, action, data):
        def value(key, default=""):
            return data.get(key, [default])[0]

        if action in ("start", "pause"):
            store.configure("paused", action == "pause")
        elif action == "interval":
            seconds = int(value("seconds"))
            if not 15 <= seconds <= 3600:
                raise ValueError("수집 주기는 15~3600초입니다")
            store.configure("interval", seconds)
        elif action in ("agent-install", "agent-remove"):
            agent(store, action == "agent-install")
        else:
            lock_name = "portal" if action in {"login", "portal-mode", "portal-stop", "portal-retry"} else "collector"
            with locked(store, lock_name):
                if action == "rooms":
                    self.available = list_rooms(native(store))
                elif action == "select":
                    items, _ = list_rooms(native(store))
                    selected = [unique_room(items, name) for name in data.get("room", [])]
                    for room in selected:
                        store.add_room(room["name"], bool(room["isSelf"]), value("since") or None)
                    if selected:
                        store.configure("paused", False)
                elif action == "probe":
                    store.configure("ax_probe", probe(store))
                elif action == "deselect":
                    with store.db:
                        store.db.execute("UPDATE rooms SET enabled=0 WHERE id=?", (int(value("room")),))
                elif action in ("collect", "history"):
                    number = int(value("room")) if action == "history" else None
                    pages = int(value("pages", "1")) if action == "history" else 0
                    if not 0 <= pages <= 10:
                        raise ValueError("이전 대화 요청은 최대 10회입니다")
                    run_collection(store, SimpleNamespace(command="collect", room=number, history_pages=pages, quiet=True))
                elif action == "resume-room":
                    with store.db:
                        store.db.execute("UPDATE rooms SET sticky_gap=0,issue='baseline_restarted' WHERE id=? AND head IS NOT NULL", (int(value("room")),))
                else:
                    raise ValueError("unknown_action")

def selection_version(items, enabled):
    keys = [(r["name"], bool(r["isSelf"])) for r in items]
    return hashlib.sha256(encode([keys, sorted(enabled)]).encode()).hexdigest()


def enabled_names(store):
    return {r[0] for r in store.db.execute("SELECT name FROM rooms WHERE enabled=1")}


class Handler(BaseHTTPRequestHandler):
    @property
    def expected_host(self):
        return self.server.host

    def log_message(self, *_):
        pass

    def authorized(self):
        return any(part.strip() == f"ean_local={self.server.token}" for part in self.headers.get("Cookie", "").split(";"))

    def reply(self, status, body=b"", mime="text/html; charset=utf-8", **headers):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
        for key, value in headers.items():
            self.send_header(key.replace("_", "-"), value)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        if self.headers.get_all("Host") != [self.expected_host]:
            self.reply(403)
            return
        request = urlsplit(self.path)
        match = re.fullmatch(r"/(batch|photo|room)/(\d{1,12})", request.path)
        if request.path == "/connect" and parse_qs(request.query).get("key") == [self.server.token]:
            landing = "/rooms" if parse_qs(request.query).get("view") == ["rooms"] else "/"
            self.reply(303, Location=landing, Set_Cookie=f"ean_local={self.server.token}; Path=/; HttpOnly; SameSite=Strict")
            return
        if not self.authorized():
            self.reply(403, "수집기를 실행해 발급받은 주소를 사용하세요.".encode())
            return
        with Store(self.server.root) as store:
            if match and match[1] == "photo":
                row = store.db.execute("SELECT bytes FROM captures WHERE message=?", (int(match[2]),)).fetchone()
                self.reply(200, row[0], "image/png") if row and row[0] else self.reply(404)
                return
            if match:
                try:
                    content = (self.detail if match[1] == "batch" else self.room_detail)(store, int(match[2]))
                except ValueError:
                    self.reply(404)
                    return
            elif request.path == "/rooms":
                notice = ""
                if self.server.available is None:
                    try:
                        with locked(store, wait=True):
                            if self.server.available is None:
                                self.server.available = list_rooms(native(store))
                    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
                        notice = REASONS.get(str(error), "카카오톡 방 목록을 읽지 못했습니다.")
                if parse_qs(request.query).get("saved") == ["1"]:
                    notice = "수집할 방을 저장했습니다."
                content = self.room_picker(store, notice)
            elif request.path == "/":
                content = self.index(store)
            else:
                self.reply(404)
                return
        self.reply(200, (PAGE + content + "</main>").encode())

    def do_POST(self):
        if (self.headers.get_all("Host") != [self.expected_host] or not self.authorized()
                or self.headers.get_all("Origin") != [f"http://{self.expected_host}"]):
            self.reply(403)
            return
        actions = {"start", "pause", "interval", "agent-install", "agent-remove", "rooms",
                   "select", "deselect", "collect", "history", "resume-room", "probe", "save-rooms", "refresh-rooms"}
        action = self.path.removeprefix("/action/")
        if action not in actions:
            self.reply(404)
            return
        length = self.headers.get("Content-Length", "")
        if not length.isdecimal() or int(length) > 16384:
            self.reply(413)
            return
        try:
            data = parse_qs(self.rfile.read(int(length)).decode(), max_num_fields=1100 if action == "save-rooms" else 200)
        except ValueError:
            self.reply(400)
            return
        if action == "portal-mode" and data.get("confirm") != ["yes"]:
            self.reply(400)
            return
        if action in {"save-rooms", "refresh-rooms"}:
            with Store(self.server.root) as store:
                try:
                    with locked(store, wait=True):
                        if action == "refresh-rooms":
                            self.server.available = list_rooms(native(store))
                        else:
                            self.save_rooms(store, data)
                except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
                    message = REASONS.get(str(error), str(error))
                    self.reply(409, (PAGE + self.room_picker(store, message) + "</main>").encode())
                    return
            self.reply(303, Location="/rooms?saved=1" if action == "save-rooms" else "/rooms")
            return
        self.server.act(action, data)
        number = data.get("number", [""])[0]
        self.reply(303, Location=f"/batch/{number}" if number.isdecimal() else "/")

    @staticmethod
    def button(action, label, fields="", primary=False, inline=True):
        css = "inline" if inline else ""
        color = "primary" if primary else ""
        return (f'<form class="{css}" method="post" action="/action/{action}">{fields}'
                f'<button class="{color}">{esc(label)}</button></form>')

    def index(self, store):
        state = "일시정지" if store.setting("paused", True) else "사용 중"
        seconds = store.setting("interval", 60)
        text = f'<section><h2>정기 수집 <small>{state}</small></h2>'
        if self.server.note:
            text += f'<p class="notice">{esc(self.server.note)}</p>'
        if self.server.vpn_status:
            text += f'<p>원격 접속 · {esc(self.server.vpn_status)}'
            if self.server.vpn_url:
                text += f' · <a href="{esc(self.server.vpn_url)}">{esc(self.server.vpn_url)}</a>'
            if self.server.vpn_last_visit:
                text += f' · 마지막 원격 접속 {kst(self.server.vpn_last_visit)}'
            text += '</p>'
        text += self.button("start", "시작") + self.button("pause", "일시정지")
        text += self.button("interval", "주기 변경", f'<label>초 <input name="seconds" type="number" min="15" max="3600" value="{seconds}"> </label>')
        last = store.db.execute("SELECT MAX(collected) FROM messages WHERE state='new'").fetchone()[0]
        text += f'<p>마지막 새 대화 수집 {kst(last)}</p></section><section><h2>OneDrive · 카톡수집</h2>'
        waiting, sent = store.db.execute("SELECT count(*) FILTER(WHERE sent<revision),count(*) FILTER(WHERE sent=revision) FROM drive_outbox").fetchone()
        photos = store.db.execute("SELECT count(*) FROM originals WHERE path IS NULL").fetchone()[0]
        connection = "계정 연결됨" if drive_ready(store.root) else "계정 연결 대기"
        text += f'<p>{connection} · 업로드 대기 {waiting}개 · OneDrive 전송 성공 {sent}개 · 사진 확보 대기 {photos}개</p>'
        for worker in ("collector", "drive"):
            if store.setting(worker + "_error"):
                text += f'<p>{esc(worker)} · {esc(store.setting(worker + "_error"))}</p>'
        for row in store.db.execute("SELECT error,count(*) FROM originals WHERE path IS NULL GROUP BY error UNION ALL SELECT error,count(*) FROM drive_outbox WHERE error IS NOT NULL GROUP BY error"):
            text += f'<p>{issue(row[0])} · {row[1]}건</p>'
        text += '</section><section><h2>수집 대상</h2>'
        text += '<p><a href="/rooms">방 목록에서 선택하기</a></p>'
        rooms = list(store.db.execute("SELECT * FROM rooms WHERE enabled=1 ORDER BY id"))
        if rooms:
            text += '<table><tr><th>채팅방</th><th>시작 범위</th><th>마지막 정상 수집</th><th>상태</th><th></th></tr>'
            for room in rooms:
                button = self.button("deselect", "제외", f'<input type="hidden" name="room" value="{room["id"]}">')
                status = issue(room["issue"]) or "현재 AX 노출 범위"
                if room["sticky_gap"] and room["issue"] != "overlap_unverified":
                    status += " · 이전 누락 가능"
                text += (f'<tr><td><a href="/room/{room["id"]}">{esc(room["name"])}</a></td><td>{kst(room["cutoff"])}</td>'
                         f'<td>{kst(room["last_ok"])}</td><td>{status}</td><td>{button}</td></tr>')
            text += "</table>"
        return text + "</section>"

    def room_picker(self, store, notice=""):
        active = enabled_names(store)
        text = '<section><h2>수집할 방 선택</h2>'
        if notice:
            text += f'<p class="notice" role="status">{esc(notice)}</p>'
        text += self.button("refresh-rooms", "방 목록 새로 읽기")
        if self.server.available is None:
            return text + "</section>"
        rooms, total = self.server.available
        counts = Counter(r["name"] for r in rooms)
        version = selection_version(rooms, active)
        text += (f'<p>표시된 방 {len(rooms)}개 · 현재 수집 대상 {len(active)}개</p>'
                 '<form method="post" action="/action/save-rooms">'
                 f'<input type="hidden" name="version" value="{version}">'
                 '<fieldset class="rooms"><legend>자동으로 수집할 방에 체크하세요.</legend>')
        for n, r in enumerate(rooms):
            name = r["name"]
            disabled = counts[name] != 1
            detail = " (동명 방 · 선택 변경 불가)" if disabled else ""
            text += (f'<label><input type="checkbox" name="choice" value="{n}"'
                     f'{" checked" if name in active else ""}{" disabled" if disabled else ""}>'
                     f'<span>{esc(name)}{detail}</span></label>')
        text += "</fieldset>"
        if len(rooms) < total:
            text += f'<p>카카오톡이 보고한 {total}행 중 {len(rooms)}개 방 이름을 읽었습니다.</p>'
        missing = sorted(active - counts.keys())
        if missing:
            text += '<p>목록 밖에서 계속 수집 중인 방 · ' + ", ".join(map(esc, missing)) + '</p>'
        return text + '<div class="savebar"><button class="primary">선택 저장</button></div></form></section>'

    def save_rooms(self, store, data):
        if self.server.available is None:
            raise ValueError("방 목록을 다시 읽어 주세요.")
        rooms, _ = self.server.available
        counts = Counter(r["name"] for r in rooms)
        editable = {str(i): r for i,r in enumerate(rooms) if counts[r["name"]] == 1}
        choices = set(data.get("choice", []))
        if not choices <= editable.keys():
            raise ValueError("방 목록이 바뀌었습니다. 다시 선택해 주세요.")
        with store.db:
            store.db.execute("BEGIN IMMEDIATE")
            active = enabled_names(store)
            if data.get("version") != [selection_version(rooms, active)]:
                raise ValueError("선택 상태가 바뀌었습니다. 현재 목록을 확인해 주세요.")
            added = False
            for key, room in editable.items():
                name = room["name"]
                if key in choices and name not in active:
                    store.enable_room(name, bool(room["isSelf"]), now())
                    added = True
                elif key not in choices and name in active:
                    store.db.execute("UPDATE rooms SET enabled=0 WHERE name=?", (name,))
            if added:
                store.configure("paused", False)

    def room_detail(self, store, number):
        room = store.db.execute("SELECT * FROM rooms WHERE id=?", (number,)).fetchone()
        if room is None:
            raise ValueError("room_not_found")
        text = f'<section><h2>{esc(room["name"])}</h2><p>{issue(room["issue"])}</p>'
        head = store.db.execute("SELECT * FROM observations WHERE id=?", (room["head"],)).fetchone()
        if head:
            rows = decode(head["rows_json"])
            ids = decode(head["message_ids"])
            text += f'<p class="meta">마지막 AX 관찰 {kst(head["collected"])} · {len(rows)}행 · 과거 전체 범위 미확인</p>'
            for row, identifier in list(zip(rows, ids))[-100:]:
                text += f'<div class="message"><div class="meta">{esc(row.get("sender") or "작성자 미확인")} · {esc(row.get("dateText"))} {esc(row.get("timeText"))}</div>'
                if row["kind"] == "attachment":
                    for photo in store.db.execute("SELECT path,error FROM originals WHERE message=? ORDER BY ordinal", (identifier,)):
                        text += f'<p>{esc(photo["path"] or "사진 확보 대기")} {issue(photo["error"])}</p>'
                else:
                    text += f'<p>{esc(row.get("text") or "AX 본문 미확인")}</p>'
                text += "</div>"
        return text + "</section>"

    def detail(self, store, number):
        batch = batch_number(store, number)
        fresh = set(decode(batch["fresh"]))
        text = f'<section><h2>{esc(batch["name"])}</h2><p>{esc(STATES[batch["state"]])} {issue(batch["error"])}</p>'
        if self.server.note:
            text += f'<p class="notice">{esc(self.server.note)}</p>'
        for item in store.context(batch):
            row = decode(item["row_json"])
            sender = esc(row.get("sender") or "작성자 미확인")
            time = kst(item["occurred"]) if item["occurred"] else "작성 시각 미확인"
            scope = "새 대화" if item["id"] in fresh else "문맥"
            text += f'<div class="message"><div class="meta">{scope} · {sender} · {time}</div>'
            if row["kind"] == "attachment":
                text += f'<img src="/photo/{item["id"]}" alt="카카오톡 창 사진 영역 캡처">' if item["sha256"] else f'<p>사진 · {issue(item["photo_error"]) or "캡처 대기"}</p>'
            else:
                text += f'<p>{esc(row.get("text") or "AX 본문 미확인")}</p>'
            text += "</div>"
        text += f'</section><section><h2>업무포탈 판단</h2><a href="{APP_URL}">업무포탈 업무 보기</a>'
        if batch["result"] and batch["state"] in ("portal_wait", "portal_ready"):
            parts = decode(batch["result"])
            if any(part.get("status") == "failed" and not part.get("retryScheduled") for part in parts):
                text += self.button("portal-retry", "같은 접수 다시 분석",
                                    f'<input type="hidden" name="number" value="{number}">')
            for part in parts:
                text += f'<p>접수 {esc(part.get("status"))} · 사진 {len(part.get("images") or [])}장</p>'
                for item in part.get("items", []):
                    decision = item.get("kakao") or {}
                    judgment = decision.get("intent") or {}
                    label = {"new":"새 업무", "update":"업무 갱신", "confirmation":"확인 필요"}.get(decision.get("route"), "")
                    text += f'<h3>{esc(item.get("text"))}</h3><p>{label} · JEV {esc(judgment.get("status"))}</p>'
                    text += f'<p>{esc(item.get("evidence"))}</p>'
        return text + "</section>"


class VPNHandler(Handler):
    def __init__(self, request, address, dashboard, owner):
        self.owner = owner
        super().__init__(request, address, dashboard)

    @property
    def expected_host(self):
        ip, port = self.connection.getsockname()[:2]
        return f"{ip}:{port}"

    def authorized(self):
        return same_owner_peer(self.client_address, self.owner)

    def reply(self, status, *args, **kwargs):
        super().reply(status, *args, **kwargs)
        if status in (200, 303) and self.client_address[0] != self.connection.getsockname()[0]:
            self.server.vpn_last_visit = now()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path not in {"/", "/rooms"} and not re.fullmatch(r"/(room|batch|photo)/[0-9]{1,12}", path):
            self.reply(404)
            return
        super().do_GET()

    def do_POST(self):
        if self.path not in {"/action/" + action for action in (
                "start", "pause", "interval", "refresh-rooms", "save-rooms", "collect", "deselect")}:
            self.reply(404)
            return
        super().do_POST()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    with Dashboard(args.port, args.data) as server:
        url = f"http://{server.host}/connect?key={server.token}"
        print(url, flush=True)
        args.data.mkdir(mode=0o700, parents=True, exist_ok=True)
        connection_file = args.data / "dashboard-url"
        with connection_file.open("w") as target:
            target.write(url)
        os.chmod(connection_file, 0o600)
        with Store(server.root) as store:
            app = store.setting("collector_app")
            if app and Path(app).is_dir():
                for name, address in (("수집 화면 열기", url), ("수집할 방 선택", url + "&view=rooms")):
                    shortcut = Path(app).parent / (name + ".webloc")
                    with tempfile.NamedTemporaryFile(dir=shortcut.parent, delete=False) as temp:
                        temp.write(plistlib.dumps({"URL": address}))
                    os.replace(temp.name, shortcut)
        # The system assertion applies on AC power and expires with the app.
        subprocess.Popen(["/usr/bin/caffeinate", "-s", "-w", str(os.getpid())],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        server.workers()
        with Store(server.root) as store:
            if store.setting("private_vpn_enabled", False):
                threading.Thread(target=serve_private, args=(server, VPNHandler), daemon=True).start()
        if args.open and not os.environ.get("KAKAO_COLLECTOR_BACKGROUND"):
            threading.Thread(target=webbrowser.open, args=(url,), daemon=True).start()
        server.serve_forever()


if __name__ == "__main__":
    main()
