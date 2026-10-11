begin;
alter table public.operations_tasks add column if not exists deleted_at timestamptz,
 add column if not exists deleted_by uuid references public.user_profiles(id);
do $$ declare expr text; begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.operations_task_events'::regclass and conname='operations_task_events_action_check';
 if position('task_trashed' in expr)=0 then
  alter table public.operations_task_events drop constraint operations_task_events_action_check;
  execute 'alter table public.operations_task_events add constraint operations_task_events_action_check check (('||expr||') or action in (''task_trashed'',''task_restored''))';
 end if;
end $$;
create or replace function public.operations_task_trash(p_request_id uuid,p_task_id uuid,p_expected_version integer,p_restore boolean default false)
returns public.operations_tasks language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb;
begin
 if auth.uid() is null or p_request_id is null or p_restore is null then raise exception '활성 사용자 인증과 요청 번호가 필요합니다' using errcode='42501'; end if;
 body:=jsonb_build_object('operation','task_trash','task',p_task_id,'version',p_expected_version,'restore',p_restore);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into t from public.operations_tasks where id=p_task_id for update;
 if not found or not public.operations_can_write(t.center_code) then raise exception '해당 센터 업무 수정 권한이 없습니다' using errcode='42501';end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023';end if;return t;end if;
 if p_expected_version is null or t.version<>p_expected_version then raise exception '다른 사용자가 수정했습니다. 새로고침 후 확인하세요' using errcode='40001';end if;
 if (p_restore and t.deleted_at is null) or (not p_restore and t.deleted_at is not null) then raise exception '업무의 휴지통 상태가 변경되었습니다' using errcode='22023';end if;
 before_row:=to_jsonb(t);
 update public.operations_tasks set deleted_at=case when p_restore then null else now() end,
 deleted_by=case when p_restore then null else auth.uid() end,version=version+1,updated_at=now() where id=t.id returning * into t;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
 values(t.id,auth.uid(),p_request_id,body,case when p_restore then 'task_restored' else 'task_trashed' end,before_row,to_jsonb(t));return t;
end; $$;
create or replace function public.operations_guard_trashed_task() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.deleted_at is not null and new.deleted_at is not null then raise exception '휴지통의 업무는 복원 후 수정하세요' using errcode='22023';end if;return new;
end; $$;
drop trigger if exists operations_trashed_task_guard on public.operations_tasks;
create trigger operations_trashed_task_guard before update on public.operations_tasks for each row execute function public.operations_guard_trashed_task();
revoke all on function public.operations_task_trash(uuid,uuid,integer,boolean),public.operations_guard_trashed_task() from public,anon;
grant execute on function public.operations_task_trash(uuid,uuid,integer,boolean) to authenticated;
-- Retain current production functions while excluding trash from active work counts and deadline reminders.
do $$ declare def text; updated text; proc regprocedure; begin
 foreach proc in array array['public.operations_ai_snapshot()'::regprocedure,'public.operations_run_scheduler()'::regprocedure] loop
  def:=pg_get_functiondef(proc);
  updated:=replace(def,'where status in (''pending'',''in_progress'')','where deleted_at is null and status in (''pending'',''in_progress'')');
  updated:=replace(updated,'where t.status in (''pending'',''in_progress'')','where t.deleted_at is null and t.status in (''pending'',''in_progress'')');
  if updated<>def then execute updated;end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
