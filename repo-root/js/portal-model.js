import {koreaDate} from './operations-view.js';
export const finished = task => ['completed','not_applicable'].includes(task.status);
export function dispatchWarning(task, now = new Date()) {
 if (finished(task) || !task.cj_share_due_at || task.inputs?.cj_shared === true) return '';
 const remaining = new Date(task.cj_share_due_at) - now;
 return remaining < 0 ? '공유 마감 지연' : remaining <= 3600000 ? '공유 마감 1시간 이내 · HQ 지원 필요' : remaining <= 10800000 ? '공유 마감 3시간 이내' : '';
}
export function orderTasks(tasks, {userId, today=koreaDate(), now=new Date(), handedOff=new Set()} = {}) {
 const rank = task => {
  if (finished(task)) return 4;
  const deadline = [task.due_at, task.inputs?.cj_shared === true ? null : task.cj_share_due_at].filter(Boolean).map(v=>new Date(v).valueOf());
  if (deadline.some(v=>v-now <= 10800000)) return 0;
  if (task.owner_id===userId && handedOff.has(task.id)) return 1;
  if (task.work_date<=today) return 2;
  return 3;
 };
 return [...tasks].sort((a,b)=>rank(a)-rank(b) || String(a.work_date).localeCompare(String(b.work_date)) || String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id));
}
export function currentTemplates(templates, today=koreaDate()) {
 const families = new Map();
 for (const t of templates) {
  const effective = t.spec?.effective_from ?? koreaDate(new Date(t.approved_at ?? t.created_at));
  if (!['approved','retired'].includes(t.status) || effective>today) continue;
  if (!families.has(t.family_id) || families.get(t.family_id).version<t.version) families.set(t.family_id,t);
 }
 return [...families.values()].filter(t=>t.status==='approved');
}
export function collectInputs(task, form) {
 const inputs = structuredClone(task.inputs ?? {});
 for (const field of task.template_snapshot?.spec?.fields ?? []) {
  const el = form.elements.namedItem('field_'+field.key);
  if (!el) continue;
  if (field.type==='boolean') inputs[field.key]=el.checked;
  else if (field.type==='number') {
   if(el.value==='') delete inputs[field.key];
   else { const number=Number(el.value); if(!Number.isFinite(number)) throw Error(field.label+' 값을 확인해 주세요.'); inputs[field.key]=number; }
  } else inputs[field.key]=el.value;
 }
 const note=form.elements.namedItem('work_note');
 if(note) inputs.work_note=note.value;
 return inputs;
}
export const surveyFields = [
 ['sequence','업무 처리 순서'],['repeat','반복 주기'],['deadline','마감시간'],['owner','담당자'],['handoff','인계 대상'],
 ['files','사용하는 파일'],['systems','사용하는 시스템'],['completion','완료 조건'],['problems','자주 발생하는 문제'],['automation','자동화 가능성']
];
export const surveyStages={submitted:'제출됨',surveyed:'조사 완료',designed:'설계 완료',built:'구축 완료',verified:'운영 검증 완료'};
