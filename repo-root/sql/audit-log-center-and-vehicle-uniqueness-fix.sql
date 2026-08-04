-- Fix 1) audit_log.center_code NULL insert failures
-- -----------------------------------------------------------------------------
-- Symptom:
--   null value in column "center_code" of relation "audit_log" violates not-null constraint
--
-- Cause:
--   Existing audit triggers/functions may insert into audit_log without center_code.
--
-- Approach:
--   - Keep center_code NOT NULL policy
--   - Add a defensive default
--   - Backfill any existing NULLs (if column was temporarily nullable)
-- -----------------------------------------------------------------------------
alter table if exists public.audit_log
  alter column center_code set default '001';

update public.audit_log
set center_code = '001'
where center_code is null;

alter table if exists public.audit_log
  alter column center_code set not null;

-- Fix 2) vehicle uniqueness should allow same plate across different companies
-- -----------------------------------------------------------------------------
-- Symptom:
--   In environments where one driver/company relationship spans multiple routes,
--   adding vehicles can be blocked even when company differs.
--
-- Existing unique index:
--   unique(center_code, plate_number)
--
-- Revised unique index:
--   unique(center_code, coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid), plate_number)
-- -----------------------------------------------------------------------------
drop index if exists public.vehicles_center_plate_uidx;
alter table if exists public.vehicles
  drop constraint if exists vehicles_company_plate_unique;
drop index if exists public.vehicles_company_plate_unique;

create unique index if not exists vehicles_center_company_plate_uidx
  on public.vehicles (
    center_code,
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    plate_number
  );

-- Optional verification
-- select center_code, company_id, plate_number, count(*)
-- from public.vehicles
-- group by center_code, company_id, plate_number
-- having count(*) > 1;
