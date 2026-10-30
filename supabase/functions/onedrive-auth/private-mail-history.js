import { APPROVED_MAIL_TARGET as TARGET } from './private-mail-policy.js';
import { verifyMailStream } from './private-mail-stream-verify.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 262144;
const forbidden =
  /^(?:key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|password|secret|bearer|proof|verifier|encrypted[_-]?(?:tokens|notes[_-]?tokens)|uploadUrl|downloadUrl|rawResponse|rawText|headers|bytes|data)$/i;
const enc = encodeURIComponent;
const invalid = () => {
  throw Error('HISTORY_FORMAT');
};
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200)
    invalid();
  return value.trim();
}
function stamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value))
    invalid();
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) invalid();
  return result.toISOString();
}
function canonical(value) {
  let nodes = 0;
  const copy = (item, depth) => {
    if (++nodes > 20000 || depth > 20) invalid();
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid();
      return item;
    }
    if (typeof item === 'string') {
      if (item.length > 100000) invalid();
      return item;
    }
    if (Array.isArray(item)) return item.map((part) => copy(part, depth + 1));
    if (
      !item ||
      typeof item !== 'object' ||
      Object.getPrototypeOf(item) !== Object.prototype
    )
      invalid();
    const result = Object.create(null);
    for (const key of Object.keys(item).sort()) {
      if (
        forbidden.test(key) ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      )
        invalid();
      result[key] = copy(item[key], depth + 1);
    }
    return result;
  };
  return copy(value, 0);
}
async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
async function documentFor(record, originalPayload = null) {
  const payload = originalPayload ?? JSON.stringify(canonical(record)),
    bytes = new TextEncoder().encode(payload);
  if (bytes.length > LIMIT) throw Error('HISTORY_LIMIT');
  const historyId = await digest(bytes);
  return {
    historyId,
    fileName:
      'analysis-history_' +
      record.source.kind +
      '_' +
      record.source.id +
      '_' +
      historyId +
      '.json',
    byteSize: bytes.length,
    contentHash: historyId,
    payload,
    record: JSON.parse(payload),
    bytes,
  };
}

// Only normalized results and explicit owner corrections belong here, never a raw mail or provider response.
export async function createMailHistoryDocument({
  kind,
  sourceId,
  revision,
  eventAt,
  model,
  rulesVersion,
  structuredResult,
  correction = null,
  completionEvents = [],
}) {
  if (
    !['mail', 'manual'].includes(kind) ||
    !UUID.test(sourceId ?? '') ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !structuredResult ||
    typeof structuredResult !== 'object' ||
    !Array.isArray(completionEvents) ||
    completionEvents.length > 5000
  )
    invalid();
  const events = completionEvents.map((event) => {
    if (
      !event ||
      typeof event.done !== 'boolean' ||
      Object.keys(event).some(
        (key) => !['done', 'at', 'ref', 'itemId'].includes(key),
      )
    )
      invalid();
    const result = { done: event.done, at: stamp(event.at) };
    if (event.ref != null) result.ref = label(event.ref);
    if (event.itemId != null) result.itemId = label(event.itemId);
    return result;
  });
  return documentFor({
    schema: 'sajoansan-mail-history-v1',
    ownerId: TARGET.owner_id,
    mailboxId: TARGET.mailbox_id,
    source: { kind, id: sourceId.toLowerCase() },
    revision,
    eventAt: stamp(eventAt),
    model: model == null ? null : label(model),
    rulesVersion: label(rulesVersion),
    structuredResult,
    correction,
    completionEvents: events,
  });
}

