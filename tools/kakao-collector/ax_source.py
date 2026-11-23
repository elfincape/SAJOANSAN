"""Serial, selected-room-only access to the KakaoTalk AX session."""
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path

from kakaotalk_ax import ui_session
from kakaotalk_automation import NativeAX

from collector import decode, now, reconcile, signature
from drive_store import invalidate, register_original


class AXError(RuntimeError):
    pass


def reason(result):
    value = result.get("reason") or result.get("status") or "ax_unknown"
    return value if isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,120}", value) else "ax_unavailable"


def checked(result):
    if result.get("status") != "ok":
        raise AXError(reason(result))
    return result


COLLECTION_WAIT = {"mac_user_active", "mac_input_unavailable", "screen_locked"}
IDLE_SECONDS = 60


class CollectorAX(NativeAX):
    idle_guard = 0

    def response(self, proc):
        result = json.loads(proc.stdout)
        if self.idle_guard and result.get("reason") in COLLECTION_WAIT:
            raise AXError(result["reason"])
        return result

    tail = 24

    def request(self, **args):
        proc = subprocess.run([str(self.cache_root / "collector-read")],
                              input=json.dumps(dict(args, tail=self.tail, idleGuardSeconds=self.idle_guard)), capture_output=True, text=True, timeout=80)
        if proc.returncode:
            raise AXError("ax_reader_failed")
        return self.response(proc)

    def _control_call(self, action, **arguments):
        proc = subprocess.run([str(self.cache_root / "collector-control")],
                              input=json.dumps(dict(action=action, idleGuardSeconds=self.idle_guard, **arguments)), capture_output=True, text=True, timeout=80)
        if proc.returncode:
            raise AXError("ax_control_failed")
        return self.response(proc)

    def _call(self, action, titles, text=None):
        if action in {"read", "windows"}:
            return self.request(action=action, windowTitles=titles)
        return super()._call(action, titles, text)


def native(store, *, idle_guard=0):
    ax = CollectorAX(cache_root=store.root / "native")
    ax.idle_guard = idle_guard
    return ax


def catalog(ax, *, full_list=False):
    with ui_session():
        windows = ax.windows()
        if windows.get("reason") == "screen_locked":
            return windows, windows
        rooms = ax._control_call("rooms", listAllRooms=True) if full_list else ax.rooms()
    return windows, rooms


def list_rooms(ax):
    windows, rooms = catalog(ax, full_list=True)
    if rooms.get("status") == "ok":
        items = list(rooms["items"])
        total = rooms["reportedRowCount"]
    else:
        items, total = [], None
    listed = {r["name"] for r in items}
    for win in windows.get("items", []):
        if win.get("readable") and win["windowTitle"] not in listed:
            items.append(dict(name=win["windowTitle"], isSelf=False, openOnly=True))
    if not items and rooms.get("status") != "ok":
        checked(rooms)
    return items, total


def unique_room(items, name, own=None):
    matches = [row for row in items if row["name"] == name]
    if len(matches) != 1:
        raise AXError("room_not_visible" if not matches else "target_room_name_ambiguous")
    if own is not None and matches[0]["isSelf"] != own:
        raise AXError("room_identity_changed")
    return matches[0]


def probe(store):
    ax = native(store)
    with ui_session():
        store.configure("viewer_layout", ax.request(action="layout"))
        windows, rooms = catalog(ax)
    return dict(windows=len(windows.get("items", [])), readable=sum(bool(w.get("readable")) for w in windows.get("items", [])),
                rooms=len(rooms.get("items", [])), window_status=reason(windows), room_status=reason(rooms))


def overlap(old, rows):
    if not old:
        return None
    if len(old) == len(rows) and all(signature(a) == signature(b) for a,b in zip(old, rows)):
        return (0, len(old))
    return reconcile(old, rows)


