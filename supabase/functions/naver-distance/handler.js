import {validateRequest} from '../kakao-distance/handler.js';
import {calculateNaverRoute} from './provider.js';
export function makeHandler(env,fetcher=fetch){
 const site='https://sajoansan.vercel.app',cors={'Access-Control-Allow-Origin':site,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:cors});
 return async req=>{
  if(req.headers.get('origin')&&req.headers.get('origin')!==site)return reply(403,{error:'허용되지 않은 출처입니다.'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply(405,{error:'POST 요청만 가능합니다.'});
  const signal=AbortSignal.timeout(90000);
  try{
   const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
   if(!token)return reply(401,{error:'로그인이 필요합니다.'});
   const headers={apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'};
   const auth=await fetcher(env.SUPABASE_URL+'/auth/v1/user',{headers,signal});
   if(!auth.ok)return reply(401,{error:'다시 로그인해 주세요.'});
   const user=await auth.json();
   const access=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/operations_resource_allowed',{method:'POST',headers,body:JSON.stringify({p_resource:'charter',p_action:'read',p_center:'002'}),signal});
   if(!user.id||!access.ok||await access.json()!==true)return reply(403,{error:'평택 용차 DB 열람 권한이 없습니다.'});
   const raw=await req.text();if(raw.length>20000)return reply(413,{error:'요청이 너무 큽니다.'});
   let body;try{body=JSON.parse(raw);}catch{return reply(400,{error:'계산 요청을 확인해 주세요.'});}
   return reply(200,await calculateNaverRoute(validateRequest(body),env,fetcher,signal));
  }catch(e){return reply(e.status??502,{error:e.name==='TimeoutError'||e.name==='AbortError'?'거리 계산 시간이 초과되었습니다. 다시 시도해 주세요.':e.status?e.message:'네이버 거리 계산 중 연결 오류가 발생했습니다.'});}
 };
}
