import {supabase} from './supabase.js';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';
import {getRequiredCenter} from './center.js';
export function mountNotionGraph({profile,kind,onRefresh,getId}){
  if(profile?.role!=='admin')return {syncOne:async()=>{}};
  const header=document.querySelector('header > div');if(!header)return {syncOne:async()=>{}};
  const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.textContent='노션 동기화';button.id='notion-graph-sync';
  const status=document.createElement('span');status.id='notion-graph-status';status.role='status';status.className='text-xs text-zinc-400';
  header.append(button,status);let busy=false;
  async function call(action,body){
    const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('다시 로그인해 주세요.');
    for(let retry=0;retry<4;retry++){
      const r=await fetch(SUPABASE_URL+'/functions/v1/notion-graph/'+action,{method:'POST',
        headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({center:getRequiredCenter().code,...body}),signal:AbortSignal.timeout(150000)});
      const data=await r.json().catch(()=>({}));
      if(data.code==='sync_busy'&&retry<3){status.textContent='정기 동기화 대기 중…';await new Promise(r=>setTimeout(r,5000));continue;}
      if(!r.ok)throw new Error(data.error||'노션 연동을 확인해 주세요.');return data;
    }
  }
  async function run(id){
    if(busy){status.textContent='진행 중인 동기화 후 정기 연동으로 반영됩니다.';return;}
    busy=true;button.disabled=true;let count=0,conflicts=0;
    status.textContent='노션과 동기화 중…';
    try{
      for(const target of id?[kind]:['companies','drivers','routes']){
        let phase='web',cursor=null,done=false;
        for(let i=0;i<10000;i++){
          const r=await call('sync',{kind:target,...(id?{id}:{phase,cursor})});count+=r.processed;conflicts+=r.conflicts;
          status.textContent=count+'건 처리 중…';if(!r.hasMore){done=true;break;}phase=r.phase;cursor=r.nextCursor;
        }
        if(!done)throw new Error('처리 범위를 확인해 주세요.');
      }
      for(const target of id?[kind]:['companies','drivers','routes']){
        let cursor=null,done=false;
        for(let i=0;i<10000;i++){
          const r=await call('summary',{kind:target,...(id?{id}:{cursor})});conflicts+=r.conflicts;
          if(!r.hasMore){done=true;break;}cursor=r.nextCursor;
        }
        if(!done)throw new Error('정보 미리보기를 확인해 주세요.');
      }
      status.textContent=conflicts?'동기화 완료 · 확인 필요 '+conflicts+'건':'동기화 완료 · '+count+'건';
      await onRefresh();
    }catch(error){status.textContent='웹 저장 유지 · 연동 확인 필요: '+error.message;}
    finally{busy=false;button.disabled=false;}
  }
  button.addEventListener('click',()=>void run(getId?.()));return {syncOne:id=>run(id)};
}

