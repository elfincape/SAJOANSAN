import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {canGenerateSurveyDraft} from '../repo-root/js/portal-draft-access.js';
import {makePortalAiHandler} from '../supabase/functions/operations-assistant/portal.js';
const owner={email:'elfincape@gmail.com',role:'admin',active:true};
assert(canGenerateSurveyDraft(owner));assert(canGenerateSurveyDraft({...owner,email:'ELFINCAPE@gmail.com'}));
for(const profile of [{...owner,email:'other@gmail.com'},{...owner,active:false},{...owner,role:'editor'},null])assert(!canGenerateSurveyDraft(profile));
const source=fs.readFileSync(new URL('../repo-root/js/portal-screen.js',import.meta.url),'utf8');
const start=source.indexOf('function surveyDetail(row,panel){'),end=source.indexOf('async function surveyDraft(survey,panel){',start);
for(const profile of [owner,{...owner,email:'other@gmail.com'},{...owner,role:'editor'}]){
 const labels=[];
 const node=()=>({append(){}});
 const button=text=>{labels.push(text);};
 vm.runInNewContext(source.slice(start,end)+"\nsurveyDetail({center_code:'001',stage:'submitted',details:{}},node());",{profile,canGenerateSurveyDraft,node,button,canWrite:()=>false,centerName:x=>x,surveyStages:{submitted:'제출됨',surveyed:'조사 완료'},surveyFields:[],isHq:()=>profile.role==='admin'});
 assert.equal(labels.includes('AI 양식 초안 생성'),canGenerateSurveyDraft(profile));
 if(profile.role==='admin')assert(labels.includes('조사 완료 기록'));
}
const env={SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'};
let email='other@gmail.com',role='admin',active=true,requests=[];
const fetcher=async(url,init={})=>{
 requests.push(url);
 if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'user',email}));
 if(url.includes('/user_profiles?'))return new Response(JSON.stringify([{id:'user',role,active,email:'elfincape@gmail.com'}]));
 if(url.includes('/operations_surveys?'))return new Response(JSON.stringify([{id:'00000000-0000-4000-8000-000000000001',title:'업무',version:1,details:{sequence:'업무 처리'}}]));
 if(url.endsWith('/rpc/operations_ai_acquire'))return new Response(JSON.stringify({acquired:false,entry:{body:{steps:[]},status:'ready'}}));
 if(url.endsWith('/rpc/operations_ai_snapshot'))return new Response(JSON.stringify({date:'2026-10-13',counts:{},centers:[],pending_tasks:[],open_incidents:[],yesterday_events:[],master_changes:[]}));
 return new Response('{}');
};
const handler=makePortalAiHandler(env,fetcher);
const call=action=>handler(new Request('https://db.test/functions/v1/operations-assistant/'+action,{method:'POST',headers:{authorization:'Bearer valid-user','content-type':'application/json'},body:JSON.stringify({surveyId:'00000000-0000-4000-8000-000000000001',email:'elfincape@gmail.com'})}));
let response=await call('portal-survey-draft');assert.equal(response.status,403);assert(!requests.some(url=>url.includes('operations_surveys')||url.includes('operations_ai_acquire')));
email='elfincape@gmail.com';requests=[];response=await call('portal-survey-draft');assert.equal(response.status,200);assert(requests.some(url=>url.includes('operations_surveys')));
role='editor';assert.equal((await call('portal-survey-draft')).status,403);
role='admin';active=false;assert.equal((await call('portal-survey-draft')).status,403);
console.log('Only the active owner admin sees and can generate drafts; other admins keep review controls; trusted Auth email defeats spoofed profile/body email');
