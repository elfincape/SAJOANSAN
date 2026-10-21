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

create table if not exists public.notion_health_completion_status (
  center_code text primary key check (center_code in ('001','002')),
  last_completed_at timestamptz not null
);
alter table public.notion_health_completion_status enable row level security;
revoke all on public.notion_health_completion_status from public, anon, authenticated;
grant all on public.notion_health_completion_status to service_role;
create or replace function public.notion_health_record_completion(p_center text)
returns timestamptz language plpgsql security definer set search_path=pg_catalog as $$
declare completed_at timestamptz=clock_timestamp();
begin
  if p_center not in ('001','002') or p_center is null then
    raise exception 'Invalid center';
  end if;
  insert into public.notion_health_completion_status(center_code,last_completed_at)
  values(p_center,completed_at)
  on conflict(center_code) do update set last_completed_at=excluded.last_completed_at;
  return completed_at;
end;
$$;
revoke all on function public.notion_health_record_completion(text) from public, anon, authenticated;
grant execute on function public.notion_health_record_completion(text) to service_role;

create table if not exists public.notion_health_schedule_state (
  id boolean primary key default true check(id),
  phase text not null default 'idle' check(phase in ('idle','sync','complete')),
  center_code text not null default '001' check(center_code in ('001','002')),
  cursor text,
  next_due_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  last_finished_at timestamptz,
  last_tick_at timestamptz,
  last_error text,
  lease_token uuid,
  lease_until timestamptz
);
alter table public.notion_health_schedule_state enable row level security;
revoke all on public.notion_health_schedule_state from public,anon,authenticated;
grant all on public.notion_health_schedule_state to service_role;
insert into public.notion_health_schedule_state(id) values(true) on conflict do nothing;

create or replace function public.notion_health_schedule_claim(p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare current_row public.notion_health_schedule_state; stamp timestamptz=clock_timestamp();
begin
  select * into current_row from public.notion_health_schedule_state where id=true for update;
  if current_row.lease_until>stamp or (current_row.phase='idle' and current_row.next_due_at>stamp) then
    return null;
  end if;
  if current_row.phase='idle' then
    update public.notion_health_schedule_state set phase='sync',center_code='001',cursor=null,
      started_at=stamp,next_due_at=stamp+interval '15 minutes',last_error=null where id=true;
  end if;
  update public.notion_health_schedule_state set lease_token=p_token,lease_until=stamp+interval '150 seconds',
    last_tick_at=stamp where id=true returning * into current_row;
  return to_jsonb(current_row)-'lease_token';
end;
$$;
create or replace function public.notion_health_schedule_checkpoint(p_token uuid,p_center text,p_phase text,p_cursor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare current_row public.notion_health_schedule_state;
begin
  if p_center not in ('001','002') or p_phase not in ('idle','sync','complete') then raise exception 'Invalid checkpoint'; end if;
  update public.notion_health_schedule_state set center_code=p_center,phase=p_phase,cursor=p_cursor,last_error=null,
    last_finished_at=case when p_phase='idle' then clock_timestamp() else last_finished_at end
    where id=true and lease_token=p_token and lease_until>clock_timestamp() returning * into current_row;
  if not found then raise exception 'Schedule lease lost'; end if;
  return to_jsonb(current_row)-'lease_token';
end;
$$;
create or replace function public.notion_health_schedule_error(p_token uuid,p_error text)
returns void language sql security definer set search_path=pg_catalog as $$
  update public.notion_health_schedule_state set last_error=left(p_error,100) where id=true and lease_token=p_token;
$$;
create or replace function public.notion_health_schedule_release(p_token uuid,p_retry integer)
returns void language sql security definer set search_path=pg_catalog as $$
  update public.notion_health_schedule_state set lease_token=null,
    lease_until=clock_timestamp()+make_interval(secs=>greatest(0,least(p_retry,180)))
    where id=true and lease_token=p_token;
$$;
revoke all on function public.notion_health_schedule_claim(uuid) from public,anon,authenticated;
revoke all on function public.notion_health_schedule_checkpoint(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.notion_health_schedule_error(uuid,text) from public,anon,authenticated;
revoke all on function public.notion_health_schedule_release(uuid,integer) from public,anon,authenticated;
grant execute on function public.notion_health_schedule_claim(uuid) to service_role;
grant execute on function public.notion_health_schedule_checkpoint(uuid,text,text,text) to service_role;
grant execute on function public.notion_health_schedule_error(uuid,text) to service_role;
grant execute on function public.notion_health_schedule_release(uuid,integer) to service_role;
