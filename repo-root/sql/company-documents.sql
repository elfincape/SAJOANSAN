-- Preserve existing records; fronts keep page 0, backs append in upload order.
begin;
alter table public.driver_documents add column if not exists page_number integer not null default 0;
alter table public.driver_documents drop constraint if exists driver_documents_driver_id_document_type_key;
create unique index if not exists driver_documents_page_uidx on public.driver_documents(driver_id,document_type,page_number);
create table if not exists public.company_documents (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 document_type text not null check(document_type in ('food_transport','food_transport_back','livestock_transport','livestock_transport_back')),
 page_number integer not null default 0,
 drive_id text not null, item_id text not null, file_name text not null,
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 size_bytes bigint not null check(size_bytes>0 and size_bytes<=10485760),
 uploaded_at timestamptz not null default now(),
 uploaded_by uuid references auth.users(id) on delete set null,
 request_id uuid unique,
 unique(company_id,document_type,page_number)
);
alter table public.company_documents enable row level security;
revoke all on public.company_documents from public,anon,authenticated;
grant select on public.company_documents to authenticated;
grant all on public.company_documents to service_role;
drop policy if exists company_documents_read on public.company_documents;
create policy company_documents_read on public.company_documents for select to authenticated using (
 exists(select 1 from public.user_profiles where id=auth.uid() and active and role in ('editor','admin'))
 and exists(select 1 from public.companies where id=company_documents.company_id)
);
alter table public.onedrive_uploads alter column driver_id drop not null;
alter table public.onedrive_uploads add column if not exists page_number integer;
alter table public.onedrive_uploads add column if not exists company_id uuid references public.companies(id);
create or replace function public.onedrive_commit_document(
 p_user uuid,p_driver uuid,p_kind text,p_drive text,p_item text,p_filename text,
 p_mime text,p_size bigint,p_expiry date,p_request uuid,p_holder uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare page integer;
begin
 if not exists(select 1 from public.onedrive_locks where name='connection' and holder=p_holder and expires_at>now())
 then raise exception 'Upload lease expired'; end if;
 if not exists(select 1 from public.user_profiles where id=p_user and active and role in ('editor','admin'))
 then raise exception 'Access denied'; end if;
 perform id from public.drivers where id=p_driver for update;
 if not found then raise exception 'Driver not found'; end if;
 if exists(select 1 from public.driver_documents where request_id=p_request) then return; end if;
 if p_kind='health_certificate' and p_expiry is null then raise exception 'Expiry required'; end if;
 page:=0;
 if p_kind in ('food_transport_back','livestock_transport_back') then
   select coalesce(max(page_number),-1)+1 into page from public.driver_documents where driver_id=p_driver and document_type=p_kind;
 end if;
 insert into public.driver_documents(driver_id,document_type,page_number,drive_id,item_id,file_name,mime_type,size_bytes,uploaded_by,uploaded_at,request_id)
 values(p_driver,p_kind,page,p_drive,p_item,p_filename,p_mime,p_size,p_user,now(),p_request)
 on conflict(driver_id,document_type,page_number) do update set drive_id=excluded.drive_id,item_id=excluded.item_id,
 file_name=excluded.file_name,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,
 uploaded_by=excluded.uploaded_by,uploaded_at=excluded.uploaded_at,request_id=excluded.request_id;
 if p_kind='health_certificate' then update public.drivers set health_certificate_expires_on=p_expiry where id=p_driver; end if;
 update public.onedrive_uploads set status='committed',item_id=p_item where request_id=p_request;
end $$;
create or replace function public.onedrive_commit_company_document(
 p_user uuid,p_company uuid,p_kind text,p_drive text,p_item text,p_filename text,
 p_mime text,p_size bigint,p_expiry date,p_request uuid,p_holder uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare page integer;
begin
 if not exists(select 1 from public.onedrive_locks where name='connection' and holder=p_holder and expires_at>now())
 then raise exception 'Upload lease expired'; end if;
 if not exists(select 1 from public.user_profiles where id=p_user and active and role in ('editor','admin'))
 then raise exception 'Access denied'; end if;
 perform id from public.companies where id=p_company for update;
 if not found then raise exception 'Company not found'; end if;
 if exists(select 1 from public.company_documents where request_id=p_request) then return; end if;
 page:=0;
 if p_kind in ('food_transport_back','livestock_transport_back') then
 select page_number into page from public.onedrive_uploads where request_id=p_request and company_id=p_company and kind=p_kind;
 if page is null then
   select coalesce(max(page_number),-1)+1 into page from public.company_documents where company_id=p_company and document_type=p_kind;
 end if;
 end if;
 insert into public.company_documents(company_id,document_type,page_number,drive_id,item_id,file_name,mime_type,size_bytes,uploaded_by,request_id)
 values(p_company,p_kind,page,p_drive,p_item,p_filename,p_mime,p_size,p_user,p_request)
 on conflict(company_id,document_type,page_number) do update set drive_id=excluded.drive_id,item_id=excluded.item_id,
 file_name=excluded.file_name,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,
 uploaded_by=excluded.uploaded_by,uploaded_at=now(),request_id=excluded.request_id;
 update public.onedrive_uploads set status='committed',item_id=p_item where request_id=p_request;
end $$;
-- Commit all copied pages together. Failed copies leave the driver's current records intact.
create or replace function public.onedrive_replace_company_documents(
 p_user uuid,p_driver uuid,p_company uuid,p_kind text,p_pages jsonb,p_holder uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare page jsonb;
begin
 if not exists(select 1 from public.onedrive_locks where name='connection' and holder=p_holder and expires_at>now())
 then raise exception 'Upload lease expired'; end if;
 if not exists(select 1 from public.user_profiles where id=p_user and active and role in ('editor','admin'))
 then raise exception 'Access denied'; end if;
 perform id from public.drivers where id=p_driver and company_id=p_company for update;
 if not found then raise exception 'Driver company changed'; end if;
 if p_kind not in ('food_transport','livestock_transport') or jsonb_array_length(p_pages)=0 then raise exception 'Invalid permit'; end if;
 delete from public.driver_documents where driver_id=p_driver and document_type in (p_kind,p_kind||'_back');
 for page in select value from jsonb_array_elements(p_pages) loop
   if page->>'document_type' not in (p_kind,p_kind||'_back') then raise exception 'Invalid page'; end if;
   insert into public.driver_documents(driver_id,document_type,page_number,drive_id,item_id,file_name,mime_type,size_bytes,uploaded_by,request_id)
   values(p_driver,page->>'document_type',(page->>'page_number')::integer,page->>'drive_id',page->>'item_id',page->>'file_name',page->>'mime_type',(page->>'size_bytes')::bigint,p_user,(page->>'request_id')::uuid);
 end loop;
end $$;
revoke all on function public.onedrive_commit_company_document(uuid,uuid,text,text,text,text,text,bigint,date,uuid,uuid) from public,anon,authenticated;
grant execute on function public.onedrive_commit_company_document(uuid,uuid,text,text,text,text,text,bigint,date,uuid,uuid) to service_role;
revoke all on function public.onedrive_replace_company_documents(uuid,uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.onedrive_replace_company_documents(uuid,uuid,uuid,text,jsonb,uuid) to service_role;
notify pgrst,'reload schema';
commit;
