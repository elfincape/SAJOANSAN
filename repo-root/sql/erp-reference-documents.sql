-- Stage with the legacy document bridge disabled. Existing references remain valid.
begin;
set local lock_timeout = '8s';
alter table public.onedrive_settings add column erp_document_catalog_enabled boolean not null default false;
alter table public.driver_documents
  alter column driver_id drop not null,
  add column erp_driver_id uuid,
  add column subject_driver_id uuid generated always as (coalesce(erp_driver_id, driver_id)) stored,
  add column document_expiry date,
  add constraint driver_documents_subject_check check (
    subject_driver_id is not null and (driver_id is null or erp_driver_id is null or driver_id = erp_driver_id)
  ),
  add constraint driver_documents_subject_slot unique(subject_driver_id,document_type,page_number);
alter table public.company_documents
  alter column company_id drop not null,
  add column erp_company_id uuid,
  add column subject_company_id uuid generated always as (coalesce(erp_company_id, company_id)) stored,
  add constraint company_documents_subject_check check (
    subject_company_id is not null and (company_id is null or erp_company_id is null or company_id = erp_company_id)
  ),
  add constraint company_documents_subject_slot unique(subject_company_id,document_type,page_number);
alter table public.driver_document_pdfs drop constraint driver_document_pdfs_pkey;
alter table public.driver_document_pdfs
  alter column driver_id drop not null,
  add constraint driver_document_pdfs_legacy_driver_key unique(driver_id),
  add column erp_driver_id uuid,
  add column subject_driver_id uuid generated always as (coalesce(erp_driver_id, driver_id)) stored,
  add constraint driver_document_pdfs_subject_check check (
    subject_driver_id is not null and (driver_id is null or erp_driver_id is null or driver_id = erp_driver_id)
  ),
  add primary key(subject_driver_id);
alter table public.onedrive_uploads
  add column erp_driver_id uuid,
  add column erp_company_id uuid,
  add column subject_driver_id uuid generated always as (coalesce(erp_driver_id, driver_id)) stored,
  add column subject_company_id uuid generated always as (coalesce(erp_company_id, company_id)) stored,
  add column document_expiry date,
  add column expiry_expected_revision bigint,
  add column expiry_erp_saved boolean not null default false,
  add constraint onedrive_uploads_subject_match check (
    (driver_id is null or erp_driver_id is null or driver_id = erp_driver_id)
    and (company_id is null or erp_company_id is null or company_id = erp_company_id)
    and num_nonnulls(subject_driver_id, subject_company_id) = 1
  ) not valid,
  add constraint onedrive_uploads_expiry_intent check (
    (document_expiry is null and expiry_expected_revision is null and not expiry_erp_saved)
    or (kind = 'health_certificate' and document_expiry is not null and expiry_expected_revision > 0
        and expiry_expected_revision is not null and subject_driver_id is not null)
  );
create index onedrive_uploads_erp_expiry_pending
  on public.onedrive_uploads(user_id,subject_driver_id)
  where status='committed' and document_expiry is not null and not expiry_erp_saved;

-- Document and journal commit only. The Edge handler has independently checked
-- the ERP identity with the requester token. No master table is mutated here.
create function public.onedrive_commit_erp_document(
  p_user uuid,p_id uuid,p_company boolean,p_kind text,p_item text,
  p_mime text,p_size bigint,p_request uuid,p_holder uuid
) returns void language plpgsql security invoker set search_path='' as $erp$
declare
  j public.onedrive_uploads;
  legacy_id uuid;
  page integer;
