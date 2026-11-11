-- Operational activation only after ERP writes are stopped and the final
-- common-catalog/charter comparison is recorded. Never run with two writers.
-- Requires legacy-common-catalog.sql and the matching web/Edge release.
-- Retain the metadata-only document bridge and all historical subject UUIDs.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtextextended('charter:002',0));
lock table public.routes, public.route_stops, public.delivery_points,
  public.drivers, public.vehicles, public.companies,
  public.charter_trips, public.charter_archives in share row exclusive mode;
do $$ begin
  if to_regprocedure('public.legacy_save_route_stops(uuid,jsonb,jsonb)') is null then
    raise exception 'Apply the legacy catalog preparation first';
  end if;
  if exists(select 1 from public.onedrive_uploads
    where status='committed' and expiry_erp_saved=false and document_expiry is not null) then
    raise exception 'Finish pending document expiry writes before changing the owner';
  end if;
  if exists(select 1 from pg_class where oid in
    ('public.routes'::regclass,'public.route_stops'::regclass,'public.delivery_points'::regclass,
     'public.drivers'::regclass,'public.vehicles'::regclass,'public.companies'::regclass)
    and not relrowsecurity) then
    raise exception 'Existing catalog RLS must remain enabled';
  end if;
end $$;

drop trigger if exists ean_catalog_frozen on public.routes;
drop trigger if exists ean_catalog_frozen on public.route_stops;
drop trigger if exists ean_catalog_frozen on public.delivery_points;
-- Preserve no-truncate fences, audit triggers, FK constraints and soft-delete guards.
grant insert, update on public.routes, public.delivery_points,
  public.drivers, public.vehicles, public.companies to authenticated;
grant insert, update, delete on public.route_stops to authenticated;
grant execute on function public.save_pyeongtaek_dispatch_profiles(jsonb) to authenticated;
-- The two retired Notion original-write RPCs remain revoked.

create or replace function public.operations_resource_allowed(
  p_resource text, p_action text, p_center text default null::text
) returns boolean language sql stable security definer
set search_path to public, pg_temp as $$
  select public.operations_permission_for_actor(p_resource,p_action,p_center,auth.uid())
$$;
drop trigger if exists guard_pyeongtaek_charter_rows on public.charter_trips;
drop trigger if exists guard_pyeongtaek_charter_archives on public.charter_archives;
-- Charter writes continue through the existing versioned RPCs; no direct user grants.
commit;
