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
 can_edit:=(role_name in ('editor','admin') or p_resource in ('incidents','notifications')) and public.operations_permission_match(config.write_rule,p_actor,p_center);
 if p_action='read' then return public.operations_permission_match(config.read_rule,p_actor,p_center) or can_edit;end if;
 return can_edit;
end $$;

commit;
