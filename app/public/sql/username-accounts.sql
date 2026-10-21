begin;
alter table public.user_profiles add column if not exists username text;
create unique index if not exists user_profiles_username_unique on public.user_profiles (lower(username)) where username is not null;
alter table public.user_profiles drop constraint if exists user_profiles_username_format;
alter table public.user_profiles add constraint user_profiles_username_format check (username is null or username ~ '^[a-z0-9가-힣][a-z0-9가-힣_.-]{2,31}$');
create or replace function public.account_login_email(p_username text) returns text
language sql stable security definer set search_path='' as $$
select u.email from public.user_profiles p join auth.users u on u.id=p.id
where lower(p.username)=lower(p_username) and p.active=true limit 1;
$$;
revoke all on function public.account_login_email(text) from public,anon,authenticated;
grant execute on function public.account_login_email(text) to service_role;
create table if not exists public.account_login_limits (
 key text primary key, window_start timestamptz not null, attempts integer not null);
alter table public.account_login_limits enable row level security;
revoke all on public.account_login_limits from anon,authenticated;
create or replace function public.account_login_attempt(p_keys text[]) returns boolean
language plpgsql security definer set search_path='' as $$
declare k text; n integer; allowed boolean=true;
begin
 foreach k in array p_keys loop
  insert into public.account_login_limits as l(key,window_start,attempts) values(k,now(),1)
  on conflict(key) do update set
   attempts=case when l.window_start < now()-interval '5 minutes' then 1 else l.attempts+1 end,
   window_start=case when l.window_start < now()-interval '5 minutes' then now() else l.window_start end
  returning attempts into n;
  if n>20 then allowed=false; end if;
 end loop;
 delete from public.account_login_limits where window_start < now()-interval '1 day';
 return allowed;
end;
$$;
revoke all on function public.account_login_attempt(text[]) from public,anon,authenticated;
grant execute on function public.account_login_attempt(text[]) to service_role;
commit;
