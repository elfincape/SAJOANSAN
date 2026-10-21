begin;
create function public.operations_ai_scheduler_authorized() returns boolean language sql stable set search_path=public,pg_temp as $$
 select coalesce(auth.role(),'')='service_role';
$$;
revoke all on function public.operations_ai_scheduler_authorized() from public,anon,authenticated;
grant execute on function public.operations_ai_scheduler_authorized() to service_role;
notify pgrst,'reload schema';
commit;
