const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value, limit = 1000) =>
  typeof value === 'string' && value.trim() && value.length <= limit
    ? value.trim()
    : null;
const states = new Set([
  'pending',
  'in_progress',
  'waiting',
  'complete',
  'cancelled',
]);
export const WORK_FORMAT = 'sajo-daily-work-v1';
export function validWorkRef(value) {
  return (
    typeof value === 'string' &&
    (new RegExp('^source:[0-9a-f-]{36}$', 'i').test(value) ||
      /^[0-9a-f-]{36}:(?:tasks|issues|waiting|imageTasks|imageIssues|imageWaiting):\d{1,8}$/i.test(
        value,
      ) ||
      /^[0-9a-f-]{36}:manual:item-\d{3}$/i.test(value)) &&
    uuid.test(value.startsWith('source:') ? value.slice(7) : value.slice(0, 36))
  );
}
function stamp(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw Error('WORK_DATE');
  return new Date(value).toISOString();
}
function calendar(value) {
  if (value == null) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw Error('WORK_DATE');
  return value;
}
function sourceRef(source, kind, ref) {
  if (!uuid.test(source?.id ?? '')) throw Error('WORK_SOURCE');
  return {
    kind,
    id: source.id,
    ref,
    title: clean(source.subject, 500),
    receivedAt: stamp(source.receivedAt ?? source.sentAt),
    dateBasis:
      kind === 'mail' ? (source.receivedAt ? 'received' : 'sent') : 'input',
    collectedAt: stamp(source.collectedAt),
    evidence: clean(source.evidence, 3000),
    intentCorrected: source.intentCorrected === true,
  };
}
export function normalizeDailyWork(input) {
  if (
    !input ||
    !validWorkRef(input.ref) ||
    !['task', 'issue', 'reference'].includes(input.category) ||
    !clean(input.title)
  )
    throw Error('WORK_FORMAT');
  if (!states.has(input.status)) throw Error('WORK_STATUS');
  if (
    !Array.isArray(input.sourceRefs) ||
    !input.sourceRefs.length ||
    input.sourceRefs.length > 100
  )
    throw Error('WORK_SOURCE');
  const refs = input.sourceRefs.map((source) => {
    if (
      !uuid.test(source.id ?? '') ||
      !['mail', 'manual', 'assistant', 'linked'].includes(source.kind) ||
      !validWorkRef(source.ref)
    )
      throw Error('WORK_SOURCE');
    return {
      kind: source.kind,
      id: source.id,
      ref: source.ref,
      title: clean(source.title, 500),
      receivedAt: stamp(source.receivedAt),
      dateBasis:
        source.dateBasis ?? (source.kind === 'mail' ? 'sent' : 'input'),
      collectedAt: stamp(source.collectedAt),
      evidence: clean(source.evidence, 3000),
      intentCorrected: source.intentCorrected === true,
    };
  });
  const workId = input.linkedWorkRef ?? input.ref;
  if (!validWorkRef(workId)) throw Error('WORK_SOURCE');
  const portalTaskId = input.portalTaskId == null ? null : input.portalTaskId;
  if (portalTaskId !== null && !uuid.test(portalTaskId))
    throw Error('WORK_SOURCE');
  return {
    schema: WORK_FORMAT,
    workId,
    portalTaskId,
    controlRef:
      input.category === 'task' ||
      (input.ref.includes(':manual:') && input.category === 'issue')
        ? (input.controlRef ?? input.ref)
        : null,
    category: input.category,
    reportKind: ['routine', 'review'].includes(input.reportKind)
      ? input.reportKind
      : null,
    title: clean(input.title),
    summary: [
      ...new Set(
        (input.summary ?? [])
          .map((item) => clean(item))
          .filter(
            (item) =>
              item &&
              item !== input.title &&
              (input.category === 'reference' ||
                !repeatsWorkTitle(item, input.title)),
          ),
      ),
    ].slice(0, 6),
    nextAction: clean(input.nextAction),
    progress: clean(input.progress),
    waitingFor: clean(input.waitingFor, 100),
    center: clean(input.center, 100),
    customer: clean(input.customer, 200),
    requester: clean(input.requester, 100),
    assignee: input.assigneeConfirmed ? clean(input.assignee, 100) : null,
    requestedAt: stamp(input.requestedAt),
    dueAt: stamp(input.dueAt),
    dueDate: calendar(input.dueDate),
    serviceDate: calendar(input.serviceDate),
    status: input.status,
    closedAt: stamp(input.closedAt),
    ownerStateAt: stamp(input.ownerStateAt),
    inferredStateAt: stamp(input.inferredStateAt),
    sourceRefs: refs,
    needsConfirmation: input.needsConfirmation === true,
    confirmationReasons: (input.confirmationReasons ?? []).map(value => clean(value,300)).filter(Boolean).slice(0,4),
    originRef: input.ref,
  };
}
export function needsOwnerReview(mail) {
  if (
    mail.source?.intentCorrected === true ||
    mail.intent?.ownerFeedback === true ||
    ['reference', 'routine'].includes(mail.source?.intent)
  )
    return false;
  return (
    mail.source?.intent === 'unknown' ||
    (mail.review?.withheldTasks ?? 0) + (mail.review?.withheldWaiting ?? 0) > 0
  );
}
export function isRoutineMail(mail) {
  const explicitReference =
    mail.source?.intentCorrected === true ||
    mail.intent?.ownerFeedback === true;
  return (
    mail.source?.intent === 'routine' ||
    (!explicitReference &&
      mail.source?.intent === 'reference' &&
      !(mail.tasks?.length || mail.waiting?.length) &&
      /일일|정기|주간|월간/.test(mail.source?.subject ?? '') &&
      /점검|보고|실적/.test(mail.source?.subject ?? ''))
  );
}
function mailSummaryTexts(mail) {
  if (mail.summary?.length) return mail.summary.map((item) => item.text);
  const included = new Set(
    (mail.imageDecisions ?? [])
      .filter(
        (item) =>
          item.include &&
          ['business_document', 'business_scene'].includes(item.kind),
      )
      .map((item) => item.imageId),
  );
  return [
    ...new Set(
      (mail.imageFacts ?? [])
        .filter(
          (item) =>
            item.confidence === 'readable' && included.has(item.imageId),
        )
        .map((item) => item.text),
    ),
  ].slice(0, 6);
}
export function ownerWorkCorrection(overrides, workId, day) {
  const current = overrides?.['work:' + workId];
  if (!current || current.actor !== 'owner' || !day) return current;
  const end = Date.parse(day + 'T00:00:00+09:00') + 86400000;
  const snapshots = Array.isArray(current.events) ? current.events : [current];
  const historical = snapshots
    .filter(
      (value) =>
        Number.isFinite(Date.parse(value.updatedAt)) &&
        Date.parse(value.updatedAt) < end,
    )
    .at(-1);
  return {
    ...current,
    currentDone: current.done ?? null,
    done: historical?.done ?? null,
    doneAt: historical?.doneAt ?? historical?.updatedAt ?? null,
  };
}
export function applyOwnerWorkCorrection(item, overrides = {}, day) {
  const correction = ownerWorkCorrection(overrides, item.workId, day);
  if (!correction || correction.actor !== 'owner') return item;
  const category = correction.category;
  const uncorrected =
    item.uncorrected ??
    Object.fromEntries(
      [
        'category',
        'reportKind',
        'status',
        'closedAt',
        'ownerStateAt',
        'controlRef',
        'needsConfirmation',
      ].map((key) => [key, item[key] ?? null]),
    );
  item = { ...item, ...uncorrected };
  const result = {
    uncorrected,
    ...item,
    correction: {
      category: category ?? null,
      excluded: correction.excluded === true,
      reason: correction.reason ?? null,
      done: typeof correction.done === 'boolean' ? correction.done : null,
      updatedAt: correction.updatedAt,
      currentDone: correction.currentDone ?? correction.done ?? null,
    },
    excluded: correction.excluded === true,
  };
  if (['task', 'issue', 'reference', 'routine', 'review'].includes(category)) {
    result.category = ['routine', 'review'].includes(category)
      ? 'reference'
      : category;
    result.reportKind = ['routine', 'review'].includes(category)
      ? category
      : null;
    result.needsConfirmation = category === 'review';
    if (result.category === 'reference') {
      result.status = 'pending';
      result.closedAt = null;
    }
  }
  if (typeof correction.done === 'boolean' && result.category !== 'reference') {
    result.status = correction.done ? 'complete' : 'pending';
    result.closedAt = correction.done
      ? (correction.doneAt ?? correction.updatedAt)
      : null;
    result.ownerStateAt = correction.doneAt ?? correction.updatedAt;
  }
  if (result.category !== 'reference')
    result.controlRef ??= 'work:' + item.workId;
  return { ...result, section: workSection(result) };
}

