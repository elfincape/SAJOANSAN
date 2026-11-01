-- ISOLATED DEVELOPMENT ONLY. Do not apply to production before visibility/cutover review.
-- Reuses the task/event ledger. No authenticated grants or RLS policy changes.
begin;
alter table public.operations_tasks alter column center_code drop not null;
alter table public.operations_tasks add column if not exists work_scope text not null default 'center';
alter table public.operations_tasks add column if not exists work_end_date date;
alter table public.operations_tasks add column if not exists due_at timestamptz;
alter table public.operations_tasks add constraint personal_work_scope_valid check(
 (work_scope='center' and center_code is not null) or
 (work_scope='delivery_team' and center_code is null and inputs ? 'personal_work'));
create unique index personal_work_identity on public.operations_tasks(owner_id,(inputs #>> '{personal_work,workId}')) where inputs ? 'personal_work';

create function public.private_mail_portal_task_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare m jsonb; oldm jsonb; fields jsonb; key text; source_id uuid; source_key text; source_entry jsonb; is_source boolean;
begin
 if tg_op='UPDATE' and old.inputs ? 'personal_work' and not(new.inputs ? 'personal_work') then raise exception 'WORK_LINK_CONFLICT'; end if;
 if not(new.inputs ? 'personal_work') then return new; end if;
 m=new.inputs->'personal_work';
 if m->>'schema' is distinct from 'sajo-daily-work-v1' or m->>'ownerId' is distinct from new.owner_id::text
 or not public.private_mail_manual_allowed('39045005-313e-42e1-b50c-2394b3b6ff26',new.owner_id)
 or (auth.uid() is not null and auth.uid()<>new.owner_id) then raise exception 'WORK_PORTAL_OWNER'; end if;
 if jsonb_typeof(m->'sourceKeys') is distinct from 'array' or jsonb_array_length(m->'sourceKeys') not between 1 and 100
  or not(m->'sourceKeys' ? (m->>'workId')) then raise exception 'WORK_SOURCE'; end if;
 for source_key in select jsonb_array_elements_text(m->'sourceKeys') loop
  if source_key is null or source_key !~ '^(source:[0-9a-f-]{36}|[0-9a-f-]{36}:(manual:item-[0-9]{3}|(tasks|issues|waiting|imageTasks|imageIssues|imageWaiting):[0-9]{1,8}))$' then raise exception 'WORK_SOURCE'; end if;
  source_id=(case when source_key like 'source:%' then substr(source_key,8) else left(source_key,36) end)::uuid;
  if source_key like '%:manual:%' then
   select manual_entries->source_id::text into source_entry from public.private_mailboxes where id='39045005-313e-42e1-b50c-2394b3b6ff26' and owner_id=new.owner_id;
   if source_entry->>'status' is distinct from 'ready' or not exists(select 1 from jsonb_array_elements(coalesce(source_entry->'items','[]')) i
    where i->>'ref'=source_key or source_id::text||':manual:'||(i->>'itemId')=source_key) then raise exception 'WORK_SOURCE'; end if;
   if source_entry->'workScope' is null or source_entry->'workScope'='null'::jsonb then raise exception 'WORK_SCOPE_REQUIRED'; end if;
   if source_entry->'workScope' is distinct from m->'scope' then raise exception 'WORK_SCOPE_CONFLICT'; end if;
  elsif not exists(select 1 from public.private_mail_messages where id=source_id and owner_id=new.owner_id and mailbox_id='39045005-313e-42e1-b50c-2394b3b6ff26') then raise exception 'WORK_SOURCE';
  elsif source_key=m->>'workId' and new.work_scope<>'delivery_team' then raise exception 'WORK_SCOPE_CONFLICT'; end if;
 end loop;
 source_key=m->>'workId';
 if m->'scope'->>'kind' is distinct from new.work_scope or m->'scope'->>'centerCode' is distinct from new.center_code then raise exception 'WORK_SCOPE_CONFLICT'; end if;
 is_source=coalesce(current_setting('app.private_mail_portal_source',true),'')=new.id::text;
 if tg_op='UPDATE' then
  oldm=old.inputs->'personal_work';
  if new.work_date is distinct from old.work_date then raise exception 'WORK_DATE'; end if;
  if oldm is null or oldm->>'workId' is distinct from source_key or old.owner_id<>new.owner_id
   or old.work_scope<>new.work_scope or old.center_code is distinct from new.center_code or oldm->'scope' is distinct from m->'scope' then raise exception 'WORK_LINK_CONFLICT'; end if;
  if not is_source then
   if oldm->'sourceKeys' is distinct from m->'sourceKeys' then raise exception 'WORK_SOURCE'; end if;
   fields=coalesce(oldm->'ownerFields','[]');
   if new.title<>old.title and not(fields ? 'title') then fields=fields||'"title"'::jsonb; end if;
   if new.due_at is distinct from old.due_at and not(fields ? 'dueAt') then fields=fields||'"dueAt"'::jsonb; end if;
   foreach key in array array['category','reportKind','summary','nextAction','progress','waitingFor','customer','requester','dueDate','serviceDate','needsConfirmation','confirmationReasons'] loop
    if m->key is distinct from oldm->key and not(fields ? key) then fields=fields||to_jsonb(key); end if;
   end loop;
   if new.inputs->'work_note' is distinct from old.inputs->'work_note' then
    m=jsonb_set(m,'{progress}',coalesce(new.inputs->'work_note','null'));
    if not(fields ? 'progress') then fields=fields||'"progress"'::jsonb; end if;
   end if;
   m=m||jsonb_build_object('ownerFields',fields);
   if new.status<>old.status then m=m||jsonb_build_object('ownerStateAt',clock_timestamp()); end if;
  end if;
 end if;
 new.inputs=jsonb_set(new.inputs,'{personal_work}',m);
 -- This is the activity interval, not the independent service date or a made-up deadline.
 new.work_end_date=case when new.status in ('completed','not_applicable') then greatest(new.work_date,(new.completed_at at time zone 'Asia/Seoul')::date) else new.work_date end;
 return new;
end $$;
create trigger private_mail_portal_guard before insert or update on public.operations_tasks for each row execute function public.private_mail_portal_task_guard();

create function public.private_mail_portal_task_dirty() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not(new.inputs ? 'personal_work') then return new; end if;
 update public.private_mailboxes set briefing_overrides=jsonb_set(briefing_overrides,array['portal:'||(new.inputs #>> '{personal_work,workId}')],
  jsonb_build_object('taskId',new.id,'version',new.version,'updatedAt',new.updated_at))
 where id='39045005-313e-42e1-b50c-2394b3b6ff26' and owner_id=new.owner_id;
 perform public.private_mail_manual_dirty('39045005-313e-42e1-b50c-2394b3b6ff26',(clock_timestamp() at time zone 'Asia/Seoul')::date);
 return new;
end $$;
create trigger private_mail_portal_dirty after insert or update on public.operations_tasks for each row execute function public.private_mail_portal_task_dirty();

create function public.private_mail_portal_snapshots(p_box uuid,p_user uuid,p_day date default null) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not public.private_mail_manual_allowed(p_box,p_user) then raise exception 'WORK_PORTAL_OWNER'; end if;
 return (select coalesce(jsonb_agg(snapshot order by id),'[]') from (
  select t.id,case when p_day is null then to_jsonb(t) else (
   select e.after_value from public.operations_task_events e where e.task_id=t.id
   and e.occurred_at<((p_day+1)::timestamp at time zone 'Asia/Seoul') order by e.occurred_at desc,e.id desc limit 1
  ) end snapshot from public.operations_tasks t where t.owner_id=p_user and t.inputs ? 'personal_work'
 ) snapshots where snapshot is not null);
end $$;

create function public.private_mail_portal_upsert(p_box uuid,p_user uuid,p_request uuid,p_document jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.operations_tasks; prior public.operations_task_events; before_row jsonb; marker jsonb; oldm jsonb; body jsonb; ref text;
 task_id uuid; expected integer; key text; action text; desired_status text; proof timestamptz; owner_at timestamptz; source_owner_at timestamptz; state_allowed boolean; source_flag text;
begin
 if not public.private_mail_manual_allowed(p_box,p_user) then raise exception 'WORK_PORTAL_OWNER'; end if;
 if p_request is null or p_document->>'owner_id' is distinct from p_user::text or jsonb_typeof(p_document->'inputs') is distinct from 'object'
 or ((p_document->'inputs')-'personal_work')<>'{}' or jsonb_typeof(p_document->'inputs'->'personal_work') is distinct from 'object' then raise exception 'WORK_FORMAT'; end if;
 marker=p_document->'inputs'->'personal_work';ref=marker->>'workId';
 if (marker-array['schema','workId','ownerId','scope','sourceKeys','category','reportKind','status','summary','nextAction','progress','waitingFor','customer','requester','requestedAt','dueDate','serviceDate','needsConfirmation','confirmationReasons','ownerStateAt','verifiedCompletionAt','inferredStateAt','closedAt'])<>'{}'::jsonb then raise exception 'WORK_FORMAT'; end if;
 if coalesce(marker->>'category','') not in ('task','issue') then raise exception 'WORK_NOT_ACTIONABLE'; end if;
 if p_document->>'work_scope'='center' then
  if not exists(select 1 from public.centers where code=p_document->>'center_code' and active) or length(btrim(coalesce(marker->'scope'->>'workCategory','')))=0 then raise exception 'WORK_SCOPE'; end if;
 elsif p_document->>'work_scope' is distinct from 'delivery_team' or p_document->>'center_code' is not null then raise exception 'WORK_SCOPE'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_request::text,0));
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||ref,1));
 body=jsonb_build_object('operation','personal_work_sync','document',p_document-array['id','expected_version']);
 select * into prior from public.operations_task_events where actor_id=p_user and request_id=p_request;
 if found then
  if prior.request_body<>body then raise exception 'WORK_REQUEST_CONFLICT'; end if;
  return (select to_jsonb(x) from public.operations_tasks x where x.id=prior.task_id);
 end if;
 select * into t from public.operations_tasks where owner_id=p_user and inputs #>> '{personal_work,workId}'=ref for update;
 expected=(p_document->>'expected_version')::integer;
 task_id=(p_document->>'id')::uuid;
 if t.id is not null then
  if task_id is null and expected is null and t.title=p_document->>'title' and t.status=p_document->>'status'
    and ((t.inputs->'personal_work')-array['ownerFields','lastStateAt'])=marker then
   insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value,occurred_at)
    values(t.id,p_user,p_request,body,'updated',to_jsonb(t),to_jsonb(t),clock_timestamp());
   return to_jsonb(t);
  end if;
  if task_id is distinct from t.id then raise exception 'WORK_LINK_CONFLICT'; end if;
  if expected is distinct from t.version then raise exception 'WORK_PORTAL_STALE'; end if;
  before_row=to_jsonb(t);oldm=t.inputs->'personal_work';
  marker=jsonb_set(marker,'{sourceKeys}',(select jsonb_agg(value order by value) from (select distinct value from jsonb_array_elements_text(coalesce(oldm->'sourceKeys','[]')||coalesce(marker->'sourceKeys','[]'))) refs));
  if marker->'scope' is distinct from oldm->'scope' then raise exception 'WORK_SCOPE_CONFLICT'; end if;
 else
  if task_id is not null or expected is not null then raise exception 'WORK_LINK_CONFLICT'; end if;
  t.id=gen_random_uuid();
 end if;
 desired_status=p_document->>'status';
 if coalesce(desired_status,'') not in ('pending','in_progress','completed','not_applicable') then raise exception 'WORK_STATUS'; end if;
 source_owner_at=(marker->>'ownerStateAt')::timestamptz;
 proof=greatest((marker->>'verifiedCompletionAt')::timestamptz,source_owner_at);
 owner_at=greatest((oldm->>'ownerStateAt')::timestamptz,(oldm->>'lastStateAt')::timestamptz);
 if t.status is not null then
  foreach key in array array(select jsonb_array_elements_text(coalesce(oldm->'ownerFields','[]'))) loop
   if key='title' then p_document=jsonb_set(p_document,'{title}',to_jsonb(t.title));
   elsif key='dueAt' then p_document=jsonb_set(p_document,'{due_at}',coalesce(to_jsonb(t.due_at),'null'));
   else marker=jsonb_set(marker,array[key],coalesce(oldm->key,'null')); end if;
  end loop;
  marker=marker||jsonb_build_object('ownerFields',coalesce(oldm->'ownerFields','[]'),'ownerStateAt',oldm->'ownerStateAt');
  -- Source event time, rather than retry execution time, governs state changes.
  state_allowed=proof is not null and (owner_at is null or proof>owner_at)
    and (desired_status in ('completed','not_applicable') or source_owner_at is not null);
  if desired_status<>t.status and not state_allowed then desired_status=t.status; end if;
  if state_allowed then
   marker=marker||jsonb_build_object('lastStateAt',proof,'ownerStateAt',greatest((oldm->>'ownerStateAt')::timestamptz,source_owner_at));
  elsif oldm ? 'lastStateAt' then marker=marker||jsonb_build_object('lastStateAt',oldm->'lastStateAt'); end if;
 else
  if desired_status in ('completed','not_applicable') and proof is null then desired_status='pending'; end if;
  if proof is not null then marker=marker||jsonb_build_object('lastStateAt',proof); end if;
 end if;
 source_flag=current_setting('app.private_mail_portal_source',true);
 perform set_config('app.private_mail_portal_source',t.id::text,true);
 if before_row is null then
  insert into public.operations_tasks(id,center_code,work_scope,title,work_date,owner_id,created_by,status,inputs,due_at,completed_at,completed_by)
   values(t.id,p_document->>'center_code',p_document->>'work_scope',p_document->>'title',(p_document->>'work_date')::date,p_user,p_user,desired_status,jsonb_build_object('personal_work',marker),(p_document->>'due_at')::timestamptz,
   case when desired_status in ('completed','not_applicable') then proof end,case when desired_status in ('completed','not_applicable') then p_user end) returning * into t;
  action='created';
 else
  update public.operations_tasks set title=p_document->>'title',inputs=t.inputs||jsonb_build_object('personal_work',marker),due_at=(p_document->>'due_at')::timestamptz,status=desired_status,
   completed_at=case when desired_status in ('completed','not_applicable') then coalesce(t.completed_at,proof) end,
   completed_by=case when desired_status in ('completed','not_applicable') then p_user end,version=version+1,updated_at=clock_timestamp() where id=t.id returning * into t;
  action=case when desired_status in ('completed','not_applicable') then desired_status else 'updated' end;
 end if;
 perform set_config('app.private_mail_portal_source',coalesce(source_flag,''),true);
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value,occurred_at)
 values(t.id,p_user,p_request,body,action,before_row,to_jsonb(t),clock_timestamp());
 return to_jsonb(t);
end $$;
revoke all on function public.private_mail_portal_task_guard(),public.private_mail_portal_task_dirty(),public.private_mail_portal_snapshots(uuid,uuid,date),public.private_mail_portal_upsert(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.private_mail_portal_task_guard(),public.private_mail_portal_task_dirty(),public.private_mail_portal_snapshots(uuid,uuid,date),public.private_mail_portal_upsert(uuid,uuid,uuid,jsonb) to service_role;
commit;
