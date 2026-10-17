import assert from 'node:assert/strict';
import {
  packageMessage,
  safeName,
  RAW_LIMIT,
} from '../server/private-mail-package.mjs';
import { handleOwnerCollect } from '../server/private-mail-owner-collect.mjs';
const raw = Buffer.from(
  'Date: Sat, 17 Oct 2026 00:00:00 +0000\r\nFrom: Sample <sender@example.test>\r\nSubject: =?UTF-8?B?7YWM7Iqk7Yq4?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello</p><script>evil()</script><img src="https://track.test">\r\n--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="../../evil.exe"\r\nContent-Transfer-Encoding: base64\r\n\r\nTVo=\r\n--b--\r\n',
);
const packaged = await packageMessage(raw, Buffer.from('uid-1'));
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
