-- Fixed worker dispatcher using ten-minute per-target sessions; no long-lived key.
-- Requires existing pg_net, pg_cron and extensions.pgcrypto. Does not enable automation.
begin;
-- Harden a project-owned transport queue when permitted. Managed Supabase queue ACLs
-- may be immutable; deployment must also verify net is not exposed by REST/GraphQL.
do $$ begin
 if to_regclass('net.http_request_queue') is not null and has_table_privilege(current_user,'net.http_request_queue','SELECT WITH GRANT OPTION') then
  revoke all on table net.http_request_queue from public,anon,authenticated;
  grant all on table net.http_request_queue to service_role;
 end if;
end $$;
create or replace function public.private_mail_dispatch(p_box uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; item record; caps jsonb; token text; token_hash text;
 queued boolean=false; recent boolean; entry record; issued timestamptz;
begin
 if not public.private_mail_automation_allowed(p_box) then return false; end if;
 select * into b from public.private_mailboxes where id=p_box for update;
 -- Remove expired and completed targets before enforcing the hard mailbox-wide cap.
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into caps from
 (select distinct on (value->>'kind',value->>'target') key,value from jsonb_each(b.automation_dispatch)
  where (value->>'expiresAt')::timestamptz>clock_timestamp()
  and public.private_mail_dispatch_target_allowed(p_box,value->>'kind',value->>'target')
  order by value->>'kind',value->>'target',(value->>'issuedAt')::timestamptz desc limit 16) live;
 update public.private_mailboxes set automation_dispatch=caps where id=p_box;
 for item in
  select 'collect'::text as kind,b.automation_job->>'id' as target,0 as priority
  where b.automation_job->>'status' in ('queued','running') and (b.automation_job->>'attempts')::integer<5
   and not coalesce((b.automation_job->>'stopRequested')::boolean,false)
   and coalesce((b.automation_job->>'notBefore')::timestamptz,'-infinity')<=clock_timestamp()
   and coalesce((b.automation_job->>'leaseUntil')::timestamptz,'-infinity')<=clock_timestamp()
   and coalesce(b.lease_until,'-infinity')<=clock_timestamp()
  union all
  select 'analyze',m.id::text,1 from
   (select m0.* from public.private_mail_messages m0 where m0.mailbox_id=p_box
    and public.private_mail_dispatch_target_allowed(p_box,'analyze',m0.id::text)
    and m0.analysis_attempts<5 and coalesce(m0.analysis_next_at,'-infinity')<=clock_timestamp()
    and coalesce(m0.analysis_lease_until,'-infinity')<=clock_timestamp()
    order by m0.created_at,m0.id limit 5) m
  union all
  select 'report',r.key,2 from
   (select key from jsonb_each(b.briefing_pages) where value->>'dirty'='true'
    and public.private_mail_dispatch_target_allowed(p_box,'report',key)
    and coalesce((value->>'leaseUntil')::timestamptz,'-infinity')<=clock_timestamp()
    and coalesce((value->>'notBefore')::timestamptz,'-infinity')<=clock_timestamp()
    order by key limit 3) r
  order by priority,target
 loop
  recent=false;
  for entry in select key,value from jsonb_each(caps) where value->>'kind'=item.kind and value->>'target'=item.target loop
   -- Authentication and the fenced work claim are separate HTTP/RPC boundaries.
   if (case when entry.value->>'claimed'='true' then coalesce((entry.value->>'claimedAt')::timestamptz,(entry.value->>'issuedAt')::timestamptz)
       else (entry.value->>'issuedAt')::timestamptz end)>clock_timestamp()-interval '60 seconds' then recent=true;
   else caps=caps-entry.key; end if;
  end loop;
  if recent or (select count(*) from jsonb_object_keys(caps))>=16 then continue; end if;
  token='pmjob_'||encode(extensions.gen_random_bytes(32),'hex');
  token_hash=rtrim(translate(encode(extensions.digest(convert_to(token,'UTF8'),'sha256'),'base64'),'+/','-_'),'=');
  issued=clock_timestamp();
  caps=caps||jsonb_build_object(token_hash,jsonb_build_object('kind',item.kind,'target',item.target,
   'issuedAt',issued,'expiresAt',issued+interval '10 minutes','claimed',false));
  update public.private_mailboxes set automation_dispatch=caps where id=p_box;
  perform net.http_post(url:='https://sajoansan.vercel.app/api/private-mail-worker',
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
   body:=jsonb_build_object('kind',item.kind,'mailboxId',p_box)||
    case item.kind when 'collect' then jsonb_build_object('jobId',item.target)
     when 'analyze' then jsonb_build_object('messageId',item.target) else jsonb_build_object('day',item.target) end,
   timeout_milliseconds:=250000);
  queued=true;
 end loop;
 return queued;
 -- A dispatch failure cannot roll back POP publications or their durable receipt.
 exception when others then return false;
end; $$;
revoke all on function public.private_mail_dispatch(uuid) from public,anon,authenticated;
grant execute on function public.private_mail_dispatch(uuid) to service_role;
grant usage on schema net,extensions to service_role;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='net' and p.proname='http_post' loop
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

create or replace function public.private_mail_scheduler_ready()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare has_job boolean=false; definition text;
begin
 if to_regclass('cron.job') is null or to_regprocedure('public.private_mail_dispatch_auth(text)') is null
 or to_regprocedure('extensions.gen_random_bytes(integer)') is null
 or to_regprocedure('extensions.digest(bytea,text)') is null then return false; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='net' and p.proname='http_post') then return false; end if;
 definition=pg_get_functiondef('public.private_mail_dispatch(uuid)'::regprocedure);
 if position('https://sajoansan.vercel.app/api/private-mail-worker' in definition)=0
 or position('pmjob_' in definition)=0 or position('net.http_post' in definition)=0 then return false; end if;
 execute 'select exists(select 1 from cron.job where jobname=$1 and active and command=$2)'
 into has_job using 'private-mail-recovery','select public.private_mail_automation_tick()';
 return has_job;
 exception when others then return false;
end; $$;
revoke all on function public.private_mail_scheduler_ready() from public,anon,authenticated;
grant execute on function public.private_mail_scheduler_ready() to service_role;
select cron.schedule('private-mail-recovery','* * * * *','select public.private_mail_automation_tick()');
commit;
