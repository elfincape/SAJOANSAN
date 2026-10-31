import { dateFrom, deadline } from './private-mail-manual.js';
import {
  dailyWorkItems,
  renderWorkSections,
  WORK_SECTIONS,
  WORK_STATUS_LABELS,
  needsOwnerReview,
} from './private-mail-work.js';

export const BRIEFING_TARGET = Object.freeze({
  notebookId: '0-6DACE80AD4C07B59!s8d3015ec347d47fdb476f785ac84d3da',
  sectionId: '0-6DACE80AD4C07B59!sc05c0cb6700f4ebf941a3345ff8a9981',
  intervalHours: 3,
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = /^[0-9a-f]{64}$/;
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
function text(value, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw Error('ANALYSIS_FORMAT');
  return value.trim();
}
function date(value) {
  if (!(value instanceof Date) && typeof value !== 'string')
    throw Error('REPORT_DATE');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw Error('REPORT_DATE');
  return parsed;
}
export function dailyReportIdentity(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date(now))
      .map(({ type, value }) => [type, value]),
  );
  if (!/^\d{4}$/.test(parts.year)) throw Error('REPORT_DATE');
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    title: `${parts.year.slice(2)}${parts.month}${parts.day} 일일정리`,
  };
}
export function mailItemIndex(item, fallback) {
  const index = item.itemIndex ?? fallback;
  if (!Number.isSafeInteger(index) || index < 0 || index > 9999)
    throw Error('ANALYSIS_FORMAT');
  return index;
}
export function applyMailIntentOverride(analysis, correction) {
  const originalSummary = analysis.summary ?? [];
  const summary = originalSummary.map((item) => ({
    ...item,
    text: mailSummaryText(item.text, analysis.source),
  }));
  const projected = summary.some(
    (item, index) => item.text !== originalSummary[index].text,
  )
    ? { ...analysis, summary }
    : analysis;
  if (correction?.intent !== 'reference') return projected;
  return {
    ...projected,
    source: { ...analysis.source, intent: 'reference' },
    intent: { kind: 'reference', evidence: null, ownerFeedback: true },
    tasks: [],
    waiting: [],
    updates: [],
    imageItems: { ...(analysis.imageItems ?? {}), tasks: [], waiting: [] },
  };
}
export function reconcileMailItems(analysis, previous) {
  if (previous?.source?.id !== analysis.source.id) previous = null;
  const signature = (item) =>
    JSON.stringify([
      item.text,
      item.evidence,
      item.assignee ?? null,
      item.dueOriginal ?? null,
      item.serviceOriginal ?? null,
      item.imageId ?? null,
    ]);
  analysis.itemSequences = {};
  for (const image of [false, true]) {
    for (const kind of ['tasks', 'issues', 'waiting']) {
      const key = image
        ? 'image' + kind[0].toUpperCase() + kind.slice(1)
        : kind;
      const old =
        (image ? previous?.imageItems?.[kind] : previous?.[kind]) ?? [];
      const items =
        (image ? analysis.imageItems?.[kind] : analysis[kind]) ?? [];
      const candidates = new Map();
      let next = previous?.itemSequences?.[key] ?? 0;
      for (const [offset, item] of old.entries()) {
        const index = mailItemIndex(item, offset);
        next = Math.max(next, index + 1);
        const identity = signature(item);
        candidates.set(identity, [...(candidates.get(identity) ?? []), index]);
      }
      for (const item of items) {
        item.itemIndex = candidates.get(signature(item))?.shift() ?? next++;
        mailItemIndex(item, 0);
      }
      analysis.itemSequences[key] = next;
    }
  }
  analysis.revision =
    previous && Number.isSafeInteger(previous.revision)
      ? previous.revision + 1
      : 1;
}
function mailSummaryText(value, source) {
  const prefix = (
    /^\[([^\]]{1,40})\]/.exec(source.subject ?? '')?.[1] ??
    (source.subject ?? '').split(/\s+[-–—]|[:：]/)[0]
  ).trim();
  if (
    !prefix ||
    prefix.length > 40 ||
    source.envelope?.from?.name?.includes(prefix)
  )
    return value;
  if (
    !/(?:전달|송부|공유|발송|보냈).*(?:했습니다|하였습니다|습니다)[.]?$/.test(
      value,
    )
  )
    return value;
  const starter = [prefix + '가 ', prefix + '이 ', prefix + '에서 '].find(
    (part) => value.startsWith(part),
  );
  return starter ? value.slice(starter.length) : value;
}
export function projectMailDates(analysis, row) {
  const sentAt = date(row.sent_at ?? analysis.source.sentAt).toISOString();
  const receivedAt = row.received_at
    ? date(row.received_at).toISOString()
    : null;
  const collectedAt = date(
    row.created_at ??
      analysis.source.collectedAt ??
      analysis.source.receivedAt ??
      sentAt,
  ).toISOString();
  const reportAt = receivedAt ?? sentAt,
    base = dailyReportIdentity(reportAt).day;
  const rebase = (item) => ({
    ...item,
    visibleFrom: base,
    ...(item.dueOriginal
      ? deadline(item.dueOriginal, item.evidence, base)
      : {}),
    ...(item.serviceOriginal
      ? { serviceDate: dateFrom(item.serviceOriginal, base) }
      : {}),
  });
  return {
    ...analysis,
    source: {
      ...analysis.source,
      sentAt,
      receivedAt,
      collectedAt,
      dateBasis: receivedAt ? 'received_header' : 'sent_header',
    },
    tasks: (analysis.tasks ?? []).map(rebase),
    issues: (analysis.issues ?? []).map(rebase),
    waiting: (analysis.waiting ?? []).map(rebase),
  };
}
export function normalizeMailAnalysis(value, mail) {
  if (!mail || !uuid.test(mail.id) || !hex.test(mail.uidl_hash))
    throw Error('ANALYSIS_SOURCE');
  const subject = text(mail.subject || '(제목 없음)', 500),
    sender = text(mail.sender || '(발신자 미상)', 500),
    body =
      typeof mail.text === 'string' && mail.text.length <= 100000
        ? mail.text
        : (() => {
            throw Error('ANALYSIS_SOURCE');
          })(),
    sentAt = date(mail.sent_at).toISOString();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('ANALYSIS_FORMAT');
  const quote = (value) => {
    const evidence = text(value, 3000);
    if (body.includes(evidence) || subject.includes(evidence)) return evidence;
    const pattern = evidence
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    const original =
      body.match(new RegExp(pattern))?.[0] ??
      subject.match(new RegExp(pattern))?.[0];
    if (!original || original.length > 3000) throw Error('ANALYSIS_EVIDENCE');
    return original;
  };
  const completion = (raw) => {
    const evidence = quote(raw.completionEvidence);
    if (!affirmativeCompletion(evidence)) throw Error('ANALYSIS_COMPLETION');
    return evidence;
  };
  function items(key, limit, optional = false) {
    if (optional && value[key] == null) return [];
    if (!Array.isArray(value[key]) || value[key].length > limit)
      throw Error('ANALYSIS_FORMAT');
    return value[key].map((item) => {
      const evidence = quote(item?.evidence);
      return { text: text(item.text), evidence };
    });
  }
  const summary = items('summary', 20).map((item) => ({
      ...item,
      text: mailSummaryText(item.text, { subject, envelope: mail.envelope }),
    })),
    issues = items('issues', 30).map((item, index) => {
      const raw = value.issues[index],
        status = raw.status ?? 'needs_confirmation';
      if (!['in_progress', 'needs_confirmation', 'resolved'].includes(status))
        throw Error('ANALYSIS_FORMAT');
      if (status === 'resolved' && !raw.completionEvidence)
        throw Error('ANALYSIS_COMPLETION');
      return {
        ...item,
        status,
        impact: raw.impact ? text(raw.impact) : null,
        latest: raw.latest ? text(raw.latest) : null,
        completionEvidence: status === 'resolved' ? completion(raw) : null,
      };
    }),
    tasks = items('tasks', 50).map((item, index) => {
      const raw = value.tasks[index];
      const assignee =
        raw.assignee == null || raw.assignee === ''
          ? null
          : text(raw.assignee, 100);
      if (assignee && !item.evidence.includes(assignee))
        throw Error('ANALYSIS_ASSIGNEE');
      const dueOriginal =
        raw.due == null || raw.due === '' ? null : text(raw.due, 100);
      if (dueOriginal && !item.evidence.includes(dueOriginal))
        throw Error('ANALYSIS_DEADLINE');
      const visibleFrom = dailyReportIdentity(
        mail.received_at ?? mail.sent_at,
      ).day;
      const serviceOriginal =
        raw.serviceOriginal == null ? null : text(raw.serviceOriginal, 100);
      if (serviceOriginal && !item.evidence.includes(serviceOriginal))
        throw Error('ANALYSIS_DEADLINE');
      const serviceDate = dateFrom(serviceOriginal, visibleFrom);
      const processingDeadline = deadline(
        dueOriginal,
        item.evidence,
        visibleFrom,
      );
      let due = null;
      if (dueOriginal && /^\d{4}-\d{2}-\d{2}$/.test(dueOriginal)) {
        const stamp = new Date(dueOriginal + 'T00:00:00Z');
        if (
          !Number.isFinite(stamp.getTime()) ||
          stamp.toISOString().slice(0, 10) !== dueOriginal
        )
          throw Error('ANALYSIS_DEADLINE');
        const labelled = new RegExp(
          '(?:제출\\s*기한|회신\\s*기한|마감(?:일|기한)?|기한)\\s*[:：]?\\s*' +
            dueOriginal +
            '(?:[\\s.,。]|$)',
        ).test(item.evidence);
        const until = item.evidence.includes(dueOriginal + '까지');
        if (
          (labelled || until) &&
          !/(?:기존|이전|취소|변경 전|미정)/.test(item.evidence)
        )
          due = dueOriginal;
      }
      const escapedName = assignee?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return {
        ...item,
        status: raw.status === 'complete' ? 'complete' : 'pending',
        completionEvidence: raw.status === 'complete' ? completion(raw) : null,
        assignee,
        due,
        dueOriginal,
        visibleFrom,
        serviceOriginal,
        serviceDate,
        dueAt: processingDeadline.dueAt,
        dueDate: processingDeadline.dueDate,
        duePrecision: processingDeadline.duePrecision,
        assigneeConfirmed:
          !!assignee &&
          new RegExp(
            '(?:^|[\\n.,。])\\s*담당(?:자)?\\s*[:：]\\s*' +
              escapedName +
              '(?:님)?\\s*(?:[\\n.,。]|$)',
          ).test(item.evidence),
      };
    });
  const revision = value.revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw Error('ANALYSIS_FORMAT');
  const group =
    value.group == null
      ? null
      : {
          name: text(value.group.name, 200),
          evidence: quote(value.group.evidence),
        };
  if (group && !group.evidence.includes(group.name))
    throw Error('ANALYSIS_GROUP');
  const waiting = items('waiting', 30, true).map((item, index) => {
    const person = value.waiting[index].person
      ? text(value.waiting[index].person, 200)
      : null;
    if (person && !item.evidence.includes(person))
      throw Error('ANALYSIS_ASSIGNEE');
    return { ...item, person, lastRequestedAt: sentAt };
  });
  return {
    source: {
      id: mail.id,
      uidl: mail.uidl_hash,
      subject,
      sender,
      envelope: mail.envelope ?? null,
      sentAt,
      receivedAt: mail.received_at
        ? date(mail.received_at).toISOString()
        : null,
      collectedAt: date(mail.created_at ?? mail.sent_at).toISOString(),
      dateBasis: mail.received_at ? 'received_header' : 'sent_header',
    },
    revision,
    updatedAt: date(
      mail.analyzed_at ?? mail.created_at ?? mail.sent_at,
    ).toISOString(),
    group,
    summary,
    issues,
    tasks,
    waiting,
  };
}
function canonicalMessageId(value) {
  if (typeof value !== 'string') return null;
  const match =
    /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,128})@([A-Za-z0-9.-]{1,128})>$/.exec(
      value,
    );
  return match ? '<' + match[1] + '@' + match[2].toLowerCase() + '>' : null;
}
function sourceThread(source) {
  const ids = (values) =>
    Array.isArray(values) && values.length <= 32
      ? [...new Set(values.map(canonicalMessageId).filter(Boolean))]
      : [];
  return {
    messageId: canonicalMessageId(source.thread?.messageId),
    parents: [
      ...new Set([
        ...ids(source.thread?.inReplyTo),
        ...ids(source.thread?.references),
      ]),
    ],
  };
}
function affirmativeCompletion(evidence) {
  return (
    typeof evidence === 'string' &&
    /(?:완료|해결|처리|제출|회신)(?:했|하였|되었|됐|되었습니다|했습니다|하였습니다|됨)/.test(
      evidence,
    ) &&
    !/[?？]|(?:미완료|미해결|않|아니|못|예정|계획|조건|만약|여부|추정|확인\s*(?:필요|요청)|완료\s*전|완료해|완료하[면길여]|완료할|했(?:다고|다면|는지)|되었(?:다고|다면|는지)|됐(?:다고|다면|는지))/.test(
      evidence,
    )
  );
}
function namesPriorWork(prior, evidence) {
  return (prior.match(/[가-힣A-Za-z0-9_-]{2,}/g) ?? []).some((word) => {
    const term = word.replace(
      /(?:으로|에서|에게|까지|부터|은|는|이|가|을|를|의|와|과|님)$/,
      '',
    );
    return (
      term.length >= 2 &&
      !/^(?:완료|해결|처리|제출|회신|보고|요청|확인|필요|예정|업무|담당|기한|진행|관련|사항|작업|하기|주세요|바랍니다)$/i.test(
        term,
      ) &&
      evidence.includes(term)
    );
  });
}
function uniqueAnalyses(analyses) {
  if (!Array.isArray(analyses) || analyses.length > 5000)
    throw Error('REPORT_LIMIT');
  const unique = new Map();
  for (const item of analyses) {
    if (
      !hex.test(item?.source?.uidl) ||
      !uuid.test(item?.source?.id) ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 1
    )
      throw Error('ANALYSIS_SOURCE');
    text(item.source.subject, 500);
    text(item.source.sender, 500);
    date(item.source.sentAt);
    date(item.source.receivedAt ?? item.source.sentAt);
    for (const [kind, limit] of [
      ['summary', 20],
      ['issues', 30],
      ['tasks', 50],
      ['waiting', 30],
    ])
      if (!Array.isArray(item[kind] ?? []) || (item[kind]?.length ?? 0) > limit)
        throw Error('REPORT_LIMIT');
    const old = unique.get(item.source.uidl);
    if (
      old?.revision === item.revision &&
      JSON.stringify(old) !== JSON.stringify(item)
    )
      throw Error('ANALYSIS_CONFLICT');
    if (!old || old.revision < item.revision)
      unique.set(item.source.uidl, item);
  }
  const rows = [...unique.values()].sort(
    (a, b) =>
      date(a.source.receivedAt ?? a.source.sentAt) -
        date(b.source.receivedAt ?? b.source.sentAt) ||
      date(a.source.sentAt) - date(b.source.sentAt) ||
      a.source.id.localeCompare(b.source.id),
  );
  if (new Set(rows.map((item) => item.source.id)).size !== rows.length)
    throw Error('ANALYSIS_CONFLICT');
  return rows;
}

