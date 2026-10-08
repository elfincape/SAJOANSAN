create table if not exists public.notion_health_sync_lock (
  id boolean primary key default true check (id),
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.notion_health_sync_lock enable row level security;
revoke all on public.notion_health_sync_lock from public, anon, authenticated;
grant all on public.notion_health_sync_lock to service_role;
create or replace function public.notion_health_acquire(p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare affected integer;
begin
  insert into public.notion_health_sync_lock(id,token,expires_at)
  values(true,p_token,clock_timestamp()+interval '180 seconds')
  on conflict(id) do update set token=excluded.token,expires_at=excluded.expires_at
  where public.notion_health_sync_lock.expires_at<=clock_timestamp();
  get diagnostics affected=row_count;
  return affected=1;
end;
$$;
create or replace function public.notion_health_release(p_token uuid)
returns void language sql security definer set search_path=pg_catalog as $$
  delete from public.notion_health_sync_lock where id=true and token=p_token;
$$;
revoke all on function public.notion_health_acquire(uuid) from public, anon, authenticated;
revoke all on function public.notion_health_release(uuid) from public, anon, authenticated;
grant execute on function public.notion_health_acquire(uuid) to service_role;
grant execute on function public.notion_health_release(uuid) to service_role;
