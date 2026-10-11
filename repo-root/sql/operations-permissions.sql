begin;
create table public.operations_permissions(
 resource text primary key,title text not null,section text not null,admin_only boolean not null default false,
 read_rule jsonb not null,write_rule jsonb not null,version integer not null default 1,
 updated_by uuid references public.user_profiles(id),updated_at timestamptz not null default now()
);
create table public.operations_permission_events(
 id bigint generated always as identity primary key,resource text not null references public.operations_permissions(resource),
 actor_id uuid not null references public.user_profiles(id),request_id uuid not null,request_body jsonb not null,
 before_value jsonb not null,after_value jsonb not null,created_at timestamptz not null default now(),unique(actor_id,request_id)
);
alter table public.operations_permissions enable row level security;
alter table public.operations_permission_events enable row level security;
create policy permissions_read on public.operations_permissions for select to authenticated using(public.is_admin());
create policy permissions_history on public.operations_permission_events for select to authenticated using(public.is_admin());
revoke all on public.operations_permissions,public.operations_permission_events from public,anon,authenticated;
grant select on public.operations_permissions,public.operations_permission_events to authenticated;
grant all on public.operations_permissions,public.operations_permission_events to service_role;
create function public.operations_permission_match(p_rule jsonb,p_actor uuid,p_center text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.user_profiles p where p.id=p_actor and p.active and
 (coalesce((p_rule->>'everyone')::boolean,false) or (p_rule->'roles') ? p.role or
 exists(select 1 from public.operations_center_members m where m.user_id=p.id and (p_rule->'centers') ? m.center_code))
 and (p_rule->>'scope'='all' or exists(select 1 from public.operations_center_members m where m.user_id=p.id and (p_center is null or m.center_code=p_center))));
$$;
create function public.operations_permission_for_actor(p_resource text,p_action text,p_center text,p_actor uuid) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare config public.operations_permissions;role_name text;can_edit boolean;
begin
 select role into role_name from public.user_profiles where id=p_actor and active;
 if role_name is null or p_action is null or p_action not in ('read','edit') then return false;end if;
 select * into config from public.operations_permissions where resource=p_resource;if not found then return false;end if;
 if role_name='admin' then return true;end if;
 if config.admin_only then return false;end if;
 can_edit:=(role_name in ('editor','admin') or p_resource in ('incidents','notifications')) and public.operations_permission_match(config.write_rule,p_actor,p_center);
 if p_action='read' then return public.operations_permission_match(config.read_rule,p_actor,p_center) or can_edit;end if;
 return can_edit;
end $$;
create function public.operations_resource_allowed(p_resource text,p_action text,p_center text default null) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select public.operations_permission_for_actor(p_resource,p_action,p_center,auth.uid());
$$;
-- Keep the member's existing edit authority as the ceiling for center records.
create function public.operations_can_edit_resource(p_resource text,p_center text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select public.operations_resource_allowed(p_resource,'edit',p_center) and exists(select 1 from public.user_profiles p where p.id=auth.uid() and p.active and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p.id and m.center_code=p_center))));
$$;
create function public.operations_permissions_context() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501';end if;
 return jsonb_build_object('rules',case when public.is_admin() then (select jsonb_agg(to_jsonb(p) order by section,title) from public.operations_permissions p) else '[]'::jsonb end,
 'centers',(select coalesce(jsonb_agg(center_code order by center_code),'[]') from public.operations_center_members where user_id=auth.uid()),
 'access',(select jsonb_object_agg(resource,jsonb_build_object('read',public.operations_resource_allowed(resource,'read'), 'edit',public.operations_resource_allowed(resource,'edit'),
 'read_centers',(select coalesce(jsonb_agg(code),'[]') from public.centers where active and public.operations_resource_allowed(p.resource,'read',code)),
 'edit_centers',(select coalesce(jsonb_agg(code),'[]') from public.centers where active and public.operations_resource_allowed(p.resource,'edit',code)))) from public.operations_permissions p));
end $$;
create function public.operations_update_permission(p_request_id uuid,p_resource text,p_expected_version integer,p_read jsonb,p_write jsonb) returns public.operations_permissions
language plpgsql security definer set search_path=public,pg_temp as $$
declare config public.operations_permissions;previous public.operations_permission_events;body jsonb;before_row jsonb;rule jsonb;
begin
 if not public.is_admin() or p_request_id is null then raise exception '관리자만 목록별 권한을 설정할 수 있습니다' using errcode='42501';end if;
 body:=jsonb_build_object('resource',p_resource,'version',p_expected_version,'read',p_read,'write',p_write);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('operations-member-administration',0));
 if not public.is_admin() then raise exception '관리자 권한이 변경되었습니다' using errcode='42501';end if;
 select * into previous from public.operations_permission_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then if previous.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023';end if;select * into config from public.operations_permissions where resource=p_resource;return config;end if;
 select * into config from public.operations_permissions where resource=p_resource for update;
 if not found or config.admin_only then raise exception '이 목록은 관리자 전용으로 유지합니다' using errcode='22023';end if;
 if p_expected_version is null or p_expected_version<>config.version then raise exception '다른 관리자가 변경했습니다. 새로고침 후 확인하세요' using errcode='40001';end if;
 foreach rule in array array[p_read,p_write] loop
  if rule is null or jsonb_typeof(rule)<>'object' or jsonb_typeof(rule->'everyone') is distinct from 'boolean' or jsonb_typeof(rule->'roles') is distinct from 'array' or jsonb_typeof(rule->'centers') is distinct from 'array' or rule->>'scope' is null or rule->>'scope' not in ('all','own') then raise exception '권한 조건을 확인하세요' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements_text(rule->'roles') x where x not in ('admin','editor','viewer')) or exists(select 1 from jsonb_array_elements_text(rule->'centers') x where not exists(select 1 from public.centers where code=x and active)) then raise exception '역할과 센터 관계를 확인하세요' using errcode='22023';end if;
 end loop;
 before_row:=to_jsonb(config);update public.operations_permissions set read_rule=p_read,write_rule=p_write,version=version+1,updated_by=auth.uid(),updated_at=now() where resource=p_resource returning * into config;
 insert into public.operations_permission_events(resource,actor_id,request_id,request_body,before_value,after_value) values(p_resource,auth.uid(),p_request_id,body,before_row,to_jsonb(config));return config;
