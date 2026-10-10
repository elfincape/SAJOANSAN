-- Real PostgreSQL/RLS tests. All fixtures are rolled back, staging only.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','ops-ansan@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','ops-pyeongtaek@example.invalid'),
 ('10000000-0000-0000-0000-000000000003','ops-hq@example.invalid'),
 ('10000000-0000-0000-0000-000000000004','ops-viewer@example.invalid'),
 ('10000000-0000-0000-0000-000000000005','ops-inactive@example.invalid');
insert into public.user_profiles(id,role,active)
select id,case right(id::text,1) when '3' then 'admin' when '4' then 'viewer' else 'editor' end,
 right(id::text,1)<>'5' from auth.users where email like 'ops-%@example.invalid';
insert into public.operations_center_members(user_id,center_code) values
 ('10000000-0000-0000-0000-000000000001','001'),
 ('10000000-0000-0000-0000-000000000002','002');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$
declare t public.operations_tasks; retry public.operations_tasks; n integer;
begin
 t:=public.operations_save_task('20000000-0000-0000-0000-000000000001',null,null,'001','대차 배차 진행','2026-10-11',
  '{"기사명":"시험기사","차량번호":"시험12","정산방식":"월대공제"}','pending');
 perform set_config('test.task_id',t.id::text,true);
 retry:=public.operations_save_task('20000000-0000-0000-0000-000000000001',null,null,'001','대차 배차 진행','2026-10-11',
  '{"기사명":"시험기사","차량번호":"시험12","정산방식":"월대공제"}','pending');
 if t.id<>retry.id then raise exception 'Retry created a duplicate'; end if;
 begin
  perform public.operations_save_task('20000000-0000-0000-0000-000000000001',null,null,'001','다른 요청','2026-10-11','{}','pending');
  raise exception 'Changed retry accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.operations_save_task(gen_random_uuid(),null,null,'002','타센터 수정','2026-10-11','{}','pending');
  raise exception 'Cross-center write accepted';
 exception when insufficient_privilege then null; end;
 begin
  update public.operations_tasks set title='우회' where id=t.id;
  raise exception 'Direct update accepted';
 exception when insufficient_privilege then null; end;
 t:=public.operations_save_task('20000000-0000-0000-0000-000000000002',t.id,1,'001',t.title,t.work_date,t.inputs,'in_progress');
 begin
  perform public.operations_save_task(gen_random_uuid(),t.id,1,'001',t.title,t.work_date,t.inputs,'completed');
  raise exception 'Stale update accepted';
 exception when serialization_failure then null; end;
 t:=public.operations_save_task('20000000-0000-0000-0000-000000000003',t.id,2,'001',t.title,t.work_date,t.inputs,'completed');
 if t.completed_by<>auth.uid() or t.completed_at is null or t.version<>3 then raise exception 'Completion actor missing'; end if;
 begin
  perform public.operations_save_task(gen_random_uuid(),t.id,3,'001',t.title,t.work_date,'{}','pending');
  raise exception 'Completed snapshot changed';
 exception when invalid_parameter_value then null; end;
 select count(*) into n from public.operations_daily_log where task_id=t.id;
 if n<>3 then raise exception 'Daily log or idempotency failed: %',n; end if;
 if not exists(select 1 from public.operations_daily_log where task_id=t.id and inputs->>'정산방식'='월대공제') then
  raise exception 'Settlement filter data missing'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin
 if not exists(select 1 from public.operations_tasks where id=current_setting('test.task_id')::uuid) then
  raise exception 'Other center read denied'; end if;
 begin
  perform public.operations_save_task(gen_random_uuid(),current_setting('test.task_id')::uuid,3,'001','타센터','2026-10-11','{}','pending');
  raise exception 'Other center writer accepted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
do $$ declare t public.operations_tasks; begin
 t:=public.operations_save_task(gen_random_uuid(),null,null,'002','HQ 업무','2026-10-11','{}','pending');
 t:=public.operations_save_task(gen_random_uuid(),t.id,1,'002',t.title,t.work_date,'{}','not_applicable');
 if t.status<>'not_applicable' or t.inputs<>'{}'::jsonb then raise exception 'N/A requires a reason'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
do $$ begin
 begin
  perform public.operations_save_task(gen_random_uuid(),null,null,'001','조회자 쓰기','2026-10-11','{}','pending');
  raise exception 'Viewer write accepted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
do $$ begin
 if exists(select 1 from public.operations_tasks) or exists(select 1 from public.operations_daily_log) then
  raise exception 'Inactive account read accepted'; end if;
end $$;
set local role anon;
do $$ begin
 begin
  perform count(*) from public.operations_tasks;
  raise exception 'Anonymous read accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: create/update/complete, retry, stale version, immutable completion, N/A, daily log, settlement filter, center/HQ/viewer/inactive/anonymous boundaries' as result;
rollback;
