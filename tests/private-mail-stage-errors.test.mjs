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
  assert.deepEqual(Object.keys(JSON.parse(log)).sort(), [
    'code',
    'event',
    'stage',
  ]);
  assert.ok(!/fixture-private|private\.test/.test(log));
}
console.log(
  'PASS stage codes: failed begin prevents POP, login precedes UIDL, login-only does not retrieve, untrusted upstream text/password/JWT excluded from logs and responses',
);
