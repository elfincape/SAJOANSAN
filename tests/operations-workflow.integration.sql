begin;
insert into auth.users(id,email)
select ('30000000-0000-0000-0000-00000000000'||n)::uuid,'workflow-'||n||'@example.invalid'
from generate_series(1,6) n;
insert into public.user_profiles(id,role,active)
select ('30000000-0000-0000-0000-00000000000'||n)::uuid,
 case when n in (3,6) then 'admin' when n=4 then 'viewer' else 'editor' end,n<>5
from generate_series(1,6) n;
insert into public.operations_center_members(user_id,center_code) values
 ('30000000-0000-0000-0000-000000000001','001'),
 ('30000000-0000-0000-0000-000000000002','001');
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
do $$ declare t public.operations_tasks; i public.operations_incidents; r public.operations_incidents; req uuid:=gen_random_uuid(); begin
 t:=public.operations_save_task(gen_random_uuid(),null,null,'001','배차 진행','2026-10-11','{"차량번호":"시험"}','pending');
 t:=public.operations_task_action(gen_random_uuid(),t.id,t.version,'deadline',
  '{"due_at":"2026-10-12T08:00:00+09:00","cj_share_due_at":"2026-10-11T18:00:00+09:00"}');
 t:=public.operations_task_action(gen_random_uuid(),t.id,t.version,'handoff',
  '{"owner_id":"30000000-0000-0000-0000-000000000002","memo":"기사 연락 대기"}');
 if t.due_at<>'2026-10-12T08:00:00+09:00'::timestamptz or t.cj_share_due_at<>'2026-10-11T18:00:00+09:00'::timestamptz
   or t.inputs<>'{"차량번호":"시험"}'::jsonb or t.owner_id<>'30000000-0000-0000-0000-000000000002'::uuid then
  raise exception 'Handoff lost owner, inputs or deadlines'; end if;
 if (select count(*) from public.operations_tasks)<>1 then raise exception 'Task cloned during handoff'; end if;
 begin
  perform public.operations_task_action(gen_random_uuid(),t.id,t.version,'handoff','{"owner_id":"30000000-0000-0000-0000-000000000004"}');
  raise exception 'Viewer assigned'; exception when invalid_parameter_value then null; end;
 begin
  perform public.operations_task_action(gen_random_uuid(),t.id,t.version,'deadline','{"due_at":"2026-10-13T08:00:00+09:00"}');
  raise exception 'Deadline changed without reason'; exception when invalid_parameter_value then null; end;
 t:=public.operations_task_action(gen_random_uuid(),t.id,t.version,'deadline',
  '{"due_at":"2026-10-13T08:00:00+09:00","reason":"납품 일정 변경"}');
 if t.cj_share_due_at<>'2026-10-11T18:00:00+09:00'::timestamptz then raise exception 'Unrelated deadline changed'; end if;
 i:=public.operations_incident_action(req,null,null,'create',jsonb_build_object('center_code','001','title','차량 섭외 지연','kind','차량 섭외 지연','task_id',t.id));
 r:=public.operations_incident_action(req,null,null,'create',jsonb_build_object('center_code','001','title','차량 섭외 지연','kind','차량 섭외 지연','task_id',t.id));
 if i.id<>r.id then raise exception 'Incident retry cloned original'; end if;
 i:=public.operations_incident_action(gen_random_uuid(),i.id,i.version,'request_support','{}');
 perform set_config('test.incident_id',i.id::text,true);
 perform set_config('test.task_id',t.id::text,true);
 begin
  perform public.operations_incident_action(gen_random_uuid(),i.id,i.version,'support','{"note":"운수사 연락"}');
  raise exception 'Staff impersonated HQ'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000003',true);
do $$ declare i public.operations_incidents; begin
 begin
  perform public.operations_incident_action(gen_random_uuid(),current_setting('test.incident_id')::uuid,2,'support','{}');
  raise exception 'Viewing treated as actual support'; exception when invalid_parameter_value then null; end;
 i:=public.operations_incident_action(gen_random_uuid(),current_setting('test.incident_id')::uuid,2,'support','{"note":"이안물류에 차량 섭외 요청"}');
 if i.status<>'open' then raise exception 'HQ action resolved incident'; end if;
end $$;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000006',true);
do $$ declare i public.operations_incidents; begin
 -- Another HQ user can append an independent action from the same version.
 i:=public.operations_incident_action(gen_random_uuid(),current_setting('test.incident_id')::uuid,2,'support','{"note":"대체 차량 확인","done":true}');
 if i.status<>'open' or i.support_state<>'done' then raise exception 'Support completion conflated with resolution'; end if;
end $$;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000004',true);
do $$ declare i public.operations_incidents; n integer; begin
 select * into i from public.operations_incidents where id=current_setting('test.incident_id')::uuid;
 i:=public.operations_incident_action(gen_random_uuid(),i.id,i.version,'resolve','{}');
 if i.resolved_by<>auth.uid() or i.resolved_at is null then raise exception 'Resolution actor not recorded'; end if;
 i:=public.operations_incident_action(gen_random_uuid(),i.id,i.version,'reopen','{}');
 if i.status<>'open' or i.resolved_by is not null then raise exception 'Reopen failed'; end if;
 select count(*) into n from public.operations_incidents;
 if n<>1 then raise exception 'Original incident duplicated'; end if;
 select count(*) into n from public.operations_daily_log where incident_id=i.id and action='support_action' and action_note is not null;
 if n<>2 then raise exception 'Joint HQ actions absent from daily log'; end if;
 if not exists(select 1 from public.operations_daily_log where task_id=current_setting('test.task_id')::uuid and handoff_memo='기사 연락 대기') then
  raise exception 'Handoff memo absent'; end if;
 if not exists(select 1 from public.operations_task_events where incident_id=i.id and action='resolved'
    and after_value->>'resolved_by'=auth.uid()::text) then raise exception 'Previous resolution history lost'; end if;
 begin
  update public.operations_incidents set status='resolved' where id=i.id;
  raise exception 'Direct incident write accepted'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000005',true);
do $$ begin
 begin
  perform public.operations_incident_action(gen_random_uuid(),current_setting('test.incident_id')::uuid,6,'resolve','{}');
  raise exception 'Inactive user resolved incident'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: same-ID handoff, deadline preservation/reason, same incident retry, joint HQ actions, support separate from resolution, anyone-active resolve/reopen, immutable history and daily log' as result;
rollback;
