"""Durable OneDrive outbox. All paths in manifests start at 카톡수집/."""
import configparser
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

from collector import decode, now

SCHEMA = """
CREATE TABLE IF NOT EXISTS originals (
 message INTEGER NOT NULL REFERENCES messages, ordinal INTEGER NOT NULL, batch TEXT NOT NULL REFERENCES batches,
 directory TEXT, path TEXT, sha256 TEXT, size INTEGER, width INTEGER, height INTEGER,
 error TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_after REAL NOT NULL DEFAULT 0,
 PRIMARY KEY(message,ordinal)
);
CREATE TABLE IF NOT EXISTS original_attempts (
 directory TEXT PRIMARY KEY, message INTEGER NOT NULL, ordinal INTEGER NOT NULL,
 started TEXT NOT NULL, finished TEXT, result TEXT,
 FOREIGN KEY(message,ordinal) REFERENCES originals(message,ordinal)
);
CREATE TABLE IF NOT EXISTS drive_outbox (
 path TEXT PRIMARY KEY, batch TEXT REFERENCES batches, revision INTEGER NOT NULL DEFAULT 1,
 local_revision INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
 retry_after REAL NOT NULL DEFAULT 0, error TEXT, uploaded_at TEXT
);
"""


def queue_batch(db, batch, entries):
    db.execute("INSERT INTO drive_outbox(path,batch) VALUES (?,?)", (f"batches/{batch}.json", batch))
    for mid, row in entries:
        for ordinal, _ in enumerate(row.get("attachments", []), 1):
            db.execute("INSERT INTO originals(message,ordinal,batch,error) VALUES (?,?,?,?)",
                       (mid, ordinal, batch, "카카오톡 파일 저장 대기"))


def verified_sender(row):
    if row.get("sender"):
        return row["sender"]
    parts = row.get("axParts", [])
    # Kakao's sender label immediately follows the profile button in the same bubble.
    names = [b.get("AXValue") for a,b in zip(parts,parts[1:])
             if a.get("role") == "AXButton" and a.get("AXDescription") in ("프로필", "Profile")
             and b.get("role") == "AXStaticText" and b.get("AXValue") != row.get("timeText")]
    return names[0] if len(names) == 1 else None


def manifest(store, batch):
    info = store.batch(batch)
    room = store.db.execute("SELECT name FROM rooms WHERE id=?", (info["room"],)).fetchone()[0]
    messages = []
    for mid in decode(info["fresh"]):
        m = store.db.execute("SELECT * FROM messages WHERE id=?", (mid,)).fetchone()
        row = decode(m["row_json"])
        attachments = [dict(attachment_id=f"{mid}-{a['ordinal']}", ordinal=a["ordinal"],
                            path=a["path"], sha256=a["sha256"], bytes=a["size"], width=a["width"],
                            height=a["height"], status="확보" if a["path"] else "사진 확보 대기",
                            reason=a["error"]) for a in store.db.execute(
                                "SELECT * FROM originals WHERE message=? ORDER BY ordinal", (mid,))]
        messages.append(dict(room_id=m["room"], room_name=room, message_id=mid, sender_name=verified_sender(row),
                             sent_at=m["occurred"], collected_at=m["collected"], sequence=mid,
                             text=row.get("text"), attachments=attachments))
    return dict(batch_id=batch, created_at=info["created"], messages=messages)


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        tmp = Path(f.name)
        try:
            f.write(json.dumps(data, ensure_ascii=False, indent=2).encode())
            f.flush()
            os.fsync(f.fileno())
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
    os.replace(tmp, path)


def register_original(store, item, file):
    # The private request directory belongs to exactly one message and ordinal.
    if file.parent != Path(item["directory"]) or file.is_symlink() or not file.is_file():
        raise ValueError("invalid_download_path")
    measured = subprocess.run(["/usr/bin/sips", "-g", "pixelWidth", "-g", "pixelHeight", "-g", "format", str(file)],
                              text=True, capture_output=True, timeout=30, check=True)
    attrs = dict(re.findall(r"^\s*(pixelWidth|pixelHeight|format):\s*(\S+)\s*$", measured.stdout, re.M))
    width, height = int(attrs.get("pixelWidth", 0)), int(attrs.get("pixelHeight", 0))
    ext = file.suffix[1:].lower()
    if not min(width, height) > 0 or not attrs.get("format") or not re.fullmatch("[a-z0-9]{1,10}", ext):
        raise ValueError("invalid_original_image")
    with file.open("rb") as f:
        size = os.fstat(f.fileno()).st_size
        digest = hashlib.file_digest(f, "sha256").hexdigest()
    with store.db:
        previous = store.db.execute("SELECT path FROM originals WHERE sha256=? LIMIT 1", (digest,)).fetchone()
        path = previous[0] if previous else f"images/{digest}.{ext}"
        local = store.root / "outbox" / path
        local.parent.mkdir(parents=True, exist_ok=True)
        if not local.exists():
            os.link(file, local)
        store.db.execute("UPDATE originals SET path=?,sha256=?,size=?,width=?,height=?,error=NULL "
                         "WHERE message=? AND ordinal=?", (path, digest, size, width, height, item["message"], item["ordinal"]))
        store.db.execute("INSERT OR IGNORE INTO drive_outbox(path) VALUES (?)", (path,))
        invalidate(store, item["batch"])
    file.unlink()


def invalidate(store, batch):
    store.db.execute("UPDATE drive_outbox SET revision=revision+1,retry_after=0 WHERE batch=?", (batch,))


def drive_ready(root):
    cfg = configparser.RawConfigParser()
    cfg.read(root / "onedrive.conf")
    return bool(cfg.get("kakao", "drive_id", fallback="") and cfg.get("kakao", "token", fallback=""))


def deliver(store):
    for job in store.db.execute("SELECT * FROM drive_outbox WHERE batch IS NOT NULL AND local_revision<revision ORDER BY rowid LIMIT 32").fetchall():
        atomic_json(store.root / "outbox" / job["path"], manifest(store, job["batch"]))
        with store.db:
            store.db.execute("UPDATE drive_outbox SET local_revision=? WHERE path=?", (job["revision"], job["path"]))
    if not drive_ready(store.root):
        return
    # Separate worker and bounded retries keep a slow upload from stopping AX.
    for job in store.db.execute("SELECT * FROM drive_outbox WHERE revision>sent AND (batch IS NULL OR local_revision=revision) AND retry_after<=? "
                                "ORDER BY attempts,rowid LIMIT 8", (time.time(),)).fetchall():
        local = store.root / "outbox" / job["path"]
        try:
            cmd = [str(store.root / "native/rclone"), "--config", str(store.root / "onedrive.conf"),
                   "copyto", str(local), "kakao:카톡수집/" + job["path"], "--retries", "1",
                   "--low-level-retries", "2", "--transfers", "1"]
            if job["batch"]:
                cmd.append("--ignore-times")
            else:
                cmd.append("--immutable")
            result = subprocess.run(cmd, capture_output=True, timeout=240)
            if result.returncode:
                raise ValueError(f"onedrive_exit_{result.returncode}")
            with store.db:
                store.db.execute("UPDATE drive_outbox SET sent=?,attempts=0,error=NULL,uploaded_at=? WHERE path=?",
                                 (job["revision"], now(), job["path"]))
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            delay = min(3600, 20 * 2 ** min(8, job["attempts"]))
            with store.db:
                store.db.execute("UPDATE drive_outbox SET attempts=attempts+1,retry_after=?,error=? WHERE path=?",
                                 (time.time()+delay, str(exc) if isinstance(exc, ValueError) else type(exc).__name__, job["path"]))
