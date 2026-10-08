import fs from 'node:fs';
const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Deployment secrets missing');
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
async function query(sql) {
  const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{
    method:'POST',headers,body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw new Error('Scheduler SQL failed HTTP '+r.status);
  return r.json();
}
const keys=await fetch('https://api.supabase.com/v1/projects/'+ref+'/api-keys?reveal=true',{headers});
if(!keys.ok)throw new Error('Server credential unavailable');
const service=(await keys.json()).find(k=>k.name==='service_role')?.api_key;
if(!service)throw new Error('Server credential unavailable');
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const installedAt=new Date().toISOString();
await query(`
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
do $vault$
declare secret_id uuid;
begin
  select id into secret_id from vault.secrets where name='notion_health_cron_key';
  if secret_id is null then
    perform vault.create_secret(${literal(service)},'notion_health_cron_key','Notion scheduler server credential');
  else
    perform vault.update_secret(secret_id,${literal(service)});
  end if;
end;
$vault$;
create or replace function public.notion_health_schedule_dispatch()
returns bigint language plpgsql security definer set search_path=pg_catalog as $dispatch$
declare request_id bigint; credential text;
begin
  if not exists(select 1 from public.notion_health_schedule_state
    where id=true and (lease_until is null or lease_until<=clock_timestamp())
    and (phase<>'idle' or next_due_at<=clock_timestamp())) then return null; end if;
  select decrypted_secret into credential from vault.decrypted_secrets where name='notion_health_cron_key';
  if credential is null then raise exception 'Scheduler credential missing'; end if;
  select net.http_post(
    url:=${literal('https://'+ref+'.supabase.co/functions/v1/notion-health/scheduled')},
    headers:=jsonb_build_object('Content-Type','application/json','apikey',credential,'Authorization','Bearer '||credential),
    body:='{}'::jsonb,timeout_milliseconds:=120000
  ) into request_id;
  return request_id;
end;
$dispatch$;
revoke all on function public.notion_health_schedule_dispatch() from public,anon,authenticated,service_role;
update public.notion_health_schedule_state set next_due_at=clock_timestamp() where id=true and phase='idle';
select cron.schedule('notion-health-server-tick','* * * * *',
  'select public.notion_health_schedule_dispatch();');
`);
console.log('Supabase scheduler installed: 15-minute cycles, resumable minute ticks');
if(process.argv.includes('--install-only'))process.exit(0);
// Observe the actual cron, never call the worker directly during verification.
const deadline=Date.now()+12*60*1000;
while(Date.now()<deadline) {
  const rows=await query(`select s.phase,s.center_code,s.last_tick_at,s.last_finished_at,s.next_due_at,s.last_error,
    (select count(*) from cron.job_run_details d join cron.job j using(jobid)
      where j.jobname='notion-health-server-tick' and d.status='succeeded'
      and d.start_time>=s.started_at) as successful_ticks
    from public.notion_health_schedule_state s where id=true`);
  const s=rows[0];
  console.log('Scheduled progress',JSON.stringify(s));
  if(s?.phase==='idle'&&s.last_finished_at&&Date.parse(s.last_finished_at)>=Date.parse(installedAt)&&Number(s.successful_ticks)>0) {
    const status=await query('select center_code,last_completed_at from public.notion_health_completion_status order by center_code');
    if(status.length!==2||status.some(r=>Date.parse(r.last_completed_at)<Date.parse(s.last_tick_at)-12*60*1000))
      throw new Error('Scheduled center completion timestamps missing');
    console.log('Actual Supabase cron completed both centers',JSON.stringify(status));
    process.exit(0);
  }
  await new Promise(r=>setTimeout(r,30000));
}
throw new Error('No completed scheduled cycle observed within 12 minutes');
