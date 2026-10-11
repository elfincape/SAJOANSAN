-- Handoff and HQ actions retain their original task/incident IDs.
begin;
alter table public.operations_tasks add column due_at timestamptz,
  add column cj_share_due_at timestamptz;
create table public.operations_incidents (
  id uuid primary key default gen_random_uuid(),
  center_code text not null references public.centers(code),
  task_id uuid references public.operations_tasks(id),
  title text not null check(length(trim(title)) between 1 and 200),
  kind text not null check(length(trim(kind)) between 1 and 100),
  inputs jsonb not null default '{}' check(jsonb_typeof(inputs)='object'),
  status text not null default 'open' check(status in ('open','resolved')),
  support_state text not null default 'none' check(support_state in ('none','requested','supporting','done')),
  created_by uuid not null references public.user_profiles(id),
  resolved_by uuid references public.user_profiles(id),
  resolved_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((status='resolved' and resolved_by is not null and resolved_at is not null)
    or (status='open' and resolved_by is null and resolved_at is null))
);
create index operations_incidents_center_time on public.operations_incidents(center_code,created_at desc);
alter table public.operations_incidents enable row level security;
create policy operations_incidents_read on public.operations_incidents for select to authenticated
 using(public.operations_can_read());
revoke all on public.operations_incidents from anon,authenticated;
grant select on public.operations_incidents to authenticated;
alter table public.operations_task_events alter column task_id drop not null;
alter table public.operations_task_events add column incident_id uuid references public.operations_incidents(id),
 add constraint operations_event_original check((task_id is null)<>(incident_id is null));
alter table public.operations_task_events drop constraint operations_task_events_action_check;
alter table public.operations_task_events add constraint operations_task_events_action_check
 check(action in ('created','updated','completed','not_applicable','handoff','deadline',
   'incident_created','incident_updated','support_requested','support_action','resolved','reopened'));

create function public.operations_task_action(p_request_id uuid,p_task_id uuid,p_expected_version integer,
 p_action text,p_data jsonb) returns public.operations_tasks
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb;
 target uuid; deadline timestamptz; cj_deadline timestamptz;
