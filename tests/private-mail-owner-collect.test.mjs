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
for (const subject of ['업무\0자료', '가'.repeat(499) + '🚚배차']) {
  const original = Buffer.from(
    'Date: Sat, 17 Oct 2026 00:00:00 +0000\r\nFrom: sender@example.test\r\nSubject: =?UTF-8?B?' +
      Buffer.from(subject).toString('base64') +
      '?=\r\n\r\n원본 보존',
  );
  const result = await packageMessage(original, Buffer.from('unicode-case'));
  assert.equal(
    result.subject,
    subject.replaceAll('\0', '').slice(0, 500).toWellFormed(),
  );
  assert.equal(result.subject.isWellFormed(), true);
  assert.ok(!result.subject.includes('\0'));
  assert.equal(result.files[0].bytes, original);
  assert.equal(
    result.hash,
    createHash('sha256').update(original).digest('hex'),
  );
}
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

const { advanceCollection, startCollection } =
  await import('../supabase/functions/onedrive-auth/private-mail-collection-state.js');
let persistedCollection = null,
  bulkSeen = 0,
  continuousRequests = 0;
const collectedUids = new Set(),
  originalUids = Array.from({ length: 587 }, (_, i) => 'cycle-mail-' + i);
const continuousFetch = async (url, options) => {
  if (options.headers['Content-Type'] === 'application/octet-stream')
    return Response.json({ file: { item_id: 'mock' } });
  const body = JSON.parse(options.body);
  if (body.operation === 'begin')
    return Response.json({
      mailbox: '00000000-0000-4000-8000-000000000003',
      lease: '00000000-0000-4000-8000-000000000004',
      cutoff: '2026-09-01T00:00:00Z',
      cursor: null,
      cycle: persistedCollection,
    });
  if (body.operation === 'seen-many') {
    bulkSeen++;
    assert.ok(
      body.uidls.length <= 75,
      'REST lookup must stay under proxy URL limits',
    );
    return Response.json({
      seen: body.uidls.filter((id) => collectedUids.has(id)),
      publishedSince: body.uidls.filter((id) => collectedUids.has(id)),
    });
  }
  if (body.operation === 'start-cycle') {
    persistedCollection = startCollection(
      body.uidls,
      '00000000-0000-4000-8000-000000000090',
      '2026-10-30T08:00:00Z',
      body.requestId,
    );
    return Response.json({ cycle: persistedCollection });
  }
  if (body.operation === 'attach-cycle') {
    persistedCollection = { ...persistedCollection, requestId: body.requestId };
    return Response.json({ cycle: persistedCollection });
  }
  if (body.operation === 'seen')
    return Response.json({ seen: collectedUids.has(body.uidl) });
  if (body.operation === 'finish') {
    assert.ok(!collectedUids.has(body.message.uidl));
    collectedUids.add(body.message.uidl);
    return Response.json({ id: 'mock' });
  }
  if (body.operation === 'end') {
    persistedCollection = advanceCollection(persistedCollection, {
      ...body.counts,
      processedUidls: body.processedUidls,
    });
    return Response.json({ ok: true });
  }
  throw Error('Unexpected continuous operation ' + body.operation);
};
let lastProgress;
do {
  continuousRequests++;
  const response = await handleOwnerCollect(
    new Request('https://sajoansan.vercel.app/api/private-mail-collect', {
      method: 'POST',
      headers: { Authorization: 'Bearer mock-owner' },
      body: JSON.stringify({
        continuous: true,
        requestId: '00000000-0000-4000-8000-000000000091',
        cycleId: lastProgress?.cycleId,
      }),
    }),
    {
      env,
      fetcher: continuousFetch,
      logger: () => {},
      connect: async () => ({
        ...(await connect()),
        uidl: async () =>
          [
            ...originalUids,
            ...(continuousRequests > 1 ? ['arrived-later'] : []),
          ].map((uid, index) => [index + 1, uid]),
        list: async () =>
          new Map(
            Array.from({ length: 588 }, (_, index) => [index + 1, raw.length]),
          ),
        top: async () => raw,
        retr: async () => raw,
      }),
      packager: async (bytes, uidl) => ({
        ...packaged,
        uidl: createHash('sha256').update(uidl).digest('hex'),
      }),
    },
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  lastProgress = result.progress;
  assert.ok(lastProgress, 'continuous response must expose durable progress');
  assert.ok(result.counts.saved <= 20);
  assert.ok(!JSON.stringify(result).includes('cycle-mail-'));
  assert.equal(lastProgress.saved, collectedUids.size);
  assert.equal(persistedCollection.processed, lastProgress.processed);
  assert.ok(continuousRequests <= 30);
} while (lastProgress.remaining);
assert.equal(continuousRequests, 30);
assert.equal(collectedUids.size, 587);
assert.equal(lastProgress.phase, 'complete');
assert.ok(bulkSeen > 0);
assert.ok(
  !collectedUids.has(
    createHash('sha256').update('arrived-later').digest('hex'),
  ),
);
console.log(
  'PASS real collection handler: 587 messages/30 bounded requests, durable resume and frozen snapshot excludes later arrivals',
);
const { collectAllMail } = await import('../app/src/domain/portal-mail.ts');
let automaticCalls = 0,
  lastUiProgress;
const automaticResult = await collectAllMail({
  collect: async () => {
    automaticCalls++;
    const processed = Math.min(automaticCalls * 20, 587);
    return {
      progress: {
        cycleId: 'frozen-cycle',
        total: 587,
        processed,
        saved: processed,
        remaining: 587 - processed,
        phase: processed === 587 ? 'complete' : 'collecting',
      },
    };
  },
  onProgress: (value) => (lastUiProgress = value),
  shouldStop: () => false,
  pause: async () => {},
});
assert.equal(automaticCalls, 30);
assert.equal(automaticResult.phase, 'complete');
assert.equal(lastUiProgress.saved, 587);
let stopRequested = false,
  stopCalls = 0;
const stoppedResult = await collectAllMail({
  collect: async () => {
    stopCalls++;
    return {
      progress: {
        cycleId: 'stop-cycle',
        total: 40,
        processed: 20,
        saved: 20,
        remaining: 20,
        phase: 'collecting',
      },
    };
  },
  onProgress: () => {
    stopRequested = true;
  },
  shouldStop: () => stopRequested,
  pause: async () => {},
});
assert.equal(stopCalls, 1);
assert.equal(stoppedResult.phase, 'collecting');
let transientAttempts = 0;
await collectAllMail({
  collect: async () => {
    if (++transientAttempts === 1)
      throw Object.assign(Error('transient'), { code: 'FILE_UPLOAD_FAILED' });
    return {
      progress: {
        cycleId: 'retry-cycle',
        total: 1,
        processed: 1,
        saved: 1,
        remaining: 0,
        phase: 'complete',
      },
    };
  },
  onProgress: () => {},
  shouldStop: () => false,
  pause: async () => {},
});
assert.equal(transientAttempts, 2);
await assert.rejects(
  () =>
    collectAllMail({
      collect: async () => ({
        progress: {
          cycleId: 'invalid',
          total: 5,
          processed: 3,
          saved: 3,
          remaining: 5,
          phase: 'collecting',
        },
      }),
      onProgress: () => {},
      shouldStop: () => false,
      pause: async () => {},
    }),
  /수집 진행/,
);
console.log(
  'PASS UI coordinator: all 587 targets automatically continue, cooperative stop, bounded transient retries and invalid progress rejection',
);
const cachedFinal = await handleOwnerCollect(
  new Request('https://sajoansan.vercel.app/api/private-mail-collect', {
    method: 'POST',
    headers: { Authorization: 'Bearer mock-owner' },
    body: JSON.stringify({
      continuous: true,
      requestId: '00000000-0000-4000-8000-000000000091',
      cycleId: lastProgress.cycleId,
    }),
  }),
  {
    env,
    fetcher: continuousFetch,
    logger: () => {},
    connect: async () => {
      throw Error('must not reconnect POP after final response loss');
    },
  },
);
assert.equal(
  cachedFinal.status,
  200,
  'a lost final response must return the completed cycle without starting another snapshot',
);
assert.equal((await cachedFinal.json()).progress.cycleId, lastProgress.cycleId);
assert.equal(collectedUids.size, 587);
console.log(
  'PASS final response loss: same cycle result, no POP reconnection and no later arrivals',
);
const beforeBudgetNow = Date.now;
let initialElapsed = 0,
  afterDeadlineRetr = 0;
persistedCollection = null;
try {
  Date.now = () => beforeBudgetNow() + initialElapsed;
  const budgetResult = await handleOwnerCollect(
    new Request('https://sajoansan.vercel.app/api/private-mail-collect', {
      method: 'POST',
      headers: { Authorization: 'Bearer mock-owner' },
      body: JSON.stringify({
        continuous: true,
        requestId: '00000000-0000-4000-8000-000000000092',
      }),
    }),
    {
      env,
      logger: () => {},
      fetcher: async (url, options) =>
        JSON.parse(options.body).operation === 'end'
          ? Response.json({ ok: true })
          : continuousFetch(url, options),
      connect: async () => ({
        ...(await connect()),
        uidl: async () => {
          initialElapsed += 181000;
          return [[1, 'slow-discovery']];
        },
        retr: async () => {
          afterDeadlineRetr++;
          return raw;
        },
      }),
    },
  );
  assert.equal(budgetResult.status, 503);
  assert.equal((await budgetResult.json()).code, 'BATCH_TIMEOUT');
  assert.equal(afterDeadlineRetr, 0);
} finally {
  Date.now = beforeBudgetNow;
}
console.log(
  'PASS whole-request budget: slow discovery cannot start another 180-second collection window',
);

const { handlePrivateMailWorker } =
  await import('../server/private-mail-worker.mjs');
const workerKey = 'fixture-worker-credential-0000000000000000';
let workerCollectCalls = 0,
  workerOps = [];
const workerRequest = (kind = 'collect', auth = workerKey) =>
  new Request('https://sajoansan.vercel.app/api/private-mail-worker', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + auth },
    body: JSON.stringify({
      kind,
      mailboxId: '39045005-313e-42e1-b50c-2394b3b6ff26',
      jobId: '00000000-0000-4000-8000-000000000096',
      messageId: '00000000-0000-4000-8000-000000000097',
      day: '2026-10-30',
    }),
  });
