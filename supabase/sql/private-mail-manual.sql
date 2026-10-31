-- LOCAL DRAFT ONLY. Requires existing private-mail automation/filter schema. No remote apply.
begin;
alter table public.private_mailboxes
 add column if not exists manual_entries jsonb not null default '{}' check(jsonb_typeof(manual_entries)='object');

create or replace function public.private_mail_manual_allowed(p_box uuid,p_user uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select p_user='2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid and exists(
 select 1 from public.private_mailboxes b join public.user_profiles p on p.id=b.owner_id and p.active
 where b.id=p_box and b.id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid and b.owner_id=p_user and b.enabled);
$$;

-- One mailbox row lock fences duplicate registration, paid-call claims and immutable receipt dates.
create or replace function public.private_mail_manual_claim(p_box uuid,p_user uuid,p_request uuid,p_text text,p_hash text,p_reference date,p_lease uuid,p_retry boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; e jsonb; candidate jsonb; entries jsonb; entry_id uuid;
 received timestamptz=clock_timestamp(); d date; attempts integer;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 if not public.private_mail_manual_allowed(p_box,p_user) then raise exception 'MANUAL_SCOPE'; end if;
 if p_request is null or p_lease is null or p_text is null or length(btrim(p_text)) not between 1 and 12000
 or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'MANUAL_INPUT_INVALID'; end if;
 d=(received at time zone 'Asia/Seoul')::date;entries=b.manual_entries;
 select value into e from jsonb_each(entries) where value->>'clientRequestId'=p_request::text or coalesce(value->'requestIds','[]'::jsonb) ? p_request::text limit 1;
 if e is not null and (e->>'textHash' is distinct from p_hash or
 (case when coalesce(e->'requestReferences','{}'::jsonb) ? p_request::text then e->'requestReferences'->>p_request::text
 else e->>'requestedReference' end) is distinct from p_reference::text)
 then raise exception 'MANUAL_REQUEST_CONFLICT'; end if;
 if e is null then
  select value into e from jsonb_each(entries) where value->>'textHash'=p_hash
  and (value->>'submittedAt')::timestamptz at time zone 'Asia/Seoul'>=d::timestamp
  and (value->>'submittedAt')::timestamptz at time zone 'Asia/Seoul'<(d+1)::timestamp
  and value->>'referenceDate'=coalesce(p_reference,d)::text limit 1;
 end if;
 if e is null then
  if (select count(*) from jsonb_each(entries))>=500 then raise exception 'MANUAL_LIMIT'; end if;
  entry_id=gen_random_uuid();
  e=jsonb_build_object('entryId',entry_id,'clientRequestId',p_request,'requestIds',jsonb_build_array(p_request),
   'requestReferences',jsonb_build_object(p_request::text,p_reference),'text',btrim(p_text),'textHash',p_hash,
   'submittedAt',received,'referenceDate',coalesce(p_reference,d),'requestedReference',p_reference,
   'referenceSource',case when p_reference is null then 'received' else 'owner' end,
   'status','pending','attempts',0,'items','[]'::jsonb,'authoredDate',null,'error',null);
 else
  entry_id=(e->>'entryId')::uuid;
  if not (coalesce(e->'requestIds',jsonb_build_array(e->>'clientRequestId')) ? p_request::text) then
   if jsonb_array_length(coalesce(e->'requestIds','[]'::jsonb))>=100 then raise exception 'MANUAL_LIMIT'; end if;
   e=e||jsonb_build_object('requestIds',coalesce(e->'requestIds',jsonb_build_array(e->>'clientRequestId'))||jsonb_build_array(p_request),
    'requestReferences',coalesce(e->'requestReferences','{}'::jsonb)||jsonb_build_object(p_request::text,p_reference));
   entries=jsonb_set(entries,array[entry_id::text],e);
   if octet_length(entries::text)>4194304 then raise exception 'MANUAL_LIMIT'; end if;
   update public.private_mailboxes set manual_entries=entries where id=p_box;
  end if;
 end if;
 if e->>'status'='ready' or (e->>'leaseUntil')::timestamptz>received
 or (e->>'nextAt')::timestamptz>received then return jsonb_build_object('entry',e,'claimed',false); end if;
 attempts=coalesce((e->>'attempts')::integer,0);
 -- Only an explicit owner retry can begin another batch after a confirmed terminal failure.
 if attempts>=3 and coalesce(p_retry,false) and e->>'status'='failed'
 and e->>'lease' is null and e->>'leaseUntil' is null
 and (e->>'nextAt')::timestamptz<=received then attempts=0; end if;
 if attempts>=3 then return jsonb_build_object('entry',e||jsonb_build_object('status','failed','error','RETRY_LIMIT'),'claimed',false); end if;
 e=e||jsonb_build_object('status','processing','lease',p_lease,'leaseUntil',received+interval '2 minutes',
 'attempts',attempts+1,'error',null,'updatedAt',received);
 candidate=jsonb_set(entries,array[entry_id::text],e);
 if octet_length(candidate::text)>4194304 then raise exception 'MANUAL_LIMIT'; end if;
 update public.private_mailboxes set manual_entries=candidate where id=p_box;
 return jsonb_build_object('entry',e,'claimed',true);
end; $$;

create or replace function public.private_mail_manual_dirty(p_box uuid,p_day date)
returns void language sql security invoker set search_path='' as $$
 update public.private_mailboxes b set briefing_pages=jsonb_set(b.briefing_pages,array[p_day::text],
 coalesce(b.briefing_pages->p_day::text,'{}'::jsonb)||jsonb_build_object('dirty',true,
 'revision',coalesce((b.briefing_pages->p_day::text->>'revision')::integer,0)+1)) where b.id=p_box and public.private_mail_manual_allowed(p_box,'2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid);
$$;

create or replace function public.private_mail_manual_finish(p_box uuid,p_user uuid,p_entry uuid,p_lease uuid,p_items jsonb,p_authored date default null,p_inference jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; e jsonb; item jsonb; candidate jsonb; n integer=0; d date; completed_day date; usage_value jsonb; source_text text; source_value jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;e=b.manual_entries->p_entry::text;
 if not public.private_mail_manual_allowed(p_box,p_user) or e is null or p_lease is null
 or e->>'status' is distinct from 'processing' or e->>'lease' is distinct from p_lease::text
 or (e->>'leaseUntil')::timestamptz is null or (e->>'leaseUntil')::timestamptz<=clock_timestamp() then return null; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>30 or octet_length(p_items::text)>100000 then raise exception 'MANUAL_FORMAT'; end if;
 if jsonb_typeof(p_inference) is distinct from 'object' or octet_length(p_inference::text)>4096 then raise exception 'MANUAL_INFERENCE'; end if;
 if p_inference<>'{}'::jsonb then
  usage_value=p_inference->'usage';
  if exists(select 1 from jsonb_object_keys(p_inference) k where k not in ('provider','model','usage'))
  or coalesce(p_inference->>'provider','') not in ('aiapiflow','openai')
  or jsonb_typeof(p_inference->'model') is distinct from 'string' or coalesce(p_inference->>'model','') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
  or jsonb_typeof(usage_value) is distinct from 'object' then raise exception 'MANUAL_INFERENCE'; end if;
  if exists(select 1 from jsonb_each(usage_value) u where u.key not in ('input_tokens','output_tokens','total_tokens','cached_input_tokens','reasoning_tokens')
   or case when jsonb_typeof(u.value)='number' and u.value::text ~ '^[0-9]+$'
    then (u.value::text)::numeric>9007199254740991 else true end)
  then raise exception 'MANUAL_INFERENCE'; end if;
 end if;
 d=((e->>'submittedAt')::timestamptz at time zone 'Asia/Seoul')::date;
 source_text=e->>'text';
 if left(ltrim(source_text),1)='{' then
  begin source_value=source_text::jsonb;
  exception when invalid_text_representation then source_value=null; end;
  if source_value->>'schema'='sajo-daily-work-v1' then
   if jsonb_typeof(source_value->'sourceText') is distinct from 'string' then raise exception 'MANUAL_FORMAT'; end if;
   source_text=source_value->>'sourceText';
  end if;
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  n=n+1;
  if jsonb_typeof(item) is distinct from 'object' or item->>'itemId' is distinct from 'item-'||lpad(n::text,3,'0')
  or item->>'ref' is distinct from (p_entry::text||':manual:'||(item->>'itemId'))
  or coalesce(item->>'kind','') not in ('task','dispatch','issue','reference','waiting')
  or length(btrim(coalesce(item->>'text',''))) not between 1 and 500
  or length(btrim(coalesce(item->>'evidence',''))) not between 1 and 2000
  or source_text is null or position((item->>'evidence') in source_text)=0
  or item->>'visibleFrom' is distinct from d::text
  or (item->>'receivedAt')::timestamptz is distinct from (e->>'submittedAt')::timestamptz
  or (item->>'submittedAt')::timestamptz is distinct from (e->>'submittedAt')::timestamptz
  or item->'done' is distinct from 'false'::jsonb or item->'completedAt' is distinct from 'null'::jsonb
  or item->'completionEvents' is distinct from '[]'::jsonb
  or jsonb_typeof(item->'needsConfirmation') is distinct from 'boolean' then raise exception 'MANUAL_FORMAT'; end if;
 end loop;
 e=(e-'lease'-'leaseUntil'-'nextAt')||jsonb_build_object('status','ready','items',p_items,'authoredDate',p_authored,'inference',p_inference,'error',null,'updatedAt',clock_timestamp());
 candidate=jsonb_set(b.manual_entries,array[p_entry::text],e);
 if octet_length(candidate::text)>4194304 then raise exception 'MANUAL_LIMIT'; end if;
 update public.private_mailboxes set manual_entries=candidate where id=p_box;
 if n>0 then
  perform public.private_mail_manual_dirty(p_box,d);
  completed_day=(clock_timestamp() at time zone 'Asia/Seoul')::date;
  if completed_day<>d then perform public.private_mail_manual_dirty(p_box,completed_day); end if;
 end if;
 return e;
end; $$;

create or replace function public.private_mail_manual_fail(p_box uuid,p_user uuid,p_entry uuid,p_lease uuid,p_code text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; e jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;e=b.manual_entries->p_entry::text;
 if not public.private_mail_manual_allowed(p_box,p_user) or e is null or p_lease is null
 or e->>'status' is distinct from 'processing' or e->>'lease' is distinct from p_lease::text
 or (e->>'leaseUntil')::timestamptz is null or (e->>'leaseUntil')::timestamptz<=clock_timestamp() then return null; end if;
 if p_code is null or p_code not in ('AI_NOT_CONFIGURED','RATE_LIMITED','MODEL_FAILED','MODEL_RESPONSE','MODEL_TRUNCATED','MANUAL_FORMAT','MANUAL_EVIDENCE','MANUAL_LIMIT','MANUAL_SOURCE') then raise exception 'MANUAL_ERROR'; end if;
 e=(e-'lease'-'leaseUntil')||jsonb_build_object('status','failed','error',p_code,'updatedAt',clock_timestamp(),
 'nextAt',clock_timestamp()+make_interval(secs=>15*coalesce((e->>'attempts')::integer,1)));
 update public.private_mailboxes set manual_entries=jsonb_set(manual_entries,array[p_entry::text],e) where id=p_box;return e;
end; $$;

create or replace function public.private_mail_manual_update(p_box uuid,p_user uuid,p_entry uuid,p_item text,p_done boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; e jsonb; items jsonb; item jsonb; events jsonb; candidate jsonb; index_number integer; now_at timestamptz; d date;
begin
 select * into b from public.private_mailboxes where id=p_box for update;e=b.manual_entries->p_entry::text;
 now_at=clock_timestamp();d=(now_at at time zone 'Asia/Seoul')::date;
 if not public.private_mail_manual_allowed(p_box,p_user) or p_done is null or e->>'status' is distinct from 'ready'
 or p_item is null or p_item !~ '^item-[0-9]{3}$' then return null; end if;
 select ordinal-1,value into index_number,item from jsonb_array_elements(e->'items') with ordinality as found(value,ordinal) where value->>'itemId'=p_item;
 if item is null then return null; end if;
 if (item->>'done')::boolean=p_done then
  return jsonb_build_object('entryId',p_entry,'itemId',p_item,'done',p_done,'completedAt',item->'completedAt','reportDay',d);
 end if;
 events=coalesce(item->'completionEvents','[]'::jsonb);
 if jsonb_typeof(events) is distinct from 'array' then raise exception 'MANUAL_FORMAT'; end if;
 -- Preserve a legacy completion before the first reopening; new items always start with [].
 if jsonb_array_length(events)=0 and item->>'done'='true' and item->>'completedAt' is not null then
  events=jsonb_build_array(jsonb_build_object('done',true,'at',to_char((item->>'completedAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 end if;
 events=events||jsonb_build_array(jsonb_build_object('done',p_done,'at',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 -- No model regeneration or unrelated checkbox state is replaced by this atomic item edit.
 item=item||jsonb_build_object('done',p_done,'completedAt',case when p_done then now_at else null end,
 'completionEvents',events,'ownerUpdatedAt',now_at);
 items=jsonb_set(e->'items',array[index_number::text],item);
 e=e||jsonb_build_object('items',items,'updatedAt',now_at);
 candidate=jsonb_set(b.manual_entries,array[p_entry::text],e);
 if octet_length(candidate::text)>4194304 then raise exception 'MANUAL_LIMIT'; end if;
 update public.private_mailboxes set manual_entries=candidate where id=p_box;
 perform public.private_mail_manual_dirty(p_box,d);
 return jsonb_build_object('entryId',p_entry,'itemId',p_item,'done',p_done,'completedAt',item->'completedAt','reportDay',d);
end; $$;

-- View the state at the end of the selected Korean day, retaining completion/reopening history.
create or replace function public.private_mail_manual_item_state(p_item jsonb,p_day date)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare events jsonb; event jsonb; boundary timestamptz;
begin
 if p_day is null or jsonb_typeof(p_item) is distinct from 'object' then return null; end if;
 boundary=((p_day+1)::timestamp at time zone 'Asia/Seoul');
 events=coalesce(p_item->'completionEvents','[]'::jsonb);
 if jsonb_typeof(events) is distinct from 'array' then return null; end if;
 select value into event from jsonb_array_elements(events) with ordinality e(value,ordinal)
 where (value->>'at')::timestamptz<boundary order by (value->>'at')::timestamptz desc,ordinal desc limit 1;
 if event is not null then
  return jsonb_build_object('done',(event->>'done')::boolean,'completedAt',case when event->>'done'='true' then event->>'at' else null end);
 end if;
 if jsonb_array_length(events)=0 and p_item->>'done'='true' and (p_item->>'completedAt')::timestamptz<boundary then
  return jsonb_build_object('done',true,'completedAt',p_item->>'completedAt');
 end if;
 return jsonb_build_object('done',false,'completedAt',null);
end; $$;

create or replace function public.private_mail_manual_rollover(p_box uuid,p_day date)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; page jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 if p_day is null or not public.private_mail_manual_allowed(p_box,'2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid) then return false; end if;
 page=coalesce(b.briefing_pages->p_day::text,'{}'::jsonb);
 if page->>'manualRolloverDay'=p_day::text then return false; end if;
 if not exists(select 1 from jsonb_each(b.manual_entries) e,lateral jsonb_array_elements(e.value->'items') i
  where e.value->>'status'='ready' and ((e.value->>'submittedAt')::timestamptz at time zone 'Asia/Seoul')::date<=p_day
  and public.private_mail_manual_item_state(i,p_day)->>'done'='false') then return false; end if;
 page=page||jsonb_build_object('manualRolloverDay',p_day,'dirty',true,'revision',coalesce((page->>'revision')::integer,0)+1);
 update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[p_day::text],page) where id=p_box;
 return true;
end; $$;

-- Manual submission is explicit owner authorization for its report; it never starts POP collection.
create or replace function public.private_mail_report_allowed(p_box uuid,p_day date)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.private_mailboxes b join public.user_profiles p on p.id=b.owner_id and p.active
 where b.id=p_box and b.id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 and b.owner_id='2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid and b.enabled
 and ((public.private_mail_automation_allowed(b.id) and b.automation_config->>'analysisConsent'='true') or
 (jsonb_typeof(b.briefing_pages->p_day::text->'pageId')='string' and length(b.briefing_pages->p_day::text->>'pageId')>0) or
 exists(select 1 from public.private_mail_messages m where m.mailbox_id=b.id and m.owner_id=b.owner_id
 and m.report_day=p_day and m.analysis_manual_selected_at is not null and m.analysis_status='ready' and m.analysis is not null) or
 exists(select 1 from jsonb_each(b.manual_entries) e,lateral jsonb_array_elements(e.value->'items') i
 where e.value->>'status'='ready' and (e.value->>'submittedAt')::timestamptz at time zone 'Asia/Seoul'<(p_day+1)::timestamp
 and (public.private_mail_manual_item_state(i,p_day)->>'done'='false'
 or ((public.private_mail_manual_item_state(i,p_day)->>'completedAt')::timestamptz at time zone 'Asia/Seoul')::date>=p_day))));
$$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('private_mail_manual_allowed','private_mail_manual_claim','private_mail_manual_dirty',
 'private_mail_manual_finish','private_mail_manual_fail','private_mail_manual_update','private_mail_manual_item_state','private_mail_manual_rollover') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
 -- Preserve the existing report RPC's service-only execution boundary after replacement.
 revoke all on function public.private_mail_report_allowed(uuid,date) from public,anon,authenticated;
 grant execute on function public.private_mail_report_allowed(uuid,date) to service_role;
end $$;
-- Stable item references preserve owner checkboxes when analysis order changes.
create or replace function public.private_mail_item_override(p_box uuid,p_message uuid,p_ref text,p_done boolean,p_day date)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; m public.private_mail_messages; parts text[]; items jsonb; item jsonb; n integer; page jsonb; d text=p_day::text;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 select * into m from public.private_mail_messages where id=p_message and mailbox_id=p_box;
 if not public.private_mail_filter_allowed(p_box) or m.id is null or p_done is null or p_day is null
 or p_ref is null or length(p_ref)>128 then return false; end if;
 parts=string_to_array(p_ref,':');
 if cardinality(parts)<>3 or parts[1]<>p_message::text or parts[2] not in ('tasks','imageTasks')
 or parts[3] !~ '^(0|[1-9][0-9]{0,3})$' then return false; end if;
 n=parts[3]::integer;
 items=case parts[2] when 'tasks' then m.analysis->'tasks' else m.analysis->'imageItems'->'tasks' end;
 if jsonb_typeof(items) is distinct from 'array' then return false; end if;
 select value into item from jsonb_array_elements(items) with ordinality e(value,ordinal)
 where coalesce((value->>'itemIndex')::integer,ordinal::integer-1)=n;
 if not found then return false; end if;
 if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'text','')='' then return false; end if;
 -- Any retained source can appear on later daily pages; only persisted page days are accepted.
 if p_day<>m.report_day and not b.briefing_pages ? d then return false; end if;
 page=coalesce(b.briefing_pages->d,'{}'::jsonb)||jsonb_build_object('revision',coalesce((b.briefing_pages->d->>'revision')::integer,0)+1,'dirty',true);
 update public.private_mailboxes set briefing_overrides=jsonb_set(briefing_overrides,array[p_ref],jsonb_build_object('done',p_done,'updatedAt',clock_timestamp(),'actor','owner')),
 briefing_pages=jsonb_set(briefing_pages,array[d],page) where id=p_box;
 perform public.private_mail_dispatch(p_box);return true;
end; $$;

commit;
