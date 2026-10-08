import { previewTargets, syncBatch, validateSyncInput } from './sync.js';
import { completionBatch, validateCompletionInput } from './completion.js';
export const REQUIRED_PROPERTIES = {
  '기사명':'title', '센터':'select', '웹 기사 ID':'rich_text', '갱신 건 ID':'rich_text',
  '보건증 만료일':'date', '만료 상태':'select', '처리 상태':'select', '담당자':'people',
  '연락일':'date', '갱신 예정일':'date', '처리 메모':'rich_text',
  '갱신 완료일':'date', '갱신 후 만료일':'date', '최근 동기화일':'date'
};
const SITE = 'https://sajoansan.vercel.app';
const fail = (error, status=400, code='invalid_request', extra={}) =>
  Object.assign(new Error(error), {status, code, extra});
export function serverKeys(env) {
  let keys = {};
  try { keys = JSON.parse(env.SUPABASE_SECRET_KEYS || '{}'); } catch {}
  return [env.SUPABASE_SERVICE_ROLE_KEY, ...Object.values(keys).filter(v=>typeof v==='string' && v)].filter(Boolean);
}
export async function checkConnection(env, fetcher=fetch) {
  const token = (env.NOTION_API_TOKEN || '').trim();
  const id = (env.NOTION_DATA_SOURCE_ID || '').trim();
  if (!token || !id) throw fail('Supabase Secrets에 NOTION_API_TOKEN과 NOTION_DATA_SOURCE_ID를 등록해 주세요.',503,'missing_secrets');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw fail('NOTION_DATA_SOURCE_ID 값을 확인해 주세요.',503,'invalid_data_source_id');
  async function request(suffix='', body) {
    let response;
    try {
      response = await fetcher('https://api.notion.com/v1/data_sources/'+id+suffix,{
        method:body ? 'POST':'GET', headers:{Authorization:'Bearer '+token,
        'Notion-Version':'2026-03-11', 'Content-Type':'application/json'},
        ...(body ? {body:JSON.stringify(body)}:{}), signal:AbortSignal.timeout(20000)
      });
    } catch { throw fail('Notion 응답 시간이 초과됐거나 연결에 실패했습니다. 다시 시도해 주세요.',504,'notion_unreachable'); }
    if (!response.ok) {
      const messages = {
        401:['Notion 토큰이 유효하지 않습니다. 내부 연결 토큰을 확인해 주세요.','notion_unauthorized'],
        403:['Notion 연결의 콘텐츠 읽기 권한을 확인해 주세요.','notion_forbidden'],
        404:['보건증 갱신 목록에 웹 연동 연결을 추가하고 데이터 소스 ID를 확인해 주세요.','notion_not_found'],
        429:['Notion 요청이 많습니다. 잠시 후 다시 시도해 주세요.','notion_rate_limited']
      };
      const [message,code] = messages[response.status] || ['Notion 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.','notion_error'];
      throw fail(message,502,code);
    }
    try { return await response.json(); } catch { throw fail('Notion 응답을 확인할 수 없습니다.',502,'notion_invalid_response'); }
  }
  const source = await request();
  if (source.object !== 'data_source' || source.archived || source.in_trash)
    throw fail('사용 가능한 Notion 데이터 소스가 아닙니다.',422,'invalid_data_source');
  const issues = Object.entries(REQUIRED_PROPERTIES).filter(([name,type]) => source.properties?.[name]?.type !== type)
    .map(([name,type]) => ({name,expected:type,actual:source.properties?.[name]?.type || '없음'}));
  if (issues.length) throw fail('보건증 갱신 목록의 열 이름 또는 형식을 확인해 주세요.',422,'schema_mismatch',{issues});
  const rows = await request('/query',{page_size:1});
  if (rows.object !== 'list' || !Array.isArray(rows.results))
    throw fail('Notion 목록 조회 응답을 확인할 수 없습니다.',502,'notion_invalid_response');
  return {connected:true, schemaValid:true, readable:true, propertyCount:Object.keys(REQUIRED_PROPERTIES).length,
    checkedAt:new Date().toISOString()};
}
export function makeHandler(env, fetcher=fetch) {
  const cors={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
  return async req => {
    if (req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
    if (req.method!=='POST') return json({error:'POST 요청만 지원합니다.'},405);
    try {
      const path=new URL(req.url).pathname.replace(/\/$/,'');
      const action=path.split('/').at(-1);
      if (!['test','preview','sync','complete'].includes(action) || !path.endsWith('/notion-health/'+action)) throw fail('지원하지 않는 요청입니다.',404);
      const keys=serverKeys(env);
      const service=keys[0];
      if (!service || !env.SUPABASE_URL) throw fail('서버 설정을 확인해 주세요.',503,'server_configuration');
      // Project server jobs can call these routes with verified server credentials.
      // Browser callers must have a verified, active administrator session.
      const bearer=(req.headers.get('authorization') || '').replace(/^Bearer /i,'');
      let internal=(keys.includes(req.headers.get('apikey')) || keys.includes(bearer)) && !req.headers.get('origin');
      // Management API may issue an equivalent service JWT with different bytes.
      // Verify its signature through this project's REST API before trusting its role.
      if (!internal && !req.headers.get('origin') && bearer.startsWith('eyJ')) {
        let claims={};
        try { claims=JSON.parse(atob(bearer.split('.')[1].replaceAll('-','+').replaceAll('_','/'))); } catch {}
        if (claims.role==='service_role' && env.SUPABASE_ANON_KEY) {
          const verified=await fetcher(env.SUPABASE_URL+'/rest/v1/user_profiles?select=id&limit=0',{
            headers:{Authorization:'Bearer '+bearer,apikey:env.SUPABASE_ANON_KEY},signal:AbortSignal.timeout(10000)});
          internal=verified.ok;
        }
      }
      if (!internal) {
        const auth=req.headers.get('authorization') || '';
        if (!/^Bearer \S+$/i.test(auth)) throw fail('로그인이 필요합니다.',401,'unauthorized');
        const userResponse=await fetcher(env.SUPABASE_URL+'/auth/v1/user',{
          headers:{Authorization:auth,apikey:service},signal:AbortSignal.timeout(10000)});
        if (!userResponse.ok) throw fail('로그인 세션을 확인해 주세요.',401,'unauthorized');
        const user=await userResponse.json();
        if (typeof user.id!=='string' || !/^[0-9a-f-]{36}$/i.test(user.id)) throw fail('로그인 세션을 확인해 주세요.',401,'unauthorized');
        const profileResponse=await fetcher(env.SUPABASE_URL+'/rest/v1/user_profiles?select=role,active&id=eq.'+encodeURIComponent(user.id),{
          headers:{...(service.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+service}),apikey:service},signal:AbortSignal.timeout(10000)});
        if (!profileResponse.ok) throw fail('사용자 권한을 확인할 수 없습니다.',503,'profile_unavailable');
        const profile=(await profileResponse.json())[0];
        if (profile?.active!==true || profile.role!=='admin') throw fail('활성 관리자만 Notion 연동을 실행할 수 있습니다.',403,'forbidden');
      }
      if(action==='test') return json(await checkConnection(env,fetcher));
      let body;
      try {
        const raw=await req.text();
        if(raw.length>2000) throw new Error();
        body=JSON.parse(raw);
      } catch {throw fail('요청 내용을 확인해 주세요.',400,'invalid_body');}
      if(action==='complete') {
        validateCompletionInput(body);
        return json(await completionBatch(env,service,fetcher,body));
      }
      validateSyncInput(body);
      if(action==='preview') return json(await previewTargets(env,service,fetcher,body));
      await checkConnection(env,fetcher);
      return json(await syncBatch(env,service,fetcher,body));
    } catch(error) {
      return json({error:error.status ? error.message:'Notion 연동 중 오류가 발생했습니다. 다시 시도해 주세요.',
        code:error.code || 'server_error',...(error.extra || {})},error.status || 500);
    }
  };
}
