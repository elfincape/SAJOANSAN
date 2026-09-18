-- Run in Supabase SQL Editor before saving certificate dates.
begin;
alter table public.drivers add column if not exists health_certificate_expires_on date;
comment on column public.drivers.health_certificate_expires_on is
  'Health certificate expiry date (inclusive). Alerts use Asia/Seoul calendar month.';

-- Metadata only. Images and Graph tokens are never stored here.
-- Upload is intentionally disabled until the authenticated OneDrive adapter is connected.
create table if not exists public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete restrict,
  document_type text not null check (document_type in (
    'food_transport','livestock_transport','freight_license',
    'vehicle_registration','identity','health_certificate'
  )),
  drive_id text not null,
  item_id text not null,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references auth.users(id) on delete set null,
  unique (driver_id, document_type)
);
alter table public.driver_documents enable row level security;
revoke all on public.driver_documents from anon, authenticated;
grant select on public.driver_documents to authenticated;
grant all on public.driver_documents to service_role;
drop policy if exists driver_documents_read on public.driver_documents;
create policy driver_documents_read on public.driver_documents for select to authenticated
using (
  exists (select 1 from public.user_profiles p
    where p.id = auth.uid() and p.active and p.role in ('editor','admin'))
  and exists (select 1 from public.drivers d where d.id = driver_documents.driver_id)
);
-- All mutations go through a future authenticated server adapter, after verifying
-- caller role and driver access with the caller JWT (not the service-role client).
-- Inherits driver row visibility/center policies without widening them.
notify pgrst, 'reload schema';
commit;

select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'drivers'
and column_name = 'health_certificate_expires_on';
