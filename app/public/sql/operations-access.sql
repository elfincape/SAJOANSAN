begin;
alter table public.operations_task_events add column membership_user_id uuid references public.user_profiles(id);
alter table public.operations_task_events drop constraint operations_event_original;
alter table public.operations_task_events add constraint operations_event_original check(num_nonnulls(task_id,incident_id,template_id,survey_id,membership_user_id)=1);
alter table public.operations_task_events drop constraint operations_task_events_action_check;
alter table public.operations_task_events add constraint operations_task_events_action_check check(action in
 ('created','updated','completed','not_applicable','handoff','deadline','incident_created','incident_updated','support_requested','support_action','resolved','reopened','template_created','template_approved','template_retired','task_reopened','survey_submit','survey_edit','survey_stage','survey_template','membership_assigned','membership_revoked'));
create function public.operations_staff_access() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then raise exception 'HQ 권한이 필요합니다' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.display_name,''),p.email,'직원'),'role',p.role,'centers',(select coalesce(jsonb_agg(center_code order by center_code),'[]') from public.operations_center_members where user_id=p.id)) order by p.display_name,p.email),'[]') from public.user_profiles p where p.active and p.role in ('admin','editor'));
end $$;
create function public.operations_set_membership(p_request_id uuid,p_user_id uuid,p_center text,p_expected boolean,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.operations_task_events;body jsonb;currently boolean;after_row jsonb;
begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then raise exception 'HQ 권한이 필요합니다' using errcode='42501';end if;
 if p_request_id is null or p_enabled is null or p_expected is null then raise exception '소속 배정 요청을 확인해 주세요' using errcode='22023';end if;
 body:=jsonb_build_object('operation','membership','user',p_user_id,'center',p_center,'expected',p_expected,'enabled',p_enabled);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023';end if;
  return prior.after_value;
 end if;
 if not exists(select 1 from public.user_profiles where id=p_user_id and active and role='editor')
  or not exists(select 1 from public.centers where code=p_center and active) then raise exception '활성 센터 직원과 센터를 선택해 주세요' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('membership:'||p_user_id::text||':'||p_center,0));
 select exists(select 1 from public.operations_center_members where user_id=p_user_id and center_code=p_center) into currently;
 if currently<>p_expected then raise exception '다른 관리자가 소속을 변경했습니다. 다시 확인해 주세요' using errcode='40001';end if;
 if p_enabled then insert into public.operations_center_members(user_id,center_code) values(p_user_id,p_center) on conflict do nothing;
 else delete from public.operations_center_members where user_id=p_user_id and center_code=p_center;end if;
 after_row:=jsonb_build_object('user_id',p_user_id,'center_code',p_center,'enabled',p_enabled);
 insert into public.operations_task_events(membership_user_id,actor_id,request_id,request_body,action,before_value,after_value)
 values(p_user_id,auth.uid(),p_request_id,body,case when p_enabled then 'membership_assigned' else 'membership_revoked' end,jsonb_build_object('enabled',currently),after_row);
 return after_row;
end $$;
create or replace view public.operations_daily_log with(security_invoker=true) as
select e.id,e.task_id,e.actor_id,e.action,e.occurred_at,(e.occurred_at at time zone 'Asia/Seoul')::date as report_date,
 e.after_value->>'center_code' as center_code,e.after_value->>'title' as title,e.after_value->>'status' as status,e.after_value->'inputs' as inputs,
 e.incident_id,e.request_body->'data'->>'note' as action_note,e.request_body->'data'->>'memo' as handoff_memo
from public.operations_task_events e where e.template_id is null and e.survey_id is null and e.membership_user_id is null;
revoke all on function public.operations_staff_access(),public.operations_set_membership(uuid,uuid,text,boolean,boolean) from public,anon;
grant execute on function public.operations_staff_access(),public.operations_set_membership(uuid,uuid,text,boolean,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
