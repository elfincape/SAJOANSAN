import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { packageMessage, RAW_LIMIT } from '../server/private-mail-package.mjs';
import { MAIL_UPLOAD_CHUNK_BYTES } from '../server/private-mail-upload.mjs';
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
assert.equal(RAW_LIMIT, 50_000_000);
assert.equal(maxPackage.files[0].bytes, full);
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
const sessions = new Map(),
  verifiedReads = new Set();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(maxPackage.hash, sha(full));
let published = false,
  failPublish = true,
  puts = 0,
  maxJSON = 0,
  maxBinary = 0,
  maxSessionChunk = 0,
  sessionPuts = 0,
  loseFinalResponse = true,
  lostFinalResponses = 0,
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
      assert.equal(verifiedReads.size, message.files.length);
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
      assert.ok(item, 'Only committed Graph items may be read');
      const bytes = item.bytes;
      let offset = 0;
      const response = new Response(
        new ReadableStream({
          pull(controller) {
            if (offset === bytes.length) {
              verifiedReads.add(item.name);
              controller.close();
              return;
            }
            const end = Math.min(offset + 65536, bytes.length);
            let chunk = bytes.subarray(offset, end);
            if (corrupt && offset === 0) {
              chunk = Buffer.from(chunk);
              chunk[0] ^= 1;
            }
            controller.enqueue(chunk);
            offset = end;
          },
        }),
      );
      if (item.size > MAIL_UPLOAD_CHUNK_BYTES)
        response.arrayBuffer = async () =>
          assert.fail('Large content verification must stream');
      return response;
    }
    if (path.includes('folder:/')) {
      const name = decodeURIComponent(path.split('folder:/')[1].split(':/')[0]);
      if (opts.method === 'POST' && path.endsWith(':/createUploadSession')) {
        assert.equal(published, false);
        assert.equal(items.has(name), false);
        const body = JSON.parse(opts.body);
        assert.equal(body.item.name, name);
        assert.equal(body.item['@microsoft.graph.conflictBehavior'], 'fail');
        const index = Number(/_(\d+)\.bin$/.exec(name)?.[1]);
        assert.ok(Number.isInteger(index));
        const url =
          'https://tenant.up.1drv.com/upload/session-' + sessions.size;
        sessions.set(url, { name, index, offset: 0, chunks: [] });
        return json({
          uploadUrl: url,
          expirationDateTime: new Date(Date.now() + 60000).toISOString(),
        });
      }
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
  assert.equal(opts.redirect, 'error');
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    if (new URL(url).hostname === 'tenant.up.1drv.com') {
      const session = sessions.get(url);
      assert.ok(session, 'Only scoped session capabilities may receive chunks');
      assert.equal(opts.method, 'PUT');
      assert.equal(opts.credentials, 'omit');
      assert.equal(
        Object.keys(opts.headers).some(
          (key) => key.toLowerCase() === 'authorization',
        ),
        false,
      );
      assert.ok(opts.body instanceof Uint8Array);
      const file = message.files[session.index];
      const end = Math.min(
        session.offset + MAIL_UPLOAD_CHUNK_BYTES,
        file.byte_size,
      );
      assert.equal(
        opts.headers['Content-Range'],
        `bytes ${session.offset}-${end - 1}/${file.byte_size}`,
      );
      assert.equal(
        Number(opts.headers['Content-Length']),
        end - session.offset,
      );
      assert.equal(opts.body.byteLength, end - session.offset);
      assert.deepEqual(opts.body, file.bytes.subarray(session.offset, end));
      assert.equal(
        items.has(session.name),
        false,
        'Partial uploads cannot become stored files',
      );
      assert.equal(published, false);
      maxSessionChunk = Math.max(maxSessionChunk, opts.body.byteLength);
      sessionPuts++;
      session.chunks.push(Buffer.from(opts.body));
      session.offset = end;
      if (end < file.byte_size) {
        assert.equal(opts.body.byteLength % (320 * 1024), 0);
        return json({ nextExpectedRanges: [end + '-'] }, { status: 202 });
      }
      puts++;
      const item = {
        id: 'file' + puts,
        name: session.name,
        size: file.byte_size,
        file: {},
        parentReference: { id: 'folder', driveId: 'drive' },
        bytes: Buffer.concat(session.chunks, file.byte_size),
      };
      assert.equal(sha(item.bytes), file.content_hash);
      items.set(session.name, item);
      if (loseFinalResponse) {
        loseFinalResponse = false;
        lostFinalResponses++;
        throw Error('mock final upload acknowledgement lost');
      }
      return json({ id: item.id }, { status: 201 });
    }
    assert.match(url, /\/private-mail-owner-(?:sync|file)$/);
    assert.equal(opts.headers.Authorization, 'Bearer mock-owner');
    const binary = opts.headers['Content-Type'] === 'application/octet-stream';
    if (binary) {
      assert.ok(Buffer.isBuffer(opts.body));
      maxBinary = Math.max(maxBinary, opts.body.length);
      assert.ok(opts.body.length <= MAIL_UPLOAD_CHUNK_BYTES);
    } else {
      maxJSON = Math.max(maxJSON, Buffer.byteLength(opts.body));
      assert.ok(Buffer.byteLength(opts.body) < 65536);
      assert.ok(!opts.body.includes(base64.slice(0, 100)));
    }
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
assert.equal(sessions.size, 2);
assert.equal(
  lostFinalResponses,
  1,
  'A lost final response must recover through Edge verification',
);
assert.ok(sessionPuts > sessions.size);
const completedSessionPuts = sessionPuts;
for (const [index, file] of message.files.entries()) {
  const item = items.get(`${message.uidl}_${message.hash}_${index}.bin`);
  assert.ok(item);
  assert.equal(sha(item.bytes), file.content_hash);
  assert.deepEqual(Buffer.from(item.bytes), file.bytes);
}
assert.equal(sha(raw), message.hash);
assert.equal(
  message.files.find((file) => file.kind === 'attachment').content_hash,
  sha(attachment),
);
failPublish = false;
verifiedReads.clear();
await bridge.ingest(message);
assert.equal(published, true);
assert.equal(puts, message.files.length);
assert.equal(
  sessions.size,
  2,
  'Retry must verify existing files without a new session',
);
assert.equal(
  sessionPuts,
  completedSessionPuts,
  'Retry cannot retransmit committed chunks',
);
assert.equal(maxInFlight, 1);
assert.ok(maxBinary > 0 && maxBinary <= MAIL_UPLOAD_CHUNK_BYTES);
assert.equal(maxSessionChunk, MAIL_UPLOAD_CHUNK_BYTES);
assert.ok(maxJSON < 65536);
// Metadata cannot forge missing bytes, altered hashes, sharing state or lease ownership.
published = false;
corrupt = true;
await assert.rejects(() => bridge.ingest(message), /MAIL_STREAM_HASH/);
corrupt = false;
shared = true;
await assert.rejects(() => bridge.ingest(message));
shared = false;
assert.equal(puts, message.files.length);
assert.equal(sessionPuts, completedSessionPuts);
const file = message.files.find((file) => file.kind === 'text'),
  metadata = {
    operation: 'file',
    mailbox: id,
    lease: box.lease,
    uidl: message.uidl,
    hash: message.hash,
    index: 0,
    kind: file.kind,
    name: file.name,
    byte_size: file.byte_size,
    content_hash: 'f'.repeat(64),
  };
await assert.rejects(
  () =>
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
  /FILE_HASH_REJECTED/,
);
box.lease_until = '2000-01-01';
await assert.rejects(() => bridge.ingest(message));
console.log(
  JSON.stringify({
    pass: '50MB source boundary, 7MiB attachment, serial chunked sessions, bounded Edge binary/metadata, streamed verify-before-publish, immutable retry, corruption/shared/expired lease denied',
    maxBinaryBytes: maxBinary,
    maxMetadataBytes: maxJSON,
    maxSessionChunkBytes: maxSessionChunk,
    sessionPuts,
    maxInFlight,
  }),
);

// A lease revoked while the request body is read cannot authorize later Graph writes.
box.lease_until = new Date(Date.now() + 600000).toISOString();
const validMetadata = {
  ...metadata,
  lease: box.lease,
  content_hash: file.content_hash,
};
const beforeStalePut = puts;
const staleBody = new ReadableStream({
  async pull(controller) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    box.lease = '00000000-0000-4000-8000-000000000009';
    controller.enqueue(file.bytes);
    controller.close();
  },
});
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-sync',
      new Request('https://db.test/file', {
        method: 'POST',
        duplex: 'half',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Mail-Metadata': encodeURIComponent(JSON.stringify(validMetadata)),
        },
        body: staleBody,
      }),
      { id: owner },
      ctx,
    ),
  /수집 잠금/,
);
assert.equal(puts, beforeStalePut);

