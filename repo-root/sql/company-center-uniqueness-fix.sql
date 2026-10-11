-- Allow the same company name in different centers.
-- Run the entire file in Supabase SQL Editor, then retry the CSV import.
-- Existing company IDs, center assignments and references are preserved.
begin;

-- Install the replacement guard FIRST. If existing duplicates prevent this,
-- the transaction fails before the legacy guard is removed.
create unique index if not exists companies_center_name_uidx
  on public.companies(center_code, name);

alter table public.companies
  drop constraint if exists companies_name_key;
-- Also handle databases where the legacy rule is a standalone unique index.
drop index if exists public.companies_name_key;

commit;

-- Verify: companies_name_key should be absent; the composite index should remain.
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'companies'
order by indexname;
