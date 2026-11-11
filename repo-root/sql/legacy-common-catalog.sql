-- Staged only. Does not remove cutover fences or grant table writes.
-- Apply only after reconciling newer ERP changes and separately approving ownership.
begin;
alter table public.routes add column if not exists deleted_at timestamptz;
alter table public.delivery_points add column if not exists deleted_at timestamptz;
alter table public.drivers add column if not exists deleted_at timestamptz;
alter table public.vehicles add column if not exists deleted_at timestamptz;
alter table public.companies add column if not exists deleted_at timestamptz;
create or replace function public.legacy_preserve_catalog_reference() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception '원본은 삭제 표시만 할 수 있습니다. 기존 연결은 보존됩니다.' using errcode='23503';
end $$;
do $$ declare t text; begin
  foreach t in array array['routes','delivery_points','drivers','vehicles','companies'] loop
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname='legacy_preserve_catalog_reference') then
    execute format('create trigger legacy_preserve_catalog_reference before delete on public.%I for each row execute function public.legacy_preserve_catalog_reference()',t);
    end if;
  end loop;
end $$;
alter table public.route_stops add column if not exists condition_modes jsonb not null default '{}'::jsonb;
do $$ begin if not exists(select 1 from pg_constraint where conrelid='public.route_stops'::regclass and conname='route_stops_condition_modes_valid') then
alter table public.route_stops add constraint route_stops_condition_modes_valid check (
  jsonb_typeof(condition_modes) = 'object'
  and condition_modes - array['delivery_method','access_method','delivery_location','deadline'] = '{}'::jsonb
  and not jsonb_path_exists(condition_modes, '$.* ? (@ != "inherit" && @ != "set" && @ != "clear")')
);
end if; end $$;

create or replace view public.course_view with (security_invoker=true) as
SELECT rs.id AS stop_id,
    rs.stop_order,
    rs.arrival_text,
    rs.arrival_business_min,
    rs.unloading_start_text,
    rs.unloading_start_business_min,
    rs.unloading_end_text,
    rs.unloading_end_business_min,
    rs.deadline_text AS stop_deadline_text,
    rs.deadline_business_min AS stop_deadline_business_min,
    rs.memo AS stop_memo,
    r.id AS route_id,
    r.name AS route_name,
    r.car_number,
    r.active AS route_active,
    r.company_id AS company_id,
    CASE WHEN co.deleted_at IS NOT NULL THEN co.name || ' (삭제됨)' ELSE co.name END AS company_name,
    r.primary_driver_id AS primary_driver_id,
    CASE WHEN pd.deleted_at IS NOT NULL THEN pd.name || ' (삭제됨)' ELSE pd.name END AS primary_driver_name,
    pd.phone AS primary_driver_phone,
    r.primary_vehicle_id AS primary_vehicle_id,
    CASE WHEN pv.deleted_at IS NOT NULL THEN pv.plate_number || ' (삭제됨)' ELSE pv.plate_number END AS primary_vehicle_plate,
    pv.tonnage AS primary_vehicle_tonnage,
    pv.pallet_capacity AS primary_vehicle_pallet,
    r.secondary_driver_id AS secondary_driver_id,
    CASE WHEN sd.deleted_at IS NOT NULL THEN sd.name || ' (삭제됨)' ELSE sd.name END AS secondary_driver_name,
    r.secondary_vehicle_id AS secondary_vehicle_id,
    CASE WHEN sv.deleted_at IS NOT NULL THEN sv.plate_number || ' (삭제됨)' ELSE sv.plate_number END AS secondary_vehicle_plate,
    rs.delivery_point_id AS delivery_point_id,
    dp.code AS dp_code,
    CASE WHEN dp.deleted_at IS NOT NULL THEN dp.name || ' (삭제됨)' ELSE dp.name END AS dp_name,
    dp.address AS dp_address,
    dp.region AS dp_region,
    dp.contact AS dp_contact,
    dp.allow_under_1ton,
    dp.allow_under_3_5ton,
    dp.allow_over_5ton,
    dp.allow_unmanned_yard,
    dp.deadline_text AS dp_deadline_text,
    dp.deadline_business_min AS dp_deadline_business_min,
    dp.delivery_method AS base_delivery_method,
    dp.access_method AS base_access_method,
    dp.delivery_location AS base_delivery_location,
    rs.override_delivery_method,
    rs.override_access_method,
    rs.override_delivery_location,
    CASE rs.condition_modes->>'delivery_method' WHEN 'clear' THEN NULL WHEN 'inherit' THEN dp.delivery_method WHEN 'set' THEN rs.override_delivery_method ELSE COALESCE(rs.override_delivery_method, dp.delivery_method) END AS delivery_method,
    CASE rs.condition_modes->>'access_method' WHEN 'clear' THEN NULL WHEN 'inherit' THEN dp.access_method WHEN 'set' THEN rs.override_access_method ELSE COALESCE(rs.override_access_method, dp.access_method) END AS access_method,
    CASE rs.condition_modes->>'delivery_location' WHEN 'clear' THEN NULL WHEN 'inherit' THEN dp.delivery_location WHEN 'set' THEN rs.override_delivery_location ELSE COALESCE(rs.override_delivery_location, dp.delivery_location) END AS delivery_location,
    rs.condition_modes <> '{}'::jsonb OR rs.override_delivery_method IS NOT NULL OR rs.override_access_method IS NOT NULL OR rs.override_delivery_location IS NOT NULL AS has_override,
    CASE rs.condition_modes->>'deadline' WHEN 'clear' THEN NULL WHEN 'inherit' THEN dp.deadline_business_min WHEN 'set' THEN rs.deadline_business_min ELSE COALESCE(rs.deadline_business_min, dp.deadline_business_min) END AS effective_deadline_business_min,
    CASE rs.condition_modes->>'deadline' WHEN 'clear' THEN NULL WHEN 'inherit' THEN dp.deadline_text WHEN 'set' THEN rs.deadline_text ELSE COALESCE(rs.deadline_text, dp.deadline_text) END AS effective_deadline_text,
        CASE
            WHEN CASE rs.condition_modes->>'deadline' WHEN 'clear' THEN NULL WHEN 'inherit' THEN dp.deadline_business_min WHEN 'set' THEN rs.deadline_business_min ELSE COALESCE(rs.deadline_business_min, dp.deadline_business_min) END IS NOT NULL AND rs.unloading_end_business_min IS NOT NULL THEN CASE rs.condition_modes->>'deadline' WHEN 'clear' THEN NULL WHEN 'inherit' THEN dp.deadline_business_min WHEN 'set' THEN rs.deadline_business_min ELSE COALESCE(rs.deadline_business_min, dp.deadline_business_min) END - rs.unloading_end_business_min
            ELSE NULL::integer
        END AS slack_minutes,
    r.center_code,
    r.center_code AS route_center_code,
    cen.name AS center_name,
    dp.security_key_location,
    dp.security_password,
    dp.contact_name AS dp_contact_name,
    dp.memo AS dp_memo
   FROM route_stops rs
     JOIN routes r ON r.id = rs.route_id
     LEFT JOIN centers cen ON cen.code = r.center_code
     LEFT JOIN companies co ON co.id = r.company_id
     LEFT JOIN drivers pd ON pd.id = r.primary_driver_id
     LEFT JOIN vehicles pv ON pv.id = r.primary_vehicle_id
     LEFT JOIN drivers sd ON sd.id = r.secondary_driver_id
     LEFT JOIN vehicles sv ON sv.id = r.secondary_vehicle_id
     LEFT JOIN delivery_points dp ON dp.id = rs.delivery_point_id
 WHERE r.deleted_at IS NULL;
