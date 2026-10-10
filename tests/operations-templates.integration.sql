begin;
insert into auth.users(id,email) values
 ('40000000-0000-0000-0000-000000000001','template-staff@example.invalid'),
 ('40000000-0000-0000-0000-000000000002','template-hq@example.invalid');
insert into public.user_profiles(id,role) values
 ('40000000-0000-0000-0000-000000000001','editor'),('40000000-0000-0000-0000-000000000002','admin');
insert into public.operations_center_members(user_id,center_code) values('40000000-0000-0000-0000-000000000001','001');
set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000002',true);
do $$ declare template public.operations_templates; t public.operations_tasks; retry public.operations_tasks; req uuid:=gen_random_uuid(); begin
 template:=public.operations_template_action(req,null,'create',
  '{"center_code":"001","title":"시험 배차 양식","spec":{"effective_from":"2026-10-11","fields":[{"key":"driver","label":"기사명","type":"string","required_on_complete":true}],"steps":[{"key":"confirm","label":"차량 확인"},{"key":"share","label":"배차정보 공유"}],"repeat":{"kind":"daily"}}}');
 perform set_config('test.template_id',template.id::text,true);
 perform set_config('test.family_id',template.family_id::text,true);
 begin
  perform public.operations_task_from_template(gen_random_uuid(),template.id,'2026-10-11','{}');
  raise exception 'Unapproved draft instantiated'; exception when invalid_parameter_value then null; end;
 template:=public.operations_template_action(gen_random_uuid(),template.id,'approve','{}');
 t:=public.operations_task_from_template(gen_random_uuid(),template.id,'2026-10-11','{}','40000000-0000-0000-0000-000000000001',true);
 retry:=public.operations_task_from_template(gen_random_uuid(),template.id,'2026-10-11','{}','40000000-0000-0000-0000-000000000001',true);
 if t.id<>retry.id or (select count(*) from public.operations_tasks)<>1 then raise exception 'Repeat created duplicate'; end if;
 if t.inputs->'steps'<>'{"confirm":"pending","share":"pending"}'::jsonb then raise exception 'Steps missing'; end if;
 perform set_config('test.task_id',t.id::text,true);
 begin
  perform public.operations_save_task(gen_random_uuid(),t.id,t.version,'001',t.title,t.work_date,t.inputs,'completed');
  raise exception 'Missing completion input accepted'; exception when invalid_parameter_value then null; end;
 begin
  perform public.operations_save_task(gen_random_uuid(),t.id,t.version,'001',t.title,t.work_date,
   '{"driver":"시험기사","steps":{"confirm":"completed","share":"pending"}}','completed');
  raise exception 'Incomplete steps accepted'; exception when invalid_parameter_value then null; end;
 t:=public.operations_save_task(gen_random_uuid(),t.id,t.version,'001',t.title,t.work_date,
  '{"driver":"시험기사","steps":{"confirm":"completed","share":"not_applicable"}}','completed');
 if t.template_snapshot->>'version'<>'1' then raise exception 'Template snapshot missing'; end if;
 template:=public.operations_template_action(gen_random_uuid(),null,'create',jsonb_build_object(
  'family_id',template.family_id,'center_code','001','title','시험 배차 개정 양식','spec',
  '{"effective_from":"2026-10-12","fields":[],"steps":[],"repeat":{"kind":"daily"}}'::jsonb));
 template:=public.operations_template_action(gen_random_uuid(),template.id,'approve','{}');
 perform set_config('test.template_v2',template.id::text,true);
 if not exists(select 1 from public.operations_tasks where id=t.id and template_snapshot->>'version'='1'
   and inputs->>'driver'='시험기사' and status='completed') then raise exception 'New version rewrote completed task'; end if;
 begin
  perform public.operations_task_from_template(gen_random_uuid(),current_setting('test.template_id')::uuid,'2026-10-12','{}');
  raise exception 'Obsolete template used for new task'; exception when invalid_parameter_value then null; end;
 t:=public.operations_task_from_template(gen_random_uuid(),template.id,'2026-10-12','{}','40000000-0000-0000-0000-000000000001',true);
 if t.template_snapshot->>'version'<>'2' then raise exception 'Current version not selected'; end if;
 template:=public.operations_template_action(gen_random_uuid(),template.id,'retire','{}');
 begin
  perform public.operations_task_from_template(gen_random_uuid(),current_setting('test.template_id')::uuid,'2026-10-13','{}');
  raise exception 'Retired family fell back to old approved version'; exception when invalid_parameter_value then null; end;
 if (select count(*) from public.operations_daily_log)<>3 then raise exception 'Template configuration polluted daily log'; end if;
end $$;
do $$ declare template public.operations_templates; t public.operations_tasks; schedule jsonb; begin
 for schedule in select value from jsonb_array_elements('[{"kind":"weekdays","days":[1,3,5]},{"kind":"monthly","day":12},{"kind":"once","date":"2026-10-12"}]') loop
   template:=public.operations_template_action(gen_random_uuid(),null,'create',jsonb_build_object(
     'center_code','001','title','반복 일정 검증','spec',jsonb_build_object('effective_from','2026-10-01',
     'fields','[]'::jsonb,'steps','[]'::jsonb,'repeat',schedule)));
   template:=public.operations_template_action(gen_random_uuid(),template.id,'approve','{}');
   t:=public.operations_task_from_template(gen_random_uuid(),template.id,'2026-10-12','{}',null,true);
   if t.work_date<>'2026-10-12'::date then raise exception 'Scheduled date incorrect'; end if;
   begin
     perform public.operations_task_from_template(gen_random_uuid(),template.id,'2026-10-13','{}',null,true);
     raise exception 'Task generated outside schedule'; exception when invalid_parameter_value then null; end;
   -- Outer N/A also requires no completion inputs or reason.
   t:=public.operations_save_task(gen_random_uuid(),t.id,t.version,'001',t.title,t.work_date,t.inputs,'not_applicable');
 end loop;
end $$;
select set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000001',true);
do $$ begin
 begin
  perform public.operations_template_action(gen_random_uuid(),null,'create','{}');
  raise exception 'Staff approved a template'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: HQ-only drafts/approval, required inputs and steps, N/A without reason, repeat deduplication, immutable old version, new version selection, retirement, clean daily log' as result;
rollback;
