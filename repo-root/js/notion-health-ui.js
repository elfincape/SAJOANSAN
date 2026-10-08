import { requireRole, signOut } from './auth.js';
import { supabase } from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { forceCenterSelectionFromUrl, requireSelectedCenter, withCenterParam } from './center.js';
const button=document.getElementById('test-btn');
const status=document.getElementById('test-status');
const details=document.getElementById('test-details');
function show(message,ok=false) {
  status.textContent=message;
  status.className='text-sm mt-5 '+(ok ? 'text-emerald-400':'text-zinc-300');
}
function list(lines) {
  details.replaceChildren(...lines.map(line=>{
    const li=document.createElement('li');li.textContent=line;return li;
  }));
}
const profile=await requireRole('admin');
if (profile) {
  const center=await requireSelectedCenter({force:forceCenterSelectionFromUrl()});
  document.getElementById('hub-link').href=withCenterParam('/admin/',center);
  document.getElementById('logout-btn').addEventListener('click',signOut);
  show('연결 테스트 버튼을 눌러 확인하세요.');
  button.disabled=false;
  button.addEventListener('click',async()=>{
    button.disabled=true;button.textContent='확인 중…';show('Notion 연결을 확인하고 있습니다.');list([]);
    try {
      const {data:{session}}=await supabase.auth.getSession();
      if (!session) throw new Error('다시 로그인해 주세요.');
      const response=await fetch(SUPABASE_URL+'/functions/v1/notion-health/test',{
        method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_ANON_KEY,
          'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(55000)
      });
      const data=await response.json().catch(()=>({}));
      if (!response.ok) {
        if (data.issues) list(data.issues.map(issue=>issue.name+': '+issue.actual+' → 필요 형식 '+issue.expected));
        throw new Error(data.error || '연결 테스트 요청에 실패했습니다.');
      }
      if (!data.connected || !data.schemaValid || !data.readable) throw new Error('연결 확인 결과가 올바르지 않습니다.');
      show('연결 성공 · 보건증 갱신 목록에 접근할 수 있습니다.',true);
      list(['필수 열 '+data.propertyCount+'개 확인 완료','목록 조회 권한 확인 완료',
        '확인 시각: '+new Date(data.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})]);
    } catch(error) {
      show('연결 확인 실패 · '+(error.name==='TimeoutError' ? '응답 시간이 초과됐습니다. 다시 시도해 주세요.':error.message));
    } finally {button.disabled=false;button.textContent='연결 테스트';}
  });
}
