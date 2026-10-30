import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  packageMessage,
  safeName,
  RAW_LIMIT,
} from '../server/private-mail-package.mjs';
import {
  handleOwnerCollect,
  ownerBridge,
} from '../server/private-mail-owner-collect.mjs';
const raw = Buffer.from(
  'Date: Sat, 17 Oct 2026 00:00:00 +0000\r\nFrom: Sample <sender@example.test>\r\nSubject: =?UTF-8?B?7YWM7Iqk7Yq4?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello</p><script>evil()</script><img src="https://track.test">\r\n--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="../../evil.exe"\r\nContent-Transfer-Encoding: base64\r\n\r\nTVo=\r\n--b--\r\n',
);
const packaged = await packageMessage(raw, Buffer.from('uid-1'));
const nativeTimeout = AbortSignal.timeout;
let finishAcknowledged = false;
try {
  // Scale the real 8s/30s deadlines to avoid a slow regression test.
  AbortSignal.timeout = (ms) =>
    nativeTimeout(ms === 8000 ? 8 : ms === 30000 ? 80 : ms);
  const slowFinish = ownerBridge('Bearer mock-owner', async (_url, opts) => {
    if (opts.headers['Content-Type'] === 'application/octet-stream')
      return Response.json({ file: { item_id: 'mock' } });
    const op = JSON.parse(opts.body).operation;
    if (op === 'begin')
      return Response.json({
        mailbox: '00000000-0000-4000-8000-000000000003',
        lease: '00000000-0000-4000-8000-000000000004',
        cutoff: '2026-08-18T00:00:00Z',
        cursor: null,
      });
    assert.equal(op, 'finish');
    await new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(Error('SLOW_FINISH_ABORTED'));
      };
      const timer = setTimeout(() => {
        opts.signal.removeEventListener('abort', onAbort);
        resolve();
      }, 25);
      opts.signal.addEventListener('abort', onAbort, { once: true });
      if (opts.signal.aborted) onAbort();
    });
    finishAcknowledged = true;
    return Response.json({ id: 'mock-published' });
  });
  await slowFinish.begin();
  assert.equal((await slowFinish.ingest(packaged)).id, 'mock-published');
  assert.equal(finishAcknowledged, true);
} finally {
  AbortSignal.timeout = nativeTimeout;
}
assert.equal(packaged.subject, '테스트');
assert.equal(packaged.sender, 'sender@example.test');
assert.ok(packaged.files.some((f) => f.kind === 'html'));
assert.ok(
  packaged.files.some(
    (f) => f.kind === 'attachment' && f.name.endsWith('evil.exe'),
  ),
);
assert.deepEqual(packaged.files[0].bytes, raw);
assert.ok(packaged.files.every((f) => !f.name.includes('/')));
assert.equal(safeName('CON.txt'), '_CON.txt');
await assert.rejects(
  () => packageMessage(Buffer.alloc(RAW_LIMIT + 1), Buffer.from('uid')),
  /LIMIT_REACHED/,
);
const controller = new AbortController();
controller.abort();
await assert.rejects(() =>
  packageMessage(raw, Buffer.from('uid'), { signal: controller.signal }),
);
const request = (auth = true) =>
  new Request('https://sajoansan.vercel.app/api/private-mail-collect', {
    method: 'POST',
    headers: auth
      ? {
          Authorization: 'Bearer mock-owner',
          Origin: 'https://sajoansan.vercel.app',
        }
      : {},
    body: JSON.stringify({
      host: 'evil.test',
      account: 'other',
      initial_days: 999,
    }),
  });
let calls = 0,
  connected = 0,
  closed = 0,
  saved = 0,
  failIngest = false,
  denied = false;