def collect_room(store, ax, room, history_pages=0):
    name = room["name"]
    with ui_session():
        pending_search = store.setting("collector_room_search")
        if pending_search:
            current = checked(ax.rooms())
            if current.get("searchQuery") == pending_search:
                checked(ax.search_rooms(""))
            store.configure("collector_room_search", None)
        window_result = ax.windows()
        if window_result.get("reason") == "screen_locked":
            checked(window_result)
        windows = window_result.get("items", [])
        matching = [w for w in windows if w["windowTitle"] == name]
        if len(matching) > 1:
            raise AXError("target_room_window_ambiguous")
        close = searched = partial_search = False
        close_after = len(matching) == 1 and matching[0]["readable"]
        try:
            if not matching or not matching[0]["readable"]:
                listing = checked(ax.rooms())
                if (len(listing["items"]) < listing["reportedRowCount"] or
                    not any(r["name"] == name for r in listing["items"])):
                    if listing.get("searchQuery") not in ("", name):
                        raise AXError("room_search_in_use")
                    searched = not listing.get("searchQuery")
                    if searched:
                        store.configure("collector_room_search", name)
                        listing = checked(ax.search_rooms(name))
                    for _ in range(4):
                        if listing.get("searchQuery") == name and any(r["name"] == name for r in listing["items"]):
                            break
                        time.sleep(.3)
                        listing = checked(ax.rooms())
                    else:
                        raise AXError("room_search_partial")
                    partial_search = len(listing["items"]) < listing["reportedRowCount"]
                target = unique_room(listing["items"], name)
                if room["own"] and not target["isSelf"]:
                    raise AXError("room_identity_changed")
                result = ax.open_room(name, require_self=bool(room["own"]))
                if result.get("status") != "ok" and result.get("reason") != "opened_window_not_observed":
                    checked(result)
                for _ in range(5):
                    wins = checked(ax.windows())["items"]
                    if sum(w["windowTitle"] == name and w["readable"] for w in wins) == 1:
                        break
                    time.sleep(.25)
                else:
                    raise AXError("opened_window_not_observed")
                close_after = True
                close = result.get("alreadyOpen") is False
            head = store.db.execute("SELECT * FROM observations WHERE id=?", (room["head"],)).fetchone()
            previous = decode(head["rows_json"]) if head else []
            page = checked(ax.read_messages(name, limit=ax.tail))
            if page["windowTitle"] != name:
                raise AXError("room_identity_changed")
            if not page["items"]:
                raise AXError("empty_transcript")
            if previous and not overlap(previous, page["items"]):
                ax.tail = 240
                page = checked(ax.read_messages(name, limit=ax.tail))
                if close and not overlap(previous, page["items"]):
                    checked(ax.load_more(name, pages=1))
                    page = checked(ax.read_messages(name, limit=ax.tail))
            if partial_search and previous and not overlap(previous, page["items"]):
                raise AXError("room_identity_changed")
            rows = page["items"]
            store.observe(room["id"], page["snapshotId"], rows, page["coverage"], {})
            current = store.db.execute("SELECT o.message_ids FROM rooms r JOIN observations o ON o.id=r.head WHERE r.id=?",
                                       (room["id"],)).fetchone()
            ids = decode(current[0])
            acquire_photos(store, ax, name, page, ids)
            retry_older_photo(store, ax, room["id"], name, ids)
        finally:
            if searched:
                listing = ax.rooms()
                if listing.get("status") == "ok" and listing.get("searchQuery") == name:
                    checked(ax.search_rooms(""))
                if listing.get("status") == "ok":
                    store.configure("collector_room_search", None)
            if close_after:
                result = ax.close_room(name)
                if result.get("reason") != "existing_draft_preserved":
                    checked(result)


def retry_older_photo(store, ax, room, name, recent_ids):
    marks = ",".join("?" for _ in recent_ids)
    pending = store.db.execute(
        f"SELECT a.*,m.collected FROM originals a JOIN messages m ON m.id=a.message "
        f"WHERE m.room=? AND a.message NOT IN ({marks}) AND a.path IS NULL AND a.retry_after<=? "
        "ORDER BY a.retry_after,a.message,a.ordinal LIMIT 1", (room,*recent_ids,time.time())).fetchone()
    if not pending:
        return
    mid = pending["message"]
    origin = store.db.execute(
        "SELECT rows_json,message_ids FROM observations WHERE room=? AND collected=? ORDER BY id",
        (room,pending["collected"])).fetchall()
    ax.tail = 240
    page = checked(ax.read_messages(name,limit=ax.tail))
    current = list(map(signature,page["items"]))
    for observation in origin:
        old_ids = decode(observation["message_ids"])
        if mid not in old_ids:
            continue
        pos = old_ids.index(mid)
        start = max(0,pos-2)
        pattern = [signature(r) for r in decode(observation["rows_json"])[start:pos+3]]
        matches = [i for i in range(len(current)-len(pattern)+1) if current[i:i+len(pattern)] == pattern]
        if len(matches) == 1 and len(set(pattern)) >= 2:
            ids = [None]*len(current)
            ids[matches[0]+pos-start] = mid
            acquire_photos(store,ax,name,page,ids)
            return
    with store.db:
        store.db.execute("UPDATE originals SET retry_after=?,error='photo_context_not_visible' WHERE message=? AND ordinal=?",
                         (time.time()+1800,mid,pending["ordinal"]))
        if pending["error"] != "photo_context_not_visible":
            invalidate(store,pending["batch"])


