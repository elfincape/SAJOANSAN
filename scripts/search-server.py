"""Authenticated attachment search; originals and permissions stay in Supabase."""
import json
import os
import re
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

SUPABASE = os.environ['SUPABASE_URL'].rstrip('/')
PUBLIC_KEY = os.environ['SUPABASE_ANON_KEY']
ORIGIN = os.environ.get('WEB_ORIGIN', 'https://sajoansan.vercel.app')
ENGINE = 'http://127.0.0.1:19200'
KEY_FILE = Path('/var/lib/sajo-search/data/admin.key')
INDEX = 'sajo-attachments'
UUID = re.compile(r'^[0-9a-f-]{36}$')
lock = threading.Lock()
context = threading.local()
retry_after = {}


def request(url, body=None, headers=None, method=None, binary=False):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        'Content-Type': 'application/json', **(headers or {})}, method=method)
    remaining = getattr(context, 'deadline', time.monotonic() + 15) - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('Search deadline exceeded')
    with urllib.request.urlopen(req, timeout=min(15, remaining)) as response:
        raw = response.read(10 * 1024 * 1024 + 1)
        if len(raw) > 10 * 1024 * 1024:
            raise ValueError('File exceeds size limit')
        return raw if binary else json.loads(raw)


def database(path, token, body=None):
    return request(SUPABASE + '/rest/v1/' + path, body, {
        'apikey': PUBLIC_KEY, 'Authorization': token})


def engine(path, body=None, method=None):
    return request(ENGINE + path, body, {
        'Authorization': 'ApiKey ' + KEY_FILE.read_text().strip()}, method)


def text_content(raw, mime):
    if mime in ('text/plain', 'text/csv'):
        return raw.decode('utf-8-sig', errors='replace')[:200000]
    if mime == 'application/pdf':
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.pdf'
            source.write_bytes(raw)
            result = subprocess.run(['pdftotext', '-f', '1', '-l', '100',
                                     str(source), '-'], capture_output=True,
                                    timeout=12, check=True)
            return result.stdout.decode('utf-8', errors='replace')[:200000]
    return ''


def accessible(row, token):
    for kind, table in [('task', 'operations_tasks'),
                        ('incident', 'operations_incidents'),
                        ('survey', 'operations_surveys')]:
        subject = row.get(kind + '_id')
        if subject and UUID.fullmatch(subject):
            query = table + '?select=id&id=eq.' + subject
            if kind != 'survey':
                query += '&deleted_at=is.null'
            records = database(query, token)
            return bool(records)
    return False


def authorized_rows(rows, token):
    visible = set()
    for kind, table in [('task', 'operations_tasks'), ('incident', 'operations_incidents'),
                        ('survey', 'operations_surveys')]:
        ids = sorted({row.get(kind + '_id') for row in rows
                      if UUID.fullmatch(row.get(kind + '_id') or '')})
        for start in range(0, len(ids), 100):
            query = table + '?select=id&id=in.(' + ','.join(ids[start:start + 100]) + ')'
            if kind != 'survey':
                query += '&deleted_at=is.null'
            for record in database(query, token):
                visible.add((kind, record['id']))
    return [row for row in rows if any((kind, row.get(kind + '_id')) in visible
                                     for kind in ('task', 'incident', 'survey'))]


