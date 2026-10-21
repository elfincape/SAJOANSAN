begin;
create or replace function public.operations_publish_custom_template(p_request_id uuid,p_center text,p_title text,p_spec jsonb,p_family_id uuid default null)
returns public.operations_templates language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.operations_templates; prior public.operations_task_events; body jsonb; family uuid; f jsonb;
begin
 if auth.uid() is null or p_request_id is null or not public.operations_can_write(p_center) then raise exception '센터 업무등록 권한이 없습니다' using errcode='42501'; end if;
 perform public.operations_validate_template(p_spec);
 if nullif(trim(p_title),'') is null or length(p_title)>200 or coalesce(p_spec->>'ui_cadence','') not in ('none','daily','weekly','monthly')
 or jsonb_array_length(p_spec->'fields')>50 or jsonb_array_length(p_spec->'steps')>50 then raise exception '업무명·주기·입력 항목을 확인하세요' using errcode='22023'; end if;
 for f in select value from jsonb_array_elements(p_spec->'fields') loop
  if coalesce(f->>'control','') not in ('text','textarea','number','checkbox','date','select')
   or f->>'type' is distinct from (case f->>'control' when 'number' then 'number' when 'checkbox' then 'boolean' else 'string' end) then raise exception '입력 방식과 값 형식이 일치하지 않습니다' using errcode='22023'; end if;
  if f->>'control'='select' then
   if jsonb_typeof(f->'options') is distinct from 'array' then raise exception '선택 목록을 입력하세요' using errcode='22023'; end if;
   if jsonb_array_length(f->'options') not between 1 and 100 or exists(select 1 from jsonb_array_elements(f->'options') x where jsonb_typeof(x)<>'string' or nullif(trim(x#>>'{}'),'') is null) then raise exception '선택 목록을 확인하세요' using errcode='22023'; end if;
  end if;
 end loop;
 body:=jsonb_build_object('operation','publish_custom_template','center',p_center,'title',p_title,'spec',p_spec,'family',p_family_id);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
  select * into t from public.operations_templates where id=prior.template_id;return t;
 end if;
 family:=coalesce(p_family_id,gen_random_uuid());perform pg_advisory_xact_lock(hashtextextended(family::text,0));
 if p_family_id is not null and not exists(select 1 from public.operations_templates where family_id=family and center_code=p_center) then raise exception '수정할 센터 양식을 찾을 수 없습니다' using errcode='22023'; end if;
 if exists(select 1 from public.operations_templates where family_id=family and center_code<>p_center) then raise exception '다른 센터의 양식은 수정할 수 없습니다' using errcode='42501'; end if;
 insert into public.operations_templates(family_id,version,center_code,title,spec,status,created_by,approved_by,approved_at)
 values(family,(select coalesce(max(version),0)+1 from public.operations_templates where family_id=family),p_center,trim(p_title),
 p_spec||jsonb_build_object('manual_issue',true,'owner_ids','[]'::jsonb),'approved',auth.uid(),auth.uid(),now()) returning * into t;
 insert into public.operations_task_events(template_id,actor_id,request_id,request_body,action,after_value)
 values(t.id,auth.uid(),p_request_id,body,'template_approved',to_jsonb(t));return t;
end; $$;

create or replace function public.operations_issue_custom_task(p_request_id uuid,p_template_id uuid,p_work_date date)
returns public.operations_tasks language plpgsql security definer set search_path=public,pg_temp as $$
declare template public.operations_templates; t public.operations_tasks; prior public.operations_task_events; body jsonb; occurrence text; period_date date; cadence text; steps jsonb;
begin
 if auth.uid() is null or p_request_id is null or p_work_date is null then raise exception '티켓 발행 요청을 확인하세요' using errcode='22023'; end if;
 select * into template from public.operations_templates where id=p_template_id for share;
 if not found or not public.operations_can_write(template.center_code) then raise exception '센터 업무 발행 권한이 없습니다' using errcode='42501'; end if;
 body:=jsonb_build_object('operation','issue_custom_task','template',p_template_id,'date',p_work_date);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
  select * into t from public.operations_tasks where id=prior.task_id;return t;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(template.family_id::text,0));
 if template.status<>'approved' or coalesce(template.spec->>'manual_issue','false')<>'true'
 or coalesce((template.spec->>'effective_from')::date,(template.approved_at at time zone 'Asia/Seoul')::date)>p_work_date
 or exists(select 1 from public.operations_templates x where x.family_id=template.family_id and x.version>template.version and x.status in ('approved','retired') and coalesce((x.spec->>'effective_from')::date,(x.approved_at at time zone 'Asia/Seoul')::date)<=p_work_date) then raise exception '현재 사용할 수 있는 최신 업무 양식이 필요합니다' using errcode='22023'; end if;
 cadence:=template.spec->>'ui_cadence';
 if cadence is null or cadence not in ('none','daily','weekly','monthly') then raise exception '업무 주기를 확인하세요' using errcode='22023'; end if;
 period_date:=case cadence when 'weekly' then p_work_date-(extract(isodow from p_work_date)::integer-1) when 'monthly' then date_trunc('month',p_work_date)::date else p_work_date end;
 -- One center ticket per configured period, independent of who presses the button.
 occurrence:='custom:'||template.family_id::text||':'||cadence||':'||case when cadence='none' then p_request_id::text else period_date::text end;
 perform pg_advisory_xact_lock(hashtextextended(occurrence,0));
 select * into t from public.operations_tasks where occurrence_key=occurrence;
 if not found then
  select coalesce(jsonb_object_agg(value->>'key','pending'::text),'{}') into steps from jsonb_array_elements(template.spec->'steps');
  insert into public.operations_tasks(center_code,title,work_date,owner_id,created_by,inputs,template_id,template_snapshot,occurrence_key)
  values(template.center_code,template.title,p_work_date,auth.uid(),auth.uid(),jsonb_build_object('steps',steps),template.id,to_jsonb(template),occurrence) returning * into t;
  insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,after_value)
  values(t.id,auth.uid(),p_request_id,body,'created',to_jsonb(t));
 else
  -- Audit the reused ticket as well, so retrying this request remains deterministic.
  insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
  values(t.id,auth.uid(),p_request_id,body,'updated',to_jsonb(t),to_jsonb(t));
 end if;
 return t;
end; $$;

create or replace function public.operations_validate_custom_inputs() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare f jsonb; v text;
begin
 for f in select value from jsonb_array_elements(coalesce(new.template_snapshot->'spec'->'fields','[]'::jsonb)) loop
  v:=new.inputs->>(f->>'key');if v is null or v='' then continue;end if;
  if f->>'control'='date' then
   if v !~ '^\d{4}-\d{2}-\d{2}$' or to_char(v::date,'YYYY-MM-DD')<>v then raise exception '% 날짜를 확인하세요',f->>'label' using errcode='22023';end if;
  elsif f->>'control'='select' and not (f->'options' @> jsonb_build_array(v)) then raise exception '% 선택 목록의 값을 사용하세요',f->>'label' using errcode='22023';end if;
 end loop;return new;
end; $$;
drop trigger if exists operations_custom_inputs on public.operations_tasks;
create trigger operations_custom_inputs before insert or update on public.operations_tasks for each row execute function public.operations_validate_custom_inputs();
revoke all on function public.operations_publish_custom_template(uuid,text,text,jsonb,uuid),public.operations_issue_custom_task(uuid,uuid,date),public.operations_validate_custom_inputs() from public,anon;
grant execute on function public.operations_publish_custom_template(uuid,text,text,jsonb,uuid),public.operations_issue_custom_task(uuid,uuid,date) to authenticated;
notify pgrst,'reload schema';
commit;
