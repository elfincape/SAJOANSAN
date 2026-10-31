-- Apply after private-mail-scheduler.sql, private-mail-filters.sql, private-mail-manual.sql and private-mail-history.sql.
-- Reuse existing transport/ACLs; an explicit manual report cannot enqueue other work.
begin;
create or replace function public.private_mail_dispatch_target_allowed(p_box uuid,p_kind text,p_target text)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare b public.private_mailboxes; d date;
begin
 select * into b from public.private_mailboxes where id=p_box;
 if b.id is distinct from '39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 or b.owner_id is distinct from '2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid or not b.enabled
 or not exists(select 1 from public.user_profiles p where p.id=b.owner_id and p.active) then return false; end if;
 if p_kind='history' then
  if coalesce(p_target,'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  return exists(select 1 from public.private_mail_analysis_history h where h.id=p_target::uuid
   and h.mailbox_id=p_box and h.owner_id=b.owner_id and h.status in ('pending','processing'));
 end if;
 if p_kind='collect' then
  if b.automation_job->>'id' is distinct from p_target then return false; end if;
  -- Pausing stops new claims while the active chunk can finish and release POP state.
  if b.automation_job->>'status'='running' and (b.automation_job->>'leaseUntil')::timestamptz>clock_timestamp() then return true; end if;
  return public.private_mail_automation_allowed(p_box) and coalesce(b.automation_job->>'status' in ('queued','running')
   and not coalesce((b.automation_job->>'stopRequested')::boolean,false),false);
 end if;
 if p_kind='report' then
  if coalesce(p_target,'') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  d=p_target::date;
  return public.private_mail_report_allowed(p_box,d) and coalesce((b.briefing_pages->p_target->>'dirty'='true'
   or (b.briefing_pages->p_target->>'leaseUntil')::timestamptz>clock_timestamp()),false);
 end if;
 -- Explicitly submitted manual messages use the existing analyze transport,
 -- independently of the scheduled POP/mail-analysis switch.
 if p_kind='analyze' and b.manual_entries ? p_target then
  return (b.manual_entries->p_target->>'status') in ('pending','processing','failed')
   and coalesce((b.manual_entries->p_target->>'attempts')::integer,0)<3;
 end if;
 if not public.private_mail_automation_allowed(p_box) or b.automation_config->>'analysisConsent' is distinct from 'true' then return false; end if;
 if p_kind='analyze' then
  if coalesce(p_target,'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  return exists(select 1 from public.private_mail_messages m where m.id=p_target::uuid and m.mailbox_id=p_box
   and public.private_mail_analysis_allowed(m.id) and m.analysis_status in ('pending','failed','processing'));
 end if;
 return false;
 exception when others then return false;
end; $$;

