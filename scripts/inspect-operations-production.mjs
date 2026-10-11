const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='vvrppotrnpwrwpwqaiet'||!token)throw Error('운영 프로젝트 인증이 필요합니다.');
const sql=`select jsonb_build_object(
 'centers',(select jsonb_agg(jsonb_build_object('code',code,'name',name,'active',active)) from public.centers),
 'roles',(select jsonb_agg(x) from (select role,active,count(*) from public.user_profiles group by role,active) x),
 'memberships',(select count(*) from public.operations_center_members),
 'scheduler',(select jsonb_agg(jsonb_build_object('name',jobname,'active',active,'schedule',schedule)) from cron.job where jobname='operations-recurring-and-deadlines'),
 'scheduler_runs',(select jsonb_agg(x) from (select status,return_message from cron.job_run_details where jobid in(select jobid from cron.job where jobname='operations-recurring-and-deadlines') order by start_time desc limit 2)x),
 'onedrive_connected',exists(select 1 from public.onedrive_connection where id=true),
 'onedrive_settings_columns',(select jsonb_agg(column_name) from information_schema.columns where table_schema='public' and table_name='onedrive_settings'),
 'audit_columns',(select jsonb_agg(column_name) from information_schema.columns where table_schema='public' and table_name='audit_log')) as state;`;
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(30000)});
if(!r.ok)throw Error('운영 상태 조회 HTTP '+r.status);console.log(JSON.stringify(await r.json(),null,2));
const f=await fetch(`https://api.supabase.com/v1/projects/${ref}/functions`,{headers:{Authorization:`Bearer ${token}`}});if(f.ok)console.log('Functions:',(await f.json()).map(x=>({name:x.name,status:x.status})));
