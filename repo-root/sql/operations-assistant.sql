-- 운영 질의도우미 센터 접근 권한. 원본 운영 테이블은 변경하지 않는다.
create table if not exists public.user_center_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  center_code text not null references public.centers(code) on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, center_code),
  constraint user_center_access_center_code_check check (center_code in ('001','002'))
);
alter table public.user_center_access enable row level security;
drop policy if exists user_center_access_read_own on public.user_center_access;
create policy user_center_access_read_own on public.user_center_access for select to authenticated using (user_id=auth.uid());
-- 현재 앱은 센터별 사용자 권한이 없고 모든 활성 사용자가 두 센터를 선택할 수 있으므로 현행 권한을 보존해 초기 배정한다.
insert into public.user_center_access(user_id,center_code)
select p.id,c.code from public.user_profiles p cross join public.centers c
where p.active=true and c.code in ('001','002') on conflict do nothing;
notify pgrst,'reload schema';
