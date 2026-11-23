"""Durable local observations and ordered reconciliation for kakaotalk-ax."""

import hashlib
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SEOUL = ZoneInfo("Asia/Seoul")
DEFAULT_ROOT = Path.home() / "Library/Application Support/Ean Kakao Collector"


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def decode(value):
    return json.loads(value)


def occurred_at(row):
    date = re.fullmatch(r"(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?", row.get("dateText") or "")
    time = re.fullmatch(r"(?:(오전|오후|AM|PM)\s*)?(\d{1,2}):(\d\d)(?:\s*(AM|PM))?",
                        row.get("timeText") or "", flags=re.IGNORECASE)
    if not date or not time:
        return None
    prefix, hour, minute, suffix = time.groups()
    hour = int(hour)
    if prefix or suffix:
        if prefix and suffix or not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if (prefix or suffix).upper() in ("오후", "PM") else 0)
    try:
        return datetime(*map(int, date.groups()), hour, int(minute), tzinfo=SEOUL)
    except ValueError:
        return None


def signature(row):
    # Offscreen timestamp labels disappear and context menus attach to the AX row.
    # Match the ordered conversation on content that stays with the bubble.
    if row["kind"] in ("text", "attachment"):
        return encode([row["kind"], row.get("text"), row.get("attachments", []), row.get("links", [])])
    return encode([part for part in row.get("axParts", []) if part.get("role") not in ("AXMenu", "AXMenuItem")])


def reconcile(previous, current):
    """Return (current offset, matched count) for a unique, diverse prior suffix."""
    old = list(map(signature, previous))
    new = list(map(signature, current))
    if old and old == new:
        return (0, len(old))
    for length in range(min(len(old), len(new)), 1, -1):
        tail = old[-length:]
        if len(set(tail)) < 2:
            return None
        positions = [i for i in range(len(new) - length + 1) if new[i:i + length] == tail]
        if positions:
            return (positions[0], length) if len(positions) == 1 else None
    return None


SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, own INTEGER NOT NULL,
    cutoff TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    head INTEGER, sticky_gap INTEGER NOT NULL DEFAULT 0,
    last_attempt TEXT, last_ok TEXT, issue TEXT
);
CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY, room INTEGER NOT NULL REFERENCES rooms,
    snapshot TEXT NOT NULL, rows_json TEXT NOT NULL, message_ids TEXT NOT NULL,
    coverage TEXT NOT NULL, collected TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, room INTEGER NOT NULL REFERENCES rooms,
    row_json TEXT NOT NULL, occurred TEXT, collected TEXT NOT NULL, state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS captures (
    message INTEGER PRIMARY KEY REFERENCES messages,
    bytes BLOB, sha256 TEXT, error TEXT, attempted TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY, room INTEGER NOT NULL REFERENCES rooms,
    fresh TEXT NOT NULL, context TEXT NOT NULL, created TEXT NOT NULL,
    state TEXT NOT NULL, payload TEXT, origin TEXT, employee TEXT,
    result TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS batches_room ON batches(room, created);
CREATE TABLE IF NOT EXISTS portal_parts (
    batch TEXT NOT NULL REFERENCES batches, number INTEGER NOT NULL, request TEXT PRIMARY KEY,
    actor TEXT NOT NULL, payload TEXT NOT NULL, entry TEXT, state TEXT, result TEXT,
    UNIQUE(batch,number)
);
CREATE TABLE IF NOT EXISTS analysis_queue (
    batch TEXT PRIMARY KEY REFERENCES batches,
    target TEXT, origin TEXT NOT NULL, employee TEXT NOT NULL, next_attempt TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
);
"""


class Store:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        file = self.root / "collector.sqlite3"
        fd = os.open(file, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        self.db = sqlite3.connect(file, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA journal_mode=WAL")
        from drive_store import SCHEMA as DRIVE_SCHEMA
        self.db.executescript(SCHEMA + DRIVE_SCHEMA)
        if "local_revision" not in {r[1] for r in self.db.execute("PRAGMA table_info(drive_outbox)")}:
            with self.db:
                self.db.execute("ALTER TABLE drive_outbox ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 0")

        # The old picker stored the spoken room type as part of the title.
        # Keep the existing room ID, cutoff, selections and observations.
        if not self.setting("team_room_titles_v1"):
            with self.db:
                self.db.execute("BEGIN IMMEDIATE")
                if not self.setting("team_room_titles_v1"):
                    prefix = "팀채팅, "
                    self.db.execute(
                        "UPDATE OR IGNORE rooms SET name=substr(name, ?) "
                        "WHERE substr(name, 1, ?)=? AND length(name)>?",
                        (len(prefix)+1, len(prefix), prefix, len(prefix)))
                    self.db.execute("INSERT INTO settings VALUES ('team_room_titles_v1','true')")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.db.close()

    def setting(self, key, default=None):
        row = self.db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return decode(row[0]) if row else default

    def configure(self, key, value):
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, encode(value)))

    def add_room(self, name, own, cutoff=None):
        start = datetime.fromisoformat(cutoff) if cutoff else datetime.now(SEOUL)
        if start.tzinfo is None:
            start = start.replace(tzinfo=SEOUL)
        with self.db:
            return self.enable_room(name, own, start.isoformat())

    def enable_room(self, name, own, cutoff):
        self.db.execute(
            "INSERT INTO rooms(name,own,cutoff) VALUES (?,?,?) "
            "ON CONFLICT(name) DO UPDATE SET enabled=1 WHERE own=excluded.own",
            (name, int(own), cutoff),
        )
        item = self.db.execute("SELECT id,own FROM rooms WHERE name=?", (name,)).fetchone()
        if bool(item["own"]) != own:
            raise ValueError("room_identity_changed")
        return item["id"]

    def failure(self, room, issue):
        with self.db:
            self.db.execute("UPDATE rooms SET last_attempt=?,issue=? WHERE id=?", (now(), issue, room))

    def observe(self, room, snapshot, rows, coverage, photos, history_requested=False):
        timestamp = now()
        config = self.db.execute("SELECT * FROM rooms WHERE id=?", (room,)).fetchone()
        head = self.db.execute("SELECT * FROM observations WHERE id=?", (config["head"],)).fetchone()
        from drive_store import queue_batch
        same = head and head["snapshot"] == snapshot and len(decode(head["message_ids"])) == len(rows)
        issue = None
        sticky_gap = config["sticky_gap"]
        new_ids = []
        with self.db:
            if same:
                ids = decode(head["message_ids"])
            else:
                previous = decode(head["rows_json"]) if head else []
                matched = reconcile(previous, rows) if previous else None
                if previous and not matched and not coverage.get("rowStart") and not decode(head["coverage"]).get("rowStart"):
                    if len(rows) >= len(previous) and list(map(signature, rows[:len(previous)])) == list(map(signature, previous)):
                        matched = (0, len(previous))
                ids = [None] * len(rows)
                if matched:
                    start, count = matched
                    ids[start:start + count] = decode(head["message_ids"])[-count:]
                elif previous:
                    issue = "overlap_unverified"
                    sticky_gap = 1
                for index, row in enumerate(rows):
                    if ids[index] is not None:
                        continue
                    at = occurred_at(row)
                    appended = matched and index >= sum(matched)
                    exportable = row["kind"] in ("text", "attachment")
                    # A new selection includes the visible baseline. Never publish ambiguous overlap.
                    if exportable and (head is None or appended):
                        state = "new"
                    elif previous and not matched:
                        state = "review_overlap"
                    else:
                        state = "context"
                    ids[index] = self.db.execute(
                        "INSERT INTO messages(room,row_json,occurred,collected,state) VALUES (?,?,?,?,?)",
                        (room, encode(row), at.isoformat() if at else None, timestamp, state),
                    ).lastrowid
                    if state == "new":
                        new_ids.append((index, ids[index]))
                observation = self.db.execute(
                    "INSERT INTO observations(room,snapshot,rows_json,message_ids,coverage,collected) VALUES (?,?,?,?,?,?)",
                    (room, snapshot, encode(rows), encode(ids), encode(coverage), timestamp),
                ).lastrowid
                self.db.execute("UPDATE rooms SET head=?,sticky_gap=? WHERE id=?", (observation, sticky_gap, room))
                new_photos = {index for index, _ in new_ids if rows[index]["kind"] == "attachment"}
                if new_photos:
                    self.include_late_photos(room, ids, new_photos)
                for offset in range(0, len(new_ids), 12):
                    group = new_ids[offset:offset + 12]
                    left, right = max(0, group[0][0] - 4), group[-1][0] + 5
                    state = "photo_review" if any(row["kind"] == "attachment" for row in rows[left:right]) else "queued"
                    batch_id = str(uuid.uuid4())
                    self.db.execute(
                        "INSERT INTO batches(id,room,fresh,context,created,state) VALUES (?,?,?,?,?,?)",
                        (batch_id, room, encode([identifier for _, identifier in group]),
                         encode(ids[left:right]), timestamp, state),
                    )
                    queue_batch(self.db, batch_id, [(mid, rows[i]) for i, mid in group])
            for index, (image, error) in photos.items():
                self.db.execute(
                    "INSERT INTO captures VALUES (?,?,?,?,?) ON CONFLICT(message) DO UPDATE SET "
                    "bytes=excluded.bytes,sha256=excluded.sha256,error=excluded.error,attempted=excluded.attempted "
                    "WHERE captures.bytes IS NULL",
                    (ids[index], image, hashlib.sha256(image).hexdigest() if image else None, error, timestamp),
                )
            if sticky_gap:
                issue = "overlap_unverified"
            elif coverage.get("rowsTruncated") or coverage.get("partial"):
                issue = "partial_ax"
            elif any(error for _, error in photos.values()):
                issue = "photo_capture_failed"
            self.db.execute(
                "UPDATE rooms SET last_attempt=?,last_ok=?,issue=? WHERE id=?",
                (timestamp, timestamp, issue, room),
            )

    def include_late_photos(self, room, ids, photos):
        positions = {identifier: index for index, identifier in enumerate(ids)}
        pending = self.db.execute(
            "SELECT id,fresh,context FROM batches WHERE room=? AND state='queued' AND payload IS NULL",
            (room,),
        ).fetchall()
        for item in pending:
            locations = [positions[identifier] for identifier in decode(item["fresh"]) if identifier in positions]
            if not locations:
                continue
            last = max(locations)
            nearby = [index for index in photos if last < index <= last + 4]
            if nearby:
                context = list(dict.fromkeys(decode(item["context"]) + ids[last + 1:max(nearby) + 1]))
                self.db.execute(
                    "UPDATE batches SET context=?,state='photo_review' WHERE id=?",
                    (encode(context), item["id"]),
                )

    def context(self, batch):
        identifiers = decode(batch["context"])
        return [
            self.db.execute(
                "SELECT m.*, c.sha256, c.error photo_error FROM messages m LEFT JOIN captures c ON c.message=m.id WHERE m.id=?",
                (identifier,),
            ).fetchone()
            for identifier in identifiers
        ]

    def batch(self, identifier):
        result = self.db.execute("SELECT * FROM batches WHERE id=?", (identifier,)).fetchone()
        if result is None:
            raise ValueError("batch_not_found")
        return result

    def photo_state(self, room):
        head = self.db.execute(
            "SELECT o.* FROM observations o JOIN rooms r ON r.head=o.id WHERE r.id=?", (room,)
        ).fetchone()
        if head is None:
            return None, {}
        ids = decode(head["message_ids"])
        if not ids:
            return head["snapshot"], {}
        placeholders = ",".join("?" for _ in ids)
        captures = {
            item["message"]: (bool(item["captured"]), item["attempted"])
            for item in self.db.execute(
                f"SELECT message,bytes IS NOT NULL captured,attempted FROM captures WHERE message IN ({placeholders})",
                ids,
            )
        }
        return head["snapshot"], {i: captures[mid] for i, mid in enumerate(ids) if mid in captures}
