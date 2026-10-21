begin;
create table if not exists public.operations_subjects(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('person','center','role')),
 user_id uuid unique references public.user_profiles(id),center_code text unique references public.centers(code),role_key text unique,
 check((kind='person' and user_id is not null and center_code is null and role_key is null)
 or(kind='center' and center_code is not null and user_id is null and role_key is null)
 or(kind='role' and role_key is not null and role_key='delivery_team' and user_id is null and center_code is null))
);
do $$ begin if not exists(select 1 from pg_constraint where conrelid='public.operations_subjects'::regclass and conname='operations_subjects_one_entity') then alter table public.operations_subjects add constraint operations_subjects_one_entity check(num_nonnulls(user_id,center_code,role_key)=1);end if;end $$;
alter table public.operations_subjects enable row level security;
drop policy if exists operations_subjects_read on public.operations_subjects;
create policy operations_subjects_read on public.operations_subjects for select to authenticated using(public.operations_can_read());
revoke all on public.operations_subjects from public,anon,authenticated;grant select on public.operations_subjects to authenticated;
insert into public.operations_subjects(kind,user_id) select 'person',id from public.user_profiles on conflict(user_id) do nothing;
insert into public.operations_subjects(kind,center_code) select 'center',code from public.centers on conflict(center_code) do nothing;
insert into public.operations_subjects(kind,role_key) values('role','delivery_team') on conflict(role_key) do nothing;
alter table public.operations_tasks alter column owner_id drop not null;
alter table public.operations_tasks add column if not exists handler_subject_id uuid references public.operations_subjects(id),
 add column if not exists handoff_from_subject_id uuid references public.operations_subjects(id),
 add column if not exists handoff_to_subject_id uuid references public.operations_subjects(id),
 add column if not exists handoff_actor_id uuid references public.user_profiles(id),add column if not exists handoff_at timestamptz;
update public.operations_tasks t set handler_subject_id=s.id from public.operations_subjects s where s.user_id=t.owner_id and t.handler_subject_id is null and t.deleted_at is null;
create or replace function public.operations_sync_subjects() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='user_profiles' then insert into public.operations_subjects(kind,user_id) values('person',new.id) on conflict(user_id) do nothing;
 else insert into public.operations_subjects(kind,center_code) values('center',new.code) on conflict(center_code) do nothing;end if;return new;
end; $$;
drop trigger if exists operations_profile_subject on public.user_profiles;
create trigger operations_profile_subject after insert on public.user_profiles for each row execute function public.operations_sync_subjects();
drop trigger if exists operations_center_subject on public.centers;
create trigger operations_center_subject after insert on public.centers for each row execute function public.operations_sync_subjects();
create or replace function public.operations_sync_task_handler() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' or (new.owner_id is distinct from old.owner_id and new.handler_subject_id is not distinct from old.handler_subject_id) then
  select id into new.handler_subject_id from public.operations_subjects where user_id=new.owner_id;
 end if;return new;
end; $$;
drop trigger if exists operations_task_handler_sync on public.operations_tasks;
create trigger operations_task_handler_sync before insert or update on public.operations_tasks for each row execute function public.operations_sync_task_handler();
do $$ declare expr text;begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.operations_task_events'::regclass and conname='operations_task_events_action_check';
 if position('member_updated' in expr)=0 then alter table public.operations_task_events drop constraint operations_task_events_action_check;
 execute 'alter table public.operations_task_events add constraint operations_task_events_action_check check (('||expr||') or action in (''member_updated'',''task_assigned'',''task_handoff''))';end if;
end $$;