begin
  if not exists(select 1 from public.onedrive_locks where name='connection' and holder=p_holder and expires_at>now())
  then raise exception 'Upload lease expired'; end if;
  if not exists(select 1 from public.user_profiles where id=p_user and active and role in ('editor','admin'))
  then raise exception 'Access denied'; end if;
  select * into strict j from public.onedrive_uploads where request_id=p_request for update;
  if j.user_id is distinct from p_user or j.kind is distinct from p_kind or j.item_id is distinct from p_item
    or (case when p_company then j.subject_company_id else j.subject_driver_id end) is distinct from p_id
    or j.status not in ('pending','committed')
    or (p_kind='health_certificate' and j.document_expiry is null)
  then raise exception 'Upload identity changed'; end if;
  if j.status='committed' then return; end if;
  page := coalesce(j.page_number,0);
  if p_company then
    select id into legacy_id from public.companies where id=p_id;
    insert into public.company_documents(company_id,erp_company_id,document_type,page_number,drive_id,item_id,file_name,mime_type,size_bytes,uploaded_by,request_id)
    values(legacy_id,p_id,p_kind,page,j.drive_id,p_item,j.file_name,p_mime,p_size,p_user,p_request)
    on conflict(subject_company_id,document_type,page_number) do update
      set drive_id=excluded.drive_id,item_id=excluded.item_id,file_name=excluded.file_name,
          mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,uploaded_by=excluded.uploaded_by,
          uploaded_at=now(),request_id=excluded.request_id;
  else
    select id into legacy_id from public.drivers where id=p_id;
    insert into public.driver_documents(driver_id,erp_driver_id,document_type,page_number,drive_id,item_id,file_name,mime_type,size_bytes,uploaded_by,request_id,document_expiry)
    values(legacy_id,p_id,p_kind,page,j.drive_id,p_item,j.file_name,p_mime,p_size,p_user,p_request,j.document_expiry)
    on conflict(subject_driver_id,document_type,page_number) do update
      set drive_id=excluded.drive_id,item_id=excluded.item_id,file_name=excluded.file_name,
          mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,uploaded_by=excluded.uploaded_by,
          uploaded_at=now(),request_id=excluded.request_id,document_expiry=excluded.document_expiry;
  end if;
  update public.onedrive_uploads set status='committed' where request_id=p_request;
end
$erp$;
revoke all on function public.onedrive_commit_erp_document(uuid,uuid,boolean,text,text,text,bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.onedrive_commit_erp_document(uuid,uuid,boolean,text,text,text,bigint,uuid,uuid) to service_role;
create function public.onedrive_replace_erp_company_documents(
  p_user uuid,p_driver uuid,p_company uuid,p_kind text,p_pages jsonb,p_holder uuid
) returns void language plpgsql security invoker set search_path='' as $erp$
declare page jsonb;
begin
  if p_company is null or p_kind not in ('food_transport','livestock_transport') or jsonb_array_length(p_pages)=0
  then raise exception 'Invalid permit'; end if;
  if not exists(select 1 from public.onedrive_locks where name='connection' and holder=p_holder and expires_at>now())
  then raise exception 'Upload lease expired'; end if;
  -- The Edge handler rechecks the live ERP company link under the document lease.
  for page in select value from jsonb_array_elements(p_pages) loop
    if page->>'document_type' not in (p_kind,p_kind||'_back') or not exists (
      select 1 from public.onedrive_uploads j
      where j.request_id=(page->>'request_id')::uuid and j.user_id=p_user
        and j.subject_driver_id=p_driver and j.item_id=page->>'item_id'
        and j.kind=page->>'document_type' and j.page_number=(page->>'page_number')::integer
        and j.status='pending'
    ) then raise exception 'Invalid replacement page'; end if;
  end loop;
  delete from public.driver_documents where subject_driver_id=p_driver and document_type in (p_kind,p_kind||'_back');
  for page in select value from jsonb_array_elements(p_pages) loop
    perform public.onedrive_commit_erp_document(
      p_user,p_driver,false,page->>'document_type',page->>'item_id',page->>'mime_type',
      (page->>'size_bytes')::bigint,(page->>'request_id')::uuid,p_holder
    );
  end loop;
end
$erp$;
revoke all on function public.onedrive_replace_erp_company_documents(uuid,uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.onedrive_replace_erp_company_documents(uuid,uuid,uuid,text,jsonb,uuid) to service_role;
notify pgrst,'reload schema';
commit;
