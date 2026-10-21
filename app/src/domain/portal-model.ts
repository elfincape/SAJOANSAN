import type { PortalTask, PortalTemplate, PortalInputs } from './portal-types';
import { koreaDate } from './operations';
export const finished = (task: Pick<PortalTask, 'status'>) =>
  ['completed', 'not_applicable'].includes(task.status);
export function dispatchWarning(task: PortalTask, now = new Date()) {
  if (
    finished(task) ||
    !task.cj_share_due_at ||
    task.inputs?.cj_shared === true
  )
    return '';
  const remaining = +new Date(task.cj_share_due_at) - +now;
  return remaining < 0
    ? '공유 마감 지연'
    : remaining <= 3600000
      ? '공유 마감 1시간 이내 · 배송팀 지원 필요'
      : remaining <= 10800000
        ? '공유 마감 3시간 이내'
        : '';
}
export function orderTasks(
  tasks: PortalTask[],
  {
    userId,
    today = koreaDate(),
    now = new Date(),
    handedOff = new Set<string>(),
  }: {
    userId?: string;
    today?: string;
    now?: Date;
    handedOff?: Set<string>;
  } = {},
) {
  const rank = (task: PortalTask) => {
    if (finished(task)) return 4;
    const deadline = [
      task.due_at,
      task.inputs?.cj_shared === true ? null : task.cj_share_due_at,
    ]
      .filter(Boolean)
      .map((v) => new Date(v!).valueOf());
    if (deadline.some((v) => v - +now <= 10800000)) return 0;
    if (task.owner_id === userId && handedOff.has(task.id)) return 1;
    if (task.work_date <= today) return 2;
    return 3;
  };
  return [...tasks].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      String(a.work_date).localeCompare(String(b.work_date)) ||
      String(a.created_at).localeCompare(String(b.created_at)) ||
      a.id.localeCompare(b.id),
  );
}
export function currentTemplates(
  templates: PortalTemplate[],
  today = koreaDate(),
) {
  const families = new Map<string, PortalTemplate>();
  for (const t of templates) {
    const effective =
      t.spec?.effective_from ??
      koreaDate(new Date(t.approved_at ?? t.created_at));
    if (!['approved', 'retired'].includes(t.status) || effective > today)
      continue;
    if (
      !families.has(t.family_id) ||
      families.get(t.family_id)!.version < t.version
    )
      families.set(t.family_id, t);
  }
  return [...families.values()].filter((t) => t.status === 'approved');
}
export const surveyFields = [
  ['sequence', '업무 처리 순서'],
  ['repeat', '반복 주기'],
  ['deadline', '마감시간'],
  ['owner', '담당자'],
  ['handoff', '인계 대상'],
  ['completion', '완료 조건'],
  ['problems', '자주 발생하는 문제'],
  ['automation', '자동화 가능성'],
];
export const surveyStages: Record<string, string> = {
  submitted: '제출됨',
  surveyed: '조사 완료',
  designed: '설계 완료',
  built: '구축 완료',
  verified: '운영 검증 완료',
};

export function collectPortalInputs(
  task: PortalTask,
  values: Record<string, unknown>,
  workNote?: string,
) {
  const inputs: PortalInputs = structuredClone(task.inputs ?? {});
  for (const field of task.template_snapshot?.spec?.fields ?? []) {
    if (!(field.key in values)) continue;
    const value = values[field.key];
    if (field.type === 'boolean') inputs[field.key] = value === true;
    else if (field.type === 'number') {
      if (value === '') delete inputs[field.key];
      else {
        const number = Number(value);
        if (!Number.isFinite(number))
          throw Error(field.label + ' 값을 확인해 주세요.');
        inputs[field.key] = number;
      }
    } else inputs[field.key] = value;
  }
  if (workNote !== undefined) inputs.work_note = workNote;
  return inputs;
}