create or replace function public.operations_members() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then raise exception '멤버 관리 권한이 필요합니다' using errcode='42501';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.display_name,''),p.email,'이름 미설정'),'display_name',p.display_name,'email',p.email,'role',p.role,'active',p.active,'centers',(select coalesce(jsonb_agg(center_code order by center_code),'[]') from public.operations_center_members where user_id=p.id)) order by p.display_name,p.id),'[]') from public.user_profiles p);
end; $$;
create or replace function public.operations_update_member(p_request_id uuid,p_user_id uuid,p_expected jsonb,p_name text,p_role text,p_centers jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.user_profiles; prior public.operations_task_events; body jsonb; current_row jsonb; result jsonb; center text;
begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then raise exception '멤버 관리 권한이 필요합니다' using errcode='42501';end if;
 if p_request_id is null or p_expected is null or nullif(trim(p_name),'') is null or length(p_name)>100 or p_role is null or p_role not in ('admin','editor','viewer') or jsonb_typeof(p_centers) is distinct from 'array' then raise exception '이름·센터·권한을 확인하세요' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_centers) c where jsonb_typeof(c)<>'string') then raise exception '센터 목록을 확인하세요' using errcode='22023';end if;
 body:=jsonb_build_object('operation','update_member','user',p_user_id,'expected',p_expected,'name',p_name,'role',p_role,'centers',p_centers);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('operations-member-administration',0));
 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then raise exception '멤버 관리 권한이 필요합니다' using errcode='42501';end if;
 select * into p from public.user_profiles where id=p_user_id for update;if not found then raise exception '멤버를 찾을 수 없습니다' using errcode='22023';end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023';end if;return prior.after_value;end if;
 for center in select code from public.centers order by code loop perform pg_advisory_xact_lock(hashtextextended('membership:'||p_user_id::text||':'||center,0));end loop;
 current_row:=jsonb_build_object('display_name',p.display_name,'role',p.role,'centers',(select coalesce(jsonb_agg(center_code order by center_code),'[]') from public.operations_center_members where user_id=p.id));
 if current_row<>p_expected then raise exception '다른 관리자가 멤버를 수정했습니다. 새로고침 후 확인하세요' using errcode='40001';end if;
 if p.active and p.role='admin' and p_role<>'admin' and not exists(select 1 from public.user_profiles where active and role='admin' and id<>p.id) then raise exception '최소 한 명의 관리자가 필요합니다' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements_text(p_centers) c where not exists(select 1 from public.centers where code=c and active)) then raise exception '활성 센터를 선택하세요' using errcode='22023';end if;
 update public.user_profiles set display_name=trim(p_name),role=p_role where id=p.id;
 delete from public.operations_center_members where user_id=p.id;
 insert into public.operations_center_members(user_id,center_code) select distinct p.id,value from jsonb_array_elements_text(p_centers);
 result:=jsonb_build_object('id',p.id,'display_name',trim(p_name),'role',p_role,'centers',(select coalesce(jsonb_agg(center_code order by center_code),'[]') from public.operations_center_members where user_id=p.id));
 insert into public.operations_task_events(membership_user_id,actor_id,request_id,request_body,action,before_value,after_value) values(p.id,auth.uid(),p_request_id,body,'member_updated',current_row,result);return result;
end; $$;

create or replace function public.operations_participant_options(p_center text) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'user_id',s.user_id,'center_code',s.center_code,'role_key',s.role_key,
 'name',case s.kind when 'person' then coalesce(nullif(p.display_name,''),'이름 미설정') when 'center' then c.name else '배송팀' end,
 'centers',case when s.kind='person' then (select coalesce(jsonb_agg(center_code order by center_code),'[]') from public.operations_center_members where user_id=s.user_id) else '[]'::jsonb end,
 'role',p.role,'eligible',case when s.kind='person' then coalesce(p.active and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members where user_id=p.id and center_code=p_center))),false) when s.kind='center' then c.active else true end) order by s.kind,p.display_name,c.name),'[]') from public.operations_subjects s left join public.user_profiles p on p.id=s.user_id left join public.centers c on c.code=s.center_code);
