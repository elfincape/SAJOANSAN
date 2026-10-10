begin;
create table public.operations_sync_lease (singleton boolean primary key default true check(singleton),owner uuid not null,expires_at timestamptz not null);
alter table public.operations_sync_lease enable row level security;
revoke all on public.operations_sync_lease from public,anon,authenticated;
create function public.operations_sync_lock(p_owner uuid,p_release boolean default false) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare claimed uuid;
begin
 if auth.role() is distinct from 'service_role' or p_owner is null then raise exception '서버 전용 잠금입니다' using errcode='42501';end if;
 if p_release then delete from public.operations_sync_lease where owner=p_owner;return true;end if;
 insert into public.operations_sync_lease(singleton,owner,expires_at) values(true,p_owner,now()+interval '5 minutes')
 on conflict(singleton) do update set owner=excluded.owner,expires_at=excluded.expires_at
 where operations_sync_lease.owner=p_owner or operations_sync_lease.expires_at<now()
 returning owner into claimed;
 return claimed is not null;
end;$$;
revoke all on function public.operations_sync_lock(uuid,boolean) from public,anon,authenticated;
grant execute on function public.operations_sync_lock(uuid,boolean) to service_role;
commit;
