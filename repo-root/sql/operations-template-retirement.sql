begin;
create or replace function public.operations_retire_custom_template(p_request_id uuid,p_template_id uuid)
returns public.operations_templates language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.operations_templates; prior public.operations_task_events; body jsonb; before_row jsonb;
begin
 if auth.uid() is null or p_request_id is null then raise exception '로그인이 필요합니다' using errcode='42501';end if;
 select * into t from public.operations_templates where id=p_template_id;
 if not found or not public.operations_can_edit_resource('forms',t.center_code) then raise exception '업무 등록 수정 권한이 없습니다' using errcode='42501';end if;
 body:=jsonb_build_object('operation','retire_custom_template','template',p_template_id);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023';end if;return t;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.family_id::text,0));
 select * into t from public.operations_templates where id=p_template_id for update;
 if exists(select 1 from public.operations_templates where family_id=t.family_id and version>t.version) then raise exception '수정된 최신 업무를 다시 선택하세요' using errcode='40001';end if;
 if t.status<>'approved' then raise exception '이미 삭제된 업무입니다' using errcode='22023';end if;
 before_row:=to_jsonb(t);update public.operations_templates set status='retired' where id=t.id returning * into t;
 insert into public.operations_task_events(template_id,actor_id,request_id,request_body,action,before_value,after_value)values(t.id,auth.uid(),p_request_id,body,'template_retired',before_row,to_jsonb(t));return t;
end $$;
revoke all on function public.operations_retire_custom_template(uuid,uuid) from public,anon;
grant execute on function public.operations_retire_custom_template(uuid,uuid) to authenticated;
commit;
