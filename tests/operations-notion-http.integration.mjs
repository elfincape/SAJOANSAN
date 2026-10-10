import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rest,notion,management,runCycle as runLocalCycle} from '../scripts/operations-notion-cycle.mjs';
import {taskProperties} from '../supabase/functions/operations-notion/model.js';
const actor=randomUUID(),notionActor=(await notion('users/me')).id,source='910d7f0f-7ca6-496a-90a0-1ef44b4dc262';
const pages=new Set();let setup=false;
const sql=query=>management('database/query',{query});
let runCycle=runLocalCycle;
if(process.argv.includes('--edge')){
 const keys=await management('api-keys?reveal=true'),key=keys.find(k=>k.name==='service_role')?.api_key;
 const endpoint='https://yvdialfqlbpjbbmcetev.supabase.co/functions/v1/operations-notion';
 assert.equal((await fetch(endpoint,{method:'POST'})).status,401);
 runCycle=async()=>{const r=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(120000)});const result=await r.json();if(result.error)throw Error(result.error);return result;};
}
try{
 await sql(`begin;
 insert into auth.users(id,email) values('${actor}','notion-http-${actor}@example.invalid');
 insert into public.user_profiles(id,role,active) values('${actor}','editor',true);
 insert into public.operations_center_members(user_id,center_code) values('${actor}','001');
 insert into public.operations_notion_identities(notion_user_id,user_id) values('${notionActor}','${actor}');commit;`);setup=true;
 let task=await rest('rpc/operations_import_notion_task','POST',{p_notion_actor:notionActor,p_request_id:randomUUID(),p_task_id:null,p_expected_version:null,p_center:'001',p_title:'대차 배차 진행',p_work_date:'2026-10-11',p_inputs:{'기사명':'원본기사','정산방식':'월대공제'},p_status:'pending'});
 let result=await runCycle();assert.equal(result.errors.length,0,JSON.stringify(result.errors));assert.equal(result.created,1);
 let link=(await rest(`operations_notion_links?task_id=eq.${task.id}`))[0];pages.add(link.page_id);
 let page=await notion('pages/'+link.page_id);assert.equal(page.properties['기사명'].rich_text[0].plain_text,'원본기사');
 // Native API writes use a temporary mapped test identity, never an actual employee assignment.
 await notion('pages/'+page.id,'PATCH',{properties:{'기사명':{rich_text:[{text:{content:'노션수정기사'}}]}}});
 await rest('rpc/operations_import_notion_task','POST',{p_notion_actor:notionActor,p_request_id:randomUUID(),p_task_id:task.id,p_expected_version:task.version,p_center:'001',p_title:task.title,p_work_date:task.work_date,p_inputs:{...task.inputs,'사유':'웹에서 차량 고장 기록'},p_status:'pending'});
 result=await runCycle();assert.equal(result.errors.length,0,JSON.stringify(result.errors));assert.equal(result.pulled,1);
 task=(await rest(`operations_tasks?id=eq.${task.id}`))[0];assert.equal(task.inputs['기사명'],'노션수정기사');assert.equal(task.inputs['사유'],'웹에서 차량 고장 기록');
 page=await notion('pages/'+page.id);assert.equal(page.properties['사유'].rich_text[0].plain_text,'웹에서 차량 고장 기록');
 const quiet=await runCycle();assert.equal(quiet.pulled,0);assert.equal(quiet.pushed,0);assert.equal(quiet.created,0);
 await notion('pages/'+page.id,'PATCH',{properties:{'기사명':{rich_text:[{text:{content:'노션충돌기사'}}]}}});
 task=await rest('rpc/operations_import_notion_task','POST',{p_notion_actor:notionActor,p_request_id:randomUUID(),p_task_id:task.id,p_expected_version:task.version,p_center:'001',p_title:task.title,p_work_date:task.work_date,p_inputs:{...task.inputs,'기사명':'웹충돌기사'},p_status:'pending'});
 result=await runCycle();assert.equal(result.conflicts.length,1);assert.deepEqual(result.conflicts[0].fields,['기사명']);
 assert.equal((await notion('pages/'+page.id)).properties['기사명'].rich_text[0].plain_text,'노션충돌기사');assert.equal((await rest(`operations_tasks?id=eq.${task.id}`))[0].inputs['기사명'],'웹충돌기사');
 await notion('pages/'+page.id,'PATCH',{properties:{'기사명':{rich_text:[{text:{content:'웹충돌기사'}}]}}});
 result=await runCycle();assert.equal(result.conflicts.length,0);
 await notion('pages/'+page.id,'PATCH',{properties:{'상태':{select:{name:'완료'}}}});
 result=await runCycle();assert.equal(result.errors.length,0,JSON.stringify(result.errors));task=(await rest(`operations_tasks?id=eq.${task.id}`))[0];assert.equal(task.status,'completed');assert.equal(task.completed_by,actor);
 const properties=taskProperties({...task,title:'노션 새 업무 시험',status:'pending',completed_at:null});delete properties['원본 ID'];delete properties['수정 버전'];
 const newPage=await notion('pages','POST',{parent:{type:'data_source_id',data_source_id:source},properties});pages.add(newPage.id);
 result=await runCycle();assert.equal(result.errors.length,0,JSON.stringify(result.errors));const nativeLink=(await rest(`operations_notion_links?page_id=eq.${newPage.id}`))[0];assert.ok(nativeLink?.task_id);
 const countBefore=(await rest(`operations_tasks?created_by=eq.${actor}`)).length;
 await runCycle();assert.equal((await rest(`operations_tasks?created_by=eq.${actor}`)).length,countBefore);
 const leaseOwner=randomUUID();assert.equal(await rest('rpc/operations_sync_lock','POST',{p_owner:leaseOwner}),true);
 await assert.rejects(runCycle(),/동기화가 실행 중/);await rest('rpc/operations_sync_lock','POST',{p_owner:leaseOwner,p_release:true});
 console.log('PASS: real staging web/native round trip, different-field merge, quiet repeat, opposing conflict preservation, completion actor, native creation without duplication, overlapping run refusal');
}finally{
 if(setup){const links=await sql(`select l.page_id from public.operations_notion_links l join public.operations_tasks t on t.id=l.task_id where t.created_by='${actor}'`);for(const link of links)pages.add(link.page_id);
  let archiveError;for(const id of pages){try{await notion('pages/'+id,'PATCH',{archived:true});}catch(e){archiveError=e;}}
  await sql(`begin;
  delete from public.operations_notion_links where task_id in(select id from public.operations_tasks where created_by='${actor}');
  delete from public.operations_task_events where actor_id='${actor}';
  delete from public.operations_tasks where created_by='${actor}';
  delete from public.operations_notion_identities where user_id='${actor}';
  delete from public.operations_center_members where user_id='${actor}';
  delete from public.user_profiles where id='${actor}';delete from auth.users where id='${actor}';commit;`);
  console.log('Temporary staging native pages archived; task, event, identity and auth fixtures removed.');if(archiveError)throw archiveError;
 }
}
