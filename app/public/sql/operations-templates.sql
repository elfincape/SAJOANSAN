-- Approved immutable versions; existing tasks keep their original template snapshot.
begin;
create table public.operations_templates (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null,
 version integer not null check(version>0),
 center_code text not null references public.centers(code),
 title text not null check(length(trim(title)) between 1 and 200),
 spec jsonb not null check(jsonb_typeof(spec)='object'),
 status text not null default 'draft' check(status in ('draft','approved','retired')),
 created_by uuid not null references public.user_profiles(id),
 approved_by uuid references public.user_profiles(id),
 approved_at timestamptz,
 created_at timestamptz not null default now(),
 unique(family_id,version)
);
alter table public.operations_templates enable row level security;
create policy operations_templates_read on public.operations_templates for select to authenticated using(public.operations_can_read());
revoke all on public.operations_templates from anon,authenticated;
grant select on public.operations_templates to authenticated;
alter table public.operations_tasks add column template_id uuid references public.operations_templates(id),
 add column template_snapshot jsonb,add column occurrence_key text unique,
 add constraint operations_template_snapshot_pair check((template_id is null)=(template_snapshot is null));
alter table public.operations_task_events add column template_id uuid references public.operations_templates(id);
alter table public.operations_task_events drop constraint operations_event_original;
alter table public.operations_task_events add constraint operations_event_original
 check(num_nonnulls(task_id,incident_id,template_id)=1);
alter table public.operations_task_events drop constraint operations_task_events_action_check;
alter table public.operations_task_events add constraint operations_task_events_action_check check(action in
 ('created','updated','completed','not_applicable','handoff','deadline','incident_created','incident_updated',
  'support_requested','support_action','resolved','reopened','template_created','template_approved','template_retired'));