create or replace function public.private_mail_dispatch_core(p_box uuid,p_report_day date,p_history uuid,p_history_only boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; item record; caps jsonb; token text; token_hash text;
 queued boolean=false; recent boolean; entry record; issued timestamptz; notes_connected boolean=false;
begin
 if p_history_only is null or not public.private_mail_manual_allowed(p_box,'2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid)
 or (not p_history_only and p_report_day is null and p_history is null and not public.private_mail_automation_allowed(p_box))
 or (p_report_day is not null and not public.private_mail_report_allowed(p_box,p_report_day))
 or (p_history_only and p_report_day is not null)
 or (not p_history_only and p_history is not null and (p_report_day is not null or not public.private_mail_dispatch_target_allowed(p_box,'analyze',p_history::text) or not exists(select 1 from public.private_mailboxes x where x.id=p_box and x.manual_entries ? p_history::text))) then return false; end if;
 select * into b from public.private_mailboxes where id=p_box for update;
 -- Only report transport depends on Notes; collection and local analysis remain independent.
 begin
  select exists(select 1 from public.onedrive_connection where id=true and encrypted_notes_tokens is not null) into notes_connected;
 exception when others then notes_connected=false;
 end;
 -- Remove expired and completed targets before enforcing the hard mailbox-wide cap.
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into caps from
 (select distinct on (value->>'kind',value->>'target') key,value from jsonb_each(b.automation_dispatch)
  where (value->>'expiresAt')::timestamptz>clock_timestamp()
  and public.private_mail_dispatch_target_allowed(p_box,value->>'kind',value->>'target')
  order by value->>'kind',value->>'target',(value->>'issuedAt')::timestamptz desc limit 16) live;
 update public.private_mailboxes set automation_dispatch=caps where id=p_box;
 for item in
  select 'collect'::text as kind,b.automation_job->>'id' as target,0 as priority
  where not p_history_only and p_report_day is null and p_history is null and b.automation_job->>'status' in ('queued','running') and (b.automation_job->>'attempts')::integer<5
   and not coalesce((b.automation_job->>'stopRequested')::boolean,false)
   and coalesce((b.automation_job->>'notBefore')::timestamptz,'-infinity')<=clock_timestamp()
   and coalesce((b.automation_job->>'leaseUntil')::timestamptz,'-infinity')<=clock_timestamp()
   and coalesce(b.lease_until,'-infinity')<=clock_timestamp()
  union all
  select 'analyze',m.id::text,1 from
   (select m0.* from public.private_mail_messages m0 where not p_history_only and p_report_day is null and p_history is null and m0.mailbox_id=p_box
    and public.private_mail_dispatch_target_allowed(p_box,'analyze',m0.id::text)
    and m0.analysis_attempts<5 and coalesce(m0.analysis_next_at,'-infinity')<=clock_timestamp()
    and coalesce(m0.analysis_lease_until,'-infinity')<=clock_timestamp()
    order by m0.created_at,m0.id limit 5) m
  union all
  select 'analyze',e.key,1 from jsonb_each(b.manual_entries) e
   where not p_history_only and p_report_day is null and (p_history is null or e.key=p_history::text)
   and public.private_mail_dispatch_target_allowed(p_box,'analyze',e.key)
   and coalesce((e.value->>'leaseUntil')::timestamptz,'-infinity')<=clock_timestamp()
   and coalesce((e.value->>'nextAt')::timestamptz,'-infinity')<=clock_timestamp()
  union all
  select 'report',r.key,2 from
   (select key from jsonb_each(b.briefing_pages) where not p_history_only and p_history is null and notes_connected and coalesce(value->>'hold','false')<>'true' and coalesce(value->>'ownerPreviewHold','false')<>'true'
    and (p_report_day is null or key=p_report_day::text) and value->>'dirty'='true'
    and public.private_mail_dispatch_target_allowed(p_box,'report',key)
    and coalesce((value->>'leaseUntil')::timestamptz,'-infinity')<=clock_timestamp()
    and coalesce((value->>'notBefore')::timestamptz,'-infinity')<=clock_timestamp()
    order by key limit 3) r
  union all
  select 'history',h.id::text,3 from
   (select h0.id,h0.created_at from public.private_mail_analysis_history h0 where p_report_day is null and (p_history_only or p_history is null)
    and (p_history is null or h0.id=p_history) and h0.mailbox_id=p_box
    and public.private_mail_dispatch_target_allowed(p_box,'history',h0.id::text)
    and coalesce(h0.next_at,'-infinity')<=clock_timestamp()
    and coalesce(h0.lease_until,'-infinity')<=clock_timestamp()
    order by h0.created_at,h0.id limit 3) h
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
     when 'analyze' then jsonb_build_object('messageId',item.target)
     when 'history' then jsonb_build_object('historyId',item.target) else jsonb_build_object('day',item.target) end,
   timeout_milliseconds:=250000);
  queued=true;
 end loop;
 return queued;
 -- A dispatch failure cannot roll back POP publications or their durable receipt.
 exception when others then return false;
end; $$;
-- Explicit date calls retain their narrow scope; no optional dispatch target parameters.
create or replace function public.private_mail_dispatch(p_box uuid,p_report_day date)
returns boolean language sql security invoker set search_path='' as $$
 select public.private_mail_dispatch_core(p_box,p_report_day,null::uuid,false);
$$;

-- A null history ID drains only the bounded archive queue, never POP or another model call.
create or replace function public.private_mail_dispatch_history(p_box uuid,p_history uuid default null)
returns boolean language sql security invoker set search_path='' as $$
 select public.private_mail_dispatch_core(p_box,null::date,p_history,true);
$$;

-- No date default: PostgREST one-argument calls remain unambiguous.
create or replace function public.private_mail_dispatch(p_box uuid)
returns boolean language sql security invoker set search_path='' as $$
 select public.private_mail_dispatch(p_box,null::date);
$$;

-- A null day must never fall through to the mailbox-wide dispatcher.
create or replace function public.private_mail_dispatch_report(p_box uuid,p_report_day date)
returns boolean language sql security invoker set search_path='' as $$
 select case when p_report_day is null then false else public.private_mail_dispatch(p_box,p_report_day) end;
$$;

create or replace function public.private_mail_scheduler_ready()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare has_job boolean=false; definition text;
begin
 if to_regclass('cron.job') is null or to_regprocedure('public.private_mail_dispatch_auth(text)') is null
 or to_regprocedure('extensions.gen_random_bytes(integer)') is null
 or to_regprocedure('extensions.digest(bytea,text)') is null then return false; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='net' and p.proname='http_post') then return false; end if;
 definition=pg_get_functiondef('public.private_mail_dispatch_core(uuid,date,uuid,boolean)'::regprocedure);
 if position('https://sajoansan.vercel.app/api/private-mail-worker' in definition)=0
 or position('pmjob_' in definition)=0 or position('net.http_post' in definition)=0 then return false; end if;
 execute 'select exists(select 1 from cron.job where jobname=$1 and active and command=$2)'
 into has_job using 'private-mail-recovery','select public.private_mail_automation_tick()';
 return has_job;
 exception when others then return false;
