-- Applied as pyeongtaek_dispatch_drafts on 2026-10-18. Browser writes use the guarded RPC.
-- Separate from charter_trips: these are owner-private planning snapshots, not trips.
begin;
create table public.pyeongtaek_dispatch_drafts (
 id uuid primary key default gen_random_uuid(),
 center_code text not null default '002' check (center_code = '002'),
 owner_id uuid not null default auth.uid() references auth.users(id),
 business_date date not null,
 payload jsonb not null check (jsonb_typeof(payload) = 'object'),
 revision integer not null default 1 check (revision > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index pyeongtaek_dispatch_drafts_owner_date_idx
 on public.pyeongtaek_dispatch_drafts(owner_id,business_date,id);
alter table public.pyeongtaek_dispatch_drafts enable row level security;
create policy dispatch_drafts_read on public.pyeongtaek_dispatch_drafts
 for select to authenticated using (
 center_code = '002' and owner_id = (select auth.uid())
 and public.operations_resource_allowed('charter','read',center_code)
 and exists (select 1 from public.user_profiles where id = auth.uid() and active and role in ('viewer','editor','admin'))
);
create policy dispatch_drafts_insert on public.pyeongtaek_dispatch_drafts
 for insert to authenticated with check (
 center_code = '002' and owner_id = (select auth.uid())
 and public.operations_resource_allowed('charter','edit',center_code)
 and exists (select 1 from public.user_profiles where id = auth.uid() and active and role in ('editor','admin'))
);
create policy dispatch_drafts_update on public.pyeongtaek_dispatch_drafts
 for update to authenticated using (
 center_code = '002' and owner_id = (select auth.uid())
 and public.operations_resource_allowed('charter','edit',center_code)
 and exists (select 1 from public.user_profiles where id = auth.uid() and active and role in ('editor','admin'))
) with check (
 center_code = '002' and owner_id = (select auth.uid())
 and public.operations_resource_allowed('charter','edit',center_code)
 and exists (select 1 from public.user_profiles where id = auth.uid() and active and role in ('editor','admin'))
);
revoke all on public.pyeongtaek_dispatch_drafts from public,anon,authenticated;
grant select on public.pyeongtaek_dispatch_drafts to authenticated;
grant insert (business_date,payload) on public.pyeongtaek_dispatch_drafts to authenticated;
grant update (business_date,payload,revision,updated_at) on public.pyeongtaek_dispatch_drafts to authenticated;

create function public.guard_pyeongtaek_dispatch_draft() returns trigger
 language plpgsql security invoker set search_path = '' as $$
begin
 if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id
    or new.center_code is distinct from old.center_code or new.created_at is distinct from old.created_at
    or new.revision is distinct from old.revision + 1 then
   raise exception 'Invalid draft identity or revision' using errcode = 'PT409';
 end if;
 new.updated_at := now();
 return new;
end $$;
create trigger guard_dispatch_draft before update on public.pyeongtaek_dispatch_drafts
 for each row execute function public.guard_pyeongtaek_dispatch_draft();
revoke all on function public.guard_pyeongtaek_dispatch_draft() from public,anon,authenticated;

create function public.save_pyeongtaek_dispatch_draft(p_id uuid,p_date date,p_payload jsonb,p_revision integer)
 returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.pyeongtaek_dispatch_drafts;
begin
 if auth.uid() is null
    or public.operations_resource_allowed('charter','read','002') is not true
    or public.operations_resource_allowed('charter','edit','002') is not true then
   raise exception 'Center 002 charter permission required' using errcode = '42501';
 end if;
 if p_date is null or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_revision is null or p_revision < 0 then
   raise exception 'Invalid draft input' using errcode = '22023';
 end if;
 if p_id is null then
   if p_revision <> 0 then raise exception 'New draft revision must be zero' using errcode = 'PT409'; end if;
   insert into public.pyeongtaek_dispatch_drafts(business_date,payload)
   values(p_date,p_payload) returning * into saved;
 else
   update public.pyeongtaek_dispatch_drafts
   set business_date = p_date,payload = p_payload,revision = revision + 1,updated_at = now()
   where id = p_id and center_code = '002' and owner_id = auth.uid() and revision = p_revision
   returning * into saved;
   if not found then raise exception 'Draft changed or is not accessible; reload before saving' using errcode = 'PT409'; end if;
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.save_pyeongtaek_dispatch_draft(uuid,date,jsonb,integer) from public,anon;
grant execute on function public.save_pyeongtaek_dispatch_draft(uuid,date,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
commit;
