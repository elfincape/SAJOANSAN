-- course_view center_code patch
-- =============================================================================
-- Run this whole file in Supabase SQL Editor.
-- If Supabase SQL Editor has a highlighted selection, it runs only that selected
-- text. Clear the selection or press Ctrl/Cmd+A so the CREATE OR REPLACE VIEW
-- statement below is included. The verification query at the bottom will fail
-- until the CREATE OR REPLACE VIEW statement has successfully run.
-- Do NOT run only these expressions by themselves:
--   r.center_code as center_code,
--   r.center_code as route_center_code,
--   cen.name as center_name
-- They must be inside a full SELECT / CREATE VIEW statement.
--
-- PostgreSQL CREATE OR REPLACE VIEW cannot insert new columns in the middle of an
-- existing view. This definition preserves the existing course_view column order
-- shown by `select * from course_view limit 1`, and appends center columns at the
-- end so the dashboard can filter by center_code.
-- =============================================================================

-- Safe pre-check: this never errors. Before running the patch it should show
-- zero rows for center/security columns if the view has not
-- been patched yet.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'course_view'
  and column_name in ('center_code', 'route_center_code', 'center_name', 'security_key_location', 'security_password', 'dp_contact_name')
order by column_name;

create or replace view public.course_view as
select
  rs.id as stop_id,
  rs.stop_order,
  rs.arrival_text,
  rs.arrival_business_min,
  rs.unloading_start_text,
  rs.unloading_start_business_min,
  rs.unloading_end_text,
  rs.unloading_end_business_min,
  rs.deadline_text as stop_deadline_text,
  rs.deadline_business_min as stop_deadline_business_min,
  rs.memo as stop_memo,

  r.id as route_id,
  r.name as route_name,
  r.car_number,
  r.active as route_active,

  co.id as company_id,
  co.name as company_name,

  pd.id as primary_driver_id,
  pd.name as primary_driver_name,
  pd.phone as primary_driver_phone,

  pv.id as primary_vehicle_id,
  pv.plate_number as primary_vehicle_plate,
  pv.tonnage as primary_vehicle_tonnage,
  pv.pallet_capacity as primary_vehicle_pallet,

  sd.id as secondary_driver_id,
  sd.name as secondary_driver_name,
  sd.phone as secondary_driver_phone,

  sv.id as secondary_vehicle_id,
  sv.plate_number as secondary_vehicle_plate,

  dp.id as delivery_point_id,
  dp.code as dp_code,
  dp.name as dp_name,
  dp.address as dp_address,
  dp.region as dp_region,
  dp.contact as dp_contact,
  dp.allow_under_1ton,
  dp.allow_under_3_5ton,
  dp.allow_over_5ton,
  dp.allow_unmanned_yard,
  dp.deadline_text as dp_deadline_text,
  dp.deadline_business_min as dp_deadline_business_min,
  dp.delivery_method as base_delivery_method,
  dp.access_method as base_access_method,
  dp.delivery_location as base_delivery_location,

  rs.override_delivery_method,
  rs.override_access_method,
  rs.override_delivery_location,

  coalesce(rs.override_delivery_method, dp.delivery_method) as delivery_method,
  coalesce(rs.override_access_method, dp.access_method) as access_method,
  coalesce(rs.override_delivery_location, dp.delivery_location) as delivery_location,

  (
    rs.override_delivery_method is not null
    or rs.override_access_method is not null
    or rs.override_delivery_location is not null
  ) as has_override,

  coalesce(rs.deadline_business_min, dp.deadline_business_min) as effective_deadline_business_min,
  coalesce(rs.deadline_text, dp.deadline_text) as effective_deadline_text,
  case
    when coalesce(rs.deadline_business_min, dp.deadline_business_min) is not null
     and rs.unloading_end_business_min is not null
    then coalesce(rs.deadline_business_min, dp.deadline_business_min) - rs.unloading_end_business_min
    else null
  end as slack_minutes,

  -- Center/security columns appended at the end for safe CREATE OR REPLACE VIEW.
  r.center_code as center_code,
  r.center_code as route_center_code,
  cen.name as center_name,
  dp.security_key_location as security_key_location,
  dp.security_password as security_password,
  dp.contact_name as dp_contact_name
from public.route_stops rs
join public.routes r
  on r.id = rs.route_id
left join public.centers cen
  on cen.code = r.center_code
left join public.companies co
  on co.id = r.company_id
 and co.center_code = r.center_code
left join public.drivers pd
  on pd.id = r.primary_driver_id
 and pd.center_code = r.center_code
left join public.vehicles pv
  on pv.id = r.primary_vehicle_id
 and pv.center_code = r.center_code
left join public.drivers sd
  on sd.id = r.secondary_driver_id
 and sd.center_code = r.center_code
left join public.vehicles sv
  on sv.id = r.secondary_vehicle_id
 and sv.center_code = r.center_code
join public.delivery_points dp
  on dp.id = rs.delivery_point_id
 and dp.center_code = r.center_code;

-- Verify step 1: confirm the columns now exist. This query is safe even if the
-- patch did not run, and should return 5 rows after the patch.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'course_view'
  and column_name in ('center_code', 'route_center_code', 'center_name', 'security_key_location', 'security_password')
order by column_name;

-- Verify step 2: run this only after verify step 1 returns center_code.
select center_code, center_name, count(*)
from public.course_view
group by center_code, center_name
order by center_code;

select * from public.course_view limit 1;
