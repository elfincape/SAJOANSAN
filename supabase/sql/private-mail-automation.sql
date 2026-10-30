-- LOCAL DRAFT. Apply separately after collection has stopped and owner approval.
-- Existing last_counts.cycle and manual POP lease remain the only collection receipt/lease.
begin;
alter table public.private_mailboxes
 add column if not exists automation_config jsonb not null default '{"enabled":false,"readStateVerified":false,"analysisConsent":false,"analysisConsentAt":null}',
 add column if not exists automation_job jsonb,
 add column if not exists automation_next_at timestamptz,
 add column if not exists briefing_pages jsonb not null default '{}';
alter table public.private_mail_messages
 add column if not exists analysis_excluded boolean not null default false,
 add column if not exists analysis_filter_override text not null default 'inherit' check(analysis_filter_override in ('inherit','include','exclude')),
 add column if not exists analysis_manual_selected_at timestamptz,
 add column if not exists analysis jsonb,
 add column if not exists analysis_status text not null default 'pending' check(analysis_status in ('pending','processing','ready','failed','blocked')),
 add column if not exists analysis_error text check(analysis_error ~ '^[A-Z_]{1,64}$'),
 add column if not exists analysis_lease uuid,
 add column if not exists analysis_lease_until timestamptz,
 add column if not exists analysis_attempts integer not null default 0,
 add column if not exists analysis_next_at timestamptz default now(),
 add column if not exists report_day date generated always as ((created_at at time zone 'Asia/Seoul')::date) stored;
create index if not exists private_mail_analysis_due on public.private_mail_messages(mailbox_id,analysis_next_at)
 where analysis_status in ('pending','processing','failed') and analysis_attempts<5;

create or replace function public.private_mail_automation_allowed(p_box uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.private_mailboxes b join public.user_profiles p on p.id=b.owner_id and p.active
 where b.id=p_box and b.id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 and b.owner_id='2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid and b.enabled
 and b.automation_config->>'enabled'='true' and b.automation_config->>'readStateVerified'='true');
$$;
-- Optional scheduler file replaces only this dispatcher. Core has no network dependency.
create or replace function public.private_mail_dispatch(p_box uuid)
returns boolean language sql security invoker set search_path='' as $$ select false; $$;

-- Safe before the optional scheduler is installed; metadata-only implementation replaces it.
create or replace function public.private_mail_scheduler_ready()
returns boolean language sql stable security invoker set search_path='' as $$ select false; $$;

