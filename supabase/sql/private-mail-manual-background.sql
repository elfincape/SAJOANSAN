-- Persist manual input before asynchronous analysis; reuse scoped analyze capabilities.
begin;
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
 if attempts>=3 and e->>'status'='processing' and coalesce((e->>'leaseUntil')::timestamptz,'-infinity')<=received then
  e=(e-'lease'-'leaseUntil')||jsonb_build_object('status','failed','error','RETRY_LIMIT','nextAt',received,'updatedAt',received);
  entries=jsonb_set(entries,array[entry_id::text],e);
  update public.private_mailboxes set manual_entries=entries where id=p_box;
 end if;
 -- Only an explicit owner retry can begin another batch after a confirmed terminal failure.
 if attempts>=3 and coalesce(p_retry,false) and e->>'status'='failed'
 and e->>'lease' is null and e->>'leaseUntil' is null
 and (e->>'nextAt')::timestamptz<=received then attempts=0; end if;
 if attempts>=3 then return jsonb_build_object('entry',e||jsonb_build_object('status','failed','error','RETRY_LIMIT'),'claimed',false); end if;
 e=e||jsonb_build_object('status','processing','lease',p_lease,'leaseUntil',received+interval '4 minutes',
 'attempts',attempts+1,'error',null,'updatedAt',received);
 candidate=jsonb_set(entries,array[entry_id::text],e);
 if octet_length(candidate::text)>4194304 then raise exception 'MANUAL_LIMIT'; end if;
 update public.private_mailboxes set manual_entries=candidate where id=p_box;
 return jsonb_build_object('entry',e,'claimed',true);