def acquire_photos(store, ax, name, page, ids):
    positions = {mid:i for i,mid in enumerate(ids)}
    slots = ",".join("?" for _ in ids)
    pending = store.db.execute(f"SELECT * FROM originals WHERE path IS NULL AND message IN ({slots}) "
                               "AND retry_after<=? ORDER BY attempts,message DESC,ordinal LIMIT 2", (*ids,time.time())).fetchall()
    for item in pending:
        row = page["items"][positions[item["message"]]]
        key = (item["message"], item["ordinal"])
        try:
            folder = Path(item["directory"]) if item["directory"] else None
            file = None
            if folder and (folder / ".saved").is_file():
                file = folder / (folder / ".saved").read_text()
            elif folder and (folder / ".requested").is_file():
                # After a crash, this destination belongs only to that Save panel.
                candidates = [p for p in folder.iterdir() if not p.name.startswith(".")]
                if len(candidates) == 1 and candidates[0].is_file() and time.time()-candidates[0].stat().st_mtime > 30:
                    file = candidates[0]
                elif time.time()-(folder / ".requested").stat().st_mtime < 300:
                    raise AXError("download_in_progress")
            if file is None:
                root = store.root / "downloads"
                root.mkdir(exist_ok=True)
                folder = Path(tempfile.mkdtemp(dir=root))
                with store.db:
                    store.db.execute("INSERT INTO original_attempts(directory,message,ordinal,started) VALUES (?,?,?,?)",
                                     (str(folder), *key, now()))
                    store.db.execute("UPDATE originals SET directory=? WHERE message=? AND ordinal=?", (str(folder),*key))
                item = store.db.execute("SELECT * FROM originals WHERE message=? AND ordinal=?", key).fetchone()
                verified = checked(ax.read_messages(name, limit=ax.tail))
                if (verified["snapshotId"] != page["snapshotId"] and
                    list(map(signature,verified["items"])) != list(map(signature,page["items"]))):
                    raise AXError("snapshot_changed")
                center = positions[item["message"]]
                row = verified["items"][center]
                neighbors = [{"rowIndex":r["rowIndex"], "parts":r["axParts"]}
                             for r in verified["items"][max(0,center-1):center+2]]
                result = checked(ax.request(neighbors=neighbors, action="file", windowTitles=[name], rowIndex=row["rowIndex"],
                                            expectedParts=row["axParts"], expectedCount=verified["coverage"]["exposedRowCount"],
                                            ordinal=item["ordinal"], directory=str(folder)))
                if "filename" not in result:
                    store.configure("photo_inspection",result)
                    raise AXError(result.get("reason","save_not_observed"))
                file = folder / (folder / ".saved").read_text()
            register_original(store, item, file)
            with store.db:
                store.db.execute("UPDATE original_attempts SET finished=?,result=? WHERE directory=?", (now(),"saved",str(folder)))
        except (RuntimeError, ValueError, OSError, subprocess.SubprocessError) as exc:
            code = str(exc) if isinstance(exc, AXError) else type(exc).__name__
            if code in COLLECTION_WAIT:
                raise
            with store.db:
                if item["directory"]:
                    store.db.execute("UPDATE original_attempts SET finished=?,result=? WHERE directory=?", (now(),code,item["directory"]))
                store.db.execute("UPDATE originals SET attempts=attempts+1,retry_after=?,error=? WHERE message=? AND ordinal=?",
                                 (time.time()+min(3600,60*2**min(6,item["attempts"])), code,*key))
                if code != item["error"]:
                    invalidate(store, item["batch"])
        else:
            tidy(store, ax)


def tidy(store, ax, *, quit_apps=False):
    # A cleanup error must not count as a failed photo transfer.
    try:
        with ui_session():
            checked(ax.request(action="tidy", downloads=str(store.root / "downloads"), quitApps=quit_apps))
    except AXError as exc:
        if str(exc) in COLLECTION_WAIT:
            raise
        store.configure("window_cleanup_error", str(exc))
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        store.configure("window_cleanup_error", type(exc).__name__)
    else:
        if store.setting("window_cleanup_error"):
            store.configure("window_cleanup_error", None)
