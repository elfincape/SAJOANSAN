-- Run only after the new ERP release and ERP-aware Edge bundle are verified.
begin;
do $erp$
begin
  if not exists (select 1 from public.onedrive_locks where name='connection'
    and holder='f60b1c55-7f80-41eb-a303-654bf49aa4f0' and expires_at>now()) then
    raise exception 'The reference cutover lease is not active';
  end if;
  if exists (select 1 from unnest(array['public.drivers','public.vehicles','public.companies']) t
    where has_table_privilege('authenticated',t,'INSERT,UPDATE,DELETE')
       or has_table_privilege('service_role',t,'INSERT,UPDATE,DELETE')) then
    raise exception 'Legacy reference write grants are still active';
  end if;
  update public.onedrive_settings set erp_document_catalog_enabled=true where id=true;
  if not found then raise exception 'OneDrive settings row is missing'; end if;
  delete from public.onedrive_locks
    where name='connection' and holder='f60b1c55-7f80-41eb-a303-654bf49aa4f0';
end
$erp$;
commit;