export function dailyBriefingView({
  now,
  analyses,
  overrides = {},
  manual = {},
}) {
  const identity = dailyReportIdentity(now),
    allRows = uniqueAnalyses(analyses)
      .filter(
        (mail) =>
          dailyReportIdentity(mail.source.receivedAt ?? mail.source.sentAt)
            .day <= identity.day,
      )
      .map((mail) => ({
        ...mail,
        source: {
          ...mail.source,
          carryOnly:
            mail.source.carryOnly === true ||
            dailyReportIdentity(mail.source.receivedAt ?? mail.source.sentAt)
              .day < identity.day,
        },
      })),
    rows = allRows.filter((mail) => mail.source.excluded !== true);
  const threads = new Map(
    allRows.map((mail) => [mail.source.id, sourceThread(mail.source)]),
  );
  const observed = new Map();
  for (const mail of allRows) {
    const id = threads.get(mail.source.id).messageId;
    if (id) observed.set(id, [...(observed.get(id) ?? []), mail.source.id]);
  }
  const unambiguous = (sourceId) => {
    const id = threads.get(sourceId)?.messageId;
    return !!id && observed.get(id)?.length === 1;
  };
  const linked = (current, prior) =>
    current !== prior &&
    unambiguous(current) &&
    unambiguous(prior) &&
    threads.get(current).parents.includes(threads.get(prior).messageId);
  const parents = new Map(
    allRows.map((mail) => [mail.source.id, mail.source.id]),
  );
  const find = (id) => {
    let root = id;
    while (parents.get(root) !== root) root = parents.get(root);
    return root;
  };
  for (const mail of allRows) {
    if (!unambiguous(mail.source.id)) continue;
    for (const id of threads.get(mail.source.id).parents) {
      const candidates = observed.get(id);
      if (candidates?.length === 1 && linked(mail.source.id, candidates[0]))
        parents.set(find(mail.source.id), find(candidates[0]));
    }
  }
  const components = new Map();
  for (const mail of rows) {
    if (mail.source.carryOnly === true && !needsOwnerReview(mail)) continue;
    const id = find(mail.source.id);
    components.set(id, [...(components.get(id) ?? []), mail]);
  }
  const groupMap = new Map();
  for (const mails of components.values()) {
    const explicit = [
      ...new Set(
        mails
          .filter((mail) => mail.group)
          .map((mail) => text(mail.group.name, 200)),
      ),
    ].sort();
    const name = explicit.length
      ? explicit.join(' / ') + (explicit.length > 1 ? ' (분류 확인 필요)' : '')
      : '분류 미확정';
    if (!groupMap.has(name)) groupMap.set(name, { name, threads: [] });
    groupMap
      .get(name)
      .threads.push({ subject: mails[0].source.subject, mails });
  }
  const groups = [...groupMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const output = { issues: [], tasks: [], waiting: [] },
    refs = new Map();
  for (const mail of allRows) {
    for (const kind of ['issues', 'tasks', 'waiting']) {
      for (const [index, item] of (mail[kind] ?? []).entries()) {
        const row = {
          ...item,
          ref: mail.source.id + ':' + kind + ':' + mailItemIndex(item, index),
          source: mail.source,
          evidence: text(item.evidence, 3000),
          text: text(item.text),
          sourceType: 'body',
          status:
            item.status ??
            (kind === 'issues'
              ? 'needs_confirmation'
              : kind === 'tasks'
                ? 'pending'
                : 'waiting'),
          assignee: item.assignee ?? null,
          due: item.dueAt
            ? new Intl.DateTimeFormat('sv-SE', {
                timeZone: 'Asia/Seoul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
              }).format(date(item.dueAt))
            : (item.dueDate ?? item.due ?? null),
          confidence: null,
          resolution: null,
        };
        const excluded = mail.source.excluded === true;
        if (!excluded) output[kind].push(row);
        refs.set(row.ref, {
          kind,
          row,
          originId: mail.source.id,
          excluded,
          visible: !excluded,
        });
      }
      if (mail.source.excluded === true) continue;
      const photoItems = mail.imageItems?.[kind] ?? [];
      if (!Array.isArray(photoItems) || photoItems.length > 30)
        throw Error('REPORT_LIMIT');
      for (const [index, item] of photoItems.entries()) {
        const image = (mail.source.images ?? []).find(
          (image) => image.id === item.imageId,
        );
        const fact = (mail.imageFacts ?? []).find(
          (fact) =>
            fact.imageId === item.imageId && fact.text === item.evidence,
        );
        if (
          !image ||
          !fact ||
          (item.sourceId != null && item.sourceId !== mail.source.id) ||
          (item.sourceType != null && item.sourceType !== 'image') ||
          !['readable', 'uncertain'].includes(item.confidence) ||
          (fact.confidence === 'uncertain' && item.confidence !== 'uncertain')
        )
          throw Error('IMAGE_EVIDENCE');
        const row = {
          text: text(item.text),
          evidence: text(item.evidence, 3000),
          imageId: item.imageId,
          source: mail.source,
          sourceType: 'image',
          confidence: item.confidence,
          ref:
            mail.source.id +
            ':image' +
            kind[0].toUpperCase() +
            kind.slice(1) +
            ':' +
            mailItemIndex(item, index),
          status:
            kind === 'tasks'
              ? 'pending'
              : kind === 'issues'
                ? 'needs_confirmation'
                : 'waiting',
          assignee: null,
          due: null,
          resolution: null,
        };
        output[kind].push(row);
        refs.set(row.ref, {
          kind,
          row,
          originId: mail.source.id,
          excluded: false,
          visible: true,
        });
      }
    }
  }
  for (const mail of rows) {
    if (!Array.isArray(mail.updates ?? []) || (mail.updates?.length ?? 0) > 100)
      throw Error('REPORT_LIMIT');
    for (const update of mail.updates ?? []) {
      const target = refs.get(update?.ref);
      if (
        !target ||
        target.row.sourceType === 'image' ||
        update.sourceId !== mail.source.id ||
        !linked(mail.source.id, target.originId) ||
        typeof update.evidence !== 'string' ||
        !update.evidence.trim() ||
        update.evidence.length > 3000
      )
        continue;
      const allowed =
        target.kind === 'tasks'
          ? ['pending', 'complete']
          : target.kind === 'issues'
            ? ['in_progress', 'needs_confirmation', 'resolved']
            : ['waiting', 'resolved'];
      if (
        !allowed.includes(update.status) ||
        (['complete', 'resolved'].includes(update.status) &&
          !affirmativeCompletion(update.evidence))
      )
        continue;
      if (target.excluded) {
        if (!namesPriorWork(target.row.text, update.evidence)) continue;
        // Keep eligible proof of shared work without publishing the excluded request.
        const ref = target.row.ref;
        for (const key of Object.keys(target.row)) delete target.row[key];
        Object.assign(target.row, {
          ref,
          text: update.evidence,
          evidence: update.evidence,
          source: mail.source,
          sourceType: 'body',
          confidence: null,
          assignee: null,
          assigneeConfirmed: false,
          due: null,
          dueOriginal: null,
          person: null,
          lastRequestedAt: mail.source.sentAt,
        });
        if (!target.visible) output[target.kind].push(target.row);
        target.visible = true;
      }
      target.row.status = update.status;
      target.row.resolution = {
        source: mail.source,
        evidence: update.evidence,
        status: update.status,
        manual: false,
      };
      if (
        !target.excluded &&
        typeof update.text === 'string' &&
        update.text.trim() &&
        update.text.length <= 1000
      )
        target.row.latest = update.text;
    }
  }
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
    throw Error('ANALYSIS_FORMAT');
  for (const task of output.tasks) {
    const override = Object.hasOwn(overrides, task.ref)
      ? overrides[task.ref]
      : null;
    if (
      !override ||
      override.actor !== 'owner' ||
      typeof override.done !== 'boolean'
    )
      continue;
    const updatedAt = date(override.updatedAt).toISOString();
    task.status = override.done ? 'complete' : 'pending';
    task.resolution = {
      manual: true,
      actor: 'owner',
      updatedAt,
      done: override.done,
      email: task.resolution,
    };
  }
  const replyProof = new Map();
  const workKey = (item) =>
    [
      item.text,
      item.serviceDate ?? '',
      item.dueAt ?? '',
      item.dueDate ?? '',
      item.assignee ?? '',
    ].join('\0');
  for (const task of output.tasks) {
    const proof = task.resolution?.manual
      ? task.resolution.email
      : task.resolution;
    if (!proof?.source) continue;
    const key = proof.source.id + '\0' + workKey(task);
    replyProof.set(key, [...(replyProof.get(key) ?? []), task]);
  }
  for (const task of output.tasks) {
    const matches = replyProof.get(task.source.id + '\0' + workKey(task));
    if (matches?.length !== 1 || matches[0] === task) continue;
    const target = matches[0];
    if (
      task.resolution?.manual &&
      (!target.resolution?.manual ||
        task.resolution.updatedAt > target.resolution.updatedAt)
    ) {
      target.status = task.status;
      target.resolution = task.resolution;
    }
    task.linkedWorkRef = target.ref;
    task.status = target.status;
    task.resolution = target.resolution;
  }
  const linkedRefs = new Set(
    [...(manual.entries ?? []), ...(manual.workContext ?? [])].flatMap(
      (entry) =>
        (entry.items ?? []).map((item) => item.workRef).filter(Boolean),
    ),
  );
  const visible = (item) =>
    linkedRefs.has(item.ref) ||
    item.source.carryOnly !== true ||
    !['complete', 'resolved'].includes(item.status) ||
    (item.resolution?.manual === true &&
      dailyReportIdentity(item.resolution.updatedAt).day === identity.day);
  for (const kind of ['tasks', 'issues', 'waiting'])
    output[kind] = output[kind].filter(visible);
  for (const mail of rows) {
    const images = mail.source.images ?? [];
    if (
      !Array.isArray(images) ||
      images.length > 3 ||
      !Array.isArray(mail.imageFacts ?? []) ||
      (mail.imageFacts?.length ?? 0) > 30
    )
      throw Error('IMAGE_SOURCE');
    let total = 0;
    const imageIds = new Set(),
      imageHashes = new Set();
    for (const image of images) {
      if (
        typeof image.id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(image.id) ||
        imageIds.has(image.id) ||
        imageHashes.has(image.contentHash) ||
        typeof image.name !== 'string' ||
        !image.name.trim() ||
        image.name.length > 300 ||
        !hex.test(image.contentHash ?? '') ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(image.mediaType) ||
        !Number.isSafeInteger(image.width) ||
        !Number.isSafeInteger(image.height) ||
        image.width < 1 ||
        image.height < 1 ||
        image.width > 8000 ||
        image.height > 8000 ||
        !Number.isSafeInteger(image.byteLength) ||
        image.byteLength < 1 ||
        image.byteLength > 2100000
      )
        throw Error('IMAGE_SOURCE');
      imageIds.add(image.id);
      imageHashes.add(image.contentHash);
      total += image.byteLength;
    }
    if (total > 4000000) throw Error('IMAGE_SOURCE');
    for (const fact of mail.imageFacts ?? [])
      if (
        !images.some((image) => image.id === fact.imageId) ||
        (fact.sourceId != null && fact.sourceId !== mail.source.id) ||
        (fact.sourceType != null && fact.sourceType !== 'image') ||
        !['readable', 'uncertain'].includes(fact.confidence)
      )
        throw Error('IMAGE_EVIDENCE');
      else text(fact.text);
  }
  const view = {
    ...identity,
    groups,
    issues: output.issues,
    tasks: output.tasks,
    waiting: output.waiting.filter((item) => item.status !== 'resolved'),
    resolvedWaiting: output.waiting.filter(
      (item) => item.status === 'resolved',
    ),
    sources: rows.map((mail) => mail.source),
  };
  return {
    ...view,
    workItems: dailyWorkItems(view, manual, {
      excludedSourceIds: new Set(
        allRows
          .filter((mail) => mail.source.excluded === true)
          .map((mail) => mail.source.id),
      ),
    }),
    workSections: WORK_SECTIONS,
    workStatusLabels: WORK_STATUS_LABELS,
  };
}

const localTime = (value) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date(value));
export function renderDailyBriefing({ now, analyses, overrides, manual = {} }) {
  const view = dailyBriefingView({ now, analyses, overrides, manual });
  if (manual.day != null && manual.day !== view.day) throw Error('REPORT_DATE');
  const times = [
    ...analyses.map(
      (item) => item.updatedAt ?? item.source.receivedAt ?? item.source.sentAt,
    ),
    ...(manual.entries ?? []).map((item) => item.updatedAt ?? item.submittedAt),
    ...view.workItems
      .flatMap((item) => [item.ownerStateAt, item.closedAt])
      .filter(Boolean),
  ];
  const updatedAt =
    times
      .filter(Boolean)
      .map((value) => date(value).toISOString())
      .sort()
      .at(-1) ?? view.day + 'T00:00:00+09:00';
  const managedHtml =
    '<div data-id="sajo-mail-daily-' +
    view.day +
    '"><p>최종 업데이트: ' +
    escape(localTime(updatedAt)) +
    ' (한국시간)</p>' +
    renderWorkSections(view.workItems) +
    '</div>';
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
    escape(view.title) +
    '</title></head><body>' +
    managedHtml +
    '<div data-id="sajo-mail-manual"><h2>직접 메모</h2><p></p></div></body></html>';
  if (new TextEncoder().encode(html).byteLength > 2 * 1024 * 1024)
    throw Error('REPORT_LIMIT');
  return {
    day: view.day,
    title: view.title,
    html,
    managedHtml,
    sourceIds: [
      ...new Set([
        ...view.sources.map((item) => item.id),
        ...(manual.entries ?? [])
          .filter((entry) => entry.status === 'ready' && entry.items?.length)
          .map((entry) => entry.entryId),
      ]),
    ],
  };
}

