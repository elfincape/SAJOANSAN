import {createTaskSync} from './sync.js';
export function makeHandler(env,fetcher=fetch){
 const root='https://yvdialfqlbpjbbmcetev.supabase.co',service=env.SUPABASE_SERVICE_ROLE_KEY;
 const allowed=new Set(['https://sajoansan-git-codex-operations-staging-elfincapes-projects.vercel.app','http://127.0.0.1:8765']);
 return async request=>{
  const origin=request.headers.get('origin');const cors=origin&&allowed.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'}:{};
  const reply=(body,status=200)=>Response.json(body,{status,headers:cors});
  if(origin&&!allowed.has(origin))return reply({error:'허용되지 않은 시험 화면입니다.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(env.OPERATIONS_ENVIRONMENT!=='staging'||env.SUPABASE_URL!==root||!service||!env.OPERATIONS_NOTION_TOKEN)return reply({error:'시험 서버 설정을 확인해 주세요.'},503);
  if(request.method!=='POST')return reply({error:'POST 요청이 필요합니다.'},405);
  const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer '))return reply({error:'로그인이 필요합니다.'},401);
  // Runtime and Management API may expose different valid server keys.
  // Validate the caller with PostgREST on a service-only table; never trust a decoded role claim.
  let serverCaller=authorization===`Bearer ${service}`;
  if(!serverCaller){const check=await fetcher(root+'/rest/v1/operations_notion_identities?select=notion_user_id&limit=0',{headers:{apikey:service,Authorization:authorization},signal:AbortSignal.timeout(15000)});serverCaller=check.ok;}
  if(!serverCaller){
   const auth=await fetcher(root+'/auth/v1/user',{headers:{apikey:service,Authorization:authorization},signal:AbortSignal.timeout(15000)});if(!auth.ok)return reply({error:'로그인을 확인해 주세요.'},401);const user=await auth.json();
   const r=await fetcher(root+`/rest/v1/user_profiles?id=eq.${encodeURIComponent(user.id)}&select=role,active`,{headers:{apikey:service,Authorization:`Bearer ${service}`},signal:AbortSignal.timeout(15000)});
   if(!r.ok)return reply({error:'사용자 권한을 확인하지 못했습니다.'},503);const profile=(await r.json())[0];if(!profile?.active||profile.role!=='admin')return reply({error:'HQ 동기화 권한이 필요합니다.'},403);
  }
  let last=0;
  async function rest(path,method='GET',body,extra={}){
   const r=await fetcher(root+'/rest/v1/'+path,{method,headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
   if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.message??`Server HTTP ${r.status}`);}return r.status===204||r.headers.get('content-length')==='0'?null:r.json();
  }
  async function notion(path,method='GET',body,raw=false){
   const wait=Math.max(0,350-(Date.now()-last));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));last=Date.now();
   const r=await fetcher('https://api.notion.com/v1/'+path,{method,headers:{Authorization:`Bearer ${env.OPERATIONS_NOTION_TOKEN}`,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
   if(raw)return r;if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.message??`Notion HTTP ${r.status}`);}return r.json();
  }
  const owner=crypto.randomUUID();let locked=false;
  try{
   async function guard(){if(!await rest('rpc/operations_sync_lock','POST',{p_owner:owner,p_release:false}))throw Error('다른 동기화가 실행 중입니다.');locked=true;}
   await guard();const result=await createTaskSync({rest,notion,guard})();return reply(result,result.errors.length||result.conflicts.length?409:200);
  }catch(error){return reply({error:error.message},503);}
  finally{if(locked){try{await rest('rpc/operations_sync_lock','POST',{p_owner:owner,p_release:true});}catch{console.error('Staging operations sync lease release failed; lease expires automatically.');}}}
 };
}
