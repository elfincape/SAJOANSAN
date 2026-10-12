import {readFile} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='vvrppotrnpwrwpwqaiet'||!token)throw Error('운영 인증 필요');
async function query(query){
 const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('멘션 검색 반영 HTTP '+r.status+': '+await r.text());return r.json();
}
await query(await readFile(new URL('../repo-root/sql/operations-mention-search.sql',import.meta.url),'utf8'));
const result=await query("select not prosecdef as uses_caller_permissions,position('length(term)<1' in replace(pg_get_functiondef(oid),' ',''))>0 as one_character_search from pg_proc where oid='public.operations_mention_search(text,text,integer)'::regprocedure;");
if(!result[0]?.uses_caller_permissions||!result[0]?.one_character_search)throw Error('멘션 검색 함수 권한과 최소 길이 확인 실패');
console.log(JSON.stringify(result));
