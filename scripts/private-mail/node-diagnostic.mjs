import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../repo-root/js/config.js';
import {
  OWNER_ID,
  probePopConnection,
} from '../../supabase/functions/private-mail-diagnostic/handler.js';

const SITE = 'https://sajoansan.vercel.app';
const REGION = /^[a-z]{3}[1-9]$/.test(process.env.VERCEL_REGION || '')
  ? process.env.VERCEL_REGION
  : 'unknown';

// Socket errors are consumed locally; upstream errors and tokens are never logged.
export function nodeNetwork({
  dnsClient = dns,
  netClient = net,
  tlsClient = tls,
} = {}) {
  return {
    resolveDns: (host) => dnsClient.resolve4(host),
    connect: ({ hostname, port }) =>
      new Promise((resolve, reject) => {
        const socket = netClient.connect({ host: hostname, port });
        socket.on('error', () => {});
        socket.once('error', reject);
        socket.once('connect', () =>
          resolve({ socket, close: () => socket.destroy() }),
        );
        // Own deadline destroys even a connection that never resolves.
        const timer = setTimeout(() => {
          socket.destroy();
          reject(Object.assign(Error(), { code: 'TCP_TIMEOUT' }));
        }, 3000);
        socket.once('connect', () => clearTimeout(timer));
        socket.once('close', () => clearTimeout(timer));
      }),
    startTls: async (connection, { hostname }) => {
      const socket = tlsClient.connect({
        socket: connection.socket,
        servername: hostname,
        rejectUnauthorized: true,
      });
      socket.on('error', () => {});
      let settled = false,
        failure;
      const handshake = new Promise((resolve, reject) => {
        socket.once('error', (error) => {
          failure = error;
          settled = true;
          reject(error);
        });
        socket.once('secureConnect', () => {
          settled = true;
          resolve();
        });
        socket.once('close', () => {
          if (!settled) reject(Error('connection closed'));
        });
      });
      // A rejection can precede the caller's handshake() call.
      handshake.catch(() => {});
      return {
        handshake: () => handshake,
        read: (buffer) =>
          new Promise((resolve, reject) => {
            if (failure) return reject(failure);
            if (socket.destroyed) return resolve(null);
            const cleanup = () => {
              socket.off('data', data);
              socket.off('error', error);
              socket.off('end', end);
              socket.off('close', end);
            };
            const data = (chunk) => {
              socket.pause();
              cleanup();
              const count = Math.min(buffer.length, chunk.length);
              buffer.set(chunk.subarray(0, count));
              resolve(count);
            };
            const error = (err) => {
              cleanup();
              reject(err);
            };
            const end = () => {
              cleanup();
              resolve(null);
            };
            socket.once('data', data);
            socket.once('error', error);
            socket.once('end', end);
            socket.once('close', end);
            socket.resume();
          }),
        close: () => socket.destroy(),
      };
    },
  };
}

export function makeNodeDiagnostic({
  fetcher = fetch,
  network = nodeNetwork(),
  region = REGION,
} = {}) {
  let busy = false;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Diagnostic-Region', region);
    const send = (status, body) => res.status(status).json(body);
    if (req.method !== 'POST')
      return send(405, { error: 'POST 요청이 필요합니다.' });
    if (req.headers.origin && req.headers.origin !== SITE)
      return send(403, { error: '허용되지 않은 출처입니다.' });
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return send(401, { error: '로그인이 필요합니다.' });
    try {
      const headers = {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + token,
      };
      const auth = await fetcher(SUPABASE_URL + '/auth/v1/user', {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!auth.ok) return send(401, { error: '다시 로그인해 주세요.' });
      const user = await auth.json();
      if (user.id !== OWNER_ID)
        return send(403, { error: '본인 전용 진단입니다.' });
      const profile = await fetcher(
        SUPABASE_URL +
          '/rest/v1/user_profiles?select=id,active&id=eq.' +
          OWNER_ID,
        { headers, signal: AbortSignal.timeout(5000) },
      );
      if (
        !profile.ok ||
        !(await profile.json()).some(
          (p) => p.id === OWNER_ID && p.active === true,
        )
      )
        return send(403, { error: '활성 본인 계정만 사용할 수 있습니다.' });
      if (busy)
        return send(409, {
          error: '연결 진단이 실행 중입니다. 잠시 후 다시 시도해 주세요.',
        });
      busy = true;
      try {
        const result = await probePopConnection(network);
        return send(200, {
          ...result,
          execution_region: region,
          execution_runtime: 'vercel-node',
        });
      } finally {
        busy = false;
      }
    } catch {
      return send(503, { error: '연결 진단을 실행하지 못했습니다.' });
    }
  };
}