const operations = [];
const fetcher = async (url, options) => {
  calls++;
  assert.ok(
    url.endsWith('/private-mail-owner-sync') ||
      url.endsWith('/private-mail-owner-file'),
  );
  if (options.headers['Content-Type'] === 'application/octet-stream') {
    assert.ok(Buffer.isBuffer(options.body));
    const file = JSON.parse(
      decodeURIComponent(options.headers['X-Mail-Metadata']),
    );
    assert.equal(file.byte_size, options.body.length);
    assert.ok(!('data' in file));
    operations.push('file');
    if (denied || failIngest) return new Response('{}', { status: 403 });
    return Response.json({ file: { item_id: 'mock' } });
  }
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, 'Bearer mock-owner');
  const b = JSON.parse(options.body);
  operations.push(b.operation);
  if (denied) return new Response('{}', { status: 403 });
  if (failIngest && b.operation === 'finish')
    return new Response('{}', { status: 503 });
  if (b.operation === 'finish') {
    saved++;
    assert.equal(b.message.uidl, packaged.uidl);
  }
  return Response.json(
    b.operation === 'begin'
      ? {
          mailbox: '00000000-0000-4000-8000-000000000003',
          lease: '00000000-0000-4000-8000-000000000004',
          cutoff: '2026-08-18T00:00:00Z',
          cursor: null,
        }
      : b.operation === 'seen'
        ? { seen: false }
        : { ok: true },
  );
};
const connect = async () => {
  connected++;
  return {
    greeting: async () => {},
    login: async (account, password) => {
      assert.equal(account, 'jhs96@eangroup.kr');
      assert.equal(password, 'fake-only');
    },
    uidl: async () => [[1, 'uid-1']],
    list: async () => new Map([[1, raw.length]]),
    top: async () => raw,
    retr: async () => raw,
    close() {
      closed++;
    },
  };
};
const env = {
  MAIL_COLLECTION_ENABLED: 'yes',
  MAIL_POP_PASSWORD: 'fake-only',
  VERCEL_REGION: 'icn1',
};
assert.equal(
  (await handleOwnerCollect(request(false), { env, fetcher, connect })).status,
  401,
);
assert.equal(
  (
    await handleOwnerCollect(request(), {
      env: { ...env, MAIL_POP_PASSWORD: '' },
      fetcher,
      connect,
    })
  ).status,
  503,
);
assert.equal(
  (
    await handleOwnerCollect(request(), {
      env: { ...env, VERCEL_REGION: 'iad1' },
      fetcher,
      connect,
    })
  ).status,
  503,
);
assert.equal(calls, 0);
denied = true;
assert.equal(
  (await handleOwnerCollect(request(), { env, fetcher, connect })).status,
  503,
);
assert.equal(connected, 0);
denied = false;
const response = await handleOwnerCollect(request(), { env, fetcher, connect });
assert.equal(response.status, 200);
const result = await response.json();
assert.equal(result.counts.saved, 1);
assert.equal(saved, 1);
assert.ok(!JSON.stringify(result).includes('sender@'));
assert.ok(closed > 0);
assert.equal(operations.at(-1), 'end');
failIngest = true;
assert.equal(
  (await handleOwnerCollect(request(), { env, fetcher, connect })).status,
  503,
);
assert.equal(operations.at(-1), 'end');
console.log(
  'PASS MIME/attachments/raw preservation, package bounds, disabled/password/region guards, bridge authorization before POP, scoped bridge operations, partial failure end and cleanup',
);

const { makeHandler } =
  await import('../supabase/functions/onedrive-auth/handler.js');
const ownerId = '2a828c2d-9a6f-40d4-8e13-336b591811cc';
let authId = ownerId,
  profileActive = true,
  rpcCalls = 0;
