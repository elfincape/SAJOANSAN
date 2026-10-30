-- Personal overrides extend the existing resource rules without changing defaults.
-- Existing role, active-account and center-membership ceilings still apply.
begin;

alter table public.operations_permissions
  add column if not exists member_overrides jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.operations_permissions'::regclass
      and conname = 'operations_permissions_member_overrides_object'
  ) then
    alter table public.operations_permissions
      add constraint operations_permissions_member_overrides_object
      check (jsonb_typeof(member_overrides) = 'object');
  end if;
end $$;

create or replace function public.operations_permission_for_actor(
  p_resource text, p_action text, p_center text, p_actor uuid
) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  config public.operations_permissions;
  role_name text;
  personal jsonb;
  in_scope boolean;
  can_read boolean;
  can_edit boolean;
begin
  select role into role_name
  from public.user_profiles where id = p_actor and active;
  if role_name is null or p_action is null or p_action not in ('read', 'edit') then
    return false;
  end if;
  select * into config from public.operations_permissions where resource = p_resource;
  if not found then return false; end if;
  if role_name = 'admin' then return true; end if;
  if config.admin_only then return false; end if;

  if config.member_overrides ? p_actor::text then
    personal := config.member_overrides -> p_actor::text;
    if jsonb_typeof(personal) is distinct from 'object'
      or coalesce(personal ->> 'level', '') not in ('none', 'read', 'edit')
      or coalesce(personal ->> 'scope', '') not in ('own', 'all') then
      return false;
    end if;
    if personal ->> 'level' = 'none' then return false; end if;
    in_scope := personal ->> 'scope' = 'all' or exists (
      select 1 from public.operations_center_members m
      where m.user_id = p_actor and (p_center is null or m.center_code = p_center)
    );
    can_read := in_scope;
    can_edit := personal ->> 'level' = 'edit' and in_scope
      and (role_name = 'editor' or p_resource in ('incidents', 'notifications'));
  else
    can_read := public.operations_permission_match(config.read_rule, p_actor, p_center);
    can_edit := (role_name = 'editor' or p_resource in ('incidents', 'notifications'))
      and public.operations_permission_match(config.write_rule, p_actor, p_center);
  end if;

  if can_edit and p_resource in (
    'tasks', 'forms', 'trash', 'drivers', 'vehicles', 'companies',
    'delivery_points', 'routes', 'transfers', 'charter', 'dispatch_parser', 'one_top'
  ) then
    can_edit := exists (
      select 1 from public.operations_center_members m
      where m.user_id = p_actor and (p_center is null or m.center_code = p_center)
    );
  end if;
  if p_action = 'read' then return can_read or can_edit; end if;
  return can_edit;
end $$;