const workerOptions = {
  env: { MAIL_COLLECTOR_KEY: workerKey },
  logger: () => {},
  fetcher: async (url, options) => {
    assert.equal(
      url,
      'https://vvrppotrnpwrwpwqaiet.supabase.co/functions/v1/onedrive-auth/private-mail-background-work',
    );
    assert.equal(options.headers.Authorization, 'Bearer ' + workerKey);
    const body = JSON.parse(options.body);
    workerOps.push(body.operation);
    if (body.operation === 'job-claim')
      return Response.json({ job: { id: body.id, cycleId: null } });
    if (body.operation === 'job-finish')
      return Response.json({ job: { status: 'queued' } });
    if (body.operation === 'analyze') return Response.json({ status: 'done' });
    if (body.operation === 'report')
      return Response.json({ status: 'updated' });
    throw Error('Unexpected worker operation');
  },
  collect: async (request, options) => {
    workerCollectCalls++;
    assert.equal(options.background, true);
    assert.equal(request.headers.get('authorization'), 'Bearer ' + workerKey);
    const payload = await request.json();
    assert.equal(payload.continuous, true);
    assert.equal(payload.requestId, '00000000-0000-4000-8000-000000000096');
    return Response.json({
      progress: {
        cycleId: '00000000-0000-4000-8000-000000000098',
        total: 40,
        processed: 20,
        saved: 20,
        remaining: 20,
        phase: 'collecting',
      },
    });
  },
};
assert.equal(
  (
    await handlePrivateMailWorker(
      workerRequest('collect', 'invalid'),
      workerOptions,
    )
  ).status,
  403,
);
assert.equal(workerCollectCalls, 0);
assert.equal(
  (await handlePrivateMailWorker(workerRequest(), workerOptions)).status,
  200,
);
assert.equal(workerCollectCalls, 1);
assert.deepEqual(workerOps, ['job-claim', 'job-finish']);
workerOps = [];
await handlePrivateMailWorker(workerRequest('analyze'), workerOptions);
assert.deepEqual(workerOps, ['analyze']);
assert.equal(workerCollectCalls, 1);
workerOps = [];
await handlePrivateMailWorker(workerRequest('report'), workerOptions);
assert.deepEqual(workerOps, ['report']);
assert.equal(workerCollectCalls, 1);
console.log(
  'PASS durable worker boundary: fixed scoped credential/mailbox, no unauthorized POP, same persisted job identity, independent AI/report requests',
);

