const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UIDL = /^[0-9a-f]{64}$/;
const keys = ['saved', 'skipped', 'undated', 'oversized', 'missing'];
export function validateCollection(state) {
  if (
    !state ||
    !ID.test(state.id) ||
    (state.requestId !== undefined && !ID.test(state.requestId)) ||
    !Number.isFinite(Date.parse(state.startedAt)) ||
    !Array.isArray(state.pending) ||
    state.pending.length > 50000 ||
    state.pending.some((id) => !UIDL.test(id)) ||
    new Set(state.pending).size !== state.pending.length ||
    !Number.isInteger(state.total) ||
    state.total < 0 ||
    state.total > 50000 ||
    !Number.isInteger(state.processed) ||
    state.processed < 0 ||
    state.processed + state.pending.length !== state.total ||
    keys.some(
      (key) =>
        !Number.isInteger(state[key]) ||
        state[key] < 0 ||
        state[key] > state.processed,
    ) ||
    state.phase !== (state.pending.length ? 'collecting' : 'complete')
  )
    throw Error('COLLECTION_STATE');
  return state;
}
export function startCollection(uidls, id, startedAt, requestId = id) {
  if (!Array.isArray(uidls) || uidls.length > 50000)
    throw Error('COLLECTION_STATE');
  return validateCollection({
    id,
    requestId,
    startedAt,
    pending: [...uidls],
    total: uidls.length,
    processed: 0,
    saved: 0,
    skipped: 0,
    undated: 0,
    oversized: 0,
    missing: 0,
    phase: uidls.length ? 'collecting' : 'complete',
  });
}
export function advanceCollection(state, counts) {
  validateCollection(state);
  const ids = counts.processedUidls;
  if (
    !Array.isArray(ids) ||
    ids.length > 50 ||
    ids.some((id, index) => id !== state.pending[index])
  )
    throw Error('COLLECTION_CHECKPOINT');
  const delta = Object.fromEntries(keys.map((key) => [key, counts[key] ?? 0]));
  if (
    !Number.isInteger(counts.recovered ?? 0) ||
    (counts.recovered ?? 0) < 0 ||
    (counts.recovered ?? 0) > ids.length
  )
    throw Error('COLLECTION_COUNTS');
  delta.saved += counts.recovered ?? 0;
  if (
    keys.some(
      (key) =>
        !Number.isInteger(delta[key]) ||
        delta[key] < 0 ||
        delta[key] > ids.length,
    ) ||
    delta.saved + delta.skipped + delta.undated + delta.oversized > ids.length
  )
    throw Error('COLLECTION_COUNTS');
  const next = {
    ...state,
    pending: state.pending.slice(ids.length),
    processed: state.processed + ids.length,
  };
  for (const key of keys) next[key] = state[key] + delta[key];
  next.phase = next.pending.length ? 'collecting' : 'complete';
  return validateCollection(next);
}
export function collectionProgress(state) {
  validateCollection(state);
  return {
    cycleId: state.id,
    total: state.total,
    processed: state.processed,
    saved: state.saved,
    skipped: state.skipped,
    undated: state.undated,
    oversized: state.oversized,
    missing: state.missing,
    remaining: state.pending.length,
    phase: state.phase,
  };
}