end; $$;
revoke all on function public.private_mail_scheduler_ready() from public,anon,authenticated;
grant execute on function public.private_mail_scheduler_ready() to service_role;
create or replace function public.private_mail_briefing_release(p_box uuid,p_day date,p_lease uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; page jsonb; d text=p_day::text;
begin
 select * into b from public.private_mailboxes where id=p_box for update;page=b.briefing_pages->d;
 if p_lease is null or not public.private_mail_report_allowed(p_box,p_day)
 or page->>'lease' is distinct from p_lease::text then return false; end if;
 page=page||'{"lease":null,"leaseUntil":null}'::jsonb;
 update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page) where id=p_box;
 perform public.private_mail_dispatch_clear(p_box,'report',d);
 perform public.private_mail_dispatch_report(p_box,p_day);return true;
end; $$;

create or replace function public.private_mail_automation_tick()
returns integer language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; count_dispatched integer=0; report_day text;
begin
 for b in select * from public.private_mailboxes where id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid loop
  perform public.private_mail_manual_rollover(b.id,(clock_timestamp() at time zone 'Asia/Seoul')::date);
  if public.private_mail_dispatch_history(b.id,null::uuid) then count_dispatched=count_dispatched+1; end if;
  update public.private_mailboxes x set manual_entries=(select jsonb_object_agg(e.key,case
   when e.value->>'status'='processing' and coalesce((e.value->>'attempts')::integer,0)>=3
    and coalesce((e.value->>'leaseUntil')::timestamptz,'-infinity')<=clock_timestamp()
   then (e.value-'lease'-'leaseUntil')||jsonb_build_object('status','failed','error','RETRY_LIMIT','nextAt',clock_timestamp(),'updatedAt',clock_timestamp())
   else e.value end) from jsonb_each(x.manual_entries) e)
   where x.id=b.id and exists(select 1 from jsonb_each(x.manual_entries) e where e.value->>'status'='processing'
    and coalesce((e.value->>'attempts')::integer,0)>=3 and coalesce((e.value->>'leaseUntil')::timestamptz,'-infinity')<=clock_timestamp());
  -- Browser-independent recovery of explicitly saved messages, including when
  -- scheduled mail collection is paused. No retry of ready/terminal entries.
  for report_day in select e.key from jsonb_each(b.manual_entries) e where
   public.private_mail_dispatch_target_allowed(b.id,'analyze',e.key)
   and coalesce((e.value->>'leaseUntil')::timestamptz,'-infinity')<=clock_timestamp()
   and coalesce((e.value->>'nextAt')::timestamptz,'-infinity')<=clock_timestamp() loop
    if public.private_mail_dispatch_core(b.id,null::date,report_day::uuid,false) then count_dispatched=count_dispatched+1; end if;
  end loop;
  if not public.private_mail_automation_allowed(b.id) then
   -- Explicit manual reports and their retries do not start POP or a new inference.
   for report_day in select pages.key from public.private_mailboxes current_box,
    lateral jsonb_each(current_box.briefing_pages) pages where current_box.id=b.id and pages.value->>'dirty'='true'
    and coalesce(pages.value->>'hold','false')<>'true' and coalesce(pages.value->>'ownerPreviewHold','false')<>'true'
    and coalesce((pages.value->>'leaseUntil')::timestamptz,'-infinity')<=clock_timestamp()
    and coalesce((pages.value->>'notBefore')::timestamptz,'-infinity')<=clock_timestamp()
    and public.private_mail_dispatch_target_allowed(b.id,'report',pages.key) order by pages.key limit 3 loop
    if public.private_mail_dispatch_report(b.id,report_day::date) then count_dispatched=count_dispatched+1; end if;
   end loop;
   continue;
  end if;
  update public.private_mail_messages set analysis_status='failed',analysis_error='RETRY_LIMIT',
  analysis_lease=null,analysis_lease_until=null where mailbox_id=b.id and analysis_status='processing'
  and analysis_attempts>=5 and analysis_lease_until<=clock_timestamp();
  -- Recovery is minutely; pending collection never waits for the next three-hour cycle.
  perform public.private_mail_job_start(b.id,false);
  if public.private_mail_dispatch(b.id) then count_dispatched=count_dispatched+1; end if;
 end loop;return count_dispatched;
end; $$;
revoke all on function public.private_mail_dispatch_target_allowed(uuid,text,text),public.private_mail_dispatch_core(uuid,date,uuid,boolean),public.private_mail_dispatch_history(uuid,uuid),public.private_mail_dispatch(uuid,date),public.private_mail_dispatch(uuid),public.private_mail_dispatch_report(uuid,date),
 public.private_mail_briefing_release(uuid,date,uuid),public.private_mail_automation_tick() from public,anon,authenticated;
grant execute on function public.private_mail_dispatch_target_allowed(uuid,text,text),public.private_mail_dispatch_core(uuid,date,uuid,boolean),public.private_mail_dispatch_history(uuid,uuid),public.private_mail_dispatch(uuid,date),public.private_mail_dispatch(uuid),public.private_mail_dispatch_report(uuid,date),
 public.private_mail_briefing_release(uuid,date,uuid),public.private_mail_automation_tick() to service_role;
commit;
