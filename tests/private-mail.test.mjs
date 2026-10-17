import assert from 'node:assert/strict';
import {
  handlePrivateMail,
  safeMailHtml,
  mailFilename,
} from '../supabase/functions/onedrive-auth/private-mail.js';
import {
  makeHandler,
  fail,
  hash,
} from '../supabase/functions/onedrive-auth/handler.js';
const owner = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002',
  id = '00000000-0000-4000-8000-000000000003',
  lease = '00000000-0000-4000-8000-000000000004';
const box = {
  id,
  owner_id: owner,
  enabled: true,
  drive_id: 'drive',
  folder_id: 'private',
  lease,
  lease_until: new Date(Date.now() + 600000).toISOString(),
  cutoff_at: '2026-09-01T00:00:00Z',
};
const original = new TextEncoder().encode(
  'Date: Sat, 17 Oct 2026 01:00:00 +0000\r\nSubject: sample\r\n\r\nhello\r\n',
);
const fingerprint = Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', original)),
  (v) => v.toString(16).padStart(2, '0'),
).join('');
const m = {
  uidl: 'a'.repeat(64),
  hash: fingerprint,
  subject: 'sample',
  sender: 'sender@example.test',
  sent: '2026-10-17T01:00:00Z',
  files: [
    {
      kind: 'eml',
      name: 'original.eml',
      data: Buffer.from(original).toString('base64'),
    },
    {
      kind: 'html',
      name: 'html',
      data: Buffer.from(
        '<p>Hi</p><img src="https://tracker.test"><script>alert(1)</script>',
      ).toString('base64'),
    },
    {
      kind: 'attachment',
      name: '../../evil.exe',
      data: Buffer.from('MZ').toString('base64'),
    },
  ],
};
const json = (b) =>
    new Response(JSON.stringify(b), {
      headers: { 'Cache-Control': 'no-store' },
    }),
  items = new Map();
let row = null,
  failPublish = true,
  puts = 0,
  reads = 0,
  corrupt = false,
  shared = false,
  sharedItem = false;
async function db(path, opts = {}) {
  if (path.startsWith('onedrive_locks?')) return [{ holder: lease }];
  if (path.startsWith('private_mailboxes?'))
    return opts.token === 'other' ? [] : [structuredClone(box)];
  if (path.startsWith('private_mail_messages?'))
    return row && opts.token !== 'other' ? [structuredClone(row)] : [];
  if (path === 'rpc/private_mail_publish') {
    if (failPublish) throw fail('DB unavailable', 502);
    row = {
      id,
      mailbox_id: id,
      owner_id: owner,
      subject: m.subject,
      sender: m.sender,
      sent_at: m.sent,
      files: opts.body.p_files,
    };
    return id;
  }
  throw Error('Unexpected DB ' + path);
}
async function graph(path, access, opts = {}) {
  assert.equal(access, 'access');
  if (path.startsWith('/me/drive'))
    return json({ id: 'drive', owner: { user: { id: 'drive-owner' } } });
  if (path.endsWith('/permissions'))
    return json({
      value:
        shared || (sharedItem && !path.includes('/items/private/'))
          ? [{ link: { scope: 'anonymous' } }]
          : [],
    });
  if (path.startsWith('/drives/drive/items/private?'))
    return json({ id: 'private', folder: {} });
  if (path.includes('/content') && opts.method !== 'PUT') {
    reads++;
    const item = [...items.values()].find((i) =>
      path.includes('/items/' + i.id + '/'),
    );
    return new Response(corrupt ? new Uint8Array([1]) : item.bytes);
  }
  if (path.includes('private:/')) {
    const name = decodeURIComponent(path.split('private:/')[1].split(':/')[0]);
    if (opts.method === 'PUT') {
      assert.ok(!items.has(name));
      puts++;
      const item = {
        id: 'item' + puts,
        name,
        size: opts.body.length,
        file: {},
        parentReference: { id: 'private', driveId: 'drive' },
        bytes: opts.body,
      };
      items.set(name, item);
      return json(item);
    }
    return items.has(name) ? json(items.get(name)) : null;
  }
  const item = [...items.values()].find((i) => path.endsWith('/items/' + i.id));
  if (item) return json(item);
  throw Error('Unexpected Graph ' + path);
}
const ctx = {
  collectorMailboxId: id,
  db,
  graph,
  connected: async () => ({ accessToken: 'access' }),
  settings: async () => ({ expected_drive_id: 'drive' }),
  withLock: (f) => f(lease),
  json,
  fail,
  hash,
  fetcher: () => {
    throw Error('unexpected fetch');
  },
};
const request = (body) =>
  new Request('https://example.test/private-mail-sync', {
    method: 'POST',
    body: JSON.stringify(body),
  });
