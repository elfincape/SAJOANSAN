begin;
create table if not exists public.driver_document_pdfs(
 driver_id uuid primary key references public.drivers(id),
 drive_id text not null,file_name text not null,item_id text,
 status text not null check(status in ('saving','saved')),
 source_versions jsonb not null,saved_at timestamptz,
 unique(drive_id,file_name)
);
alter table public.driver_document_pdfs enable row level security;
revoke all on public.driver_document_pdfs from public,anon,authenticated;
grant all on public.driver_document_pdfs to service_role;
notify pgrst,'reload schema';
commit;
