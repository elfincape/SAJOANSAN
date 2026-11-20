const prefix = '[kakao-collector:v1] ';

export function kakaoSource(text) {
  if (!text?.startsWith(prefix)) return null;
  try {
    const meta = JSON.parse(text.slice(prefix.length).split('\n', 1)[0]);
    if (!['preview', 'auto'].includes(meta.mode) || typeof meta.room !== 'string' ||
        typeof meta.dateVerified !== 'boolean' || !Array.isArray(meta.aliases) ||
        meta.aliases.length > 8 || meta.aliases.some(a => typeof a !== 'string' || !a.trim() || a.length > 40))
      return null;
    return meta;
  } catch {
    return null;
  }
}

export function routeKakaoItems(items, source, intent, photoIntent) {
  for (const item of items) {
    const judgment = item.evidenceSource === 'image' ? photoIntent : intent;
    const signals = judgment?.signals ?? [];
    const heldTarget = items.some(candidate => candidate.ref === item.workRef && candidate.kakao?.held);
    const isUpdate = !heldTarget && !!item.workRef && ['update', 'change', 'completion', 'reference'].some(value => signals.includes(value));
    const owned = item.assignee && source.aliases.includes(item.assignee.trim());
    const isNew = !item.workRef && !!owned && signals.includes('new');
    // A model signal can route an already verified proposal, but never supply evidence.
    const hold = source.mode === 'preview' || judgment?.status !== 'ready' ||
      item.needsConfirmation || signals.includes('context') || signals.includes('other') ||
      (!isUpdate && !isNew) || ['complete', 'cancelled'].includes(item.workflowStatus) ||
      (!source.dateVerified && (item.dueOriginal || item.serviceOriginal || item.evidenceSource==='image'));
    item.kakao = {
      held: !!hold, route: hold ? 'confirmation' : isUpdate ? 'update' : 'new',
      intent: {status: judgment?.status ?? 'unavailable', model: judgment?.model, signals, code: judgment?.code},
      candidateWorkRef: item.workRef ?? null, proposedStatus: item.workflowStatus ?? null,
    };
    if (hold) Object.assign(item, {
      kind: 'reference', needsConfirmation: true, workRef: null, portalTaskId: null,
      workflowStatus: 'pending', ownerStateDeclared: false, done: false, completedAt: null,
      ...(source.dateVerified ? {} : {dueAt: null, dueDate: null, serviceDate: null}),
    });
  }
}
