import {serverKeys} from '../notion-health/handler.js';
import {fail,UUID} from './model.js';
import {batch,check,dbClient,validate,pointsNotionClient} from './sync.js';
import {verifyRoundTrip} from './verify.js';
import {scan} from '../notion-graph/scan.js';
export function makeHandler(env,fetcher=fetch) {
  const cors={'Access-Control-Allow-Origin':'https://sajoansan.vercel.app','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
  return async req=>{
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(req.method!=='POST')return json({error:'POST 요청만 지원합니다.'},405);
    try {
      const action=new URL(req.url).pathname.split('/').at(-1);
      if(!['test','sync','verify','scan'].includes(action))throw fail('지원하지 않는 요청입니다.',404);
      const keys=serverKeys(env),key=keys[0];
      if(!key||!env.SUPABASE_URL)throw fail('서버 연결 설정을 확인해 주세요.',503);
      const auth=req.headers.get('authorization')||'',bearer=auth.replace(/^Bearer /i,'');
      let internal=!req.headers.get('origin')&&(keys.includes(req.headers.get('apikey'))||keys.includes(bearer));
      if(!internal&&!req.headers.get('origin')&&bearer.startsWith('eyJ')&&env.SUPABASE_ANON_KEY) {
        let claims={};try{claims=JSON.parse(atob(bearer.split('.')[1].replaceAll('-','+').replaceAll('_','/')));}catch{}
        if(claims.role==='service_role')internal=(await fetcher(env.SUPABASE_URL+'/rest/v1/user_profiles?select=id&limit=0',{
          headers:{Authorization:auth,apikey:env.SUPABASE_ANON_KEY},signal:AbortSignal.timeout(10000)})).ok;
      }
      if(!internal) {
        if(action==='verify'||action==='scan')throw fail('서버 검증 작업만 허용됩니다.',403);
        if(!/^Bearer \S+$/i.test(auth))throw fail('로그인이 필요합니다.',401);
        const r=await fetcher(env.SUPABASE_URL+'/auth/v1/user',{headers:{Authorization:auth,apikey:key},signal:AbortSignal.timeout(10000)});
        if(!r.ok)throw fail('로그인 세션을 확인해 주세요.',401);
        const user=await r.json();if(!UUID.test(user.id))throw fail('로그인 세션을 확인해 주세요.',401);
        const profile=(await dbClient(env,key,fetcher)('user_profiles?select=role,active&id=eq.'+user.id))[0];
        if(profile?.active!==true||profile.role!=='admin')throw fail('활성 관리자만 납품처 연동을 실행할 수 있습니다.',403);
      }
      if(action==='test')return json(await check(env,pointsNotionClient(env,fetcher)));
      const raw=await req.text();if(raw.length>2000)throw fail('요청 내용이 너무 큽니다.');
      let body;try{body=JSON.parse(raw);}catch{throw fail('요청 내용을 확인해 주세요.');}
      if(action==='scan')return json(await scan(env,key,{...body,kind:'points'},fetcher));
      validate(body);
      if(action==='verify')return json(await verifyRoundTrip(env,key,body.center,fetcher));
      return json(await batch(env,key,body,fetcher));
    }catch(error){return json({error:error.status?error.message:'납품처 연동 중 오류가 발생했습니다.',code:error.code||'server_error',
      ...(error.summary?{summary:error.summary}:{})},error.status||500);}
  };
}
