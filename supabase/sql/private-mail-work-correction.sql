-- Additive owner-only correction RPC; reuse existing state and immutable history.
begin;
create or replace function public.private_mail_work_correct(p_box uuid,p_user uuid,p_work text,p_day date,p_patch jsonb,p_expected text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; m public.private_mail_messages; parts text[]; source_id uuid;
 source_kind text='mail'; candidate jsonb; old jsonb; revised jsonb; payload text; record jsonb;
 now_at timestamptz=clock_timestamp(); day_key text; n integer; valid_source boolean=false;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 if b.id is distinct from '39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 or p_user is distinct from '2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid or b.owner_id is distinct from p_user
 or not b.enabled or not exists(select 1 from public.user_profiles where id=p_user and active)
 then raise exception 'WORK_CORRECTION_OWNER'; end if;
 if p_work is null or length(p_work)>160 or p_day is null or p_day>(now_at at time zone 'Asia/Seoul')::date
 or jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text)>16384
 or p_patch='{}'::jsonb or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('category','excluded','reason','done','activity'))
 or (p_patch ? 'activity' and (jsonb_typeof(p_patch->'activity') is distinct from 'object' or coalesce(p_patch->'activity'->>'id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' or jsonb_typeof(p_patch->'activity'->'text') is distinct from 'string' or length(btrim(p_patch->'activity'->>'text')) not between 1 and 3000 or exists(select 1 from jsonb_object_keys(p_patch->'activity') k where k not in ('id','text'))))
 or (p_patch ? 'category' and p_patch->'category'<>'null'::jsonb and coalesce(p_patch->>'category','') not in ('task','reference','routine','issue','review'))
 or (p_patch ? 'excluded' and jsonb_typeof(p_patch->'excluded')<>'boolean')
 or (p_patch ? 'done' and p_patch->'done'<>'null'::jsonb and jsonb_typeof(p_patch->'done')<>'boolean')
 or (p_patch ? 'reason' and p_patch->'reason'<>'null'::jsonb and coalesce(p_patch->>'reason','') not in ('spam','manual'))
 then raise exception 'WORK_CORRECTION_INVALID'; end if;
 parts=string_to_array(p_work,':');
 if parts[1]='source' and cardinality(parts)=2 then
  begin source_id=parts[2]::uuid; exception when others then raise exception 'WORK_CORRECTION_SOURCE'; end;
  select * into m from public.private_mail_messages where id=source_id and mailbox_id=p_box and owner_id=p_user and analysis is not null;
  valid_source=found;
 elsif cardinality(parts)=3 then
  begin source_id=parts[1]::uuid; exception when others then raise exception 'WORK_CORRECTION_SOURCE'; end;
  if parts[2]='manual' then
   source_kind='manual';
   select item into candidate from jsonb_array_elements(coalesce(b.manual_entries->source_id::text->'items','[]')) item
    where item->>'itemId'=parts[3] limit 1;
   valid_source=found and b.manual_entries->source_id::text->>'status'='ready';
  elsif parts[2] in ('tasks','issues','waiting','imageTasks','imageIssues','imageWaiting') and parts[3] ~ '^(0|[1-9][0-9]{0,3})$' then
   select * into m from public.private_mail_messages where id=source_id and mailbox_id=p_box and owner_id=p_user and analysis is not null;
   if found then
    select item into candidate from jsonb_array_elements(coalesce(case when left(parts[2],5)='image' then
     m.analysis->'imageItems'->(lower(substring(parts[2] from 6 for 1))||substring(parts[2] from 7)) else m.analysis->parts[2] end,'[]')) with ordinality e(item,ordinal)
     where coalesce((item->>'itemIndex')::integer,ordinal::integer-1)=parts[3]::integer limit 1;
    valid_source=found;
   end if;
  end if;
 end if;
 if not coalesce(valid_source,false) then raise exception 'WORK_CORRECTION_SOURCE'; end if;
 old=coalesce(b.briefing_overrides->('work:'||p_work),'{}');
 if p_patch ? 'activity' then
  select value into candidate from jsonb_array_elements(coalesce(old->'processingNotes','[]')) where value->>'id'=p_patch->'activity'->>'id';
  if found then
   if candidate->>'text' is distinct from p_patch->'activity'->>'text' or candidate->'requestedDone' is distinct from coalesce(p_patch->'done','null'::jsonb) then raise exception 'WORK_CORRECTION_CONFLICT'; end if;
   return jsonb_build_object('saved',true,'workId',p_work,'correction',old);
  end if;
  if jsonb_array_length(coalesce(old->'processingNotes','[]'))>=200 then raise exception 'WORK_ACTIVITY_LIMIT'; end if;
 end if;
 if (old-'actor'-'updatedAt'-'revision'-'events'-'doneAt') @> p_patch then return jsonb_build_object('saved',true,'workId',p_work,'correction',old); end if;
 if coalesce(old->>'updatedAt','') is distinct from coalesce(p_expected,'') then raise exception 'WORK_CORRECTION_CONFLICT'; end if;
 revised=old||(p_patch-'activity')||jsonb_build_object('actor','owner','updatedAt',now_at,'revision',coalesce((old->>'revision')::integer,0)+1);
 if p_patch ? 'activity' then
  revised=revised||jsonb_build_object('processingNotes',coalesce(old->'processingNotes','[]')||jsonb_build_array(p_patch->'activity'||jsonb_build_object('at',now_at,'requestedDone',coalesce(p_patch->'done','null'::jsonb))));
 end if;
 if p_patch ? 'done' and p_patch->'done' is distinct from old->'done' then
  revised=revised||jsonb_build_object('doneAt',case when jsonb_typeof(p_patch->'done')='boolean' then to_jsonb(now_at) else 'null'::jsonb end);
 end if;
 if revised->'excluded'='false'::jsonb then revised=revised||'{"reason":null}'::jsonb; end if;
 if revised->>'reason'='spam' and revised->'excluded' is distinct from 'true'::jsonb then raise exception 'WORK_CORRECTION_INVALID'; end if;
 revised=revised||jsonb_build_object('events',coalesce(old->'events',case when old='{}'::jsonb then '[]'::jsonb else jsonb_build_array(old) end)||jsonb_build_array(revised-'events'-'processingNotes'));
 update public.private_mailboxes set briefing_overrides=jsonb_set(briefing_overrides,array['work:'||p_work],revised) where id=p_box;
 -- Dirty only relevant existing days and the viewed day; never release a held page.
 for day_key in select key from jsonb_each(b.briefing_pages) where key>=p_day::text and key<=(now_at at time zone 'Asia/Seoul')::date::text
  union select p_day::text loop
  if coalesce((b.briefing_pages->day_key->>'ownerPreviewHold')::boolean,false)=false then
   perform public.private_mail_manual_dirty(p_box,day_key::date);
  end if;
 end loop;
 record=jsonb_build_object('schema','sajoansan-mail-history-v1','ownerId',p_user,'mailboxId',p_box,
  'source',jsonb_build_object('kind',source_kind,'id',source_id),'revision',(revised->>'revision')::integer,
  'eventAt',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'model',null,'rulesVersion','owner-work-correction-v1',
  'structuredResult',jsonb_build_object('workId',p_work,'ownerCorrection',revised),
  'correction',jsonb_build_object('previous',old,'current',revised),'completionEvents','[]'::jsonb);
 payload=record::text;
 perform public.private_mail_history_enqueue(encode(sha256(convert_to(payload,'UTF8')),'hex'),payload);
 perform public.private_mail_dispatch_report(p_box,p_day);
 return jsonb_build_object('saved',true,'workId',p_work,'correction',revised);
end; $$;
revoke all on function public.private_mail_work_correct(uuid,uuid,text,date,jsonb,text) from public,anon,authenticated;
grant execute on function public.private_mail_work_correct(uuid,uuid,text,date,jsonb,text) to service_role;
commit;
