#!/usr/bin/env python3
"""Ean Kakao collector controls for a macOS login session."""

import argparse
import fcntl
import os
import plistlib
import re
import subprocess
import sys
import tempfile
import uuid
from collections import Counter
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from urllib.error import URLError

from ax_source import AXError, IDLE_SECONDS, COLLECTION_WAIT, checked, collect_room, list_rooms, native, unique_room
from collector import DEFAULT_ROOT, SEOUL, Store, decode, now
from drive_store import deliver, drive_ready

LABEL = "com.ean.kakao-collector"
STATES = {
    "queued": "전송 대기", "photo_review": "사진 포함 · 전송 대기",
    "portal_wait": "업무포탈 분석 대기", "portal_ready": "업무포탈 분석 결과",
    "registered": "이전 접수 기록", "ready": "이전 분석 기록",
    "applied": "이전 저장 기록", "applied_remote": "이전 서버 기록",
}
REASONS = {
    "accessibility_permission_required": "손쉬운 사용 권한 필요",
    "screen_recording_permission_required": "화면 기록 권한 필요",
    "app_not_running": "카카오톡이 실행되지 않음",
    "snapshot_changed": "조회 중 대화 변경",
    "overlap_unverified": "스냅샷 연결 불확실 · 누락 가능",
    "partial_ax": "AX가 일부 범위만 노출",
    "photo_capture_failed": "사진 캡처 실패",
    "mac_user_active": f"맥 사용 중 · 입력이 {IDLE_SECONDS}초 멈추면 자동 재개",
    "mac_input_unavailable": "맥 입력 상태 확인 대기",
    "screen_locked": "맥 잠금 해제 대기",
    "accessibility_read_failed_AXWindows_-25204": "카카오톡 창 목록 응답 지연 · 재시도 대기",
    "viewer_controls_not_observed": "사진 뷰어의 저장 버튼을 확인하지 못함",
    "viewer_save_control_unavailable": "사진 뷰어의 저장 동작을 확인하지 못함",
    "viewer_inspection_pending": "카카오톡 사진 저장 경로 확인 대기",
    "viewer_save_inspection_pending": "사진 뷰어 저장 메뉴 확인 대기",
    "photo_hit_not_confirmed": "대화창에서 해당 사진 위치를 확인하지 못함",
    "photo_viewer_not_observed": "해당 사진의 뷰어가 열렸는지 확인하지 못함",
    "photo_context_not_visible": "사진이 있는 대화 구간이 현재 보이지 않음",
    "room_not_visible": "목록에서 방을 확인할 수 없음",
    "target_room_name_ambiguous": "같은 이름의 방이 여러 개",
    "target_room_window_ambiguous": "같은 이름의 창이 여러 개",
    "room_search_in_use": "사용 중인 카카오톡 방 검색을 보존하기 위해 대기",
    "room_picker_filter_active": "카카오톡 채팅방 검색을 해제하지 못했습니다. 검색을 지운 뒤 방 목록을 새로 읽어 주세요.",
    "room_picker_changed": "조회 중 채팅방 목록이 바뀌었습니다. 방 목록을 새로 읽어 주세요.",
    "room_search_partial": "동명 방이 없는지 확인할 수 없어 수집 보류",
    "room_search_restore_failed": "수집 후 카카오톡 방 검색 상태 복원 실패",
    "room_identity_changed": "방 식별 정보가 달라짐",
    "PORTAL_RELOGIN": "기존 업무포탈 로그인 필요",
    "PORTAL_KAKAO_DEPLOY_REQUIRED": "업무포탈 카카오톡 연결 배포 대기",
    "PORTAL_PHOTO_PENDING": "사진 캡처 대기",
    "PORTAL_SOURCE_LIMIT": "개별 원문 또는 사진이 접수 한도를 초과했습니다",
    "PORTAL_PUBLIC_KEY_REQUIRED": "업무포탈 공개 클라이언트 설정 필요",
    "baseline_restarted": "최신 관찰을 기준으로 재개 · 이전 누락 기록 보관",
}


def safe(value):
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]", "�", str(value or ""))


def kst(value):
    return datetime.fromisoformat(value).astimezone(SEOUL).strftime("%Y-%m-%d %H:%M:%S") if value else "기록 없음"