const ingest = () =>
  handlePrivateMail(
    'private-mail-sync',
    request({ operation: 'ingest', mailbox: id, lease, message: m }),
    {},
    ctx,
  );
await assert.rejects(ingest, /DB unavailable/);
assert.equal(row, null);
assert.equal(puts, 3);
assert.equal(reads, 3);
failPublish = false;
await ingest();
assert.equal(puts, 3);
assert.equal(reads, 6);
assert.equal(row.files.length, 3);
await ingest();
assert.equal(puts, 3);
assert.equal(reads, 6, 'published UIDL skips storage');
const user = { id: owner, token: 'owner' },
  outsider = { id: other, token: 'other' };
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-download',
      request({ id, index: 0 }),
      outsider,
      ctx,
    ),
  (e) => e.status === 403,
);
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-detail',
      request({ id }),
      { id: other, token: 'owner' },
      ctx,
    ),
  (e) => e.status === 403,
  'explicit UUID check even if mock RLS errs',
);
const res = await handlePrivateMail(
    'private-mail-download',
    request({ id, index: 1 }),
    user,
    ctx,
  ),
  html = await res.text();
assert.ok(!/<(?:img|script|iframe|style|svg|form)\b/i.test(html));
assert.ok(!/\son\w+=/i.test(html));
assert.equal(res.headers.get('cache-control'), 'no-store');
assert.match(res.headers.get('content-security-policy'), /sandbox/);
assert.equal(mailFilename('../../evil.exe'), 'evil.exe.download');
assert.equal(mailFilename('bill.pdf'), 'bill.pdf');
corrupt = true;
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-download',
      request({ id, index: 0 }),
      user,
      ctx,
    ),
  (e) => e.status === 409,
);
corrupt = false;
shared = true;
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-download',
      request({ id, index: 0 }),
      user,
      ctx,
    ),
  (e) => e.status === 409,
);
shared = false;
sharedItem = true;
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-download',
      request({ id, index: 0 }),
      user,
      ctx,
    ),
  (e) => e.status === 409,
);
sharedItem = false;
const publishedRow = row;
row = null;
sharedItem = true;
await assert.rejects(ingest, (e) => e.status === 409);
assert.equal(row, null);
assert.equal(puts, 3);
sharedItem = false;
row = publishedRow;
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-sync',
      request({ operation: 'begin', mailbox: other }),
      {},
      ctx,
    ),
  (e) => e.status === 403,
);
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-sync',
      request({ operation: 'begin', mailbox: id }),
      {},
      { ...ctx, collectorMailboxId: undefined },
    ),
  (e) => e.status === 503,
);
box.lease_until = '2000-01-01';
await assert.rejects(ingest, (e) => e.status === 409);
box.lease_until = new Date(Date.now() + 600000).toISOString();
const safe = safeMailHtml(
  '<svg/onload=alert(1)><p style="background:url(https://tracker)">ok</p><a href="javascript:alert(1)">x</a>',
);
assert.ok(!/<svg|<a\b|\sstyle=/i.test(safe));
assert.match(safe, /<p>ok<\/p>/);
let authCalls = 0;
const handler = makeHandler(
  {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'server',
    SUPABASE_ANON_KEY: 'anon',
  },
  async () => {
    authCalls++;
    throw Error('must not fetch');
  },
);
assert.equal(
  (
    await handler(
      new Request(
        'https://db.test/functions/v1/onedrive-auth/private-mail-sync',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer invalid' },
          body: '{}',
        },
      ),
    )
  ).status,
  403,
);
assert.equal(authCalls, 0);
console.log(
  'PASS private mail: partial publish recovery, immutable verified files, UIDL duplicates, lease expiry, UUID denial, corrupt content, safe HTML/filenames, disabled collector authentication',
);
