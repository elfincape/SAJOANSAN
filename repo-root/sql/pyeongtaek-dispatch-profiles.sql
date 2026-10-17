-- PREPARED ONLY: review before applying. No legacy deadline/method or course view changes.
-- Reuses existing delivery_points grants, RLS and operations_resource_allowed edit guard.
begin;

alter table public.delivery_points add column if not exists dispatch_profile jsonb;

create or replace function public.valid_pyeongtaek_dispatch_profile(p jsonb, p_metadata boolean)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
 k text;
 expected text[] := array['otd','mode','unloadMinutes','inspectionMinutes','marginMinutes','notes'];
begin
 if p is null or p_metadata is null or jsonb_typeof(p) <> 'object' then return false; end if;
 if p_metadata then expected := expected || array['revision','updatedAt']; end if;
 if not (p ?& expected) or exists (select 1 from jsonb_object_keys(p) as keys(key) where not (key = any(expected))) then return false; end if;
 if jsonb_typeof(p->'otd') <> 'string' or length(p->>'otd') > 500
    or jsonb_typeof(p->'notes') <> 'string' or length(p->>'notes') > 4000
    or jsonb_typeof(p->'mode') <> 'string'
    or p->>'mode' not in ('unmanned','attended','yard','unknown') then return false; end if;
 foreach k in array array['unloadMinutes','inspectionMinutes','marginMinutes'] loop
   if jsonb_typeof(p->k) <> 'null' then
     if jsonb_typeof(p->k) <> 'number' then return false; end if;
     if (p->>k)::numeric < 0 or (p->>k)::numeric > 1440 then return false; end if;
   end if;
 end loop;
 if p_metadata then
   if jsonb_typeof(p->'revision') <> 'number' or (p->>'revision') !~ '^[0-9]+$'
      or (p->>'revision')::numeric < 1 or (p->>'revision')::numeric > 2147483647
      or jsonb_typeof(p->'updatedAt') <> 'string' or length(p->>'updatedAt') > 40
      or (p->>'updatedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' then return false; end if;
   perform (p->>'updatedAt')::timestamptz;
 end if;
 return true;
exception when others then
 return false;
end $$;
revoke all on function public.valid_pyeongtaek_dispatch_profile(jsonb,boolean) from public,anon;
grant execute on function public.valid_pyeongtaek_dispatch_profile(jsonb,boolean) to authenticated;

alter table public.delivery_points drop constraint if exists delivery_points_dispatch_profile_valid;
alter table public.delivery_points add constraint delivery_points_dispatch_profile_valid check (
 dispatch_profile is null or (
   center_code is not distinct from '002'
   and public.valid_pyeongtaek_dispatch_profile(dispatch_profile,true)
 )
);

create or replace function public.guard_pyeongtaek_dispatch_profile()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare previous_revision integer;
begin
 if tg_op = 'INSERT' then
   if new.dispatch_profile is not null then
     raise exception 'Profiles belong to existing center 002 delivery points' using errcode = '22023';
   end if;
   return new;
 end if;
 if new.dispatch_profile is not distinct from old.dispatch_profile then return new; end if;
 if auth.uid() is null
    or public.operations_resource_allowed('delivery_points','edit',old.center_code) is not true
    or public.operations_resource_allowed('delivery_points','edit',new.center_code) is not true then
   raise exception 'Delivery point edit permission required' using errcode = '42501';
 end if;
 if old.center_code is distinct from '002' or new.center_code is distinct from '002'
    or new.id is distinct from old.id then
   raise exception 'Invalid profile destination' using errcode = '22023';
 end if;
 -- Clearing means writing the empty profile, not resetting its concurrency token to null.
 if not public.valid_pyeongtaek_dispatch_profile(new.dispatch_profile,true) then
   raise exception 'Invalid dispatch profile' using errcode = '22023';
 end if;
 previous_revision := coalesce((old.dispatch_profile->>'revision')::integer,0);
 if previous_revision = 2147483647
    or (new.dispatch_profile->>'revision')::bigint <> previous_revision::bigint + 1 then
   raise exception 'Profile changed; reload before saving' using errcode = 'PT409';
 end if;
 new.dispatch_profile := jsonb_set(new.dispatch_profile,'{updatedAt}',to_jsonb(to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 return new;
end $$;
drop trigger if exists guard_dispatch_profile on public.delivery_points;
create trigger guard_dispatch_profile before insert or update on public.delivery_points
 for each row execute function public.guard_pyeongtaek_dispatch_profile();
revoke all on function public.guard_pyeongtaek_dispatch_profile() from public,anon,authenticated;

create or replace function public.save_pyeongtaek_dispatch_profiles(p_entries jsonb)
returns table(id uuid,dispatch_profile jsonb)
language plpgsql security invoker set search_path = '' as $$
declare
 entry jsonb;
 target public.delivery_points;
 saved public.delivery_points;
 ids uuid[] := array[]::uuid[];
 target_id uuid;
 expected_revision integer;
begin
 if auth.uid() is null
    or public.operations_resource_allowed('delivery_points','read','002') is not true
    or public.operations_resource_allowed('delivery_points','edit','002') is not true then
   raise exception 'Center 002 delivery point read/edit permission required' using errcode = '42501';
 end if;
 if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
   raise exception 'Profile entries must be an array' using errcode = '22023';
 end if;
 if jsonb_array_length(p_entries) < 1 or jsonb_array_length(p_entries) > 1000 then
   raise exception 'Profile batch must contain 1 to 1000 entries' using errcode = '22023';
 end if;
 -- Validate the entire batch before acquiring locks or changing any rows.
 for entry in select value from jsonb_array_elements(p_entries) loop
   if jsonb_typeof(entry) <> 'object' then raise exception 'Invalid profile entry' using errcode = '22023'; end if;
   if not (entry ?& array['id','revision','profile'])
      or exists (select 1 from jsonb_object_keys(entry) as keys(key) where key not in ('id','revision','profile'))
      or jsonb_typeof(entry->'id') <> 'string'
      or (entry->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(entry->'revision') <> 'number'
      or (entry->>'revision') !~ '^[0-9]+$'
      or not public.valid_pyeongtaek_dispatch_profile(entry->'profile',false) then
     raise exception 'Invalid profile entry fields' using errcode = '22023';
   end if;
   if (entry->>'revision')::numeric > 2147483646 then raise exception 'Invalid revision' using errcode = '22023'; end if;
   target_id := (entry->>'id')::uuid;
   if target_id = any(ids) then raise exception 'Duplicate destination in batch' using errcode = '22023'; end if;
   ids := array_append(ids,target_id);
 end loop;
 -- Global UUID order prevents reversed overlapping batches from deadlocking.
 for target_id in select value from unnest(ids) as items(value) order by value loop
   select d.* into target from public.delivery_points d
   where d.id = target_id and d.center_code = '002' for update;
   if not found then raise exception 'Destination missing or inaccessible' using errcode = 'PT409'; end if;
   select value into entry from jsonb_array_elements(p_entries) where (value->>'id')::uuid = target_id;
   expected_revision := (entry->>'revision')::integer;
   if coalesce((target.dispatch_profile->>'revision')::integer,0) <> expected_revision then
     raise exception 'Profile changed; reload before saving' using errcode = 'PT409';
   end if;
 end loop;
 for target_id in select value from unnest(ids) as items(value) order by value loop
   select value into entry from jsonb_array_elements(p_entries) where (value->>'id')::uuid = target_id;
   expected_revision := (entry->>'revision')::integer;
   update public.delivery_points d set dispatch_profile = (entry->'profile') || jsonb_build_object(
     'revision',expected_revision + 1,
     'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
   ) where d.id = target_id and d.center_code = '002'
     and coalesce((d.dispatch_profile->>'revision')::integer,0) = expected_revision
   returning d.* into saved;
   if not found then raise exception 'Destination changed or is not writable' using errcode = 'PT409'; end if;
   id := saved.id;
   dispatch_profile := saved.dispatch_profile;
   return next;
 end loop;
end $$;
revoke all on function public.save_pyeongtaek_dispatch_profiles(jsonb) from public,anon;
grant execute on function public.save_pyeongtaek_dispatch_profiles(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
