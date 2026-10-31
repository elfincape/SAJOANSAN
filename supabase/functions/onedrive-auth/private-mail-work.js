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
    title: clean(input.title),
    summary: [
      ...new Set(
        (input.summary ?? [])
          .map((item) => clean(item))
          .filter((item) => item && item !== input.title),
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
    sourceRefs: refs,
    needsConfirmation: input.needsConfirmation === true,
    originRef: input.ref,
  };
}
export function dailyWorkItems(
  view,
  manual = {},
  { excludedSourceIds = new Set() } = {},
) {
  const result = [],
    summaries = new Map(),
    references = new Map();
  for (const group of view.groups ?? [])
    for (const thread of group.threads ?? [])
      for (const mail of thread.mails ?? []) {
        summaries.set(
          mail.source.id,
          (mail.summary ?? []).map((item) => item.text),
        );
        references.set(mail.source.id, {
          source: mail.source,
          summary: (mail.summary ?? []).map((item) => item.text),
          context: group.name,
        });
      }
  const usedSummary = new Set();
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
        sources.push(
          sourceRef(proofSource, 'mail', 'source:' + proofSource.id),
        );
      const summary = usedSummary.has(item.source.id)
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
          progress: item.latest,
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
                : (item.completedAt ?? null)
              : null,
          sourceRefs: sources,
          needsConfirmation:
            item.status === 'needs_confirmation' ||
            (item.assignee && !item.assigneeConfirmed),
        }),
      );
    }
  for (const record of references.values())
    if (!usedSummary.has(record.source.id))
      result.push(
        normalizeDailyWork({
          ref: 'source:' + record.source.id,
          category: 'reference',
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
          summary: [],
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
          ownerStateAt:
            item.ownerStateAt ?? (item.done ? item.completedAt : null),
          sourceRefs: refs,
          needsConfirmation: item.needsConfirmation,
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
    if (owner) {
      combined.status = owner.status;
      combined.ownerStateAt = owner.ownerStateAt;
      combined.closedAt = owner.closedAt;
    }
    merged.set(key, combined);
  }
  return [...merged.values()]
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
  { id: 'reference', title: '참고·공유' },
  { id: 'completed', title: '완료' },
];
export function workSection(item) {
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
export function renderWorkSections(items) {
  const chunks = [],
    sources = new Map();
  for (const section of WORK_SECTIONS) {
    const rows = items.filter((item) => workSection(item) === section.id);
    if (!rows.length) continue;
    chunks.push('<h2>' + section.title + '</h2>');
    for (const item of rows) {
      chunks.push(
        item.category === 'reference'
          ? '<h3>' + escape(item.title) + '</h3>'
          : '<p><strong>' +
              escape(item.title) +
              '</strong> · ' +
              WORK_STATUS_LABELS[item.status] +
              '</p>',
      );
      for (const summary of item.summary)
        chunks.push('<p>' + escape(summary) + '</p>');
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
  if (sources.size) chunks.push('<h2>출처</h2>');
  for (const source of sources.values()) {
    const href =
      source.kind === 'mail'
        ? 'https://sajoansan.vercel.app/portal/?view=mail&amp;message=' +
          encodeURIComponent(source.id)
        : 'https://sajoansan.vercel.app/admin/mail-daily-briefing.html?entry=' +
          source.id +
          '#manual-messages';
    chunks.push(
      '<p><a href="' +
        href +
        '">' +
        escape(source.title || '입력 메시지') +
        '</a>' +
        (source.receivedAt
          ? ' · ' +
            escape(
              new Date(source.receivedAt)
                .toLocaleString('sv-SE', {
                  timeZone: 'Asia/Seoul',
                  hour12: false,
                })
                .slice(0, 16),
            )
          : '') +
        '</p>',
    );
    if (source.kind === 'mail')
      chunks.push('<div data-id="sajo-mail-photos-' + source.id + '"></div>');
  }
  return chunks.join('');
}
