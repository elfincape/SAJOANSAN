"""Restore audited JEV sources. Run uv sync --project .agent-tools/jev afterwards."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request

root = Path(__file__).resolve().parent
for item in json.loads((root / 'sources-lock.json').read_text()):
    url = f"https://codeload.github.com/{item['repository']}/tar.gz/{item['revision']}"
    data = urllib.request.urlopen(url, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != item['sha256']:
        raise ValueError(f"Archive checksum mismatch: {item['name']}")
    dest = root / 'sources' / item['name']
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive.getmembers():
            parts = PurePosixPath(member.name).parts[1:]
            if not parts:
                continue
            if '..' in parts or member.issym() or member.islnk():
                raise ValueError('Unsafe archive entry')
            target = dest.joinpath(*parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(member).read())
                target.chmod(member.mode & 0o777)
    print(f"Restored {item['name']} at {item['revision']}")
