import {serverKeys} from '../notion-health/handler.js';
import {dbClient,pointsNotionClient} from '../notion-points/sync.js';
import {CENTERS,SOURCES,UUID,fail,validate} from './model.js';
import {batch,check} from './sync.js';
import {summaryBatch} from './summary.js';
import {verifyRoundTrip} from './verify.js';
import {repairPointHome} from './repair.js';
export function makeHandler(env,fetcher=fetch) {
  const cors={'Access-Control-Allow-Origin':'https://sajoansan.vercel.app','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
  return async req=>{
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(req.method!=='POST')return json({error:'POST 요청만 지원합니다.'},405);
    try{
      const action=new URL(req.url).pathname.split('/').at(-1);
      if(!['test','sync','summary','verify','repair'].includes(action))throw fail('지원하지 않는 요청입니다.',404);
      const keys=serverKeys(env),key=keys[0];if(!key||!env.SUPABASE_URL)throw fail('서버 설정을 확인해 주세요.',503);
      const auth=req.headers.get('authorization')||'',bearer=auth.replace(/^Bearer /i,'');
      let internal=!req.headers.get('origin')&&(keys.includes(req.headers.get('apikey'))||keys.includes(bearer));
      if(!internal&&!req.headers.get('origin')&&bearer.startsWith('eyJ')&&env.SUPABASE_ANON_KEY){
        let claims={};try{claims=JSON.parse(atob(bearer.split('.')[1].replaceAll('-','+').replaceAll('_','/')));}catch{}
        if(claims.role==='service_role')internal=(await fetcher(env.SUPABASE_URL+'/rest/v1/user_profiles?select=id&limit=0',{
          headers:{Authorization:auth,apikey:env.SUPABASE_ANON_KEY},signal:AbortSignal.timeout(10000)})).ok;
      }
      if(!internal){
        if(action==='verify'||action==='repair')throw fail('서버 검증만 허용됩니다.',403);
        if(!/^Bearer \S+$/i.test(auth))throw fail('로그인이 필요합니다.',401);
        const r=await fetcher(env.SUPABASE_URL+'/auth/v1/user',{headers:{Authorization:auth,apikey:key},signal:AbortSignal.timeout(10000)});
        if(!r.ok)throw fail('로그인 세션을 확인해 주세요.',401);
        const user=await r.json();if(!UUID.test(user.id))throw fail('로그인 세션을 확인해 주세요.',401);
        const profile=(await dbClient(env,key,fetcher)('user_profiles?select=role,active&id=eq.'+user.id))[0];
        if(profile?.active!==true||profile.role!=='admin')throw fail('활성 관리자만 관계 동기화를 실행할 수 있습니다.',403);
      }
      const raw=await req.text();if(raw.length>3000)throw fail('요청이 너무 큽니다.');
      let body;try{body=JSON.parse(raw||'{}');}catch{throw fail('요청을 확인해 주세요.');}
      if(action==='repair')return json(await repairPointHome(env,key,fetcher));
      if(action==='test'){
        const request=pointsNotionClient(env,fetcher),integration=await request('users/me'),sources={};
        for(const kind of Object.keys(SOURCES)){try{await check(request,kind);sources[kind]='connected';}catch(error){sources[kind]=error.code||'unavailable';}}
        const connected=Object.values(sources).every(x=>x==='connected'),diagnostics={};
        if(!connected&&internal)for(const [kind,id] of Object.entries({companies:'3ae86f28-88a6-4644-b34a-11cf5f8df2b3',drivers:'3aacf7be-f54b-4327-aa63-55dde0d6c9b6',routes:'04f0ec36-55aa-49ae-a093-96841c500c80'})){
          try{const db=await request('databases/'+id);diagnostics[kind]={dataSources:db.data_sources,inTrash:db.in_trash};}catch(error){diagnostics[kind]={code:error.code};}
        }
        return json({connected,integrationName:integration.name,...(!connected&&internal?{integrationID:integration.id,diagnostics}:{}),sources});
      }
      if(action==='verify'){if(!Object.hasOwn(CENTERS,body.center))throw fail('센터를 확인해 주세요.');return json(await verifyRoundTrip(env,key,body.center,fetcher));}
      if(action==='summary')return json(await summaryBatch(env,key,body,fetcher));
      validate(body);return json(await batch(env,key,body,fetcher));
    }catch(error){return json({error:error.status?error.message:'관계 동기화 중 오류가 발생했습니다.',code:error.code||'server_error',
      ...(error.summary?{summary:error.summary}:{})},error.status||500);}
  };
}