const jobCapability = 'pmjob_' + 'a'.repeat(64),
  capabilityAuthorization = 'Bearer ' + jobCapability,
  workerMailbox = '39045005-313e-42e1-b50c-2394b3b6ff26',
  workerJob = '00000000-0000-4000-8000-000000000096',
  capabilityCycle = '00000000-0000-4000-8000-000000000101';
let capabilityPopCalls = 0;
const capabilityOps = [],
  capabilityLogs = [];
const capabilityOptions = {
  env,
  logger: (entry) => capabilityLogs.push(entry),
  fetcher: async (url, options) => {
    assert.equal(options.headers.Authorization, capabilityAuthorization);
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    capabilityOps.push(body.operation);
    if (url.endsWith('/private-mail-background-work')) {
      assert.equal(body.mailbox, workerMailbox);
      if (body.operation === 'job-claim') {
        assert.equal(
          capabilityPopCalls,
          0,
          'Edge must authorize before POP connects',
        );
        return Response.json({ job: { id: body.id, cycleId: null } });
      }
      if (body.operation === 'job-finish') {
        assert.equal(body.id, workerJob);
        assert.equal(body.progress.phase, 'complete');
        return Response.json({ job: { status: 'done' } });
      }
      if (body.operation === 'analyze') {
        assert.equal(body.id, '00000000-0000-4000-8000-000000000097');
        return Response.json({ status: 'done' });
      }
      if (body.operation === 'report') {
        assert.equal(body.day, '2026-10-30');
        return Response.json({ status: 'updated' });
      }
    }
    assert.ok(url.endsWith('/private-mail-background-sync'));
    if (body.operation === 'begin')
      return Response.json({
        mailbox: workerMailbox,
        lease: '00000000-0000-4000-8000-000000000102',
        cutoff: '2026-08-18T00:00:00Z',
        cursor: null,
      });
    if (body.operation === 'start-cycle')
      return Response.json({
        cycle: startCollection(
          body.uidls,
          capabilityCycle,
          new Date().toISOString(),
          body.requestId,
        ),
      });
    if (body.operation === 'seen-many')
      return Response.json({ seen: [], publishedSince: [] });
    if (body.operation === 'end') return Response.json({ ok: true });
    assert.fail('Unexpected capability operation');
  },
  collect: (request, options) => {
    assert.equal(request.headers.get('authorization'), capabilityAuthorization);
    assert.equal(options.background, true);
    return handleOwnerCollect(request, {
      ...options,
      connect: async () => {
        capabilityPopCalls++;
        return {
          greeting: async () => {},
          login: async () => {},
          uidl: async () => [],
          list: async () => new Map(),
          close() {},
        };
      },
    });
  },
};
assert.equal(env.MAIL_COLLECTOR_KEY, undefined);
const capabilityResult = await handlePrivateMailWorker(
  workerRequest('collect', jobCapability),
  capabilityOptions,
);
assert.equal(capabilityResult.status, 200);
assert.deepEqual(await capabilityResult.json(), { status: 'done' });
assert.equal(capabilityPopCalls, 1);
assert.deepEqual(capabilityOps, [
  'job-claim',
  'begin',
  'start-cycle',
  'seen-many',
  'end',
  'job-finish',
]);
for (const kind of ['analyze', 'report']) {
  capabilityOps.length = 0;
  assert.equal(
    (
      await handlePrivateMailWorker(
        workerRequest(kind, jobCapability),
        capabilityOptions,
      )
    ).status,
    200,
  );
  assert.deepEqual(
    capabilityOps,
    [kind],
    'Analysis/report are forwarded once for Edge validation',
  );
  assert.equal(capabilityPopCalls, 1);
}
for (const token of [
  'invalid',
  'pmjob_' + 'a'.repeat(63),
  'pmjob_' + 'g'.repeat(64),
  'pmjob_' + 'a'.repeat(65),
]) {
  const before = capabilityOps.length;
  assert.equal(
    (
      await handlePrivateMailWorker(
        workerRequest('collect', token),
        capabilityOptions,
      )
    ).status,
    403,
  );
  assert.equal(capabilityOps.length, before);
  assert.equal(capabilityPopCalls, 1);
}
for (const [label, kind, requestJob] of [
  ['expired', 'collect', workerJob],
  ['random-unissued', 'collect', workerJob],
  ['target-mismatch', 'collect', '00000000-0000-4000-8000-000000000103'],
  ['expired-analysis', 'analyze', workerJob],
  ['expired-report', 'report', workerJob],
]) {
  let deniedCalls = 0;
  const body = {
    kind,
    mailboxId: workerMailbox,
    jobId: requestJob,
    messageId: '00000000-0000-4000-8000-000000000097',
    day: '2026-10-30',
  };
  const response = await handlePrivateMailWorker(
    new Request('https://sajoansan.vercel.app/api/private-mail-worker', {
      method: 'POST',
      headers: { Authorization: capabilityAuthorization },
      body: JSON.stringify(body),
    }),
    {
      ...capabilityOptions,
      fetcher: async (_url, options) => {
        deniedCalls++;
        const forwarded = JSON.parse(options.body);
        assert.equal(
          forwarded.operation,
          kind === 'collect' ? 'job-claim' : kind,
        );
        if (kind === 'collect') assert.equal(forwarded.id, requestJob);
        assert.equal(options.headers.Authorization, capabilityAuthorization);
        return Response.json(
          { error: 'fixture-private-token-or-provider-body' },
          { status: 403 },
        );
      },
      collect: async () =>
        assert.fail('An unverified capability cannot reach collection'),
    },
  );
  assert.equal(response.status, 403, label);
  assert.deepEqual(await response.json(), { error: 'WORKER_AUTH_REQUIRED' });
  assert.equal(deniedCalls, 1);
  assert.equal(capabilityPopCalls, 1);
}
for (const claimJob of [
  { id: '00000000-0000-4000-8000-000000000104', cycleId: null },
  { id: workerJob, cycleId: 'invalid-cycle' },
]) {
  const response = await handlePrivateMailWorker(
    workerRequest('collect', jobCapability),
    {
      ...capabilityOptions,
      fetcher: async () => Response.json({ job: claimJob }),
      collect: async () =>
        assert.fail('A mismatched claim cannot reach collection'),
    },
  );
  assert.equal(response.status, 503);
  assert.equal(capabilityPopCalls, 1);
}
const expiredAfterClaim = [];
assert.equal(
  (
    await handlePrivateMailWorker(workerRequest('collect', jobCapability), {
      ...capabilityOptions,
      fetcher: async (_url, options) => {
        assert.equal(options.headers.Authorization, capabilityAuthorization);
        const body = JSON.parse(options.body);
        expiredAfterClaim.push(body.operation);
        if (body.operation === 'job-claim')
          return Response.json({ job: { id: workerJob, cycleId: null } });
        assert.ok(['begin', 'job-finish'].includes(body.operation));
        return Response.json(
          { error: 'fixture-expired-capability' },
          { status: 403 },
        );
      },
    })
  ).status,
  403,
);
assert.deepEqual(expiredAfterClaim, ['job-claim', 'begin', 'job-finish']);
assert.equal(
  capabilityPopCalls,
  1,
  'An expired Edge begin cannot open POP after an earlier claim',
);
let probeSideEffects = 0;
const probeOptions = {
  env,
  fetcher: async () => {
    probeSideEffects++;
    assert.fail('Probe must not call Edge');
  },
  collect: async () => {
    probeSideEffects++;
    assert.fail('Probe must not collect');
  },
  logger: () => probeSideEffects++,
};
const probeRequest = (
  body = { kind: 'probe', mailboxId: workerMailbox },
  auth,
) =>
  new Request('https://sajoansan.vercel.app/api/private-mail-worker', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
    body: JSON.stringify(body),
  });