const edgeFetch = async (url) => {
  if (url.includes('rpc/onedrive_acquire')) return Response.json(true);
  if (url.includes('onedrive_locks?'))
    return new Response(null, { status: 204 });
  if (url.endsWith('/auth/v1/user')) return Response.json({ id: authId });
  if (url.includes('user_profiles?'))
    return Response.json([
      { id: authId, role: 'viewer', active: profileActive },
    ]);
  if (url.includes('private_mailboxes?'))
    return Response.json([
      {
        id: '00000000-0000-4000-8000-000000000003',
        owner_id: ownerId,
        enabled: true,
      },
    ]);
  if (url.includes('rpc/private_mail_begin')) {
    rpcCalls++;
    return Response.json([
      { cutoff_at: '2026-08-18T00:00:00Z', scan_cursor: null },
    ]);
  }
  throw Error('Unexpected request');
};
const edgeEnv = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'public',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only',
  MAIL_OWNER_SYNC_ENABLED: 'yes',
  MAIL_OWNER_MAILBOX_ID: '00000000-0000-4000-8000-000000000003',
};
const edgeReq = () =>
  new Request(
    'https://db.test/functions/v1/onedrive-auth/private-mail-owner-sync',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer mock-owner' },
      body: '{"operation":"begin"}',
    },
  );
authId = '00000000-0000-4000-8000-000000000009';
assert.equal((await makeHandler(edgeEnv, edgeFetch)(edgeReq())).status, 403);
assert.equal(rpcCalls, 0);
authId = ownerId;
assert.equal(
  (
    await makeHandler(
      { ...edgeEnv, MAIL_OWNER_SYNC_ENABLED: 'no' },
      edgeFetch,
    )(edgeReq())
  ).status,
  403,
);
assert.equal(rpcCalls, 0);
profileActive = false;
assert.equal((await makeHandler(edgeEnv, edgeFetch)(edgeReq())).status, 403);
profileActive = true;
const begun = await makeHandler(edgeEnv, edgeFetch)(edgeReq());
assert.equal(begun.status, 200);
assert.equal((await begun.json()).mailbox, edgeEnv.MAIL_OWNER_MAILBOX_ID);
assert.equal(rpcCalls, 1);
console.log(
  'PASS Edge owner-only sync: inactive/nonowner/disabled denied, fixed mailbox and existing atomic lease begin',
);

let listCalls = 0;
const loginOnlyConnect = async () => ({
  ...(await connect()),
  uidl: async () => {
    listCalls++;
    throw Error('must not retrieve');
  },
});
const loginRequest = new Request(
  'https://sajoansan.vercel.app/api/private-mail-collect',
  {
    method: 'POST',
    headers: { Authorization: 'Bearer mock-owner' },
    body: '{"mode":"login"}',
  },
);
failIngest = false;
assert.equal(
  (
    await handleOwnerCollect(loginRequest, {
      env,
      fetcher,
      connect: loginOnlyConnect,
    })
  ).status,
  200,
);
assert.equal(listCalls, 0);
console.log('PASS explicit login-only mode sends no UIDL/RETR');

let progressChecks = 0,
  persistedCursor;
const progressResponse = await handleOwnerCollect(request(), {
  env,
  fetcher: async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.operation === 'seen')
      return ++progressChecks === 1
        ? Response.json({ seen: true })
        : new Response('{}', { status: 503 });
    if (body.operation === 'end') persistedCursor = body.cursor;
    return fetcher(url, options);
  },
  connect: async () => ({
    ...(await connect()),
    uidl: async () => [
      [1, 'unfinished'],
      [2, 'completed'],
    ],
    list: async () =>
      new Map([
        [1, 10],
        [2, 10],
      ]),
  }),
});
assert.equal(progressResponse.status, 503);
assert.equal(
  persistedCursor,
  createHash('sha256').update('completed').digest('hex'),
);
console.log(
  'PASS failed collection persists only the last completed UIDL cursor',
);

failIngest = false;
let finalizationAttempts = 0,
  receiptConnections = 0;
const retryResponse = await handleOwnerCollect(request(), {
  env,
  fetcher: async (url, options) => {
    if (
      options.headers['Content-Type'] === 'application/json' &&
      JSON.parse(options.body).operation === 'end'
    ) {
      if (++finalizationAttempts === 1)
        return new Response('{}', { status: 409 });
    }
    return fetcher(url, options);
  },
  connect: async () => {
    receiptConnections++;
    return connect();
  },
});
assert.equal(retryResponse.status, 200);
assert.equal(finalizationAttempts, 2);
assert.equal(receiptConnections, 1);
console.log(
  'PASS busy finalization retries only end, never POP login or message ingestion',
);

