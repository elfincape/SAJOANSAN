import { resolve4 } from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import {
  probePopConnection,
  validDiagnosticLease,
} from '../supabase/functions/private-mail-diagnostic/handler.js';
const DIAGNOSTIC_EDGE =
  'https://vvrppotrnpwrwpwqaiet.supabase.co/functions/v1/private-mail-diagnostic';

export function createNodeNetwork() {
  let details = {};
  return {
    resolveDns: (hostname) => resolve4(hostname),
    connect: ({ hostname, port }) =>
      new Promise((resolve, reject) => {
        const socket = net.connect({ host: hostname, port });
        socket.setTimeout(3000, () =>
          socket.destroy(
            Object.assign(Error('TCP_TIMEOUT'), { code: 'TCP_TIMEOUT' }),
          ),
        );
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.setTimeout(0);
          resolve({ socket, close: () => socket.destroy() });
        });
      }),
    startTls: (tcp, { hostname }) => {
      const socket = tls.connect({
        socket: tcp.socket,
        servername: hostname,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      });
      // Register error handling before the handshake can fail.
      const ready = new Promise((resolve, reject) => {
        socket.once('secureConnect', () => {
          details = {
            tls_protocol: socket.getProtocol(),
            tls_cipher: socket.getCipher()?.standardName,
          };
          resolve();
        });
        socket.once('error', reject);
      });
      ready.catch(() => {});
      const reader = socket[Symbol.asyncIterator]();
      let pending = new Uint8Array(0);
      return {
        handshake: () => ready,
        async read(buffer) {
          if (!pending.length) {
            const { value, done } = await reader.next();
            if (done) return null;
            pending = value;
          }
          const count = Math.min(buffer.length, pending.length);
          buffer.set(pending.subarray(0, count));
          pending = pending.subarray(count);
          return count;
        },
        close: () => socket.destroy(),
      };
    },
    details: () => details,
  };
}

export async function handleNodeDiagnostic(
  request,
  { fetcher = fetch, network = createNodeNetwork(), region } = {},
) {
  const json = (data, status = 200) =>
    Response.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  if (request.method !== 'POST')
    return json({ error: 'POST 요청이 필요합니다.' }, 405);
  const authorization = request.headers.get('authorization');
  if (!/^Bearer .+$/i.test(authorization || ''))
    return json({ error: '로그인이 필요합니다.' }, 401);
  const body = await request.json().catch(() => ({}));
  if (!validDiagnosticLease(body?.lease))
    return json({ error: '유효한 실행 잠금이 필요합니다.' }, 400);
  try {
    // Only an authenticated owner with a fresh, unclaimed Edge lease may probe.
    const claim = await fetcher(DIAGNOSTIC_EDGE, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'claim', holder: body.lease }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!claim.ok || (await claim.json()).claimed !== true)
      return json(
        { error: '실행 권한 또는 잠금을 확인할 수 없습니다.' },
        [401, 403, 409].includes(claim.status) ? claim.status : 503,
      );
    const result = await probePopConnection(network, { region });
    return json({
      ...result,
      execution_platform: 'vercel-node',
      ...network.details?.(),
    });
  } catch {
    return json({ error: '클라우드 연결 진단을 실행하지 못했습니다.' }, 503);
  }
}
