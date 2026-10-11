import {readFile} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(!['vvrppotrnpwrwpwqaiet','yvdialfqlbpjbbmcetev'].includes(ref)||!token)throw Error('대상 프로젝트와 서버 배포 인증이 필요합니다.');
const apply=process.argv.includes('--apply');
async function query(sql){
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error(`DB 접근 실패: HTTP ${response.status} (project ${ref}).`);
 return response.json();
}
const [schema]=await query(`select to_regclass('public.centers') is not null as centers,to_regclass('public.user_profiles') is not null as profiles,
 to_regclass('public.operations_tasks') is not null as core,to_regclass('public.operations_incidents') is not null as workflow,
 to_regclass('public.operations_templates') is not null as templates,to_regclass('public.operations_surveys') is not null as portal,
 to_regclass('public.operations_automation_state') is not null as scheduler,
 to_regprocedure('public.operations_staff_access()') is not null as access,
 to_regprocedure('public.operations_record_cj_share(uuid,uuid,integer,boolean,text)') is not null as dispatch,
 to_regclass('public.operations_files') is not null as files,
 to_regclass('public.operations_ai_results') is not null as ai,
 to_regprocedure('public.operations_ai_dispatch()') is not null as ai_scheduler,
 to_regprocedure('public.operations_ai_scheduler_authorized()') is not null as ai_auth,
 to_regprocedure('public.operations_search(text,text,integer)') is not null as search;`);
if(!schema.centers||!schema.profiles)throw Error('기존 센터·사용자 인증 구조를 먼저 확인해야 합니다. 새 인증 DB는 만들지 않습니다.');
const plan=Object.entries(schema).filter(([name,exists])=>!exists&&!['centers','profiles'].includes(name)).map(([name])=>name);
console.log('DB 반영 대상:',plan.join(', ')||'추가 없음');
if(!apply){console.log('조회만 수행했습니다. 반영은 --apply로 실행합니다.');process.exit(0);}
if(!plan.length)process.exit(0);
const files={core:'operations-core.sql',workflow:'operations-workflow.sql',templates:'operations-templates.sql',portal:'operations-portal.sql',scheduler:'operations-scheduler.sql',access:'operations-access.sql',dispatch:'operations-dispatch.sql',files:'operations-files.sql',ai:'operations-ai.sql',ai_scheduler:'operations-ai-scheduler.sql',ai_auth:'operations-ai-auth.sql',search:'operations-search.sql'};
const sources=[];
for(const name of plan){const sql=await readFile(new URL('../repo-root/sql/'+files[name],import.meta.url),'utf8');sources.push(sql.replace(/^\s*begin;\s*$/gmi,'').replace(/^\s*commit;\s*$/gmi,''));}
await query('begin;\n'+sources.join('\n')+'\ncommit;');
console.log('업무 포털 DB 반영 완료. 기존 운영 마스터와 계정은 보존했습니다.');
