begin;
create or replace function public.operations_incident_action(p_request_id uuid,p_incident_id uuid,p_expected_version integer,
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
   if linked_task is null then raise exception '하던 업무에서 특이사항을 등록해 주세요' using errcode='22023'; end if;
   perform 1 from public.operations_tasks where id=linked_task and center_code=center for share;
   if not found then raise exception '관련 업무의 센터가 일치하지 않습니다' using errcode='22023'; end if;
   insert into public.operations_incidents(center_code,task_id,title,kind,inputs,created_by)
     values(center,linked_task,trim(p_data->>'title'),trim(p_data->>'kind'),coalesce(p_data->'inputs','{}'),auth.uid())
     returning * into i;
   event_action:='incident_created';
 else
   select * into i from public.operations_incidents where id=p_incident_id for update;
   if not found then raise exception '특이사항을 찾을 수 없습니다' using errcode='22023'; end if;
   -- Independent 배송팀 actions append without claiming exclusive ownership.
   if p_action<>'support' and (p_expected_version is null or i.version<>p_expected_version) then
     raise exception '다른 사용자가 수정했습니다' using errcode='40001'; end if;
   if p_action in ('edit','request_support') and not public.operations_can_write(i.center_code) then
     raise exception '특이사항 수정 권한이 없습니다' using errcode='42501'; end if;
   if p_action='support' and not is_hq then
     raise exception '배송팀 실제 조치 권한이 필요합니다' using errcode='42501'; end if;
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
     if (p_data ? 'title' or p_data ? 'inputs') and not public.operations_can_write(i.center_code) then raise exception '특이사항 내용 수정 권한이 없습니다' using errcode='42501'; end if;
     if i.status='resolved' then raise exception '이미 해결된 특이사항입니다' using errcode='22023'; end if;
     update public.operations_incidents set status='resolved',resolved_by=auth.uid(),resolved_at=now(),
       title=coalesce(trim(p_data->>'title'),title),
       inputs=coalesce(p_data->'inputs',inputs)||jsonb_build_object('처리내용',coalesce(p_data->>'note',p_data->'inputs'->>'처리내용',inputs->>'처리내용',''))
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

commit;