// Scale only external waits and the clock; run the real collection/bridge path.
const realNow = Date.now,
  realTimer = globalThis.setTimeout,
  realSignalTimeout = AbortSignal.timeout;
const clockStart = realNow();
Date.now = () => clockStart + (realNow() - clockStart) * 100;
globalThis.setTimeout = (callback, ms, ...args) =>
  realTimer(callback, Math.max(1, ms / 100), ...args);
AbortSignal.timeout = (ms) =>
  realSignalTimeout(Math.max(1, Math.ceil(ms / 100)));
try {
  for (const [label, fileCount, fileWait, finishWait, lostAcknowledgement] of [
    ['35-second attachment storage', 7, 5000, 1000],
    ['95-second receipt', 12, 7000, 11000],
    ['slow file and final verification', 2, 35000, 35000],
    ['retry after publication acknowledgement is lost', 2, 5000, 1000, true],
  ]) {
    let published = false,
      fileCalls = 0,
      publications = 0;
    const delay = (ms, signal) =>
      new Promise((resolve, reject) => {
        const done = () => {
          signal.removeEventListener('abort', abort);
          resolve();
        };
        const timer = setTimeout(done, ms);
        const abort = () => {
          clearTimeout(timer);
          reject(Error('MOCK_ABORTED'));
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    const slowFetcher = async (_url, opts) => {
      if (opts.headers['Content-Type'] === 'application/octet-stream') {
        await delay(fileWait, opts.signal);
        fileCalls++;
        return Response.json({ file: {} });
      }
      const operation = JSON.parse(opts.body).operation;
      if (operation === 'begin')
        return Response.json({
          mailbox: '00000000-0000-4000-8000-000000000003',
          lease: '00000000-0000-4000-8000-000000000004',
          cutoff: '2026-08-18T00:00:00Z',
          cursor: null,
        });
      if (operation === 'seen') return Response.json({ seen: published });
      if (operation === 'finish') {
        await delay(finishWait, opts.signal);
        published = true;
        publications++;
        if (lostAcknowledgement) return new Response('{}', { status: 503 });
        return Response.json({ id: 'published' });
      }
      assert.equal(operation, 'end');
      return Response.json({ ok: true });
    };
    const receiptOptions = {
      env,
      fetcher: slowFetcher,
      connect,
      logger: () => {},
      packager: async () => ({
        ...packaged,
        files: Array.from({ length: fileCount }, (_, i) => ({
          ...packaged.files[Math.min(i, packaged.files.length - 1)],
        })),
      }),
    };
    const first = await handleOwnerCollect(request(), receiptOptions);
    assert.equal(first.status, lostAcknowledgement ? 503 : 200, label);
    const firstResult = await first.json();
    if (!lostAcknowledgement) assert.equal(firstResult.counts.saved, 1, label);
    const repeated = await handleOwnerCollect(request(), receiptOptions);
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).counts.saved, 0);
    assert.equal(publications, 1);
    assert.equal(fileCalls, fileCount);
  }
} finally {
  Date.now = realNow;
  globalThis.setTimeout = realTimer;
  AbortSignal.timeout = realSignalTimeout;
}
console.log(
  'PASS slow multi-file receipt publishes once and retry skips published UIDL',
);

const uploadFailure = await handleOwnerCollect(request(), {
  env,
  connect,
  logger: () => {},
  fetcher: async (url, opts) =>
    opts.headers['Content-Type'] === 'application/octet-stream'
      ? new Response('{}', { status: 503 })
      : fetcher(url, opts),
});
assert.equal(uploadFailure.status, 503);
const uploadError = await uploadFailure.json();
assert.equal(uploadError.stage, 'collect');
assert.equal(uploadError.code, 'FILE_UPLOAD_FAILED');
assert.ok(!JSON.stringify(uploadError).includes('sender@'));
console.log('PASS file upload failure retains its safe error category');
