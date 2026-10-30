-- Personal tools are independent of the selected center. Center data grants stay intact.
begin;

-- Snapshot existing effective eligibility once. New employees start with no tool grant.
-- Inactive profiles are deliberately evaluated too: the existing evaluator denies them.
insert into public.operations_permissions
  (resource, title, section, admin_only, read_rule, write_rule, member_overrides)
select destination, title, '공용 도구', false,
  '{"everyone":false,"roles":[],"centers":[],"scope":"all"}'::jsonb,
  '{"everyone":false,"roles":[],"centers":[],"scope":"all"}'::jsonb,
  coalesce((select jsonb_object_agg(p.id::text, jsonb_build_object(
    'level', case
      when public.operations_permission_for_actor(source, 'edit', null, p.id) then 'edit'
      when public.operations_permission_for_actor(source, 'read', null, p.id) then 'read'
      else 'none' end,
    'scope', 'all')) from public.user_profiles p), '{}'::jsonb)
from (values
  ('delivery_points', 'distance_tools', '거리 계산·코스 캡처'),
  ('dispatch_parser', 'gimhae_dispatch', '김해 배차 분석')
) tools(source, destination, title)
on conflict (resource) do nothing;

-- Patch only the authorization predicate in the installed functions. Production has
-- newer address-selection/cache validation than the original SQL snapshots; retain it.
do $migration$
declare
  signature text;
  definition text;
  old_guard constant text := 'public.operations_resource_allowed(''delivery_points'',''read'',p_center)';
  new_guard constant text := 'public.operations_resource_allowed(''distance_tools'',''read'',null)';
begin
  foreach signature in array array[
    'public.naver_browser_enqueue(text,text,jsonb)',
    'public.naver_capture_enqueue(text,jsonb,uuid)',
    'public.naver_address_validate_enqueue(text,jsonb,uuid,jsonb)',
    'public.naver_capture_validated_enqueue(text,jsonb,uuid,uuid)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if strpos(definition, new_guard) > 0 and strpos(definition, old_guard) = 0 then
      continue; -- Reapplying must not reset permissions or rewrite unrelated code.
    end if;
    if (length(definition) - length(replace(definition, old_guard, ''))) / length(old_guard) <> 1 then
      raise exception 'Unexpected authorization predicate in %; review before migrating', signature;
    end if;
    definition := replace(definition, old_guard, new_guard);
    definition := replace(definition, '센터 납품처 열람 권한이 없습니다.', '거리 도구 사용 권한이 없습니다.');
    execute definition;
  end loop;
end $migration$;

drop policy if exists naver_browser_owner_read on public.naver_browser_jobs;
create policy naver_browser_owner_read on public.naver_browser_jobs
for select to authenticated using (
  owner_id = (select auth.uid())
  and kind in ('distance', 'capture', 'validation')
  and public.operations_resource_allowed('distance_tools', 'read', null)
);

drop policy if exists naver_capture_owner_read on storage.objects;
create policy naver_capture_owner_read on storage.objects
for select to authenticated using (
  bucket_id = 'naver-course-captures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.operations_resource_allowed('distance_tools', 'read', null)
  and exists (
    select 1 from public.naver_browser_jobs j
    where j.id::text = (storage.foldername(name))[2]
      and j.kind = 'capture' and j.owner_id = (select auth.uid())
  )
);

-- naver_api_jobs, shortlist/relations RPCs, delivery_points and dispatch drafts retain
-- their existing center-specific authorization and ownership policies.
notify pgrst, 'reload schema';
commit;
