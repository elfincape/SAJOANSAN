import { requireRole, signOut } from './auth.js';
import { supabase } from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { forceCenterSelectionFromUrl, requireSelectedCenter, withCenterParam, mountHeaderCenterSwitcher } from './center.js';
const $=id=>document.getElementById(id);
let busy=false,ready=false,total=0;
function message(id,text,ok=false) {
  $(id).textContent=text;
  $(id).className='text-sm mt-4 '+(ok?'text-emerald-400':'text-zinc-300');
}
function list(id,lines) {
  $(id).replaceChildren(...lines.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
}
function buttons() {
  $('test-btn').disabled=busy;
  $('preview-btn').disabled=busy;
  $('complete-btn').disabled=busy;
  $('sync-btn').disabled=busy || !ready || total===0;
}
async function call(action,body={}) {
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)throw new Error('다시 로그인해 주세요.');
  const response=await fetch(SUPABASE_URL+'/functions/v1/notion-health/'+action,{
    method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_ANON_KEY,
      'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(140000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error || 'Notion 연동 요청에 실패했습니다.'),{data});
  return data;
}
const reason=error=>error.name==='TimeoutError'?'응답 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.':error.message;
const profile=await requireRole('admin');
if(profile) {
  const center=await requireSelectedCenter({force:forceCenterSelectionFromUrl()});
  $('hub-link').href=withCenterParam('/admin/',center);
  mountHeaderCenterSwitcher(next=>location.replace(withCenterParam('/admin/notion-health.html',next)));
  $('logout-btn').addEventListener('click',signOut);
  $('sync-center').textContent=(center.code==='002'?'평택':'안산')+' 센터 기사만 동기화합니다.';
  message('test-status','연결 테스트 버튼을 눌러 확인하세요.');
  function showLastUpdate(value) {
    const date=value?new Date(value):null;
    $('complete-last-updated').textContent=date && Number.isFinite(date.getTime())
      ? '마지막 업데이트: '+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',
          year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date)+' (한국 시간)'
      : '마지막 업데이트: 아직 완료된 반영 기록이 없습니다.';
  }
  async function refreshLastUpdate() {
    try{const data=await call('status',{center:center.code});showLastUpdate(data.lastUpdatedAt);}
    catch{$('complete-last-updated').textContent='마지막 업데이트: 조회하지 못했습니다.';}
  }
  setInterval(()=>{if(!document.hidden)void refreshLastUpdate();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshLastUpdate();});
  async function preview() {
    ready=false;
    const result=await call('preview',{center:center.code});
    total=result.total;ready=true;
    message('preview-status',result.centerName+' 센터 · '+result.today+' 기준 관리 대상 '+total+'명',true);
    list('preview-counts',Object.entries(result.counts).map(([name,count])=>name+' '+count+'명'));
    return result;
  }
  $('test-btn').addEventListener('click',async()=>{
    busy=true;buttons();$('test-btn').textContent='확인 중…';
    message('test-status','Notion 연결을 확인하고 있습니다.');list('test-details',[]);
    try {
      const data=await call('test');
      if(!data.connected || !data.schemaValid || !data.readable)throw new Error('연결 확인 결과가 올바르지 않습니다.');
      message('test-status','연결 성공 · 보건증 갱신 목록에 접근할 수 있습니다.',true);
      list('test-details',['필수 열 '+data.propertyCount+'개 확인 완료','목록 조회 권한 확인 완료',
        '확인 시각: '+new Date(data.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})]);
    } catch(error) {
      message('test-status','연결 확인 실패 · '+reason(error));
      if(error.data?.issues)list('test-details',error.data.issues.map(i=>i.name+': '+i.actual+' → 필요 형식 '+i.expected));
    } finally {busy=false;$('test-btn').textContent='연결 테스트';buttons();}
  });
  $('preview-btn').addEventListener('click',async()=>{
    busy=true;buttons();
    try{await preview();}catch(error){message('preview-status','대상 조회 실패 · '+reason(error));}
    finally{busy=false;buttons();}
  });
  $('sync-btn').addEventListener('click',async()=>{
    busy=true;buttons();$('sync-btn').textContent='동기화 중…';
    const summary={processed:0,created:0,updated:0,closed:0,conflicts:0};
    const add=data=>{for(const key of Object.keys(summary))summary[key]+=data[key] || 0;};
    const progress=()=>list('sync-details',['처리 '+summary.processed+'명 · 신규 '+summary.created+'건 · 업데이트 '+summary.updated+'건',
      '완료 이력 유지 '+summary.closed+'건 · 중복 확인 필요 '+summary.conflicts+'건']);
    let cursor=null,finished=false;
    try {
      await preview();
      message('sync-status','Notion에 관리 대상 기사를 반영하고 있습니다.');
      for(let page=0;page<50000;page++) {
        const data=await call('sync',{center:center.code,cursor});
        add(data);progress();
        if(!data.hasMore){finished=true;break;}
        if(!data.nextCursor || data.nextCursor===cursor)throw new Error('조회 위치를 확인할 수 없습니다. 다시 동기화해 주세요.');
        cursor=data.nextCursor;
      }
      if(!finished)throw new Error('처리 범위를 초과했습니다. 다시 실행해 주세요.');
      message('sync-status','동기화 완료'+(summary.conflicts?' · 중복된 갱신 건 ID를 Notion에서 확인해 주세요.':''),summary.conflicts===0);
    } catch(error) {
      if(error.data?.summary)add(error.data.summary);
      progress();
      const delay=error.data?.retryAfterSeconds?' 저장 결과 확인을 위해 3분 후 다시 시도해 주세요.':' 다시 실행하면 이미 반영된 건을 확인하며 이어서 처리합니다.';
      message('sync-status','동기화 중단 · '+reason(error)+delay);
    } finally {busy=false;$('sync-btn').textContent='Notion 동기화';buttons();}
  });
  $('complete-btn').addEventListener('click',async()=>{
    busy=true;buttons();$('complete-btn').textContent='갱신 확인 중…';
    const totals={scanned:0,completed:0,unchanged:0};
    const add=data=>{for(const key of Object.keys(totals))totals[key]+=data[key] || 0;};
    const progress=()=>list('complete-details',['확인 '+totals.scanned+'건 · 갱신 완료 '+totals.completed+'건 · 기존 상태 유지 '+totals.unchanged+'건']);
    let cursor=null,finished=false;
    message('complete-status','웹에 저장된 새 만료일을 확인하고 있습니다.');
    try {
      for(let batch=0;batch<6000;batch++) {
        const data=await call('complete',{center:center.code,cursor});add(data);progress();
        if(!data.hasMore){showLastUpdate(data.lastUpdatedAt);finished=true;break;}
        if(!data.nextCursor || data.nextCursor===cursor)throw new Error('조회 위치를 확인할 수 없습니다. 다시 실행해 주세요.');
        cursor=data.nextCursor;
      }
      if(!finished)throw new Error('처리 범위를 초과했습니다. 다시 실행해 주세요.');
      message('complete-status','갱신 완료 반영이 끝났습니다.',true);
    } catch(error) {
      if(error.data?.summary)add(error.data.summary);
      progress();
      message('complete-status','완료 반영 중단 · '+reason(error)+(error.data?.retryAfterSeconds?' 3분 후 다시 시도해 주세요.':' 다시 실행하면 완료된 이력을 유지하며 처리합니다.'));
    } finally{busy=false;$('complete-btn').textContent='갱신 완료 즉시 반영';buttons();}
  });
  busy=true;
  try{await Promise.all([preview(),refreshLastUpdate()]);}catch(error){message('preview-status','대상 조회 실패 · '+reason(error));}
  finally{busy=false;buttons();}
}
