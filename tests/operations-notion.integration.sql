begin;
insert into auth.users(id,email) values ('50000000-0000-0000-0000-000000000001','notion-stage@example.invalid');
insert into public.user_profiles(id,role,active) values ('50000000-0000-0000-0000-000000000001','editor',true);
insert into public.operations_center_members(user_id,center_code) values ('50000000-0000-0000-0000-000000000001','001');
insert into public.operations_notion_identities(notion_user_id,user_id) values ('50000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
do $$ declare t public.operations_tasks; r public.operations_tasks; req uuid:=gen_random_uuid(); begin
 t:=public.operations_import_notion_task('50000000-0000-0000-0000-000000000002',req,null,null,'001','노션 연동 시험','2026-10-11','{"정산방식":"기사직접"}','pending');
 r:=public.operations_import_notion_task('50000000-0000-0000-0000-000000000002',req,null,null,'001','노션 연동 시험','2026-10-11','{"정산방식":"기사직접"}','pending');
 if t.id<>r.id or t.created_by<>'50000000-0000-0000-0000-000000000001'::uuid then raise exception 'Import identity or idempotence lost'; end if;
 if auth.role()<>'service_role' then raise exception 'Actor claims not restored'; end if;
 begin
  perform public.operations_import_notion_task('50000000-0000-0000-0000-000000000002',gen_random_uuid(),null,null,'002','다른센터','2026-10-11','{}','pending');
  raise exception 'Center authorization bypassed'; exception when insufficient_privilege then null; end;
 begin
  perform public.operations_import_notion_task(gen_random_uuid(),gen_random_uuid(),null,null,'001','미연결사용자','2026-10-11','{}','pending');
  raise exception 'Unmapped actor accepted'; exception when insufficient_privilege then null; end;
 t:=public.operations_import_notion_task('50000000-0000-0000-0000-000000000002',gen_random_uuid(),t.id,t.version,'001',t.title,t.work_date,t.inputs,'completed');
 if t.completed_by<>'50000000-0000-0000-0000-000000000001'::uuid then raise exception 'Actual completion actor missing'; end if;
end $$;
reset role;
update public.user_profiles set active=false where id='50000000-0000-0000-0000-000000000001';
set local role service_role;
do $$ begin
 begin
  perform public.operations_import_notion_task('50000000-0000-0000-0000-000000000002',gen_random_uuid(),null,null,'001','비활성','2026-10-11','{}','pending');
  raise exception 'Inactive actor accepted'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$ begin
 begin
  perform public.operations_import_notion_task('50000000-0000-0000-0000-000000000002',gen_random_uuid(),null,null,'001','사칭','2026-10-11','{}','pending');
  raise exception 'Authenticated client impersonated native actor'; exception when insufficient_privilege then null; end;
 begin
  perform 1 from public.operations_notion_identities;
  raise exception 'Private mappings exposed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
