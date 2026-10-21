-- Delivery point security fields
-- =============================================================================
-- Adds text fields for 납품처 보안/경비 information.
-- Run this in Supabase SQL Editor before using the updated 납품처 관리 form.
-- =============================================================================

alter table public.delivery_points
  add column if not exists security_key_location text,
  add column if not exists security_password text;

-- If your dashboard uses course_view, expose these fields from delivery_points.
-- The ready-to-run view patch is in:
--   repo-root/sql/course-view-center-code.sql
--
-- Verify table columns:
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'delivery_points'
  and column_name in ('security_key_location', 'security_password')
order by column_name;
