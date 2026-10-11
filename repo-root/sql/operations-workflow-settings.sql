begin;
create or replace function public.operations_workflow_template_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare integration jsonb:=new.spec->'integration'; day jsonb; f jsonb;
begin
 if new.spec->>'ui_cadence'='daily' and new.spec->'repeat'->>'kind'='weekdays' then
  if jsonb_typeof(new.spec->'repeat'->'days') is distinct from 'array' or jsonb_array_length(new.spec->'repeat'->'days') not between 1 and 7 then raise exception '실행 요일을 선택하세요' using errcode='22023';end if;
  for day in select value from jsonb_array_elements(new.spec->'repeat'->'days') loop if jsonb_typeof(day)<>'number' or (day#>>'{}')!~ '^[1-7]$' then raise exception '실행 요일을 확인하세요' using errcode='22023';end if;end loop;
 end if;
 if new.spec ? 'external_process' and (jsonb_typeof(new.spec->'external_process')<>'array' or exists(select 1 from jsonb_array_elements(new.spec->'external_process') v where jsonb_typeof(v)<>'string')) then raise exception '외부 업무 프로세스를 확인하세요' using errcode='22023';end if;
 if integration is not null then
  if integration->>'kind' is distinct from 'coupang_entry' or coalesce(integration->>'capture_range','')!~ '^[A-Z]{1,3}[1-9][0-9]{0,3}:[A-Z]{1,3}[1-9][0-9]{0,3}$' then raise exception '업무 도움 연동·이미지 범위를 확인하세요' using errcode='22023';end if;
  if not exists(select 1 from jsonb_array_elements(new.spec->'fields') v where v->>'key'=integration->>'dispatch_field' and v->>'control' in ('text','textarea')) then raise exception '배차정보 입력 항목을 선택하세요' using errcode='22023';end if;
 end if;
 return new;
end;$$;
drop trigger if exists operations_workflow_template on public.operations_templates;
create trigger operations_workflow_template before insert or update on public.operations_templates for each row execute function public.operations_workflow_template_guard();
create or replace function public.operations_workflow_task_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare spec jsonb:=new.template_snapshot->'spec'; result jsonb:=new.inputs->'coupang_result'; file_id jsonb;
begin
 if (tg_op='INSERT' or new.work_date is distinct from old.work_date) and spec->>'ui_cadence'='daily' and spec->'repeat'->>'kind'='weekdays'
 and not (spec->'repeat'->'days' @> jsonb_build_array(extract(isodow from new.work_date)::integer)) then raise exception '이 업무의 실행 요일이 아닙니다. 설정한 요일에 발행하세요' using errcode='22023';end if;
 if spec->'integration'->>'kind'='coupang_entry' and new.status='completed' then
  if coalesce(new.inputs->>'coupang_source_id','')!~ '^[0-9a-f-]{36}$' or not exists(select 1 from public.operations_files where id=(new.inputs->>'coupang_source_id')::uuid and task_id=new.id and status='saved') then raise exception '배차표 사진을 업무에 등록하세요' using errcode='22023';end if;
  if result is null or jsonb_typeof(result->'files') is distinct from 'array' or result->>'dispatch' is distinct from new.inputs->>(spec->'integration'->>'dispatch_field') or result->'schedule' is distinct from new.inputs->'coupang_schedule' then raise exception '현재 배차정보로 엑셀을 생성·첨부한 후 완료하세요' using errcode='22023';end if;
  if not exists(select 1 from public.operations_files f where f.task_id=new.id and f.status='saved' and f.mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and result->'files' @> jsonb_build_array(f.id::text)) then raise exception '생성 엑셀을 업무에 첨부하세요' using errcode='22023';end if;
 end if;
 return new;
end;$$;
drop trigger if exists operations_workflow_task on public.operations_tasks;
create trigger operations_workflow_task before insert or update on public.operations_tasks for each row execute function public.operations_workflow_task_guard();
revoke all on function public.operations_workflow_template_guard(),public.operations_workflow_task_guard() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
