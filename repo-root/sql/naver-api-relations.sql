begin;

create table public.naver_api_addresses (
 id uuid primary key default pg_catalog.gen_random_uuid(),
 center_code text not null references public.centers(code),
 address_key text not null check (pg_catalog.btrim(address_key) <> ''),
 address text not null check (pg_catalog.btrim(address) <> ''),
 standard_address text,
 x double precision check (x between -180 and 180),
 y double precision check (y between -90 and 90),
 region text,
 region_key text,
 status text not null default 'attention' check (status in ('ready','attention')),
 error text,
 measured_at timestamptz,
 unique (center_code,address_key),
 unique (center_code,id),
 check ((x is null) = (y is null)),
 check (status <> 'ready' or (x is not null and y is not null and measured_at is not null))
);

create table public.naver_api_legs (
 center_code text not null references public.centers(code),
 from_id uuid not null,
 to_id uuid not null,
 priority text not null default 'RECOMMEND' check (priority in ('RECOMMEND','TIME','MIN_DISTANCE')),
 coords_key text not null check (pg_catalog.btrim(coords_key) <> ''),
 distance_meters double precision not null
  check (distance_meters >= 0 and distance_meters < 'Infinity'::double precision),
 duration_seconds double precision not null
  check (duration_seconds >= 0 and duration_seconds < 'Infinity'::double precision),
 measured_at timestamptz not null default pg_catalog.now(),
 primary key (center_code,from_id,to_id,priority,coords_key),
 foreign key (center_code,from_id) references public.naver_api_addresses(center_code,id),
 foreign key (center_code,to_id) references public.naver_api_addresses(center_code,id)
);

create table public.naver_api_jobs (
 id uuid primary key default pg_catalog.gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 center_code text not null references public.centers(code),
 status text not null default 'queued'
  check (status in ('queued','running','paused','attention','completed')),
 state jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(state) = 'object'),
 directions_budget integer not null default 60 check (directions_budget between 0 and 25000),
 geocoding_budget integer not null default 2000 check (geocoding_budget between 0 and 2000),
 directions_attempts integer not null default 0
  check (directions_attempts >= 0 and directions_attempts <= directions_budget),
 geocoding_attempts integer not null default 0
  check (geocoding_attempts >= 0 and geocoding_attempts <= geocoding_budget),
 usage_month date not null default pg_catalog.date_trunc('month',pg_catalog.now() at time zone 'Asia/Seoul')::date,
 month_directions_attempts integer not null default 0 check (month_directions_attempts between 0 and directions_attempts),
 month_geocoding_attempts integer not null default 0 check (month_geocoding_attempts between 0 and geocoding_attempts),
 error text,
 worker_id uuid,
 lease_until timestamptz,
 created_at timestamptz not null default pg_catalog.now(),
 updated_at timestamptz not null default pg_catalog.now(),
 check ((worker_id is null) = (lease_until is null))
);

create index naver_api_jobs_owner_created on public.naver_api_jobs(owner_id,created_at desc);
create index naver_api_jobs_month on public.naver_api_jobs(center_code,usage_month);
create index naver_api_legs_destination on public.naver_api_legs(center_code,to_id);

alter table public.naver_api_addresses enable row level security;
alter table public.naver_api_legs enable row level security;
alter table public.naver_api_jobs enable row level security;

revoke all on public.naver_api_addresses,public.naver_api_legs,public.naver_api_jobs
 from public,anon,authenticated;
grant select on public.naver_api_addresses,public.naver_api_legs,public.naver_api_jobs to authenticated;
grant all on public.naver_api_addresses,public.naver_api_legs,public.naver_api_jobs to service_role;

create policy naver_api_addresses_read on public.naver_api_addresses for select to authenticated
 using (public.operations_resource_allowed('delivery_points','read',center_code));
create policy naver_api_legs_read on public.naver_api_legs for select to authenticated
 using (public.operations_resource_allowed('delivery_points','read',center_code));
create policy naver_api_jobs_read on public.naver_api_jobs for select to authenticated
 using (
  public.operations_resource_allowed('delivery_points','read',center_code)
  and (owner_id = (select auth.uid()) or exists (
   select 1 from public.user_profiles p
   where p.id = (select auth.uid()) and p.active and p.role = 'admin'
  ))
 );

