"""Loopback-only browser controls for the local Kakao collector."""

import argparse
import html
import os
import re
import secrets
import threading
import webbrowser
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

from ax_source import list_rooms, native, probe_capture, unique_room
from collector import DEFAULT_ROOT, Store, decode
from portal import APP_URL, Portal, PortalError, sync
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
.rooms{max-height:230px;overflow:auto;margin:9px 0}.rooms label{display:block;padding:4px 0}
.meta{font-size:13px;color:#546553}.message{border-left:2px solid #c9dcc7;margin:12px 0;padding-left:12px}
.message p{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}.message img{max-width:100%;max-height:400px}
nav{display:flex;gap:14px;margin-bottom:14px}@media(max-width:620px){main{padding:20px 12px}section{padding:12px}td,th{padding:6px 3px}}
</style><main><header><h1>카카오톡 업무 수집</h1><nav><a href="/">수집 현황</a></nav></header>
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

    def background(self, actions, lock_name):
        while True:
            try:
                with Store(self.root) as store, locked(store, lock_name):
                    actions(store)
            except (PortalError, OSError, ValueError, RuntimeError) as error:
                if lock_name == "portal" and str(error) != "수집기 작업이 진행 중입니다":
                    with Store(self.root) as store:
                        store.configure("portal_status", str(error) if isinstance(error, PortalError) else type(error).__name__)
            threading.Event().wait(15)

    def workers(self):
        collect = lambda store: run_collection(store, SimpleNamespace(command="tick"))
        def submit(store):
            if store.setting("portal_enabled"):
                sync(store, Portal(store.root))
        for action, lock_name in ((collect, "collector"), (submit, "portal")):
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
                elif action == "probe":
                    store.configure("ax_probe", probe_capture(store))
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
                    self.portal_action(store, action, data)

    def portal_action(self, store, action, data):
        if action == "portal-stop":
            store.configure("portal_enabled", False)
            return
        if action == "portal-retry":
            batch = batch_number(store, int(data["number"][0]))
            with store.db:
                store.db.execute("UPDATE portal_parts SET state='retry' WHERE batch=? AND entry IS NOT NULL AND state='failed'", (batch["id"],))
                store.db.execute("UPDATE batches SET error=NULL WHERE id=? AND state='portal_wait'", (batch["id"],))
            return
        portal = Portal(store.root)
        try:
            if action == "login":
                actor = portal.login(data["identifier"][0], data["password"][0])
                store.configure("portal_actor", actor)
                portal.capability()
                store.configure("portal_status", "업무포탈 연결 확인")
                return
            portal.capability()
            if portal.session["actor"] != store.setting("portal_actor"):
                raise PortalError("PORTAL_ACCOUNT_CHANGED")
            aliases = [alias.strip() for alias in data.get("aliases", [""])[0].split(",") if alias.strip()]
            mode = data["mode"][0]
            if mode not in ("preview", "auto") or len(aliases) > 8 or any(len(alias) > 40 for alias in aliases):
                raise ValueError("업무 판단 설정을 확인해 주세요")
            store.configure("portal_aliases", aliases)
            store.configure("portal_mode", mode)
            store.configure("portal_enabled", True)
        except PortalError as error:
            store.configure("portal_status", str(error))
            raise


class Handler(BaseHTTPRequestHandler):
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
        if self.headers.get("Host") != self.server.host:
            self.reply(403)
            return
        request = urlsplit(self.path)
        match = re.fullmatch(r"/(batch|photo|room)/(\d{1,12})", request.path)
        if request.path == "/connect" and parse_qs(request.query).get("key") == [self.server.token]:
            self.reply(303, Location="/", Set_Cookie=f"ean_local={self.server.token}; Path=/; HttpOnly; SameSite=Strict")
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
            elif request.path == "/":
                content = self.index(store)
            else:
                self.reply(404)
                return
        self.reply(200, (PAGE + content + "</main>").encode())

    def do_POST(self):
        if (self.headers.get("Host") != self.server.host or not self.authorized()
                or self.headers.get("Origin") != f"http://{self.server.host}"):
            self.reply(403)
            return
        actions = {"start", "pause", "interval", "agent-install", "agent-remove", "rooms",
                   "select", "deselect", "collect", "history", "resume-room", "login", "portal-mode", "portal-stop", "portal-retry", "probe"}
        action = self.path.removeprefix("/action/")
        if action not in actions:
            self.reply(404)
            return
        length = self.headers.get("Content-Length", "")
        if not length.isdecimal() or int(length) > 16384:
            self.reply(413)
            return
        try:
            data = parse_qs(self.rfile.read(int(length)).decode(), max_num_fields=200)
        except ValueError:
            self.reply(400)
            return
        if action == "portal-mode" and data.get("confirm") != ["yes"]:
            self.reply(400)
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
        text += self.button("collect", "지금 수집", primary=True)
        text += self.button("start", "시작") + self.button("pause", "일시정지")
        text += self.button("interval", "주기 변경", f'<label>초 <input name="seconds" type="number" min="15" max="3600" value="{seconds}" size="5"> </label>')
        text += '<details><summary>로그인 시 자동 실행</summary>'
        text += self.button("agent-install", "자동 실행 등록") + self.button("agent-remove", "자동 실행 해제")
        text += '</details></section><section><h2>수집 대상</h2>'
        text += self.button("rooms", "카카오톡 방 목록 가져오기")
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
        if self.server.available is not None:
            available, total = self.server.available
            counts = Counter(r["name"] for r in available)
            fields = f'<small>현재 노출 {len(available)}개 · 앱 보고 {total}행</small><div class="rooms">'
            for room in available:
                name = esc(room["name"])
                duplicate = counts[room["name"]] > 1
                fields += (f'<label><input type="checkbox" name="room" value="{name}" '
                           f'{"disabled" if duplicate else ""}> {name} {"(동명 방)" if duplicate else ""}</label>')
            fields += '</div><label>과거 시작 범위 (KST, 선택) <input name="since" type="datetime-local"></label> '
            text += self.button("select", "선택 저장", fields, inline=False)
        text += '</section><section><h2>수집 묶음</h2><table><tr><th>채팅방</th><th>수집 시각 (KST)</th><th>처리 상태</th></tr>'
        recent = list(batches(store).fetchmany(100))
        for batch in recent:
            error = issue(batch["error"])
            text += (f'<tr><td><a href="/batch/{batch["number"]}">{esc(batch["name"])}</a></td>'
                     f'<td>{kst(batch["created"])}</td><td>{esc(STATES[batch["state"]])} {error}</td></tr>')
        if not recent:
            text += '<tr><td colspan="3">수집 묶음이 없습니다.</td></tr>'
        text += '</table></section><section><h2>업무포탈</h2>'
        text += f'<p>{issue(store.setting("portal_status", "연결 대기"))} · <a href="{APP_URL}">업무포탈 열기</a></p>'
        text += self.button("login", "업무포탈 로그인",
                            '<label>계정 <input name="identifier" autocomplete="username" required></label> '
                            '<label>비밀번호 <input type="password" name="password" autocomplete="off" required></label> ',
                            inline=False)
        fields = ('<label>본인 별칭 <input name="aliases" placeholder="쉼표로 구분"></label> '
                  '<label>모드 <select name="mode"><option value="preview">확인</option>'
                  '<option value="auto">자동 반영</option></select></label> '
                  '<label><input required type="checkbox" name="confirm" value="yes"> 선택 방의 대화·사진을 업무포탈로 전송</label> ')
        text += self.button("portal-mode", "전송 시작", fields, inline=False)
        text += self.button("portal-stop", "전송 일시정지")
        return text + '</section>'

    def room_detail(self, store, number):
        room = store.db.execute("SELECT * FROM rooms WHERE id=?", (number,)).fetchone()
        if room is None:
            raise ValueError("room_not_found")
        text = f'<section><h2>{esc(room["name"])}</h2><p>{issue(room["issue"])}</p>'
        if room["enabled"]:
            room_field = f'<input type="hidden" name="room" value="{number}">'
            fields = room_field + '<label>로딩 횟수 <input type="number" name="pages" min="1" max="10" value="1"></label> '
            text += self.button("history", "이전 대화 요청", fields)
            if room["sticky_gap"]:
                text += '<p>누락 가능 구간을 보관했습니다. 최신 관찰을 기준으로 이후부터 재개할 수 있습니다.</p>'
                text += self.button("resume-room", "최신 관찰부터 재개", room_field)
        head = store.db.execute("SELECT * FROM observations WHERE id=?", (room["head"],)).fetchone()
        if head:
            rows = decode(head["rows_json"])
            ids = decode(head["message_ids"])
            text += f'<p class="meta">마지막 AX 관찰 {kst(head["collected"])} · {len(rows)}행 · 과거 전체 범위 미확인</p>'
            for row, identifier in list(zip(rows, ids))[-100:]:
                text += f'<div class="message"><div class="meta">{esc(row.get("sender") or "작성자 미확인")} · {esc(row.get("dateText"))} {esc(row.get("timeText"))}</div>'
                if row["kind"] == "attachment":
                    capture = store.db.execute("SELECT sha256,error FROM captures WHERE message=?", (identifier,)).fetchone()
                    if capture and capture["sha256"]:
                        text += f'<img src="/photo/{identifier}" alt="카카오톡 창 사진 영역 캡처">'
                    else:
                        text += f'<p>사진 · {issue(capture["error"]) if capture else "캡처 대기"}</p>'
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
        server.workers()
        if args.open:
            webbrowser.open(url)
        server.serve_forever()


if __name__ == "__main__":
    main()