begin
 if auth.uid() is null or p_request_id is null or p_action not in ('handoff','deadline')
   or p_action is null or p_data is null or jsonb_typeof(p_data)<>'object' then
   raise exception '인계 또는 마감시간 요청을 확인해 주세요' using errcode='22023';
 end if;
 body:=jsonb_build_object('operation','task_action','task',p_task_id,'version',p_expected_version,'action',p_action,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into t from public.operations_tasks where id=p_task_id for update;
 if not found or not public.operations_can_write(t.center_code) then
   raise exception '업무 수정 권한이 없습니다' using errcode='42501'; end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
   return t;
 end if;
 if p_expected_version is null or t.version<>p_expected_version then
   raise exception '다른 사용자가 수정했습니다' using errcode='40001'; end if;
 if t.status in ('completed','not_applicable') then
   raise exception '확정된 업무는 인계하거나 기한을 변경할 수 없습니다' using errcode='22023'; end if;
 before_row:=to_jsonb(t);
 if p_action='handoff' then
   target:=(p_data->>'owner_id')::uuid;
   if target is null or target=t.owner_id or not exists(select 1 from public.user_profiles p
     where p.id=target and p.active and (p.role='admin' or (p.role='editor' and exists(
       select 1 from public.operations_center_members m where m.user_id=target and m.center_code=t.center_code)))) then
     raise exception '해당 센터 업무를 맡을 수 있는 다음 담당자를 선택해 주세요' using errcode='22023'; end if;
   if p_data - array['owner_id','memo'] <> '{}'::jsonb then
     raise exception '인계에서 업무 내용이나 기한은 변경하지 않습니다' using errcode='22023'; end if;
   update public.operations_tasks set owner_id=target,version=version+1,updated_at=now()
     where id=t.id returning * into t;
 else
   if p_data - array['due_at','cj_share_due_at','reason'] <> '{}'::jsonb then
     raise exception '마감시간 요청을 확인해 주세요' using errcode='22023'; end if;
   deadline:=case when p_data ? 'due_at' then (p_data->>'due_at')::timestamptz else t.due_at end;
   cj_deadline:=case when p_data ? 'cj_share_due_at' then (p_data->>'cj_share_due_at')::timestamptz else t.cj_share_due_at end;
   if deadline is not distinct from t.due_at and cj_deadline is not distinct from t.cj_share_due_at then
     raise exception '변경된 마감시간이 없습니다' using errcode='22023'; end if;
   if ((t.due_at is not null and deadline is distinct from t.due_at)
     or (t.cj_share_due_at is not null and cj_deadline is distinct from t.cj_share_due_at))
     and nullif(trim(p_data->>'reason'),'') is null then
     raise exception '기존 마감시간 변경 사유를 입력해 주세요' using errcode='22023'; end if;
   update public.operations_tasks set due_at=deadline,cj_share_due_at=cj_deadline,
     version=version+1,updated_at=now() where id=t.id returning * into t;
 end if;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
   values(t.id,auth.uid(),p_request_id,body,p_action,before_row,to_jsonb(t));
 return t;
end;
$$;

create function public.operations_incident_action(p_request_id uuid,p_incident_id uuid,p_expected_version integer,
 p_action text,p_data jsonb) returns public.operations_incidents
language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.operations_incidents; prior public.operations_task_events; body jsonb; before_row jsonb;
 center text; linked_task uuid; event_action text; is_hq boolean;
begin
 if p_request_id is null or not public.operations_can_read() then
   raise exception '활성 사용자 인증이 필요합니다' using errcode='42501'; end if;
 if p_action is null or p_action not in ('create','edit','request_support','support','resolve','reopen')
   or p_data is null or jsonb_typeof(p_data)<>'object' then
   raise exception '특이사항 요청을 확인해 주세요' using errcode='22023'; end if;
 body:=jsonb_build_object('operation','incident_action','incident',p_incident_id,'version',p_expected_version,
   'action',p_action,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
   select * into i from public.operations_incidents where id=prior.incident_id;
   return i;
 end if;
 select exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') into is_hq;
 if p_action='create' then
   center:=p_data->>'center_code'; linked_task:=(p_data->>'task_id')::uuid;
   if p_incident_id is not null or p_expected_version is not null or not public.operations_can_write(center) then
     raise exception '해당 센터 특이사항 등록 권한이 없습니다' using errcode='42501'; end if;
   if linked_task is not null and not exists(select 1 from public.operations_tasks where id=linked_task and center_code=center) then
     raise exception '관련 업무의 센터가 일치하지 않습니다' using errcode='22023'; end if;
   insert into public.operations_incidents(center_code,task_id,title,kind,inputs,created_by)
     values(center,linked_task,trim(p_data->>'title'),trim(p_data->>'kind'),coalesce(p_data->'inputs','{}'),auth.uid())
     returning * into i;
   event_action:='incident_created';
 else
   select * into i from public.operations_incidents where id=p_incident_id for update;
   if not found then raise exception '특이사항을 찾을 수 없습니다' using errcode='22023'; end if;
   -- Independent HQ actions append without claiming exclusive ownership.
   if p_action<>'support' and (p_expected_version is null or i.version<>p_expected_version) then
     raise exception '다른 사용자가 수정했습니다' using errcode='40001'; end if;
   if p_action in ('edit','request_support') and not public.operations_can_write(i.center_code) then
     raise exception '특이사항 수정 권한이 없습니다' using errcode='42501'; end if;
   if p_action='support' and not is_hq then
     raise exception 'HQ 실제 조치 권한이 필요합니다' using errcode='42501'; end if;
   before_row:=to_jsonb(i);
   case p_action
   when 'edit' then
     if i.status='resolved' then raise exception '해결 기록은 먼저 재개해 주세요' using errcode='22023'; end if;
     update public.operations_incidents set title=coalesce(trim(p_data->>'title'),title),
       inputs=coalesce(p_data->'inputs',inputs) where id=i.id returning * into i;
     event_action:='incident_updated';
   when 'request_support' then
     if i.status='resolved' then raise exception '해결된 특이사항입니다' using errcode='22023'; end if;
     update public.operations_incidents set support_state='requested' where id=i.id returning * into i;
     event_action:='support_requested';
   when 'support' then
     if nullif(trim(p_data->>'note'),'') is null then
       raise exception '실제로 수행한 조치 내용을 입력해 주세요' using errcode='22023'; end if;
     update public.operations_incidents set support_state=case when coalesce((p_data->>'done')::boolean,false)
       then 'done' else 'supporting' end where id=i.id returning * into i;
     event_action:='support_action';
   when 'resolve' then
     if i.status='resolved' then raise exception '이미 해결된 특이사항입니다' using errcode='22023'; end if;
     update public.operations_incidents set status='resolved',resolved_by=auth.uid(),resolved_at=now()
       where id=i.id returning * into i;
     event_action:='resolved';
   when 'reopen' then
     if i.status='open' then raise exception '이미 진행 중인 특이사항입니다' using errcode='22023'; end if;
     update public.operations_incidents set status='open',resolved_by=null,resolved_at=null
       where id=i.id returning * into i;
     event_action:='reopened';
   end case;
   update public.operations_incidents set version=version+1,updated_at=now() where id=i.id returning * into i;
 end if;
 insert into public.operations_task_events(incident_id,actor_id,request_id,request_body,action,before_value,after_value)
   values(i.id,auth.uid(),p_request_id,body,event_action,before_row,to_jsonb(i));
 return i;
end;
$$;
revoke all on function public.operations_task_action(uuid,uuid,integer,text,jsonb),
 public.operations_incident_action(uuid,uuid,integer,text,jsonb) from public,anon;
grant execute on function public.operations_task_action(uuid,uuid,integer,text,jsonb),
 public.operations_incident_action(uuid,uuid,integer,text,jsonb) to authenticated;
create or replace view public.operations_daily_log with(security_invoker=true) as
select e.id,e.task_id,e.actor_id,e.action,e.occurred_at,
 (e.occurred_at at time zone 'Asia/Seoul')::date as report_date,
 e.after_value->>'center_code' as center_code,e.after_value->>'title' as title,
 e.after_value->>'status' as status,e.after_value->'inputs' as inputs,
 e.incident_id,e.request_body->'data'->>'note' as action_note,
 e.request_body->'data'->>'memo' as handoff_memo
from public.operations_task_events e;
commit;
