begin;
alter table public.operations_tasks add column if not exists work_end_date date;
alter table public.operations_tasks add constraint operations_task_period_valid check(work_end_date is null or work_end_date>=work_date);
create function public.operations_normalize_task_period() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.work_end_date is null then new.work_end_date:=new.work_date;end if;
 if new.work_end_date<new.work_date then raise exception '종료일은 시작일보다 빠를 수 없습니다' using errcode='22023';end if;
 return new;
end $$;
create trigger operations_task_period before insert or update of work_date,work_end_date on public.operations_tasks for each row execute function public.operations_normalize_task_period();
-- Extend the currently deployed functions, retaining their authorization, audit,
-- optimistic concurrency, completion and idempotency safeguards.
do $migration$
declare source text;
begin
 source:=pg_get_functiondef('public.operations_save_task(uuid,uuid,integer,text,text,date,jsonb,text)'::regprocedure);
 if position('work_date=p_work_date,inputs=p_inputs' in source)=0 or position('work_date,owner_id,created_by,inputs)' in source)=0 then raise exception '업무 저장 함수 형식을 확인하세요';end if;
 source:=replace(source,'operations_save_task(','operations_save_task_period(');
 source:=replace(source,'p_status text)','p_status text, p_end_date date)');
 source:=replace(source,'begin',E'begin\n  if p_end_date is null or p_end_date<p_work_date then raise exception ''종료일은 시작일 이후로 설정하세요'' using errcode=''22023'';end if;');
 source:=replace(source,'''date'',p_work_date,','''date'',p_work_date,''end_date'',p_end_date,');
 source:=replace(source,'work_date,owner_id,created_by,inputs)','work_date,work_end_date,owner_id,created_by,inputs)');
 source:=replace(source,'p_work_date,v_actor,v_actor,p_inputs)','p_work_date,p_end_date,v_actor,v_actor,p_inputs)');
 source:=replace(source,'work_date=p_work_date,inputs=p_inputs','work_date=p_work_date,work_end_date=p_end_date,inputs=p_inputs');
 execute source;
 source:=pg_get_functiondef('public.operations_issue_custom_task(uuid,uuid,date)'::regprocedure);
 if position('work_date,owner_id,created_by,inputs,template_id' in source)=0 then raise exception '업무 발행 함수 형식을 확인하세요';end if;
 source:=replace(source,'operations_issue_custom_task(','operations_issue_task_period(');
 source:=replace(source,'p_work_date date)','p_work_date date, p_end_date date)');
 source:=replace(source,'begin',E'begin\n if p_end_date is null or p_end_date<p_work_date then raise exception ''종료일은 시작일 이후로 설정하세요'' using errcode=''22023'';end if;');
 source:=replace(source,'''date'',p_work_date)', '''date'',p_work_date,''end_date'',p_end_date)');
 source:=replace(source,' or coalesce(template.spec->>''manual_issue'',''false'')<>''true''','');
 source:=replace(source,'cadence:=template.spec->>''ui_cadence'';','cadence:=coalesce(template.spec->>''ui_cadence'',''none'');');
 source:=replace(source,'work_date,owner_id,created_by,inputs,template_id','work_date,work_end_date,owner_id,created_by,inputs,template_id');
 source:=replace(source,'p_work_date,auth.uid(),auth.uid(),','p_work_date,p_end_date,auth.uid(),auth.uid(),');
 execute source;
 source:=pg_get_functiondef('public.operations_template_deadlines()'::regprocedure);
 source:=replace(source,'new.work_date+','coalesce(new.work_end_date,new.work_date)+');execute source;
end $migration$;
revoke all on function public.operations_normalize_task_period(),public.operations_save_task_period(uuid,uuid,integer,text,text,date,jsonb,text,date),public.operations_issue_task_period(uuid,uuid,date,date) from public,anon;
grant execute on function public.operations_save_task_period(uuid,uuid,integer,text,text,date,jsonb,text,date),public.operations_issue_task_period(uuid,uuid,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
