import assert from 'node:assert/strict';
import { packageMessage, RAW_LIMIT } from '../server/private-mail-package.mjs';
import { ownerBridge } from '../server/private-mail-owner-collect.mjs';
import { handlePrivateMail } from '../supabase/functions/onedrive-auth/private-mail.js';
import { hash } from '../supabase/functions/onedrive-auth/handler.js';
const owner = '2a828c2d-9a6f-40d4-8e13-336b591811cc',
  id = '00000000-0000-4000-8000-000000000003',
  lease = '00000000-0000-4000-8000-000000000004';
const prefix = Buffer.from(
  'Date: Sat, 17 Oct 2026 00:00:00 +0000\r\nSubject: exact limit\r\n\r\n',
);
const full = Buffer.alloc(RAW_LIMIT, 120);
prefix.copy(full);
const maxPackage = await packageMessage(full, Buffer.from('max'));
assert.equal(maxPackage.files[0].bytes.length, RAW_LIMIT);
assert.ok(maxPackage.files.every((f) => f.data === undefined));
await assert.rejects(
  () => packageMessage(Buffer.alloc(RAW_LIMIT + 1), Buffer.from('over')),
  /LIMIT_REACHED/,
);
const attachment = Buffer.alloc(7 * 1024 * 1024, 65),
  base64 = attachment
    .toString('base64')
    .match(/.{1,76}/g)
    .join('\r\n');
const raw = Buffer.from(
  'Date: Sat, 17 Oct 2026 00:00:00 +0000\r\nSubject: large attachment\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nhello\r\n--x\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=large.bin\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    base64 +
    '\r\n--x--\r\n',
);
assert.ok(raw.length <= RAW_LIMIT);
const message = await packageMessage(raw, Buffer.from('large-uidl'));
assert.equal(
  message.files.find((f) => f.kind === 'attachment').bytes.length,
  attachment.length,
);
const box = {
  id,
  owner_id: owner,
  enabled: true,
  drive_id: 'drive',
  folder_id: 'folder',
  lease,
  lease_until: new Date(Date.now() + 600000).toISOString(),
  cutoff_at: '2026-08-18T00:00:00Z',
};
const items = new Map();
let published = false,
  failPublish = true,
  puts = 0,
  maxJSON = 0,
  maxBinary = 0,
  inFlight = 0,
  maxInFlight = 0,
  shared = false,
  corrupt = false;
const json = Response.json;
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });
const ctx = {
  ownerSync: true,
  collectorMailboxId: id,
  fail,
  hash,
  json,
  withLock: (fn) => fn(lease),
  settings: async () => ({ expected_drive_id: 'drive' }),
  connected: async () => ({ accessToken: 'mock-only' }),
  fetcher: async () => {
    throw Error('unexpected direct fetch');
  },
  db: async (path, opts = {}) => {
    if (path.startsWith('onedrive_locks?')) return [{ holder: lease }];
    if (path.startsWith('private_mailboxes?')) return [{ ...box }];
    if (path === 'rpc/private_mail_begin') {
      box.lease = opts.body.p_lease;
      return [{ cutoff_at: box.cutoff_at, scan_cursor: null }];
    }
    if (path.startsWith('private_mail_messages?'))
      return published ? [{ id }] : [];
    if (path === 'rpc/private_mail_publish') {
      assert.equal(items.size, message.files.length);
      assert.equal(opts.body.p_files.length, message.files.length);
      if (failPublish) throw fail('publish unavailable', 503);
      published = true;
      return id;
    }
    throw Error('unexpected db');
  },
  graph: async (path, _access, opts = {}) => {
    if (path.startsWith('/me/drive'))
      return json({ id: 'drive', owner: { user: { id: 'drive-owner' } } });
    if (path.endsWith('/permissions'))
      return json({ value: shared ? [{ link: { scope: 'anonymous' } }] : [] });
    if (path.startsWith('/drives/drive/items/folder?'))
      return json({
        id: 'folder',
        folder: {},
        parentReference: { driveId: 'drive' },
      });
    if (path.includes('/content') && opts.method !== 'PUT') {
      const item = [...items.values()].find((i) =>
        path.includes('/items/' + i.id + '/'),
      );
      return new Response(corrupt ? new Uint8Array([1]) : item.bytes);
    }
    if (path.includes('folder:/')) {
      const name = decodeURIComponent(path.split('folder:/')[1].split(':/')[0]);
      if (opts.method === 'PUT') {
        assert.equal(published, false);
        assert.ok(!items.has(name));
        puts++;
        const item = {
          id: 'file' + puts,
          name,
          size: opts.body.length,
          file: {},
          parentReference: { id: 'folder', driveId: 'drive' },
          bytes: opts.body,
        };
        items.set(name, item);
        return json({ ...item, bytes: undefined });
      }
      return items.has(name)
        ? json({ ...items.get(name), bytes: undefined })
        : null;
    }
    throw Error('unexpected graph');
  },
};
const fetcher = async (url, opts) => {
  assert.equal(opts.headers.Authorization, 'Bearer mock-owner');
  assert.equal(opts.redirect, 'error');
  const binary = opts.headers['Content-Type'] === 'application/octet-stream';
  if (binary) {
    assert.ok(Buffer.isBuffer(opts.body));
    maxBinary = Math.max(maxBinary, opts.body.length);
  } else {
    maxJSON = Math.max(maxJSON, Buffer.byteLength(opts.body));
    assert.ok(Buffer.byteLength(opts.body) < 65536);
    assert.ok(!opts.body.includes(base64.slice(0, 100)));
  }
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    return await handlePrivateMail(
      'private-mail-sync',
      new Request(url, {
        method: 'POST',
        headers: opts.headers,
        body: opts.body,
      }),
      { id: owner },
      ctx,
    );
  } finally {
    inFlight--;
  }
};
const bridge = ownerBridge('Bearer mock-owner', fetcher);
await bridge.begin();
await assert.rejects(() => bridge.ingest(message), /publish unavailable/);
assert.equal(published, false);
assert.equal(puts, message.files.length);
failPublish = false;
await bridge.ingest(message);
assert.equal(published, true);
assert.equal(puts, message.files.length);
assert.equal(maxInFlight, 1);
assert.ok(maxBinary > 4.5 * 1024 * 1024);
assert.ok(maxJSON < 65536);
// Metadata cannot forge missing bytes, altered hashes, sharing state or lease ownership.
published = false;
corrupt = true;
await assert.rejects(() => bridge.ingest(message));
corrupt = false;
shared = true;
await assert.rejects(() => bridge.ingest(message));
shared = false;
const file = message.files[0],
  metadata = {
    operation: 'file',
    mailbox: id,
    lease,
    uidl: message.uidl,
    hash: message.hash,
    index: 0,
    kind: file.kind,
    name: file.name,
    byte_size: file.byte_size,
    content_hash: 'f'.repeat(64),
  };
await assert.rejects(() =>
  handlePrivateMail(
    'private-mail-sync',
    new Request('https://db.test/file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Mail-Metadata': encodeURIComponent(JSON.stringify(metadata)),
      },
      body: file.bytes,
    }),
    { id: owner },
    ctx,
  ),
);
box.lease_until = '2000-01-01';
await assert.rejects(() => bridge.ingest(message));
console.log(
  JSON.stringify({
    pass: '10MiB EML, 7MiB attachment, binary-only sequential files, small metadata, verify-before-publish, partial recovery, immutable retry, corruption/shared/expired lease denied',
    maxBinaryBytes: maxBinary,
    maxMetadataBytes: maxJSON,
    maxInFlight,
  }),
);
