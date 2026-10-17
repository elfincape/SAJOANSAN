import tls from 'node:tls';
import { ReadOnlyPop, syncBatch } from './private-mail-collector.mjs';
import {
  packageMessage,
  RAW_LIMIT,
  PACKAGE_LIMIT,
} from './private-mail-package.mjs';
const BRIDGE =
  'https://vvrppotrnpwrwpwqaiet.supabase.co/functions/v1/onedrive-auth/private-mail-owner-sync';
const SITE = 'https://sajoansan.vercel.app';
const SAFE_CODES = new Set([
  'POP_USER_REJECTED',
  'POP_PASSWORD_REJECTED',
  'POP_AUTH_TIMEOUT',
  'POP_AUTH_CLOSED',
  'POP_AUTH_PROTOCOL_ERROR',
  'POP_MAILBOX_BUSY',
  'POP_LOGIN_DELAY',
  'POP_AUTH_SERVER_ERROR',
  'OWNER_SYNC_DISABLED',
  'AUTH_REQUIRED',
  'OWNER_CONNECTION_REQUIRED',
  'MAILBOX_TARGET_REJECTED',
  'OWNER_FOLDER_REQUIRED',
  'DRIVE_OWNER_UNAVAILABLE',
  'PERMISSIONS_INCOMPLETE',
  'ANONYMOUS_LINK_PRESENT',
  'ORGANIZATION_LINK_PRESENT',
  'SHARING_LINK_PRESENT',
  'INVITATION_PRESENT',
  'PERMISSION_IDENTITY_UNAVAILABLE',
  'OTHER_PRINCIPAL_PRESENT',
  'MAILBOX_BUSY',
  'FOLDER_CHECK_FAILED',
  'BEGIN_FAILED',
]);
export async function openPop() {
  const socket = tls.connect({
    host: 'mail.onnet21.com',
    port: 995,
    servername: 'mail.onnet21.com',
    rejectUnauthorized: true,
  });
  socket.on('error', () => {});
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(Error('TLS_TIMEOUT'));
      }, 3000);
      socket.once('secureConnect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', () => {
        clearTimeout(timer);
        reject(Error('TLS_FAILED'));
      });
    });
  } catch {
    socket.destroy();
    throw Error('TLS_FAILED');
  }
  const reader = socket[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  return new ReadOnlyPop(
    {
      async write(bytes) {
        await new Promise((resolve, reject) =>
          socket.write(bytes, (error) =>
            error ? reject(Error('POP_FAILED')) : resolve(),
          ),
        );
      },
      async read(buffer) {
        if (!pending.length) {
          const next = await reader.next();
          if (next.done) return null;
          pending = next.value;
        }
        const n = Math.min(buffer.length, pending.length);
        buffer.set(pending.subarray(0, n));
        pending = pending.subarray(n);
        return n;
      },
      close() {
        socket.destroy();
      },
    },
    { maxBytes: RAW_LIMIT },
  );
}
export function ownerBridge(authorization, fetcher = fetch) {
  let lease, mailbox;
  async function call(operation, values = {}, signal) {
    const body = JSON.stringify({ operation, mailbox, lease, ...values });
    if (Buffer.byteLength(body) > PACKAGE_LIMIT + 4096)
      throw Error('LIMIT_REACHED');
    // Only the fixed Edge endpoint receives the user session; no redirects/retries.
    const response = await fetcher(BRIDGE, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.any([
        AbortSignal.timeout(operation === 'begin' ? 15000 : 8000),
        ...(signal ? [signal] : []),
      ]),
      redirect: 'error',
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw Object.assign(Error('BRIDGE_REJECTED'), {
        status: response.status,
        code: SAFE_CODES.has(failure.error) ? failure.error : undefined,
      });
    }
    return response.json();
  }
  return {
    async begin() {
      const info = await call('begin');
      if (
        !/^[0-9a-f-]{36}$/i.test(info.lease) ||
        !/^[0-9a-f-]{36}$/i.test(info.mailbox) ||
        !Number.isFinite(Date.parse(info.cutoff))
      )
        throw Error('BRIDGE_REJECTED');
      lease = info.lease;
      mailbox = info.mailbox;
      return info;
    },
    async seen(uidl, { signal } = {}) {
      return (await call('seen', { uidl }, signal)).seen === true;
    },
    async ingest(message, { signal } = {}) {
      for (const [index, file] of message.files.entries()) {
        signal?.throwIfAborted();
        const metadata = {
          operation: 'file',
          mailbox,
          lease,
          uidl: message.uidl,
          hash: message.hash,
          index,
          kind: file.kind,
          name: file.name,
          byte_size: file.byte_size,
          content_hash: file.content_hash,
        };
        const response = await fetcher(
          BRIDGE.replace('private-mail-owner-sync', 'private-mail-owner-file'),
          {
            method: 'POST',
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/octet-stream',
              'X-Mail-Metadata': encodeURIComponent(JSON.stringify(metadata)),
            },
            body: file.bytes,
            signal: AbortSignal.any([
              AbortSignal.timeout(30000),
              ...(signal ? [signal] : []),
            ]),
            redirect: 'error',
          },
        );
        if (!response.ok) throw Error('FILE_UPLOAD_FAILED');
        // The response contains only a reference, never content or upload capabilities.
        await response.json();
      }
      const metadata = {
        ...message,
        files: message.files.map(({ bytes, ...file }) => file),
      };
      return call('finish', { message: metadata }, signal);
    },
    async end(counts, error) {
      const payload = {
        counts: Object.fromEntries(
          Object.entries(counts || {}).filter(([k]) => k !== 'cursor'),
        ),
        cursor: counts?.cursor ?? null,
        error: error ? 'SYNC_FAILED' : null,
      };
      const signal = AbortSignal.timeout(20000);
      for (;;) {
        try {
          return await call('end', payload, signal);
        } catch (failure) {
          if (failure.status !== 409 || signal.aborted) throw failure;
          await new Promise((resolve) => setTimeout(resolve, 250));
          signal.throwIfAborted();
        }
      }
    },
  };
}
export async function handleOwnerCollect(
  request,
  {
    env = process.env,
    fetcher = fetch,
    connect = openPop,
    packager = packageMessage,
    logger = (entry) => console.warn(entry),
  } = {},
) {
  const json = (data, status = 200) =>
    Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return json({ error: 'POST_REQUIRED' }, 405);
  if (request.headers.get('origin') && request.headers.get('origin') !== SITE)
    return json({ error: 'FORBIDDEN' }, 403);
  const authorization = request.headers.get('authorization');
  if (!/^Bearer .+$/i.test(authorization || ''))
    return json({ error: 'AUTH_REQUIRED' }, 401);
  const input = await request.json().catch(() => ({}));
  const mode = input?.mode ?? 'collect';
  if (!['login', 'collect'].includes(mode))
    return json({ error: 'MODE_REJECTED' }, 400);
  // No network, credential use or mailbox mutation until all explicit gates pass.
  if (
    env.MAIL_COLLECTION_ENABLED !== 'yes' ||
    env.VERCEL_REGION !== 'icn1' ||
    !env.MAIL_POP_PASSWORD ||
    /[\r\n\0]/.test(env.MAIL_POP_PASSWORD) ||
    env.MAIL_POP_PASSWORD.length > 1024
  ) {
    logger(
      JSON.stringify({
        event: 'private_mail',
        stage: 'configuration',
        code: 'COLLECTION_NOT_CONFIGURED',
      }),
    );
    return json(
      {
        error: 'COLLECTION_NOT_CONFIGURED',
        code: 'COLLECTION_NOT_CONFIGURED',
        stage: 'configuration',
      },
      503,
    );
  }
  const bridge = ownerBridge(authorization, fetcher);
  let pop,
    info,
    counts,
    error,
    code,
    stage = 'begin';
  try {
    info = await bridge.begin();
    stage = 'connect';
    pop = await connect();
    await pop.greeting();
    stage = 'login';
    await pop.login('jhs96@eangroup.kr', env.MAIL_POP_PASSWORD);
    if (mode === 'login')
      counts = {
        saved: 0,
        skipped: 0,
        undated: 0,
        oversized: 0,
        deferred: 0,
        cursor: info.cursor,
      };
    else {
      stage = 'collect';
      counts = await syncBatch({
        pop,
        bridge,
        cutoff: new Date(info.cutoff),
        cursor: info.cursor,
        packageMessage: packager,
        batch: 1,
        seconds: 40,
      });
    }
  } catch (failure) {
    if (failure?.counts) counts = failure.counts;
    error = true;
    code = SAFE_CODES.has(failure?.code)
      ? failure.code
      : {
          begin: 'BEGIN_FAILED',
          connect: 'POP_CONNECTION_FAILED',
          login: 'POP_LOGIN_FAILED',
          collect: 'COLLECTION_FAILED',
        }[stage];
  } finally {
    pop?.close();
    if (info)
      try {
        await bridge.end(counts || { cursor: info.cursor }, error);
      } catch {
        error = true;
        if (!code) {
          code = 'FINALIZE_FAILED';
          stage = 'finalize';
        }
      }
  }
  if (error) logger(JSON.stringify({ event: 'private_mail', stage, code }));
  return error
    ? json({ error: 'SYNC_FAILED', code, stage }, 503)
    : json({
        ok: true,
        mode,
        region: env.VERCEL_REGION,
        counts: Object.fromEntries(
          Object.entries(counts).filter(([key]) => key !== 'cursor'),
        ),
      });
}
