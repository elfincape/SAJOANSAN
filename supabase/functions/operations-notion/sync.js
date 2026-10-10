import {taskValues,pageTaskValues,taskProperties,taskPatch,merge} from './model.js';
import {equal} from '../notion-graph/model.js';
const source='910d7f0f-7ca6-496a-90a0-1ef44b4dc262';
const root='3f5b98bf-5f20-8174-aea9-e2967e4d678d';
export async function editRequestId(page,values,version){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({page:page.id,time:page.last_edited_time,actor:page.last_edited_by?.id,values,version})))).slice(0,16);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}
export function createTaskSync({rest,notion,guard=async()=>{}}){
 async function list(table,key='id'){const rows=[];for(let offset=0;;offset+=200){const page=await rest(`${table}?select=*&order=${key}&limit=200&offset=${offset}`);rows.push(...page);if(page.length<200)return rows;}}
 async function saveLink(link){await rest('operations_notion_links?on_conflict=page_id','POST',link,{'Prefer':'resolution=merge-duplicates,return=minimal'});}
 return async function sync(){
  await notion('pages/'+root);
  const forbidden=await notion('pages/3f4b98bf-5f20-81c2-992e-fecda52668d7','GET',undefined,true);
  if(![403,404].includes(forbidden.status))throw Error('시험 연결에서 운영 원본 접근이 허용돼 실행을 중단했습니다.');
  const tasks=await list('operations_tasks');
  const links=await list('operations_notion_links','page_id');const byTask=new Map(links.map(l=>[l.task_id,l])),byPage=new Map(links.map(l=>[l.page_id,l]));
  const result={created:0,pushed:0,pulled:0,unchanged:0,conflicts:[],errors:[]};
  // Query all source pages to recover a create response lost before link persistence.
  const native=[];let cursor;do{await guard();const batch=await notion(`data_sources/${source}/query`,'POST',{page_size:100,...(cursor?{start_cursor:cursor}:{})});native.push(...batch.results);cursor=batch.has_more?batch.next_cursor:null;}while(cursor);
  const originalIds=new Map();for(const page of native){const id=(page.properties?.['원본 ID']?.rich_text??[]).map(t=>t.plain_text??t.text?.content??'').join('');if(id){if(originalIds.has(id))throw Error('노션에 같은 원본 ID가 중복돼 확인이 필요합니다.');originalIds.set(id,page);}}
  for(let task of tasks){try{
   await guard();
   let link=byTask.get(task.id),page=link?native.find(p=>p.id===link.page_id):originalIds.get(task.id);
   if(!link&&page){
    // A recovered page must match the server values; never trust an arbitrary original-ID edit.
    if(!equal(pageTaskValues(page),taskValues(task)))throw Error('원본 ID가 있는 미연결 페이지의 내용이 다릅니다. 확인 후 연결해 주세요.');
    link={page_id:page.id,task_id:task.id,base_values:taskValues(task),observed_edit_at:page.last_edited_time,synced_at:new Date().toISOString(),conflict_fields:[]};await saveLink(link);byPage.set(page.id,link);
   }
   if(!link){
    page=await notion('pages','POST',{parent:{type:'data_source_id',data_source_id:source},properties:taskProperties(task)});
    link={page_id:page.id,task_id:task.id,base_values:taskValues(task),observed_edit_at:page.last_edited_time,synced_at:new Date().toISOString(),conflict_fields:[]};await saveLink(link);byPage.set(page.id,link);result.created++;continue;
   }
   if(!page)throw Error('연결된 노션 페이지를 찾을 수 없습니다. 자동 복제하지 않습니다.');
   const web=taskValues(task),remote=pageTaskValues(page),merged=merge(link.base_values,web,remote);
   if(merged.conflicts.length){await saveLink({...link,conflict_fields:merged.conflicts});result.conflicts.push({task_id:task.id,fields:merged.conflicts});continue;}
   if(!equal(web,merged.values)){
    if(task.status==='completed'||task.status==='not_applicable')throw Error('확정된 업무는 변경할 수 없습니다.');
    const values=taskPatch(task,merged.values);
    task=await rest('rpc/operations_import_notion_task','POST',{p_notion_actor:page.last_edited_by?.id,p_request_id:await editRequestId(page,values,task.version),p_task_id:task.id,p_expected_version:task.version,p_center:values.center_code,p_title:values.title,p_work_date:values.work_date,p_inputs:values.inputs,p_status:values.status});result.pulled++;
   }
   if(!equal(remote,taskValues(task))||page.properties?.['수정 버전']?.number!==task.version){
    // Re-read before writing: a concurrent native edit must not be overwritten.
    const current=await notion('pages/'+page.id);if(current.last_edited_time!==page.last_edited_time||!equal(pageTaskValues(current),remote))throw Error('동기화 중 노션 내용이 변경됐습니다. 다음 실행에서 다시 확인합니다.');
    page=await notion('pages/'+page.id,'PATCH',{properties:taskProperties(task)});result.pushed++;
   }else result.unchanged++;
   await saveLink({...link,base_values:taskValues(task),observed_edit_at:page.last_edited_time,synced_at:new Date().toISOString(),conflict_fields:[]});
  }catch(error){result.errors.push({task_id:task.id,message:error.message});}}
  // Native buttons can create pending entries; creation import requires a mapped human account.
  for(const page of native){if(byPage.has(page.id)||originalIds.has((page.properties?.['원본 ID']?.rich_text??[]).map(t=>t.plain_text??t.text?.content??'').join('')))continue;
   try{await guard();const values=pageTaskValues(page);if(values.status!=='pending')throw Error('새 업무는 미완료로 등록해 주세요.');
    const inputs=taskPatch({inputs:{}},values).inputs;
    await rest('rpc/operations_create_notion_task','POST',{p_page_id:page.id,p_notion_actor:page.created_by?.id,p_request_id:page.id,p_center:values.center_code,p_title:values.title,p_work_date:values.work_date,p_inputs:inputs,p_base_values:values,p_edit_at:page.last_edited_time});result.pulled++;
   }catch(error){result.errors.push({page_id:page.id,message:error.message});}
  }
  return result;
 };
}