@contextmanager
def locked(store, name="collector", *, wait=False):
    fd = os.open(store.root / f"{name}.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX if wait else fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("수집기 작업이 진행 중입니다") from None
        yield
    finally:
        os.close(fd)


def run_collection(store, args):
    scheduled = args.command == "tick"
    if scheduled and store.setting("paused", True):
        return
    if scheduled:
        try:
            activity = native(store).request(action="activity")
            idle = activity.get("idleSeconds")
            if activity.get("status") != "ok" or not isinstance(idle, (float, int)):
                wait = "mac_input_unavailable"
            else:
                wait = "mac_user_active" if idle < IDLE_SECONDS else None
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            wait = "mac_input_unavailable"
        if store.setting("input_wait") != wait and (wait or store.setting("input_wait") != "screen_locked"):
            store.configure("input_wait", wait)
        if wait:
            return
    last = store.setting("last_cycle")
    resume = store.setting("next_collection_room") if scheduled else None
    if scheduled and not resume and last:
        elapsed = (datetime.fromisoformat(now()) - datetime.fromisoformat(last)).total_seconds()
        if 0 <= elapsed < store.setting("interval", 60):
            return
    query = "SELECT * FROM rooms WHERE enabled=1 ORDER BY id"
    rooms = list(store.db.execute(query))
    room_number = getattr(args, "room", None)
    if room_number is not None:
        rooms = [room for room in rooms if room["id"] == room_number]
    pages = getattr(args, "history_pages", 0)
    if pages and room_number is None:
        raise ValueError("이전 대화 요청은 --room 번호를 지정하세요")
    if not scheduled and not rooms:
        raise ValueError("먼저 rooms에서 방을 확인한 뒤 select로 선택하세요")
    if resume:
        rooms = [room for room in rooms if room["id"] >= resume]
    elif scheduled:
        store.configure("last_cycle", now())
    for room in rooms:
        if scheduled and store.setting("next_collection_room") != room["id"]:
            store.configure("next_collection_room", room["id"])
        if scheduled and store.setting("paused", True):
            return
        try:
            collect_room(store, native(store, idle_guard=IDLE_SECONDS), room, pages)
        except AXError as error:
            if str(error) in COLLECTION_WAIT:
                if not scheduled:
                    raise
                if store.setting("input_wait") != str(error):
                    store.configure("input_wait", str(error))
                return
            store.failure(room["id"], str(error))
        except ImportError:
            store.failure(room["id"], "kakaotalk_ax_missing")
        except ValueError as error:
            issue = "swift_build_failed" if "Swift" in str(error) or "bridge build" in str(error) else "ax_value_error"
            store.failure(room["id"], issue)
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            store.failure(room["id"], type(error).__name__)
        if scheduled and store.setting("input_wait"):
            store.configure("input_wait", None)
    if scheduled:
        store.configure("next_collection_room", None)
        if store.setting("input_wait"):
            store.configure("input_wait", None)
    if not scheduled and not getattr(args, 'quiet', False):
        show_status(store)


def show_status(store):
    state = "일시정지" if store.setting("paused", True) else REASONS.get(store.setting("input_wait"), "사용")
    print(f"정기 수집  {state}")
    print(f"수집 주기  {store.setting('interval', 60)}초")
    print("OneDrive  " + ("연결됨" if drive_ready(store.root) else "계정 연결 대기"))
    for room in store.db.execute("SELECT * FROM rooms ORDER BY id"):
        issue = REASONS.get(room["issue"], room["issue"]) or "현재 노출 범위"
        gap = " · 이전/사이 누락 가능" if room["sticky_gap"] and room["issue"] != "overlap_unverified" else ""
        state = "선택됨" if room["enabled"] else "수집 제외"
        print(f"{room['id']:>3}  {safe(room['name'])}  {state}  {issue}{gap}")
        print(f"     시작 {kst(room['cutoff'])} · 마지막 정상 {kst(room['last_ok'])} · 최근 시도 {kst(room['last_attempt'])} (KST)")
    counts = Counter(dict(store.db.execute("SELECT state,count(*) FROM batches GROUP BY state")))
    pending = store.db.execute("SELECT count(*) FROM messages WHERE state='review_overlap'").fetchone()[0]
    print("  ".join(f"{label} {counts[state]}" for state, label in STATES.items()))
    print(f"연결 미확인 관찰행 {pending}")


def batches(store):
    return store.db.execute(
        "SELECT b.rowid AS number,b.*,r.name FROM batches b JOIN rooms r ON r.id=b.room "
        "ORDER BY number DESC"
    )


def batch_number(store, number):
    batch = next((item for item in batches(store) if item["number"] == number), None)
    if not batch:
        raise ValueError("묶음 번호를 확인하세요")
    return batch


def review(store, number):
    if number is None:
        for item in batches(store):
            error = item["error"]
            print(f"{item['number']:>4}  {safe(item['name'])}  {kst(item['created'])}  "
                  f"{STATES[item['state']]}  {REASONS.get(error, error) or ''}")
        return
    item = batch_number(store, number)
    fresh = set(decode(item["fresh"]))
    print(f"{safe(item['name'])} · {STATES[item['state']]}")
    for message in store.context(item):
        row = decode(message["row_json"])
        scope = "새 대화" if message["id"] in fresh else "문맥"
        date = kst(message["occurred"]) if message["occurred"] else "작성 시각 미확인"
        print(f"\n{scope}  {safe(row.get('sender') or '작성자 미확인')}  {date}")
        if row["kind"] == "attachment":
            status = "창 영역 캡처 보관" if message["sha256"] else message["photo_error"] or "캡처 대기"
            print(f"[사진 {message['id']}] {REASONS.get(status, status)}")
        elif row["kind"] == "text":
            print(safe(row["text"]))
        else:
            print("[AX에서 본문을 확인하지 못한 행]")
    if item["result"] and item["state"] in ("portal_wait", "portal_ready"):
        for part in decode(item["result"]):
            for candidate in part.get("items", []):
                print(safe(candidate.get("text")), safe(candidate.get("kakao", {}).get("route")))
    if item["error"]:
        print(REASONS.get(item["error"], item["error"]))


def photo(store, identifier):
    rows = store.db.execute("SELECT path FROM originals WHERE message=? AND path IS NOT NULL ORDER BY ordinal", (identifier,)).fetchall()
    if not rows:
        raise ValueError("사진 확보 대기")
    for row in rows:
        path = store.root / "outbox" / row["path"]
        subprocess.run(["/usr/bin/open","-a","Preview",str(path)],check=True)


def agent(store, install):
    app = os.environ.get("KAKAO_COLLECTOR_APP") or store.setting("collector_app")
    if not app or not Path(app).is_dir():
        raise ValueError("자동 실행용 앱 경로를 찾지 못했습니다")
    label = LABEL + ".app"
    path = Path.home() / "Library/LaunchAgents" / f"{label}.plist"
    domain = f"gui/{os.getuid()}"
    service = f"{domain}/{label}"
    if subprocess.run(["/bin/launchctl", "print", service], capture_output=True).returncode == 0:
        subprocess.run(["/bin/launchctl", "bootout", service], check=True)
    if not install:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    arguments = ["/usr/bin/open", "-W", "-gj", "--env", "KAKAO_COLLECTOR_BACKGROUND=1", app]
    data = {"Label":label, "LimitLoadToSessionType":"Aqua", "ProgramArguments":arguments, "RunAtLoad":True, "KeepAlive":True, "ThrottleInterval":15}
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".kakao-", delete=False) as file:
        file.write(plistlib.dumps(data))
    os.replace(file.name, path)
    subprocess.run(["/bin/launchctl", "bootstrap", domain, str(path)], check=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_ROOT)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("status", "rooms", "start", "pause", "tick", "agent-install",
                    "agent-remove", "diagnose", "sync-tick"):
        sub.add_parser(command)
    configure = sub.add_parser("interval")
    configure.add_argument("seconds", type=int, choices=range(15, 3601), metavar="15..3600")
    select = sub.add_parser("select")
    select.add_argument("names", nargs="+")
    select.add_argument("--since", help="ISO 날짜/시각, 시간대 생략 시 KST")
    deselect = sub.add_parser("deselect")
    deselect.add_argument("room", type=int)
    collect = sub.add_parser("collect")
    collect.add_argument("--room", type=int)
    collect.add_argument("--history-pages", type=int, choices=range(1, 11), default=0, metavar="1..10")
    display = sub.add_parser("review")
    display.add_argument("number", type=int, nargs="?")
    capture = sub.add_parser("photo")
    capture.add_argument("message", type=int)
    arguments = parser.parse_args()
    command = arguments.command
    try:
        with Store(arguments.data) as store:
            if command == "status":
                show_status(store)
            elif command == "review":
                review(store, arguments.number)
            elif command == "photo":
                photo(store, arguments.message)
            elif command in ("agent-install", "agent-remove"):
                agent(store, command == "agent-install")
            elif command in ("start", "pause"):
                store.configure("paused", command == "pause")
            elif command == "interval":
                store.configure("interval", arguments.seconds)
            else:
                lock_name = "drive" if command == "sync-tick" else "collector"
                with locked(store, lock_name):
                    if command in ("collect", "tick"):
                        run_collection(store, arguments)
                    elif command == "deselect":
                        with store.db:
                            store.db.execute("UPDATE rooms SET enabled=0 WHERE id=?", (arguments.room,))
                    elif command == "diagnose":
                        result = checked(native(store).windows())
                        print(f"AX 연결 확인 · 열린 창 {len(result['items'])}개")
                    elif command in ("rooms", "select"):
                        items, total = list_rooms(native(store))
                        if command == "rooms":
                            counts = Counter(item["name"] for item in items)
                            for room in items:
                                print(safe(room["name"]) + ("  (동명 방)" if counts[room["name"]] > 1 else ""))
                            scope = f"앱 보고 {total}행" if total is not None else "열린 대화창만 표시"
                            print(f"현재 노출 {len(items)}개 · {scope}")
                        else:
                            selected = [unique_room(items, name) for name in arguments.names]
                            for room in selected:
                                store.add_room(room["name"], bool(room["isSelf"]), arguments.since)
                            store.configure("paused", False)
                            show_status(store)
                    else:
                        deliver(store)
    except (AXError, ValueError, OSError, ImportError, subprocess.SubprocessError) as error:
        label = str(error) if isinstance(error, (AXError, ValueError)) else type(error).__name__
        if command in ("tick", "sync-tick") and label == "수집기 작업이 진행 중입니다":
            return 0
        print(REASONS.get(label, label), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
