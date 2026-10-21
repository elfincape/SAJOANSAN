-- Dashboard course data must respect the caller's table-level page/center policies.
begin;
alter view public.course_view set (security_invoker=true);
revoke select on public.course_view from public,anon;
commit;
