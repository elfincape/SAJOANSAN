import {readFile} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='vvrppotrnpwrwpwqaiet'||!token)throw Error('운영 인증 필요');
async function query(query){
 const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('쿠팡 업무 반영 HTTP '+response.status+': '+await response.text());
 return response.json();
}
await query(await readFile(new URL('../repo-root/sql/operations-coupang-simplify.sql',import.meta.url),'utf8'));
console.log(JSON.stringify(await query("select position('coupang_simple_completion' in pg_get_functiondef('public.operations_validate_task_inputs()'::regprocedure))>0 as simplified_completion;")));
