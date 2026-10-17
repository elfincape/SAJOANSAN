import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  makeNodeDiagnostic,
  nodeNetwork,
} from '../scripts/private-mail/node-diagnostic.mjs';
import { OWNER_ID } from '../supabase/functions/private-mail-diagnostic/handler.js';
let auth = true,
  owner = true,
  active = true,
  calls = 0,
  closes = 0,
  release;
const fetcher = async (url) =>
  url.endsWith('/user')
    ? new Response(JSON.stringify({ id: owner ? OWNER_ID : 'other' }), {
        status: auth ? 200 : 401,
      })
    : new Response(JSON.stringify([{ id: OWNER_ID, active }]));
const network = {
  resolveDns: async (host) => {
    assert.equal(host, 'mail.onnet21.com');
    calls++;
    return ['192.0.2.1'];
  },
  connect: async (options) => {
    assert.equal(options.port, 995);
    return {
      close() {
        closes++;
      },
    };
  },
  startTls: async (_conn, options) => {
    assert.equal(options.hostname, 'mail.onnet21.com');
    return {
      handshake: async () => {},
      read: async (buffer) => {
        buffer.set(new TextEncoder().encode('+OK private banner\r\n'));
        return 20;
      },
      close() {
        closes++;
      },
    };
  },
};
const handler = makeNodeDiagnostic({ fetcher, network, region: 'iad1' });
const request = (authorization) => ({
  method: 'POST',
  headers: authorization
    ? {
        authorization: 'Bearer mock-only',
        origin: 'https://sajoansan.vercel.app',
      }
    : {},
  body: { host: 'evil', port: 25 },
});
async function invoke(req, fn = handler) {
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(status) {
      this.code = status;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await fn(req, res);
  return res;
}
assert.equal((await invoke(request(false))).code, 401);
auth = false;
assert.equal((await invoke(request(true))).code, 401);
auth = true;
owner = false;
assert.equal((await invoke(request(true))).code, 403);
owner = true;
active = false;
assert.equal((await invoke(request(true))).code, 403);
active = true;
assert.equal((await invoke({ ...request(true), method: 'GET' })).code, 405);
assert.equal(
  (await invoke({ ...request(true), headers: { origin: 'https://evil.test' } }))
    .code,
  403,
);
assert.equal(calls, 0);
const result = await invoke(request(true));
assert.equal(result.body.ok, true);
assert.equal(result.body.execution_region, 'iad1');
assert.equal(result.body.execution_runtime, 'vercel-node');
assert.ok(!JSON.stringify(result.body).includes('private banner'));
assert.ok(closes >= 2);
const waiting = makeNodeDiagnostic({
  fetcher,
  network: {
    ...network,
    resolveDns: () =>
      new Promise((r) => {
        release = () => r(['192.0.2.1']);
      }),
  },
});
const first = invoke(request(true), waiting);
while (!release) await new Promise((r) => setTimeout(r, 1));
assert.equal((await invoke(request(true), waiting)).code, 409);
release();
await first;
const failed = makeNodeDiagnostic({
  fetcher,
  network: {
    ...network,
    startTls: async () => {
      throw Error('private upstream detail');
    },
  },
});
const failure = await invoke(request(true), failed);
assert.equal(failure.body.code, 'TLS_FAILED');
assert.ok(!JSON.stringify(failure.body).includes('private upstream'));
// Verify the real Node adapter's TLS options and lifecycle, without external network.
const raw = new EventEmitter();
raw.destroy = () => {
  raw.destroyed = true;
  raw.emit('close');
};
raw.pause = () => {};
raw.resume = () => {};
let tlsOptions;
const adapter = nodeNetwork({
  dnsClient: { resolve4: async () => ['192.0.2.1'] },
  netClient: {
    connect: (options) => {
      assert.deepEqual(options, { host: 'mail.onnet21.com', port: 995 });
      queueMicrotask(() => raw.emit('connect'));
      return raw;
    },
  },
  tlsClient: {
    connect: (options) => {
      tlsOptions = options;
      queueMicrotask(() => raw.emit('secureConnect'));
      return raw;
    },
  },
});
const tcp = await adapter.connect({ hostname: 'mail.onnet21.com', port: 995 });
const secure = await adapter.startTls(tcp, { hostname: 'mail.onnet21.com' });
await secure.handshake();
assert.equal(tlsOptions.servername, 'mail.onnet21.com');
assert.equal(tlsOptions.rejectUnauthorized, true);
assert.deepEqual(Object.keys(tlsOptions).sort(), [
  'rejectUnauthorized',
  'servername',
  'socket',
]);
const buffer = new Uint8Array(512);
const read = secure.read(buffer);
raw.emit('data', Buffer.from('+OK test\r\n'));
assert.equal(await read, 10);
secure.close();
assert.equal(raw.destroyed, true);
console.log(
  'PASS Node diagnostic: verified owner/active session, fixed target, no input target, instance concurrency, failure cleanup, safe response, Node default TLS options and SNI',
);
