-- Use the same role/center ceiling for menu access and database writes.
-- Existing page rules and member assignments are preserved.
begin;
create or replace function public.operations_permission_for_actor(p_resource text,p_action text,p_center text,p_actor uuid) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare config public.operations_permissions;role_name text;can_edit boolean;
begin
 select role into role_name from public.user_profiles where id=p_actor and active;
 if role_name is null or p_action is null or p_action not in ('read','edit') then return false;end if;
 select * into config from public.operations_permissions where resource=p_resource;if not found then return false;end if;
 if role_name='admin' then return true;end if;
 if config.admin_only then return false;end if;
 can_edit:=(role_name='editor' or p_resource in ('incidents','notifications')) and public.operations_permission_match(config.write_rule,p_actor,p_center);
 if can_edit and p_resource in ('tasks','forms','trash','drivers','vehicles','companies','delivery_points','routes','transfers','charter','dispatch_parser','one_top') then
  can_edit:=exists(select 1 from public.operations_center_members m where m.user_id=p_actor and (p_center is null or m.center_code=p_center));
 end if;
 if p_action='read' then return public.operations_permission_match(config.read_rule,p_actor,p_center) or can_edit;end if;
 return can_edit;
end $$;
commit;
