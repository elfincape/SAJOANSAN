-- Allow identical delivery point codes in different centers without moving data.
-- Run the entire file in Supabase SQL Editor, then retry CSV import.
begin;

create unique index if not exists delivery_points_center_code_uidx
  on public.delivery_points(center_code, code);

alter table public.delivery_points
  drop constraint if exists delivery_points_code_key;
drop index if exists public.delivery_points_code_key;

commit;

select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'delivery_points'
order by indexname;
