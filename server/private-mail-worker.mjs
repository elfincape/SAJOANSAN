import { downloadPublicMailImage } from './private-mail-public-image.mjs';
import { timingSafeEqual } from 'node:crypto';
import { handleOwnerCollect } from './private-mail-owner-collect.mjs';
const BRIDGE =
  'https://vvrppotrnpwrwpwqaiet.supabase.co/functions/v1/onedrive-auth/private-mail-background-work';
const BOX = '39045005-313e-42e1-b50c-2394b3b6ff26';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODES = new Set([
  'BATCH_TIMEOUT',
  'FILE_UPLOAD_FAILED',
  'MAILBOX_BUSY',
  'POP_MAILBOX_BUSY',
  'POP_CONNECTION_FAILED',
  'POP_LOGIN_FAILED',
  'COLLECTION_FAILED',
  'COLLECTION_CHANGED',
  'FINALIZE_FAILED',
  'OWNER_SYNC_DISABLED',
  'BEGIN_FAILED',
  'COLLECTION_NOT_CONFIGURED',
  'FILE_HASH_REJECTED',
  'FILE_NOT_UPLOADED',
  'FILE_METADATA_REJECTED',
  'EML_HASH_REJECTED',
  'UPLOAD_SESSION_REJECTED',
  'COLLECTION_CHECKPOINT',
  'ONEDRIVE_LOCK_BUSY',
  'ONEDRIVE_LOCK_EXPIRED',
  'ONEDRIVE_ACCOUNT_MISMATCH',
  'ONEDRIVE_METADATA_MISMATCH',
  'ONEDRIVE_CONTENT_MISMATCH',
  'MAILBOX_LEASE_EXPIRED',
]);
export async function handlePrivateMailWorker(
  request,
  {
    env = process.env,
    fetcher = fetch,
    collect = handleOwnerCollect,
    logger = (entry) => console.warn(entry),
    downloadImage = downloadPublicMailImage,
  } = {},
) {
  const json = (value, status = 200) =>
    Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return json({ error: 'POST_REQUIRED' }, 405);
  const key = env.MAIL_COLLECTOR_KEY,
    authorization = request.headers.get('authorization'),
    token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
  const staticKey =
    typeof key === 'string' &&
    key.length >= 32 &&
    key.length <= 256 &&
    typeof token === 'string' &&
    Buffer.byteLength(token) === Buffer.byteLength(key) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(key));
  // Capability syntax only permits forwarding; Edge validates its hash, TTL and target.
  const authorizedCandidate =
    staticKey || /^pmjob_[a-f0-9]{64}$/.test(token ?? '');
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 4096) throw Error();
    body = JSON.parse(raw);
  } catch {
    return authorizedCandidate
      ? json({ error: 'REQUEST_INVALID' }, 400)
      : json({ error: 'WORKER_AUTH_REQUIRED' }, 403);
  }
  if (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.keys(body).length === 2 &&
    body.kind === 'probe' &&
    body.mailboxId === BOX
  )
    return json({
      configured:
        env.MAIL_COLLECTION_ENABLED === 'yes' &&
        env.VERCEL_REGION === 'icn1' &&
        typeof env.MAIL_POP_PASSWORD === 'string' &&
        env.MAIL_POP_PASSWORD.length > 0 &&
        env.MAIL_POP_PASSWORD.length <= 1024 &&
        !/[\r\n\0]/.test(env.MAIL_POP_PASSWORD),
    });
  if (!authorizedCandidate) return json({ error: 'WORKER_AUTH_REQUIRED' }, 403);
  if (body?.kind === 'remote-image') {
    if (!staticKey) return json({ error: 'WORKER_AUTH_REQUIRED' }, 403);
    if (
      body.mailboxId !== BOX ||
      !UUID.test(body.messageId ?? '') ||
      typeof body.url !== 'string' ||
      body.url.length > 2000
    )
      return json({ error: 'WORKER_TARGET_REJECTED' }, 400);
    try {
      return await downloadImage(body.url);
    } catch {
      return json({ error: 'REMOTE_IMAGE_SOURCE' }, 422);
    }
  }

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    body.mailboxId !== BOX ||
    !['collect', 'analyze', 'report', 'history'].includes(body.kind)
  )
    return json({ error: 'WORKER_TARGET_REJECTED' }, 400);
  if (
    (body.kind === 'collect' &&
      (typeof body.jobId !== 'string' || !UUID.test(body.jobId))) ||
    (body.kind === 'analyze' &&
      (typeof body.messageId !== 'string' || !UUID.test(body.messageId))) ||
    (body.kind === 'history' &&
      (typeof body.historyId !== 'string' || !UUID.test(body.historyId))) ||
    (body.kind === 'report' &&
      (typeof body.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)))
  )
    return json({ error: 'WORKER_TARGET_REJECTED' }, 400);
  async function edge(payload, timeout = 20000) {
    const response = await fetcher(BRIDGE, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, mailbox: BOX }),
      signal: AbortSignal.timeout(timeout),
      redirect: 'error',
    });
    if (!response.ok)
      throw Object.assign(Error('WORKER_BRIDGE_FAILED'), {
        status: [401, 403].includes(response.status) ? 403 : 503,
      });
    return response.json();
  }
  try {
    if (['analyze', 'report', 'history'].includes(body.kind)) {
      const result = await edge(
        {
          operation: body.kind,
          ...(body.kind === 'history'
            ? { id: body.historyId }
            : body.kind === 'analyze'
              ? { id: body.messageId }
              : { day: body.day }),
        },
        210000,
      );
      return json({
        status: [
          'done',
          'failed',
          'skipped',
          'stale',
          'busy',
          'created',
          'updated',
          'reconciled',
          'waiting',
          'pending',
        ].includes(result.status)
          ? result.status
          : 'processed',
      });
    }
    const lease = crypto.randomUUID(),
      claim = await edge({ operation: 'job-claim', id: body.jobId, lease });
    if (!claim?.job) return json({ status: 'busy' });
    if (
      claim.job.id !== body.jobId ||
      (claim.job.cycleId != null &&
        (typeof claim.job.cycleId !== 'string' ||
          !UUID.test(claim.job.cycleId)))
    )
      throw Error('WORKER_TARGET_REJECTED');
    let progress = null,
      error = null;
    try {
      const collected = await collect(
        new Request('https://sajoansan.vercel.app/api/private-mail-collect', {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            continuous: true,
            requestId: claim.job.id,
            ...(claim.job.cycleId ? { cycleId: claim.job.cycleId } : {}),
          }),
        }),
        { env, fetcher, background: true, logger },
      );
      const result = await collected.json();
      if (collected.ok) progress = result.progress ?? null;
      else error = CODES.has(result.code) ? result.code : 'COLLECTION_FAILED';
    } catch {
      error = 'COLLECTION_FAILED';
    }
    const result = await edge({
      operation: 'job-finish',
      id: body.jobId,
      lease,
      progress,
      error,
    });
    return json({ status: result.job?.status ?? 'processed' });
  } catch (failure) {
    const denied = failure?.status === 403;
    logger(
      JSON.stringify({
        event: 'private_mail_worker',
        kind: body.kind,
        code: denied ? 'WORKER_AUTH_REQUIRED' : 'WORKER_FAILED',
      }),
    );
    return json(
      { error: denied ? 'WORKER_AUTH_REQUIRED' : 'WORKER_FAILED' },
      denied ? 403 : 503,
    );
  }
}
