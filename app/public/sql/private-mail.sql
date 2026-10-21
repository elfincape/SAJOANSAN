-- Apply only after owner UUID, private OneDrive folder and initial range approval.
begin;
create table if not exists public.private_mailboxes (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 account text not null check (account = 'jhs96@eangroup.kr'),
 drive_id text not null, folder_id text not null,
 enabled boolean not null default false,
 initial_days integer not null default 60 check(initial_days between 1 and 3650),
 cutoff_at timestamptz,
 scan_cursor text check(scan_cursor ~ '^[0-9a-f]{64}$'),
 status text not null default 'disabled' check(status in ('disabled','running','ready','error')),
 last_started_at timestamptz, last_success_at timestamptz,
 last_error text check(last_error in ('POP_FAILED','SYNC_FAILED','LIMIT_REACHED')),
 last_counts jsonb not null default '{}',
 lease uuid, lease_until timestamptz,
 unique(owner_id,account)
);
create table if not exists public.private_mail_messages (
 id uuid primary key default gen_random_uuid(),
 mailbox_id uuid not null references public.private_mailboxes(id),
 owner_id uuid not null references auth.users(id),
 uidl_hash text not null check(uidl_hash ~ '^[0-9a-f]{64}$'),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 subject text not null check(length(subject)<=500),
 sender text not null check(length(sender)<=500),
 sent_at timestamptz not null,
 files jsonb not null check(jsonb_typeof(files)='array'),
 created_at timestamptz not null default now(),
 unique(mailbox_id,uidl_hash)
);
create index if not exists private_mail_messages_owner_date on public.private_mail_messages(owner_id,sent_at desc,id);
alter table public.private_mailboxes enable row level security;
alter table public.private_mail_messages enable row level security;
revoke all on public.private_mailboxes,public.private_mail_messages from anon,authenticated;
grant select on public.private_mailboxes,public.private_mail_messages to authenticated;
grant all on public.private_mailboxes,public.private_mail_messages to service_role;
create policy private_mailbox_owner on public.private_mailboxes for select to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.active));
create policy private_mail_owner on public.private_mail_messages for select to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.private_mailboxes b where b.id=mailbox_id and b.owner_id=(select auth.uid())));

create or replace function public.private_mail_begin(p_id uuid,p_lease uuid)
returns setof public.private_mailboxes language sql security invoker set search_path='' as $$
 update public.private_mailboxes set lease=p_lease,lease_until=now()+interval '10 minutes',
 status='running',last_started_at=now(),last_error=null,
 cutoff_at=coalesce(cutoff_at,now()-make_interval(days=>initial_days))
 where id=p_id and enabled and (lease_until is null or lease_until<now()) returning *;
$$;
create or replace function public.private_mail_publish(p_id uuid,p_lease uuid,p_uidl text,p_hash text,p_subject text,p_sender text,p_sent timestamptz,p_files jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; result uuid;
begin
 select * into b from public.private_mailboxes where id=p_id for update;
 if b.id is null or not b.enabled or b.lease is distinct from p_lease or b.lease_until<=now() then raise exception 'lease expired'; end if;
 insert into public.private_mail_messages(mailbox_id,owner_id,uidl_hash,content_hash,subject,sender,sent_at,files)
 values(b.id,b.owner_id,p_uidl,p_hash,p_subject,p_sender,p_sent,p_files)
 on conflict(mailbox_id,uidl_hash) do nothing returning id into result;
 return coalesce(result,(select id from public.private_mail_messages where mailbox_id=p_id and uidl_hash=p_uidl));
end;
$$;
revoke all on function public.private_mail_begin(uuid,uuid),public.private_mail_publish(uuid,uuid,text,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.private_mail_begin(uuid,uuid),public.private_mail_publish(uuid,uuid,text,text,text,text,timestamptz,jsonb) to service_role;
commit;
