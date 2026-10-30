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
        assert.equal(
          opts.body,
          undefined,
          'consumer OneDrive session uses the path with no optional item metadata',
        );
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

{
  const fetchBeforeEmptyRecovery = globalThis.fetch;
  try {
    const { createHash } = await import('node:crypto');
    const { handlePrivateMail } =
      await import('../supabase/functions/onedrive-auth/private-mail.js');
    const { uploadMailFile } =
      await import('../server/private-mail-upload.mjs');
    globalThis.fetch = async () => assert.fail('Remote calls are forbidden');
    const owner = '2a828c2d-9a6f-40d4-8e13-336b591811cc',
      boxId = '00000000-0000-4000-8000-000000000003',
      lease = '00000000-0000-4000-8000-000000000004';
    const content = Buffer.alloc(3_276_801, 0x61),
      digest = createHash('sha256').update(content).digest('hex');
    const metadata = {
      mailbox: boxId,
      lease,
      uidl: 'a'.repeat(64),
      hash: 'b'.repeat(64),
      index: 0,
      kind: 'attachment',
      name: 'fixture.bin',
      byte_size: content.length,
      content_hash: digest,
    };
    const canonical = metadata.uidl + '_' + metadata.hash + '_0.bin';
    const fail = (message, status = 400) =>
      Object.assign(Error(message), { status });
    function fixture(change = {}, mode = {}) {
      const box = {
        id: boxId,
        owner_id: owner,
        enabled: true,
        drive_id: 'drive',
        folder_id: 'folder',
        lease,
        lease_until: new Date(Date.now() + 600000).toISOString(),
      };
      const old = {
        id: 'reserved-item',
        name: canonical,
        size: 0,
        file: {},
        eTag: '"original-etag"',
        parentReference: { id: 'folder', driveId: 'drive' },
        bytes: new Uint8Array(),
        ...change,
      };
      const items = new Map([[old.id, old]]),
        patches = [],
        calls = [],
        logs = [];
      let sessions = 0,
        currentNew = null,
        offset = 0;
      const ctx = {
        ownerSync: true,
        collectorMailboxId: boxId,
        fail,
        json: Response.json,
        withLock: (action) => action(lease),
        settings: async () => ({ expected_drive_id: 'drive' }),
        connected: async () => ({ accessToken: 'fixture-access' }),
        db: async (path) => {
          if (path.startsWith('private_mailboxes?')) return [{ ...box }];
          if (path.startsWith('private_mail_messages?')) return [];
          if (path.startsWith('onedrive_locks?')) return [{ holder: lease }];
          assert.fail('Unexpected mock DB operation');
        },
        graph: async (path, _access, options = {}) => {
          calls.push({ path, method: options.method ?? 'GET' });
          if (path.startsWith('/me/drive'))
            return Response.json({
              id: 'drive',
              owner: { user: { id: 'owner' } },
            });
          if (path.endsWith('/permissions'))
            return Response.json({ value: [] });
          if (path.startsWith('/drives/drive/items/folder?'))
            return Response.json({
              id: 'folder',
              folder: {},
              parentReference: { driveId: 'drive' },
            });
          if (
            path === '/drives/drive/items/' + encodeURIComponent(old.id) &&
            options.method === 'PATCH'
          ) {
            patches.push(options);
            assert.equal(options.headers['If-Match'], '"original-etag"');
            const body = JSON.parse(options.body);
            assert.equal(body['@microsoft.graph.conflictBehavior'], 'fail');
            assert.ok(
              body.name.startsWith(canonical.slice(0, -4) + '_미완료업로드_'),
            );
            assert.ok(body.name.endsWith('.bin'));
            if (mode.etagRace) throw fail('PRECONDITION_FAILED', 412);
            if (mode.renameConflict) throw fail('NAME_CONFLICT', 409);
            old.name = body.name;
            old.eTag = '"preserved-etag"';
            return Response.json({ ...old, bytes: undefined });
          }
          if (path === '/drives/drive/items/' + encodeURIComponent(old.id)) {
            if (mode.leaseRace)
              box.lease = '00000000-0000-4000-8000-000000000009';
            return Response.json({
              ...old,
              ...(mode.freshId ? { id: 'different-item' } : {}),
              ...(mode.freshEtag ? { eTag: '"changed-etag"' } : {}),
              bytes: undefined,
            });
          }
          if (path.includes(':/createUploadSession')) {
            assert.equal(
              [...items.values()].some((item) => item.name === canonical),
              false,
              'Canonical path must be free before a new session',
            );
            sessions++;
            currentNew = {
              id: 'new-session-item',
              name: canonical,
              size: 0,
              file: {},
              eTag: '"new-etag"',
              parentReference: { id: 'folder', driveId: 'drive' },
              bytes: new Uint8Array(),
            };
            items.set(currentNew.id, currentNew);
            return Response.json({
              uploadUrl: 'https://fixture.up.1drv.com/upload',
              expirationDateTime: new Date(Date.now() + 60000).toISOString(),
            });
          }
          if (path.endsWith('/content')) {
            const item = [...items.values()].find(
              (value) =>
                path ===
                '/drives/drive/items/' +
                  encodeURIComponent(value.id) +
                  '/content',
            );
            assert.ok(item);
            let at = 0;
            return new Response(
              new ReadableStream({
                pull(controller) {
                  if (at === item.bytes.length) {
                    controller.close();
                    return;
                  }
                  const end = Math.min(at + 65536, item.bytes.length);
                  controller.enqueue(item.bytes.subarray(at, end));
                  at = end;
                },
              }),
            );
          }
          if (path.startsWith('/drives/drive/items/folder:/')) {
            const name = decodeURIComponent(path.split('folder:/')[1]);
            const item =
              sessions === 0 && patches.length === 0
                ? old
                : [...items.values()].find((value) => value.name === name);
            return item ? Response.json({ ...item, bytes: undefined }) : null;
          }
          assert.fail('Unexpected mock Graph operation');
        },
      };
      const call = async (operation) => {
        const warn = console.warn;
        console.warn = (entry) => logs.push(JSON.parse(entry));
        try {
          return await handlePrivateMail(
            'private-mail-sync',
            new Request('https://fixture.test/bridge', {
              method: 'POST',
              body: JSON.stringify({ ...metadata, operation }),
            }),
            { id: owner },
            ctx,
          );
        } finally {
          console.warn = warn;
        }
      };
      const upload = () =>
        uploadMailFile({
          file: { ...metadata, bytes: content },
          begin: async () => (await call('upload-session')).json(),
          complete: async () => (await call('upload-complete')).json(),
          fetcher: async (url, options) => {
            assert.equal(url, 'https://fixture.up.1drv.com/upload');
            assert.equal(options.headers.Authorization, undefined);
            const end = offset + options.body.byteLength;
            assert.equal(
              options.headers['Content-Range'],
              `bytes ${offset}-${end - 1}/${content.length}`,
            );
            offset = end;
            if (end < content.length)
              return Response.json(
                { nextExpectedRanges: [end + '-'] },
                { status: 202 },
              );
            currentNew.bytes = content;
            currentNew.size = content.length;
            return Response.json({ id: currentNew.id }, { status: 201 });
          },
        });
      return {
        old,
        items,
        patches,
        calls,
        logs,
        call,
        upload,
        get sessions() {
          return sessions;
        },
      };
    }
    const recovered = fixture();
    const result = await recovered.upload();
    assert.equal(result.file.item_id, 'new-session-item');
    assert.equal(recovered.patches.length, 1);
    assert.equal(recovered.sessions, 1);
    assert.equal(recovered.old.id, 'reserved-item');
    assert.equal(recovered.old.size, 0);
    assert.ok(recovered.old.name.includes('_미완료업로드_'));
    assert.equal(recovered.items.get('new-session-item').name, canonical);
    assert.equal(
      createHash('sha256')
        .update(recovered.items.get('new-session-item').bytes)
        .digest('hex'),
      digest,
    );
    assert.ok(recovered.calls.every((call) => call.method !== 'DELETE'));
    for (const change of [
      { size: 1 },
      { file: undefined },
      { name: 'different.bin' },
      { parentReference: { id: 'other', driveId: 'drive' } },
      { parentReference: { id: 'folder', driveId: 'other' } },
      { remoteItem: { id: 'remote' } },
      { folder: {} },
      { eTag: undefined },
      { eTag: ' * ' },
      { eTag: '\r\n' },
      { id: '' },
    ]) {
      const test = fixture(change);
      await assert.rejects(() => test.call('upload-session'));
      assert.equal(test.patches.length, 0);
      assert.equal(test.sessions, 0);
    }
    for (const mode of [
      { freshId: true },
      { freshEtag: true },
      { leaseRace: true },
      { etagRace: true },
      { renameConflict: true },
    ]) {
      const test = fixture({}, mode);
      await assert.rejects(() => test.call('upload-session'));
      assert.equal(test.old.name, canonical);
      assert.equal(test.old.size, 0);
      assert.equal(test.sessions, 0);
      assert.equal(
        test.patches.length,
        mode.etagRace || mode.renameConflict ? 1 : 0,
      );
    }
    const completing = fixture();
    await assert.rejects(
      () => completing.call('upload-complete'),
      /FILE_HASH_REJECTED/,
    );
    assert.equal(completing.patches.length, 0);
    assert.equal(completing.sessions, 0);
    const positive = fixture({ size: content.length, bytes: content });
    assert.equal(
      (await (await positive.call('upload-session')).json()).file.item_id,
      'reserved-item',
    );
    assert.equal(positive.patches.length, 0);
    assert.equal(positive.sessions, 0);
    const wrongPositive = fixture({
      size: content.length,
      bytes: Buffer.alloc(content.length, 0x62),
    });
    await assert.rejects(
      () => wrongPositive.call('upload-session'),
      /MAIL_STREAM_HASH/,
    );
    assert.equal(wrongPositive.patches.length, 0);
    assert.equal(wrongPositive.sessions, 0);
    assert.equal(wrongPositive.old.name, canonical);
    assert.equal(wrongPositive.old.bytes[0], 0x62);
    for (const entry of [...recovered.logs, ...completing.logs]) {
      assert.equal(entry.event, 'PRIVATE_MAIL_STORED_METADATA_REJECTED');
      assert.deepEqual(
        Object.keys(entry).sort(),
        [
          'event',
          'hasfile',
          'nameMatches',
          'folderMatches',
          'driveMatches',
          'sizeZero',
          'sizeMatches',
        ].sort(),
      );
      for (const [key, value] of Object.entries(entry))
        if (key !== 'event') assert.equal(typeof value, 'boolean');
      assert.equal(JSON.stringify(entry).includes(metadata.uidl), false);
    }
    assert.ok(
      recovered.logs.some(
        (entry) => entry.sizeZero === true && entry.sizeMatches === false,
      ),
    );
    console.log(
      'PASS safe empty reservation preservation: exact metadata/ID/ETag/lease, If-Match conflict-fail rename once, chunk upload and final SHA, positive/mismatch/remote/race/complete denied, boolean-only diagnostics',
    );
  } finally {
    globalThis.fetch = fetchBeforeEmptyRecovery;
  }
}