end $$;
revoke all on function public.operations_permission_match(jsonb,uuid,text),public.operations_permission_for_actor(text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.operations_resource_allowed(text,text,text),public.operations_can_edit_resource(text,text),public.operations_permissions_context(),public.operations_update_permission(uuid,text,integer,jsonb,jsonb) from public,anon;
grant execute on function public.operations_resource_allowed(text,text,text),public.operations_can_edit_resource(text,text),public.operations_permissions_context(),public.operations_update_permission(uuid,text,integer,jsonb,jsonb) to authenticated;
grant execute on function public.operations_permission_for_actor(text,text,text,uuid) to service_role;

insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('tasks','센터 업무','포털',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"own"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('incidents','특이사항','포털',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":true,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('forms','업무 등록·조사','포털',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"own"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('hq','배송팀 전체 업무·지원 요청','포털',false,'{"everyone":false,"roles":["admin"],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('briefing','AI 브리핑','포털',true,'{"everyone":false,"roles":["admin"],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('search','통합 검색','포털',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('notifications','알림함','포털',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":true,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('history','처리 기록','운영 관리',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('trash','휴지통','운영 관리',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"own"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('members','멤버 목록','운영 관리',true,'{"everyone":false,"roles":["admin"],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('permissions','목록별 권한','운영 관리',true,'{"everyone":false,"roles":["admin"],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('backups','운영 원본 보관','운영 관리',true,'{"everyone":false,"roles":["admin"],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('audit','운영정보 변경 이력','운영 관리',true,'{"everyone":false,"roles":["admin"],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('routes','코스 관리','운영관리 목록',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('delivery_points','납품처 관리','운영관리 목록',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('drivers','기사 관리','운영관리 목록',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('vehicles','차량 관리','운영관리 목록',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('companies','운수사 관리','운영관리 목록',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('transfers','이배송 관리','운영관리 목록',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('charter','평택 용차내역','운영관리 목록',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('dispatch_parser','배차정보 파서','도구',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('excel_compare','엑셀 시트 비교','도구',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('pallet_slips','파레트 전표관리','도구',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('one_top','1탑2실 작업','도구',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('temperature','1탑2실 템플릿 생성','도구',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('coupang','쿠팡 입문확인','도구',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('haul','하불 배차 계산','도구',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('busan','안산김해부산안산','도구',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('straightener','기울기 보정','도구',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('pdf_converter','PDF IMG 변환기','도구',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('export','코스표 내려받기','도구',false,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('import','CSV 일괄 가져오기','도구',true,'{"everyone":false,"roles":["admin"],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('users','사용자 관리','운영 관리',true,'{"everyone":false,"roles":["admin"],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('settings','관리 허브 설정','운영 관리',true,'{"everyone":false,"roles":["admin"],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
insert into public.operations_permissions(resource,title,section,admin_only,read_rule,write_rule) values('connections','외부 연결 설정','운영 관리',true,'{"everyone":false,"roles":["admin"],"centers":[],"scope":"all"}'::jsonb,'{"everyone":false,"roles":["admin","editor"],"centers":[],"scope":"all"}'::jsonb);
create policy menu_read on public.companies as restrictive for select to authenticated using(public.operations_resource_allowed('companies','read',coalesce(center_code,'')));
create policy menu_insert on public.companies as restrictive for insert to authenticated with check(public.operations_resource_allowed('companies','edit',coalesce(center_code,'')));
create policy menu_update on public.companies as restrictive for update to authenticated using(public.operations_resource_allowed('companies','edit',coalesce(center_code,''))) with check(public.operations_resource_allowed('companies','edit',coalesce(center_code,'')));
create policy menu_delete on public.companies as restrictive for delete to authenticated using(public.operations_resource_allowed('companies','edit',coalesce(center_code,'')));
create policy menu_read on public.drivers as restrictive for select to authenticated using(public.operations_resource_allowed('drivers','read',coalesce(center_code,'')));
create policy menu_insert on public.drivers as restrictive for insert to authenticated with check(public.operations_resource_allowed('drivers','edit',coalesce(center_code,'')));
create policy menu_update on public.drivers as restrictive for update to authenticated using(public.operations_resource_allowed('drivers','edit',coalesce(center_code,''))) with check(public.operations_resource_allowed('drivers','edit',coalesce(center_code,'')));
create policy menu_delete on public.drivers as restrictive for delete to authenticated using(public.operations_resource_allowed('drivers','edit',coalesce(center_code,'')));
create policy menu_read on public.vehicles as restrictive for select to authenticated using(public.operations_resource_allowed('vehicles','read',coalesce(center_code,'')));
create policy menu_insert on public.vehicles as restrictive for insert to authenticated with check(public.operations_resource_allowed('vehicles','edit',coalesce(center_code,'')));
create policy menu_update on public.vehicles as restrictive for update to authenticated using(public.operations_resource_allowed('vehicles','edit',coalesce(center_code,''))) with check(public.operations_resource_allowed('vehicles','edit',coalesce(center_code,'')));
create policy menu_delete on public.vehicles as restrictive for delete to authenticated using(public.operations_resource_allowed('vehicles','edit',coalesce(center_code,'')));
create policy menu_read on public.delivery_points as restrictive for select to authenticated using(public.operations_resource_allowed('delivery_points','read',coalesce(center_code,'')));
create policy menu_insert on public.delivery_points as restrictive for insert to authenticated with check(public.operations_resource_allowed('delivery_points','edit',coalesce(center_code,'')));
create policy menu_update on public.delivery_points as restrictive for update to authenticated using(public.operations_resource_allowed('delivery_points','edit',coalesce(center_code,''))) with check(public.operations_resource_allowed('delivery_points','edit',coalesce(center_code,'')));
create policy menu_delete on public.delivery_points as restrictive for delete to authenticated using(public.operations_resource_allowed('delivery_points','edit',coalesce(center_code,'')));
create policy menu_read on public.routes as restrictive for select to authenticated using(public.operations_resource_allowed('routes','read',coalesce(center_code,'')));
create policy menu_insert on public.routes as restrictive for insert to authenticated with check(public.operations_resource_allowed('routes','edit',coalesce(center_code,'')));
create policy menu_update on public.routes as restrictive for update to authenticated using(public.operations_resource_allowed('routes','edit',coalesce(center_code,''))) with check(public.operations_resource_allowed('routes','edit',coalesce(center_code,'')));
create policy menu_delete on public.routes as restrictive for delete to authenticated using(public.operations_resource_allowed('routes','edit',coalesce(center_code,'')));
create policy menu_read on public.route_stops as restrictive for select to authenticated using(public.operations_resource_allowed('routes','read',coalesce((select center_code from public.routes where id=route_id),'')));
create policy menu_insert on public.route_stops as restrictive for insert to authenticated with check(public.operations_resource_allowed('routes','edit',coalesce((select center_code from public.routes where id=route_id),'')));
create policy menu_update on public.route_stops as restrictive for update to authenticated using(public.operations_resource_allowed('routes','edit',coalesce((select center_code from public.routes where id=route_id),''))) with check(public.operations_resource_allowed('routes','edit',coalesce((select center_code from public.routes where id=route_id),'')));
create policy menu_delete on public.route_stops as restrictive for delete to authenticated using(public.operations_resource_allowed('routes','edit',coalesce((select center_code from public.routes where id=route_id),'')));
create policy menu_read on public.transfer_deliveries as restrictive for select to authenticated using(public.operations_resource_allowed('transfers','read',coalesce(center_code,'')));
create policy menu_insert on public.transfer_deliveries as restrictive for insert to authenticated with check(public.operations_resource_allowed('transfers','edit',coalesce(center_code,'')));
create policy menu_update on public.transfer_deliveries as restrictive for update to authenticated using(public.operations_resource_allowed('transfers','edit',coalesce(center_code,''))) with check(public.operations_resource_allowed('transfers','edit',coalesce(center_code,'')));
create policy menu_delete on public.transfer_deliveries as restrictive for delete to authenticated using(public.operations_resource_allowed('transfers','edit',coalesce(center_code,'')));
create policy menu_read on public.charter_trips as restrictive for select to authenticated using(public.operations_resource_allowed('charter','read',coalesce(center_code,'')));
create policy menu_read on public.charter_archives as restrictive for select to authenticated using(public.operations_resource_allowed('charter','read',coalesce(center_code,'')));
create policy menu_read on public.one_top_two_room_captures as restrictive for select to authenticated using(public.operations_resource_allowed('one_top','read',coalesce(center_code,'')));
create policy menu_insert on public.one_top_two_room_captures as restrictive for insert to authenticated with check(public.operations_resource_allowed('one_top','edit',coalesce(center_code,'')));
create policy menu_update on public.one_top_two_room_captures as restrictive for update to authenticated using(public.operations_resource_allowed('one_top','edit',coalesce(center_code,''))) with check(public.operations_resource_allowed('one_top','edit',coalesce(center_code,'')));
create policy menu_delete on public.one_top_two_room_captures as restrictive for delete to authenticated using(public.operations_resource_allowed('one_top','edit',coalesce(center_code,'')));
create policy menu_read on public.driver_documents as restrictive for select to authenticated using(public.operations_resource_allowed('drivers','read',coalesce((select center_code from public.drivers where id=driver_id),'')));
create policy menu_read on public.company_documents as restrictive for select to authenticated using(public.operations_resource_allowed('companies','read',coalesce((select center_code from public.companies where id=company_id),'')));
create policy menu_read on public.operations_tasks as restrictive for select to authenticated using(public.operations_resource_allowed('tasks','read',coalesce(center_code,'')) and (deleted_at is null or public.operations_resource_allowed('trash','read',center_code)));
create policy menu_read on public.operations_incidents as restrictive for select to authenticated using(public.operations_resource_allowed('incidents','read',coalesce(center_code,'')));
create policy menu_read on public.operations_templates as restrictive for select to authenticated using(public.operations_resource_allowed('forms','read',coalesce(center_code,'')));
create policy menu_read on public.operations_surveys as restrictive for select to authenticated using(public.operations_resource_allowed('forms','read',coalesce(center_code,'')));
create policy menu_read on public.operations_ai_results as restrictive for select to authenticated using(public.operations_resource_allowed('briefing','read',null));
create policy menu_read on public.operations_master_backups as restrictive for select to authenticated using(public.operations_resource_allowed('backups','read',null));
create policy menu_read on public.audit_log as restrictive for select to authenticated using(public.operations_resource_allowed('audit','read',coalesce(center_code,'')));
create policy menu_read on public.operations_files as restrictive for select to authenticated using(public.operations_resource_allowed(case when task_id is not null then 'tasks' when incident_id is not null then 'incidents' else 'forms' end,'read',center_code) and (task_id is null or exists(select 1 from public.operations_tasks where id=task_id)));
create policy menu_read on public.operations_notifications as restrictive for select to authenticated using(public.operations_resource_allowed('notifications','read') and (task_id is null or exists(select 1 from public.operations_tasks t where t.id=task_id)) and (incident_id is null or exists(select 1 from public.operations_incidents i where i.id=incident_id)));
create policy menu_read on public.operations_task_events as restrictive for select to authenticated using(public.operations_resource_allowed('history','read',coalesce(after_value->>'center_code',before_value->>'center_code')) and (case when task_id is not null then exists(select 1 from public.operations_tasks t where t.id=task_id) when incident_id is not null then exists(select 1 from public.operations_incidents i where i.id=incident_id) when template_id is not null or survey_id is not null then public.operations_resource_allowed('forms','read',coalesce(after_value->>'center_code',before_value->>'center_code')) else public.is_admin() end));
CREATE OR REPLACE FUNCTION public.operations_publish_custom_template(p_request_id uuid, p_center text, p_title text, p_spec jsonb, p_family_id uuid DEFAULT NULL::uuid)
 RETURNS operations_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.operations_templates; prior public.operations_task_events; body jsonb; family uuid; f jsonb;
begin
 if not public.operations_resource_allowed('forms','edit',p_center) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if auth.uid() is null or p_request_id is null or not public.operations_can_edit_resource('forms',p_center) then raise exception '센터 업무등록 권한이 없습니다' using errcode='42501'; end if;
 perform public.operations_validate_template(p_spec);
 if nullif(trim(p_title),'') is null or length(p_title)>200 or coalesce(p_spec->>'ui_cadence','') not in ('none','daily','weekly','monthly')
 or jsonb_array_length(p_spec->'fields')>50 or jsonb_array_length(p_spec->'steps')>50 then raise exception '업무명·주기·입력 항목을 확인하세요' using errcode='22023'; end if;
 for f in select value from jsonb_array_elements(p_spec->'fields') loop
  if coalesce(f->>'control','') not in ('text','textarea','number','checkbox','date','select')
   or f->>'type' is distinct from (case f->>'control' when 'number' then 'number' when 'checkbox' then 'boolean' else 'string' end) then raise exception '입력 방식과 값 형식이 일치하지 않습니다' using errcode='22023'; end if;
  if f->>'control'='select' then
   if jsonb_typeof(f->'options') is distinct from 'array' then raise exception '선택 목록을 입력하세요' using errcode='22023'; end if;
   if jsonb_array_length(f->'options') not between 1 and 100 or exists(select 1 from jsonb_array_elements(f->'options') x where jsonb_typeof(x)<>'string' or nullif(trim(x#>>'{}'),'') is null) then raise exception '선택 목록을 확인하세요' using errcode='22023'; end if;
  end if;
 end loop;
 body:=jsonb_build_object('operation','publish_custom_template','center',p_center,'title',p_title,'spec',p_spec,'family',p_family_id);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
  select * into t from public.operations_templates where id=prior.template_id;if not public.operations_resource_allowed('forms','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
 end if;
 family:=coalesce(p_family_id,gen_random_uuid());perform pg_advisory_xact_lock(hashtextextended(family::text,0));
 if p_family_id is not null and not exists(select 1 from public.operations_templates where family_id=family and center_code=p_center) then raise exception '수정할 센터 양식을 찾을 수 없습니다' using errcode='22023'; end if;
 if exists(select 1 from public.operations_templates where family_id=family and center_code<>p_center) then raise exception '다른 센터의 양식은 수정할 수 없습니다' using errcode='42501'; end if;
 insert into public.operations_templates(family_id,version,center_code,title,spec,status,created_by,approved_by,approved_at)
 values(family,(select coalesce(max(version),0)+1 from public.operations_templates where family_id=family),p_center,trim(p_title),
 p_spec||jsonb_build_object('manual_issue',true,'owner_ids','[]'::jsonb),'approved',auth.uid(),auth.uid(),now()) returning * into t;
 insert into public.operations_task_events(template_id,actor_id,request_id,request_body,action,after_value)
 values(t.id,auth.uid(),p_request_id,body,'template_approved',to_jsonb(t));if not public.operations_resource_allowed('forms','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end; $function$
;

CREATE OR REPLACE FUNCTION public.operations_issue_custom_task(p_request_id uuid, p_template_id uuid, p_work_date date)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare template public.operations_templates; t public.operations_tasks; prior public.operations_task_events; body jsonb; occurrence text; period_date date; cadence text; steps jsonb;
begin
 if not public.operations_resource_allowed('tasks','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if auth.uid() is null or p_request_id is null or p_work_date is null then raise exception '티켓 발행 요청을 확인하세요' using errcode='22023'; end if;
 select * into template from public.operations_templates where id=p_template_id for share;
 if not found or (not public.operations_can_edit_resource('tasks',template.center_code) or not public.operations_resource_allowed('forms','read',template.center_code)) then raise exception '센터 업무 발행 권한이 없습니다' using errcode='42501'; end if;
 body:=jsonb_build_object('operation','issue_custom_task','template',p_template_id,'date',p_work_date);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
  select * into t from public.operations_tasks where id=prior.task_id;if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(template.family_id::text,0));
 if template.status<>'approved' or coalesce(template.spec->>'manual_issue','false')<>'true'
 or coalesce((template.spec->>'effective_from')::date,(template.approved_at at time zone 'Asia/Seoul')::date)>p_work_date
 or exists(select 1 from public.operations_templates x where x.family_id=template.family_id and x.version>template.version and x.status in ('approved','retired') and coalesce((x.spec->>'effective_from')::date,(x.approved_at at time zone 'Asia/Seoul')::date)<=p_work_date) then raise exception '현재 사용할 수 있는 최신 업무 양식이 필요합니다' using errcode='22023'; end if;
 cadence:=template.spec->>'ui_cadence';
 if cadence is null or cadence not in ('none','daily','weekly','monthly') then raise exception '업무 주기를 확인하세요' using errcode='22023'; end if;
 period_date:=case cadence when 'weekly' then p_work_date-(extract(isodow from p_work_date)::integer-1) when 'monthly' then date_trunc('month',p_work_date)::date else p_work_date end;
 -- One center ticket per configured period, independent of who presses the button.
 occurrence:='custom:'||template.family_id::text||':'||cadence||':'||case when cadence='none' then p_request_id::text else period_date::text end;
 perform pg_advisory_xact_lock(hashtextextended(occurrence,0));
 select * into t from public.operations_tasks where occurrence_key=occurrence;
 if not found then
  select coalesce(jsonb_object_agg(value->>'key','pending'::text),'{}') into steps from jsonb_array_elements(template.spec->'steps');
  insert into public.operations_tasks(center_code,title,work_date,owner_id,created_by,inputs,template_id,template_snapshot,occurrence_key)
  values(template.center_code,template.title,p_work_date,auth.uid(),auth.uid(),jsonb_build_object('steps',steps),template.id,to_jsonb(template),occurrence) returning * into t;
  insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,after_value)
  values(t.id,auth.uid(),p_request_id,body,'created',to_jsonb(t));
 else
  -- Audit the reused ticket as well, so retrying this request remains deterministic.
  insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
  values(t.id,auth.uid(),p_request_id,body,'updated',to_jsonb(t),to_jsonb(t));
 end if;
 if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end; $function$
;

CREATE OR REPLACE FUNCTION public.delete_charter_trip(p_center text, p_id text, p_version bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare removed integer;
begin
 if not public.operations_resource_allowed('charter','edit',p_center) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role in ('editor','admin')) then raise exception '삭제 권한이 없습니다.';end if;
 if p_center is null or p_center not in ('001','002') or coalesce(p_id,'')='' or p_version is null or p_version<1 then raise exception '삭제할 운행을 확인해 주세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended('charter:'||p_center,0));
 delete from public.charter_trips where center_code=p_center and id=p_id and version=p_version;
 get diagnostics removed=row_count;
 if removed<>1 then raise exception '다른 사용자가 수정하거나 삭제한 데이터입니다. DB를 다시 조회해 주세요.';end if;
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.operations_task_trash(p_request_id uuid, p_task_id uuid, p_expected_version integer, p_restore boolean DEFAULT false)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb;
begin
 if not public.operations_resource_allowed('trash','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if auth.uid() is null or p_request_id is null or p_restore is null then raise exception '활성 사용자 인증과 요청 번호가 필요합니다' using errcode='42501'; end if;
 body:=jsonb_build_object('operation','task_trash','task',p_task_id,'version',p_expected_version,'restore',p_restore);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into t from public.operations_tasks where id=p_task_id for update;
 if not found or not (public.operations_can_edit_resource('trash',t.center_code) and public.operations_can_edit_resource('tasks',t.center_code)) then raise exception '해당 센터 업무 수정 권한이 없습니다' using errcode='42501';end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023';end if;if not public.operations_resource_allowed('trash','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;end if;
 if p_expected_version is null or t.version<>p_expected_version then raise exception '다른 사용자가 수정했습니다. 새로고침 후 확인하세요' using errcode='40001';end if;
 if (p_restore and t.deleted_at is null) or (not p_restore and t.deleted_at is not null) then raise exception '업무의 휴지통 상태가 변경되었습니다' using errcode='22023';end if;
 before_row:=to_jsonb(t);
 update public.operations_tasks set deleted_at=case when p_restore then null else now() end,
 deleted_by=case when p_restore then null else auth.uid() end,version=version+1,updated_at=now() where id=t.id returning * into t;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
 values(t.id,auth.uid(),p_request_id,body,case when p_restore then 'task_restored' else 'task_trashed' end,before_row,to_jsonb(t));if not public.operations_resource_allowed('trash','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end; $function$
;

CREATE OR REPLACE FUNCTION public.operations_set_task_participants(p_request_id uuid, p_task_id uuid, p_expected_version integer, p_handler uuid, p_from uuid DEFAULT NULL::uuid, p_to uuid DEFAULT NULL::uuid, p_memo text DEFAULT ''::text)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb; target uuid; subject public.operations_subjects; option_id uuid;
begin
 if not public.operations_resource_allowed('tasks','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if auth.uid() is null or p_request_id is null or length(coalesce(p_memo,''))>2000 then raise exception '활성 사용자 인증과 인계 요청을 확인하세요' using errcode='42501';end if;
 body:=jsonb_build_object('operation','set_task_participants','task',p_task_id,'version',p_expected_version,'handler',p_handler,'from',p_from,'to',p_to,'data',jsonb_build_object('memo',p_memo));
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into t from public.operations_tasks where id=p_task_id for update;
 if not found or not public.operations_can_edit_resource('tasks',t.center_code) then raise exception '센터 업무 수정 권한이 없습니다' using errcode='42501';end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023';end if;if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;end if;
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
 end if;if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end; $function$
;

CREATE OR REPLACE FUNCTION public.purge_charter_month(p_archive uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.charter_archives;r jsonb;n integer;removed integer;start_date date;end_date date;
begin
 if not public.operations_resource_allowed('charter','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then raise exception '월 정리는 관리자만 가능합니다.';end if;
 select * into a from public.charter_archives where id=p_archive for update;
 if a.id is null or a.snapshot is null or a.purged_at is not null or a.verified_at is null then raise exception '검증된 보관본이 필요합니다.';end if;
 perform pg_advisory_xact_lock(hashtextextended('charter:'||a.center_code,0));
 start_date:=(a.month||'-01')::date;end_date:=(start_date+interval '1 month')::date;
 select count(*) into n from public.charter_trips where center_code=a.center_code and business_date>=start_date and business_date<end_date;
 if n<>a.record_count or n<>jsonb_array_length(a.snapshot->'rows') then raise exception '보관 이후 데이터가 바뀌었습니다. 다시 보관해 주세요.';end if;
 for r in select value from jsonb_array_elements(a.snapshot->'rows') loop
  if not exists(select 1 from public.charter_trips where center_code=a.center_code and id=r->>'id' and version=(r->>'version')::bigint and payload=r->'payload' and business_date>=start_date and business_date<end_date) then raise exception '보관 이후 데이터가 바뀌었습니다. 다시 보관해 주세요.';end if;
 end loop;
 delete from public.charter_trips where center_code=a.center_code and business_date>=start_date and business_date<end_date;
 get diagnostics removed=row_count;
 update public.charter_archives set purged_at=now(),snapshot=null where id=a.id;
 return removed;
end $function$
;

CREATE OR REPLACE FUNCTION public.save_charter_trips(p_center text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb;old_version bigint;out_rows jsonb:='[]'::jsonb;new_row public.charter_trips;
begin
 if not public.operations_resource_allowed('charter','edit',p_center) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role in ('editor','admin')) then raise exception '저장 권한이 없습니다.';end if;
 if p_center is null or p_rows is null or p_center not in ('001','002') or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>500 then raise exception '저장 데이터 범위를 확인해 주세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended('charter:'||p_center,0));
 for r in select value from jsonb_array_elements(p_rows) loop
  if coalesce(r->'payload'->>'id','')='' or (r->'payload'->>'centerCode') is distinct from p_center or coalesce(jsonb_typeof(r->'payload'->'deliveries'),'')<>'array' then raise exception '운행ID 또는 센터가 올바르지 않습니다.';end if;
  select version into old_version from public.charter_trips where center_code=p_center and id=r->'payload'->>'id' for update;
  if coalesce(old_version,0)<>coalesce((r->>'expectedVersion')::bigint,0) then raise exception '다른 사용자가 수정한 데이터입니다. DB를 다시 조회해 주세요.';end if;
  insert into public.charter_trips(center_code,id,business_date,payload,version,updated_by)
  values(p_center,r->'payload'->>'id',nullif(r->'payload'->>'date','')::date,r->'payload',coalesce(old_version,0)+1,auth.uid())
  on conflict(center_code,id) do update set business_date=excluded.business_date,payload=excluded.payload,version=excluded.version,updated_by=excluded.updated_by,updated_at=now()
  returning * into new_row;
  out_rows:=out_rows||jsonb_build_array(jsonb_build_object('id',new_row.id,'version',new_row.version));
 end loop;
 return out_rows;
end $function$
;

CREATE OR REPLACE FUNCTION public.operations_issue_task_period(p_request_id uuid, p_template_id uuid, p_work_date date, p_end_date date)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare template public.operations_templates; t public.operations_tasks; prior public.operations_task_events; body jsonb; occurrence text; period_date date; cadence text; steps jsonb;
begin
 if not public.operations_resource_allowed('tasks','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if p_end_date is null or p_end_date<p_work_date then raise exception '종료일은 시작일 이후로 설정하세요' using errcode='22023';end if;
 if auth.uid() is null or p_request_id is null or p_work_date is null then raise exception '티켓 발행 요청을 확인하세요' using errcode='22023'; end if;
 select * into template from public.operations_templates where id=p_template_id for share;
 if not found or (not public.operations_can_edit_resource('tasks',template.center_code) or not public.operations_resource_allowed('forms','read',template.center_code)) then raise exception '센터 업무 발행 권한이 없습니다' using errcode='42501'; end if;
 body:=jsonb_build_object('operation','issue_custom_task','template',p_template_id,'date',p_work_date,'end_date',p_end_date);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
  select * into t from public.operations_tasks where id=prior.task_id;if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(template.family_id::text,0));
 if template.status<>'approved'
 or coalesce((template.spec->>'effective_from')::date,(template.approved_at at time zone 'Asia/Seoul')::date)>p_work_date
 or exists(select 1 from public.operations_templates x where x.family_id=template.family_id and x.version>template.version and x.status in ('approved','retired') and coalesce((x.spec->>'effective_from')::date,(x.approved_at at time zone 'Asia/Seoul')::date)<=p_work_date) then raise exception '현재 사용할 수 있는 최신 업무 양식이 필요합니다' using errcode='22023'; end if;
 cadence:=coalesce(template.spec->>'ui_cadence','none');
 if cadence is null or cadence not in ('none','daily','weekly','monthly') then raise exception '업무 주기를 확인하세요' using errcode='22023'; end if;
 period_date:=case cadence when 'weekly' then p_work_date-(extract(isodow from p_work_date)::integer-1) when 'monthly' then date_trunc('month',p_work_date)::date else p_work_date end;
 -- One center ticket per configured period, independent of who presses the button.
 occurrence:='custom:'||template.family_id::text||':'||cadence||':'||case when cadence='none' then p_request_id::text else period_date::text end;
 perform pg_advisory_xact_lock(hashtextextended(occurrence,0));
 select * into t from public.operations_tasks where occurrence_key=occurrence;
 if not found then
  select coalesce(jsonb_object_agg(value->>'key','pending'::text),'{}') into steps from jsonb_array_elements(template.spec->'steps');
  insert into public.operations_tasks(center_code,title,work_date,work_end_date,owner_id,created_by,inputs,template_id,template_snapshot,occurrence_key)
  values(template.center_code,template.title,p_work_date,p_end_date,auth.uid(),auth.uid(),jsonb_build_object('steps',steps),template.id,to_jsonb(template),occurrence) returning * into t;
  insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,after_value)
  values(t.id,auth.uid(),p_request_id,body,'created',to_jsonb(t));
 else
  -- Audit the reused ticket as well, so retrying this request remains deterministic.
  insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
  values(t.id,auth.uid(),p_request_id,body,'updated',to_jsonb(t),to_jsonb(t));
 end if;
 if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end; $function$
;

CREATE OR REPLACE FUNCTION public.operations_save_task_period(p_request_id uuid, p_task_id uuid, p_expected_version integer, p_center text, p_title text, p_work_date date, p_inputs jsonb, p_status text, p_end_date date)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid:=auth.uid(); v_task public.operations_tasks; v_prior public.operations_task_events;
  v_before jsonb; v_body jsonb; v_action text;
begin
 if not public.operations_resource_allowed('tasks','edit',p_center) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

  if p_end_date is null or p_end_date<p_work_date then raise exception '종료일은 시작일 이후로 설정하세요' using errcode='22023';end if;
  if v_actor is null or p_request_id is null or not public.operations_can_edit_resource('tasks',p_center) then
    raise exception '업무 수정 권한이 없습니다' using errcode='42501';
  end if;
  if p_title is null or p_work_date is null or p_inputs is null or jsonb_typeof(p_inputs)<>'object'
    or p_status is null or p_status not in ('pending','in_progress','completed','not_applicable') then
    raise exception '업무 입력값을 확인해 주세요' using errcode='22023';
  end if;
  v_body:=jsonb_build_object('id',p_task_id,'version',p_expected_version,'center',p_center,
    'title',p_title,'date',p_work_date,'end_date',p_end_date,'inputs',p_inputs,'status',p_status);
  -- Concurrent retries of the same request execute once.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_request_id::text,0));
  select * into v_prior from public.operations_task_events where actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_prior.request_body<>v_body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
    select * into v_task from public.operations_tasks where id=v_prior.task_id;
    if not public.operations_resource_allowed('tasks','read',v_task.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return v_task;
  end if;
  if p_task_id is null then
    if p_expected_version is not null or p_status<>'pending' then
      raise exception '새 업무는 미완료 상태로 생성합니다' using errcode='22023';
    end if;
    insert into public.operations_tasks(center_code,title,work_date,work_end_date,owner_id,created_by,inputs)
      values(p_center,trim(p_title),p_work_date,p_end_date,v_actor,v_actor,p_inputs) returning * into v_task;
    v_action:='created';
  else
    select * into v_task from public.operations_tasks where id=p_task_id for update;
    if not found or v_task.center_code<>p_center then
      raise exception '업무와 센터가 일치하지 않습니다' using errcode='42501';
    end if;
    if p_expected_version is null or v_task.version<>p_expected_version then
      raise exception '다른 사용자가 수정했습니다. 새로고침 후 확인해 주세요' using errcode='40001';
    end if;
    if v_task.status in ('completed','not_applicable') then
      raise exception '확정된 업무 기록은 변경할 수 없습니다' using errcode='22023';
    end if;
    v_before:=to_jsonb(v_task);
    update public.operations_tasks set title=trim(p_title),work_date=p_work_date,work_end_date=p_end_date,inputs=p_inputs,status=p_status,
      version=version+1,updated_at=now(),
      completed_by=case when p_status in ('completed','not_applicable') then v_actor end,
      completed_at=case when p_status in ('completed','not_applicable') then now() end
      where id=p_task_id returning * into v_task;
    v_action:=case when p_status in ('completed','not_applicable') then p_status else 'updated' end;
  end if;
  insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
    values(v_task.id,v_actor,p_request_id,v_body,v_action,v_before,to_jsonb(v_task));
  if not public.operations_resource_allowed('tasks','read',v_task.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return v_task;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.operations_save_task(p_request_id uuid, p_task_id uuid, p_expected_version integer, p_center text, p_title text, p_work_date date, p_inputs jsonb, p_status text)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid:=auth.uid(); v_task public.operations_tasks; v_prior public.operations_task_events;
  v_before jsonb; v_body jsonb; v_action text;
begin
 if not public.operations_resource_allowed('tasks','edit',p_center) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

  if v_actor is null or p_request_id is null or not public.operations_can_edit_resource('tasks',p_center) then
    raise exception '업무 수정 권한이 없습니다' using errcode='42501';
  end if;
  if p_title is null or p_work_date is null or p_inputs is null or jsonb_typeof(p_inputs)<>'object'
    or p_status is null or p_status not in ('pending','in_progress','completed','not_applicable') then
    raise exception '업무 입력값을 확인해 주세요' using errcode='22023';
  end if;
  v_body:=jsonb_build_object('id',p_task_id,'version',p_expected_version,'center',p_center,
    'title',p_title,'date',p_work_date,'inputs',p_inputs,'status',p_status);
  -- Concurrent retries of the same request execute once.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_request_id::text,0));
  select * into v_prior from public.operations_task_events where actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_prior.request_body<>v_body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
    select * into v_task from public.operations_tasks where id=v_prior.task_id;
    if not public.operations_resource_allowed('tasks','read',v_task.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return v_task;
  end if;
  if p_task_id is null then
    if p_expected_version is not null or p_status<>'pending' then
      raise exception '새 업무는 미완료 상태로 생성합니다' using errcode='22023';
    end if;
    insert into public.operations_tasks(center_code,title,work_date,owner_id,created_by,inputs)
      values(p_center,trim(p_title),p_work_date,v_actor,v_actor,p_inputs) returning * into v_task;
    v_action:='created';
  else
    select * into v_task from public.operations_tasks where id=p_task_id for update;
    if not found or v_task.center_code<>p_center then
      raise exception '업무와 센터가 일치하지 않습니다' using errcode='42501';
    end if;
    if p_expected_version is null or v_task.version<>p_expected_version then
      raise exception '다른 사용자가 수정했습니다. 새로고침 후 확인해 주세요' using errcode='40001';
    end if;
    if v_task.status in ('completed','not_applicable') then
      raise exception '확정된 업무 기록은 변경할 수 없습니다' using errcode='22023';
    end if;
    v_before:=to_jsonb(v_task);
    update public.operations_tasks set title=trim(p_title),work_date=p_work_date,inputs=p_inputs,status=p_status,
      version=version+1,updated_at=now(),
      completed_by=case when p_status in ('completed','not_applicable') then v_actor end,
      completed_at=case when p_status in ('completed','not_applicable') then now() end
      where id=p_task_id returning * into v_task;
    v_action:=case when p_status in ('completed','not_applicable') then p_status else 'updated' end;
  end if;
  insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
    values(v_task.id,v_actor,p_request_id,v_body,v_action,v_before,to_jsonb(v_task));
  if not public.operations_resource_allowed('tasks','read',v_task.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return v_task;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.operations_incident_action(p_request_id uuid, p_incident_id uuid, p_expected_version integer, p_action text, p_data jsonb)
 RETURNS operations_incidents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare i public.operations_incidents; prior public.operations_task_events; body jsonb; before_row jsonb;
 center text; linked_task uuid; event_action text; is_hq boolean;
begin
 if not public.operations_resource_allowed('incidents','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if p_request_id is null or not public.operations_can_read() then
   raise exception '활성 사용자 인증이 필요합니다' using errcode='42501'; end if;
 if p_action is null or p_action not in ('create','edit','request_support','support','resolve','reopen')
   or p_data is null or jsonb_typeof(p_data)<>'object' then
   raise exception '특이사항 요청을 확인해 주세요' using errcode='22023'; end if;
 body:=jsonb_build_object('operation','incident_action','incident',p_incident_id,'version',p_expected_version,
   'action',p_action,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
   select * into i from public.operations_incidents where id=prior.incident_id;
   if not public.operations_resource_allowed('incidents','read',i.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return i;
 end if;
 select exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') into is_hq;
 if p_action='create' then
   linked_task:=(p_data->>'task_id')::uuid;
   if linked_task is null then raise exception '하던 업무에서 특이사항을 등록해 주세요' using errcode='22023'; end if;
   select center_code into center from public.operations_tasks where id=linked_task for share;
   if not found then raise exception '상위 업무를 찾을 수 없습니다' using errcode='22023'; end if;
   if p_data ? 'center_code' and (p_data->>'center_code') is distinct from center then raise exception '센터 속성은 상위 업무에서 가져옵니다' using errcode='22023'; end if;
   if p_incident_id is not null or p_expected_version is not null or not public.operations_can_edit_resource('incidents',center) then
     raise exception '해당 센터 특이사항 등록 권한이 없습니다' using errcode='42501'; end if;
   insert into public.operations_incidents(center_code,task_id,title,kind,inputs,created_by)
     values(center,linked_task,trim(p_data->>'title'),trim(p_data->>'kind'),coalesce(p_data->'inputs','{}'),auth.uid())
     returning * into i;
   event_action:='incident_created';
 else
   select * into i from public.operations_incidents where id=p_incident_id for update;
 if i.id is not null and not public.operations_resource_allowed('incidents','edit',i.center_code) then raise exception '특이사항 수정 권한이 없습니다' using errcode='42501';end if;
   if not found then raise exception '특이사항을 찾을 수 없습니다' using errcode='22023'; end if;
   -- Independent 배송팀 actions append without claiming exclusive ownership.
   if p_action<>'support' and (p_expected_version is null or i.version<>p_expected_version) then
     raise exception '다른 사용자가 수정했습니다' using errcode='40001'; end if;
   if p_action in ('edit','request_support') and not public.operations_can_edit_resource('incidents',i.center_code) then
     raise exception '특이사항 수정 권한이 없습니다' using errcode='42501'; end if;
   if p_action='support' and not is_hq then
     raise exception '배송팀 실제 조치 권한이 필요합니다' using errcode='42501'; end if;
   before_row:=to_jsonb(i);
   case p_action
   when 'edit' then
     if i.status='resolved' then raise exception '해결 기록은 먼저 재개해 주세요' using errcode='22023'; end if;
     update public.operations_incidents set title=coalesce(trim(p_data->>'title'),title),
       inputs=coalesce(p_data->'inputs',inputs) where id=i.id returning * into i;
     event_action:='incident_updated';
   when 'request_support' then
     if i.status='resolved' then raise exception '해결된 특이사항입니다' using errcode='22023'; end if;
     update public.operations_incidents set support_state='requested' where id=i.id returning * into i;
     event_action:='support_requested';
   when 'support' then
     if nullif(trim(p_data->>'note'),'') is null then
       raise exception '실제로 수행한 조치 내용을 입력해 주세요' using errcode='22023'; end if;
     update public.operations_incidents set support_state=case when coalesce((p_data->>'done')::boolean,false)
       then 'done' else 'supporting' end where id=i.id returning * into i;
     event_action:='support_action';
   when 'resolve' then
     if (p_data ? 'title' or p_data ? 'inputs') and not public.operations_can_edit_resource('incidents',i.center_code) then raise exception '특이사항 내용 수정 권한이 없습니다' using errcode='42501'; end if;
     if i.status='resolved' then raise exception '이미 해결된 특이사항입니다' using errcode='22023'; end if;
     update public.operations_incidents set status='resolved',resolved_by=auth.uid(),resolved_at=now(),
       title=coalesce(trim(p_data->>'title'),title),
       inputs=coalesce(p_data->'inputs',inputs)||jsonb_build_object('처리내용',coalesce(p_data->>'note',p_data->'inputs'->>'처리내용',inputs->>'처리내용',''))
       where id=i.id returning * into i;
     event_action:='resolved';
   when 'reopen' then
     if i.status='open' then raise exception '이미 진행 중인 특이사항입니다' using errcode='22023'; end if;
     update public.operations_incidents set status='open',resolved_by=null,resolved_at=null
       where id=i.id returning * into i;
     event_action:='reopened';
   end case;
   update public.operations_incidents set version=version+1,updated_at=now() where id=i.id returning * into i;
 end if;
 insert into public.operations_task_events(incident_id,actor_id,request_id,request_body,action,before_value,after_value)
   values(i.id,auth.uid(),p_request_id,body,event_action,before_row,to_jsonb(i));
 if not public.operations_resource_allowed('incidents','read',i.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return i;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.operations_task_action(p_request_id uuid, p_task_id uuid, p_expected_version integer, p_action text, p_data jsonb)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb;
 target uuid; deadline timestamptz; cj_deadline timestamptz;
begin
 if not public.operations_resource_allowed('tasks','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if auth.uid() is null or p_request_id is null or p_action not in ('handoff','deadline')
   or p_action is null or p_data is null or jsonb_typeof(p_data)<>'object' then
   raise exception '인계 또는 마감시간 요청을 확인해 주세요' using errcode='22023';
 end if;
 body:=jsonb_build_object('operation','task_action','task',p_task_id,'version',p_expected_version,'action',p_action,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into t from public.operations_tasks where id=p_task_id for update;
 if not found or not public.operations_can_edit_resource('tasks',t.center_code) then
   raise exception '업무 수정 권한이 없습니다' using errcode='42501'; end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
   if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
 end if;
 if p_expected_version is null or t.version<>p_expected_version then
   raise exception '다른 사용자가 수정했습니다' using errcode='40001'; end if;
 if t.status in ('completed','not_applicable') then
   raise exception '확정된 업무는 인계하거나 기한을 변경할 수 없습니다' using errcode='22023'; end if;
 before_row:=to_jsonb(t);
 if p_action='handoff' then
   target:=(p_data->>'owner_id')::uuid;
   if target is null or target=t.owner_id or not exists(select 1 from public.user_profiles p
     where p.id=target and p.active and (p.role='admin' or (p.role='editor' and exists(
       select 1 from public.operations_center_members m where m.user_id=target and m.center_code=t.center_code)))) then
     raise exception '해당 센터 업무를 맡을 수 있는 다음 담당자를 선택해 주세요' using errcode='22023'; end if;
   if p_data - array['owner_id','memo'] <> '{}'::jsonb then
     raise exception '인계에서 업무 내용이나 기한은 변경하지 않습니다' using errcode='22023'; end if;
   update public.operations_tasks set owner_id=target,version=version+1,updated_at=now()
     where id=t.id returning * into t;
 else
   if p_data - array['due_at','cj_share_due_at','reason'] <> '{}'::jsonb then
     raise exception '마감시간 요청을 확인해 주세요' using errcode='22023'; end if;
   deadline:=case when p_data ? 'due_at' then (p_data->>'due_at')::timestamptz else t.due_at end;
   cj_deadline:=case when p_data ? 'cj_share_due_at' then (p_data->>'cj_share_due_at')::timestamptz else t.cj_share_due_at end;
   if deadline is not distinct from t.due_at and cj_deadline is not distinct from t.cj_share_due_at then
     raise exception '변경된 마감시간이 없습니다' using errcode='22023'; end if;
   if ((t.due_at is not null and deadline is distinct from t.due_at)
     or (t.cj_share_due_at is not null and cj_deadline is distinct from t.cj_share_due_at))
     and nullif(trim(p_data->>'reason'),'') is null then
     raise exception '기존 마감시간 변경 사유를 입력해 주세요' using errcode='22023'; end if;
   update public.operations_tasks set due_at=deadline,cj_share_due_at=cj_deadline,
     version=version+1,updated_at=now() where id=t.id returning * into t;
 end if;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
   values(t.id,auth.uid(),p_request_id,body,p_action,before_row,to_jsonb(t));
 if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.operations_template_action(p_request_id uuid, p_template_id uuid, p_action text, p_data jsonb)
 RETURNS operations_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.operations_templates; prior public.operations_task_events; body jsonb; family uuid; before_row jsonb;
begin
 if not public.operations_resource_allowed('forms','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if p_request_id is null or not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then
   raise exception 'HQ 양식 관리 권한이 필요합니다' using errcode='42501'; end if;
 if p_action is null or p_action not in ('create','approve','retire') or p_data is null or jsonb_typeof(p_data)<>'object' then
   raise exception '양식 관리 요청을 확인해 주세요' using errcode='22023'; end if;
 body:=jsonb_build_object('operation','template_action','template',p_template_id,'action',p_action,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
   select * into t from public.operations_templates where id=prior.template_id; if not public.operations_resource_allowed('forms','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
 end if;
 if p_action='create' then
   if p_template_id is not null then raise exception '신규 양식 ID는 서버에서 생성합니다' using errcode='22023'; end if;
   perform public.operations_validate_template(p_data->'spec');
   family:=coalesce((p_data->>'family_id')::uuid,gen_random_uuid());
   perform pg_advisory_xact_lock(hashtextextended(family::text,0));
   if exists(select 1 from public.operations_templates where family_id=family and center_code<>p_data->>'center_code') then
     raise exception '다른 센터 양식과 버전을 공유할 수 없습니다' using errcode='22023'; end if;
   insert into public.operations_templates(family_id,version,center_code,title,spec,created_by)
     values(family,(select coalesce(max(version),0)+1 from public.operations_templates where family_id=family),
       p_data->>'center_code',trim(p_data->>'title'),p_data->'spec',auth.uid()) returning * into t;
 else
   select * into t from public.operations_templates where id=p_template_id for update;
   if not found then raise exception '양식을 찾을 수 없습니다' using errcode='22023'; end if;
   before_row:=to_jsonb(t);
   if p_action='approve' then
     if t.status<>'draft' then raise exception '초안만 승인할 수 있습니다' using errcode='22023'; end if;
     perform public.operations_validate_template(t.spec);
     update public.operations_templates set status='approved',approved_by=auth.uid(),approved_at=now()
       where id=t.id returning * into t;
   else
     if t.status<>'approved' then raise exception '승인 양식만 사용 중지할 수 있습니다' using errcode='22023'; end if;
     update public.operations_templates set status='retired' where id=t.id returning * into t;
   end if;
 end if;
 insert into public.operations_task_events(template_id,actor_id,request_id,request_body,action,before_value,after_value)
   values(t.id,auth.uid(),p_request_id,body,case p_action when 'create' then 'template_created'
     when 'approve' then 'template_approved' else 'template_retired' end,before_row,to_jsonb(t));
 if not public.operations_resource_allowed('forms','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.operations_task_from_template(p_request_id uuid, p_template_id uuid, p_work_date date, p_inputs jsonb, p_owner_id uuid DEFAULT NULL::uuid, p_recurring boolean DEFAULT false)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare template public.operations_templates; t public.operations_tasks; prior public.operations_task_events;
 body jsonb; owner uuid:=coalesce(p_owner_id,auth.uid()); steps jsonb; occurrence text; repeat_kind text;
begin
 if not public.operations_resource_allowed('tasks','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if auth.uid() is null or p_request_id is null or p_work_date is null or p_recurring is null
   or p_inputs is null or jsonb_typeof(p_inputs)<>'object' then
   raise exception '업무 생성 요청을 확인해 주세요' using errcode='22023'; end if;
 select * into template from public.operations_templates where id=p_template_id;
 if not found or (not public.operations_can_edit_resource('tasks',template.center_code) or not public.operations_resource_allowed('forms','read',template.center_code)) then
   raise exception '해당 센터 업무 생성 권한이 없습니다' using errcode='42501'; end if;
 body:=jsonb_build_object('operation','from_template','template',p_template_id,'date',p_work_date,'inputs',p_inputs,'owner',owner,'recurring',p_recurring);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
   select * into t from public.operations_tasks where id=prior.task_id; if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
 end if;
 if template.status<>'approved' or coalesce((template.spec->>'effective_from')::date,(template.approved_at at time zone 'Asia/Seoul')::date)>p_work_date
   or exists(select 1 from public.operations_templates other where other.family_id=template.family_id
     and other.status in ('approved','retired') and other.version>template.version
     and coalesce((other.spec->>'effective_from')::date,(other.approved_at at time zone 'Asia/Seoul')::date)<=p_work_date) then
   raise exception '해당 날짜의 최신 승인 양식이 필요합니다' using errcode='22023'; end if;
 if not exists(select 1 from public.user_profiles p where p.id=owner and p.active and (p.role='admin'
   or (p.role='editor' and exists(select 1 from public.operations_center_members m
     where m.user_id=p.id and m.center_code=template.center_code)))) then
   raise exception '담당자의 센터 업무 권한을 확인해 주세요' using errcode='22023'; end if;
 if p_inputs ? 'steps' then raise exception '새 업무의 단계는 미완료로 시작합니다' using errcode='22023'; end if;
 if p_recurring then
   repeat_kind:=coalesce(template.spec->'repeat'->>'kind','none');
   if not (repeat_kind='daily' or (repeat_kind='weekdays' and template.spec->'repeat'->'days' @> to_jsonb(array[extract(isodow from p_work_date)::integer]))
     or (repeat_kind='monthly' and extract(day from p_work_date)::integer=(template.spec->'repeat'->>'day')::integer)
     or (repeat_kind='once' and p_work_date=(template.spec->'repeat'->>'date')::date)) then
     raise exception '반복 일정에 해당하지 않는 날짜입니다' using errcode='22023'; end if;
   occurrence:=template.family_id::text||':'||p_work_date::text||':'||owner::text;
   perform pg_advisory_xact_lock(hashtextextended(occurrence,0));
   select * into t from public.operations_tasks where occurrence_key=occurrence;
   if found then if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t; end if;
 end if;
 select coalesce(jsonb_object_agg(value->>'key','pending'::text),'{}') into steps
   from jsonb_array_elements(template.spec->'steps');
 insert into public.operations_tasks(center_code,title,work_date,owner_id,created_by,inputs,template_id,template_snapshot,occurrence_key)
   values(template.center_code,template.title,p_work_date,owner,auth.uid(),p_inputs||jsonb_build_object('steps',steps),
     template.id,to_jsonb(template),occurrence) returning * into t;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,after_value)
   values(t.id,auth.uid(),p_request_id,body,'created',to_jsonb(t));
 if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.operations_reopen_task(p_request_id uuid, p_task_id uuid, p_expected_version integer)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb;
begin
 if not public.operations_resource_allowed('tasks','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if p_request_id is null then raise exception '요청 번호가 필요합니다' using errcode='22023'; end if;
 body:=jsonb_build_object('operation','reopen_task','task',p_task_id,'version',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into t from public.operations_tasks where id=p_task_id for update;
 if not found or not public.operations_can_edit_resource('tasks',t.center_code) then raise exception '센터 수정 권한이 없습니다' using errcode='42501'; end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
  if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
 end if;
 if t.version is distinct from p_expected_version then raise exception '다른 사용자가 수정했습니다' using errcode='40001'; end if;
 if t.status not in ('completed','not_applicable') then raise exception '완료된 업무만 재개할 수 있습니다' using errcode='22023'; end if;
 before_row:=to_jsonb(t);
 update public.operations_tasks set status='in_progress',completed_by=null,completed_at=null,version=version+1,updated_at=now() where id=t.id returning * into t;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
 values(t.id,auth.uid(),p_request_id,body,'task_reopened',before_row,to_jsonb(t));
 if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end $function$
;

CREATE OR REPLACE FUNCTION public.operations_read_notification(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if not public.operations_resource_allowed('notifications','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501'; end if;
 update public.operations_notifications set read_at=coalesce(read_at,now()) where id=p_id and user_id=auth.uid();
 if not found then raise exception '알림 접근 권한이 없습니다' using errcode='42501'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.operations_survey_action(p_request_id uuid, p_id uuid, p_expected_version integer, p_action text, p_data jsonb)
 RETURNS operations_surveys
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s public.operations_surveys; body jsonb; prior public.operations_task_events; t public.operations_templates; before_row jsonb;
begin
 if not public.operations_resource_allowed('forms','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if p_request_id is null or not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501'; end if;
 if p_action is null or p_action not in ('submit','edit','stage','template') or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception '조사 요청을 확인해 주세요' using errcode='22023'; end if;
 body:=jsonb_build_object('operation','survey_action','id',p_id,'version',p_expected_version,'action',p_action,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
  select * into s from public.operations_surveys where id=prior.survey_id; return s;
 end if;
 if p_action='submit' then
  if p_id is not null or p_expected_version is not null or not public.operations_can_edit_resource('forms',p_data->>'center_code') then raise exception '센터 수정 권한이 없습니다' using errcode='42501'; end if;
  insert into public.operations_surveys(center_code,title,details,created_by,updated_by) values(p_data->>'center_code',trim(p_data->>'title'),p_data->'details',auth.uid(),auth.uid()) returning * into s;
 else
  select * into s from public.operations_surveys where id=p_id for update;
  if not found or not public.operations_can_edit_resource('forms',s.center_code) then raise exception '센터 수정 권한이 없습니다' using errcode='42501'; end if;
  if s.version is distinct from p_expected_version then raise exception '다른 사용자가 수정했습니다' using errcode='40001'; end if;
  before_row:=to_jsonb(s);
  if p_action='edit' then
   if s.template_id is not null then raise exception '전환된 조사는 변경 요청으로 새로 등록해 주세요' using errcode='22023'; end if;
   update public.operations_surveys set title=trim(p_data->>'title'),details=p_data->'details' where id=s.id returning * into s;
  else
   if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then raise exception 'HQ 검토 권한이 필요합니다' using errcode='42501'; end if;
   if p_action='stage' then
    if array_position(array['submitted','surveyed','designed','built','verified'],p_data->>'stage') is distinct from array_position(array['submitted','surveyed','designed','built','verified'],s.stage)+1 then raise exception '다음 검증 단계로 진행해 주세요' using errcode='22023'; end if;
    if p_data->>'stage' in ('built','verified') and s.template_id is null then raise exception '승인 양식을 먼저 연결해 주세요' using errcode='22023'; end if;
    update public.operations_surveys set stage=p_data->>'stage' where id=s.id returning * into s;
   else
    if s.template_id is not null or s.stage<>'designed' then raise exception '설계 완료된 조사만 양식으로 전환할 수 있습니다' using errcode='22023'; end if;
    t:=public.operations_template_action(gen_random_uuid(),null,'create',jsonb_build_object('center_code',s.center_code,'title',s.title,'spec',p_data->'spec'));
    t:=public.operations_template_action(gen_random_uuid(),t.id,'approve','{}');
    update public.operations_surveys set template_id=t.id where id=s.id returning * into s;
   end if;
  end if;
  update public.operations_surveys set updated_by=auth.uid(),version=version+1,updated_at=now() where id=s.id returning * into s;
 end if;
 insert into public.operations_task_events(survey_id,actor_id,request_id,request_body,action,before_value,after_value) values(s.id,auth.uid(),p_request_id,body,'survey_'||p_action,before_row,to_jsonb(s));
 return s;
end $function$
;

CREATE OR REPLACE FUNCTION public.operations_record_cj_share(p_request_id uuid, p_task_id uuid, p_expected_version integer, p_shared boolean, p_note text)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare task public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb;
begin
 if not public.operations_resource_allowed('tasks','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if auth.uid() is null or p_request_id is null or p_shared is null or nullif(trim(p_note),'') is null or length(p_note)>2000 then
  raise exception '실제 공유 내용 또는 정정 사유를 입력해 주세요' using errcode='22023';end if;
 body:=jsonb_build_object('operation','cj_share','task',p_task_id,'version',p_expected_version,'shared',p_shared,'data',jsonb_build_object('note',trim(p_note)));
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into task from public.operations_tasks where id=p_task_id for update;
 if not found or not public.operations_can_edit_resource('tasks',task.center_code) then raise exception '업무 수정 권한이 없습니다' using errcode='42501';end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023';end if;
  return task;
 end if;
 if p_expected_version is null or task.version<>p_expected_version then raise exception '다른 사용자가 수정했습니다' using errcode='40001';end if;
 if task.status in ('completed','not_applicable') then raise exception '확정된 업무는 먼저 다시 열어 주세요' using errcode='22023';end if;
 if coalesce(task.inputs->>'cj_shared','false')=p_shared::text then raise exception '공유 상태가 이미 기록되어 있습니다' using errcode='22023';end if;
 before_row:=to_jsonb(task);
 update public.operations_tasks set inputs=inputs||jsonb_build_object('cj_shared',p_shared,'cj_shared_at',case when p_shared then now() else null end,'cj_shared_by',case when p_shared then auth.uid() else null end,'cj_share_note',trim(p_note)),version=version+1,updated_at=now()
  where id=task.id returning * into task;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
 values(task.id,auth.uid(),p_request_id,body,case when p_shared then 'cj_shared' else 'cj_share_retracted' end,before_row,to_jsonb(task));
 return task;
end $function$
;

CREATE OR REPLACE FUNCTION public.operations_reserve_file(p_request uuid, p_actor uuid, p_kind text, p_subject uuid, p_hash text, p_bytes integer, p_mime text, p_original text, p_extension text)
 RETURNS operations_files
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare file_row public.operations_files;subject_row jsonb;center_name text;next_ordinal integer;stem text;file_date date;
begin
 if p_request is null or p_actor is null or p_hash is null or p_hash !~ '^[A-Za-z0-9_-]{43}$' or p_bytes not between 1 and 10485760
  or p_extension is null or p_extension not in ('jpg','png','webp','pdf','xlsx','xls','docx','doc','pptx','csv','txt')
  or p_original is null or length(p_original) not between 1 and 255 or p_mime is null then raise exception '첨부 요청을 확인해 주세요' using errcode='22023';end if;
 if p_kind='task' then select to_jsonb(t) into subject_row from public.operations_tasks t where id=p_subject;
 elsif p_kind='incident' then select to_jsonb(i) into subject_row from public.operations_incidents i where id=p_subject;
 elsif p_kind='survey' then select to_jsonb(s) into subject_row from public.operations_surveys s where id=p_subject;
 else raise exception '첨부 대상이 올바르지 않습니다' using errcode='22023';end if;
 if subject_row is not null and not public.operations_permission_for_actor(case p_kind when 'task' then 'tasks' when 'incident' then 'incidents' else 'forms' end,'edit',subject_row->>'center_code',p_actor) then raise exception '이 목록의 첨부 권한이 없습니다' using errcode='42501';end if;
 if subject_row is null or not exists(select 1 from public.user_profiles p where id=p_actor and active and (role='admin' or (role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p_actor and m.center_code=subject_row->>'center_code'))))
  then raise exception '센터 첨부 권한이 없습니다' using errcode='42501';end if;
 select name into center_name from public.centers where code=subject_row->>'center_code' and active;
 if not found then raise exception '활성 센터를 확인해 주세요' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('file-request:'||p_actor::text||p_request::text,0));
 select * into file_row from public.operations_files where uploaded_by=p_actor and request_id=p_request;
 if found then
  if coalesce(file_row.task_id,file_row.incident_id,file_row.survey_id)<>p_subject or
   (case when file_row.task_id is not null then 'task' when file_row.incident_id is not null then 'incident' else 'survey' end)<>p_kind or
   file_row.content_hash<>p_hash or file_row.byte_size<>p_bytes or file_row.mime_type<>p_mime or file_row.original_name<>p_original then
   raise exception '재시도에는 같은 첨부 파일과 요청 번호를 사용해 주세요' using errcode='22023';end if;
  return file_row;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('file-subject:'||p_kind||p_subject::text,0));
 select coalesce(max(ordinal),0)+1 into next_ordinal from public.operations_files where
  (p_kind='task' and task_id=p_subject) or (p_kind='incident' and incident_id=p_subject) or (p_kind='survey' and survey_id=p_subject);
 file_date:=coalesce((subject_row->>'work_date')::date,((subject_row->>'created_at')::timestamptz at time zone 'Asia/Seoul')::date);
 stem:=to_char(file_date,'YYYYMMDD')||'_'||left(regexp_replace(center_name,'[\\/:*?"<>|[:cntrl:]]','-','g'),35)||'_'||left(regexp_replace(subject_row->>'title','[\\/:*?"<>|[:cntrl:]]','-','g'),60);
 insert into public.operations_files(task_id,incident_id,survey_id,center_code,uploaded_by,request_id,content_hash,original_name,file_name,mime_type,byte_size,ordinal)
 values(case when p_kind='task' then p_subject end,case when p_kind='incident' then p_subject end,case when p_kind='survey' then p_subject end,
 subject_row->>'center_code',p_actor,p_request,p_hash,p_original,stem||'_'||lpad(next_ordinal::text,greatest(3,length(next_ordinal::text)),'0')||'.'||p_extension,p_mime,p_bytes,next_ordinal) returning * into file_row;
 return file_row;
end $function$
;

CREATE OR REPLACE FUNCTION public.operations_commit_file(p_id uuid, p_actor uuid, p_drive text, p_item text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare file_row public.operations_files;subject_row jsonb;
begin
 select * into file_row from public.operations_files where id=p_id for update;
 if file_row.id is not null and not public.operations_permission_for_actor(case when file_row.task_id is not null then 'tasks' when file_row.incident_id is not null then 'incidents' else 'forms' end,'edit',file_row.center_code,p_actor) then raise exception '이 목록의 첨부 권한이 없습니다' using errcode='42501';end if;
 if not found or file_row.uploaded_by<>p_actor or not exists(select 1 from public.user_profiles p where id=p_actor and active and (role='admin' or (role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p_actor and m.center_code=file_row.center_code))))
  then raise exception '첨부 저장 권한이 변경되었습니다' using errcode='42501';end if;
 if file_row.status='saved' then return file_row.id;end if;
 if nullif(p_drive,'') is null or nullif(p_item,'') is null or file_row.drive_id is distinct from p_drive or file_row.item_id is distinct from p_item then raise exception '실제 저장한 파일을 확인해 주세요' using errcode='22023';end if;
 if file_row.task_id is not null then select to_jsonb(t) into subject_row from public.operations_tasks t where id=file_row.task_id;
 elsif file_row.incident_id is not null then select to_jsonb(i) into subject_row from public.operations_incidents i where id=file_row.incident_id;
 else select to_jsonb(s) into subject_row from public.operations_surveys s where id=file_row.survey_id;end if;
 update public.operations_files set status='saved',verified_at=now(),last_error=null where id=p_id;
 insert into public.operations_task_events(task_id,incident_id,survey_id,actor_id,request_id,request_body,action,after_value)
 values(file_row.task_id,file_row.incident_id,file_row.survey_id,p_actor,file_row.request_id,
 jsonb_build_object('operation','file_upload','file_id',file_row.id,'data',jsonb_build_object('note',file_row.file_name)),
 'file_uploaded',subject_row||jsonb_build_object('file',jsonb_build_object('id',file_row.id,'name',file_row.file_name,'bytes',file_row.byte_size)));
 return file_row.id;
end $function$
;

do $patch$ declare source text;begin source:=pg_get_functiondef('public.operations_search(text,text,integer)'::regprocedure);source:=replace(source,'begin',E'begin\n if not public.operations_resource_allowed(''search'',''read'',p_center) then raise exception ''통합 검색 열람 권한이 없습니다'' using errcode=''42501'';end if;');execute source;end $patch$;
notify pgrst,'reload schema';
commit;
