import assert from 'node:assert/strict';
import {
  makeDiagnosticHandler,
  probePopConnection,
  OWNER_ID,
} from '../supabase/functions/private-mail-diagnostic/handler.js';
const json = (value) => new Response(JSON.stringify(value));
let authenticated = true,
  owner = true,
  active = true,
  busy = false,
  lock = false,
  networkCalls = 0,
  closed = 0,
  failTls = false,
  greeting = '+OK ready\r\n';
const network = {
  async resolveDns(host, type) {
    assert.equal(host, 'mail.onnet21.com');
    assert.equal(type, 'A');
    networkCalls++;
    return ['192.0.2.1'];
  },
  async connect(options) {
    assert.deepEqual(options, {
      hostname: 'mail.onnet21.com',
      port: 995,
      transport: 'tcp',
    });
    return {
      close() {
        closed++;
      },
    };
  },
  async startTls(conn, options) {
    assert.deepEqual(options, { hostname: 'mail.onnet21.com' });
    let read = false;
    return {
      async handshake() {
        if (failTls) throw Error('sensitive upstream detail');
      },
      async read(buffer) {
        if (read) return null;
        read = true;
        const bytes = new TextEncoder().encode(greeting);
        buffer.set(bytes);
        return bytes.length;
      },
      close() {
        closed++;
      },
    };
  },
};
const env = {
  SB_REGION: 'ap-northeast-2',
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'public',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only',
};
async function fetcher(url, options) {
  if (url.endsWith('/auth/v1/user'))
    return authenticated
      ? json({ id: owner ? OWNER_ID : '00000000-0000-4000-8000-000000000009' })
      : new Response('', { status: 401 });
  if (url.includes('/user_profiles?')) {
    assert.equal(options.headers.Authorization, 'Bearer user-session');
    return json([{ id: OWNER_ID, active }]);
  }
  if (url.includes('/onedrive_locks?')) {
    assert.equal(options.headers.Authorization, 'Bearer server-only');
    if (options.method === 'DELETE') {
      if (url.includes('holder=eq.')) lock = false;
      return new Response(null, { status: 204 });
    }
    if (options.method === 'POST') {
      if (busy || lock) return json([]);
      lock = true;
      return json([{ name: 'private-mail-pop-diagnostic' }]);
    }
  }
  throw Error('Unexpected URL');
}
const handler = makeDiagnosticHandler(env, network, { fetcher, timeoutMs: 20 });
const req = (auth = true, body = '{}') =>
  new Request('https://db.test/functions/v1/private-mail-diagnostic', {
    method: 'POST',
    headers: auth ? { Authorization: 'Bearer user-session' } : {},
    body,
  });
assert.equal((await handler(req(false))).status, 401);
assert.equal(networkCalls, 0);
authenticated = false;
assert.equal((await handler(req())).status, 401);
authenticated = true;
owner = false;
assert.equal((await handler(req())).status, 403);
owner = true;
active = false;
assert.equal((await handler(req())).status, 403);
active = true;
busy = true;
assert.equal((await handler(req())).status, 409);
busy = false;
assert.equal(networkCalls, 0);
const result = await (
  await handler(req(true, JSON.stringify({ host: 'evil.test', port: 25 })))
).json();
assert.equal(result.ok, true);
assert.deepEqual(result.stages, {
  dns: 'ok',
  tcp: 'ok',
  tls: 'ok',
  greeting: 'ok',
});
assert.equal(lock, false);
assert.equal(networkCalls, 1);
assert.ok(!JSON.stringify(result).includes('ready'));
assert.ok(!JSON.stringify(result).includes('server-only'));
failTls = true;
const failure = await (await handler(req())).json();
assert.equal(failure.code, 'TLS_FAILED');
assert.equal(failure.stages.tcp, 'ok');
assert.equal(failure.stages.tls, 'failed');
assert.ok(!JSON.stringify(failure).includes('sensitive'));
failTls = false;
greeting = '-ERR denied\r\n';
assert.equal((await (await handler(req())).json()).code, 'POP_GREETING_FAILED');
greeting = '+OK ready\r\n';
const stuck = {
  ...network,
  startTls: async () => ({
    handshake: () => new Promise(() => {}),
    close() {
      closed++;
    },
  }),
};
const timed = await probePopConnection(stuck, { timeoutMs: 5 });
assert.equal(timed.ok, false);
assert.equal(timed.code, 'TLS_TIMEOUT');
assert.ok(closed >= 4);
let release;
const waiting = {
  ...network,
  resolveDns: () =>
    new Promise((resolve) => {
      release = () => resolve(['192.0.2.1']);
    }),
};
const concurrent = makeDiagnosticHandler(env, waiting, {
  fetcher,
  timeoutMs: 100,
});
const first = concurrent(req());
while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
assert.equal((await concurrent(req())).status, 409);
release();
assert.equal((await first).status, 200);
console.log(
  'PASS diagnostic: getUser/owner/active authentication, fixed target, distributed lock, TLS verification, bounded timeout, connection close, sanitized stage-only results, concurrency denial',
);

assert.equal(result.execution_region, 'ap-northeast-2');
assert.equal(failure.tls_phase, 'TLS_HANDSHAKE');
assert.equal(failure.tls_error, 'OTHER');
assert.equal(timed.tls_phase, 'TLS_HANDSHAKE');
assert.equal(timed.tls_error, 'TIMEOUT');
for (const [error, category] of [
  [
    Error('invalid peer certificate: UnknownIssuer secret-marker'),
    'CERT_TRUST',
  ],
  [
    Error('invalid peer certificate: NotValidForName secret-marker'),
    'CERT_HOSTNAME',
  ],
  [Error('certificate expired secret-marker'), 'CERT_VALIDITY'],
  [Error('invalid certificate signature secret-marker'), 'CERT_OTHER'],
  [
    new TypeError('Deno.startTls is not a function secret-marker'),
    'API_UNAVAILABLE',
  ],
  [Error('connection reset secret-marker'), 'CONNECTION_CLOSED'],
  [Error('tls alert handshake failure secret-marker'), 'PROTOCOL'],
  [Error('unrecognized secret-marker'), 'OTHER'],
  [
    Object.assign(Error('secret-marker'), { code: 'secret-marker_TIMEOUT' }),
    'OTHER',
  ],
]) {
  for (const phase of ['TLS_SETUP', 'TLS_HANDSHAKE']) {
    const fake = {
      ...network,
      startTls: async () => {
        if (phase === 'TLS_SETUP') throw error;
        return {
          handshake: async () => {
            throw error;
          },
          close() {
            closed++;
          },
        };
      },
    };
    const classified = await probePopConnection(fake, {
      region: 'ap-northeast-2',
    });
    assert.equal(classified.tls_phase, phase);
    assert.equal(classified.tls_error, category);
    assert.equal(classified.execution_region, 'ap-northeast-2');
    assert.equal(classified.stages.greeting, 'pending');
    assert.ok(!JSON.stringify(classified).includes('secret-marker'));
    assert.ok(!Object.hasOwn(classified, 'stack'));
  }
}
assert.equal(
  (await probePopConnection(network, { region: 'secret-marker' }))
    .execution_region,
  'unknown',
);
console.log(
  'PASS TLS phase/category allowlist, region allowlist, no upstream error or stack disclosure',
);