export function selectDailyPage({
  identity,
  pages,
  savedPageId = null,
  pagesComplete = false,
}) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(identity?.day ?? '') ||
    dailyReportIdentity(identity.day + 'T00:00:00+09:00').title !==
      identity.title ||
    !Array.isArray(pages)
  )
    throw Error('PAGE_IDENTITY');
  const inSection = (page) =>
    page?.parent_section?.id === BRIEFING_TARGET.sectionId;
  const candidates = pages.filter(
    (page) => inSection(page) && page.title === identity.title,
  );
  if (candidates.length > 1) throw Error('PAGE_AMBIGUOUS');
  if (savedPageId !== null) {
    const saved = pages.find((page) => page.id === savedPageId);
    if (!saved)
      throw Error(
        pagesComplete ? 'PAGE_REFERENCE_MISSING' : 'PAGE_LIST_INCOMPLETE',
      );
    if (!inSection(saved) || saved.title !== identity.title)
      throw Error('PAGE_REFERENCE_CONFLICT');
    return { kind: 'existing', pageId: saved.id };
  }
  if (!pagesComplete) throw Error('PAGE_LIST_INCOMPLETE');
  if (!candidates.length) return { kind: 'create', pageId: null };
  if (typeof candidates[0].id !== 'string' || !candidates[0].id)
    throw Error('PAGE_IDENTITY');
  return { kind: 'existing', pageId: candidates[0].id };
}
export function checkManagedContent({ expectedHash, currentHash }) {
  if (
    (expectedHash !== null && !hex.test(expectedHash)) ||
    (currentHash !== null && !hex.test(currentHash))
  )
    throw Error('PAGE_CONTENT_HASH');
  return expectedHash === currentHash;
}

export function planManagedUpdate({ expectedHash, currentHash, desiredHash }) {
  if (!hex.test(desiredHash)) throw Error('PAGE_CONTENT_HASH');
  const unchanged = checkManagedContent({ expectedHash, currentHash });
  if (currentHash === desiredHash) return 'skip';
  if (!unchanged) return 'conflict';
  return currentHash === null ? 'append' : 'replace';
}
