-- Shared task original and actual events. Existing profiles/centers are reused.
begin;
create table public.operations_center_members (
  user_id uuid not null references public.user_profiles(id),
  center_code text not null references public.centers(code),
  primary key(user_id, center_code)
);
create table public.operations_tasks (
  id uuid primary key default gen_random_uuid(),
  center_code text not null references public.centers(code),
  title text not null check(length(trim(title)) between 1 and 200),
  work_date date not null,
  owner_id uuid not null references public.user_profiles(id),
  created_by uuid not null references public.user_profiles(id),
  status text not null default 'pending' check(status in ('pending','in_progress','completed','not_applicable')),
  inputs jsonb not null default '{}' check(jsonb_typeof(inputs)='object'),
  version integer not null default 1,
  completed_by uuid references public.user_profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((status in ('completed','not_applicable')) = (completed_at is not null and completed_by is not null))
);
create table public.operations_task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.operations_tasks(id),
  actor_id uuid not null references public.user_profiles(id),
  request_id uuid not null,
  request_body jsonb not null,
  action text not null check(action in ('created','updated','completed','not_applicable')),
  before_value jsonb,
  after_value jsonb not null,
  occurred_at timestamptz not null default now(),
  unique(actor_id, request_id)
);
create index operations_tasks_center_date on public.operations_tasks(center_code,work_date);
create index operations_events_task_time on public.operations_task_events(task_id,occurred_at);

create function public.operations_can_read() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.user_profiles where id=auth.uid() and active);
$$;
create function public.operations_can_write(p_center text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.user_profiles p where p.id=auth.uid() and p.active
    and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members m
      where m.user_id=p.id and m.center_code=p_center))));
$$;
alter table public.operations_center_members enable row level security;
alter table public.operations_tasks enable row level security;
alter table public.operations_task_events enable row level security;
create policy operations_members_read on public.operations_center_members for select to authenticated
  using(user_id=auth.uid());
create policy operations_tasks_read on public.operations_tasks for select to authenticated
  using(public.operations_can_read());
create policy operations_events_read on public.operations_task_events for select to authenticated
  using(public.operations_can_read());
revoke all on public.operations_center_members,public.operations_tasks,public.operations_task_events from anon,authenticated;
grant select on public.operations_center_members,public.operations_tasks,public.operations_task_events to authenticated;

create function public.operations_save_task(
  p_request_id uuid, p_task_id uuid, p_expected_version integer,
  p_center text, p_title text, p_work_date date, p_inputs jsonb, p_status text
) returns public.operations_tasks
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid(); v_task public.operations_tasks; v_prior public.operations_task_events;
  v_before jsonb; v_body jsonb; v_action text;
begin
  if v_actor is null or p_request_id is null or not public.operations_can_write(p_center) then
    raise exception '업무 수정 권한이 없습니다' using errcode='42501';
  end if;
  if p_title is null or p_work_date is null or p_inputs is null or jsonb_typeof(p_inputs)<>'object'
    or p_status is null or p_status not in ('pending','in_progress','completed','not_applicable') then
    raise exception '업무 입력값을 확인해 주세요' using errcode='22023';
  end if;
  v_body:=jsonb_build_object('id',p_task_id,'version',p_expected_version,'center',p_center,
    'title',p_title,'date',p_work_date,'inputs',p_inputs,'status',p_status);
  -- Concurrent retries of the same request execute once.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_request_id::text,0));
  select * into v_prior from public.operations_task_events where actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_prior.request_body<>v_body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
    select * into v_task from public.operations_tasks where id=v_prior.task_id;
    return v_task;
  end if;
  if p_task_id is null then
    if p_expected_version is not null or p_status<>'pending' then
      raise exception '새 업무는 미완료 상태로 생성합니다' using errcode='22023';
    end if;
    insert into public.operations_tasks(center_code,title,work_date,owner_id,created_by,inputs)
      values(p_center,trim(p_title),p_work_date,v_actor,v_actor,p_inputs) returning * into v_task;
    v_action:='created';
  else
    select * into v_task from public.operations_tasks where id=p_task_id for update;
    if not found or v_task.center_code<>p_center then
      raise exception '업무와 센터가 일치하지 않습니다' using errcode='42501';
    end if;
    if p_expected_version is null or v_task.version<>p_expected_version then
      raise exception '다른 사용자가 수정했습니다. 새로고침 후 확인해 주세요' using errcode='40001';
    end if;
    if v_task.status in ('completed','not_applicable') then
      raise exception '확정된 업무 기록은 변경할 수 없습니다' using errcode='22023';
    end if;
    v_before:=to_jsonb(v_task);
    update public.operations_tasks set title=trim(p_title),work_date=p_work_date,inputs=p_inputs,status=p_status,
      version=version+1,updated_at=now(),
      completed_by=case when p_status in ('completed','not_applicable') then v_actor end,
      completed_at=case when p_status in ('completed','not_applicable') then now() end
      where id=p_task_id returning * into v_task;
    v_action:=case when p_status in ('completed','not_applicable') then p_status else 'updated' end;
  end if;
  insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
    values(v_task.id,v_actor,p_request_id,v_body,v_action,v_before,to_jsonb(v_task));
  return v_task;
end;
$$;
revoke all on function public.operations_can_read(),public.operations_can_write(text),
  public.operations_save_task(uuid,uuid,integer,text,text,date,jsonb,text) from public,anon;
grant execute on function public.operations_can_read(),public.operations_can_write(text),
  public.operations_save_task(uuid,uuid,integer,text,text,date,jsonb,text) to authenticated;

-- Daily/weekly reports read the same actual events; no separate report entry.
create view public.operations_daily_log with(security_invoker=true) as
select e.id,e.task_id,e.actor_id,e.action,e.occurred_at,
  (e.occurred_at at time zone 'Asia/Seoul')::date as report_date,
  e.after_value->>'center_code' as center_code,e.after_value->>'title' as title,
  e.after_value->>'status' as status,e.after_value->'inputs' as inputs
from public.operations_task_events e;
revoke all on public.operations_daily_log from anon;
grant select on public.operations_daily_log to authenticated;
commit;
