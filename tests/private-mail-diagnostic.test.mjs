import assert from 'node:assert/strict';
import {
  makeDiagnosticHandler,
  probePopConnection,
  OWNER_ID,
  claimedDiagnosticLease,
  validDiagnosticLease,
} from '../supabase/functions/private-mail-diagnostic/handler.js';
const json = (value) => new Response(JSON.stringify(value));
let authenticated = true,
  owner = true,
  active = true,
  busy = false,
  lock = false,
  leaseHolder,
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
      if (
        url.includes('&holder=eq.' + leaseHolder) ||
        (url.includes('&or=') && url.includes(leaseHolder))
      )
        lock = false;
      return new Response(null, { status: 204 });
    }
    if (options.method === 'POST') {
      if (busy || lock) return json([]);
      lock = true;
      leaseHolder = JSON.parse(options.body).holder;
      assert.ok(
        Date.parse(JSON.parse(options.body).expires_at) > Date.now() + 40000,
      );
      return json([{ name: 'private-mail-pop-diagnostic' }]);
    }
    if (options.method === 'PATCH') {
      if (!lock || !url.includes('&holder=eq.' + leaseHolder + '&'))
        return json([]);
      leaseHolder = JSON.parse(options.body).holder;
      assert.match(
        leaseHolder,
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
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

let delegatedCalls = 0;
assert.equal(
  validDiagnosticLease(claimedDiagnosticLease(crypto.randomUUID())),
  false,
);
const delegated = makeDiagnosticHandler(env, network, {
  fetcher,
  delegate: async ({ token, holder }) => {
    assert.equal(token, 'user-session');
    const claim = () =>
      delegated(req(true, JSON.stringify({ action: 'claim', holder })));
    assert.equal((await claim()).status, 200);
    assert.equal((await claim()).status, 409);
    assert.equal(
      (
        await delegated(
          req(true, JSON.stringify({ action: 'claim', holder: 'invalid' })),
        )
      ).status,
      400,
    );
    delegatedCalls++;
    return {
      ok: true,
      stages: result.stages,
      execution_platform: 'vercel-node',
    };
  },
});
const delegatedResult = await (await delegated(req())).json();
assert.equal(delegatedCalls, 1);
assert.equal(delegatedResult.execution_platform, 'vercel-node');
assert.equal(lock, false);
owner = false;
assert.equal(
  (
    await delegated(
      req(
        true,
        JSON.stringify({ action: 'claim', holder: crypto.randomUUID() }),
      ),
    )
  ).status,
  403,
);
owner = true;
console.log('PASS authenticated single-use Node delegation and lease cleanup');

const interrupted = makeDiagnosticHandler(env, network, {
  fetcher,
  delegate: async ({ holder }) => {
    assert.equal(
      (
        await interrupted(
          req(true, JSON.stringify({ action: 'claim', holder })),
        )
      ).status,
      200,
    );
    throw Error('delegation timed out while worker may still be running');
  },
});
assert.equal((await interrupted(req())).status, 503);
assert.equal(
  lock,
  true,
  'claimed lease must survive uncertain delegation failure',
);
assert.equal((await delegated(req())).status, 409);
lock = false;

const { handleNodeDiagnostic } =
  await import('../server/private-mail-probe.mjs');
let claims = 0,
  nodeProbes = 0,
  claimStatus = 200;
const nodeRequest = (body, auth = true, method = 'POST') =>
  new Request('https://sajoansan.vercel.app/api/private-mail-diagnostic', {
    method,
    headers: auth ? { Authorization: 'Bearer user-session' } : {},
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
const nodeOptions = {
  fetcher: async (url, options) => {
    claims++;
    assert.ok(url.endsWith('/functions/v1/private-mail-diagnostic'));
    assert.equal(options.headers.Authorization, 'Bearer user-session');
    assert.equal(JSON.parse(options.body).action, 'claim');
    return new Response(JSON.stringify({ claimed: claimStatus === 200 }), {
      status: claimStatus,
    });
  },
  network: {
    ...network,
    resolveDns: async (...args) => {
      nodeProbes++;
      return network.resolveDns(...args);
    },
  },
  region: 'iad1',
};
assert.equal(
  (await handleNodeDiagnostic(nodeRequest({}, false), nodeOptions)).status,
  401,
);
assert.equal(
  (await handleNodeDiagnostic(nodeRequest({ lease: 'bad' }), nodeOptions))
    .status,
  400,
);
assert.equal(
  (await handleNodeDiagnostic(nodeRequest({}, true, 'GET'), nodeOptions))
    .status,
  405,
);
assert.equal(claims, 0);
for (const status of [401, 403, 409]) {
  claimStatus = status;
  assert.equal(
    (
      await handleNodeDiagnostic(
        nodeRequest({ lease: crypto.randomUUID() }),
        nodeOptions,
      )
    ).status,
    status,
  );
}
assert.equal(nodeProbes, 0);
claimStatus = 200;
const nodeResult = await (
  await handleNodeDiagnostic(
    nodeRequest({ lease: crypto.randomUUID(), host: 'evil.test', port: 25 }),
    nodeOptions,
  )
).json();
assert.equal(nodeResult.ok, true);
assert.equal(nodeResult.execution_platform, 'vercel-node');
assert.equal(nodeResult.execution_region, 'iad1');
assert.equal(nodeProbes, 1);
console.log(
  'PASS Node worker rejects missing/replayed/unauthorized leases before network access; fixed target preserved',
);