create function public.naver_api_claim(p_job uuid,p_lock uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
 if p_lock is null then
  raise exception 'A worker lock is required.' using errcode = '22023';
 end if;
 update public.naver_api_jobs as j
 set status = 'running',worker_id = p_lock,
  lease_until = pg_catalog.clock_timestamp() + interval '90 seconds',
  updated_at = pg_catalog.clock_timestamp()
 where j.id = p_job and j.status in ('queued','running')
  and (j.lease_until is null or j.lease_until <= pg_catalog.clock_timestamp())
 returning pg_catalog.to_jsonb(j) into result;
 return result;
end;
$$;

create function public.naver_api_reserve(p_job uuid,p_lock uuid,p_kind text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare scope text; month date := pg_catalog.date_trunc('month',pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date;
 directions_used bigint; geocoding_used bigint;
begin
 if p_kind is null or p_kind not in ('directions','geocoding') then
  raise exception 'Unknown request kind.' using errcode = '22023';
 end if;
 select j.center_code into scope from public.naver_api_jobs j where j.id=p_job;
 if scope is null then return false; end if;
 -- One collector allowance across jobs: a pilot followed by a new job cannot reset it.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('naver-api-relations|'||scope||'|'||month::text,0));
 select coalesce(sum(j.month_directions_attempts),0),coalesce(sum(j.month_geocoding_attempts),0)
 into directions_used,geocoding_used from public.naver_api_jobs j where j.center_code=scope and j.usage_month=month;
 update public.naver_api_jobs as j
 set directions_attempts = j.directions_attempts + case when p_kind = 'directions' then 1 else 0 end,
  geocoding_attempts = j.geocoding_attempts + case when p_kind = 'geocoding' then 1 else 0 end,
  month_directions_attempts = case when j.usage_month=month then j.month_directions_attempts else 0 end + case when p_kind='directions' then 1 else 0 end,
  month_geocoding_attempts = case when j.usage_month=month then j.month_geocoding_attempts else 0 end + case when p_kind='geocoding' then 1 else 0 end,
  usage_month=month,
  updated_at = pg_catalog.clock_timestamp()
 where j.id = p_job and j.status = 'running' and j.worker_id = p_lock
  and j.lease_until > pg_catalog.clock_timestamp()
  and ((p_kind = 'directions' and j.directions_attempts < j.directions_budget and directions_used<25000)
   or (p_kind = 'geocoding' and j.geocoding_attempts < j.geocoding_budget and geocoding_used<2000));
 return found;
end;
$$;

create function public.naver_api_release(p_job uuid,p_lock uuid,p_state jsonb,p_status text,p_error text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
 if pg_catalog.jsonb_typeof(p_state) is distinct from 'object'
  or p_status is null or p_status not in ('queued','running','paused','attention','completed') then
  raise exception 'Invalid job state or status.' using errcode = '22023';
 end if;
 -- Cancellation keeps the in-flight lease; its result may finish without restarting the job.
 update public.naver_api_jobs as j
 set state = p_state,status = case when j.status = 'paused' then 'paused' else p_status end,
  error = p_error,worker_id = null,lease_until = null,updated_at = pg_catalog.clock_timestamp()
 where j.id = p_job and j.worker_id = p_lock and j.status in ('running','paused')
 returning pg_catalog.to_jsonb(j) into result;
 return result;
end;
$$;

create function public.naver_api_save_address(p_job uuid,p_lock uuid,p_value jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare job public.naver_api_jobs; result public.naver_api_addresses;
begin
 select j.* into job from public.naver_api_jobs j where j.id=p_job for update;
 if not found or p_lock is null or job.worker_id is null or job.lease_until is null or job.worker_id is distinct from p_lock or job.lease_until<=pg_catalog.clock_timestamp()
  or job.status not in ('running','paused') or p_value->>'center_code' is distinct from job.center_code then return null; end if;
 insert into public.naver_api_addresses(center_code,address_key,address,standard_address,x,y,region,region_key,status,error,measured_at)
 values(job.center_code,p_value->>'address_key',p_value->>'address',p_value->>'standard_address',
  (p_value->>'x')::double precision,(p_value->>'y')::double precision,p_value->>'region',p_value->>'region_key',
  p_value->>'status',p_value->>'error',coalesce((p_value->>'measured_at')::timestamptz,pg_catalog.clock_timestamp()))
 on conflict(center_code,address_key) do update set address=excluded.address,standard_address=excluded.standard_address,
  x=excluded.x,y=excluded.y,region=excluded.region,region_key=excluded.region_key,status=excluded.status,error=excluded.error,measured_at=excluded.measured_at
 where public.naver_api_addresses.measured_at is null or excluded.measured_at>=public.naver_api_addresses.measured_at
 returning * into result;
 if not found then select a.* into result from public.naver_api_addresses a where a.center_code=job.center_code and a.address_key=p_value->>'address_key'; end if;
 return pg_catalog.to_jsonb(result);
end;
$$;

create function public.naver_api_save_leg(p_job uuid,p_lock uuid,p_value jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare job public.naver_api_jobs; result public.naver_api_legs;
begin
 select j.* into job from public.naver_api_jobs j where j.id=p_job for update;
 if not found or p_lock is null or job.worker_id is null or job.lease_until is null or job.worker_id is distinct from p_lock or job.lease_until<=pg_catalog.clock_timestamp()
  or job.status not in ('running','paused') or p_value->>'center_code' is distinct from job.center_code then return null; end if;
 insert into public.naver_api_legs(center_code,from_id,to_id,priority,coords_key,distance_meters,duration_seconds,measured_at)
 values(job.center_code,(p_value->>'from_id')::uuid,(p_value->>'to_id')::uuid,p_value->>'priority',p_value->>'coords_key',
  (p_value->>'distance_meters')::double precision,(p_value->>'duration_seconds')::double precision,(p_value->>'measured_at')::timestamptz)
 on conflict(center_code,from_id,to_id,priority,coords_key) do update set distance_meters=excluded.distance_meters,
  duration_seconds=excluded.duration_seconds,measured_at=excluded.measured_at
 where excluded.measured_at>=public.naver_api_legs.measured_at
 returning * into result;
 if not found then select l.* into result from public.naver_api_legs l where l.center_code=job.center_code
  and l.from_id=(p_value->>'from_id')::uuid and l.to_id=(p_value->>'to_id')::uuid and l.priority=p_value->>'priority' and l.coords_key=p_value->>'coords_key'; end if;
 return pg_catalog.to_jsonb(result);
end;
$$;

revoke all on function public.naver_api_claim(uuid,uuid),public.naver_api_reserve(uuid,uuid,text),
 public.naver_api_release(uuid,uuid,jsonb,text,text),public.naver_api_save_address(uuid,uuid,jsonb),public.naver_api_save_leg(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.naver_api_claim(uuid,uuid),public.naver_api_reserve(uuid,uuid,text),
 public.naver_api_release(uuid,uuid,jsonb,text,text),public.naver_api_save_address(uuid,uuid,jsonb),public.naver_api_save_leg(uuid,uuid,jsonb) to service_role;

create function public.naver_api_cancel(p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare job public.naver_api_jobs; result jsonb;
begin
 if auth.uid() is null then
  raise exception 'Job edit permission is required.' using errcode = '42501';
 end if;
 select j.* into job from public.naver_api_jobs j where j.id = p_job for update;
 if not found then
  raise exception 'Job edit permission is required.' using errcode = '42501';
 end if;
 if public.operations_resource_allowed('delivery_points','edit',job.center_code) is not true
  or (job.owner_id <> auth.uid() and not exists (
   select 1 from public.user_profiles p where p.id = auth.uid() and p.active and p.role = 'admin'
  )) then
  raise exception 'Job edit permission is required.' using errcode = '42501';
 end if;
 update public.naver_api_jobs as j
 set status = 'paused',updated_at = pg_catalog.clock_timestamp()
 where j.id = p_job and j.status in ('queued','running','attention')
 returning pg_catalog.to_jsonb(j) into result;
 return coalesce(result,pg_catalog.to_jsonb(job));
end;
$$;

revoke all on function public.naver_api_cancel(uuid) from public,anon,authenticated;
grant execute on function public.naver_api_cancel(uuid) to authenticated,service_role;

commit;