assert.deepEqual(
  await (await handlePrivateMailWorker(probeRequest(), probeOptions)).json(),
  { configured: true },
);
for (const changes of [
  { MAIL_COLLECTION_ENABLED: 'no' },
  { VERCEL_REGION: 'iad1' },
  { MAIL_POP_PASSWORD: '' },
])
  assert.deepEqual(
    await (
      await handlePrivateMailWorker(probeRequest(), {
        ...probeOptions,
        env: { ...env, ...changes },
      })
    ).json(),
    { configured: false },
  );
assert.equal(
  (
    await handlePrivateMailWorker(
      probeRequest({
        kind: 'probe',
        mailboxId: workerMailbox,
        operation: 'collect',
      }),
      probeOptions,
    )
  ).status,
  403,
);
assert.equal(
  (
    await handlePrivateMailWorker(
      probeRequest(
        { kind: 'probe', mailboxId: workerMailbox, operation: 'collect' },
        capabilityAuthorization,
      ),
      probeOptions,
    )
  ).status,
  400,
);
assert.equal(
  (
    await handlePrivateMailWorker(
      probeRequest(
        {
          kind: 'collect',
          mailboxId: '00000000-0000-4000-8000-000000000105',
          jobId: workerJob,
        },
        capabilityAuthorization,
      ),
      probeOptions,
    )
  ).status,
  400,
);
assert.equal(probeSideEffects, 0);
assert.ok(
  capabilityLogs.every(
    (entry) =>
      !entry.includes(jobCapability) && !entry.includes('fixture-private'),
  ),
);
console.log(
  'PASS TTL job capability forwarding: Edge validates before POP, expired/random/mismatched claims denied, one-shot analysis/report, exact unauthenticated probe has no side effects',
);

