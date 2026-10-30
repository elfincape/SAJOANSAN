import assert from 'node:assert/strict';
import { handleOwnerCollect } from '../server/private-mail-owner-collect.mjs';
const env = {
  MAIL_COLLECTION_ENABLED: 'yes',
  MAIL_POP_PASSWORD: 'fixture-private-password',
  VERCEL_REGION: 'icn1',
};
const req = (mode = 'collect') =>
  new Request('https://sajoansan.vercel.app/api/private-mail-collect', {
    method: 'POST',
    headers: { Authorization: 'Bearer fixture-private-jwt' },
    body: JSON.stringify({ mode }),
  });
let connected = 0,
  commands = [],
  logs = [],
  beginCode = 'DRIVE_OWNER_UNAVAILABLE',
  loginFailure = false;
let loginCode;
const fetcher = async (_url, opts) => {
  const op = JSON.parse(opts.body).operation;
  if (op === 'begin' && beginCode)
    return Response.json({ error: beginCode }, { status: 409 });
  if (op === 'begin')
    return Response.json({
      mailbox: '39045005-313e-42e1-b50c-2394b3b6ff26',
      lease: '00000000-0000-4000-8000-000000000004',
      cutoff: '2026-08-18T00:00:00Z',
      cursor: null,
    });
  return Response.json({ ok: true });
};
const connect = async () => {
  connected++;
  return {
    greeting: async () => {
      commands.push('greeting');
    },
    login: async () => {
      commands.push('login');
      if (loginFailure)
        throw Object.assign(Error('fixture-private-password'), {
          code: loginCode,
        });
    },
    uidl: async () => {
      commands.push('UIDL');
      return [];
    },
    list: async () => new Map(),
    close: () => commands.push('close'),
  };
};
const options = { env, fetcher, connect, logger: (s) => logs.push(s) };
let response = await handleOwnerCollect(req(), options),
  body = await response.json();
assert.equal(body.code, 'DRIVE_OWNER_UNAVAILABLE');
assert.equal(body.stage, 'begin');
assert.equal(connected, 0);
beginCode = 'https://private.test/token';
body = await (await handleOwnerCollect(req(), options)).json();
assert.equal(body.code, 'BEGIN_FAILED');
assert.equal(connected, 0);
beginCode = null;
loginFailure = true;
body = await (await handleOwnerCollect(req(), options)).json();
assert.equal(body.code, 'POP_LOGIN_FAILED');
assert.equal(body.stage, 'login');
assert.equal(commands.includes('UIDL'), false);
for (const code of [
  'POP_USER_REJECTED',
  'POP_PASSWORD_REJECTED',
  'POP_AUTH_TIMEOUT',
  'POP_AUTH_CLOSED',
  'POP_AUTH_PROTOCOL_ERROR',
  'POP_MAILBOX_BUSY',
  'POP_LOGIN_DELAY',
  'POP_AUTH_SERVER_ERROR',
]) {
  loginCode = code;
  body = await (await handleOwnerCollect(req(), options)).json();
  assert.equal(body.code, code);
  assert.equal(body.stage, 'login');
  assert.equal(commands.includes('UIDL'), false);
  assert.ok(!JSON.stringify(body).includes('fixture-private-password'));
}
loginCode = 'fixture-private-password';
body = await (await handleOwnerCollect(req(), options)).json();
assert.equal(body.code, 'POP_LOGIN_FAILED');
loginFailure = false;
commands = [];
body = await (await handleOwnerCollect(req('login'), options)).json();
assert.equal(body.ok, true);
assert.equal(body.region, 'icn1');
assert.equal(commands.includes('UIDL'), false);
commands = [];
body = await (await handleOwnerCollect(req(), options)).json();
assert.equal(body.ok, true);
assert.ok(commands.indexOf('login') < commands.indexOf('UIDL'));
for (const log of logs) {
  const metadata = JSON.parse(log);
  assert.ok(
    Object.keys(metadata).every((key) =>
      [
        'code',
        'event',
        'stage',
        'bridgeCode',
        'bridgeOperation',
        'bridgeStatus',
      ].includes(key),
    ),
  );
  if (metadata.bridgeCode) assert.match(metadata.bridgeCode, /^[A-Z_]{1,64}$/);
  if (metadata.bridgeOperation)
    assert.ok(
      [
        'begin',
        'seen',
        'seen-many',
        'start-cycle',
        'attach-cycle',
        'file',
        'upload-session',
        'upload-complete',
        'finish',
        'end',
      ].includes(metadata.bridgeOperation),
    );
  if (metadata.bridgeStatus != null)
    assert.ok(
      Number.isInteger(metadata.bridgeStatus) &&
        metadata.bridgeStatus >= 400 &&
        metadata.bridgeStatus <= 599,
    );
  assert.ok(!/fixture-private|private\.test/.test(log));
}
console.log(
  'PASS stage codes: failed begin prevents POP, login precedes UIDL, login-only does not retrieve, untrusted upstream text/password/JWT excluded from logs and responses',
);