end; $$;

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
create or replace function public.private_mail_manual_enqueue(p_box uuid,p_user uuid,p_request uuid,p_text text,p_hash text,p_reference date default null,p_retry boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; e jsonb; work_lease uuid=gen_random_uuid(); queued boolean=false;
begin
 result=public.private_mail_manual_claim(p_box,p_user,p_request,p_text,p_hash,p_reference,work_lease,p_retry);
 e=result->'entry';
 if result->>'claimed'='true' then
  e=(e-'lease'-'leaseUntil'-'nextAt')||jsonb_build_object('status','pending','attempts',greatest(0,coalesce((e->>'attempts')::integer,1)-1),'error',null);
  update public.private_mailboxes set manual_entries=jsonb_set(manual_entries,array[e->>'entryId'],e) where id=p_box;
 end if;
 if e->>'status' in ('pending','processing','failed') then
  queued=public.private_mail_dispatch_core(p_box,null::date,(e->>'entryId')::uuid,false);
 end if;
 return jsonb_build_object('entry',e,'queued',queued);
end; $$;
revoke all on function public.private_mail_manual_enqueue(uuid,uuid,uuid,text,text,date,boolean) from public,anon,authenticated;
grant execute on function public.private_mail_manual_enqueue(uuid,uuid,uuid,text,text,date,boolean) to service_role;

-- Bind a selected work context atomically before the existing background dispatch can run.
create or replace function public.private_mail_manual_target_enqueue(p_box uuid,p_user uuid,p_request uuid,p_text text,p_hash text,p_reference date,p_retry boolean,p_target text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; prior jsonb; result jsonb; e jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 if not public.private_mail_manual_allowed(p_box,p_user) or p_target is null or length(p_target)>160 then raise exception 'MANUAL_SOURCE'; end if;
 select value into prior from jsonb_each(b.manual_entries) where value->>'clientRequestId'=p_request::text or coalesce(value->'requestIds','[]') ? p_request::text or (value->>'textHash'=p_hash and ((value->>'submittedAt')::timestamptz at time zone 'Asia/Seoul')::date=(clock_timestamp() at time zone 'Asia/Seoul')::date) limit 1;
 if prior is not null and prior->>'targetWorkId' is distinct from p_target then raise exception 'MANUAL_TARGET_CONFLICT'; end if;
 result=public.private_mail_manual_enqueue(p_box,p_user,p_request,p_text,p_hash,p_reference,p_retry);
 e=result->'entry';
 if e->>'targetWorkId' is not null and e->>'targetWorkId'<>p_target then raise exception 'MANUAL_TARGET_CONFLICT'; end if;
 e=e||jsonb_build_object('targetWorkId',p_target);
 update public.private_mailboxes set manual_entries=jsonb_set(manual_entries,array[e->>'entryId'],e) where id=p_box;
 return result||jsonb_build_object('entry',e);
end; $$;
revoke all on function public.private_mail_manual_target_enqueue(uuid,uuid,uuid,text,text,date,boolean,text) from public,anon,authenticated;
grant execute on function public.private_mail_manual_target_enqueue(uuid,uuid,uuid,text,text,date,boolean,text) to service_role;

-- Manual photo originals stay in the existing private OneDrive folder. Metadata only.
create or replace function public.private_mail_manual_photo_submit(p_box uuid,p_user uuid,p_request uuid,p_text text,p_hash text,p_reference date,p_lease uuid,p_retry boolean,p_images jsonb,p_consent boolean,p_target text,p_enqueue boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; e jsonb; candidate jsonb; entries jsonb; entry_id uuid;
 received timestamptz=clock_timestamp(); d date; attempts integer;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 if not public.private_mail_manual_allowed(p_box,p_user) then raise exception 'MANUAL_SCOPE'; end if;
 if p_request is null or p_lease is null or p_text is null or length(btrim(p_text)) not between 0 and 12000
 or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'MANUAL_INPUT_INVALID'; end if;
 if p_consent is distinct from true or jsonb_typeof(p_images) is distinct from 'array'
 or jsonb_array_length(p_images) not between 1 and 3 or octet_length(p_images::text)>24000 then raise exception 'IMAGE_MANIFEST'; end if;
 if exists(select 1 from jsonb_array_elements(p_images) i where
   coalesce(i->>'contentHash','') !~ '^[0-9a-f]{64}$' or coalesce(i->>'mediaType','') not in ('image/jpeg','image/png')
   or coalesce((i->>'byteLength')::integer,0) not between 1 and (case when i->>'derivation'='pending' then 6000000 else 2100000 end)
   or (i->>'width')::bigint*(i->>'height')::bigint>13000000
   or coalesce((i->>'width')::integer,0) not between 1 and 8000 or coalesce((i->>'height')::integer,0) not between 1 and 8000
   or length(coalesce(i->>'name','')) not between 1 and 300 or i ? 'bytes' or i ? 'data'
   or jsonb_typeof(i->'file') is distinct from 'object'
   or length(coalesce(i->'file'->>'item_id','')) not between 1 and 512
   or (i->'file'->>'byte_size')::integer is distinct from (i->>'byteLength')::integer
   or i->'file'->>'file_name' is distinct from 'manual_'||(i->>'contentHash')||'.bin'
   or i->'file'->>'content_hash' is distinct from rtrim(translate(encode(decode(i->>'contentHash','hex'),'base64'),'+/','-_'),'='))
 or (select sum((photo->>'byteLength')::integer) from jsonb_array_elements(p_images) photo)>(case when exists(select 1 from jsonb_array_elements(p_images) x where x->>'derivation'='pending') then 8000000 else 3000000 end)
 or (select count(distinct coalesce(i->'original'->>'contentHash',i->>'contentHash')) from jsonb_array_elements(p_images) i)<>jsonb_array_length(p_images)
 then raise exception 'IMAGE_MANIFEST'; end if;
 if exists(select 1 from jsonb_array_elements(p_images) i where i ? 'original' and (
   coalesce(i->>'derivation','') not in ('imagescript-3.13.1-v1','identity-v1') or coalesce(i->'original'->>'contentHash','') !~ '^[0-9a-f]{64}$'
   or coalesce(i->'original'->>'mediaType','') not in ('image/jpeg','image/png')
   or coalesce((i->'original'->>'byteLength')::integer,0) not between 1 and 6000000
   or coalesce((i->'original'->>'width')::integer,0) not between 1 and 8000
   or coalesce((i->'original'->>'height')::integer,0) not between 1 and 8000
   or (i->'original'->>'width')::bigint*(i->'original'->>'height')::bigint>13000000
   or i->'original' ? 'bytes' or i->'original' ? 'data'
   or length(coalesce(i->'original'->'file'->>'item_id','')) not between 1 and 512
   or i->'original'->'file'->>'file_name' is distinct from 'manual_'||(i->'original'->>'contentHash')||'.bin'
   or (i->'original'->'file'->>'byte_size')::integer is distinct from (i->'original'->>'byteLength')::integer
   or i->'original'->'file'->>'content_hash' is distinct from rtrim(translate(encode(decode(i->'original'->>'contentHash','hex'),'base64'),'+/','-_'),'=')))
 or (select sum(coalesce((i->'original'->>'byteLength')::integer,(i->>'byteLength')::integer)) from jsonb_array_elements(p_images) i)>8000000
 then raise exception 'IMAGE_MANIFEST'; end if;
 if (select sum(coalesce((i->'original'->>'width')::bigint*(i->'original'->>'height')::bigint,(i->>'width')::bigint*(i->>'height')::bigint)) from jsonb_array_elements(p_images) i)>16000000 then raise exception 'IMAGE_DIMENSIONS'; end if;
 if p_target is not null and length(p_target)>160 then raise exception 'MANUAL_SOURCE'; end if;
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
 if e is not null and (e->>'targetWorkId' is distinct from p_target or e->>'privacyConfirmed' is distinct from 'true') then raise exception 'MANUAL_REQUEST_CONFLICT'; end if;
 if e is null then
  if (select count(*) from jsonb_each(entries))>=500 then raise exception 'MANUAL_LIMIT'; end if;
  entry_id=gen_random_uuid();
  e=jsonb_build_object('entryId',entry_id,'clientRequestId',p_request,'requestIds',jsonb_build_array(p_request),
   'requestReferences',jsonb_build_object(p_request::text,p_reference),'text',btrim(p_text),'textHash',p_hash,
   'submittedAt',received,'referenceDate',coalesce(p_reference,d),'requestedReference',p_reference,
   'referenceSource',case when p_reference is null then 'received' else 'owner' end,
   'images',(select jsonb_agg(i||jsonb_build_object('id',entry_id::text||':'||(n-1)::text)) from jsonb_array_elements(p_images) with ordinality a(i,n)),
   'privacyConfirmed',true,'targetWorkId',p_target,'status','pending','attempts',0,'items','[]'::jsonb,'authoredDate',null,'error',null);
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
 if attempts>=3 and e->>'status'='processing' and coalesce((e->>'leaseUntil')::timestamptz,'-infinity')<=received then
  e=(e-'lease'-'leaseUntil')||jsonb_build_object('status','failed','error','RETRY_LIMIT','nextAt',received,'updatedAt',received);
  entries=jsonb_set(entries,array[entry_id::text],e);
  update public.private_mailboxes set manual_entries=entries where id=p_box;
 end if;
 -- Only an explicit owner retry can begin another batch after a confirmed terminal failure.
 if attempts>=3 and coalesce(p_retry,false) and e->>'status'='failed'
 and e->>'lease' is null and e->>'leaseUntil' is null
 and (e->>'nextAt')::timestamptz<=received then attempts=0; end if;
 if attempts>=3 then return jsonb_build_object('entry',e||jsonb_build_object('status','failed','error','RETRY_LIMIT'),'claimed',false); end if;
 e=e||jsonb_build_object('status','processing','lease',p_lease,'leaseUntil',received+interval '4 minutes',
 'attempts',attempts+1,'error',null,'updatedAt',received);
 candidate=jsonb_set(entries,array[entry_id::text],e);
 if octet_length(candidate::text)>4194304 then raise exception 'MANUAL_LIMIT'; end if;
 update public.private_mailboxes set manual_entries=candidate where id=p_box;
 if p_enqueue then
  e=(e-'lease'-'leaseUntil')||jsonb_build_object('status','pending','attempts',attempts);
  update public.private_mailboxes set manual_entries=jsonb_set(manual_entries,array[entry_id::text],e) where id=p_box;
  perform public.private_mail_dispatch_core(p_box,null::date,entry_id,false);
 end if;
 return jsonb_build_object('entry',e,'claimed',not p_enqueue);
end; $$;

revoke all on function public.private_mail_manual_photo_submit(uuid,uuid,uuid,text,text,date,uuid,boolean,jsonb,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.private_mail_manual_photo_submit(uuid,uuid,uuid,text,text,date,uuid,boolean,jsonb,boolean,text,boolean) to service_role;

create or replace function public.private_mail_manual_photo_finish(p_box uuid,p_user uuid,p_entry uuid,p_lease uuid,p_items jsonb,p_authored date default null,p_inference jsonb default '{}')
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
  or (case when item->>'evidenceSource'='image' then
   not exists(select 1 from jsonb_array_elements(e->'images') image where image->>'id'=item->>'imageId' and image->>'contentHash'=item->>'imageContentHash')
   or item->>'resolution' is distinct from 'manual_image_verified_v1'
   or coalesce(item->>'workflowStatus','') not in ('pending','in_progress','complete')
   or (item->>'workflowStatus'='complete' and (
     item->'needsConfirmation' is distinct from 'false'::jsonb
     or item->'imageVerification'->>'accepted' is distinct from 'true'
     or item->'imageVerification'->>'currentResult' is distinct from 'true'
     or item->'imageVerification'->>'allObligationsComplete' is distinct from 'true'
     or item->'imageVerification'->>'actor' is distinct from 'owner'
     or coalesce(jsonb_array_length(item->'remainingSteps'),-1)<>0
     or length(coalesce(item->>'completionEvidence',''))=0
     or (item->>'workRef' is null and (item->'imageVerification'->>'requestConfirmed' is distinct from 'true' or length(coalesce(item->>'requestEvidence',''))=0))
     or (item->>'workRef' is not null and item->'imageVerification'->>'sameTarget' is distinct from 'true')))
   else source_text is null or position((item->>'evidence') in source_text)=0 end)
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

revoke all on function public.private_mail_manual_photo_finish(uuid,uuid,uuid,uuid,jsonb,date,jsonb) from public,anon,authenticated;
grant execute on function public.private_mail_manual_photo_finish(uuid,uuid,uuid,uuid,jsonb,date,jsonb) to service_role;

-- Fence derived metadata to the worker lease and the exact stored original descriptors.
create or replace function public.private_mail_manual_photo_prepare(p_box uuid,p_user uuid,p_entry uuid,p_lease uuid,p_images jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; e jsonb; i jsonb; old jsonb; n integer=0; candidate jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;e=b.manual_entries->p_entry::text;
 if not public.private_mail_manual_allowed(p_box,p_user) or e is null or p_lease is null
 or e->>'status' is distinct from 'processing' or e->>'lease' is distinct from p_lease::text
 or (e->>'leaseUntil')::timestamptz is null or (e->>'leaseUntil')::timestamptz<=clock_timestamp() then return null; end if;
 if jsonb_typeof(p_images) is distinct from 'array' or jsonb_array_length(p_images)<>jsonb_array_length(e->'images')
 or jsonb_array_length(p_images) not between 1 and 3 or octet_length(p_images::text)>24000 then raise exception 'IMAGE_MANIFEST'; end if;
 for i in select value from jsonb_array_elements(p_images) loop
  old=e->'images'->n;n=n+1;
  if old->>'derivation' is distinct from 'pending' then
   if i is distinct from old then raise exception 'IMAGE_MANIFEST'; end if;
   continue;
  end if;
  if i->'original' is distinct from old or i->>'id' is distinct from old->>'id'
  or coalesce(i->>'derivation','') not in ('imagescript-3.13.1-v1','identity-v1')
  or coalesce(i->>'contentHash','') !~ '^[0-9a-f]{64}$' or coalesce(i->>'mediaType','') not in ('image/jpeg','image/png')
  or coalesce((i->>'byteLength')::integer,0) not between 1 and 1000000
  or coalesce((i->>'width')::integer,0) not between 1 and 8000 or coalesce((i->>'height')::integer,0) not between 1 and 8000
  or (i->>'width')::bigint*(i->>'height')::bigint>13000000
  or i ? 'bytes' or i ? 'data' or jsonb_typeof(i->'file') is distinct from 'object'
  or length(coalesce(i->'file'->>'item_id','')) not between 1 and 512
  or (i->'file'->>'byte_size')::integer is distinct from (i->>'byteLength')::integer
  or i->'file'->>'file_name' is distinct from 'manual_'||(i->>'contentHash')||'.bin'
  or i->'file'->>'content_hash' is distinct from rtrim(translate(encode(decode(i->>'contentHash','hex'),'base64'),'+/','-_'),'=')
  then raise exception 'IMAGE_MANIFEST'; end if;
 end loop;
 if (select sum((photo->>'byteLength')::integer) from jsonb_array_elements(p_images) photo)>3000000 then raise exception 'IMAGE_LIMIT'; end if;
 e=e||jsonb_build_object('images',p_images,'updatedAt',clock_timestamp());
 candidate=jsonb_set(b.manual_entries,array[p_entry::text],e);
 if octet_length(candidate::text)>4194304 then raise exception 'MANUAL_LIMIT'; end if;
 update public.private_mailboxes set manual_entries=candidate where id=p_box;
 return e;
end; $$;
revoke all on function public.private_mail_manual_photo_prepare(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.private_mail_manual_photo_prepare(uuid,uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.private_mail_manual_fail(p_box uuid,p_user uuid,p_entry uuid,p_lease uuid,p_code text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; e jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;e=b.manual_entries->p_entry::text;
 if not public.private_mail_manual_allowed(p_box,p_user) or e is null or p_lease is null
 or e->>'status' is distinct from 'processing' or e->>'lease' is distinct from p_lease::text
 or (e->>'leaseUntil')::timestamptz is null or (e->>'leaseUntil')::timestamptz<=clock_timestamp() then return null; end if;
 if p_code is null or p_code not in ('AI_NOT_CONFIGURED','RATE_LIMITED','MODEL_FAILED','MODEL_RESPONSE','MODEL_TRUNCATED','MANUAL_FORMAT','MANUAL_EVIDENCE','MANUAL_LIMIT','MANUAL_SOURCE',
 'IMAGE_FORMAT','IMAGE_MANIFEST','IMAGE_PREPARE_FAILED','IMAGE_WORKER_REQUIRED','IMAGE_DIMENSIONS','IMAGE_LIMIT','IMAGE_EVIDENCE','IMAGE_PRIVACY_REVIEW','NOTES_IMAGE_SOURCE') then raise exception 'MANUAL_ERROR'; end if;
 e=(e-'lease'-'leaseUntil')||jsonb_build_object('status','failed','error',p_code,'updatedAt',clock_timestamp(),
 'nextAt',clock_timestamp()+make_interval(secs=>15*coalesce((e->>'attempts')::integer,1)));
 update public.private_mailboxes set manual_entries=jsonb_set(manual_entries,array[p_entry::text],e) where id=p_box;return e;
end; $$;
revoke all on function public.private_mail_manual_fail(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.private_mail_manual_fail(uuid,uuid,uuid,uuid,text) to service_role;

commit;
