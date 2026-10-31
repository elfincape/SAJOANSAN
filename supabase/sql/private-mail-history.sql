-- Local draft. Immutable analysis snapshots and retryable delivery to the existing approved OneDrive target.
begin;
create table if not exists public.private_mail_analysis_history (
 id uuid primary key default gen_random_uuid(),
 history_id text not null unique check(history_id ~ '^[0-9a-f]{64}$'),
 mailbox_id uuid not null references public.private_mailboxes(id) check(mailbox_id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid),
 owner_id uuid not null check(owner_id='2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid),
 source_kind text not null check(source_kind in ('mail','manual')),
 source_id uuid not null,
 file_name text not null,
 payload text not null check(octet_length(payload)<=262144),
 created_at timestamptz not null default clock_timestamp(),
 status text not null default 'pending' check(status in ('pending','processing','saved')),
 attempts integer not null default 0 check(attempts>=0),
 next_at timestamptz default clock_timestamp(),
 lease uuid,
 lease_until timestamptz,
 item_id text,
 delivered_at timestamptz,
 last_error text check(last_error ~ '^[A-Z_]{1,64}$'),
 check(file_name='analysis-history_'||source_kind||'_'||source_id::text||'_'||history_id||'.json'),
 check(history_id=encode(sha256(convert_to(payload,'UTF8')),'hex')),
 check(jsonb_typeof(payload::jsonb)='object')
);
create index if not exists private_mail_history_due on public.private_mail_analysis_history(next_at,created_at)
 where status in ('pending','processing');
alter table public.private_mail_analysis_history enable row level security;
revoke all on public.private_mail_analysis_history from public,anon,authenticated,service_role;
grant select,insert on public.private_mail_analysis_history to service_role;
-- Delivery workers can update transport state, never the snapshot, identity, or filename.
grant update(status,attempts,next_at,lease,lease_until,item_id,delivered_at,last_error)
 on public.private_mail_analysis_history to service_role;

create or replace function public.private_mail_history_allowed(p_box uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.private_mailboxes b join public.user_profiles p on p.id=b.owner_id and p.active
 where b.id=p_box and b.id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 and b.owner_id='2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid and b.enabled);
$$;

-- The optional dispatcher replaces this no-network stub without enabling collection or analysis.
create or replace function public.private_mail_dispatch_history(p_box uuid,p_history uuid default null)
returns boolean language sql security invoker set search_path='' as $$ select false; $$;

create or replace function public.private_mail_history_enqueue(p_history_id text,p_payload text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; record jsonb; source_kind text; source_id uuid;
 stored public.private_mail_analysis_history; name text;
begin
 if p_payload is null or octet_length(p_payload)>262144 then raise exception 'HISTORY_LIMIT'; end if;
 if p_history_id is null or p_history_id !~ '^[0-9a-f]{64}$'
 or p_history_id<>encode(sha256(convert_to(p_payload,'UTF8')),'hex') then raise exception 'HISTORY_HASH'; end if;
 record=p_payload::jsonb;
 if jsonb_typeof(record) is distinct from 'object' or record->>'schema' is distinct from 'sajoansan-mail-history-v1'
 or record->>'ownerId' is distinct from '2a828c2d-9a6f-40d4-8e13-336b591811cc'
 or record->>'mailboxId' is distinct from '39045005-313e-42e1-b50c-2394b3b6ff26'
 or coalesce(record->'source'->>'kind','') not in ('mail','manual')
 or coalesce(record->'source'->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or coalesce(jsonb_typeof(record->'structuredResult'),'') not in ('object','array')
 or jsonb_typeof(record->'completionEvents') is distinct from 'array'
 or jsonb_typeof(record->'rulesVersion') is distinct from 'string'
 or jsonb_typeof(record->'revision') is distinct from 'number' then raise exception 'HISTORY_FORMAT'; end if;
 select * into b from public.private_mailboxes where id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid for update;
 if not public.private_mail_history_allowed(b.id) then raise exception 'HISTORY_OWNER'; end if;
 source_kind=record->'source'->>'kind';source_id=(record->'source'->>'id')::uuid;
 if source_kind='mail' then
  if not exists(select 1 from public.private_mail_messages m where m.id=source_id and m.mailbox_id=b.id
   and m.owner_id=b.owner_id) then raise exception 'HISTORY_SOURCE'; end if;
 elsif to_jsonb(b)->'manual_entries'->source_id::text->>'status' is distinct from 'ready' then raise exception 'HISTORY_SOURCE';
 end if;
 name='analysis-history_'||source_kind||'_'||source_id::text||'_'||p_history_id||'.json';
 insert into public.private_mail_analysis_history(history_id,mailbox_id,owner_id,source_kind,source_id,file_name,payload)
 values(p_history_id,b.id,b.owner_id,source_kind,source_id,name,p_payload) on conflict(history_id) do nothing;
 select * into stored from public.private_mail_analysis_history where history_id=p_history_id;
 if stored.payload is distinct from p_payload or stored.file_name is distinct from name then raise exception 'HISTORY_CONFLICT'; end if;
 if stored.status<>'saved' then
  begin perform public.private_mail_dispatch_history(b.id,stored.id); exception when others then null; end;
 end if;
 return jsonb_build_object('id',stored.id,'historyId',stored.history_id,'status',stored.status);
end; $$;

create or replace function public.private_mail_history_capture_analysis(p_message uuid,p_analysis jsonb,p_correction jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.private_mail_messages; b public.private_mailboxes; record jsonb; overrides jsonb;
 event_at timestamptz; revision_number bigint=1; payload text;
begin
 select * into m from public.private_mail_messages where id=p_message;
 if m.id is null or m.mailbox_id is distinct from '39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 or m.owner_id is distinct from '2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid
 or jsonb_typeof(p_analysis) is distinct from 'object' then raise exception 'HISTORY_SOURCE'; end if;
 if not public.private_mail_history_allowed(m.mailbox_id) then raise exception 'HISTORY_OWNER'; end if;
 select * into b from public.private_mailboxes where id=m.mailbox_id for update;
 event_at=m.created_at;
 begin event_at=coalesce((p_analysis->>'updatedAt')::timestamptz,(p_analysis->'source'->>'analyzedAt')::timestamptz,m.created_at);
 exception when others then event_at=m.created_at; end;
 if coalesce(p_analysis->>'revision','') ~ '^[1-9][0-9]{0,14}$' then revision_number=(p_analysis->>'revision')::bigint; end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into overrides
 from jsonb_each(coalesce(to_jsonb(b)->'briefing_overrides','{}'::jsonb)) where left(key,37)=p_message::text||':';
 record=jsonb_build_object('schema','sajoansan-mail-history-v1','ownerId',b.owner_id,'mailboxId',b.id,
  'source',jsonb_build_object('kind','mail','id',m.id),'revision',revision_number,
  'eventAt',to_char(event_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'model',coalesce(p_analysis->'inference'->>'model',p_analysis->>'model'),
  'rulesVersion',coalesce(nullif(p_analysis->>'rulesVersion',''),nullif(p_analysis->'source'->'analysisPolicy'->>'version',''),'legacy-unversioned'),
  'structuredResult',p_analysis,'correction',coalesce(p_correction,jsonb_build_object('ownerOverrides',overrides,
   'intentOverride',to_jsonb(b)->'automation_config'->'intentOverrides'->p_message::text)),
  'completionEvents','[]'::jsonb);
 payload=record::text;
 return public.private_mail_history_enqueue(encode(sha256(convert_to(payload,'UTF8')),'hex'),payload);
end; $$;

-- Explicit one-message backfill/correction capture. This never invokes an LLM or edits OneNote.
create or replace function public.private_mail_history_capture(p_message uuid,p_correction jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare analysis jsonb;
begin
 select m.analysis into analysis from public.private_mail_messages m where m.id=p_message;
 return public.private_mail_history_capture_analysis(p_message,analysis,p_correction);
end; $$;

create or replace function public.private_mail_history_capture_manual(p_entry uuid,p_entry_value jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare record jsonb; payload text; events jsonb; event_at timestamptz;
begin
 if p_entry_value->>'status' is distinct from 'ready' or p_entry_value->>'entryId' is distinct from p_entry::text then raise exception 'HISTORY_SOURCE'; end if;
 event_at=coalesce((p_entry_value->>'updatedAt')::timestamptz,(p_entry_value->>'submittedAt')::timestamptz);
 select coalesce(jsonb_agg(event.value||jsonb_build_object('itemId',item.value->>'itemId') order by item.ordinal,event.ordinal),'[]'::jsonb) into events
 from jsonb_array_elements(p_entry_value->'items') with ordinality item(value,ordinal),
 lateral jsonb_array_elements(coalesce(item.value->'completionEvents','[]'::jsonb)) with ordinality event(value,ordinal);
 record=jsonb_build_object('schema','sajoansan-mail-history-v1',
  'ownerId','2a828c2d-9a6f-40d4-8e13-336b591811cc','mailboxId','39045005-313e-42e1-b50c-2394b3b6ff26',
  'source',jsonb_build_object('kind','manual','id',p_entry),'revision',1,
  'eventAt',to_char(event_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'model',p_entry_value->'inference'->>'model','rulesVersion','manual-v1',
  'structuredResult',jsonb_build_object('items',p_entry_value->'items','submittedAt',p_entry_value->'submittedAt',
   'referenceDate',p_entry_value->'referenceDate','referenceSource',p_entry_value->'referenceSource','authoredDate',p_entry_value->'authoredDate',
   'jevReview',p_entry_value->'jevReview'),
  'correction',null,'completionEvents',events);
 payload=record::text;
 return public.private_mail_history_enqueue(encode(sha256(convert_to(payload,'UTF8')),'hex'),payload);
end; $$;

create or replace function public.private_mail_history_analysis_trigger()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.mailbox_id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid and new.owner_id='2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid then
  if old.analysis is not null then perform public.private_mail_history_capture_analysis(old.id,old.analysis); end if;
  if new.analysis is not null then perform public.private_mail_history_capture_analysis(new.id,new.analysis); end if;
 end if;
 return new;
end; $$;

create or replace function public.private_mail_history_mailbox_trigger()
returns trigger language plpgsql security invoker set search_path='' as $$
declare entry record; changed_source uuid; old_correction jsonb; new_correction jsonb;
begin
 if new.id is distinct from '39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 or new.owner_id is distinct from '2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid then return new; end if;
 if to_jsonb(old)->'manual_entries' is distinct from to_jsonb(new)->'manual_entries' then
  for entry in select key,value from jsonb_each(coalesce(to_jsonb(new)->'manual_entries','{}'::jsonb))
   where value is distinct from to_jsonb(old)->'manual_entries'->key loop
   if to_jsonb(old)->'manual_entries'->entry.key->>'status'='ready' then
    perform public.private_mail_history_capture_manual(entry.key::uuid,to_jsonb(old)->'manual_entries'->entry.key);
   end if;
   if entry.value->>'status'='ready' then perform public.private_mail_history_capture_manual(entry.key::uuid,entry.value); end if;
  end loop;
 end if;
 if to_jsonb(old)->'briefing_overrides' is distinct from to_jsonb(new)->'briefing_overrides' then
  for changed_source in select distinct split_part(key,':',1)::uuid from (
   select key from jsonb_each(coalesce(to_jsonb(new)->'briefing_overrides','{}'::jsonb))
   union select key from jsonb_each(coalesce(to_jsonb(old)->'briefing_overrides','{}'::jsonb))) keys
   where key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
   and to_jsonb(old)->'briefing_overrides'->key is distinct from to_jsonb(new)->'briefing_overrides'->key loop
   select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into old_correction
    from jsonb_each(coalesce(to_jsonb(old)->'briefing_overrides','{}'::jsonb)) where left(key,37)=changed_source::text||':';
   select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into new_correction
    from jsonb_each(coalesce(to_jsonb(new)->'briefing_overrides','{}'::jsonb)) where left(key,37)=changed_source::text||':';
   select m.id,m.analysis into entry from public.private_mail_messages m where m.id=changed_source and m.mailbox_id=new.id and m.analysis is not null;
   if found then
    perform public.private_mail_history_capture_analysis(entry.id,entry.analysis,jsonb_build_object('ownerOverrides',old_correction,'intentOverride',to_jsonb(old)->'automation_config'->'intentOverrides'->changed_source::text));
    perform public.private_mail_history_capture_analysis(entry.id,entry.analysis,jsonb_build_object('ownerOverrides',new_correction,'intentOverride',to_jsonb(new)->'automation_config'->'intentOverrides'->changed_source::text));
   end if;
  end loop;
 end if;
 return new;
end; $$;

do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.private_mail_messages'::regclass and tgname='private_mail_history_analysis') then
  create trigger private_mail_history_analysis after update of analysis on public.private_mail_messages
   for each row when(old.analysis is distinct from new.analysis) execute function public.private_mail_history_analysis_trigger();
 elsif not exists(select 1 from pg_trigger where tgrelid='public.private_mail_messages'::regclass and tgname='private_mail_history_analysis'
  and tgfoid='public.private_mail_history_analysis_trigger()'::regprocedure and tgtype=17 and tgenabled='O') then raise exception 'HISTORY_TRIGGER_CONFLICT'; end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.private_mailboxes'::regclass and tgname='private_mail_history_mailbox') then
  create trigger private_mail_history_mailbox after update of manual_entries,briefing_overrides on public.private_mailboxes
   for each row when(old.manual_entries is distinct from new.manual_entries or old.briefing_overrides is distinct from new.briefing_overrides)
   execute function public.private_mail_history_mailbox_trigger();
 elsif not exists(select 1 from pg_trigger where tgrelid='public.private_mailboxes'::regclass and tgname='private_mail_history_mailbox'
  and tgfoid='public.private_mail_history_mailbox_trigger()'::regprocedure and tgtype=17 and tgenabled='O') then raise exception 'HISTORY_TRIGGER_CONFLICT'; end if;
end $$;

create or replace function public.private_mail_history_claim(p_history uuid,p_lease uuid)
returns setof public.private_mail_analysis_history language plpgsql security invoker set search_path='' as $$
declare entry public.private_mail_analysis_history;
begin
 if p_history is null or p_lease is null
 or not public.private_mail_history_allowed('39045005-313e-42e1-b50c-2394b3b6ff26'::uuid) then return; end if;
 select * into entry from public.private_mail_analysis_history h where h.id=p_history
 and h.status in ('pending','processing') and coalesce(h.next_at,'-infinity')<=clock_timestamp()
 and coalesce(h.lease_until,'-infinity')<=clock_timestamp() for update skip locked;
 if entry.id is null then return; end if;
 return query update public.private_mail_analysis_history h set status='processing',lease=p_lease,
 lease_until=clock_timestamp()+interval '5 minutes',attempts=least(h.attempts,2147483646)+1
 where h.id=entry.id returning h.*;
end; $$;

create or replace function public.private_mail_history_finish(p_history uuid,p_lease uuid,p_item_id text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b uuid; changed boolean;
begin
 if p_item_id is null or length(p_item_id) not between 1 and 512 or p_item_id ~ '[\r\n]' or p_lease is null then return false; end if;
 if not public.private_mail_history_allowed('39045005-313e-42e1-b50c-2394b3b6ff26'::uuid) then return false; end if;
 -- Mailbox first matches the dispatcher/auth lock order.
 perform 1 from public.private_mailboxes where id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid for update;
 update public.private_mail_analysis_history h set status='saved',item_id=p_item_id,delivered_at=clock_timestamp(),
 lease=null,lease_until=null,next_at=null,last_error=null
 where h.id=p_history and h.status='processing' and h.lease=p_lease and h.lease_until>clock_timestamp()
 returning h.mailbox_id into b;
 changed=b is not null;
 if changed then
  perform public.private_mail_dispatch_clear(b,'history',p_history::text);
  begin perform public.private_mail_dispatch_history(b,null); exception when others then null; end;
 end if;
 return changed;
end; $$;

create or replace function public.private_mail_history_fail(p_history uuid,p_lease uuid,p_code text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b uuid;
begin
 if p_code is null or p_code !~ '^[A-Z_]{1,64}$' or p_lease is null then return false; end if;
 if not public.private_mail_history_allowed('39045005-313e-42e1-b50c-2394b3b6ff26'::uuid) then return false; end if;
 perform 1 from public.private_mailboxes where id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid for update;
 update public.private_mail_analysis_history h set status='pending',last_error=p_code,lease=null,lease_until=null,
 next_at=clock_timestamp()+make_interval(secs=>least(900,30*power(2,least(5,greatest(0,h.attempts-1)))::integer))
 where h.id=p_history and h.status='processing' and h.lease=p_lease and h.lease_until>clock_timestamp()
 returning h.mailbox_id into b;
 if b is not null then
  perform public.private_mail_dispatch_clear(b,'history',p_history::text);
  begin perform public.private_mail_dispatch_history(b,null); exception when others then null; end;
 end if;
 return b is not null;
end; $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('private_mail_history_allowed','private_mail_dispatch_history',
 'private_mail_history_enqueue','private_mail_history_claim','private_mail_history_finish','private_mail_history_fail',
 'private_mail_history_capture_analysis','private_mail_history_capture','private_mail_history_capture_manual',
 'private_mail_history_analysis_trigger','private_mail_history_mailbox_trigger') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
create or replace function public.private_mail_intent_correct(p_message uuid,p_user uuid,p_reference boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; m public.private_mail_messages; config jsonb; correction jsonb; page jsonb;
begin
 select * into b from public.private_mailboxes where id='39045005-313e-42e1-b50c-2394b3b6ff26' for update;
 select * into m from public.private_mail_messages where id=p_message and mailbox_id=b.id for update;
 if p_user is distinct from b.owner_id or p_user is distinct from m.owner_id or not public.private_mail_history_allowed(b.id)
 or m.id is null or m.analysis is null or p_reference is null then raise exception 'CORRECTION_SCOPE'; end if;
 perform public.private_mail_history_capture(m.id,null);
 config=b.automation_config;
 if p_reference then
  correction=jsonb_build_object('intent','reference','source','owner_feedback','recordedAt',clock_timestamp(),'reason','사용자가 참고 자료로 정정');
  config=jsonb_set(config,'{intentOverrides}',coalesce(config->'intentOverrides','{}')||jsonb_build_object(m.id::text,correction));
 else config=config#-array['intentOverrides',m.id::text]; end if;
 update public.private_mailboxes set automation_config=config where id=b.id;
 perform public.private_mail_history_capture(m.id,null);
 page=b.briefing_pages->m.report_day::text;
 if page is not null then
  page=page||jsonb_build_object('dirty',true,'revision',coalesce((page->>'revision')::integer,0)+1);
  update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[m.report_day::text],page) where id=b.id;
 end if;
 return true;
end; $$;
revoke all on function public.private_mail_intent_correct(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.private_mail_intent_correct(uuid,uuid,boolean) to service_role;
commit;
