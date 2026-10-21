begin;
insert into public.centers(code,name) values('gimhae','김해센터'),('yangsan','양산센터') on conflict(code) do nothing;

create function public.operations_portal_context() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501'; end if;
 return jsonb_build_object('centers',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name) order by code),'[]') from public.centers where active),
 'writable_centers',(select coalesce(jsonb_agg(code order by code),'[]') from public.centers where active and public.operations_can_write(code)));
end $$;
create function public.operations_handoff_people(p_center text) returns table(id uuid,name text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.operations_can_write(p_center) then raise exception '센터 수정 권한이 없습니다' using errcode='42501'; end if;
 return query select p.id,coalesce(nullif(p.display_name,''),p.email,'직원') from public.user_profiles p where p.active
 and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p.id and m.center_code=p_center))) order by 2;
end $$;

alter table public.operations_task_events drop constraint operations_task_events_action_check;
alter table public.operations_task_events add constraint operations_task_events_action_check check(action in
 ('created','updated','completed','not_applicable','handoff','deadline','incident_created','incident_updated','support_requested','support_action','resolved','reopened','template_created','template_approved','template_retired','task_reopened'));
create function public.operations_reopen_task(p_request_id uuid,p_task_id uuid,p_expected_version integer) returns public.operations_tasks
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb;
begin
 if p_request_id is null then raise exception '요청 번호가 필요합니다' using errcode='22023'; end if;
 body:=jsonb_build_object('operation','reopen_task','task',p_task_id,'version',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into t from public.operations_tasks where id=p_task_id for update;
 if not found or not public.operations_can_write(t.center_code) then raise exception '센터 수정 권한이 없습니다' using errcode='42501'; end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
  return t;
 end if;
 if t.version is distinct from p_expected_version then raise exception '다른 사용자가 수정했습니다' using errcode='40001'; end if;
 if t.status not in ('completed','not_applicable') then raise exception '완료된 업무만 재개할 수 있습니다' using errcode='22023'; end if;
 before_row:=to_jsonb(t);
 update public.operations_tasks set status='in_progress',completed_by=null,completed_at=null,version=version+1,updated_at=now() where id=t.id returning * into t;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
 values(t.id,auth.uid(),p_request_id,body,'task_reopened',before_row,to_jsonb(t));
 return t;
end $$;

create table public.operations_notifications(
 id bigint generated always as identity primary key,
 user_id uuid not null references public.user_profiles(id),
 event_id bigint not null references public.operations_task_events(id),
 title text not null,
 task_id uuid references public.operations_tasks(id),
 incident_id uuid references public.operations_incidents(id),
 created_at timestamptz not null default now(), read_at timestamptz,
 unique(user_id,event_id)
);
alter table public.operations_notifications enable row level security;
create policy operations_notification_read on public.operations_notifications for select to authenticated using(user_id=auth.uid() and public.operations_can_read());
revoke all on public.operations_notifications from public,anon,authenticated;
grant select on public.operations_notifications to authenticated;
create function public.operations_notify_event() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.action='handoff' then
  insert into public.operations_notifications(user_id,event_id,title,task_id)
   values((new.after_value->>'owner_id')::uuid,new.id,'인계받은 업무: '||(new.after_value->>'title'),new.task_id) on conflict do nothing;
 elsif new.action='support_requested' then
  insert into public.operations_notifications(user_id,event_id,title,incident_id)
   select id,new.id,'HQ 지원 요청: '||(new.after_value->>'title'),new.incident_id from public.user_profiles where active and role='admin' on conflict do nothing;
 end if;
 return new;
end $$;
create trigger operations_event_notification after insert on public.operations_task_events for each row execute function public.operations_notify_event();
create function public.operations_read_notification(p_id bigint) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501'; end if;
 update public.operations_notifications set read_at=coalesce(read_at,now()) where id=p_id and user_id=auth.uid();
 if not found then raise exception '알림 접근 권한이 없습니다' using errcode='42501'; end if;
end $$;

create table public.operations_surveys(
 id uuid primary key default gen_random_uuid(),center_code text not null references public.centers(code),
 title text not null check(length(trim(title)) between 1 and 200),
 details jsonb not null check(jsonb_typeof(details)='object'),
 stage text not null default 'submitted' check(stage in ('submitted','surveyed','designed','built','verified')),
 template_id uuid references public.operations_templates(id),
 created_by uuid not null references public.user_profiles(id),updated_by uuid not null references public.user_profiles(id),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.operations_surveys enable row level security;
create policy operations_surveys_read on public.operations_surveys for select to authenticated using(public.operations_can_read());
revoke all on public.operations_surveys from public,anon,authenticated;
grant select on public.operations_surveys to authenticated;
alter table public.operations_task_events add column survey_id uuid references public.operations_surveys(id);
create function public.operations_survey_action(p_request_id uuid,p_id uuid,p_expected_version integer,p_action text,p_data jsonb) returns public.operations_surveys
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.operations_surveys; body jsonb; prior public.operations_task_events; t public.operations_templates; before_row jsonb;
begin
 if p_request_id is null or not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501'; end if;
 if p_action is null or p_action not in ('submit','edit','stage','template') or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception '조사 요청을 확인해 주세요' using errcode='22023'; end if;
 body:=jsonb_build_object('operation','survey_action','id',p_id,'version',p_expected_version,'action',p_action,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
  select * into s from public.operations_surveys where id=prior.survey_id; return s;
 end if;
 if p_action='submit' then
  if p_id is not null or p_expected_version is not null or not public.operations_can_write(p_data->>'center_code') then raise exception '센터 수정 권한이 없습니다' using errcode='42501'; end if;
  insert into public.operations_surveys(center_code,title,details,created_by,updated_by) values(p_data->>'center_code',trim(p_data->>'title'),p_data->'details',auth.uid(),auth.uid()) returning * into s;
 else
  select * into s from public.operations_surveys where id=p_id for update;
  if not found or not public.operations_can_write(s.center_code) then raise exception '센터 수정 권한이 없습니다' using errcode='42501'; end if;
  if s.version is distinct from p_expected_version then raise exception '다른 사용자가 수정했습니다' using errcode='40001'; end if;
  before_row:=to_jsonb(s);
  if p_action='edit' then
   if s.template_id is not null then raise exception '전환된 조사는 변경 요청으로 새로 등록해 주세요' using errcode='22023'; end if;
   update public.operations_surveys set title=trim(p_data->>'title'),details=p_data->'details' where id=s.id returning * into s;
  else
   if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then raise exception 'HQ 검토 권한이 필요합니다' using errcode='42501'; end if;
   if p_action='stage' then
    if array_position(array['submitted','surveyed','designed','built','verified'],p_data->>'stage') is distinct from array_position(array['submitted','surveyed','designed','built','verified'],s.stage)+1 then raise exception '다음 검증 단계로 진행해 주세요' using errcode='22023'; end if;
    if p_data->>'stage' in ('built','verified') and s.template_id is null then raise exception '승인 양식을 먼저 연결해 주세요' using errcode='22023'; end if;
    update public.operations_surveys set stage=p_data->>'stage' where id=s.id returning * into s;
   else
    if s.template_id is not null or s.stage<>'designed' then raise exception '설계 완료된 조사만 양식으로 전환할 수 있습니다' using errcode='22023'; end if;
    t:=public.operations_template_action(gen_random_uuid(),null,'create',jsonb_build_object('center_code',s.center_code,'title',s.title,'spec',p_data->'spec'));
    t:=public.operations_template_action(gen_random_uuid(),t.id,'approve','{}');
    update public.operations_surveys set template_id=t.id where id=s.id returning * into s;
   end if;
  end if;
  update public.operations_surveys set updated_by=auth.uid(),version=version+1,updated_at=now() where id=s.id returning * into s;
 end if;
 insert into public.operations_task_events(survey_id,actor_id,request_id,request_body,action,before_value,after_value) values(s.id,auth.uid(),p_request_id,body,'survey_'||p_action,before_row,to_jsonb(s));
 return s;
end $$;


alter table public.operations_task_events drop constraint operations_event_original;
alter table public.operations_task_events add constraint operations_event_original check(num_nonnulls(task_id,incident_id,template_id,survey_id)=1);
alter table public.operations_task_events drop constraint operations_task_events_action_check;
alter table public.operations_task_events add constraint operations_task_events_action_check check(action in
 ('created','updated','completed','not_applicable','handoff','deadline','incident_created','incident_updated','support_requested','support_action','resolved','reopened','template_created','template_approved','template_retired','task_reopened','survey_submit','survey_edit','survey_stage','survey_template'));
create or replace view public.operations_daily_log with(security_invoker=true) as
select e.id,e.task_id,e.actor_id,e.action,e.occurred_at,(e.occurred_at at time zone 'Asia/Seoul')::date as report_date,
 e.after_value->>'center_code' as center_code,e.after_value->>'title' as title,e.after_value->>'status' as status,e.after_value->'inputs' as inputs,
 e.incident_id,e.request_body->'data'->>'note' as action_note,e.request_body->'data'->>'memo' as handoff_memo
from public.operations_task_events e where e.template_id is null and e.survey_id is null;
revoke all on function public.operations_portal_context(),public.operations_handoff_people(text),public.operations_reopen_task(uuid,uuid,integer),public.operations_read_notification(bigint),public.operations_survey_action(uuid,uuid,integer,text,jsonb),public.operations_notify_event() from public,anon;
grant execute on function public.operations_portal_context(),public.operations_handoff_people(text),public.operations_reopen_task(uuid,uuid,integer),public.operations_read_notification(bigint),public.operations_survey_action(uuid,uuid,integer,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;