create function public.operations_validate_template(p_spec jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
declare f jsonb; step jsonb; keys text[]:='{}'; step_keys text[]:='{}'; repeat_kind text;
begin
 if p_spec is null or jsonb_typeof(p_spec)<>'object' or jsonb_typeof(p_spec->'fields') is distinct from 'array'
   or jsonb_typeof(p_spec->'steps') is distinct from 'array' then
   raise exception '입력항목과 업무 단계 양식을 확인해 주세요' using errcode='22023'; end if;
 for f in select value from jsonb_array_elements(p_spec->'fields') loop
   if f->>'key' is null or (f->>'key') !~ '^[a-zA-Z][a-zA-Z0-9_]{0,59}$' or f->>'key'='steps'
     or f->>'key'=any(keys) or nullif(trim(f->>'label'),'') is null
     or f->>'type' is null or f->>'type' not in ('string','number','boolean')
     or (f ? 'required_on_complete' and jsonb_typeof(f->'required_on_complete')<>'boolean') then
     raise exception '입력항목 키, 표시명, 형식이 올바르지 않습니다' using errcode='22023'; end if;
   keys:=array_append(keys,f->>'key');
 end loop;
 for step in select value from jsonb_array_elements(p_spec->'steps') loop
   if step->>'key' is null or (step->>'key') !~ '^[a-zA-Z][a-zA-Z0-9_]{0,59}$'
     or step->>'key'=any(step_keys) or nullif(trim(step->>'label'),'') is null then
     raise exception '업무 단계 키와 표시명을 확인해 주세요' using errcode='22023'; end if;
   step_keys:=array_append(step_keys,step->>'key');
 end loop;
 repeat_kind:=coalesce(p_spec->'repeat'->>'kind','none');
 if repeat_kind not in ('none','daily','weekdays','monthly','once') then
   raise exception '반복 주기를 확인해 주세요' using errcode='22023'; end if;
 if repeat_kind='weekdays' then
   if jsonb_typeof(p_spec->'repeat'->'days') is distinct from 'array'
     or jsonb_array_length(p_spec->'repeat'->'days')=0 then
     raise exception '반복 요일을 선택해 주세요' using errcode='22023'; end if;
   for f in select value from jsonb_array_elements(p_spec->'repeat'->'days') loop
     if jsonb_typeof(f)<>'number' or f::text !~ '^[1-7]$' then
       raise exception '반복 요일은 월요일 1부터 일요일 7까지입니다' using errcode='22023'; end if;
   end loop;
 end if;
 if repeat_kind='monthly' and (coalesce(p_spec->'repeat'->>'day','') !~ '^([1-9]|[12][0-9]|3[01])$') then
   raise exception '월 반복 날짜를 확인해 주세요' using errcode='22023'; end if;
 if repeat_kind='once' and nullif(p_spec->'repeat'->>'date','') is null then
   raise exception '1회 업무 날짜를 입력해 주세요' using errcode='22023'; end if;
 if repeat_kind='once' then perform (p_spec->'repeat'->>'date')::date; end if;
 if p_spec ? 'effective_from' then perform (p_spec->>'effective_from')::date; end if;
end;
$$;
create function public.operations_template_action(p_request_id uuid,p_template_id uuid,p_action text,p_data jsonb)
returns public.operations_templates language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.operations_templates; prior public.operations_task_events; body jsonb; family uuid; before_row jsonb;
begin
 if p_request_id is null or not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then
   raise exception 'HQ 양식 관리 권한이 필요합니다' using errcode='42501'; end if;
 if p_action is null or p_action not in ('create','approve','retire') or p_data is null or jsonb_typeof(p_data)<>'object' then
   raise exception '양식 관리 요청을 확인해 주세요' using errcode='22023'; end if;
 body:=jsonb_build_object('operation','template_action','template',p_template_id,'action',p_action,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
   select * into t from public.operations_templates where id=prior.template_id; return t;
 end if;
 if p_action='create' then
   if p_template_id is not null then raise exception '신규 양식 ID는 서버에서 생성합니다' using errcode='22023'; end if;
   perform public.operations_validate_template(p_data->'spec');
   family:=coalesce((p_data->>'family_id')::uuid,gen_random_uuid());
   perform pg_advisory_xact_lock(hashtextextended(family::text,0));
   if exists(select 1 from public.operations_templates where family_id=family and center_code<>p_data->>'center_code') then
     raise exception '다른 센터 양식과 버전을 공유할 수 없습니다' using errcode='22023'; end if;
   insert into public.operations_templates(family_id,version,center_code,title,spec,created_by)
     values(family,(select coalesce(max(version),0)+1 from public.operations_templates where family_id=family),
       p_data->>'center_code',trim(p_data->>'title'),p_data->'spec',auth.uid()) returning * into t;
 else
   select * into t from public.operations_templates where id=p_template_id for update;
   if not found then raise exception '양식을 찾을 수 없습니다' using errcode='22023'; end if;
   before_row:=to_jsonb(t);
   if p_action='approve' then
     if t.status<>'draft' then raise exception '초안만 승인할 수 있습니다' using errcode='22023'; end if;
     perform public.operations_validate_template(t.spec);
     update public.operations_templates set status='approved',approved_by=auth.uid(),approved_at=now()
       where id=t.id returning * into t;
   else
     if t.status<>'approved' then raise exception '승인 양식만 사용 중지할 수 있습니다' using errcode='22023'; end if;
     update public.operations_templates set status='retired' where id=t.id returning * into t;
   end if;
 end if;
 insert into public.operations_task_events(template_id,actor_id,request_id,request_body,action,before_value,after_value)
   values(t.id,auth.uid(),p_request_id,body,case p_action when 'create' then 'template_created'
     when 'approve' then 'template_approved' else 'template_retired' end,before_row,to_jsonb(t));
 return t;
end;
$$;

create function public.operations_validate_task_inputs() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare f jsonb; field_value jsonb; step jsonb; step_status text;
begin
 if new.template_snapshot is null then return new; end if;
 if tg_op='UPDATE' and (new.template_id is distinct from old.template_id
   or new.template_snapshot is distinct from old.template_snapshot) then
   raise exception '기존 업무의 양식 버전은 유지합니다' using errcode='22023'; end if;
 for f in select value from jsonb_array_elements(new.template_snapshot->'spec'->'fields') loop
   field_value:=new.inputs->(f->>'key');
   if field_value is not null and field_value<>'null'::jsonb and jsonb_typeof(field_value)<>f->>'type' then
     raise exception '% 입력 형식을 확인해 주세요',f->>'label' using errcode='22023'; end if;
   if new.status='completed' and coalesce((f->>'required_on_complete')::boolean,false)
     and (field_value is null or field_value='null'::jsonb or (jsonb_typeof(field_value)='string' and trim(field_value#>>'{}')='')) then
     raise exception '% 입력 후 완료해 주세요',f->>'label' using errcode='22023'; end if;
 end loop;
 for step in select value from jsonb_array_elements(new.template_snapshot->'spec'->'steps') loop
   step_status:=new.inputs->'steps'->>(step->>'key');
   if step_status is null or step_status not in ('pending','in_progress','completed','not_applicable') then
     raise exception '% 단계 상태를 확인해 주세요',step->>'label' using errcode='22023'; end if;
   if new.status='completed' and step_status not in ('completed','not_applicable') then
     raise exception '% 단계 처리 후 완료해 주세요',step->>'label' using errcode='22023'; end if;
 end loop;
 return new;
end;
$$;
create trigger operations_task_inputs before insert or update on public.operations_tasks
 for each row execute function public.operations_validate_task_inputs();

create function public.operations_task_from_template(p_request_id uuid,p_template_id uuid,p_work_date date,
 p_inputs jsonb,p_owner_id uuid default null,p_recurring boolean default false)
returns public.operations_tasks language plpgsql security definer set search_path=public,pg_temp as $$
declare template public.operations_templates; t public.operations_tasks; prior public.operations_task_events;
 body jsonb; owner uuid:=coalesce(p_owner_id,auth.uid()); steps jsonb; occurrence text; repeat_kind text;
begin
 if auth.uid() is null or p_request_id is null or p_work_date is null or p_recurring is null
   or p_inputs is null or jsonb_typeof(p_inputs)<>'object' then
   raise exception '업무 생성 요청을 확인해 주세요' using errcode='22023'; end if;
 select * into template from public.operations_templates where id=p_template_id;
 if not found or not public.operations_can_write(template.center_code) then
   raise exception '해당 센터 업무 생성 권한이 없습니다' using errcode='42501'; end if;
 body:=jsonb_build_object('operation','from_template','template',p_template_id,'date',p_work_date,'inputs',p_inputs,'owner',owner,'recurring',p_recurring);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
   select * into t from public.operations_tasks where id=prior.task_id; return t;
 end if;
 if template.status<>'approved' or coalesce((template.spec->>'effective_from')::date,(template.approved_at at time zone 'Asia/Seoul')::date)>p_work_date
   or exists(select 1 from public.operations_templates other where other.family_id=template.family_id
     and other.status in ('approved','retired') and other.version>template.version
     and coalesce((other.spec->>'effective_from')::date,(other.approved_at at time zone 'Asia/Seoul')::date)<=p_work_date) then
   raise exception '해당 날짜의 최신 승인 양식이 필요합니다' using errcode='22023'; end if;
 if not exists(select 1 from public.user_profiles p where p.id=owner and p.active and (p.role='admin'
   or (p.role='editor' and exists(select 1 from public.operations_center_members m
     where m.user_id=p.id and m.center_code=template.center_code)))) then
   raise exception '담당자의 센터 업무 권한을 확인해 주세요' using errcode='22023'; end if;
 if p_inputs ? 'steps' then raise exception '새 업무의 단계는 미완료로 시작합니다' using errcode='22023'; end if;
 if p_recurring then
   repeat_kind:=coalesce(template.spec->'repeat'->>'kind','none');
   if not (repeat_kind='daily' or (repeat_kind='weekdays' and template.spec->'repeat'->'days' @> to_jsonb(array[extract(isodow from p_work_date)::integer]))
     or (repeat_kind='monthly' and extract(day from p_work_date)::integer=(template.spec->'repeat'->>'day')::integer)
     or (repeat_kind='once' and p_work_date=(template.spec->'repeat'->>'date')::date)) then
     raise exception '반복 일정에 해당하지 않는 날짜입니다' using errcode='22023'; end if;
   occurrence:=template.family_id::text||':'||p_work_date::text||':'||owner::text;
   perform pg_advisory_xact_lock(hashtextextended(occurrence,0));
   select * into t from public.operations_tasks where occurrence_key=occurrence;
   if found then return t; end if;
 end if;
 select coalesce(jsonb_object_agg(value->>'key','pending'::text),'{}') into steps
   from jsonb_array_elements(template.spec->'steps');
 insert into public.operations_tasks(center_code,title,work_date,owner_id,created_by,inputs,template_id,template_snapshot,occurrence_key)
   values(template.center_code,template.title,p_work_date,owner,auth.uid(),p_inputs||jsonb_build_object('steps',steps),
     template.id,to_jsonb(template),occurrence) returning * into t;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,after_value)
   values(t.id,auth.uid(),p_request_id,body,'created',to_jsonb(t));
 return t;
end;
$$;
revoke all on function public.operations_validate_template(jsonb),public.operations_validate_task_inputs(),
 public.operations_template_action(uuid,uuid,text,jsonb),public.operations_task_from_template(uuid,uuid,date,jsonb,uuid,boolean) from public,anon;
grant execute on function public.operations_template_action(uuid,uuid,text,jsonb),
 public.operations_task_from_template(uuid,uuid,date,jsonb,uuid,boolean) to authenticated;
-- Configuration audit events do not become staff daily work entries.
create or replace view public.operations_daily_log with(security_invoker=true) as
select e.id,e.task_id,e.actor_id,e.action,e.occurred_at,
 (e.occurred_at at time zone 'Asia/Seoul')::date as report_date,
 e.after_value->>'center_code' as center_code,e.after_value->>'title' as title,
 e.after_value->>'status' as status,e.after_value->'inputs' as inputs,
 e.incident_id,e.request_body->'data'->>'note' as action_note,e.request_body->'data'->>'memo' as handoff_memo
from public.operations_task_events e where e.template_id is null;
commit;