create or replace function public.private_mail_job_start(p_box uuid,p_force boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; j jsonb; c jsonb; request uuid;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 if not public.private_mail_automation_allowed(p_box) then return null; end if;
 j=b.automation_job;
 if j->>'status' in ('queued','running') then return j; end if;
 if b.lease_until>clock_timestamp() then return null; end if;
 if not coalesce(p_force,false) and b.automation_next_at>clock_timestamp() then return null; end if;
 c=b.last_counts->'cycle';
 if c->>'phase'='collecting' then
  -- Only explicit owner run-now may resume an expired manual receipt unchanged.
  if not coalesce(p_force,false) or coalesce(c->>'requestId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return null; end if;
  request=(c->>'requestId')::uuid;
 else request=gen_random_uuid(); end if;
 j=jsonb_build_object('id',request,'status','queued','cycleId',case when c->>'phase'='collecting' then c->>'id' else null end,'attempts',0,
 'stopRequested',false,'lease',null,'leaseUntil',null,'notBefore',clock_timestamp(),
 'createdAt',clock_timestamp(),'updatedAt',clock_timestamp(),'error',null,'progress',null);
 update public.private_mailboxes set automation_job=j,automation_next_at=clock_timestamp()+interval '3 hours' where id=p_box;
 perform public.private_mail_dispatch(p_box); return j;
end; $$;

create or replace function public.private_mail_job_claim(p_box uuid,p_job uuid,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; j jsonb;
begin
 if p_lease is null then return null; end if;
 select * into b from public.private_mailboxes where id=p_box for update;
 j=b.automation_job;
 if not public.private_mail_automation_allowed(p_box) or j->>'id' is distinct from p_job::text
 or j->>'status' not in ('queued','running') or coalesce((j->>'stopRequested')::boolean,false)
 or (j->>'leaseUntil')::timestamptz>clock_timestamp()
 or (j->>'notBefore')::timestamptz>clock_timestamp()
 or b.lease_until>clock_timestamp() then return null; end if;
 -- Expired worker claims consume retry budget too, preventing endless crash loops.
 if (j->>'attempts')::integer>=5 then
  update public.private_mailboxes set automation_job=j||jsonb_build_object('status','failed','error','RETRY_LIMIT','lease',null,'leaseUntil',null) where id=p_box;
  return null;
 end if;
 j=j||jsonb_build_object('status','running','lease',p_lease,'leaseUntil',clock_timestamp()+interval '5 minutes',
 'attempts',(j->>'attempts')::integer+1,'updatedAt',clock_timestamp());
 update public.private_mailboxes set automation_job=j where id=p_box; return j;
end; $$;

create or replace function public.private_mail_job_finish(p_box uuid,p_job uuid,p_lease uuid,p_progress jsonb,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; j jsonb; c jsonb; state text; delay integer;
begin
 if p_error is not null and p_error !~ '^[A-Z_]{1,64}$' then raise exception 'JOB_ERROR'; end if;
 select * into b from public.private_mailboxes where id=p_box for update;
 j=b.automation_job; c=b.last_counts->'cycle';
 if j->>'id' is distinct from p_job::text or j->>'lease' is distinct from p_lease::text
 or j->>'status' is distinct from 'running' or (j->>'leaseUntil')::timestamptz is null
 or (j->>'leaseUntil')::timestamptz<=clock_timestamp() then raise exception 'JOB_LEASE'; end if;
 if p_progress is not null then
  if c is null or c is distinct from p_progress or c->>'requestId' is distinct from p_job::text
   or jsonb_typeof(c->'pending') is distinct from 'array'
   or c->>'phase' is distinct from (case when jsonb_array_length(c->'pending')=0 then 'complete' else 'collecting' end)
   then raise exception 'JOB_PROGRESS'; end if;
  j=j||jsonb_build_object('cycleId',c->>'id','progress',c);
 elsif p_error is null then raise exception 'JOB_PROGRESS'; end if;
 if coalesce((j->>'stopRequested')::boolean,false) or not public.private_mail_automation_allowed(p_box) then state='stopped';
 elsif p_error is not null and (j->>'attempts')::integer>=5 then state='failed';
 elsif p_error is not null then state='queued';
 elsif c->>'phase'='complete' then state='complete'; else state='queued'; end if;
 delay=case when p_error is null then 0 else least(300,15*power(2,greatest(0,(j->>'attempts')::integer-1))::integer) end;
 j=j||jsonb_build_object('status',state,'lease',null,'leaseUntil',null,'error',p_error,
 'notBefore',clock_timestamp()+make_interval(secs=>delay),'updatedAt',clock_timestamp());
 -- Successful chunks reset the crash/error budget, independent of total chunk count.
 if p_error is null then j=jsonb_set(j,'{attempts}','0'::jsonb); end if;
 update public.private_mailboxes set automation_job=j where id=p_box;
 if state='queued' then perform public.private_mail_dispatch(p_box); end if;
 return j;
end; $$;

create or replace function public.private_mail_job_stop(p_box uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; j jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 if not public.private_mail_automation_allowed(p_box) or b.automation_job is null then return false; end if;
 j=b.automation_job||jsonb_build_object('stopRequested',true,'updatedAt',clock_timestamp());
 if j->>'status'='queued' or (j->>'leaseUntil')::timestamptz<=clock_timestamp() then
  j=j||jsonb_build_object('status','stopped','lease',null,'leaseUntil',null);
 end if;
 update public.private_mailboxes set automation_job=j where id=p_box;return true;
end; $$;

-- Explicit selection is a grant for one stored message; automation remains disabled.
create or replace function public.private_mail_analysis_select(p_box uuid,p_message uuid,p_user uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; m public.private_mail_messages; d text; page jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 select * into m from public.private_mail_messages where id=p_message and mailbox_id=p_box for update;
 if p_user is distinct from '2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid
 or b.id is distinct from '39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 or b.owner_id is distinct from p_user or m.owner_id is distinct from p_user or m.id is null or not b.enabled
 or not exists(select 1 from public.user_profiles p where p.id=p_user and p.active) then raise exception 'ANALYSIS_SELECTION_SCOPE'; end if;
 update public.private_mail_messages set analysis_manual_selected_at=coalesce(analysis_manual_selected_at,clock_timestamp())
 where id=p_message returning * into m;
 -- A new explicit click may retry this failed mail without resetting in-flight or ready work.
 if m.analysis_status='failed' and (not m.analysis_excluded or m.analysis_filter_override='include')
 and (m.analysis_lease_until is null or m.analysis_lease_until<=clock_timestamp()) then
  update public.private_mail_messages set analysis_status='pending',analysis_attempts=0,analysis_next_at=clock_timestamp(),
  analysis_error=null,analysis_lease=null,analysis_lease_until=null where id=p_message returning * into m;
 end if;
 if m.analysis_status='ready' and m.analysis is not null and (not m.analysis_excluded or m.analysis_filter_override='include') then
  d=m.report_day::text;page=coalesce(b.briefing_pages->d,'{}'::jsonb);
  page=page||jsonb_build_object('revision',coalesce((page->>'revision')::integer,0)+1,'dirty',true);
  update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page) where id=p_box;
 end if;
 return jsonb_build_object('id',m.id,'status',m.analysis_status,'analysis_status',m.analysis_status,
 'excluded',m.analysis_excluded and m.analysis_filter_override<>'include','reportDay',m.report_day,'selectedAt',m.analysis_manual_selected_at);
end; $$;

create or replace function public.private_mail_analysis_allowed(p_message uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.private_mail_messages m join public.private_mailboxes b on b.id=m.mailbox_id
 join public.user_profiles p on p.id=b.owner_id and p.active
 where m.id=p_message and b.id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 and b.owner_id='2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid and m.owner_id=b.owner_id and b.enabled
 and (not m.analysis_excluded or m.analysis_filter_override='include')
 and (m.analysis_manual_selected_at is not null or
 (public.private_mail_automation_allowed(b.id) and b.automation_config->>'analysisConsent'='true'
 and m.created_at>=(b.automation_config->>'analysisConsentAt')::timestamptz
 and m.sent_at>=(b.automation_config->>'analysisConsentAt')::timestamptz)));
$$;

create or replace function public.private_mail_report_allowed(p_box uuid,p_day date)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.private_mailboxes b join public.user_profiles p on p.id=b.owner_id and p.active
 where b.id=p_box and b.id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 and b.owner_id='2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid and b.enabled
 and ((public.private_mail_automation_allowed(b.id) and b.automation_config->>'analysisConsent'='true') or
 (jsonb_typeof(b.briefing_pages->p_day::text->'pageId')='string' and length(b.briefing_pages->p_day::text->>'pageId')>0) or
 exists(select 1 from public.private_mail_messages m where m.mailbox_id=b.id and m.owner_id=b.owner_id
 and m.report_day=p_day and m.analysis_manual_selected_at is not null and m.analysis_status='ready' and m.analysis is not null)));
$$;

create or replace function public.private_mail_analysis_claim(p_message uuid,p_lease uuid)
returns setof public.private_mail_messages language sql security invoker set search_path='' as $$
 update public.private_mail_messages m set analysis_lease=p_lease,analysis_lease_until=clock_timestamp()+interval '5 minutes',
 analysis_status='processing',analysis_attempts=m.analysis_attempts+1
 from public.private_mailboxes b where m.id=p_message and b.id=m.mailbox_id
 and p_lease is not null and public.private_mail_analysis_allowed(m.id)
 and m.analysis_status in ('pending','failed','processing') and m.analysis_attempts<5
 and (m.analysis_next_at is null or m.analysis_next_at<=clock_timestamp())
 and (m.analysis_lease_until is null or m.analysis_lease_until<=clock_timestamp()) returning m.*;
$$;

create or replace function public.private_mail_analysis_finish(p_message uuid,p_lease uuid,p_analysis jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare m public.private_mail_messages; b public.private_mailboxes; d text; page jsonb;
begin
 if jsonb_typeof(p_analysis) is distinct from 'object' or octet_length(p_analysis::text)>65536 then raise exception 'ANALYSIS_VALUE'; end if;
 -- All operations touching both records lock mailbox first, including INSERT trigger.
 select b0.* into b from public.private_mailboxes b0 join public.private_mail_messages m0 on m0.mailbox_id=b0.id where m0.id=p_message for update of b0;
 select * into m from public.private_mail_messages where id=p_message for update;
 if m.id is null or not public.private_mail_analysis_allowed(m.id)
 or m.analysis_lease is distinct from p_lease or m.analysis_status<>'processing'
 or m.analysis_lease_until is null or m.analysis_lease_until<=clock_timestamp() then return false; end if;
 update public.private_mail_messages set analysis=p_analysis,analysis_status='ready',analysis_error=null,
 analysis_lease=null,analysis_lease_until=null,analysis_next_at=null where id=p_message;
 d=m.report_day::text;page=coalesce(b.briefing_pages->d,'{}'::jsonb);
 page=page||jsonb_build_object('revision',coalesce((page->>'revision')::integer,0)+1,'dirty',true);
 update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page) where id=b.id;
 perform public.private_mail_dispatch(b.id);return true;
end; $$;

create or replace function public.private_mail_analysis_fail(p_message uuid,p_lease uuid,p_code text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare m public.private_mail_messages;
begin
 if p_code is null or p_code !~ '^[A-Z_]{1,64}$' then raise exception 'ANALYSIS_ERROR'; end if;
 update public.private_mail_messages set analysis_status='failed',analysis_error=p_code,analysis_lease=null,analysis_lease_until=null,
 analysis_next_at=clock_timestamp()+make_interval(secs=>least(900,30*power(2,greatest(0,analysis_attempts-1))::integer))
 where id=p_message and public.private_mail_analysis_allowed(id)
 and analysis_status='processing' and analysis_lease=p_lease and analysis_lease_until>clock_timestamp()
 returning * into m;
 return m.id is not null;
end; $$;

create or replace function public.private_mail_briefing_claim(p_box uuid,p_day date,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; page jsonb; d text=p_day::text;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 page=b.briefing_pages->d;
 if p_lease is null or p_day is null or not public.private_mail_report_allowed(p_box,p_day)
 or coalesce((page->>'dirty')::boolean,false)=false or (page->>'leaseUntil')::timestamptz>clock_timestamp()
 or (page->>'notBefore')::timestamptz>clock_timestamp() then return null; end if;
 page=jsonb_build_object('pageId',null,'managedHash',null,'fingerprint',null,'createAttempted',false,'pendingWrite',null)||page||
 jsonb_build_object('lease',p_lease,'leaseUntil',clock_timestamp()+interval '5 minutes','claimedRevision',(page->>'revision')::integer);
 update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page) where id=p_box;return page;
end; $$;

create or replace function public.private_mail_briefing_save(p_box uuid,p_day date,p_lease uuid,p_value jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; page jsonb; d text=p_day::text;
begin
 if jsonb_typeof(p_value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_value) k
 where k not in ('pageId','managedHash','fingerprint','createAttempted','pendingWrite','imageProgress','error','notBefore'))
 or octet_length(p_value::text)>8192 then raise exception 'BRIEFING_VALUE'; end if;
 select * into b from public.private_mailboxes where id=p_box for update;page=b.briefing_pages->d;
 if page->>'lease' is distinct from p_lease::text or page->>'leaseUntil' is null
 or (page->>'leaseUntil')::timestamptz<=clock_timestamp() or not public.private_mail_report_allowed(p_box,p_day) then return false; end if;
 update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page||p_value) where id=p_box;return true;
end; $$;

-- Call only after Graph success or recovered lost acknowledgment, before release.
create or replace function public.private_mail_briefing_complete(p_box uuid,p_day date,p_lease uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; page jsonb; d text=p_day::text;
begin
 select * into b from public.private_mailboxes where id=p_box for update;page=b.briefing_pages->d;
 if page->>'lease' is distinct from p_lease::text or page->>'leaseUntil' is null
 or (page->>'leaseUntil')::timestamptz<=clock_timestamp() or not public.private_mail_report_allowed(p_box,p_day)
 or page->>'revision' is distinct from page->>'claimedRevision' then return false; end if;
 update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page||'{"dirty":false,"pendingWrite":null}'::jsonb) where id=p_box;return true;
end; $$;

create or replace function public.private_mail_briefing_release(p_box uuid,p_day date,p_lease uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; page jsonb; d text=p_day::text;
begin
 select * into b from public.private_mailboxes where id=p_box for update;page=b.briefing_pages->d;
 if p_lease is null or not public.private_mail_report_allowed(p_box,p_day)
 or page->>'lease' is distinct from p_lease::text then return false; end if;
 page=page||'{"lease":null,"leaseUntil":null}'::jsonb;
 update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page) where id=p_box;
 if (page->>'dirty')::boolean then perform public.private_mail_dispatch(p_box); end if;return true;
end; $$;

create or replace function public.private_mail_analysis_enqueue()
returns trigger language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes;
begin
 select * into b from public.private_mailboxes where id=new.mailbox_id;
 if public.private_mail_automation_allowed(b.id) and (not new.analysis_excluded or new.analysis_filter_override='include')
 and b.automation_config->>'analysisConsent'='true'
 and new.created_at>=(b.automation_config->>'analysisConsentAt')::timestamptz
 and new.sent_at>=(b.automation_config->>'analysisConsentAt')::timestamptz then
  perform public.private_mail_dispatch(b.id);
 end if;return new;
end; $$;
drop trigger if exists private_mail_analysis_enqueue on public.private_mail_messages;
create trigger private_mail_analysis_enqueue after insert on public.private_mail_messages for each row execute function public.private_mail_analysis_enqueue();

create or replace function public.private_mail_automation_tick()
returns integer language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; count_dispatched integer=0;
begin
 for b in select * from public.private_mailboxes where id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid loop
  if not public.private_mail_automation_allowed(b.id) then continue; end if;
  update public.private_mail_messages set analysis_status='failed',analysis_error='RETRY_LIMIT',
  analysis_lease=null,analysis_lease_until=null where mailbox_id=b.id and analysis_status='processing'
  and analysis_attempts>=5 and analysis_lease_until<=clock_timestamp();
  -- Recovery is minutely; pending collection never waits for the next three-hour cycle.
  perform public.private_mail_job_start(b.id,false);
  if public.private_mail_dispatch(b.id) then count_dispatched=count_dispatched+1; end if;
 end loop;return count_dispatched;
end; $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('private_mail_automation_allowed','private_mail_dispatch','private_mail_scheduler_ready','private_mail_job_start','private_mail_job_claim',
 'private_mail_job_finish','private_mail_job_stop','private_mail_analysis_select','private_mail_analysis_allowed','private_mail_report_allowed','private_mail_analysis_claim','private_mail_analysis_finish','private_mail_analysis_fail',
 'private_mail_briefing_claim','private_mail_briefing_save','private_mail_briefing_complete','private_mail_briefing_release','private_mail_analysis_enqueue','private_mail_automation_tick') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
