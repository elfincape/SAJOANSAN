import fs from 'node:fs';
const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Supabase deployment secrets are missing');
const query=fs.readFileSync(new URL('../repo-root/sql/notion-health-sync.sql',import.meta.url),'utf8');
const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok)throw new Error('Notion sync schema migration failed (HTTP '+response.status+')');
console.log('Notion sync lock schema applied');

const verification=`begin;
delete from public.notion_health_sync_lock;
do $$
declare first_token uuid='00000000-0000-4000-8000-000000000001'; second_token uuid='00000000-0000-4000-8000-000000000002';
begin
  if has_function_privilege('authenticated','public.notion_health_acquire(uuid)','execute')
    or has_function_privilege('anon','public.notion_health_acquire(uuid)','execute') then
    raise exception 'Sync lock RPC must be restricted to server credentials';
  end if;
  if not public.notion_health_acquire(first_token) then raise exception 'First lock failed'; end if;
  if public.notion_health_acquire(second_token) then raise exception 'Concurrent lock was allowed'; end if;
  perform public.notion_health_release(second_token);
  if public.notion_health_acquire(second_token) then raise exception 'Wrong owner released lock'; end if;
  perform public.notion_health_release(first_token);
  if not public.notion_health_acquire(second_token) then raise exception 'Owner release failed'; end if;
end;
$$;
do $$
declare first_token uuid='00000000-0000-4000-8000-000000000011'; second_token uuid='00000000-0000-4000-8000-000000000012'; state jsonb;
begin
  if has_function_privilege('authenticated','public.notion_health_schedule_claim(uuid)','execute')
    or has_function_privilege('anon','public.notion_health_schedule_checkpoint(uuid,text,text,text)','execute') then
    raise exception 'Schedule RPC must be restricted to server credentials';
  end if;
  update public.notion_health_schedule_state set phase='idle',lease_until=null,next_due_at=clock_timestamp();
  state=public.notion_health_schedule_claim(first_token);
  if state->>'phase'<>'sync' or state->>'center_code'<>'001' then raise exception 'Schedule start failed'; end if;
  if public.notion_health_schedule_claim(second_token) is not null then raise exception 'Concurrent schedule allowed'; end if;
  perform public.notion_health_schedule_release(second_token,0);
  if public.notion_health_schedule_claim(second_token) is not null then raise exception 'Wrong owner released schedule'; end if;
  perform public.notion_health_schedule_checkpoint(first_token,'002','idle',null);
  perform public.notion_health_schedule_release(first_token,0);
  if public.notion_health_schedule_claim(second_token) is not null then raise exception '15 minute due gate failed'; end if;
end;
$$;
rollback;`;
const checked=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({query:verification}),signal:AbortSignal.timeout(60000)});
if(!checked.ok)throw new Error('Notion sync lock verification failed (HTTP '+checked.status+')');
console.log('Sync lock acquisition, concurrency, owner release and permissions verified in rolled-back transaction');