export function dailyWorkItems(
  view,
  manual = {},
  {
    excludedSourceIds = new Set(),
    workOverrides = {},
    includeExcluded = false,
  } = {},
) {
  const result = [],
    summaries = new Map(),
    references = new Map(),
    routineIds = new Set();
  for (const group of view.groups ?? [])
    for (const thread of group.threads ?? [])
      for (const mail of thread.mails ?? []) {
        const routine = isRoutineMail(mail);
        if (routine) routineIds.add(mail.source.id);
        summaries.set(mail.source.id, mailSummaryTexts(mail));
        references.set(mail.source.id, {
          source: mail.source,
          summary: mailSummaryTexts(mail),
          context: group.name,
          reportKind: routine
            ? 'routine'
            : needsOwnerReview(mail)
              ? 'review'
              : null,
        });
      }
  const usedSummary = new Set(),
    updateSources = new Set();
  for (const [kind, category] of [
    ['tasks', 'task'],
    ['issues', 'issue'],
    ['waiting', 'issue'],
    ['resolvedWaiting', 'issue'],
  ])
    for (const item of view[kind] ?? []) {
      const status =
        item.status === 'resolved'
          ? 'complete'
          : item.status === 'needs_confirmation'
            ? 'in_progress'
            : item.status;
      const sources = [
        sourceRef(
          { ...item.source, evidence: item.evidence },
          'mail',
          item.ref,
        ),
      ];
      const proofSource = item.resolution?.manual
        ? item.resolution.email?.source
        : item.resolution?.source;
      if (proofSource && proofSource.id !== item.source.id)
        updateSources.add(proofSource.id);
      if (proofSource && proofSource.id !== item.source.id)
        sources.push(
          sourceRef(proofSource, 'mail', 'source:' + proofSource.id),
        );
      const summary =
        item.source.intent === 'routine' || routineIds.has(item.source.id)
          ? [item.impact].filter(Boolean)
          : usedSummary.has(item.source.id)
            ? []
            : (summaries.get(item.source.id) ?? []);
      usedSummary.add(item.source.id);
      result.push(
        normalizeDailyWork({
          ref: item.ref,
          linkedWorkRef: item.linkedWorkRef,
          controlRef: item.linkedWorkRef ?? item.ref,
          category,
          title: item.text,
          summary,
          status,
          assignee: item.assignee,
          assigneeConfirmed: item.assigneeConfirmed,
          nextAction: item.nextAction,
          progress:
            item.resolution?.manual &&
            item.resolution.email &&
            (item.resolution.email.status === 'complete') !==
              item.resolution.done
              ? null
              : item.latest,
          waitingFor: item.person,
          center:
            item.center ??
            (/^[가-힣A-Za-z0-9_-]+센터$/.test(
              references.get(item.source.id)?.context ?? '',
            )
              ? references.get(item.source.id).context
              : null),
          customer: item.customer,
          requester: item.requester,
          requestedAt: item.source.receivedAt ?? item.source.sentAt,
          dueAt: item.dueAt,
          dueDate: item.dueDate,
          serviceDate: item.serviceDate,
          ownerStateAt: item.resolution?.manual
            ? item.resolution.updatedAt
            : null,
          closedAt:
            status === 'complete'
              ? item.resolution?.manual
                ? item.resolution.updatedAt
                : (item.completedAt ??
                  item.resolution?.source?.receivedAt ??
                  item.resolution?.source?.sentAt ??
                  null)
              : null,
          sourceRefs: sources,
          needsConfirmation:
            item.status === 'needs_confirmation' ||
            (item.assignee && !item.assigneeConfirmed),
        }),
      );
    }
  for (const record of references.values())
    if (
      !usedSummary.has(record.source.id) &&
      !updateSources.has(record.source.id)
    )
      result.push(
        normalizeDailyWork({
          ref: 'source:' + record.source.id,
          category: 'reference',
          reportKind: record.reportKind,
          needsConfirmation: record.reportKind === 'review',
          title: record.source.subject || '참고 자료',
          summary: record.summary,
          status: 'pending',
          requestedAt: record.source.receivedAt ?? record.source.sentAt,
          sourceRefs: [
            sourceRef(record.source, 'mail', 'source:' + record.source.id),
          ],
        }),
      );
  for (const entry of [
    ...(manual.workContext ?? []),
    ...(manual.entries ?? []),
  ])
    for (const item of entry.items ?? []) {
      const origin = item.origin === 'assistant' ? 'assistant' : 'manual';
      const source = {
        id: entry.entryId,
        subject:
          origin === 'assistant' ? '직접 작성한 일일정리' : '입력 메시지',
        receivedAt: entry.submittedAt,
        evidence: item.evidence,
      };
      const status = item.done
        ? 'complete'
        : item.status === 'needs_confirmation'
          ? 'in_progress'
          : (item.status ?? 'pending');
      const refs = [sourceRef(source, origin, item.ref)];
      if (
        item.workRef &&
        !excludedSourceIds.has(
          item.workRef.startsWith('source:')
            ? item.workRef.slice(7)
            : item.workRef.slice(0, 36),
        )
      )
        refs.push({
          kind: item.workRef.includes(':manual:') ? 'manual' : 'mail',
          id: item.workRef.startsWith('source:')
            ? item.workRef.slice(7)
            : item.workRef.slice(0, 36),
          ref: item.workRef,
          title: item.workRef.includes(':manual:')
            ? '연결된 입력 메시지'
            : '연결된 원본 메일',
          receivedAt: null,
        });
      result.push(
        normalizeDailyWork({
          ref: item.ref,
          linkedWorkRef: item.workRef,
          portalTaskId: item.portalTaskId,
          category:
            item.kind === 'reference'
              ? 'reference'
              : ['issue', 'waiting'].includes(item.kind)
                ? 'issue'
                : 'task',
          title: item.text,
          status: item.kind === 'waiting' && !item.done ? 'waiting' : status,
          summary: item.details ?? [],
          assignee: item.assignee,
          assigneeConfirmed: !!item.assignee,
          center: item.center,
          customer: item.customer,
          requester: item.requester,
          nextAction: item.nextAction,
          requestedAt: entry.submittedAt,
          dueAt: item.dueAt,
          dueDate: item.dueDate,
          serviceDate: item.serviceDate,
          closedAt: item.done
            ? item.completedAt
            : item.status === 'cancelled'
              ? item.closedAt
              : null,
          ownerStateAt: Object.hasOwn(item, 'ownerStateAt')
            ? item.ownerStateAt
            : item.done
              ? item.completedAt
              : null,
          inferredStateAt: item.inferredStateAt,
          sourceRefs: refs,
          needsConfirmation: item.needsConfirmation,
          confirmationReasons: manualConfirmationReasons(item,entry),
        }),
      );
    }
  const merged = new Map(),
    aliases = new Map();
  for (const item of result) {
    let key = item.workId;
    const visited = new Set();
    while (aliases.has(key) && aliases.get(key) !== key && !visited.has(key)) {
      visited.add(key);
      key = aliases.get(key);
    }
    if (visited.has(key)) throw Error('WORK_LINK_CYCLE');
    const previous = merged.get(key);
    if (
      previous?.portalTaskId &&
      item.portalTaskId &&
      previous.portalTaskId !== item.portalTaskId
    )
      throw Error('WORK_LINK_CONFLICT');
    aliases.set(item.originRef, key);
    if (!previous) {
      merged.set(key, { ...item, workId: key });
      continue;
    }
    const owner = [previous, item]
      .filter((row) => row.ownerStateAt)
      .sort((a, b) => a.ownerStateAt.localeCompare(b.ownerStateAt))
      .at(-1);
    const state =
      owner ??
      [previous, item]
        .filter((row) => row.inferredStateAt)
        .sort((a, b) => a.inferredStateAt.localeCompare(b.inferredStateAt))
        .at(-1);
    const combined = {
      ...previous,
      ...item,
      workId: key,
      portalTaskId: previous.portalTaskId ?? item.portalTaskId,
      summary: [...new Set([...previous.summary, ...item.summary])].slice(0, 6),
      sourceRefs: [...previous.sourceRefs, ...item.sourceRefs].filter(
        (source, index, all) =>
          all.findIndex(
            (other) => other.ref === source.ref && other.kind === source.kind,
          ) === index,
      ),
      controlRef: owner?.controlRef ?? previous.controlRef ?? item.controlRef,
    };
    combined.requestedAt = previous.requestedAt ?? item.requestedAt;
    for (const field of [
      'center',
      'customer',
      'requester',
      'assignee',
      'serviceDate',
      'nextAction',
      'progress',
      'waitingFor',
    ])
      combined[field] = item[field] ?? previous[field];
    if (!item.dueAt && !item.dueDate) {
      combined.dueAt = previous.dueAt;
      combined.dueDate = previous.dueDate;
    }
    if (previous.category === 'task' && item.category !== 'task') {
      combined.category = 'task';
      combined.title = previous.title;
      combined.summary = [...new Set([...combined.summary, item.title])].slice(
        0,
        6,
      );
    }
    if (state) {
      combined.status = state.status;
      combined.ownerStateAt = state.ownerStateAt;
      combined.inferredStateAt = state.inferredStateAt ?? null;
      combined.closedAt = state.closedAt;
    }
    merged.set(key, combined);
  }
  return [...merged.values()]
    .map((item) => applyOwnerWorkCorrection(item, workOverrides, view.day))
    .filter((item) => includeExcluded || !item.excluded)
    .filter(
      (item) =>
        !(
          view.day &&
          item.correction &&
          item.category === 'reference' &&
          item.reportKind !== 'review' &&
          !item.excluded &&
          item.correction.updatedAt &&
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(item.correction.updatedAt)) < view.day
        ),
    )
    .filter(
      (item) =>
        !(
          view.day &&
          ['complete', 'cancelled'].includes(item.status) &&
          item.closedAt &&
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(item.closedAt)) < view.day
        ),
    )
    .map((item) => ({ ...item, section: workSection(item) }));
}
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export const WORK_STATUS_LABELS = {
  pending: '미착수',
  in_progress: '진행 중',
  waiting: '회신 대기',
  complete: '완료',
  cancelled: '취소',
};
export const WORK_SECTIONS = [
  { id: 'tasks', title: '할 일' },
  { id: 'issues', title: '진행 이슈·회신 대기' },
  { id: 'review', title: '확인 필요' },
  { id: 'reference', title: '참고·공유' },
  { id: 'routine', title: '정기보고메일' },
  { id: 'completed', title: '완료' },
];
export function workSection(item) {
  if (item.category === 'reference' && item.reportKind) return item.reportKind;
  return ['complete', 'cancelled'].includes(item.status)
    ? 'completed'
    : item.status === 'waiting'
      ? 'issues'
      : item.category === 'task'
        ? 'tasks'
        : item.category === 'issue'
          ? 'issues'
          : 'reference';
}
function repeatsWorkTitle(summary, title) {
  const words = (text) =>
    text
      .replace(/[^\p{L}\p{N}:.-]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const stem = (word) =>
    word.replace(/[.]$/, '').replace(/(?:에게|에서|으로|를|을|은|는|의)$/, '');
  const titleWords = new Set(words(title).map(stem));
  const extra = words(summary).filter((word) => !titleWords.has(stem(word)));
  // Suppress only an otherwise identical sentence padded with delivery/request
  // wording. Unknown extra facts, amounts, conditions and statuses stay visible.
  return (
    extra.length > 0 &&
    extra.every(
      (word) =>
        /^(?:전달하며|전달했습니다[.]?|확인|확인을|요청했습니다[.]?|송부하며|공유하며)$/.test(
          word,
        ) || /(?:센터|공장|물류|담당자)에서$/.test(word),
    ) &&
    [...titleWords]
      .filter((word) => !/확인합니다|처리합니다|요청합니다/.test(word))
      .every((word) => words(summary).some((value) => stem(value) === word))
  );
}
function manualConfirmationReasons(item, entry) {
  if (!item.needsConfirmation) return [];
  const reasons = [];
  const original = item.serviceOriginal ?? '';
  const weekdayDate = /(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:\(([월화수목금토일])(?:요일)?\)|([월화수목금토일])요일)/;
  const stated = weekdayDate.exec(original) ?? weekdayDate.exec(entry.text ?? '');
  if (!item.serviceDate && stated) {
    const year = Number((entry.referenceDate ?? entry.submittedAt).slice(0,4));
    const date = new Date(Date.UTC(year,Number(stated[1])-1,Number(stated[2])));
    if (date.getUTCMonth()===Number(stated[1])-1 && date.getUTCDate()===Number(stated[2]) && '일월화수목금토'[date.getUTCDay()] !== (stated[3]??stated[4]))
      reasons.push('날짜·요일 불일치: ' + stated[0] + ' — 확인 필요');
  }
  if (!item.serviceDate && item.serviceOriginal && !reasons.length) reasons.push('대상 날짜 확인 필요: ' + item.serviceOriginal);
  if (item.text === '요청 내용 확인') reasons.push('요청 대상·자료 확인 필요');
  const source = item.evidence ?? '';
  const unknown = [
    [/(?:수량|물량)[^.!?。\n]{0,15}미정(?=이며|이고|입니다|[\s.,。]|$)/, '수량'],
    [/하차\s*(?:시각|시간)[^.!?。\n]{0,8}미정(?=이며|이고|입니다|[\s.,。]|$)/, '하차 시각'],
  ].filter(([pattern])=>pattern.test(source)).map(([,label])=>label);
  if (unknown.length) reasons.push(unknown.join('·') + ' 미정');
  return reasons;
}
function briefingWorkTitle(title) {
  return String(title ?? '').replace(/^[^,，\n]{1,40}님[,，]\s*/,'').replace(/\s*(?:부탁드립니다|부탁드려요|부탁합니다|부탁해요|요청드립니다|요청합니다|해\s*주세요|해\s*주시기\s*바랍니다)[.!?。]*$/,'').trim();
}
export function renderWorkSections(items) {
  const chunks = [],
    sources = new Map();
  for (const section of WORK_SECTIONS) {
    const rows = items.filter((item) => workSection(item) === section.id);
    if (!rows.length) continue;
    chunks.push('<h2>' + section.title + '</h2>');
    for (const item of rows) {
      const title = briefingWorkTitle(item.title);
      chunks.push(
        item.category === 'reference'
          ? item.summary.length
            ? ''
            : '<p>' + escape(title) + '</p>'
          : '<p><strong>' +
              escape(title) +
              '</strong> · ' +
              (item.needsConfirmation && !['complete','cancelled'].includes(item.status) ? '확인 필요' : WORK_STATUS_LABELS[item.status]) +
              '</p>',
      );
      for (const summary of workSummaryForDisplay(item))
        if (
          item.category === 'reference' ||
          !repeatsWorkTitle(summary, item.title)
        )
          chunks.push('<p>' + escape(summary) + '</p>');
      if (item.needsConfirmation) chunks.push('<p>' + (item.confirmationReasons?.length ? item.confirmationReasons : ['확인 필요']).map(escape).join(' · ') + '</p>');
      const fields = [
        item.center && '센터: ' + item.center,
        item.customer && '거래처: ' + item.customer,
        item.requester && '요청: ' + item.requester,
        item.assignee && '담당: ' + item.assignee,
        (item.dueAt || item.dueDate) &&
          '처리기한: ' +
            (item.dueAt
              ? new Date(item.dueAt).toLocaleString('sv-SE', {
                  timeZone: 'Asia/Seoul',
                  hour12: false,
                })
              : item.dueDate),
        item.serviceDate && '운행·납품 대상일: ' + item.serviceDate,
        item.closedAt &&
          '처리일: ' +
            new Date(item.closedAt).toLocaleDateString('sv-SE', {
              timeZone: 'Asia/Seoul',
            }),
      ].filter(Boolean);
      if (fields.length)
        chunks.push('<p>' + fields.map(escape).join(' · ') + '</p>');
      if (item.nextAction && item.nextAction !== item.title)
        chunks.push('<p>다음 조치: ' + escape(item.nextAction) + '</p>');
      if (item.progress && item.progress !== item.title)
        chunks.push('<p>진행: ' + escape(item.progress) + '</p>');
      if (item.waitingFor)
        chunks.push('<p>회신 대기: ' + escape(item.waitingFor) + '</p>');
      for (const source of item.sourceRefs)
        if (source.kind !== 'linked')
          sources.set(source.kind + ':' + source.id, source);
    }
  }
  // Source identity stays in the work ledger and portal. OneNote only needs
  // invisible anchors for the separately verified business-photo writer.
  for (const source of sources.values()) {
    if (source.kind === 'mail')
      chunks.push('<div data-id="sajo-mail-photos-' + source.id + '"></div>');
  }
  return chunks.join('');
}

// Presentation only: use the confirmed service day, never a collection or processing deadline.
function compactWorkSummary(item) {
  const title = briefingWorkTitle(item.title);
  const titleQuantity = /\d+(?:\.\d+)?\s*[pP](?:\b|(?=[^A-Za-z]))/.exec(title);
  return (item.summary ?? []).filter(value => {
    const text = value.trim();
    if (item.category === 'reference' || !title) return true;
    if (title.includes(text)) return false;
    if (titleQuantity && /^\d+(?:\.\d+)?\s*[pP]$/.test(text)) return false;
    const date = /^(?:대상|운행·납품|운행|납품)?\s*(20\d{2}-\d{2}-\d{2})$/.exec(text);
    return !(date && item.serviceDate === date[1]);
  });
}
export function workSummaryForDisplay(item) {
  const summary = compactWorkSummary(item);
  const day = calendar(item.serviceDate);
  if (!day) return [...summary];
  const weekday = new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',weekday:'short'}).format(new Date(day+'T00:00:00+09:00'));
  const [year,month,date] = day.split('-');
  const label = year+'.'+Number(month)+'.'+Number(date)+'('+weekday+')';
  return summary.map(text => {
    const time = /^(상차|하차)(?:\s*(?:예정|시간|시각))?\s*[:：]?\s*((?:[01]?\d|2[0-3]):[0-5]\d)\s*$/.exec(text);
    return time ? label+' '+time[2]+' '+time[1] : text;
  });
}

function briefingReferenceLine(item) {
  const text = item.summary[0] || item.title;
  const first = text.split(/[.!?](?=\s|$)|\n/)[0].trim();
  const detail = first.search(
    /(?:[,，;·]\s*|\s)(?:보증금|월세|관리비|계약\s*기간|월\s*지원|지원금|계약\s*조건)/,
  );
  const lead = (detail >= 0 ? first.slice(0, detail) : first).replace(
    /[,:;·\s]+$/,
    '',
  );
  const line = lead && lead.length <= 120 ? lead : item.title;
  return line.replace(/(?:안내합니다|안내드립니다)[.]?$/, '안내');
}
export function renderBriefingWorkNote(items) {
  const font = 'font-family:Malgun Gothic,Arial,sans-serif;font-size:11pt;font-weight:normal;line-height:150%';
  const paragraph = font + ';margin-top:0pt;margin-bottom:4pt';
  const itemStyle = font + ';margin-top:12pt;margin-bottom:4pt';
  const supporting = paragraph;
  let sectionNumber = 0;
  const visible = items.filter((item) => !item.excluded);
  const completed = (item) => ['complete', 'cancelled'].includes(item.status);
  const progress = (item) =>
    !completed(item) &&
    (item.status === 'waiting' || item.status === 'in_progress') &&
    !item.needsConfirmation;
  const groups = [
    [
      'To Do',
      visible.filter(
        (item) =>
          item.category === 'task' && !completed(item) && !progress(item),
      ),
    ],
    ['진행·회신 대기', visible.filter(progress)],
    [
      '주요 이슈',
      visible.filter(
        (item) =>
          !completed(item) &&
          !progress(item) &&
          (item.category === 'issue' || item.reportKind === 'review'),
      ),
    ],
    [
      '참고사항',
      visible.filter(
        (item) =>
          item.category === 'reference' &&
          item.reportKind !== 'review' &&
          item.reportKind !== 'routine',
      ),
    ],
    [
      '완료',
      visible.filter(
        (item) => completed(item) && item.category !== 'reference',
      ),
    ],
  ];
  const routine = visible.filter(
    (item) => item.category === 'reference' && item.reportKind === 'routine',
  );
  const chunks = [],
    sources = new Map();
  for (const [heading, rows] of groups) {
    if (!rows.length && !(heading === '참고사항' && routine.length)) continue;
    chunks.push('<h2 style="font-family:Malgun Gothic,Arial,sans-serif;font-size:14pt;font-weight:bold;color:#222222;margin-top:18pt;margin-bottom:8pt">' + (++sectionNumber) + '. ' + heading + '</h2>');
    if (rows.length) chunks.push('<ol style="list-style-type:decimal">');
    for (const item of rows) {
      const title = briefingWorkTitle(item.title);
      const detailLines = [];
      const displaySummary = workSummaryForDisplay(item);
      chunks.push('<li style="list-style-type:decimal;' + itemStyle + '">');
      if (item.category === 'reference')
        chunks.push(escape(briefingReferenceLine(item)));
      else {
        chunks.push(
          escape(title) +
            (item.status === 'cancelled' ? ' · 취소' : ''),
        );
        for (const text of displaySummary)
          if (!repeatsWorkTitle(text, item.title))
            detailLines.push('<li style="list-style-type:disc;' + paragraph + '">' + escape(text) + '</li>');
        const details = [
          item.center && !item.title.includes(item.center) && item.center,
          item.customer && !item.title.includes(item.customer) && item.customer,
          item.status === 'in_progress' && (!item.needsConfirmation || item.progress) && '진행 중',
          item.needsConfirmation && (item.confirmationReasons?.length ? item.confirmationReasons.join(' · ') : '확인 필요'),
          item.assignee && '담당 ' + item.assignee,
          (item.dueAt || item.dueDate) &&
            '기한 ' +
              (item.dueAt
                ? new Date(item.dueAt).toLocaleString('sv-SE', {
                    timeZone: 'Asia/Seoul',
                    hour12: false,
                  })
                : item.dueDate),
          item.serviceDate && !title.includes(item.serviceDate) && !displaySummary.some(text=>/^\d{4}\.\d{1,2}\.\d{1,2}\(/.test(text)) && '운행·납품 ' + item.serviceDate,
        ].filter(Boolean);
        if (details.length)
          detailLines.push('<li style="list-style-type:disc;' + supporting + '">' + details.map(escape).join(' · ') + '</li>');
        for (const [label, text] of [
          ['진행', item.progress],
          ['다음 조치', item.nextAction],
          ['회신 대기', item.waitingFor],
        ])
          if (text && text !== item.title && !item.summary.includes(text))
            detailLines.push('<li style="list-style-type:disc;' + paragraph + '">' + label + ': ' + escape(text) + '</li>');
      }
      if (detailLines.length) chunks.push('<ul style="list-style-type:disc">' + detailLines.join('') + '</ul>');
      chunks.push('</li>');
      for (const source of item.sourceRefs)
        if (source.kind === 'mail') sources.set(source.id, source);
    }
    if (rows.length) chunks.push('</ol>');
    if (heading === '참고사항' && routine.length) {
      chunks.push('<h3 style="font-family:Malgun Gothic,Arial,sans-serif;font-size:11pt;font-weight:bold;color:#222222;margin-top:10pt;margin-bottom:5pt;margin-left:0pt">정기보고메일</h3>');
      chunks.push('<ol style="list-style-type:decimal">');
      for (const item of routine)
        chunks.push('<li style="list-style-type:decimal;' + itemStyle + '">' + escape(briefingReferenceLine(item)) + '</li>');
      chunks.push('</ol>');
      // Normal recurring reports intentionally have no photos in the note.
    }
  }
  for (const source of sources.values())
    chunks.push('<div data-id="sajo-mail-photos-' + source.id + '"></div>');
  return chunks.join('');
}
