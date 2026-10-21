-- Retain immutable task snapshots and remove obsolete completion requirements.
begin;
do $migration$
declare source text;
begin
 source:=pg_get_functiondef('public.operations_validate_task_inputs()'::regprocedure);
 if position('coupang_simple_completion' in source)=0 then
  if position('field_value:=new.inputs' in replace(source,' ',''))=0 then raise exception '업무 입력 함수 형식을 확인하세요';end if;
  source:=replace(source,'field_value:=new.inputs',E'-- coupang_simple_completion: old tickets use the same simplified workflow.\n   if new.template_snapshot->''spec''->''integration''->>''kind''=''coupang_entry'' and f->>''key'' in (''carrier_name'',''monitoring_note'') then continue;end if;\n   field_value:=new.inputs');
  if position('coupang_simple_completion' in source)=0 then raise exception '업무 입력 함수 변경을 확인하세요';end if;
  if position('step_status:=new.inputs' in source)=0 then raise exception '업무 단계 함수 형식을 확인하세요';end if;
  source:=replace(source,'step_status:=new.inputs',E'if new.template_snapshot->''spec''->''integration''->>''kind''=''coupang_entry'' then continue;end if;\n   step_status:=new.inputs');
  execute source;
 end if;
end $migration$;
notify pgrst,'reload schema';
commit;