create or replace function public.operations_update_member_permissions(
  p_request_id uuid,
  p_user_id uuid,
  p_expected_member jsonb,
  p_changes jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  member public.user_profiles;
  config public.operations_permissions;
  prior public.operations_task_events;
  body jsonb;
  current_member jsonb;
  change jsonb;
  personal jsonb;
  before_rules jsonb := '[]'::jsonb;
  after_rules jsonb := '[]'::jsonb;
  before_row jsonb;
  after_row jsonb;
  center text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception '관리자만 직원별 업무 권한을 설정할 수 있습니다' using errcode = '42501';
  end if;
  if p_request_id is null or p_user_id is null
    or jsonb_typeof(p_expected_member) is distinct from 'object'
    or jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception '직원과 권한 변경 요청을 확인하세요' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) not between 1 and 200 then
    raise exception '변경할 업무 권한을 선택하세요' using errcode = '22023';
  end if;

  for change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(change) is distinct from 'object'
      or jsonb_typeof(change -> 'resource') is distinct from 'string'
      or nullif(change ->> 'resource', '') is null
      or jsonb_typeof(change -> 'version') is distinct from 'number'
      or not (change ? 'permission') then
      raise exception '업무와 저장 버전을 확인하세요' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_object_keys(change) k where k not in ('resource', 'version', 'permission'))
      or (change ->> 'version')::numeric < 1
      or (change ->> 'version')::numeric > 2147483647
      or (change ->> 'version')::numeric <> trunc((change ->> 'version')::numeric) then
      raise exception '권한 변경 형식을 확인하세요' using errcode = '22023';
    end if;
    personal := change -> 'permission';
    if personal <> 'null'::jsonb then
      if jsonb_typeof(personal) is distinct from 'object' then
        raise exception '업무 권한을 확인하세요' using errcode = '22023';
      end if;
      if jsonb_typeof(personal -> 'level') is distinct from 'string'
        or coalesce(personal ->> 'level', '') not in ('none', 'read', 'edit')
        or jsonb_typeof(personal -> 'scope') is distinct from 'string'
        or coalesce(personal ->> 'scope', '') not in ('own', 'all')
        or exists (select 1 from jsonb_object_keys(personal) k where k not in ('level', 'scope')) then
        raise exception '허용 수준과 자료 범위를 확인하세요' using errcode = '22023';
      end if;
    end if;
  end loop;
  if (select count(distinct value ->> 'resource') from jsonb_array_elements(p_changes))
    <> jsonb_array_length(p_changes) then
    raise exception '같은 업무가 중복되었습니다' using errcode = '22023';
  end if;

  body := jsonb_build_object(
    'operation', 'update_member_permissions', 'user', p_user_id,
    'expected', p_expected_member, 'changes', p_changes
  );
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('operations-member-administration', 0));
  if not public.is_admin() then
    raise exception '관리자 권한이 변경되었습니다' using errcode = '42501';
  end if;
  select * into prior from public.operations_task_events
  where actor_id = auth.uid() and request_id = p_request_id;
  if found then
    if prior.request_body is distinct from body then
      raise exception '이미 사용된 요청 번호입니다' using errcode = '22023';
    end if;
    return prior.after_value;
  end if;

  select * into member from public.user_profiles where id = p_user_id for share;
  if not found then
    raise exception '직원을 찾을 수 없습니다' using errcode = '22023';
  end if;
  if member.role = 'admin' then
    raise exception '관리자는 모든 업무 권한을 유지합니다' using errcode = '22023';
  end if;
  -- Synchronize with both the full member editor and individual center assignments.
  for center in select code from public.centers order by code loop
    perform pg_advisory_xact_lock(hashtextextended('membership:' || p_user_id::text || ':' || center, 0));
  end loop;
  current_member := jsonb_build_object(
    'display_name', member.display_name, 'role', member.role,
    'centers', (select coalesce(jsonb_agg(center_code order by center_code), '[]'::jsonb)
      from public.operations_center_members where user_id = p_user_id)
  );
  if current_member is distinct from p_expected_member then
    raise exception '다른 관리자가 직원 정보를 변경했습니다. 새로고침 후 확인하세요' using errcode = '40001';
  end if;

  for change in select value from jsonb_array_elements(p_changes) order by value ->> 'resource' loop
    select * into config from public.operations_permissions
    where resource = change ->> 'resource' for update;
    if not found or config.admin_only then
      raise exception '관리자 전용 업무는 변경할 수 없습니다' using errcode = '22023';
    end if;
    if config.version <> (change ->> 'version')::integer then
      raise exception '다른 관리자가 업무 권한을 변경했습니다. 새로고침 후 확인하세요' using errcode = '40001';
    end if;
    personal := change -> 'permission';
    if personal ->> 'level' = 'edit' and member.role <> 'editor'
      and config.resource not in ('incidents', 'notifications') then
      raise exception '조회 전용 직원에게 수정 권한을 부여할 수 없습니다' using errcode = '22023';
    end if;
    before_rules := before_rules || jsonb_build_array(to_jsonb(config));
    update public.operations_permissions
    set member_overrides = case
        when personal = 'null'::jsonb then member_overrides - p_user_id::text
        else jsonb_set(member_overrides, array[p_user_id::text], personal, true)
      end,
      version = version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where resource = config.resource returning * into config;
    after_rules := after_rules || jsonb_build_array(to_jsonb(config));
  end loop;

  before_row := current_member || jsonb_build_object('user_id', p_user_id, 'rules', before_rules);
  after_row := current_member || jsonb_build_object('user_id', p_user_id, 'rules', after_rules);
  insert into public.operations_task_events(
    membership_user_id, actor_id, request_id, request_body, action, before_value, after_value
  ) values (
    p_user_id, auth.uid(), p_request_id, body, 'member_updated', before_row, after_row
  );
  return after_row;
end $$;

revoke all on function public.operations_permission_for_actor(text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.operations_permission_for_actor(text, text, text, uuid) to service_role;
revoke all on function public.operations_update_member_permissions(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.operations_update_member_permissions(uuid, uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
