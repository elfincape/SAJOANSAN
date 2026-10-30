import tls from 'node:tls';
import { uploadMailFile } from './private-mail-upload.mjs';
import { createHash } from 'node:crypto';
import {
  advanceCollection,
  validateCollection,
  collectionProgress,
} from '../supabase/functions/onedrive-auth/private-mail-collection-state.js';
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
  'BATCH_TIMEOUT',
  'FILE_UPLOAD_FAILED',
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
  'COLLECTION_CHANGED',
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
export function ownerBridge(
  authorization,
  fetcher = fetch,
  processingSignal,
  background = false,
) {
  const endpoint = background
    ? BRIDGE.replace('private-mail-owner-sync', 'private-mail-background-sync')
    : BRIDGE;
  let lease, mailbox;
  async function call(operation, values = {}, signal) {
    const body = JSON.stringify({ operation, mailbox, lease, ...values });
    if (
      Buffer.byteLength(body) >
      (operation === 'start-cycle' ? 4 * 1024 * 1024 : PACKAGE_LIMIT + 4096)
    )
      throw Error('LIMIT_REACHED');
    // Only the fixed Edge endpoint receives the user session; no redirects/retries.
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.any([
        AbortSignal.timeout(
          ['begin', 'start-cycle'].includes(operation)
            ? 15000
            : ['finish', 'upload-session', 'upload-complete'].includes(
                  operation,
                )
              ? 60000
              : 8000,
        ),
        ...(signal ? [signal] : []),
        ...(operation !== 'end' && processingSignal ? [processingSignal] : []),
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
    async seenMany(uidls, since) {
      const result = await call('seen-many', { uidls, since });
      if (
        !Array.isArray(result.seen) ||
        result.seen.some((id) => !uidls.includes(id))
      )
        throw Error('BRIDGE_REJECTED');
      if (
        !Array.isArray(result.publishedSince ?? []) ||
        (result.publishedSince ?? []).some((id) => !result.seen.includes(id))
      )
        throw Error('BRIDGE_REJECTED');
      return {
        seen: new Set(result.seen),
        recovered: new Set(result.publishedSince ?? []),
      };
    },
    async startCycle(uidls, requestId) {
      return validateCollection(
        (await call('start-cycle', { uidls, requestId })).cycle,
      );
    },
    async attachCycle(cycleId, requestId) {
      return validateCollection(
        (await call('attach-cycle', { cycleId, requestId })).cycle,
      );
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
        if (file.byte_size > 3276800) {
          const values = { ...metadata };
          delete values.operation;
          delete values.mailbox;
          delete values.lease;
          await uploadMailFile({
            file,
            fetcher,
            signal,
            begin: () => call('upload-session', values, signal),
            complete: () => call('upload-complete', values, signal),
          });
          continue;
        }
        const response = await fetcher(
          endpoint.replace(
            /private-mail-(owner|background)-sync$/,
            'private-mail-$1-file',
          ),
          {
            method: 'POST',
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/octet-stream',
              'X-Mail-Metadata': encodeURIComponent(JSON.stringify(metadata)),
            },
            body: file.bytes,
            signal: AbortSignal.any([
              AbortSignal.timeout(60000),
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
          Object.entries(counts || {}).filter(
            ([k]) =>
              !['cursor', 'processedUidls', 'cycleId', 'review'].includes(k),
          ),
        ),
        cursor: counts?.cursor ?? null,
        error: error ? 'SYNC_FAILED' : null,
        ...(Array.isArray(counts?.review) ? { review: counts.review } : {}),
        ...(counts?.cycleId
          ? {
              cycleId: counts.cycleId,
              processedUidls: counts.processedUidls ?? [],
            }
          : {}),
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
    background = false,
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
  if (input?.continuous !== undefined && typeof input.continuous !== 'boolean')
    return json({ error: 'MODE_REJECTED' }, 400);
  if (
    input.continuous &&
    (!/^[0-9a-f-]{36}$/i.test(input.requestId ?? '') ||
      (input.cycleId !== undefined && !/^[0-9a-f-]{36}$/i.test(input.cycleId)))
  )
    return json({ error: 'MODE_REJECTED' }, 400);
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
  const processing = new AbortController(),
    deadline = Date.now() + 180000;
  const bridge = ownerBridge(
    authorization,
    fetcher,
    processing.signal,
    background,
  );
  let pop,
    info,
    counts,
    cycle,
    progress,
    error,
    code,
    stage = 'begin';
  const budgetTimer = setTimeout(() => {
    processing.abort();
    pop?.close();
  }, 180000);
  try {
    info = await bridge.begin();
    if (input.continuous) {
      if (input.cycleId && info.cycle?.id !== input.cycleId)
        throw Object.assign(Error('COLLECTION_CHANGED'), {
          code: 'COLLECTION_CHANGED',
        });
      if (
        info.cycle?.phase === 'complete' &&
        (info.cycle.id === input.cycleId ||
          info.cycle.requestId === input.requestId)
      ) {
        cycle = validateCollection(info.cycle);
        counts = { saved: 0, processedUidls: [], cursor: info.cursor };
      } else if (info.cycle?.phase === 'collecting')
        cycle = await bridge.attachCycle(info.cycle.id, input.requestId);
    }
    if (!cycle || cycle.phase !== 'complete') {
      stage = 'connect';
      pop = await connect();
      processing.signal.throwIfAborted();
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
        if (input.continuous && !cycle) {
          const snapshot = (await pop.uidl())
            .reverse()
            .map(([, uidl]) => createHash('sha256').update(uidl).digest('hex'));
          if (Date.now() >= deadline)
            throw Object.assign(Error('BATCH_TIMEOUT'), {
              code: 'BATCH_TIMEOUT',
            });
          if (snapshot.length > 50000) throw Error('LIMIT_REACHED');
          cycle = await bridge.startCycle(snapshot, input.requestId);
        }
        const selected = cycle?.pending.slice(0, 50),
          known = selected
            ? await bridge.seenMany(selected, cycle.startedAt)
            : null;
        const seconds = (deadline - Date.now()) / 1000;
        if (seconds <= 0)
          throw Object.assign(Error('BATCH_TIMEOUT'), {
            code: 'BATCH_TIMEOUT',
          });
        counts = await syncBatch({
          pop,
          bridge: known
            ? {
                seen: async (id) => known.seen.has(id),
                recovered: async (id) => known.recovered.has(id),
                ingest: bridge.ingest,
              }
            : bridge,
          cutoff: new Date(info.cutoff),
          cursor: info.cursor,
          packageMessage: packager,
          batch: 20,
          seconds: Math.min(seconds, 180),
          uidls: selected ?? null,
        });
      }
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
    clearTimeout(budgetTimer);
    pop?.close();
    if (cycle) {
      try {
        counts ??= { saved: 0, processedUidls: [], cursor: info.cursor };
        counts.processedUidls ??= [];
        counts.cycleId = cycle.id;
        progress = collectionProgress(advanceCollection(cycle, counts));
        counts.deferred = progress.remaining;
        if (code === 'BATCH_TIMEOUT' && counts.processedUidls.length) {
          error = false;
          code = undefined;
        }
      } catch {
        error = true;
        code = 'FINALIZE_FAILED';
        stage = 'finalize';
      }
    }
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
          Object.entries(counts).filter(
            ([key]) =>
              !['cursor', 'processedUidls', 'cycleId', 'review'].includes(key),
          ),
        ),
        ...(progress ? { progress } : {}),
      });
}
