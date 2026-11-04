-- Bounded model-call metadata only; claim resets isolate processing attempts.
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
 e=(e-'callProgress')||jsonb_build_object('status','processing','lease',p_lease,'leaseUntil',received+interval '4 minutes',
 'attempts',attempts+1,'error',null,'updatedAt',received);
 candidate=jsonb_set(entries,array[entry_id::text],e);
 if octet_length(candidate::text)>4194304 then raise exception 'MANUAL_LIMIT'; end if;
 update public.private_mailboxes set manual_entries=candidate where id=p_box;
 return jsonb_build_object('entry',e,'claimed',true);
end; $$;

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
 e=(e-'callProgress')||jsonb_build_object('status','processing','lease',p_lease,'leaseUntil',received+interval '4 minutes',
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

create or replace function public.private_mail_manual_call_progress(p_box uuid,p_user uuid,p_entry uuid,p_lease uuid,p_revision integer,p_calls jsonb,p_finished boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; e jsonb; progress jsonb; call_value jsonb; candidate jsonb; call_id integer; previous_id integer=0; started timestamptz; finished timestamptz;
begin
 if p_entry is null or p_lease is null or p_revision is null or p_revision<1 or p_finished is null
 or jsonb_typeof(p_calls) is distinct from 'array' then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end if;
 if jsonb_array_length(p_calls)>24 or octet_length(p_calls::text)>12288 then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end if;
 for call_value in select value from jsonb_array_elements(p_calls) loop
  if jsonb_typeof(call_value) is distinct from 'object' then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end if;
  if not (call_value ?& array['id','kind','status','startedAt','finishedAt','code'])
  or exists(select 1 from jsonb_object_keys(call_value) k where k not in ('id','kind','status','startedAt','finishedAt','code'))
  or jsonb_typeof(call_value->'id') is distinct from 'number' or (call_value->>'id') !~ '^[0-9]{1,3}$'
  or coalesce(call_value->>'kind','') not in ('jev','api')
  or coalesce(call_value->>'status','') not in ('started','completed','failed','skipped') then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end if;
  call_id=(call_value->>'id')::integer;
  if call_id<1 or call_id>256 or call_id<=previous_id then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end if;
  previous_id=call_id;
  if call_value->'code'<>'null'::jsonb and (jsonb_typeof(call_value->'code') is distinct from 'string'
   or call_value->>'code' not in ('NOT_CONFIGURED','INVALID_INPUT','INVALID_RESPONSE','RATE_LIMIT','RATE_LIMITED','AUTH','HTTP_FAILED','TIMEOUT','NETWORK','MODEL_FAILED','MODEL_RESPONSE','MODEL_TRUNCATED','MODEL_REFUSAL','AI_NOT_CONFIGURED','AI_MODEL_UNSUPPORTED','UNKNOWN')) then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end if;
  started=null;finished=null;
  if call_value->'startedAt'<>'null'::jsonb then
   if jsonb_typeof(call_value->'startedAt') is distinct from 'string' or (call_value->>'startedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end if;
   begin started=(call_value->>'startedAt')::timestamptz; exception when others then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end;
  end if;
  if call_value->'finishedAt'<>'null'::jsonb then
   if jsonb_typeof(call_value->'finishedAt') is distinct from 'string' or (call_value->>'finishedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end if;
   begin finished=(call_value->>'finishedAt')::timestamptz; exception when others then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end;
  end if;
  if (call_value->>'status'='skipped' and (started is not null or finished is null))
  or (call_value->>'status'<>'skipped' and started is null)
  or (call_value->>'status'='started' and finished is not null)
  or (call_value->>'status' in ('completed','failed') and finished is null)
  or (finished is not null and started is not null and finished<started) then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end if;
 end loop;
 select * into b from public.private_mailboxes where id=p_box for update;
 if not coalesce(public.private_mail_manual_allowed(p_box,p_user),false) then return false; end if;
 e=b.manual_entries->p_entry::text;progress=e->'callProgress';
 if e is null or coalesce(progress->>'finished','false')='true' then return false; end if;
 if e->>'status'='processing' then
  if e->>'lease' is distinct from p_lease::text or e->>'leaseUntil' is null
   or (e->>'leaseUntil')::timestamptz<=clock_timestamp() then return false; end if;
  if progress is not null and progress->>'runId' is distinct from p_lease::text then return false; end if;
 elsif e->>'status'='ready' then
  if progress->>'runId' is distinct from p_lease::text then return false; end if;
 else return false;
 end if;
 if p_revision<=coalesce((progress->>'revision')::integer,0) then return false; end if;
 progress=jsonb_build_object('runId',p_lease,'revision',p_revision,'calls',p_calls,'finished',p_finished,'updatedAt',clock_timestamp());
 if octet_length(progress::text)>12288 then raise exception 'MANUAL_CALL_PROGRESS_FORMAT'; end if;
 candidate=jsonb_set(b.manual_entries,array[p_entry::text],e||jsonb_build_object('callProgress',progress));
 if octet_length(candidate::text)>4194304 then raise exception 'MANUAL_LIMIT'; end if;
 update public.private_mailboxes set manual_entries=candidate where id=p_box;
 return true;
end; $$;
revoke all on function public.private_mail_manual_call_progress(uuid,uuid,uuid,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.private_mail_manual_call_progress(uuid,uuid,uuid,uuid,integer,jsonb,boolean) to service_role;
commit;