export async function restoreMailHistoryDocument(
  record,
  originalPayload = null,
) {
  if (
    record?.schema !== 'sajoansan-mail-history-v1' ||
    record.ownerId !== TARGET.owner_id ||
    record.mailboxId !== TARGET.mailbox_id
  )
    throw Error('HISTORY_TARGET');
  if (
    Object.keys(record).some(
      (key) =>
        ![
          'schema',
          'ownerId',
          'mailboxId',
          'source',
          'revision',
          'eventAt',
          'model',
          'rulesVersion',
          'structuredResult',
          'correction',
          'completionEvents',
        ].includes(key),
    )
  )
    invalid();
  const normalized = await createMailHistoryDocument({
    kind: record.source?.kind,
    sourceId: record.source?.id,
    revision: record.revision,
    eventAt: record.eventAt,
    model: record.model,
    rulesVersion: record.rulesVersion,
    structuredResult: record.structuredResult,
    correction: record.correction,
    completionEvents: record.completionEvents,
  });
  if (originalPayload == null) return normalized;
  if (
    typeof originalPayload !== 'string' ||
    new TextEncoder().encode(originalPayload).length > LIMIT
  )
    invalid();
  let parsed;
  try {
    parsed = JSON.parse(originalPayload);
  } catch {
    invalid();
  }
  if (JSON.stringify(canonical(parsed)) !== JSON.stringify(canonical(record)))
    invalid();
  // PostgreSQL jsonb::text has different key order/spacing; those original bytes define its immutable version.
  return documentFor(record, originalPayload);
}

export async function writeMailHistoryDocument({
  document,
  mailbox,
  environment,
  withLock,
  graph,
  privateDestination,
  privatePermissions,
}) {
  const checked = await restoreMailHistoryDocument(
    document?.record,
    document?.payload,
  );
  if (
    document.historyId !== checked.historyId ||
    document.fileName !== checked.fileName ||
    document.contentHash !== checked.contentHash ||
    document.byteSize !== checked.byteSize
  )
    throw Error('HISTORY_CONFLICT');
  if (
    [
      mailbox,
      environment,
      withLock,
      graph,
      privateDestination,
      privatePermissions,
    ].some((value) => typeof value !== 'function')
  )
    throw Error('HISTORY_TARGET');
  return withLock(async () => {
    const box = await mailbox(TARGET.mailbox_id);
    if (
      box?.id !== TARGET.mailbox_id ||
      box.owner_id !== TARGET.owner_id ||
      box.enabled !== true ||
      !/^[A-Za-z0-9!_-]+$/.test(box.drive_id ?? '') ||
      !/^[A-Za-z0-9!_-]+$/.test(box.folder_id ?? '')
    )
      throw Error('HISTORY_TARGET');
    const env = await environment();
    if (String(env.driveId).toLowerCase() !== box.drive_id.toLowerCase())
      throw Error('HISTORY_TARGET');
    // This is the existing pinned destination/accepted-sharing policy, supplied by private-mail.js.
    const driveOwner = await privateDestination(box, env);
    const path =
      '/drives/' +
      enc(box.drive_id) +
      '/items/' +
      enc(box.folder_id) +
      ':/' +
      enc(checked.fileName);
    const find = async () => {
      const response = await graph(
        path + '?$select=id,name,size,file,parentReference,remoteItem',
        env.access,
        { allowMissing: true },
      );
      return response ? response.json() : null;
    };
    const verify = async (item) => {
      if (
        !item?.file ||
        !item.id ||
        item.remoteItem ||
        item.name !== checked.fileName ||
        item.size !== checked.byteSize ||
        item.parentReference?.id !== box.folder_id ||
        String(item.parentReference?.driveId).toLowerCase() !==
          box.drive_id.toLowerCase()
      )
        throw Error('HISTORY_CONFLICT');
      await privatePermissions(box, item.id, env, driveOwner, item);
      const response = await graph(
        '/drives/' + enc(box.drive_id) + '/items/' + enc(item.id) + '/content',
        env.access,
      );
      try {
        await verifyMailStream(response, {
          expectedBytes: checked.byteSize,
          expectedHash: checked.contentHash,
        });
      } catch {
        throw Error('HISTORY_CONFLICT');
      }
      return {
        historyId: checked.historyId,
        itemId: item.id,
        fileName: checked.fileName,
        contentHash: checked.contentHash,
        byteSize: checked.byteSize,
      };
    };
    const old = await find();
    if (old) return { ...(await verify(old)), status: 'existing' };
    let item;
    try {
      item = await (
        await graph(
          path + ':/content?@microsoft.graph.conflictBehavior=fail',
          env.access,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: checked.bytes,
          },
        )
      ).json();
    } catch {
      // Conflict or an uncertain acknowledgment is recovered only by checking the exact deterministic file.
      const recovered = await find();
      if (recovered)
        return { ...(await verify(recovered)), status: 'existing' };
      throw Error('HISTORY_RETRY');
    }
    return { ...(await verify(item)), status: 'saved' };
  });
}
