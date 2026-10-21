-- OneDrive integration: apply after driver-documents.sql.
begin;
create table if not exists public.onedrive_settings (
  id boolean primary key default true check(id),
  folders jsonb not null,
  expected_drive_id text not null
);
create table if not exists public.onedrive_connection (
  id boolean primary key default true check(id),
  encrypted_tokens text not null,
  connected_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.onedrive_oauth (
  state_hash text primary key,
  user_id uuid not null references auth.users(id),
  proof_hash text not null,
  encrypted_data text not null,
  stage text not null check(stage in ('started','exchanging','ready')),
  expires_at timestamptz not null
);
create table if not exists public.onedrive_locks (
  name text primary key, holder uuid not null, expires_at timestamptz not null
);
-- Tracks new uploads before Graph I/O so interrupted writes can be reconciled.
create table if not exists public.onedrive_uploads (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id),
  driver_id uuid not null references public.drivers(id),
  kind text not null, drive_id text not null, folder_id text not null,
  file_name text not null, item_id text, status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.onedrive_settings enable row level security;
alter table public.onedrive_connection enable row level security;
alter table public.onedrive_oauth enable row level security;
alter table public.onedrive_locks enable row level security;
alter table public.onedrive_uploads enable row level security;
revoke all on public.onedrive_settings,public.onedrive_connection,public.onedrive_oauth,public.onedrive_locks,public.onedrive_uploads from public,anon,authenticated;
grant all on public.onedrive_settings,public.onedrive_connection,public.onedrive_oauth,public.onedrive_locks,public.onedrive_uploads to service_role;
alter table public.driver_documents add column if not exists request_id uuid;
create unique index if not exists driver_documents_request_id_uidx on public.driver_documents(request_id);

create or replace function public.onedrive_acquire(p_holder uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare got uuid;
begin
  insert into public.onedrive_locks(name,holder,expires_at)
  values('connection',p_holder,now()+interval '3 minutes')
  on conflict(name) do update set holder=excluded.holder,expires_at=excluded.expires_at
  where onedrive_locks.expires_at < now()
  returning holder into got;
  return got is not null;
end $$;

create or replace function public.onedrive_finish_oauth(p_state text,p_proof text,p_user uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare pending public.onedrive_oauth;
begin
  delete from public.onedrive_oauth where state_hash=p_state and proof_hash=p_proof
    and user_id=p_user and stage='ready' and expires_at>now() returning * into pending;
  if pending.state_hash is null then return false; end if;
  insert into public.onedrive_connection(id,encrypted_tokens,connected_by,updated_at)
  values(true,pending.encrypted_data,p_user,now())
  on conflict(id) do update set encrypted_tokens=excluded.encrypted_tokens,
    connected_by=excluded.connected_by,updated_at=now();
  return true;
end $$;

create or replace function public.onedrive_commit_document(
 p_user uuid,p_driver uuid,p_kind text,p_drive text,p_item text,p_filename text,
 p_mime text,p_size bigint,p_expiry date,p_request uuid,p_holder uuid)
returns void language plpgsql security invoker set search_path=public as $$
begin
  if not exists(select 1 from public.onedrive_locks where name='connection' and holder=p_holder and expires_at>now())
  then raise exception 'Upload lease expired'; end if;
  if not exists(select 1 from public.user_profiles where id=p_user and active and role in ('editor','admin'))
  then raise exception 'Access denied'; end if;
  -- The Edge Function separately verifies driver visibility using the caller JWT.
  perform id from public.drivers where id=p_driver for update;
  if not found then raise exception 'Driver not found'; end if;
  if p_kind='health_certificate' and p_expiry is null then raise exception 'Expiry required'; end if;
  insert into public.driver_documents(driver_id,document_type,drive_id,item_id,file_name,mime_type,size_bytes,uploaded_by,uploaded_at,request_id)
  values(p_driver,p_kind,p_drive,p_item,p_filename,p_mime,p_size,p_user,now(),p_request)
  on conflict(driver_id,document_type) do update set drive_id=excluded.drive_id,item_id=excluded.item_id,
    file_name=excluded.file_name,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,
    uploaded_by=excluded.uploaded_by,uploaded_at=excluded.uploaded_at,request_id=excluded.request_id;
  if p_kind='health_certificate' then
    update public.drivers set health_certificate_expires_on=p_expiry where id=p_driver;
  end if;
  update public.onedrive_uploads set status='committed',item_id=p_item where request_id=p_request;
end $$;
revoke all on function public.onedrive_acquire(uuid) from public,anon,authenticated;
revoke all on function public.onedrive_finish_oauth(text,text,uuid) from public,anon,authenticated;
revoke all on function public.onedrive_commit_document(uuid,uuid,text,text,text,text,text,bigint,date,uuid,uuid) from public,anon,authenticated;
grant execute on function public.onedrive_acquire(uuid) to service_role;
grant execute on function public.onedrive_finish_oauth(text,text,uuid) to service_role;
grant execute on function public.onedrive_commit_document(uuid,uuid,text,text,text,text,text,bigint,date,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
