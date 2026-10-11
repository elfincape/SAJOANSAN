import {readFile} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='vvrppotrnpwrwpwqaiet'||!token)throw Error('운영 원본 보관 점검 인증이 필요합니다.');
async function query(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('원본 보관 점검 HTTP '+r.status+': '+await r.text());return r.json();}
if(process.argv.includes('--capture'))console.log('현재 운영 원본 보관:',JSON.stringify(await query('select public.operations_master_capture(true) as id;')));
if(process.argv.includes('--recover-empty'))console.log('현재 작업의 빈 업로드 파일 보존 후 재시도:',JSON.stringify(await query("update public.operations_master_backups set recover_empty_once=true where period='baseline' and status='failed' and item_id is null and captured_at>now()-interval '1 day' returning id;")));
if(process.argv.includes('--dispatch'))console.log('OneDrive 보관 실행:',JSON.stringify(await query('select public.operations_master_dispatch() as request_id;')));
if(process.argv.includes('--validate')){
 const source=await readFile(new URL('../repo-root/sql/operations-backups.sql',import.meta.url),'utf8');
 const match=source.match(/with old_rows[\s\S]*?into result;/);if(!match)throw Error('운영 원본 비교 쿼리가 없습니다.');
 const comparison=match[0].replace(/\barchived\b/g,"(select snapshot from public.operations_master_backups where period='baseline')").replace(/\bcurrent_data\b/g,'public.operations_master_snapshot()').replace('into result;',';');
 const [result]=await query(comparison);const body=Object.values(result)[0];console.log('실제 보관 원본과 현재 마스터 비교:',JSON.stringify({total:body.total,limited:body.limited,counts:body.counts}));
 console.log('원본 보존 트리거:',JSON.stringify(await query("select tgname from pg_trigger where tgrelid='public.operations_master_backups'::regclass and not tgisinternal order by tgname;")));
}
console.log('운영 원본 상태:',JSON.stringify(await query(`select jsonb_build_object(
 'backups',(select coalesce(jsonb_agg(jsonb_build_object('period',period,'captured_at',captured_at,'file_name',file_name,'counts',counts,'status',status,'attempts',attempts,'last_error',last_error,'verified_at',verified_at,'bytes',byte_size,'folder_reserved',folder_id is not null,'item_reserved',item_id is not null)),'[]') from public.operations_master_backups),
 'scheduler',(select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active)) from cron.job where jobname in ('operations-master-monthly-original','operations-master-backup-retry')),
 'dispatch',(select jsonb_build_object('attempts',s.attempts,'last_error',s.last_error,'http_status',r.status_code,'timed_out',r.timed_out,'network_error',r.error_msg) from public.operations_automation_state s left join net._http_response r on r.id=s.request_id where s.name='master-backup-dispatch'),
 'client_cannot_write',not has_table_privilege('authenticated','public.operations_master_backups','INSERT,UPDATE,DELETE'),
 'snapshot_private',not has_function_privilege('authenticated','public.operations_master_payload(uuid)','EXECUTE'),
 'original_hidden',not has_column_privilege('authenticated','public.operations_master_backups','snapshot','SELECT')) as state;`)));
