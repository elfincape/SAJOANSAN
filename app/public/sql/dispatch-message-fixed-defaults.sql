begin;
alter table public.dispatch_message_drafts
 add column record_kind text generated always as (coalesce(payload->>'recordKind','draft')) stored,
 add constraint dispatch_message_record_kind_check check (coalesce(payload->>'recordKind','draft') in ('draft','fixed-defaults'));
create unique index dispatch_message_fixed_defaults_owner_center_idx
 on public.dispatch_message_drafts(owner_id,center_code) where record_kind='fixed-defaults';

create or replace function public.guard_dispatch_message_draft() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.owner_id is distinct from old.owner_id
   or new.center_code is distinct from old.center_code or new.created_at is distinct from old.created_at
   or new.revision is distinct from old.revision + 1
   or coalesce(new.payload->>'recordKind','draft') is distinct from coalesce(old.payload->>'recordKind','draft')) then
   raise exception 'Draft identity or revision changed' using errcode='PT409';
 end if;
 if new.payload->>'date' is distinct from new.business_date::text
   or new.payload->>'schemaVersion' is distinct from '1'
   or jsonb_typeof(new.payload->'requests') is distinct from 'array'
   or jsonb_typeof(new.payload->'trucks') is distinct from 'array' then
   raise exception 'Invalid message draft' using errcode='22023';
 end if;
 if new.payload ? 'fixedDrivers' then
   if jsonb_typeof(new.payload->'fixedDrivers') is distinct from 'array' then
     raise exception 'Invalid fixed drivers' using errcode='22023';
   end if;
   if jsonb_array_length(new.payload->'fixedDrivers') > 100 then
     raise exception 'Too many fixed drivers' using errcode='22023';
   end if;
 end if;
 if new.payload->>'recordKind' = 'fixed-defaults' and
   (jsonb_typeof(new.payload->'fixedDrivers') is distinct from 'array'
    or jsonb_array_length(new.payload->'requests') <> 0 or jsonb_array_length(new.payload->'trucks') <> 0) then
   raise exception 'Invalid fixed defaults' using errcode='22023';
 end if;
 new.updated_at := now();
 return new;
end $$;
notify pgrst,'reload schema';
commit;
