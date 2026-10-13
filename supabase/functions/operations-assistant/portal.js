import {callHaiku,HAIKU_MODEL} from '../_shared/haiku.js';
import {briefingCandidates,briefingPrompt,materializeBriefing,surveyPrompt,validateSurveyDraft,parseAiJson} from './portal-model.js';
const SITE='https://sajoansan.vercel.app',enc=encodeURIComponent;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function makePortalAiHandler(env,fetcher=fetch){
 const url=env.SUPABASE_URL,anon=env.SUPABASE_ANON_KEY,service=env.SUPABASE_SERVICE_ROLE_KEY;
 const cors={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
 const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
 async function db(path,{token=service,body,method=body===undefined?'GET':'POST'}={}){
  const response=await fetcher(url+'/rest/v1/'+path,{method,headers:{apikey:token===service?service:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw fail('브리핑·업무조사 서버 처리에 실패했습니다.',502);
  const text=await response.text();return text?JSON.parse(text):null;
 }
 async function hq(req){
  const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!token)throw fail('로그인이 필요합니다.',401);
  const response=await fetcher(url+'/auth/v1/user',{headers:{apikey:anon,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw fail('다시 로그인해 주세요.',401);
  const user=await response.json(),profile=(await db('user_profiles?select=id,role,active&id=eq.'+enc(user.id),{token}))[0];
  if(!profile?.active||profile.role!=='admin')throw fail('HQ 권한이 필요합니다.',403);return {id:user.id,token,email:user.email};
 }
 async function generate(kind,body,user){
  let snapshot,survey,promptData,candidates;
  if(kind==='briefing'){
   snapshot=await db('rpc/operations_ai_snapshot',{token:user?.token??service,body:{}});
   candidates=briefingCandidates(snapshot);promptData=briefingPrompt(snapshot,candidates);
  }else{
   if(!/^[0-9a-f-]{36}$/i.test(body.surveyId??''))throw fail('업무조사를 선택해 주세요.');
   survey=(await db('operations_surveys?select=id,title,details,version,center_code&id=eq.'+enc(body.surveyId),{token:user.token}))[0];
   if(!survey)throw fail('업무조사에 접근할 수 없습니다.',403);
   promptData=surveyPrompt(survey);snapshot={date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())};
  }
  const source=JSON.stringify(kind==='briefing'?{date:snapshot.date,counts:snapshot.counts,centers:snapshot.centers,candidates}:survey);
  const fingerprint=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source))))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const lease=await db('rpc/operations_ai_acquire',{body:{p_kind:kind,p_day:snapshot.date,p_survey:survey?.id??null,p_fingerprint:fingerprint,p_actor:user?.id??null,p_force:body.force===true}});
  if(!lease.acquired){const entry=lease.entry;if(entry.body)return {...entry.body,generated_at:entry.generated_at,model:HAIKU_MODEL,cached:true,fresh:entry.status==='ready'&&entry.fingerprint===fingerprint,status:entry.status,last_error:entry.last_error};
   if(entry.status==='failed')throw fail(entry.last_error||'AI 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',502);
   return {pending:true,status:entry.status,message:'브리핑·초안을 생성 중입니다. 잠시 후 다시 확인하세요.'};
  }
  try{
   let result;
   if(kind==='briefing'&&!candidates.length)result={...materializeBriefing({rankings:[]},snapshot,[]),model_used:false};
   else {const answer=parseAiJson(await callHaiku({key:env.AIAPIFLOW_API_KEY,prompt:promptData.prompt,maxTokens:kind==='briefing'?1800:4000,fetcher}));result=kind==='briefing'?materializeBriefing(answer,snapshot,candidates):validateSurveyDraft(answer,survey,promptData.source);result.model_used=true;}
   result.generated_at=new Date().toISOString();result.model=HAIKU_MODEL;
   if(!await db('rpc/operations_ai_finish',{body:{p_key:lease.key,p_lease:lease.lease,p_body:result,p_error:null}}))throw fail('더 최신 AI 생성 요청이 있어 결과를 저장하지 않았습니다.',409);
   return {...result,cached:false,fresh:true,status:'ready'};
  }catch(error){const message=error.status===503?'AI 서버 설정이 필요합니다.':error.message?.includes('AI')?error.message:'AI 결과를 생성하지 못했습니다. 기존 업무 기록은 유지됩니다.';
   await db('rpc/operations_ai_finish',{body:{p_key:lease.key,p_lease:lease.lease,p_body:null,p_error:message}}).catch(()=>{});throw fail(message,error.status??502);
  }
 }
 return async req=>{
  if(req.headers.get('origin')&&req.headers.get('origin')!==SITE)return json({error:{message:'허용되지 않은 출처입니다.'}},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return json({error:{message:'POST 요청이 필요합니다.'}},405);
  try{
   if(!url||!anon||!service)throw fail('AI 서버 설정이 필요합니다.',503);
   const action=new URL(req.url).pathname.split('/').filter(Boolean).at(-1),body=await req.json().catch(()=>null);if(!body||typeof body!=='object'||Array.isArray(body))throw fail('AI 요청을 확인해 주세요.');
   if(action==='scheduled-briefing'){
    const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if(!token)throw fail('예약 실행 인증이 필요합니다.',401);
    if(token!==service){let authorized=false;try{authorized=await db('rpc/operations_ai_scheduler_authorized',{token,body:{}});}catch{}if(!authorized)throw fail('예약 실행 인증이 필요합니다.',401);}
    const result=await generate('briefing',{force:body.force===true},null);return json({status:result.status,pending:!!result.pending,generated_at:result.generated_at,model_used:result.model_used});
   }
   if(!['portal-briefing','portal-survey-draft'].includes(action))throw fail('지원하지 않는 AI 작업입니다.',404);
   const user=await hq(req);
   if(action==='portal-survey-draft'&&String(user.email??'').trim().toLowerCase()!=='elfincape@gmail.com')throw fail('최고관리자만 AI 양식 초안을 생성할 수 있습니다.',403);
   return json(await generate(action==='portal-briefing'?'briefing':'survey_draft',body,user));
  }catch(error){return json({error:{message:error.message||'AI 요청을 처리하지 못했습니다.'}},error.status??500);}
 };
}
