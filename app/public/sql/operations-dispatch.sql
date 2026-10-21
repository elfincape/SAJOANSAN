begin;
alter table public.operations_task_events drop constraint operations_task_events_action_check;
alter table public.operations_task_events add constraint operations_task_events_action_check check(action in
 ('created','updated','completed','not_applicable','handoff','deadline','incident_created','incident_updated','support_requested','support_action','resolved','reopened','template_created','template_approved','template_retired','task_reopened','survey_submit','survey_edit','survey_stage','survey_template','membership_assigned','membership_revoked','cj_shared','cj_share_retracted'));
create function public.operations_record_cj_share(p_request_id uuid,p_task_id uuid,p_expected_version integer,p_shared boolean,p_note text)
returns public.operations_tasks language plpgsql security definer set search_path=public,pg_temp as $$
declare task public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb;
begin
 if auth.uid() is null or p_request_id is null or p_shared is null or nullif(trim(p_note),'') is null or length(p_note)>2000 then
  raise exception '실제 공유 내용 또는 정정 사유를 입력해 주세요' using errcode='22023';end if;
 body:=jsonb_build_object('operation','cj_share','task',p_task_id,'version',p_expected_version,'shared',p_shared,'data',jsonb_build_object('note',trim(p_note)));
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into task from public.operations_tasks where id=p_task_id for update;
 if not found or not public.operations_can_write(task.center_code) then raise exception '업무 수정 권한이 없습니다' using errcode='42501';end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023';end if;
  return task;
 end if;
 if p_expected_version is null or task.version<>p_expected_version then raise exception '다른 사용자가 수정했습니다' using errcode='40001';end if;
 if task.status in ('completed','not_applicable') then raise exception '확정된 업무는 먼저 다시 열어 주세요' using errcode='22023';end if;
 if coalesce(task.inputs->>'cj_shared','false')=p_shared::text then raise exception '공유 상태가 이미 기록되어 있습니다' using errcode='22023';end if;
 before_row:=to_jsonb(task);
 update public.operations_tasks set inputs=inputs||jsonb_build_object('cj_shared',p_shared,'cj_shared_at',case when p_shared then now() else null end,'cj_shared_by',case when p_shared then auth.uid() else null end,'cj_share_note',trim(p_note)),version=version+1,updated_at=now()
  where id=task.id returning * into task;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
 values(task.id,auth.uid(),p_request_id,body,case when p_shared then 'cj_shared' else 'cj_share_retracted' end,before_row,to_jsonb(task));
 return task;
end $$;
revoke all on function public.operations_record_cj_share(uuid,uuid,integer,boolean,text) from public,anon;
grant execute on function public.operations_record_cj_share(uuid,uuid,integer,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
