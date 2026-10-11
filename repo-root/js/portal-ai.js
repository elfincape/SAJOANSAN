import {supabase} from './supabase.js';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';
async function call(action,body){
 const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('다시 로그인해 주세요.');
 const response=await fetch(SUPABASE_URL+'/functions/v1/operations-assistant/'+action,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(100000)});
 const result=await response.json();if(!response.ok)throw Error(result.error?.message??'AI 결과를 가져오지 못했습니다.');return result;
}
export const portalAi={
 briefing:(force=false)=>call('portal-briefing',{force}),
 draft:(surveyId,force=false)=>call('portal-survey-draft',{surveyId,force}),
 async cachedBriefing(){
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [result,dispatch]=await Promise.all([
   supabase.from('operations_ai_results').select('body,status,last_error,generated_at').eq('cache_key','briefing:'+day).maybeSingle(),
   supabase.from('operations_automation_state').select('last_error').eq('name','briefing-dispatch').maybeSingle()
  ]);
  if(result.error)throw result.error;if(dispatch.error)throw dispatch.error;
  return {...result.data,dispatch_error:dispatch.data?.last_error??null};
 }
};
