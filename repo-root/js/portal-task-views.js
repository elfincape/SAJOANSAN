import {koreaDate} from './operations-view.js';
const iso=d=>d.toISOString().slice(0,10);
const date=value=>new Date(value+'T00:00:00Z');
export function addDays(value,days){const d=date(value);d.setUTCDate(d.getUTCDate()+days);return iso(d);}
export function periodBounds(value,unit){
 const d=date(value);if(!Number.isFinite(+d)||iso(d)!==value)throw Error('조회 날짜를 확인하세요.');
 if(unit==='week'){const from=addDays(value,-((d.getUTCDay()+6)%7));return {from,through:addDays(from,6)};}
 if(unit==='month')return {from:iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1))),through:iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)))};
 return {from:value,through:value};
}
export function shiftPeriod(value,unit,direction){
 if(unit!=='month')return addDays(value,direction*(unit==='week'?7:1));
 const d=date(value);return iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+direction,1)));
}
export function taskState(task,now=new Date()){
 if(['completed','not_applicable'].includes(task.status))return 'completed';
 return (task.due_at?new Date(task.due_at)<now:!task.inputs?.personal_work&&taskEnd(task)<koreaDate(now))?'delayed':'active';
}
export const taskEnd=task=>task.work_end_date||task.work_date;
export const taskPeriod=task=>task.work_date+(taskEnd(task)===task.work_date?'':' ~ '+taskEnd(task));
export const overlapsPeriod=(task,from,through)=>task.work_date<=through&&taskEnd(task)>=from;
export function calendarSegments(tasks,dates){
 const lanes=[];return tasks.filter(t=>overlapsPeriod(t,dates[0],dates.at(-1))).sort((a,b)=>a.work_date.localeCompare(b.work_date)||taskEnd(b).localeCompare(taskEnd(a))||String(a.id).localeCompare(String(b.id))).map(task=>{
  const start=dates.findIndex(d=>d>=task.work_date),end=dates.findLastIndex(d=>d<=taskEnd(task));let lane=lanes.findIndex(last=>last<start);if(lane<0)lane=lanes.length;lanes[lane]=end;
  return {task,start,end,lane,continuesBefore:task.work_date<dates[0],continuesAfter:taskEnd(task)>dates.at(-1)};
 });
}
export const taskStateLabels={active:'진행중',completed:'완료',delayed:'지연'};
export function calendarDates(value,unit){
 const bounds=periodBounds(value,unit);let start=bounds.from,end=bounds.through;
 if(unit==='month'){start=periodBounds(start,'week').from;end=periodBounds(end,'week').through;}
 const dates=[];for(let day=start;day<=end;day=addDays(day,1))dates.push(day);return dates;
}

export function taskRunsOnDate(template,value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==value)return false;const spec=template.spec??template.template_snapshot?.spec??{};const day=date.getUTCDay()||7;return spec.ui_cadence!=='daily'||spec.repeat?.kind!=='weekdays'||(spec.repeat.days??[]).includes(day);}
export function taskScheduleLabel(template){const spec=template.spec??{};return spec.ui_cadence==='daily'&&spec.repeat?.kind==='weekdays'?' · '+(spec.repeat.days??[]).map(d=>['','월','화','수','목','금','토','일'][d]).join('·'):'';}
