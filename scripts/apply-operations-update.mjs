import {readFile} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='vvrppotrnpwrwpwqaiet'||!token)throw Error('운영 인증이 필요합니다.');
const action=process.argv[2];let sql;
if(action==='scheduler-fix'){
 const source=await readFile(new URL('../repo-root/sql/operations-scheduler.sql',import.meta.url),'utf8');
 const match=source.match(/create function public\.operations_run_scheduler\(\)[\s\S]*?end \$\$;/);
 if(!match)throw Error('예약 함수 소스가 없습니다.');
 sql='begin;\n'+match[0].replace('create function','create or replace function')+'\nselect public.operations_run_scheduler();\ncommit;';
}else if(['members-participants','trash','custom-tasks','incident-parent','access','dispatch','files','ai','ai-scheduler','ai-auth','search','backups','backup-scheduler','backup-recovery'].includes(action))sql=await readFile(new URL('../repo-root/sql/operations-'+action+'.sql',import.meta.url),'utf8');
else throw Error('지원하지 않는 운영 반영입니다.');
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000)});
if(!r.ok)throw Error(`운영 반영 ${action} HTTP ${r.status}: ${await r.text()}`);console.log(action,JSON.stringify(await r.json()));
