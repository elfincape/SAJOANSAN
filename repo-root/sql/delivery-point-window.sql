begin;
alter table public.delivery_points
  add column delivery_start_text text,
  add column delivery_start_business_min integer check (delivery_start_business_min between 0 and 1439),
  add column delivery_window_text text;
comment on column public.delivery_points.delivery_start_business_min is '납품가능 시작: 자정 기준 분. 실제 입차·하차와 별개.';
comment on column public.delivery_points.delivery_window_text is '납품 가능시간 원문·추가 조건. 숫자로 확정할 수 없는 조건도 보존.';
create or replace view public.course_view with (security_invoker=true) as
 SELECT rs.id AS stop_id,
    rs.stop_order,
    rs.arrival_text,
    rs.arrival_business_min,
    rs.unloading_start_text,
    rs.unloading_start_business_min,
    rs.unloading_end_text,
    rs.unloading_end_business_min,
    rs.deadline_text AS stop_deadline_text,
    rs.deadline_business_min AS stop_deadline_business_min,
    rs.memo AS stop_memo,
    r.id AS route_id,
    r.name AS route_name,
    r.car_number,
    r.active AS route_active,
    r.company_id,
        CASE
            WHEN co.deleted_at IS NOT NULL THEN co.name || ' (삭제됨)'::text
            ELSE co.name
        END AS company_name,
    r.primary_driver_id,
        CASE
            WHEN pd.deleted_at IS NOT NULL THEN pd.name || ' (삭제됨)'::text
            ELSE pd.name
        END AS primary_driver_name,
    pd.phone AS primary_driver_phone,
    r.primary_vehicle_id,
        CASE
            WHEN pv.deleted_at IS NOT NULL THEN pv.plate_number || ' (삭제됨)'::text
            ELSE pv.plate_number
        END AS primary_vehicle_plate,
    pv.tonnage AS primary_vehicle_tonnage,
    pv.pallet_capacity AS primary_vehicle_pallet,
    r.secondary_driver_id,
        CASE
            WHEN sd.deleted_at IS NOT NULL THEN sd.name || ' (삭제됨)'::text
            ELSE sd.name
        END AS secondary_driver_name,
    r.secondary_vehicle_id,
        CASE
            WHEN sv.deleted_at IS NOT NULL THEN sv.plate_number || ' (삭제됨)'::text
            ELSE sv.plate_number
        END AS secondary_vehicle_plate,
    rs.delivery_point_id,
    dp.code AS dp_code,
        CASE
            WHEN dp.deleted_at IS NOT NULL THEN dp.name || ' (삭제됨)'::text
            ELSE dp.name
        END AS dp_name,
    dp.address AS dp_address,
    dp.region AS dp_region,
    dp.contact AS dp_contact,
    dp.allow_under_1ton,
    dp.allow_under_3_5ton,
    dp.allow_over_5ton,
    dp.allow_unmanned_yard,
    dp.deadline_text AS dp_deadline_text,
    dp.deadline_business_min AS dp_deadline_business_min,
    dp.delivery_method AS base_delivery_method,
    dp.access_method AS base_access_method,
    dp.delivery_location AS base_delivery_location,
    rs.override_delivery_method,
    rs.override_access_method,
    rs.override_delivery_location,
        CASE rs.condition_modes ->> 'delivery_method'::text
            WHEN 'clear'::text THEN NULL::text
            WHEN 'inherit'::text THEN dp.delivery_method
            WHEN 'set'::text THEN rs.override_delivery_method
            ELSE COALESCE(rs.override_delivery_method, dp.delivery_method)
        END AS delivery_method,
        CASE rs.condition_modes ->> 'access_method'::text
            WHEN 'clear'::text THEN NULL::text
            WHEN 'inherit'::text THEN dp.access_method
            WHEN 'set'::text THEN rs.override_access_method
            ELSE COALESCE(rs.override_access_method, dp.access_method)
        END AS access_method,
        CASE rs.condition_modes ->> 'delivery_location'::text
            WHEN 'clear'::text THEN NULL::text
            WHEN 'inherit'::text THEN dp.delivery_location
            WHEN 'set'::text THEN rs.override_delivery_location
            ELSE COALESCE(rs.override_delivery_location, dp.delivery_location)
        END AS delivery_location,
    rs.condition_modes <> '{}'::jsonb OR rs.override_delivery_method IS NOT NULL OR rs.override_access_method IS NOT NULL OR rs.override_delivery_location IS NOT NULL AS has_override,
        CASE rs.condition_modes ->> 'deadline'::text
            WHEN 'clear'::text THEN NULL::integer
            WHEN 'inherit'::text THEN dp.deadline_business_min
            WHEN 'set'::text THEN rs.deadline_business_min
            ELSE COALESCE(rs.deadline_business_min, dp.deadline_business_min)
        END AS effective_deadline_business_min,
        CASE rs.condition_modes ->> 'deadline'::text
            WHEN 'clear'::text THEN NULL::text
            WHEN 'inherit'::text THEN dp.deadline_text
            WHEN 'set'::text THEN rs.deadline_text
            ELSE COALESCE(rs.deadline_text, dp.deadline_text)
        END AS effective_deadline_text,
        CASE
            WHEN
            CASE rs.condition_modes ->> 'deadline'::text
                WHEN 'clear'::text THEN NULL::integer
                WHEN 'inherit'::text THEN dp.deadline_business_min
                WHEN 'set'::text THEN rs.deadline_business_min
                ELSE COALESCE(rs.deadline_business_min, dp.deadline_business_min)
            END IS NOT NULL AND rs.unloading_end_business_min IS NOT NULL THEN
            CASE rs.condition_modes ->> 'deadline'::text
                WHEN 'clear'::text THEN NULL::integer
                WHEN 'inherit'::text THEN dp.deadline_business_min
                WHEN 'set'::text THEN rs.deadline_business_min
                ELSE COALESCE(rs.deadline_business_min, dp.deadline_business_min)
            END - rs.unloading_end_business_min
            ELSE NULL::integer
        END AS slack_minutes,
    r.center_code,
    r.center_code AS route_center_code,
    cen.name AS center_name,
    dp.security_key_location,
    dp.security_password,
    dp.contact_name AS dp_contact_name,
    dp.memo AS dp_memo,
    dp.delivery_start_text AS dp_delivery_start_text,
    dp.delivery_start_business_min AS dp_delivery_start_business_min,
    dp.delivery_window_text AS dp_delivery_window_text
   FROM route_stops rs
     JOIN routes r ON r.id = rs.route_id
     LEFT JOIN centers cen ON cen.code = r.center_code
     LEFT JOIN companies co ON co.id = r.company_id
     LEFT JOIN drivers pd ON pd.id = r.primary_driver_id
     LEFT JOIN vehicles pv ON pv.id = r.primary_vehicle_id
     LEFT JOIN drivers sd ON sd.id = r.secondary_driver_id
     LEFT JOIN vehicles sv ON sv.id = r.secondary_vehicle_id
     LEFT JOIN delivery_points dp ON dp.id = rs.delivery_point_id
  WHERE r.deleted_at IS NULL;
notify pgrst, 'reload schema';
commit;

