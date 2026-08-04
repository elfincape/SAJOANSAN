-- Center code setup/backfill for SAJOANSAN
-- =============================================================================
-- Purpose
--   The current frontend scopes dashboard/admin data with center_code values:
--     001 = 사조안산센터
--     002 = 사조평택센터
--
-- Run this in Supabase SQL Editor after reviewing the comments below.
-- The script is intentionally split into sections so you can run/verify step by step.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Center master
-- -----------------------------------------------------------------------------
create table if not exists public.centers (
  code text,
  name text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- If centers already exists with a UUID id primary key, these ALTER statements
-- preserve that design and only add the code/name fields the frontend needs.
alter table public.centers add column if not exists code text;
alter table public.centers add column if not exists name text;
alter table public.centers add column if not exists active boolean not null default true;
alter table public.centers add column if not exists sort_order integer not null default 0;
alter table public.centers add column if not exists created_at timestamptz not null default now();

update public.centers set code = '001' where name = '사조안산센터' and code is null;
update public.centers set code = '002' where name = '사조평택센터' and code is null;
create unique index if not exists centers_code_uidx on public.centers(code);
create unique index if not exists centers_name_uidx on public.centers(name);

insert into public.centers (code, name, active, sort_order)
values
  ('001', '사조안산센터', true, 1),
  ('002', '사조평택센터', true, 2)
on conflict (code) do update
set name = excluded.name,
    active = excluded.active,
    sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- 2) Add center_code columns required by the frontend
-- -----------------------------------------------------------------------------
alter table public.companies          add column if not exists center_code text;
alter table public.drivers            add column if not exists center_code text;
alter table public.vehicles           add column if not exists center_code text;
alter table public.delivery_points    add column if not exists center_code text;
alter table public.delivery_points    add column if not exists security_key_location text;
alter table public.delivery_points    add column if not exists security_password text;
alter table public.routes             add column if not exists center_code text;
alter table public.transfer_deliveries add column if not exists center_code text;
alter table public.audit_log          add column if not exists center_code text;

-- route_stops are center-scoped through routes.route_id. Do not duplicate center_code
-- there unless you intentionally want denormalized center data.

-- -----------------------------------------------------------------------------
-- 3) Backfill all existing data to 사조안산센터 (001)
-- -----------------------------------------------------------------------------
update public.companies          set center_code = '001' where center_code is null;
update public.drivers            set center_code = '001' where center_code is null;
update public.vehicles           set center_code = '001' where center_code is null;
update public.delivery_points    set center_code = '001' where center_code is null;
update public.routes             set center_code = '001' where center_code is null;
update public.transfer_deliveries set center_code = '001' where center_code is null;
update public.audit_log          set center_code = '001' where center_code is null;

-- -----------------------------------------------------------------------------
-- 4) Guardrails: FK/check constraints and indexes
-- -----------------------------------------------------------------------------
do $$
begin
  alter table public.companies
    add constraint companies_center_code_fk foreign key (center_code) references public.centers(code);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.drivers
    add constraint drivers_center_code_fk foreign key (center_code) references public.centers(code);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.vehicles
    add constraint vehicles_center_code_fk foreign key (center_code) references public.centers(code);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.delivery_points
    add constraint delivery_points_center_code_fk foreign key (center_code) references public.centers(code);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.routes
    add constraint routes_center_code_fk foreign key (center_code) references public.centers(code);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.transfer_deliveries
    add constraint transfer_deliveries_center_code_fk foreign key (center_code) references public.centers(code);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.audit_log
    add constraint audit_log_center_code_fk foreign key (center_code) references public.centers(code);
exception when duplicate_object then null;
end $$;

alter table public.companies          alter column center_code set not null;
alter table public.drivers            alter column center_code set not null;
alter table public.vehicles           alter column center_code set not null;
alter table public.delivery_points    alter column center_code set not null;
alter table public.routes             alter column center_code set not null;
alter table public.transfer_deliveries alter column center_code set not null;
-- audit_log may contain old/system rows; keep nullable if the statement below fails in your DB.
alter table public.audit_log          alter column center_code set not null;

create index if not exists companies_center_code_idx       on public.companies(center_code);
create index if not exists drivers_center_code_idx         on public.drivers(center_code);
create index if not exists vehicles_center_code_idx        on public.vehicles(center_code);
create index if not exists delivery_points_center_code_idx on public.delivery_points(center_code);
create index if not exists routes_center_code_idx          on public.routes(center_code);
create index if not exists transfers_center_code_idx       on public.transfer_deliveries(center_code);
create index if not exists audit_log_center_code_idx       on public.audit_log(center_code);

-- These unique indexes are recommended as database-level duplicate guards.
-- The current importer also works before these indexes are installed by using
-- center-scoped select/update/insert operations instead of ON CONFLICT.
create unique index if not exists companies_center_name_uidx
  on public.companies(center_code, name);

create unique index if not exists delivery_points_center_code_uidx
  on public.delivery_points(center_code, code);

create unique index if not exists routes_center_company_car_name_uidx
  on public.routes(center_code, company_id, car_number, name);

-- Remove the legacy global company+plate rule before adding the center-aware rule.
alter table public.vehicles drop constraint if exists vehicles_company_plate_unique;
drop index if exists public.vehicles_company_plate_unique;
drop index if exists public.vehicles_center_plate_uidx;
create unique index if not exists vehicles_center_company_plate_uidx
  on public.vehicles (
    center_code,
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    plate_number
  );

create unique index if not exists drivers_center_company_name_uidx
  on public.drivers(center_code, company_id, name);

commit;

-- -----------------------------------------------------------------------------
-- 5) Verification queries
-- -----------------------------------------------------------------------------
-- select center_code, count(*) from public.routes group by center_code order by center_code;
-- select center_code, count(*) from public.delivery_points group by center_code order by center_code;
-- select center_code, count(*) from public.companies group by center_code order by center_code;
-- select center_code, count(*) from public.drivers group by center_code order by center_code;
-- select center_code, count(*) from public.vehicles group by center_code order by center_code;

-- -----------------------------------------------------------------------------
-- 6) course_view must expose center_code for the dashboard
-- -----------------------------------------------------------------------------
-- Do not run only `r.center_code as center_code,` by itself. That is just one
-- SELECT expression and PostgreSQL will return a syntax error near `r`.
--
-- Run the separate ready-to-run file instead. In Supabase SQL Editor, make sure
-- no partial text is highlighted, otherwise only the selected verification query
-- may run and `center_code` will still be missing from the view:
--   repo-root/sql/course-view-center-code.sql
--
-- The view patch keeps the existing course_view column order and appends:
--   center_code, route_center_code, center_name
-- at the end. Appending is important because CREATE OR REPLACE VIEW cannot insert
-- new columns into the middle of an existing PostgreSQL view.
