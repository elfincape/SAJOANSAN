create table if not exists public.naver_browser_jobs(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),center_code text not null check(center_code in ('001','002')),
 origin text not null,addresses jsonb not null,status text not null default 'queued' check(status in ('queued','running','completed','cancelled','attention')),
 results jsonb not null default '{}'::jsonb,cursor integer not null default 0,worker_id uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists naver_browser_jobs_queue on public.naver_browser_jobs(status,created_at);
create index if not exists naver_browser_jobs_owner on public.naver_browser_jobs(owner_id,created_at desc);
alter table public.naver_browser_jobs enable row level security;
revoke all on public.naver_browser_jobs from anon,authenticated;
grant select on public.naver_browser_jobs to authenticated;
drop policy if exists naver_browser_owner_read on public.naver_browser_jobs;
create policy naver_browser_owner_read on public.naver_browser_jobs for select to authenticated
 using(owner_id=auth.uid() and public.operations_resource_allowed('delivery_points','read',center_code));
create or replace function public.naver_browser_enqueue(p_center text,p_origin text,p_addresses jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare job uuid;begin
 if auth.uid() is null or p_center is null or p_center not in ('001','002') or public.operations_resource_allowed('delivery_points','read',p_center) is not true then raise exception '센터 납품처 열람 권한이 없습니다.';end if;
 if p_origin is null or length(trim(p_origin)) not between 1 and 300 or jsonb_typeof(p_addresses) is distinct from 'array' then raise exception '출발지와 주소를 확인해 주세요.';end if;
 if jsonb_array_length(p_addresses) not between 1 and 20000 or exists(select 1 from jsonb_array_elements(p_addresses) a where jsonb_typeof(a)<>'string' or length(trim(a#>>'{}')) not between 1 and 300) then raise exception '주소는 1~20,000개, 각 300자 이내로 입력해 주세요.';end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if (select count(*) from public.naver_browser_jobs where owner_id=auth.uid() and status in ('queued','running'))>=2 then raise exception '진행 중인 서버 작업을 완료하거나 중지해 주세요.';end if;
 insert into public.naver_browser_jobs(owner_id,center_code,origin,addresses) values(auth.uid(),p_center,trim(p_origin),p_addresses) returning id into job;return job;
end $$;
revoke all on function public.naver_browser_enqueue(text,text,jsonb) from public,anon;
grant execute on function public.naver_browser_enqueue(text,text,jsonb) to authenticated;
create or replace function public.naver_browser_cancel(p_job uuid) returns void
language plpgsql security definer set search_path=public as $$begin
 update public.naver_browser_jobs set status='cancelled',updated_at=now() where id=p_job and owner_id=auth.uid() and status in ('queued','running');
end $$;
revoke all on function public.naver_browser_cancel(uuid) from public,anon;
grant execute on function public.naver_browser_cancel(uuid) to authenticated;