{
  const { handlePrivateMailWorker } =
    await import('../server/private-mail-worker.mjs');
  const { authorizeMailWork } =
    await import('../supabase/functions/onedrive-auth/private-mail-worker-auth.js');
  const mailbox = '39045005-313e-42e1-b50c-2394b3b6ff26',
    id = '00000000-0000-4000-8000-000000000003',
    token = 'pmjob_' + 'a'.repeat(64);
  let calls = 0;
  const request = (body) =>
    new Request('https://test.example', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
  const response = await handlePrivateMailWorker(
    request({ kind: 'history', mailboxId: mailbox, historyId: id }),
    {
      env: {},
      fetcher: async (url, options) => {
        calls++;
        const body = JSON.parse(options.body);
        assert.equal(body.operation, 'history');
        assert.equal(body.id, id);
        assert.equal(body.mailbox, mailbox);
        assert(!('day' in body));
        return Response.json({ status: 'done' });
      },
      collect: () => {
        throw Error('POP must never run');
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  const ctx = {
    token,
    hash: async () => 'hash',
    db: async () => ({ kind: 'history', target: id, mailboxId: mailbox }),
    fail: (message, status) => Object.assign(Error(message), { status }),
  };
  await authorizeMailWork(
    'private-mail-background-work',
    request({ operation: 'history', id, mailbox }),
    ctx,
  );
  for (const body of [
    { operation: 'analyze', id, mailbox },
    { operation: 'history', id: crypto.randomUUID(), mailbox },
    { operation: 'report', day: '2026-10-30', mailbox },
  ])
    await assert.rejects(
      () =>
        authorizeMailWork('private-mail-background-work', request(body), ctx),
      /WORKER_AUTH_REQUIRED/,
    );
  assert.equal(
    (
      await handlePrivateMailWorker(
        request({ kind: 'history', mailboxId: mailbox, historyId: 'bad' }),
        {
          env: {},
          fetcher: () => {
            throw Error('not expected');
          },
        },
      )
    ).status,
    400,
  );
  console.log(
    'PASS history worker: one scoped call, exact UUID, no POP/model/report, capability denies target/operation confusion',
  );
}

{
  const { handlePrivateMailWorker } =
    await import('../server/private-mail-worker.mjs');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const jobId = crypto.randomUUID();
  let finished = 0;
  const response = await handlePrivateMailWorker(
    new Request('https://test.example', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + 'pmjob_' + 'a'.repeat(64) },
      body: JSON.stringify({
        kind: 'collect',
        mailboxId: target.mailbox_id,
        jobId,
      }),
    }),
    {
      env: {},
      collect: async () =>
        Response.json({ code: 'ONEDRIVE_METADATA_MISMATCH' }, { status: 503 }),
      fetcher: async (_url, options) => {
        const payload = JSON.parse(options.body);
        if (payload.operation === 'job-claim')
          return Response.json({ job: { id: jobId } });
        assert.equal(payload.operation, 'job-finish');
        assert.equal(payload.error, 'ONEDRIVE_METADATA_MISMATCH');
        finished++;
        return Response.json({ job: { status: 'failed' } });
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(finished, 1);
  console.log(
    'PASS collection worker: safe known bridge failure retained in durable job, no raw provider detail',
  );
}
