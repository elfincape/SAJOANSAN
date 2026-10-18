begin;
create table public.dispatch_message_drafts (
 id uuid primary key default gen_random_uuid(),
 center_code text not null references public.centers(code),
 owner_id uuid not null default auth.uid() references auth.users(id),
 business_date date not null,
 payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4000000 and payload->>'schemaVersion' = '1'),
 revision integer not null default 1 check (revision > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index dispatch_message_drafts_owner_center_date_idx on public.dispatch_message_drafts(owner_id,center_code,business_date desc);
alter table public.dispatch_message_drafts enable row level security;
create policy message_drafts_read on public.dispatch_message_drafts for select to authenticated
 using (owner_id = (select auth.uid()) and public.operations_resource_allowed('dispatch_parser','read',center_code));
create policy message_drafts_insert on public.dispatch_message_drafts for insert to authenticated
 with check (owner_id = (select auth.uid()) and public.operations_resource_allowed('dispatch_parser','read',center_code) and public.operations_resource_allowed('dispatch_parser','edit',center_code));
create policy message_drafts_update on public.dispatch_message_drafts for update to authenticated
 using (owner_id = (select auth.uid()) and public.operations_resource_allowed('dispatch_parser','edit',center_code))
 with check (owner_id = (select auth.uid()) and public.operations_resource_allowed('dispatch_parser','edit',center_code));
revoke all on public.dispatch_message_drafts from public,anon,authenticated;
grant select on public.dispatch_message_drafts to authenticated;
grant insert(center_code,business_date,payload) on public.dispatch_message_drafts to authenticated;
grant update(business_date,payload,revision) on public.dispatch_message_drafts to authenticated;
create function public.guard_dispatch_message_draft() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.owner_id is distinct from old.owner_id
   or new.center_code is distinct from old.center_code or new.created_at is distinct from old.created_at
   or new.revision is distinct from old.revision + 1) then
   raise exception 'Draft identity or revision changed' using errcode='PT409';
 end if;
 if new.payload->>'date' is distinct from new.business_date::text
   or new.payload->>'schemaVersion' is distinct from '1'
   or jsonb_typeof(new.payload->'requests') is distinct from 'array'
   or jsonb_typeof(new.payload->'trucks') is distinct from 'array' then
   raise exception 'Invalid message draft' using errcode='22023';
 end if;
 new.updated_at := now();
 return new;
end $$;
create trigger guard_message_draft before insert or update on public.dispatch_message_drafts for each row execute function public.guard_dispatch_message_draft();
revoke all on function public.guard_dispatch_message_draft() from public,anon,authenticated;
create function public.save_dispatch_message_draft(p_id uuid,p_center text,p_date date,p_payload jsonb,p_revision integer)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.dispatch_message_drafts;
begin
 if auth.uid() is null or public.operations_resource_allowed('dispatch_parser','read',p_center) is not true
   or public.operations_resource_allowed('dispatch_parser','edit',p_center) is not true then
   raise exception 'Dispatch permission required' using errcode='42501';
 end if;
 if p_date is null or p_revision is null or p_revision < 0 or p_revision >= 2147483647 or p_payload is null
   or jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid draft' using errcode='22023'; end if;
 if p_id is null then
   if p_revision <> 0 then raise exception 'Invalid initial revision' using errcode='PT409'; end if;
   insert into public.dispatch_message_drafts(center_code,business_date,payload) values(p_center,p_date,p_payload) returning * into saved;
 else
   update public.dispatch_message_drafts set business_date=p_date,payload=p_payload,revision=revision+1
    where id=p_id and center_code=p_center and owner_id=auth.uid() and revision=p_revision returning * into saved;
   if not found then raise exception 'Draft changed; reload or save a copy' using errcode='PT409'; end if;
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.save_dispatch_message_draft(uuid,text,date,jsonb,integer) from public,anon;
grant execute on function public.save_dispatch_message_draft(uuid,text,date,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
commit;