def search(body, token):
    term = str(body.get('query', '')).strip()
    center = body.get('center') or None
    page = body.get('page', 0)
    if not 2 <= len(term) <= 100 or not isinstance(page, int) or not 0 <= page <= 100:
        raise ValueError('검색어와 페이지를 확인해 주세요.')
    if center is not None and not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', str(center)):
        raise ValueError('센터를 확인해 주세요.')
    # The existing RPC enforces active account and search permission first.
    database('rpc/operations_search', token,
             {'p_query': term, 'p_center': center, 'p_page': page})
    columns = 'id,file_name,mime_type,verified_at,task_id,incident_id,survey_id,center_code'
    rows = []
    for offset in range(0, 5001, 200):
        path = 'operations_files?select=' + columns + '&status=eq.saved&order=id&limit=200&offset=' + str(offset)
        if center:
            path += '&center_code=eq.' + urllib.parse.quote(center)
        batch = database(path, token)
        rows.extend(batch)
        if len(rows) > 5000:
            raise ValueError('첨부가 많습니다. 센터를 선택해 검색해 주세요.')
        if len(batch) < 200:
            break
    rows = authorized_rows([row for row in rows if row['mime_type'] in
            ('text/plain', 'text/csv', 'application/pdf')], token)
    try:
        cached = engine('/' + INDEX + '/_search', {
            '_source': ['revision'], 'size': 5000,
            'query': {'ids': {'values': [row['id'] for row in rows]}}}) if rows else {}
        revisions = {hit['_id']: hit.get('_source', {}).get('revision')
                     for hit in cached.get('hits', {}).get('hits', [])}
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        revisions = {}
    indexed = 0
    attempted = 0
    pending = 0
    # Only a few originals are extracted per request on the 1GB server.
    for row in rows:
        fresh = revisions.get(row['id']) == row['verified_at']
        if fresh:
            continue
        pending += 1
        if (attempted >= 2 or time.monotonic() + 28 >= context.deadline
                or retry_after.get(row['id'], 0) > time.monotonic()):
            continue
        attempted += 1
        try:
            raw = request(SUPABASE + '/functions/v1/onedrive-auth/operations-download',
                          {'fileId': row['id']}, {'apikey': PUBLIC_KEY,
                          'Authorization': token}, binary=True)
            text = text_content(raw, row['mime_type'])
            engine('/' + INDEX + '/_doc/' + row['id'],
                   {'body': text, 'revision': row['verified_at']}, method='PUT')
            indexed += 1
            pending -= 1
        except (urllib.error.URLError, ValueError, subprocess.SubprocessError):
            retry_after[row['id']] = time.monotonic() + 300
            continue
    # Candidate IDs are not exposed. Every result is rechecked against its live
    # attachment metadata and parent RLS before any content is returned.
    live = {row['id']: row for row in rows}
    matches = []
    offset = 0
    while live:
        try:
            result = engine('/' + INDEX + '/_search', {
                'query': {'bool': {'must': [{'match_phrase': {'body': term}}],
                                   'filter': [{'ids': {'values': list(live)}}]}},
                'sort': ['_doc'], 'from': offset, 'size': 8})
        except urllib.error.HTTPError as error:
            if error.code == 404:
                break
            raise
        hits = result.get('hits', {}).get('hits', [])
        for hit in hits:
            row = live.get(hit['_id'])
            source = hit.get('_source', {})
            if not row or source.get('revision') != row['verified_at'] or not accessible(row, token):
                continue
            text = source.get('body', '')
            position = text.casefold().find(term.casefold())
            start = max(0, position - 70)
            matches.append({**row, 'title': row['file_name'],
                            'excerpt': text[start:start + 240]})
        if len(hits) < 8:
            break
        offset += 8
        if offset >= 10000:
            raise ValueError('검색 결과가 많습니다. 검색어를 구체적으로 입력해 주세요.')
    matches.sort(key=lambda item: (item['title'], item['id']))
    return {'items': matches[page * 20:(page + 1) * 20], 'total': len(matches),
            'pending': pending, 'indexed': indexed}


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body):
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', ORIGIN)
        self.send_header('Access-Control-Allow-Headers', 'authorization, content-type')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.reply(200, {})

    def do_GET(self):
        self.reply(200 if self.path == '/health' else 404,
                   {'ok': self.path == '/health'})

    def do_POST(self):
        token = self.headers.get('Authorization', '')
        if self.path != '/search':
            return self.reply(404, {'error': '요청 경로를 확인해 주세요.'})
        if not token.startswith('Bearer ') or len(token) > 8192:
            return self.reply(401, {'error': '로그인이 필요합니다.'})
        if not lock.acquire(blocking=False):
            return self.reply(429, {'error': '문서 검색 중입니다. 잠시 후 다시 시도해 주세요.'})
        try:
            context.deadline = time.monotonic() + 65
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096:
                raise ValueError('검색 요청을 확인해 주세요.')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError('검색 요청을 확인해 주세요.')
            self.reply(200, search(body, token))
        except (ValueError, json.JSONDecodeError):
            self.reply(400, {'error': '검색 조건을 확인해 주세요.'})
        except urllib.error.HTTPError as error:
            code = error.code if error.code in (401, 403, 429) else 502
            self.reply(code, {'error': '문서 검색 권한 또는 연결을 확인해 주세요.'})
        except Exception:
            self.reply(502, {'error': '문서 검색 서버에 연결하지 못했습니다.'})
        finally:
            lock.release()

    def log_message(self, format, *args):
        # Never log JWTs, query text or document contents.
        pass


if __name__ == '__main__':
    HTTPServer(('127.0.0.1', 19210), Handler).serve_forever()