end; $$;
create or replace function public.operations_set_task_participants(p_request_id uuid,p_task_id uuid,p_expected_version integer,p_handler uuid,p_from uuid default null,p_to uuid default null,p_memo text default '')
returns public.operations_tasks language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb; target uuid; subject public.operations_subjects; option_id uuid;
begin
 if auth.uid() is null or p_request_id is null or length(coalesce(p_memo,''))>2000 then raise exception '활성 사용자 인증과 인계 요청을 확인하세요' using errcode='42501';end if;
 body:=jsonb_build_object('operation','set_task_participants','task',p_task_id,'version',p_expected_version,'handler',p_handler,'from',p_from,'to',p_to,'data',jsonb_build_object('memo',p_memo));
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into t from public.operations_tasks where id=p_task_id for update;
 if not found or not public.operations_can_write(t.center_code) then raise exception '센터 업무 수정 권한이 없습니다' using errcode='42501';end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023';end if;return t;end if;
 if p_expected_version is null or t.version<>p_expected_version then raise exception '다른 사용자가 수정했습니다. 새로고침하세요' using errcode='40001';end if;
 if t.deleted_at is not null or t.status in ('completed','not_applicable') then raise exception '진행 중인 업무만 담당을 변경하거나 인계할 수 있습니다' using errcode='22023';end if;
 target:=coalesce(p_to,p_handler);if target is null or (p_to is not null and p_from is null) then raise exception '처리 담당과 인계하는 담당을 선택하세요' using errcode='22023';end if;
 foreach option_id in array array[target,p_from] loop
  if option_id is null then continue;end if;
  select * into subject from public.operations_subjects where id=option_id;
  if not found or (subject.kind='person' and not exists(select 1 from public.user_profiles p where p.id=subject.user_id and p.active and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members where user_id=p.id and center_code=t.center_code)))))
  or(subject.kind='center' and not exists(select 1 from public.centers where code=subject.center_code and active)) then raise exception '유효한 사람·센터·역할을 선택하세요' using errcode='22023';end if;
 end loop;
 if p_to is not null and p_to=p_from then raise exception '서로 다른 인계 대상을 선택하세요' using errcode='22023';end if;
 before_row:=to_jsonb(t);select * into subject from public.operations_subjects where id=target;
 update public.operations_tasks set handler_subject_id=target,owner_id=subject.user_id,
 handoff_from_subject_id=case when p_to is not null then p_from else handoff_from_subject_id end,
 handoff_to_subject_id=case when p_to is not null then p_to else handoff_to_subject_id end,
 handoff_actor_id=case when p_to is not null then auth.uid() else handoff_actor_id end,
 handoff_at=case when p_to is not null then now() else handoff_at end,version=version+1,updated_at=now() where id=t.id returning * into t;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value) values(t.id,auth.uid(),p_request_id,body,case when p_to is null then 'task_assigned' else 'task_handoff' end,before_row,to_jsonb(t));
 if p_to is not null then
  insert into public.operations_notifications(user_id,event_id,title,task_id)
  select p.id,e.id,'인계받은 업무: '||t.title,t.id from public.user_profiles p cross join public.operations_task_events e
  where e.actor_id=auth.uid() and e.request_id=p_request_id and p.active and (p.id=subject.user_id or (subject.kind='center' and exists(select 1 from public.operations_center_members where user_id=p.id and center_code=subject.center_code)) or(subject.kind='role' and p.role='admin')) on conflict do nothing;
 end if;return t;
end; $$;
revoke all on function public.operations_sync_subjects(),public.operations_sync_task_handler(),public.operations_members(),public.operations_update_member(uuid,uuid,jsonb,text,text,jsonb),public.operations_participant_options(text),public.operations_set_task_participants(uuid,uuid,integer,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.operations_members(),public.operations_update_member(uuid,uuid,jsonb,text,text,jsonb),public.operations_participant_options(text),public.operations_set_task_participants(uuid,uuid,integer,uuid,uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';commit;
