import {koreaDate} from './operations-view.js';
import {taskState,overlapsPeriod} from './portal-task-views.js';
export const historyStatuses={active:'처리중',delayed:'지연',completed:'완료',not_applicable:'해당없음',trashed:'휴지통'};
export function historyState(record,now=new Date()){
 if(record.deleted_at)return 'trashed';
 if(record.status==='not_applicable')return 'not_applicable';
 if(['completed','resolved'].includes(record.status))return 'completed';
 return record.kind==='incident'?'active':taskState(record,now);
}
export const visibleHistoryEvents=events=>events.filter(event=>event.action!=='file_uploaded');
export function groupHistory({events=[],tasks=[],incidents=[],center='',from,through,status='',now=new Date()}){
 const grouped=new Map();
 for(const event of visibleHistoryEvents(events)){
  const key=event.incident_id?'incident:'+event.incident_id:event.task_id?'task:'+event.task_id:null;
  if(!key)continue;
  if(!grouped.has(key))grouped.set(key,[]);
  grouped.get(key).push(event);
 }
 const records=new Map();
 for(const [kind,rows] of [['task',tasks],['incident',incidents]])for(const row of rows){
  const key=kind+':'+row.id;const history=grouped.get(key)??[],record={...row,kind,key,events:history};
  record.state=historyState(record,now);
  const eventInPeriod=history.some(e=>{const day=e.report_date||koreaDate(new Date(e.occurred_at));return day>=from&&day<=through;});
  const unfinished=['active','delayed'].includes(record.state);
  const inPeriod=kind==='task'?overlapsPeriod(row,from,through):!!row.created_at&&koreaDate(new Date(row.created_at))>=from&&koreaDate(new Date(row.created_at))<=through;
  const start=kind==='task'?row.work_date:row.created_at&&koreaDate(new Date(row.created_at));
  if((center&&row.center_code!==center)||(status&&record.state!==status)||!(eventInPeriod||inPeriod||(unfinished&&start<=through)))continue;
  record.last_activity=history.reduce((last,e)=>e.occurred_at>last?e.occurred_at:last,row.created_at||'');
  records.set(key,record);
 }
 return [...records.values()].sort((a,b)=>b.last_activity.localeCompare(a.last_activity)||a.key.localeCompare(b.key));
}
