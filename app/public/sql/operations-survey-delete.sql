begin;
alter table public.operations_surveys add column if not exists deleted_at timestamptz;
drop policy if exists operations_surveys_live on public.operations_surveys;
create policy operations_surveys_live on public.operations_surveys as restrictive for select to authenticated using (deleted_at is null);
create or replace function public.operations_survey_delete(p_request_id uuid,p_id uuid,p_expected_version integer)
returns public.operations_surveys language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.operations_surveys; prior public.operations_task_events; body jsonb; before_row jsonb;
begin
 if p_request_id is null or not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501'; end if;
 body=jsonb_build_object('operation','survey_delete','id',p_id,'version',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into s from public.operations_surveys where id=p_id for update;
 if not found or not public.operations_can_write(s.center_code) or not public.operations_resource_allowed('forms','edit',s.center_code)
 then raise exception '센터 업무조사 수정 권한이 없습니다' using errcode='42501'; end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
  return s;
 end if;
 if s.version is distinct from p_expected_version or s.deleted_at is not null then raise exception '다른 사용자가 수정했습니다. 새로고침해 주세요' using errcode='40001'; end if;
 before_row=to_jsonb(s);
 update public.operations_surveys set deleted_at=now(),updated_by=auth.uid(),updated_at=now(),version=version+1 where id=s.id returning * into s;
 insert into public.operations_task_events(survey_id,actor_id,request_id,request_body,action,before_value,after_value)
 values(s.id,auth.uid(),p_request_id,body,'survey_edit',before_row,to_jsonb(s));
 return s;
end $$;
revoke all on function public.operations_survey_delete(uuid,uuid,integer) from public,anon;
grant execute on function public.operations_survey_delete(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
