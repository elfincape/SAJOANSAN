"""Read and navigate via the pinned upstream NativeAX library."""

import re
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from collector import decode, occurred_at, reconcile


class AXError(RuntimeError):
    pass


def reason(result):
    value = result.get("reason") or result.get("status") or "ax_unknown"
    return value if isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,120}", value) else "ax_unavailable"


def checked(result):
    if result.get("status") != "ok":
        raise AXError(reason(result))
    return result


def native(store):
    from kakaotalk_automation import NativeAX
    return NativeAX(cache_root=store.root / "native")


def list_rooms(ax):
    result = checked(ax.rooms())
    return result["items"], result["reportedRowCount"]


def unique_room(items, name, own=None):
    matches = [row for row in items if row["name"] == name]
    if len(matches) != 1:
        raise AXError("room_not_visible" if not matches else "target_room_name_ambiguous")
    if own is not None and matches[0]["isSelf"] != own:
        raise AXError("room_identity_changed")
    return matches[0]


def snapshot(ax, name):
    for _ in range(2):
        page = checked(ax.read_messages(name, limit=500))
        token = page["snapshotId"]
        coverage = dict(page["coverage"])
        rows = page["items"]
        if page["hasMore"]:
            older = ax.read_messages(name, limit=500, offset=page["nextOffset"], snapshot_id=token)
            if older["status"] == "snapshot_changed":
                continue
            checked(older)
            rows = older["items"] + rows
            coverage["partial"] = older["hasMore"]
        return token, rows, coverage
    raise AXError("snapshot_changed")


def collect_room(store, ax, room, history_pages=0):
    from kakaotalk_ax import ui_session

    name = room["name"]
    own = bool(room["own"])
    checked(ax.windows())
    with ui_session():
        listing = checked(ax.rooms())
        listed = listing["items"]
        query = listing.get("searchQuery", "")
        close = False
        search_used = False
        try:
            if len(listed) < listing["reportedRowCount"]:
                if query:
                    raise AXError("room_search_in_use")
                search_used = True
                filtered = checked(ax.search_rooms(name))
                listed = filtered["items"]
                if filtered.get("searchQuery") != name or len(listed) != filtered["reportedRowCount"]:
                    raise AXError("room_search_partial")
            unique_room(listed, name, own)
            opened = checked(ax.open_room(name, require_self=own))
            close = not opened["alreadyOpen"]
            if history_pages:
                if not close:
                    raise AXError("history_requires_collector_opened_window")
                checked(ax.load_more(name, pages=history_pages))
            token, rows, coverage = snapshot(ax, name)
            photos = capture_photos(store, ax, room, token, rows)
            store.observe(room["id"], token, rows, coverage, photos, history_requested=bool(history_pages))
        finally:
            if close:
                result = ax.close_room(name)
                if result.get("status") != "ok":
                    store.failure(room["id"], reason(result))
            if search_used:
                current = ax.rooms()
                if current.get("status") == "ok" and current.get("searchQuery") == name:
                    restored = ax.search_rooms(query)
                    if restored.get("status") != "ok":
                        store.failure(room["id"], "room_search_restore_failed")


def capture_photos(store, ax, room, token, rows):
    head, attempts = store.photo_state(room["id"])
    previous = store.db.execute(
        "SELECT rows_json FROM observations WHERE id=?", (room["head"],)
    ).fetchone()
    old_rows = decode(previous[0]) if previous else []
    matched = reconcile(old_rows, rows) if old_rows and head != token else None
    start = max(0, sum(matched) - 4) if matched else max(0, len(rows) - 8)
    first_pass = not previous
    cutoff = datetime.fromisoformat(room["cutoff"])
    first_relevant = next((i for i, row in enumerate(rows)
                           if (at := occurred_at(row)) and at >= cutoff), len(rows))
    if first_pass:
        start = min(start, max(0, first_relevant - 4))
    if matched:
        offset, count = matched
        attempts = {offset + i - (len(old_rows) - count): status for i, status in attempts.items()
                    if i >= len(old_rows) - count}
    elif head != token:
        attempts = {}

    photos = {}
    candidates = [i for i in range(start, len(rows))
                  if rows[i]["kind"] == "attachment" and not attempts.get(i, (False, ""))[0]]
    candidates.sort(key=lambda i: attempts.get(i, (False, ""))[1])
    for index in candidates[:4]:
        with tempfile.TemporaryDirectory(prefix="capture-", dir=store.root) as temp:
            path = Path(temp) / "capture.png"
            try:
                result = checked(ax.read_attachment(room["name"], rows[index]["rowIndex"], token, str(path)))
                if result.get("snapshotId") != token:
                    raise AXError("snapshot_changed")
                image = path.read_bytes()
                if not image.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise AXError("invalid_capture_png")
                photos[index] = (image, None)
            except AXError as error:
                photos[index] = (None, str(error))
            except (OSError, subprocess.TimeoutExpired, RuntimeError, ValueError) as error:
                photos[index] = (None, type(error).__name__)
    return photos


def probe_capture(store):
    """Read one actual conversation and capture one photo for a local diagnostic."""
    ax = native(store)
    rooms, _ = list_rooms(ax)
    windows = ax.windows().get("items", [])
    open_names = {window.get("windowTitle") for window in windows if window.get("readable")}
    choices = [room for room in rooms if room.get("isSelf")] + [
        room for room in rooms if not room.get("isSelf") and room["name"] in open_names
    ]
    if not choices:
        choices = rooms[:1]
    read = photos = tested = 0
    issue = None
    for room in choices[:3]:
        title = room["name"]
        opened = None
        stage = "open"
        try:
            unique_room(rooms, title)
            opened = checked(ax.open_room(title, require_self=bool(room["isSelf"])))
            tested += 1
            stage = "read"
            token, rows, _ = snapshot(ax, title)
            read += len(rows)
            stage = "capture"
            for row in reversed(rows):
                if row["kind"] != "attachment":
                    continue
                with tempfile.TemporaryDirectory(prefix="probe-", dir=store.root) as directory:
                    target = Path(directory) / "photo.png"
                    result = ax.read_attachment(title, row["rowIndex"], token, str(target))
                    if result.get("status") == "ok" and target.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
                        photos = 1
                        break
                    issue = stage + ":" + reason(result)
            if photos:
                break
        except AXError as error:
            issue = stage + ":" + str(error)
        finally:
            if opened and not opened["alreadyOpen"]:
                ax.close_room(title)
    return {"rooms":len(rooms), "tested":tested, "rows":read, "photos":photos, "photoError":issue}