revoke all on public.course_view from public, anon;
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

  if can_edit and not (config.member_overrides ? p_actor::text) and p_resource in (
    'tasks', 'forms', 'trash', 'transfers', 'charter', 'dispatch_parser', 'one_top'
  ) then
    can_edit := exists (
      select 1 from public.operations_center_members m
      where m.user_id = p_actor and (p_center is null or m.center_code = p_center)
    );
  end if;
  if p_action = 'read' then return can_read or can_edit; end if;
  return can_edit;
end $$;
create or replace function public.operations_permissions_context() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501';end if;
 return jsonb_build_object('rules',case when public.is_admin() then (select jsonb_agg(to_jsonb(p) order by section,title) from public.operations_permissions p) else '[]'::jsonb end,
 'centers',(select coalesce(jsonb_agg(center_code order by center_code),'[]') from public.operations_center_members where user_id=auth.uid()),
 'access',(select jsonb_object_agg(resource,jsonb_build_object('read',public.operations_resource_allowed(resource,'read'), 'edit',public.operations_resource_allowed(resource,'edit'),
 'read_unclassified',public.operations_resource_allowed(resource,'read',''),
 'edit_unclassified',public.operations_resource_allowed(resource,'edit',''),
 'read_centers',(select coalesce(jsonb_agg(code),'[]') from public.centers where active and public.operations_resource_allowed(p.resource,'read',code)),
 'edit_centers',(select coalesce(jsonb_agg(code),'[]') from public.centers where active and public.operations_resource_allowed(p.resource,'edit',code)))) from public.operations_permissions p));
end $$;

