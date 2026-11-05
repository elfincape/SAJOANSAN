-- Explicit scope is bound before the existing queue transaction commits.
-- Existing receipts are not backfilled or reclassified.
begin;

create or replace function public.private_mail_manual_scoped_submit(
 p_box uuid,p_user uuid,p_request uuid,p_text text,p_hash text,p_reference date,
 p_lease uuid,p_retry boolean,p_images jsonb,p_consent boolean,p_target text,
 p_enqueue boolean,p_scope jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; prior jsonb; result jsonb; e jsonb; entries jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 if not coalesce(public.private_mail_manual_allowed(p_box,p_user),false) then raise exception 'MANUAL_SCOPE'; end if;
 if p_request is null or p_lease is null or p_enqueue is null or p_retry is null
 or jsonb_typeof(p_scope) is distinct from 'object'
 or not(p_scope ?& array['kind','centerCode','workCategory'])
 or p_scope-array['kind','centerCode','workCategory']<>'{}'::jsonb
 then raise exception 'MANUAL_SCOPE'; end if;
 if p_scope->>'kind'='center' then
  if jsonb_typeof(p_scope->'centerCode') is distinct from 'string'
  or p_scope->'workCategory' is distinct from '"업무"'::jsonb
  or not exists(select 1 from public.centers c where c.code=p_scope->>'centerCode' and c.active)
  then raise exception 'MANUAL_SCOPE'; end if;
 elsif p_scope->>'kind'='delivery_team' then
  if p_scope->'centerCode' is distinct from 'null'::jsonb
  or p_scope->'workCategory' is distinct from 'null'::jsonb then raise exception 'MANUAL_SCOPE'; end if;
 else raise exception 'MANUAL_SCOPE'; end if;
 if jsonb_typeof(p_images) is distinct from 'array' then raise exception 'IMAGE_MANIFEST'; end if;
 if p_target is not null and length(btrim(p_target)) not between 1 and 160 then raise exception 'MANUAL_SOURCE'; end if;

 select value into prior from jsonb_each(b.manual_entries)
 where value->>'clientRequestId'=p_request::text or coalesce(value->'requestIds','[]'::jsonb) ? p_request::text limit 1;
 -- A legacy unscoped receipt cannot acquire a new sharing scope through replay.
 if prior is not null and prior->'workScope' is distinct from p_scope then raise exception 'MANUAL_REQUEST_CONFLICT'; end if;
 if prior is not null and prior->>'targetWorkId' is distinct from p_target then raise exception 'MANUAL_TARGET_CONFLICT'; end if;

 if jsonb_array_length(p_images)>0 then
  result=public.private_mail_manual_photo_submit(p_box,p_user,p_request,p_text,p_hash,p_reference,p_lease,p_retry,p_images,p_consent,p_target,p_enqueue);
 elsif p_enqueue and p_target is not null then
  result=public.private_mail_manual_target_enqueue(p_box,p_user,p_request,p_text,p_hash,p_reference,p_retry,p_target);
 elsif p_enqueue then
  result=public.private_mail_manual_enqueue(p_box,p_user,p_request,p_text,p_hash,p_reference,p_retry);
 else
  result=public.private_mail_manual_claim(p_box,p_user,p_request,p_text,p_hash,p_reference,p_lease,p_retry);
 end if;
 e=result->'entry';
 if jsonb_typeof(e) is distinct from 'object' or e->>'entryId' is null then raise exception 'MANUAL_SOURCE'; end if;
 -- The underlying hash deduplication may return a receipt with another request ID.
 prior=b.manual_entries->(e->>'entryId');
 if prior is not null and prior->'workScope' is distinct from p_scope then raise exception 'MANUAL_REQUEST_CONFLICT'; end if;
 if prior is not null and prior->>'targetWorkId' is distinct from p_target then raise exception 'MANUAL_TARGET_CONFLICT'; end if;
 if e ? 'workScope' and e->'workScope' is distinct from p_scope then raise exception 'MANUAL_REQUEST_CONFLICT'; end if;
 e=e||jsonb_build_object('workScope',p_scope);
 if p_target is not null then e=e||jsonb_build_object('targetWorkId',p_target); end if;
 select jsonb_set(manual_entries,array[e->>'entryId'],e) into entries from public.private_mailboxes where id=p_box;
 if octet_length(entries::text)>4194304 then raise exception 'MANUAL_LIMIT'; end if;
 update public.private_mailboxes set manual_entries=entries where id=p_box;
 return result||jsonb_build_object('entry',e);
end; $$;

revoke all on function public.private_mail_manual_scoped_submit(uuid,uuid,uuid,text,text,date,uuid,boolean,jsonb,boolean,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.private_mail_manual_scoped_submit(uuid,uuid,uuid,text,text,date,uuid,boolean,jsonb,boolean,text,boolean,jsonb) to service_role;

-- Keep the existing private-monthly branch intact. The separate manual branch
-- is also checked against a ready, explicitly scoped receipt by the existing guard.
alter table public.operations_tasks drop constraint personal_work_scope_valid;
alter table public.operations_tasks add constraint personal_work_scope_valid check(coalesce((
 (work_scope='center' and center_code is not null) or
 (work_scope='delivery_team' and center_code is null and inputs ? 'personal_monthly'
  and owner_id='2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid) or
 (work_scope='delivery_team' and center_code is null and not(inputs ? 'personal_monthly')
  and owner_id='2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid
  and inputs#>>'{personal_work,schema}'='sajo-daily-work-v1'
  and inputs#>>'{personal_work,workId}' ~ '^[0-9a-f-]{36}:manual:item-[0-9]{3}$'
  and inputs#>'{personal_work,scope}'='{"kind":"delivery_team","centerCode":null,"workCategory":null}'::jsonb)
),false));

create unique index if not exists operations_scoped_dispatch_identity
 on public.operations_tasks(owner_id,(inputs->>'manual_dispatch_key'))
 where inputs ? 'manual_dispatch_key';
create unique index if not exists operations_scoped_manual_identity
 on public.operations_tasks(owner_id,(inputs#>>'{personal_work,workId}'))
 where inputs ? 'personal_work' and not(inputs ? 'personal_monthly');

-- Patch the deployed monthly-only entry gate, preserving every existing monthly
-- implementation line. Fail closed on an unknown deployment; reruns are harmless.
do $scope_upgrade$
declare source text; old_gate text; new_gate text;
begin
 source=pg_get_functiondef('public.private_mail_portal_upsert(uuid,uuid,uuid,jsonb)'::regprocedure);
 old_gate=$gate$if p_user<>'2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid or not exists(select 1 from public.operations_tasks where owner_id=p_user and inputs ? 'personal_monthly' and inputs #>> '{personal_work,workId}'=ref) then raise exception 'MONTHLY_EXISTING_TARGET_ONLY';end if;$gate$;
 new_gate=$gate$-- scoped_manual_wrapper_gate_v1
 if p_user<>'2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid or
 (not exists(select 1 from public.operations_tasks where owner_id=p_user and inputs ? 'personal_monthly' and inputs #>> '{personal_work,workId}'=ref)
 and coalesce(current_setting('app.private_mail_scoped_call',true),'') is distinct from p_user::text||':'||p_request::text||':'||ref)
 then raise exception 'MONTHLY_EXISTING_TARGET_ONLY';end if;$gate$;
 if position('scoped_manual_wrapper_gate_v1' in source)=0 then
  if position(old_gate in source)=0 then raise exception 'SCOPED_MANUAL_UPSERT_CONTRACT'; end if;
  execute replace(source,old_gate,new_gate);
 end if;
 source=pg_get_functiondef('public.private_mail_monthly_task_guard()'::regprocedure);
 old_gate=$gate$if not(new.template_snapshot->'spec' ? 'personal_monthly') then$gate$;
 new_gate=$gate$if not coalesce(new.template_snapshot->'spec' ? 'personal_monthly',false) then$gate$;
 if position(new_gate in source)=0 then
  if position(old_gate in source)=0 then raise exception 'SCOPED_MANUAL_MONTHLY_CONTRACT'; end if;
  execute replace(source,old_gate,new_gate);
 end if;
end $scope_upgrade$;

drop trigger if exists private_mail_portal_guard on public.operations_tasks;
create trigger private_mail_portal_guard before insert or update on public.operations_tasks
 for each row execute function public.private_mail_portal_task_guard();
drop trigger if exists private_mail_portal_dirty on public.operations_tasks;
create trigger private_mail_portal_dirty after insert or update on public.operations_tasks
 for each row when(new.inputs ? 'personal_work') execute function public.private_mail_portal_task_dirty();

create or replace function public.private_mail_portal_snapshots(p_box uuid,p_user uuid,p_day date default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce(public.private_mail_manual_allowed(p_box,p_user),false) then raise exception 'WORK_PORTAL_OWNER'; end if;
 return (select coalesce(jsonb_agg(snapshot order by id),'[]') from (
  select t.id,case when p_day is null then to_jsonb(t) else (
   select e.after_value from public.operations_task_events e where e.task_id=t.id
   and e.occurred_at<((p_day+1)::timestamp at time zone 'Asia/Seoul') order by e.occurred_at desc,e.id desc limit 1
  ) end snapshot from public.operations_tasks t where t.owner_id=p_user and t.inputs ? 'personal_work'
 ) snapshots where snapshot is not null);
end; $$;

-- These policies only restrict existing grants; monthly visibility stays owner-only.
drop policy if exists scoped_manual_tasks_read on public.operations_tasks;
create policy scoped_manual_tasks_read on public.operations_tasks as restrictive for select to authenticated using(
 not(inputs ? 'personal_work') or inputs ? 'personal_monthly' or
 (public.operations_resource_allowed('tasks','read',coalesce(center_code,'')) and (owner_id=auth.uid() or public.is_admin() or
  (work_scope='center' and exists(select 1 from public.operations_center_members m where m.user_id=auth.uid() and m.center_code=operations_tasks.center_code))))
);
drop policy if exists scoped_manual_events_read on public.operations_task_events;
create policy scoped_manual_events_read on public.operations_task_events as restrictive for select to authenticated using(
 not(coalesce(after_value->'inputs','{}'::jsonb) ? 'personal_work' or coalesce(before_value->'inputs','{}'::jsonb) ? 'personal_work')
 or exists(select 1 from public.operations_tasks t where t.id=operations_task_events.task_id)
);

-- Apply validated guide fields before the existing upsert captures its event.
-- Normal portal edits cannot erase/change the immutable dispatch identity.
create or replace function public.private_mail_scoped_guide_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare payload jsonb; saved text;
begin
 if tg_op='UPDATE' and old.inputs ? 'manual_dispatch_key' then
  if new.inputs->'manual_dispatch_key' is distinct from old.inputs->'manual_dispatch_key' then raise exception 'WORK_DISPATCH_CONFLICT'; end if;
 end if;
 saved=current_setting('app.private_mail_scoped_guide',true);
 if saved is null or saved='' then return new; end if;
 payload=saved::jsonb;
 if payload->>'ownerId' is distinct from new.owner_id::text
 or payload->>'workId' is distinct from new.inputs#>>'{personal_work,workId}' then return new; end if;
 if payload ? 'yangsanDispatch' then
  new.inputs=jsonb_set(new.inputs,'{yangsan_dispatch}',coalesce(new.inputs->'yangsan_dispatch','{}'::jsonb)||jsonb_strip_nulls(payload->'yangsanDispatch'));
 end if;
 if payload ? 'dispatchKey' then
  if new.inputs ? 'manual_dispatch_key' and new.inputs->'manual_dispatch_key' is distinct from payload->'dispatchKey' then raise exception 'WORK_DISPATCH_CONFLICT'; end if;
  new.inputs=jsonb_set(new.inputs,'{manual_dispatch_key}',payload->'dispatchKey');
 end if;
 return new;
end; $$;
drop trigger if exists private_mail_scoped_guide on public.operations_tasks;
create trigger private_mail_scoped_guide before insert or update on public.operations_tasks
 for each row execute function public.private_mail_scoped_guide_guard();

create or replace function public.private_mail_manual_scoped_finish(
 p_box uuid,p_user uuid,p_entry uuid,p_lease uuid,p_items jsonb,p_authored date,p_inference jsonb,p_documents jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; e jsonb; bundle jsonb; document jsonb; marker jsonb; item jsonb; root_item jsonb;
 t public.operations_tasks; stored jsonb; guide jsonb; payload jsonb; original_scope jsonb;
 request_id uuid; work_ref text; source_ref text; saved_setting text; saved_call text; duplicate_constraint text;
 links jsonb='[]'::jsonb; sync_issues jsonb='[]'::jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 if not coalesce(public.private_mail_manual_allowed(p_box,p_user),false) then raise exception 'MANUAL_SCOPE'; end if;
 original_scope=b.manual_entries->p_entry::text->'workScope';
 if original_scope is null or original_scope='null'::jsonb then raise exception 'MANUAL_SCOPE'; end if;
 if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents)>30
 or octet_length(p_documents::text)>100000 then raise exception 'WORK_FORMAT'; end if;
 if (select count(distinct x->>'requestId') from jsonb_array_elements(p_documents) x)<>jsonb_array_length(p_documents)
 or (select count(distinct x#>>'{document,inputs,personal_work,workId}') from jsonb_array_elements(p_documents) x)<>jsonb_array_length(p_documents)
 then raise exception 'WORK_REQUEST_CONFLICT'; end if;
 if jsonb_array_length(coalesce(b.manual_entries->p_entry::text->'images','[]'::jsonb))>0 then
  e=public.private_mail_manual_photo_finish(p_box,p_user,p_entry,p_lease,p_items,p_authored,p_inference);
 else
  e=public.private_mail_manual_finish(p_box,p_user,p_entry,p_lease,p_items,p_authored,p_inference);
 end if;
 if e is null then return null; end if;
 for bundle in select value from jsonb_array_elements(p_documents) loop
  if jsonb_typeof(bundle) is distinct from 'object' or bundle-array['requestId','document','yangsanDispatch','dispatchKey']<>'{}'::jsonb
  or coalesce(bundle->>'requestId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'WORK_FORMAT'; end if;
  request_id=(bundle->>'requestId')::uuid;document=bundle->'document';marker=document#>'{inputs,personal_work}';work_ref=marker->>'workId';
  if jsonb_typeof(document) is distinct from 'object'
  or document-array['id','expected_version','owner_id','center_code','work_scope','title','work_date','work_end_date','due_at','status','inputs']<>'{}'::jsonb
  or document->>'owner_id' is distinct from p_user::text or marker->'scope' is distinct from original_scope
  or document->>'work_scope' is distinct from original_scope->>'kind' or document->>'center_code' is distinct from original_scope->>'centerCode'
  or jsonb_typeof(marker->'sourceKeys') is distinct from 'array' then raise exception 'WORK_SCOPE_CONFLICT'; end if;
  -- Bind the projection to a current accepted item; a submitted arbitrary work ref is not sufficient.
  select value into item from jsonb_array_elements(e->'items') value
  where (value->>'ref'=work_ref or (value->>'workRef'=work_ref and value->'needsConfirmation'='false'::jsonb))
   and marker->'sourceKeys' ? (value->>'ref') limit 1;
  if item is null then raise exception 'WORK_SOURCE'; end if;
  root_item=null;
  if item->>'kind'='reference' and item->>'workRef'=work_ref and item->'needsConfirmation'='false'::jsonb then
   select origin into root_item from jsonb_each(b.manual_entries) prior_entry
    cross join lateral jsonb_array_elements(coalesce(prior_entry.value->'items','[]'::jsonb)) origin
   where prior_entry.value->>'status'='ready' and prior_entry.value->'workScope'=original_scope
    and origin->>'ref'=work_ref and origin->>'kind'='dispatch' limit 1;
   if root_item is null then raise exception 'WORK_SOURCE'; end if;
  elsif item->>'kind' not in ('task','dispatch','issue','waiting') then raise exception 'WORK_SOURCE'; end if;
  source_ref=item->>'ref';
  -- Only derived display fields are accepted; raw message, evidence, files and credentials have no slot.
  if jsonb_typeof(marker->'summary') is distinct from 'array' or jsonb_array_length(marker->'summary')>12
  or exists(select 1 from jsonb_array_elements(marker->'summary') s where jsonb_typeof(s)<>'string' or length(s#>>'{}')>2000)
  or exists(select 1 from jsonb_each(marker) kv where kv.key in ('nextAction','progress','waitingFor','customer','requester')
    and (jsonb_typeof(kv.value) not in ('string','null') or length(kv.value#>>'{}')>2000))
  then raise exception 'WORK_FORMAT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text||work_ref,1));
  select * into t from public.operations_tasks where owner_id=p_user and inputs#>>'{personal_work,workId}'=work_ref for update;
  if t.id is not null then
   if t.inputs ? 'personal_monthly' or t.deleted_at is not null or t.inputs#>'{personal_work,scope}' is distinct from original_scope then raise exception 'WORK_SCOPE_CONFLICT'; end if;
   document=document||jsonb_build_object('id',t.id,'expected_version',t.version,'work_date',t.work_date);
   -- A supplemental message cannot undo a verified/owner completion.
   if t.status in ('completed','not_applicable') and document->>'status' not in ('completed','not_applicable') then
    document=jsonb_set(document,'{status}',to_jsonb(t.status));
   end if;
  else document=document||jsonb_build_object('id',null,'expected_version',null); end if;
  if root_item is not null and t.id is null then raise exception 'WORK_SOURCE'; end if;
  payload=jsonb_build_object('ownerId',p_user,'workId',work_ref);
  if bundle ? 'yangsanDispatch' and ((t.inputs#>>'{personal_work,contentSourceAt}')::timestamptz is null or
   (e->>'submittedAt')::timestamptz >= (t.inputs#>>'{personal_work,contentSourceAt}')::timestamptz) then
   guide=bundle->'yangsanDispatch';
   if original_scope->>'centerCode' is distinct from 'yangsan' or (item->>'kind' is distinct from 'dispatch' and root_item is null)
   or jsonb_typeof(guide) is distinct from 'object'
   or guide-array['loadingDate','loadingTime','unloadingDate','unloadingTime','unloadingAddress','contact']<>'{}'::jsonb
   or exists(select 1 from jsonb_each(guide) kv where jsonb_typeof(kv.value) not in ('string','null') or length(kv.value#>>'{}')>500)
   then raise exception 'WORK_GUIDE_FORMAT'; end if;
   if exists(select 1 from jsonb_each_text(guide) kv where kv.value is not null and
    ((kv.key in ('loadingTime','unloadingTime') and kv.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
     or (kv.key in ('loadingDate','unloadingDate') and kv.value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')))
   then raise exception 'WORK_GUIDE_FORMAT'; end if;
   perform (guide->>'loadingDate')::date,(guide->>'unloadingDate')::date;
   payload=payload||jsonb_build_object('yangsanDispatch',guide);
  end if;
  if bundle ? 'dispatchKey' then
   if (item->>'kind' is distinct from 'dispatch' and root_item is null) or coalesce(bundle->>'dispatchKey','') !~ '^[0-9a-f]{64}$' then raise exception 'WORK_DISPATCH_CONFLICT'; end if;
   perform pg_advisory_xact_lock(hashtextextended(p_user::text||':'||(bundle->>'dispatchKey'),2));
   if exists(select 1 from public.operations_tasks duplicate where duplicate.owner_id=p_user
    and duplicate.inputs->>'manual_dispatch_key'=bundle->>'dispatchKey'
    and duplicate.inputs#>>'{personal_work,workId}' is distinct from work_ref) then
    sync_issues=sync_issues||jsonb_build_array(jsonb_build_object('sourceRef',source_ref,'code','WORK_DISPATCH_DUPLICATE','needsConfirmation',true));
    continue;
   end if;
   payload=payload||jsonb_build_object('dispatchKey',bundle->'dispatchKey');
  end if;
  saved_setting=current_setting('app.private_mail_scoped_guide',true);
  saved_call=current_setting('app.private_mail_scoped_call',true);
  perform set_config('app.private_mail_scoped_guide',payload::text,true);
  perform set_config('app.private_mail_scoped_call',p_user::text||':'||request_id::text||':'||work_ref,true);
  begin
   stored=public.private_mail_portal_upsert(p_box,p_user,request_id,document);
  exception when unique_violation then
   get stacked diagnostics duplicate_constraint=constraint_name;
   if duplicate_constraint<>'operations_scoped_dispatch_identity' then raise; end if;
   sync_issues=sync_issues||jsonb_build_array(jsonb_build_object('sourceRef',source_ref,'code','WORK_DISPATCH_DUPLICATE','needsConfirmation',true));
   stored=null;
  end;
  perform set_config('app.private_mail_scoped_guide',coalesce(saved_setting,''),true);
  perform set_config('app.private_mail_scoped_call',coalesce(saved_call,''),true);
  if stored is not null then links=links||jsonb_build_array(jsonb_build_object('workId',work_ref,'sourceRef',source_ref,'taskId',stored->>'id','version',stored->'version')); end if;
 end loop;
 -- Read after task triggers so receipt changes cannot overwrite their dirty flags.
 select manual_entries->p_entry::text into e from public.private_mailboxes where id=p_box;
 e=e||jsonb_build_object('portalLinks',links,'portalSyncIssues',sync_issues);
 if jsonb_array_length(sync_issues)>0 then
  e=jsonb_set(e,'{items}',(select jsonb_agg(case when exists(select 1 from jsonb_array_elements(sync_issues) issue where issue->>'sourceRef'=i->>'ref')
   then i||jsonb_build_object('needsConfirmation',true) else i end order by ordinal)
   from jsonb_array_elements(e->'items') with ordinality items(i,ordinal)));
 end if;
 update public.private_mailboxes set manual_entries=jsonb_set(manual_entries,array[p_entry::text],e) where id=p_box;
 return e;
end; $$;

revoke all on function public.private_mail_scoped_guide_guard(),public.private_mail_manual_scoped_finish(uuid,uuid,uuid,uuid,jsonb,date,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.private_mail_scoped_guide_guard(),public.private_mail_manual_scoped_finish(uuid,uuid,uuid,uuid,jsonb,date,jsonb,jsonb) to service_role;

-- Reuse the existing owner correction transaction/event writer for scoped work.
-- Legacy unlinked manual entries retain their private-only correction behavior.
do $scoped_owner_correction$
declare source text; old_target text; new_target text; old_call text; new_call text;
begin
 source=pg_get_functiondef('public.private_mail_monthly_owner_correct(uuid,text,jsonb,jsonb)'::regprocedure);
 old_target=$target$select * into t from public.operations_tasks where id=substring(p_work from 8)::uuid and owner_id=p_user and inputs ? 'personal_monthly' and deleted_at is null for update;
 if not found then raise exception 'MONTHLY_SOURCE';end if;$target$;
 new_target=$target$-- scoped_owner_correction_v1
 if p_work like 'source:%' then
  select * into t from public.operations_tasks where id=substring(p_work from 8)::uuid and owner_id=p_user and inputs ? 'personal_monthly' and deleted_at is null for update;
  if not found then raise exception 'MONTHLY_SOURCE';end if;
 else
  select * into t from public.operations_tasks where owner_id=p_user
   and inputs#>>'{personal_work,workId}'=p_work and not(inputs ? 'personal_monthly') for update;
  if not found then return;end if;
  if t.deleted_at is not null or not exists(
   select 1 from public.private_mailboxes b
   cross join lateral jsonb_each(b.manual_entries) e
   cross join lateral jsonb_array_elements(coalesce(e.value->'portalLinks','[]'::jsonb)) link
   where b.id='39045005-313e-42e1-b50c-2394b3b6ff26' and b.owner_id=p_user
    and e.key=split_part(p_work,':',1) and e.value->>'status'='ready'
    and e.value->'workScope'=t.inputs#>'{personal_work,scope}'
    and link->>'workId'=p_work and link->>'taskId'=t.id::text
  ) then raise exception 'WORK_LINK_CONFLICT';end if;
 end if;$target$;
 if position('scoped_owner_correction_v1' in source)=0 then
  if position(old_target in source)=0 then raise exception 'SCOPED_OWNER_CORRECTION_CONTRACT';end if;
  execute replace(source,old_target,new_target);
 end if;
 source=pg_get_functiondef('public.private_mail_work_correct(uuid,uuid,text,date,jsonb,text)'::regprocedure);
 old_call=$call$if source_kind='portal' then perform public.private_mail_monthly_owner_correct(p_user,p_work,revised,p_patch);end if;$call$;
 new_call=$call$if source_kind in ('portal','manual') then perform public.private_mail_monthly_owner_correct(p_user,p_work,revised,p_patch);end if;$call$;
 if position(new_call in source)=0 then
  if position(old_call in source)=0 then raise exception 'SCOPED_OWNER_CORRECTION_CONTRACT';end if;
  execute replace(source,old_call,new_call);
 end if;
end $scoped_owner_correction$;

commit;
