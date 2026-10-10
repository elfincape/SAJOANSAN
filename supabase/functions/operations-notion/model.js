// Shared fields only. Notion metadata never grants server permissions.
import {merge} from '../notion-graph/model.js';
export {merge};
const centers = {'001':'안산','002':'평택'};
const statuses = {pending:'미완료',in_progress:'진행중',completed:'완료',not_applicable:'해당없음'};
const inputFields = ['업무유형','기사명','차량번호','코스·납품처','톤수','사유','대차기사명','대차차량번호','정산방식'];
const text = p => (p?.title ?? p?.rich_text ?? []).map(v=>v.plain_text ?? v.text?.content ?? '').join('');
const rich = value => value ? [{type:'text',text:{content:String(value)}}] : [];
const invert = map => Object.fromEntries(Object.entries(map).map(([k,v])=>[v,k]));
function required(value, label) {
  if (!value) throw Error(`${label}을 확인해 주세요.`);
  return value;
}
export function taskValues(task) {
  return {title:task.title,center_code:task.center_code,work_date:task.work_date,status:task.status,
    ...Object.fromEntries(inputFields.map(k=>[k,task.inputs?.[k] ?? (k==='톤수'?null:k==='업무유형'?(task.title==='대차 배차 진행'?'대차 배차 진행':'일반업무'):'')]))};
}
export function pageTaskValues(page) {
  const p=page.properties;
  if (!p || page.archived || page.in_trash) throw Error('활성 업무 페이지를 확인해 주세요.');
  const title=required(text(p['업무명']).trim(),'업무명');
  const center_code=required(invert(centers)[p['센터']?.select?.name],'센터');
  const status=required(invert(statuses)[p['상태']?.select?.name],'상태');
  const work_date=required(p['업무일']?.date?.start,'업무일');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date) || !Number.isFinite(Date.parse(work_date)) || new Date(work_date).toISOString().slice(0,10)!==work_date) throw Error('업무일을 확인해 주세요.');
  const fields=Object.fromEntries(inputFields.map(k=>[k,k==='톤수'?p[k]?.number ?? null:['정산방식','업무유형'].includes(k)?p[k]?.select?.name ?? (k==='업무유형'?'일반업무':''):text(p[k])]));
  if(!['일반업무','대차 배차 진행'].includes(fields['업무유형']))throw Error('업무유형을 확인해 주세요.');
  if (fields['정산방식'] && !['월대공제','기사직접'].includes(fields['정산방식'])) throw Error('정산방식을 확인해 주세요.');
  if (fields['톤수']!==null && (!Number.isFinite(fields['톤수']) || fields['톤수']<0)) throw Error('톤수를 확인해 주세요.');
  return {title,center_code,work_date,status,...fields};
}
export function taskProperties(task) {
  const v=taskValues(task);
  if (!centers[v.center_code] || !statuses[v.status]) throw Error('업무 센터와 상태를 확인해 주세요.');
  return {'업무명':{title:rich(v.title)},'센터':{select:{name:centers[v.center_code]}},
    '업무일':{date:{start:v.work_date}},'상태':{select:{name:statuses[v.status]}},
    ...Object.fromEntries(inputFields.map(k=>[k,k==='톤수'?{number:v[k]}:['정산방식','업무유형'].includes(k)?{select:v[k]?{name:v[k]}:null}:{rich_text:rich(v[k])}])),
    '원본 ID':{rich_text:rich(task.id)},'수정 버전':{number:task.version},
    '완료 시각':{date:task.completed_at?{start:task.completed_at}:null}};
}
export function taskPatch(task, values) {
  // Preserve internal fields/steps that the native property form does not expose.
  return {title:values.title,center_code:values.center_code,work_date:values.work_date,status:values.status,
    inputs:{...task.inputs,...Object.fromEntries(inputFields.map(k=>[k,values[k]]))}};
}
export function mappedActor(page, identities) {
  const actor=identities.get(page.last_edited_by?.id);
  if (!actor?.user_id || !actor.active) throw Error('노션 수정자와 활성 웹 계정 연결이 필요합니다.');
  return actor.user_id;
}