create or replace function public.legacy_save_route_stops(p_route_id uuid, p_expected jsonb, p_stops jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare current_rows jsonb; expected_rows jsonb; desired_rows jsonb; item jsonb; saved public.route_stops; n integer;
begin
  if auth.uid() is null or jsonb_typeof(p_expected) is distinct from 'array'
    or jsonb_typeof(p_stops) is distinct from 'array' or jsonb_array_length(p_stops)>1000 then
    raise exception '저장 요청을 확인하세요' using errcode='22023';
  end if;
  perform 1 from public.routes where id=p_route_id
    and public.operations_resource_allowed('routes','edit',coalesce(center_code,'')) for update;
  if not found then raise exception '코스 수정 권한이 없습니다' using errcode='42501'; end if;
  for item in select value from jsonb_array_elements(p_stops) loop
    if jsonb_typeof(item) is distinct from 'object' or item->>'id' is null
      or (item->>'route_id')::uuid is distinct from p_route_id
      or exists(select 1 from jsonb_object_keys(item) k where k not in (
        'id','route_id','delivery_point_id','stop_order','arrival_text','arrival_business_min',
        'unloading_start_text','unloading_start_business_min','unloading_end_text','unloading_end_business_min',
        'deadline_text','deadline_business_min','override_delivery_method','override_access_method',
        'override_delivery_location','memo','condition_modes','created_at','updated_at')) then
      raise exception '연결 필드를 확인하세요' using errcode='22023';
    end if;
    if exists(select 1 from public.route_stops where id=(item->>'id')::uuid and route_id<>p_route_id) then
      raise exception '다른 코스의 연결입니다' using errcode='22023';
    end if;
  end loop;
  n:=jsonb_array_length(p_stops);
  if (select count(distinct value->>'id') from jsonb_array_elements(p_stops))<>n
    or (select count(distinct (value->>'stop_order')::integer) from jsonb_array_elements(p_stops)
        where (value->>'stop_order')::integer between 1 and n)<>n then
    raise exception '중복 ID 또는 순서를 확인하세요' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(s)-array['created_at','updated_at'] order by id),'[]')
    into current_rows from public.route_stops s where route_id=p_route_id;
  select coalesce(jsonb_agg(value-array['created_at','updated_at'] order by value->>'id'),'[]')
    into expected_rows from jsonb_array_elements(p_expected);
  select coalesce(jsonb_agg(to_jsonb(jsonb_populate_record(null::public.route_stops,value))
    -array['created_at','updated_at'] order by value->>'id'),'[]') into desired_rows from jsonb_array_elements(p_stops);
  if current_rows=desired_rows then return current_rows; end if;
  if current_rows<>expected_rows then raise exception '다른 작업에서 연결이 변경됐습니다. 입력을 보존했습니다.' using errcode='40001'; end if;
  -- Both renumbering phases are in this transaction; failure restores every row.
  update public.route_stops set stop_order=-1000000-stop_order where route_id=p_route_id;
  delete from public.route_stops where route_id=p_route_id
    and id not in(select (value->>'id')::uuid from jsonb_array_elements(p_stops));
  for item in select value from jsonb_array_elements(p_stops) loop
    saved:=jsonb_populate_record(null::public.route_stops,item);
    insert into public.route_stops(id,route_id,delivery_point_id,stop_order,arrival_text,arrival_business_min,
      unloading_start_text,unloading_start_business_min,unloading_end_text,unloading_end_business_min,
      deadline_text,deadline_business_min,override_delivery_method,override_access_method,override_delivery_location,memo,condition_modes)
    values(saved.id,p_route_id,saved.delivery_point_id,saved.stop_order,saved.arrival_text,saved.arrival_business_min,
      saved.unloading_start_text,saved.unloading_start_business_min,saved.unloading_end_text,saved.unloading_end_business_min,
      saved.deadline_text,saved.deadline_business_min,saved.override_delivery_method,saved.override_access_method,saved.override_delivery_location,saved.memo,coalesce(saved.condition_modes,'{}'))
    on conflict(id) do update set delivery_point_id=excluded.delivery_point_id,stop_order=excluded.stop_order,
      arrival_text=excluded.arrival_text,arrival_business_min=excluded.arrival_business_min,
      unloading_start_text=excluded.unloading_start_text,unloading_start_business_min=excluded.unloading_start_business_min,
      unloading_end_text=excluded.unloading_end_text,unloading_end_business_min=excluded.unloading_end_business_min,
      deadline_text=excluded.deadline_text,deadline_business_min=excluded.deadline_business_min,
      override_delivery_method=excluded.override_delivery_method,override_access_method=excluded.override_access_method,
      override_delivery_location=excluded.override_delivery_location,memo=excluded.memo,condition_modes=excluded.condition_modes
    where route_stops.route_id=p_route_id;
    if not found then raise exception '연결 ID를 다른 코스로 이동할 수 없습니다' using errcode='42501'; end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(s) order by stop_order),'[]') into current_rows
    from public.route_stops s where route_id=p_route_id;
  return current_rows;
end $$;
revoke all on function public.legacy_save_route_stops(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.legacy_save_route_stops(uuid,jsonb,jsonb) to authenticated;
commit;