async function interruptedCollection(scenario) {
  const nativeTimer = globalThis.setTimeout,
    nativeNow = Date.now;
  let budgetCallback,
    elapsed = 0,
    checkpoint,
    completed = 0,
    abortedFetch = false;
  const uidls =
    scenario === 'empty-abort'
      ? [[1, 'inflight-mail']]
      : [
          [1, 'inflight-mail'],
          [2, 'completed-mail'],
        ];
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    if (milliseconds === 180000 && !budgetCallback)
      budgetCallback = () => callback(...args);
    return nativeTimer(callback, milliseconds, ...args);
  };
  Date.now = () => nativeNow() + elapsed;
  try {
    const response = await handleOwnerCollect(
      new Request('https://sajoansan.vercel.app/api/private-mail-collect', {
        method: 'POST',
        headers: { Authorization: 'Bearer mock-owner' },
        body: JSON.stringify({
          continuous: true,
          requestId: '00000000-0000-4000-8000-000000000109',
        }),
      }),
      {
        env,
        logger: () => {},
        packager: async (_raw, uidl) => ({ ...packaged, uidl: digest(uidl) }),
        connect: async () => ({
          greeting: async () => {},
          login: async () => {},
          close() {},
          uidl: async () => uidls.map((entry) => [...entry]),
          list: async () =>
            new Map(uidls.map(([number]) => [number, raw.length])),
          top: async () => raw,
          retr: async () => raw,
        }),
        fetcher: async (_url, options) => {
          if (options.headers['Content-Type'] === 'application/octet-stream') {
            const metadata = JSON.parse(
              decodeURIComponent(options.headers['X-Mail-Metadata']),
            );
            if (metadata.uidl === digest('inflight-mail')) {
              assert.equal(completed, scenario === 'empty-abort' ? 0 : 1);
              assert.equal(typeof budgetCallback, 'function');
              if (scenario === 'elapsed') {
                elapsed = 180000;
                throw new DOMException(
                  'fixture transport aborted',
                  'AbortError',
                );
              }
              if (scenario === 'failure')
                throw new DOMException(
                  'fixture transport aborted',
                  'AbortError',
                );
              return new Promise((_, reject) => {
                options.signal.addEventListener(
                  'abort',
                  () => {
                    abortedFetch = true;
                    reject(options.signal.reason);
                  },
                  { once: true },
                );
                budgetCallback();
                assert.equal(
                  options.signal.aborted,
                  true,
                  'The real processing AbortController must reach the active fetch',
                );
              });
            }
            return Response.json({ file: { item_id: 'fixture-file' } });
          }
          const body = JSON.parse(options.body);
          if (body.operation === 'begin')
            return Response.json({
              mailbox: '00000000-0000-4000-8000-000000000003',
              lease: '00000000-0000-4000-8000-000000000004',
              cutoff: '2026-08-18T00:00:00Z',
              cursor: null,
            });
          if (body.operation === 'start-cycle')
            return Response.json({
              cycle: startCollection(
                body.uidls,
                '00000000-0000-4000-8000-000000000110',
                new Date().toISOString(),
                body.requestId,
              ),
            });
          if (body.operation === 'seen-many')
            return Response.json({ seen: [], publishedSince: [] });
          if (body.operation === 'finish') {
            assert.equal(body.message.uidl, digest('completed-mail'));
            completed++;
            return Response.json({ id: 'fixture-published' });
          }
          if (body.operation === 'end') {
            checkpoint = body;
            assert.equal(
              options.signal.aborted,
              false,
              'Checkpoint finalization must outlive the processing deadline',
            );
            return Response.json({ ok: true });
          }
          assert.fail('Unexpected interrupted collection operation');
        },
      },
    );
    return {
      status: response.status,
      body: await response.json(),
      checkpoint,
      abortedFetch,
    };
  } finally {
    globalThis.setTimeout = nativeTimer;
    Date.now = nativeNow;
  }
}
for (const scenario of ['abort', 'elapsed']) {
  const result = await interruptedCollection(scenario);
  assert.equal(
    result.status,
    200,
    `${scenario}: a deadline interruption with completed mail must yield normally`,
  );
  assert.equal(result.body.progress.processed, 1);
  assert.equal(result.body.progress.remaining, 1);
  assert.equal(result.body.progress.phase, 'collecting');
  assert.equal(result.checkpoint.error, null);
  assert.equal(result.checkpoint.counts.saved, 1);
  assert.deepEqual(result.checkpoint.processedUidls, [
    createHash('sha256').update('completed-mail').digest('hex'),
  ]);
  if (scenario === 'abort') assert.equal(result.abortedFetch, true);
}
const ordinaryFailure = await interruptedCollection('failure');
assert.equal(
  ordinaryFailure.status,
  503,
  'A non-deadline AbortError must remain a failure',
);
assert.equal(ordinaryFailure.body.code, 'COLLECTION_FAILED');
assert.equal(ordinaryFailure.checkpoint.error, 'SYNC_FAILED');
assert.equal(ordinaryFailure.checkpoint.counts.saved, 1);
const emptyDeadline = await interruptedCollection('empty-abort');
assert.equal(
  emptyDeadline.status,
  503,
  'A deadline without completed work must not claim progress',
);
assert.equal(emptyDeadline.body.code, 'BATCH_TIMEOUT');
assert.equal(emptyDeadline.checkpoint.processedUidls.length, 0);
console.log(
  'PASS real processing abort/deadline: completed prefix checkpoints and yields, unfinished mail stays pending, ordinary failures and zero-progress deadlines remain failures',
);
{
  const data = Buffer.alloc(3276801, 1),
    contentHash = createHash('sha256').update(data).digest('hex');
  for (const [failure, expected] of [
    ['FILE_HASH_REJECTED', 'FILE_HASH_REJECTED'],
    [
      '다른 서류를 처리 중입니다. 잠시 후 다시 시도해 주세요.',
      'ONEDRIVE_LOCK_BUSY',
    ],
    [
      'OneDrive 저장 결과가 원본 보관 요청과 다릅니다.',
      'ONEDRIVE_METADATA_MISMATCH',
    ],
    ['PRIVATE_PROVIDER_MESSAGE_SENTINEL', 'COLLECTION_FAILED'],
  ]) {
    const logs = [];
    let checkpoint;
    const response = await handleOwnerCollect(request(), {
      env,
      connect,
      background: true,
      logger: (line) => logs.push(JSON.parse(line)),
      packager: async () => ({
        ...packaged,
        hash: contentHash,
        files: [
          {
            kind: 'eml',
            name: 'original.eml',
            byte_size: data.length,
            content_hash: contentHash,
            bytes: data,
          },
        ],
      }),
      fetcher: async (url, options) => {
        assert.ok(!url.includes('PRIVATE_PROVIDER_MESSAGE_SENTINEL'));
        const body = JSON.parse(options.body);
        if (body.operation === 'begin')
          return Response.json({
            mailbox: '00000000-0000-4000-8000-000000000003',
            lease: '00000000-0000-4000-8000-000000000004',
            cutoff: '2026-08-18T00:00:00Z',
            cursor: null,
          });
        if (body.operation === 'seen') return Response.json({ seen: false });
        if (body.operation === 'upload-session')
          return Response.json({ error: failure }, { status: 409 });
        if (body.operation === 'end') {
          checkpoint = body;
          return Response.json({ ok: true });
        }
        assert.fail('Unexpected mocked collector operation');
      },
    });
    const result = await response.json();
    assert.equal(result.code, expected);
    assert.equal(result.stage, 'collect');
    assert.equal(result.bridgeOperation, 'upload-session');
    assert.equal(result.bridgeStatus, 409);
    assert.equal(logs.at(-1).bridgeOperation, 'upload-session');
    assert.equal(logs.at(-1).bridgeStatus, 409);
    assert.equal(checkpoint.error, 'SYNC_FAILED');
    assert.equal(checkpoint.counts.saved, 0);
    const serialized = JSON.stringify({ result, logs });
    for (const secret of [
      'PRIVATE_PROVIDER_MESSAGE_SENTINEL',
      'fake-only',
      'mock-owner',
      'original.eml',
      packaged.uidl,
      contentHash,
      'sender@example.test',
      'uploadUrl',
    ])
      assert.ok(!serialized.includes(secret));
  }
  console.log(
    'PASS collector bridge diagnostics: upload-session 409 fixed code/operation/status survive batch boundary without provider text, IDs, filenames or credentials',
  );
}

