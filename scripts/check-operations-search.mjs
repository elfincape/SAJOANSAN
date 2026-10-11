import {readFile} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='vvrppotrnpwrwpwqaiet'||!token)throw Error('운영 점검 인증이 필요합니다.');
async function query(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('검색 점검 HTTP '+r.status+': '+await r.text());return r.json();}
console.log('검색 권한:',JSON.stringify(await query(`select not prosecdef as caller_permissions,
 has_function_privilege('authenticated',oid,'EXECUTE') as signed_in_allowed,
 not has_function_privilege('anon',oid,'EXECUTE') as anonymous_blocked
 from pg_proc where oid='public.operations_search(text,text,integer)'::regprocedure;`)));
// Plan the actual query with caller privileges, without running it or impersonating a user.
const source=await readFile(new URL('../repo-root/sql/operations-search.sql',import.meta.url),'utf8');
const match=source.match(/with sources[\s\S]*?into result from groups;/i);if(!match)throw Error('검색 쿼리 원본이 없습니다.');
const sql=match[0].replace('into result from groups','from groups').replace(/\bp_center\b/g,'null::text').replace(/\bp_page\b/g,'0').replace(/\bterm\b/g,"'운영'");
await query('begin; set local role authenticated; explain (format json) '+sql+' rollback;');
console.log('실제 검색 쿼리: authenticated 읽기 권한으로 실행 계획 생성 성공 (자료 조회·수정 없음).');
try{await query(`begin; set local role authenticated; select public.operations_search('운영'); rollback;`);throw Error('미로그인 검색이 차단되지 않았습니다.');}
catch(error){if(!/활성 계정으로 로그인|통합 검색 열람 권한이 없습니다/.test(error.message))throw error;console.log('로그인 없는 authenticated 요청: 차단 확인.');}
