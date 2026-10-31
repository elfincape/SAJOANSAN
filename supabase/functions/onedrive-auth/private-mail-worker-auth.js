import { APPROVED_MAIL_TARGET as TARGET } from './private-mail-policy.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYNC = new Set([
  'begin',
  'seen',
  'seen-many',
  'start-cycle',
  'attach-cycle',
  'upload-session',
  'upload-complete',
  'finish',
  'end',
]);

// Job capabilities are hashed in storage and bound to one task; never returned to browsers.
export async function authorizeMailWork(
  action,
  request,
  { token, legacyKey, db, hash, fail },
) {
  const denied = () => {
    throw fail('WORKER_AUTH_REQUIRED', 403);
  };
  if (
    typeof legacyKey === 'string' &&
    legacyKey.length >= 32 &&
    legacyKey.length <= 256 &&
    token === legacyKey
  )
    return;
  if (typeof token !== 'string' || !/^pmjob_[a-f0-9]{64}$/.test(token))
    denied();
  if (action === 'private-mail-background-work') {
    let imageRequest;
    try {
      const text = await request.clone().text();
      if (text.length > 4096) denied();
      imageRequest = JSON.parse(text);
    } catch {
      denied();
    }
    if (imageRequest?.operation === 'image-authorize') {
      if (
        imageRequest.mailbox !== TARGET.mailbox_id ||
        !UUID.test(imageRequest.id ?? '') ||
        typeof imageRequest.url !== 'string' ||
        imageRequest.url.length > 2000
      )
        denied();
      const allowed = await db('rpc/private_mail_image_transport_auth', {
        method: 'POST',
        body: {
          p_box: TARGET.mailbox_id,
          p_hash: await hash(token),
          p_message: imageRequest.id,
          p_url: imageRequest.url,
        },
      });
      if (allowed !== true) denied();
      return;
    }
  }
  const session = await db('rpc/private_mail_dispatch_auth', {
    method: 'POST',
    body: { p_hash: await hash(token) },
  });
  if (
    !session ||
    session.mailboxId !== TARGET.mailbox_id ||
    !['collect', 'analyze', 'report', 'history'].includes(session.kind)
  )
    denied();
  if (session.kind !== 'report' && !UUID.test(session.target ?? '')) denied();
  if (action === 'private-mail-background-file') {
    if (
      session.kind !== 'collect' ||
      session.jobRunning !== true ||
      request.headers.get('content-type') !== 'application/octet-stream'
    )
      denied();
    return;
  }
  let body;
  try {
    const text = await request.clone().text();
    if (
      text.length >
      (action === 'private-mail-background-work'
        ? 4096
        : 4 * 1024 * 1024 + 4096)
    )
      denied();
    body = JSON.parse(text);
  } catch {
    denied();
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    (body.mailbox !== undefined && body.mailbox !== TARGET.mailbox_id)
  )
    denied();
  if (action === 'private-mail-background-sync') {
    if (
      session.kind !== 'collect' ||
      session.jobRunning !== true ||
      !SYNC.has(body.operation) ||
      (body.requestId !== undefined && body.requestId !== session.target)
    )
      denied();
    return;
  }
  if (
    action !== 'private-mail-background-work' ||
    body.mailbox !== TARGET.mailbox_id
  )
    denied();
  if (session.kind === 'collect') {
    if (
      !['job-claim', 'job-finish'].includes(body.operation) ||
      body.id !== session.target ||
      (body.operation === 'job-finish' && session.jobRunning !== true)
    )
      denied();
  } else if (session.kind === 'analyze') {
    if (body.operation !== 'analyze' || body.id !== session.target) denied();
  } else if (session.kind === 'history') {
    if (body.operation !== 'history' || body.id !== session.target) denied();
  } else if (
    body.operation !== 'report' ||
    body.day !== session.target ||
    !/^\d{4}-\d{2}-\d{2}$/.test(session.target ?? '')
  )
    denied();
}
