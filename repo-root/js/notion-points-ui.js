import {supabase} from './supabase.js';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';
import {getRequiredCenter} from './center.js';
export function mountNotionPoints({profile,onRefresh}) {
  const button=document.getElementById('notion-points-sync');
  const status=document.getElementById('notion-points-status');
  if(!button||profile?.role!=='admin')return {syncOne:async()=>{}};
  button.classList.remove('hidden');let busy=false;
  async function call(body) {
    const {data:{session}}=await supabase.auth.getSession();
    if(!session)throw new Error('다시 로그인해 주세요.');
    const r=await fetch(SUPABASE_URL+'/functions/v1/notion-points/sync',{
      method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(150000)});
    const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'납품처 연동에 실패했습니다.');return data;
  }
  async function run(id) {
    if(busy)return;busy=true;button.disabled=true;status.textContent='노션과 동기화 중…';
    let phase='web',cursor=null,total=0,conflicts=0;
    try {
      for(let i=0;i<10000;i++) {
        const data=await call({center:getRequiredCenter().code,...(id?{id}:{phase,cursor})});
        total+=data.processed;conflicts+=data.conflicts;
        status.textContent=total+'건 처리 중…';
        if(!data.hasMore){status.textContent=conflicts?'동기화 완료 · 충돌 '+conflicts+'건은 노션에서 확인해 주세요.':'동기화 완료 · '+total+'건';break;}
        if(i===9999)throw new Error('처리 범위를 초과했습니다. 다시 실행해 주세요.');
        phase=data.phase;cursor=data.nextCursor;
      }
      await onRefresh();
    }catch(error){status.textContent='웹 저장은 유지됩니다. 노션 동기화 확인 필요: '+error.message;}
    finally{busy=false;button.disabled=false;}
  }
  button.addEventListener('click',()=>void run());
  return {syncOne:id=>run(id)};
}
