import assert from 'node:assert/strict';
import {briefingCandidates,briefingPrompt,materializeBriefing,surveyPrompt,validateSurveyDraft} from '../supabase/functions/operations-assistant/portal-model.js';
import {makePortalAiHandler} from '../supabase/functions/operations-assistant/portal.js';
const userId='00000000-0000-4000-8000-000000000001',surveyId='00000000-0000-4000-8000-000000000002';
const snapshot={date:'2026-10-11',centers:[{code:'001',name:'안산'}],counts:{pending_tasks:2,open_incidents:1,yesterday_events:1,master_changes:1},tasks:[
 {id:'a',center_code:'001',title:'배송 마감',work_date:'2026-10-11',due_at:'2020-01-01T00:00:00Z',version:1},
 {id:'b',center_code:'001',title:'오늘 배차',work_date:'2026-10-11',version:2}],
 incidents:[{id:'c',center_code:'001',title:'기사 문제',support_state:'requested',version:1}],
 events:[{id:'1',task_id:'b',action:'handoff',title:'오늘 배차',center_code:'001',occurred_at:'2026-10-10T02:00:00Z'}],
 changes:[{id:'2',table_name:'vehicles',row_id:'vehicle',title:'경기80바1234',center_code:'001',action:'UPDATE',changed_fields:['tonnage'],changed_at:'2026-10-10T03:00:00Z'}]};
const candidates=briefingCandidates(snapshot,new Date('2026-10-11T01:00:00Z'));
const briefing=materializeBriefing({rankings:['event:1','change:2']},snapshot,candidates);
assert.equal(briefing.items[0].ref,'task:a');assert(briefing.items.some(row=>row.ref==='incident:c'),'urgent support cannot be silently omitted');
assert.throws(()=>materializeBriefing({rankings:['task:invented']},snapshot,candidates),/원본/);
assert.throws(()=>materializeBriefing({rankings:['task:a','task:a']},snapshot,candidates),/원본/);
assert.equal(briefingPrompt(snapshot,candidates).candidates.length,5);
const survey={id:surveyId,version:1,title:'배송 배차',center_code:'001',details:{sequence:'차량 확인\n기사 연락',completion:'전달 확인'}};
const source=surveyPrompt(survey).source;
const draft={steps:[{label:'차량 확인',evidence:'차량 확인'}],fields:[],completion:{text:'전달 여부 확인',evidence:'전달 확인'},repeat:null,automation:[],questions:['반복 주기는 언제인가요?']};
assert.equal(validateSurveyDraft(draft,survey,source).survey_version,1);
assert.throws(()=>validateSurveyDraft({...draft,steps:[{label:'자동 CJ 전송',evidence:'존재하지 않는 원문'}]},survey,source),/원문/);
let role='admin',active=true,cache=null,aiCalls=0,answer={rankings:['task:b']},calls=[];
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',AIAPIFLOW_API_KEY:'ai'};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
async function fake(input,options={}){
 const url=new URL(input),path=url.pathname,b=options.body?JSON.parse(options.body):null;
 if(path==='/auth/v1/user')return json({id:userId});
 if(url.hostname==='aiapiflow.com'){aiCalls++;assert.equal(b.model,'claude-haiku-4-5-20251001');assert(b.max_tokens<=4000);return json({content:[{type:'text',text:JSON.stringify(answer)}]});}
 assert.equal(url.hostname,'example.supabase.co');calls.push({path,method:options.method});
 if(path==='/rest/v1/user_profiles')return json([{id:userId,role,active}]);
 if(path==='/rest/v1/rpc/operations_ai_snapshot')return json(snapshot);
 if(path==='/rest/v1/rpc/operations_ai_scheduler_authorized')return json(options.headers.Authorization==='Bearer alternative-service');
 if(path==='/rest/v1/operations_surveys')return json([survey]);
 if(path==='/rest/v1/rpc/operations_ai_acquire'){
  if(cache?.status==='ready'&&cache.fingerprint===b.p_fingerprint)return json({acquired:false,entry:cache});
  cache={fingerprint:b.p_fingerprint,status:'running',body:null};return json({acquired:true,key:'cache',lease:'nonce'});
 }
 if(path==='/rest/v1/rpc/operations_ai_finish'){cache.status=b.p_error?'failed':'ready';cache.body=b.p_body;cache.last_error=b.p_error;cache.generated_at=new Date().toISOString();return json(true);}
 throw Error('unexpected operation '+path);
}
const handler=makePortalAiHandler(env,fake);
function request(action='portal-briefing',body={},token='user'){return new Request('https://server/functions/v1/operations-assistant/'+action,{method:'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});}
assert.equal((await handler(request('portal-briefing',{},null))).status,401);assert.equal(aiCalls,0);
role='editor';assert.equal((await handler(request())).status,403);assert.equal(aiCalls,0);role='admin';
active=false;assert.equal((await handler(request())).status,403);active=true;
assert.equal((await handler(request('scheduled-briefing',{},'user'))).status,401);
assert.equal((await handler(request('scheduled-briefing',{},'alternative-service'))).status,200);cache=null;aiCalls=0;
const result=await(await handler(request())).json();assert.equal(result.model_used,true);assert(result.items.some(row=>row.ref==='task:a'));assert.equal(aiCalls,1);
const cached=await(await handler(request())).json();assert.equal(cached.cached,true);assert.equal(aiCalls,1);
assert(calls.every(call=>call.method!=='PATCH'&&call.method!=='DELETE'),'AI must not update or delete workflow records');
cache=null;answer={rankings:['task:invented']};const invalid=await handler(request());assert.equal(invalid.status,502);assert.equal(cache.status,'failed');assert.equal(cache.body,null);
cache=null;answer=draft;const generatedDraft=await(await handler(request('portal-survey-draft',{surveyId}))).json();assert.equal(generatedDraft.kind,'survey_draft');assert.equal(generatedDraft.survey_version,1);
cache=null;const missingKey=await makePortalAiHandler({...env,AIAPIFLOW_API_KEY:''},fake)(request());assert.equal(missingKey.status,503);assert.equal(cache.status,'failed');
console.log('PASS: grounded references, mandatory urgency, survey evidence, HQ access, scheduled authentication, bounded AI calls, caching, failure visibility and no workflow writes');