box.lease = validMetadata.lease;
let lockHeld = false,
  releaseUpload,
  signalUpload,
  releases = 0;
const uploading = new Promise((resolve) => {
  signalUpload = resolve;
});
const originalGraph = ctx.graph,
  originalDB = ctx.db;
ctx.withLock = async (fn) => {
  if (lockHeld) throw fail('CONNECTION_BUSY', 409);
  lockHeld = true;
  try {
    return await fn(lease);
  } finally {
    lockHeld = false;
  }
};
ctx.db = async (path, options = {}) => {
  if (path.startsWith('private_mailboxes?') && options.method === 'PATCH') {
    releases++;
    Object.assign(box, options.body);
    return [];
  }
  return originalDB(path, options);
};
ctx.graph = async (path, access, options = {}) => {
  if (options.method === 'PUT')
    await new Promise((resolve) => {
      releaseUpload = resolve;
      signalUpload();
    });
  return originalGraph(path, access, options);
};
const small = message.files.find((f) => f.kind === 'text');
const uploadMetadata = {
  ...validMetadata,
  uidl: 'e'.repeat(64),
  index: 1,
  kind: small.kind,
  name: small.name,
  content_hash: small.content_hash,
  byte_size: small.byte_size,
};
const storageRequest = handlePrivateMail(
  'private-mail-sync',
  new Request('https://db.test/file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Mail-Metadata': encodeURIComponent(JSON.stringify(uploadMetadata)),
    },
    body: small.bytes,
  }),
  { id: owner },
  ctx,
);
await uploading;
const endRequest = () =>
  handlePrivateMail(
    'private-mail-sync',
    new Request('https://db.test/end', {
      method: 'POST',
      body: JSON.stringify({
        operation: 'end',
        mailbox: id,
        lease: box.lease,
        counts: {},
      }),
    }),
    { id: owner },
    ctx,
  );
await assert.rejects(endRequest, /CONNECTION_BUSY/);
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-sync',
      new Request('https://db.test/begin', {
        method: 'POST',
        body: JSON.stringify({ operation: 'begin', mailbox: id }),
      }),
      { id: owner },
      ctx,
    ),
  /CONNECTION_BUSY/,
);
assert.equal(releases, 0);
releaseUpload();
await storageRequest;
await endRequest();
assert.equal(releases, 1);
console.log(
  'PASS mailbox begin/end cannot race active Graph writes; revoked body-reading leases are fenced',
);
