-- Delivery point photo storage
-- Run in Supabase SQL Editor before using the photo upload UI.

alter table public.delivery_points
  add column if not exists photos jsonb not null default '[]'::jsonb;

comment on column public.delivery_points.photos is
  'Delivery point photos managed by the web app. Array of compressed image metadata/data URLs; frontend limits to 6 images and <= 1MB each.';

-- Verification
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'delivery_points'
  and column_name = 'photos';
