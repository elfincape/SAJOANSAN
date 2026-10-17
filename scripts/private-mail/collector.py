"""Read-only POP3S worker. No account connection unless explicitly enabled."""
import base64
import datetime as dt
import email
import email.policy
import email.utils
import hashlib
import json
import os
import poplib
import ssl
import time
import urllib.request
import urllib.error
from pathlib import Path

LIMIT = 10 * 1024 * 1024
UTC = dt.timezone.utc


class ReadOnlyPOP(poplib.POP3_SSL):
    def _putcmd(self, line):
        if '\r' in line or '\n' in line:
            raise RuntimeError('POP command blocked')
        if line.split(' ', 1)[0].upper() not in {'USER', 'PASS', 'STAT', 'UIDL', 'LIST', 'TOP', 'RETR', 'QUIT'}:
            raise RuntimeError('POP command blocked')
        return super()._putcmd(line)

    def _getlongresp(self):
        # Enforce the bound during reception even if LIST lies.
        response = self._getresp()
        lines, total = [], 0
        while True:
            line, size = self._getline()
            if line == b'.':
                break
            if line.startswith(b'..'):
                line = line[1:]
            total += size
            if total > LIMIT:
                raise RuntimeError('LIMIT_REACHED')
            lines.append(line)
        return response, lines, total


def digest(value):
    return hashlib.sha256(value).hexdigest()


def clean_name(value):
    value = ''.join(c if c.isalnum() or c in ' ._-()' else '_' for c in str(value or 'attachment'))
    value = value.strip(' .')[:120] or 'attachment'
    return value


def message_date(raw):
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    try:
        value = email.utils.parsedate_to_datetime(str(msg.get('Date', '')))
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    except (ValueError, TypeError, OverflowError):
        return None


def package(raw, uidl):
    if len(raw) > LIMIT:
        raise ValueError('LIMIT_REACHED')
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    files = [{'kind': 'eml', 'name': 'original.eml', 'data': base64.b64encode(raw).decode()}]
    def parts(part):
        if part.is_multipart() and not (part.get_filename() or part.get_content_disposition() == 'attachment' or part.get_content_type() == 'message/rfc822'):
            for child in part.iter_parts():
                yield from parts(child)
        else:
            yield part

    for part in parts(msg):
        if part.is_multipart():
            data = (part.get_payload(0) if part.get_content_type() == 'message/rfc822' else part).as_bytes(policy=email.policy.SMTP)
        else:
            data = part.get_payload(decode=True) or b''
        kind = 'attachment'
        if not part.is_multipart() and not part.get_filename() and part.get_content_disposition() != 'attachment':
            kind = {'text/plain': 'text', 'text/html': 'html'}.get(part.get_content_type(), 'attachment')
        if kind in ('text', 'html'):
            charset = part.get_content_charset() or 'utf-8'
            try:
                data = data.decode(charset, errors='replace').encode('utf-8')
            except LookupError:
                data = data.decode('utf-8', errors='replace').encode('utf-8')
        if not data:
            continue
        files.append({'kind': kind, 'name': clean_name(part.get_filename() or kind), 'data': base64.b64encode(data).decode()})
        if len(files) > 50:
            raise ValueError('LIMIT_REACHED')
    if sum(len(base64.b64decode(f['data'])) for f in files) > 2 * LIMIT:
        raise ValueError('LIMIT_REACHED')
    date = message_date(raw)
    if date is None:
        raise ValueError('MISSING_DATE')
    return {'uidl': digest(uidl), 'hash': digest(raw), 'subject': str(msg.get('Subject', ''))[:500],
            'sender': str(msg.get('From', ''))[:500], 'sent': date.isoformat(), 'files': files}


class Bridge:
    def __init__(self, endpoint, secret, mailbox):
        from urllib.parse import urlparse
        parsed = urlparse(endpoint)
        if parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.supabase.co') or parsed.port not in (None,443) or parsed.path != '/functions/v1/onedrive-auth/private-mail-sync' or parsed.username or parsed.query or parsed.fragment:
            raise ValueError('Invalid endpoint')
        self.endpoint, self.secret, self.mailbox = endpoint, secret, mailbox
        self.lease = None

    def call(self, operation, **values):
        payload = json.dumps({'operation': operation, 'mailbox': self.mailbox, 'lease': self.lease, **values}).encode()
        for attempt in range(3):
            try:
                req = urllib.request.Request(self.endpoint, data=payload, headers={
                    'Authorization': 'Bearer ' + self.secret, 'Content-Type': 'application/json'})
                # Never follow a redirect with the collector credential.
                class NoRedirect(urllib.request.HTTPRedirectHandler):
                    def redirect_request(self, *args, **kwargs):
                        return None
                with urllib.request.build_opener(NoRedirect).open(req, timeout=90) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if error.code not in (429, 502, 503, 504) or attempt == 2:
                    raise RuntimeError('SYNC_FAILED') from None
            except (OSError, TimeoutError):
                if attempt == 2:
                    raise RuntimeError('SYNC_FAILED') from None
            time.sleep(2 ** attempt)