{
  const { downloadPublicMailImage, isPublicMailImageAddress } =
    await import('../server/private-mail-public-image.mjs');
  const { Readable } = await import('node:stream');
  const { EventEmitter } = await import('node:events');
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2001::1',
    '2002:7f00:1::',
    '2001:db8::1',
  ])
    assert.equal(isPublicMailImageAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
    assert.equal(isPublicMailImageAddress(address), true, address);
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAeAAAACgAQAAAAD8gILgAAADuklEQVR42u2Zz2skRRTHP1XTZHohMo0oTCAwrXjwJCMIxkumAwu7R/8Dc/S4HsRVYqYNIe5tB7yKzr+wtxzCbmfJIYKYuXlZ3N5lYebgoYcMbvfY3eUh86MTRao6CiL9TvOa+UxVvXqv37dqhKK8SSq4gv+3sHWa9Eai5vfFu+LtzMnEDZm0hK0FZ/l6Ei/8SQwwijRHTlNHQppC5+wsOP+1dj7Oh88Kv/d3sJArk3Thv7ABbEc7YCpcfte2DKNt2SsLf2AWbeXLD68+nWjSKq3nrW+HaU6L7tnwe6XO41rYSZSGSWpT4V79xeZAd80vQfrQ9Tv+xTOR1g+1M+wvHrsGuS2Cud8uURjh3I9TI3iaAv7cX48BBqHuPt+Yfz724JXXQMnxbU14ZQXw5v6qDdDWW7qoGl0FV3AF/zfg6agUnBW8zB377CtHl1apUkqpZKiUUnEj6CiR1pWeLRpVEyA5tEP1fvqkVMCkO/C5KXSnbQHj+/u/uz89GNaTj1eJ8r1PDwxGjh7l+YhR8AUAfbOtGoYv05DG040y+3z6iZU4OLs3gbZvCDueJW1gDxizbZhhhWbXDkzTM99Z+A3z3C4sdGAIR0Gax8AuqxOQuwdTA3ijd7cegTwiD8N+/0hF+rBYe7NnuSBOqd9+hvjBestkq7ZWZRM4wHLcgD1pa5fk0vKuMrNiVeWm6VlQQ2pavwZcy8u/PYW8xrSrdlPBFfwPwpNyskSSLU9kAJl3DPcSu9S0JwSe8s3X3ASo0QrZFjrXJH8+ea+yjdAc2QKyk/b4vvzyQpaYNnc2iYLuJVmiXG34M4bhzs5ClvSBkTa8z+mdvYUsGXtQCwyi7Xh7C1lCsI21brRVy0A1tgHHBFabBVFjXBheucLoAlGQz2TJzCI9WD70YKN3NJMlEAR94hd6sDjxYe2N05ksGZ8c99Ta555men4FON6tuAkcJOApsJummsRYllypZzNtcLm5G8qSK7CZLLk8bUNZUmmSCq7gfxHul4EfF/3esWcEz67y+8oH/OU9uQ6sNmft9OLI3rhjAudbhbGUZ9K0LPBb3fybnz94nn2N+5FvFrCMNmk8jUAE/bzEVtWe1A6/k3e5dEWlC1uO5QJPkRCYwtmFivC9mHHPFE6XylPzn5cCnFwIgXf85L2G0bRrDMqWhwTfn0uQ12n9aAbLR+7DPCw5sni8dVL34Dn3TGELgk79tzZ4v/CqKa1UutAh5+b3JLJwvjCOtgjKvsMuKQMnKv0CvObIVbup4Aqu4FL2B6tHQcCfFVUfAAAAAElFTkSuQmCC',
    'base64',
  );
  let dnsCalls = 0,
    requestCalls = 0;
  const options = {
    lookup: async () => {
      dnsCalls++;
      return [{ address: '8.8.8.8', family: 4 }];
    },
    requester: (url, settings, done) => {
      requestCalls++;
      assert.equal(settings.servername, 'cdn.vendor.com');
      assert.equal(settings.rejectUnauthorized, true);
      assert.equal(settings.autoSelectFamily, false);
      assert.equal(settings.agent, false);
      assert.equal(settings.headers.Authorization, undefined);
      settings.lookup('cdn.vendor.com', {}, (error, address, family) => {
        assert.equal(error, null);
        assert.equal(address, '8.8.8.8');
        assert.equal(family, 4);
      });
      const request = new EventEmitter();
      request.end = () =>
        queueMicrotask(() => {
          const response = Readable.from([image]);
          response.statusCode = 200;
          response.socket = { authorized: true, remoteAddress: '8.8.8.8' };
          response.headers = { 'content-type': 'image/png' };
          done(response);
        });
      return request;
    },
  };
  const response = await downloadPublicMailImage(
    'https://cdn.vendor.com/uuid',
    options,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, image.length);
  assert.equal(dnsCalls, 1);
  assert.equal(requestCalls, 1);
  await assert.rejects(
    () =>
      downloadPublicMailImage('https://cdn.vendor.com/uuid', {
        ...options,
        lookup: async () => [
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
      }),
    /REMOTE_IMAGE_SOURCE/,
  );
  assert.equal(requestCalls, 1);
  for (const url of [
    'https://169.254.169.254/a',
    'http://cdn.vendor.com/a',
    'https://user:pass@cdn.vendor.com/a',
    'https://cdn.vendor.com/a?recipient=owner',
  ])
    await assert.rejects(
      () => downloadPublicMailImage(url, options),
      /REMOTE_IMAGE_SOURCE/,
    );
  const bad = (change) => ({
    ...options,
    requester: (_url, _settings, done) => {
      requestCalls++;
      const request = new EventEmitter();
      request.end = () =>
        queueMicrotask(() => {
          const response = Readable.from([image]);
          Object.assign(response, {
            statusCode: 200,
            socket: { authorized: true, remoteAddress: '8.8.8.8' },
            headers: { 'content-type': 'image/png' },
            ...change,
          });
          done(response);
        });
      return request;
    },
  });
  await assert.rejects(
    () =>
      downloadPublicMailImage(
        'https://cdn.vendor.com/uuid',
        bad({ statusCode: 302, headers: { location: 'https://127.0.0.1/a' } }),
      ),
    /REMOTE_IMAGE_SOURCE/,
  );
  await assert.rejects(
    () =>
      downloadPublicMailImage(
        'https://cdn.vendor.com/uuid',
        bad({ socket: { authorized: true, remoteAddress: '127.0.0.1' } }),
      ),
    /REMOTE_IMAGE_SOURCE/,
  );
  await assert.rejects(
    () =>
      downloadPublicMailImage(
        'https://cdn.vendor.com/uuid',
        bad({ headers: { 'content-type': 'text/html' } }),
      ),
    /REMOTE_IMAGE_SOURCE/,
  );
  await assert.rejects(
    () =>
      downloadPublicMailImage('https://cdn.vendor.com/uuid', {
        ...options,
        maxBytes: 10,
      }),
    /IMAGE_LIMIT/,
  );
  await assert.rejects(
    () =>
      downloadPublicMailImage('https://cdn.vendor.com/uuid', {
        ...options,
        timeoutMs: 10,
        lookup: () => new Promise(() => {}),
      }),
    /REMOTE_IMAGE_TIMEOUT/,
  );
  let downloads = 0;
  const request = (auth = workerKey) =>
    new Request('https://sajoansan.vercel.app/api/private-mail-worker', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + auth },
      body: JSON.stringify({
        kind: 'remote-image',
        mailboxId: '39045005-313e-42e1-b50c-2394b3b6ff26',
        messageId: '11111111-1111-4111-8111-111111111111',
        url: 'https://cdn.vendor.com/uuid',
      }),
    });
  const remoteOptions = {
    env: { MAIL_COLLECTOR_KEY: workerKey },
    downloadImage: async () => {
      downloads++;
      return new Response(image, { headers: { 'content-type': 'image/png' } });
    },
    fetcher: async (url, options) => {
      assert.equal(
        url,
        'https://vvrppotrnpwrwpwqaiet.supabase.co/functions/v1/onedrive-auth/private-mail-background-work',
      );
      assert.equal(JSON.parse(options.body).operation, 'image-authorize');
      return options.headers.Authorization === 'Bearer ' + workerKey
        ? Response.json({ authorized: true })
        : new Response('', { status: 403 });
    },
    collect: () => assert.fail('no collection'),
  };
  assert.equal(
    (await handlePrivateMailWorker(request(), remoteOptions)).status,
    200,
  );
  assert.equal(downloads, 1);
  assert.equal(
    (
      await handlePrivateMailWorker(
        request('pmjob_' + 'a'.repeat(64)),
        remoteOptions,
      )
    ).status,
    403,
  );
  assert.equal(downloads, 1);
  const noLegacy = await handlePrivateMailWorker(
    request('pmjob_' + 'b'.repeat(64)),
    {
      ...remoteOptions,
      env: {},
      fetcher: async () => Response.json({ authorized: true }),
    },
  );
  assert.equal(noLegacy.status, 200);
  assert.equal(downloads, 2);
  console.log(
    'PASS public image downloader: DNS all-address checks and pinned lookup/TLS/socket verification; private/mixed DNS, metadata, rebinding, redirect, MIME, bytes and timeout rejected; server-only existing key relay, no model or POP calls',
  );
}
