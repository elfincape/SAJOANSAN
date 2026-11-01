-- Apply after private-mail-manual.sql and private-mail-history.sql. Advisory metadata only.
begin;
create or replace function public.private_mail_manual_jev_review(
 p_box uuid,p_user uuid,p_entry uuid,p_source_hash text,p_items jsonb,p_review jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; e jsonb; finding jsonb; review_id jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 if not public.private_mail_manual_allowed(p_box,p_user) then return false; end if;
 e=b.manual_entries->p_entry::text;
 if e->>'status' is distinct from 'ready' or e->>'entryId' is distinct from p_entry::text
 or e->>'textHash' is distinct from p_source_hash or p_source_hash is null
 or e->'items' is distinct from p_items or e ? 'jevReview' then return false; end if;
 if jsonb_typeof(p_review) is distinct from 'object' or octet_length(p_review::text)>16384
 or p_review->>'sourceId' is distinct from p_entry::text
 or coalesce(p_review->>'policyVersion','') not in ('manual-semantics-v1','manual-semantics-v2')
 or p_review->'sourceRevision' is distinct from 'null'::jsonb
 or coalesce(p_review->>'status','') not in ('unavailable','skipped','review','no_concerns')
 or exists(select 1 from jsonb_object_keys(p_review) k where k not in
 ('sourceId','sourceRevision','policyVersion','status','code','model','findings','reviewIds','latencyMs','usage','reviewedCount','omittedCount','coverageChecked','coverageUnavailable'))
 then raise exception 'JEV_REVIEW_FORMAT'; end if;
 -- Coverage is a v2-only advisory claim, never an unchecked success flag.
 if (p_review ? 'coverageChecked' and (p_review->>'policyVersion'<>'manual-semantics-v2'
  or jsonb_typeof(p_review->'coverageChecked') is distinct from 'boolean'))
 or (p_review ? 'coverageUnavailable' and (p_review->>'policyVersion'<>'manual-semantics-v2'
  or (p_review->'coverageUnavailable'<>'null'::jsonb and
   (jsonb_typeof(p_review->'coverageUnavailable') is distinct from 'string'
    or p_review->>'coverageUnavailable'<>'INPUT_TOO_LARGE'))))
 then raise exception 'JEV_REVIEW_FORMAT'; end if;
 if p_review ? 'model' and p_review->>'model' is distinct from 'jev-1.14.0' then raise exception 'JEV_REVIEW_FORMAT'; end if;
 if p_review ? 'code' and coalesce(p_review->>'code','') not in
 ('NOT_CONFIGURED','INVALID_INPUT','BODY_ONLY_REQUIRED','NO_REVIEW_NEEDED','INVALID_RESPONSE','RATE_LIMIT','AUTH','HTTP_FAILED','TIMEOUT','NETWORK','REVIEW_FAILED')
 then raise exception 'JEV_REVIEW_FORMAT'; end if;
 if p_review ? 'findings' then
  if jsonb_typeof(p_review->'findings') is distinct from 'array' or jsonb_array_length(p_review->'findings')>8 then raise exception 'JEV_REVIEW_FORMAT'; end if;
  for finding in select value from jsonb_array_elements(p_review->'findings') loop
   if jsonb_typeof(finding) is distinct from 'object' or
    exists(select 1 from jsonb_object_keys(finding) k where k not in ('id','unsupportedProbability'))
    or jsonb_typeof(finding->'id') is distinct from 'string'
    or jsonb_typeof(finding->'unsupportedProbability') is distinct from 'number'
    or (finding->>'unsupportedProbability')::numeric not between 0 and 1
    or not (exists(select 1 from jsonb_array_elements(p_items) i where finding->>'id'=p_entry::text||':manual:'||(i->>'itemId'))
     or (p_review->>'policyVersion'='manual-semantics-v2' and finding->>'id'=p_entry::text||':coverage'))
   then raise exception 'JEV_REVIEW_FORMAT'; end if;
  end loop;
 end if;
 if coalesce(p_review->'coverageChecked','false'::jsonb) is distinct from to_jsonb(exists(
  select 1 from jsonb_array_elements(coalesce(p_review->'findings','[]'::jsonb)) f
  where f->>'id'=p_entry::text||':coverage'))
 or (p_review->>'coverageUnavailable'='INPUT_TOO_LARGE' and p_review->'coverageChecked'='true'::jsonb)
 then raise exception 'JEV_REVIEW_FORMAT'; end if;
 if p_review ? 'reviewIds' then
  if jsonb_typeof(p_review->'reviewIds') is distinct from 'array' or jsonb_array_length(p_review->'reviewIds')>8 then raise exception 'JEV_REVIEW_FORMAT'; end if;
  for review_id in select value from jsonb_array_elements(p_review->'reviewIds') loop
   if jsonb_typeof(review_id) is distinct from 'string' or not exists(
    select 1 from jsonb_array_elements(coalesce(p_review->'findings','[]'::jsonb)) f where f->'id'=review_id)
   then raise exception 'JEV_REVIEW_FORMAT'; end if;
  end loop;
 end if;
 if exists(select 1 from jsonb_each(p_review) v where v.key in ('latencyMs','reviewedCount','omittedCount')
  and case when jsonb_typeof(v.value)='number' and v.value::text ~ '^[0-9]+$' then v.value::text::numeric>9007199254740991 else true end)
 then raise exception 'JEV_REVIEW_FORMAT'; end if;
 if p_review ? 'usage' then
  if jsonb_typeof(p_review->'usage') is distinct from 'object' then raise exception 'JEV_REVIEW_FORMAT'; end if;
  if exists(select 1 from jsonb_each(p_review->'usage') u where u.key not in ('inputTokens','outputTokens') or
   case when u.value='null'::jsonb then false when jsonb_typeof(u.value)='number' and u.value::text ~ '^[0-9]+$'
    then u.value::text::numeric>9007199254740991 else true end) then raise exception 'JEV_REVIEW_FORMAT'; end if;
 end if;
 update public.private_mailboxes set manual_entries=jsonb_set(manual_entries,array[p_entry::text,'jevReview'],p_review) where id=p_box;
 return true;
end; $$;
revoke all on function public.private_mail_manual_jev_review(uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.private_mail_manual_jev_review(uuid,uuid,uuid,text,jsonb,jsonb) to service_role;

-- Keep normalized manual review metadata in subsequent immutable history versions.
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
revoke all on function public.private_mail_history_capture_manual(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.private_mail_history_capture_manual(uuid,jsonb) to service_role;
commit;
