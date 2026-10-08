begin;
create table if not exists public.charter_trips (
 center_code text not null check(center_code in ('001','002')),
 id text not null,
 business_date date,
 payload jsonb not null check(coalesce(jsonb_typeof(payload),'')='object' and coalesce(jsonb_typeof(payload->'deliveries'),'')='array'),
 version bigint not null default 1,
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key(center_code,id),
 check(coalesce(payload->>'id','')=id and coalesce(payload->>'centerCode','')=center_code)
);
create index if not exists charter_trips_date_idx on public.charter_trips(center_code,business_date);
create index if not exists charter_trips_payload_idx on public.charter_trips using gin(payload jsonb_path_ops);
create table if not exists public.charter_archives (
 id uuid primary key default gen_random_uuid(),center_code text not null check(center_code in ('001','002')),
 month text not null check(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 drive_id text not null,item_id text not null,file_name text not null,content_hash text not null,
 snapshot jsonb,record_count integer not null,verified_at timestamptz not null,
 archived_by uuid references auth.users(id),purged_at timestamptz
);
alter table public.charter_trips enable row level security;
alter table public.charter_archives enable row level security;
drop policy if exists charter_trips_read on public.charter_trips;
create policy charter_trips_read on public.charter_trips for select to authenticated using (
 exists(select 1 from public.user_profiles where id=auth.uid() and active and role in ('viewer','editor','admin')));
drop policy if exists charter_archives_read on public.charter_archives;
create policy charter_archives_read on public.charter_archives for select to authenticated using (
 exists(select 1 from public.user_profiles where id=auth.uid() and active and role in ('viewer','editor','admin')));
revoke all on public.charter_trips,public.charter_archives from anon,authenticated;
grant select on public.charter_trips,public.charter_archives to authenticated;
grant all on public.charter_trips,public.charter_archives to service_role;
create or replace function public.save_charter_trips(p_center text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;old_version bigint;out_rows jsonb:='[]'::jsonb;new_row public.charter_trips;
begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role in ('editor','admin')) then raise exception '저장 권한이 없습니다.';end if;
 if p_center is null or p_rows is null or p_center not in ('001','002') or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>500 then raise exception '저장 데이터 범위를 확인해 주세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended('charter:'||p_center,0));
 for r in select value from jsonb_array_elements(p_rows) loop
  if coalesce(r->'payload'->>'id','')='' or (r->'payload'->>'centerCode') is distinct from p_center or coalesce(jsonb_typeof(r->'payload'->'deliveries'),'')<>'array' then raise exception '운행ID 또는 센터가 올바르지 않습니다.';end if;
  select version into old_version from public.charter_trips where center_code=p_center and id=r->'payload'->>'id' for update;
  if coalesce(old_version,0)<>coalesce((r->>'expectedVersion')::bigint,0) then raise exception '다른 사용자가 수정한 데이터입니다. DB를 다시 조회해 주세요.';end if;
  insert into public.charter_trips(center_code,id,business_date,payload,version,updated_by)
  values(p_center,r->'payload'->>'id',nullif(r->'payload'->>'date','')::date,r->'payload',coalesce(old_version,0)+1,auth.uid())
  on conflict(center_code,id) do update set business_date=excluded.business_date,payload=excluded.payload,version=excluded.version,updated_by=excluded.updated_by,updated_at=now()
  returning * into new_row;
  out_rows:=out_rows||jsonb_build_array(jsonb_build_object('id',new_row.id,'version',new_row.version));
 end loop;
 return out_rows;
end $$;
revoke all on function public.save_charter_trips(text,jsonb) from public,anon;
grant execute on function public.save_charter_trips(text,jsonb) to authenticated;
create or replace function public.purge_charter_month(p_archive uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare a public.charter_archives;r jsonb;n integer;removed integer;start_date date;end_date date;
begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then raise exception '월 정리는 관리자만 가능합니다.';end if;
 select * into a from public.charter_archives where id=p_archive for update;
 if a.id is null or a.snapshot is null or a.purged_at is not null or a.verified_at is null then raise exception '검증된 보관본이 필요합니다.';end if;
 perform pg_advisory_xact_lock(hashtextextended('charter:'||a.center_code,0));
 start_date:=(a.month||'-01')::date;end_date:=(start_date+interval '1 month')::date;
 select count(*) into n from public.charter_trips where center_code=a.center_code and business_date>=start_date and business_date<end_date;
 if n<>a.record_count or n<>jsonb_array_length(a.snapshot->'rows') then raise exception '보관 이후 데이터가 바뀌었습니다. 다시 보관해 주세요.';end if;
 for r in select value from jsonb_array_elements(a.snapshot->'rows') loop
  if not exists(select 1 from public.charter_trips where center_code=a.center_code and id=r->>'id' and version=(r->>'version')::bigint and payload=r->'payload' and business_date>=start_date and business_date<end_date) then raise exception '보관 이후 데이터가 바뀌었습니다. 다시 보관해 주세요.';end if;
 end loop;
 delete from public.charter_trips where center_code=a.center_code and business_date>=start_date and business_date<end_date;
 get diagnostics removed=row_count;
 update public.charter_archives set purged_at=now(),snapshot=null where id=a.id;
 return removed;
end $$;
revoke all on function public.purge_charter_month(uuid) from public,anon;
grant execute on function public.purge_charter_month(uuid) to authenticated;
create or replace view public.charter_deliveries with(security_invoker=true) as
 select t.center_code,t.id as trip_id,t.business_date,t.payload->>'course' as course,t.payload->>'vehicleSequence' as vehicle_sequence,
 d.value->>'id' as delivery_id,d.value->>'code' as delivery_code,d.value->>'name' as delivery_name,
 d.value->>'customer' as customer,d.value->>'address' as address,d.value->>'region' as region,
 (d.value->>'quantity')::numeric as quantity,(d.value->>'frozen')::numeric as frozen,(d.value->>'chilled')::numeric as chilled
 from public.charter_trips t cross join lateral jsonb_array_elements(t.payload->'deliveries') d(value);
grant select on public.charter_deliveries to authenticated;

create or replace function public.delete_charter_trip(p_center text,p_id text,p_version bigint)
returns boolean language plpgsql security definer set search_path=public as $
declare removed integer;
begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role in ('editor','admin')) then raise exception '삭제 권한이 없습니다.';end if;
 if p_center is null or p_center not in ('001','002') or coalesce(p_id,'')='' or p_version is null or p_version<1 then raise exception '삭제할 운행을 확인해 주세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended('charter:'||p_center,0));
 delete from public.charter_trips where center_code=p_center and id=p_id and version=p_version;
 get diagnostics removed=row_count;
 if removed<>1 then raise exception '다른 사용자가 수정하거나 삭제한 데이터입니다. DB를 다시 조회해 주세요.';end if;
 return true;
end $;
revoke all on function public.delete_charter_trip(text,text,bigint) from public,anon;
grant execute on function public.delete_charter_trip(text,text,bigint) to authenticated;

notify pgrst,'reload schema';
commit;