def sync(pop, bridge, cutoff, batch=20, seconds=240, cursor=None):
    start, counts = time.monotonic(), dict(saved=0, skipped=0, undated=0, oversized=0, deferred=0, cursor=None)
    entries = pop.uidl()[1]
    if len(entries) > 100000:
        raise RuntimeError('LIMIT_REACHED')
    sizes = {int(x.split()[0]): int(x.split()[1]) for x in pop.list()[1]}
    seen_numbers, seen_uidls = set(), set()
    for entry in entries:
        number, uidl = entry.split()
        number = int(number)
        if number in seen_numbers or uidl in seen_uidls or not uidl or len(uidl) > 70:
            raise RuntimeError('SYNC_FAILED')
        seen_numbers.add(number)
        seen_uidls.add(uidl)
    # Full UIDL scan with bounded work; no assumption that sequence numbers encode dates.
    ordered = list(reversed(entries))
    if cursor:
        for index, entry in enumerate(ordered):
            if digest(entry.split()[1]) == cursor:
                ordered = ordered[index+1:] + ordered[:index+1]
                break
    for position, entry in enumerate(ordered):
        if time.monotonic() - start > seconds or counts['saved'] >= batch:
            counts['deferred'] = len(entries) - position
            break
        number, uidl = entry.split()
        number = int(number)
        counts['cursor'] = digest(uidl)
        if bridge.call('seen', uidl=digest(uidl))['seen']:
            continue
        if sizes.get(number, LIMIT + 1) > LIMIT:
            counts['oversized'] += 1
            continue
        try:
            header = b'\r\n'.join(pop.top(number, 0)[1])
        except poplib.error_proto:
            header = None  # TOP is optional; bounded RETR fallback.
        date = message_date(header) if header is not None else None
        if header is not None and date is not None and date < cutoff:
            counts['skipped'] += 1
            continue
        raw = b'\r\n'.join(pop.retr(number)[1]) + b'\r\n'
        date = message_date(raw)
        if date is None:
            counts['undated'] += 1
            continue
        if date < cutoff:
            counts['skipped'] += 1
            continue
        bridge.call('ingest', message=package(raw, uidl))
        counts['saved'] += 1
    else:
        counts['cursor'] = None
    return counts


def main():
    if os.environ.get('MAIL_IMPORT_APPROVED') != 'yes':
        raise SystemExit('disabled: explicit range and activation approval required')
    # Linux advisory lock survives process crashes without a stale lock file.
    import fcntl
    lock = Path(os.environ.get('MAIL_LOCK', '/var/lib/sajo-mail/collector.lock'))
    with lock.open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        bridge = Bridge(os.environ['MAIL_BRIDGE_URL'], os.environ['MAIL_COLLECTOR_KEY'], os.environ['MAILBOX_ID'])
        info = bridge.call('begin')
        bridge.lease = info['lease']
        error, pop, counts = None, None, {}
        try:
            pop = ReadOnlyPOP('mail.onnet21.com', 995, context=ssl.create_default_context(), timeout=30)
            pop.user('jhs96@eangroup.kr')
            credential_dir = os.environ.get('CREDENTIALS_DIRECTORY')
            password = (Path(credential_dir) / 'pop-password').read_text().rstrip('\r\n') if credential_dir else os.environ['MAIL_POP_PASSWORD']
            pop.pass_(password)
            counts = sync(pop, bridge, dt.datetime.fromisoformat(info['cutoff']), batch=20, cursor=info.get('cursor'))
            print(json.dumps({k:v for k,v in counts.items() if k != 'cursor'}))  # Counts only.
        except Exception:
            error = 'SYNC_FAILED'
        finally:
            if pop is not None:
                try:
                    pop.quit()
                except Exception:
                    pop.close()
            bridge.call('end', error=error, counts={k:v for k,v in counts.items() if k != 'cursor'}, cursor=counts.get('cursor',info.get('cursor')))
        if error:
            raise SystemExit(error)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('SYNC_FAILED') from None
