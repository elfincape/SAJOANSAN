-- Apply only during the reference-master cutover, after the ERP and source backups.
begin;
set local lock_timeout = '10s';
-- The existing document lock serializes Graph operations. Claim it in the same
-- transaction so an in-flight legacy upload cannot finish across the fence.
do $erp$
begin
  if to_regprocedure('public.onedrive_commit_erp_document(uuid,uuid,boolean,text,text,text,bigint,uuid,uuid)') is null then
    raise exception 'ERP document schema is not installed';
  end if;
  if not public.onedrive_acquire('f60b1c55-7f80-41eb-a303-654bf49aa4f0') then
    raise exception 'Wait for the active OneDrive operation';
  end if;
  if exists (select 1 from public.onedrive_uploads j where status='pending'
      and not exists(select 1 from public.driver_documents d where d.request_id=j.request_id
        and d.subject_driver_id=j.subject_driver_id and d.drive_id=j.drive_id and d.item_id=j.item_id)
      and not exists(select 1 from public.company_documents c where c.request_id=j.request_id
        and c.subject_company_id=j.subject_company_id and c.drive_id=j.drive_id and c.item_id=j.item_id)) then
    raise exception 'Review pending OneDrive uploads before freezing';
  end if;
  -- Leave the lease held until the ERP-aware Edge function is live. Otherwise
  -- an old function could write to Graph before reaching the revoked RPC.
  update public.onedrive_locks set expires_at=now()+interval '2 hours'
    where name='connection' and holder='f60b1c55-7f80-41eb-a303-654bf49aa4f0';
end
$erp$;
lock table public.drivers, public.vehicles, public.companies in share row exclusive mode;
revoke insert,update,delete,truncate on public.drivers,public.vehicles,public.companies
  from public,anon,authenticated,service_role;
revoke execute on function public.onedrive_commit_document(uuid,uuid,text,text,text,text,text,bigint,date,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke execute on function public.onedrive_commit_company_document(uuid,uuid,text,text,text,text,text,bigint,date,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke execute on function public.onedrive_replace_company_documents(uuid,uuid,uuid,text,jsonb,uuid)
  from public,anon,authenticated,service_role;
do $erp$
begin
  if exists (
    select 1 from unnest(array['anon','authenticated','service_role']) r,
      unnest(array['public.drivers','public.vehicles','public.companies']) t,
      unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
    where has_table_privilege(r,t,p) or (p in ('INSERT','UPDATE') and has_any_column_privilege(r,t,p))
  ) then raise exception 'Legacy reference DML is still granted'; end if;
  if exists (
    select 1 from unnest(array['anon','authenticated','service_role']) r
    where has_function_privilege(r,'public.notion_graph_apply(text,text,uuid,jsonb,jsonb)','execute')
       or has_function_privilege(r,'public.onedrive_commit_document(uuid,uuid,text,text,text,text,text,bigint,date,uuid,uuid)','execute')
       or has_function_privilege(r,'public.onedrive_commit_company_document(uuid,uuid,text,text,text,text,text,bigint,date,uuid,uuid)','execute')
       or has_function_privilege(r,'public.onedrive_replace_company_documents(uuid,uuid,uuid,text,jsonb,uuid)','execute')
  ) then raise exception 'A legacy reference RPC is still callable'; end if;
end
$erp$;
notify pgrst,'reload schema';
commit;
