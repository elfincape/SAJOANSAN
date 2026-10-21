-- 1탑2실 작업: 휴대폰 촬영 사진을 PC에서 이어서 처리하기 위한 임시 저장소
create table if not exists public.one_top_two_room_captures (
  id uuid primary key default gen_random_uuid(),
  center_code text not null,
  user_id uuid not null default auth.uid(),
  filename text not null default 'receipt.jpg',
  image_data text not null,
  analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint one_top_two_room_capture_is_image check (image_data like 'data:image/%')
);

create index if not exists one_top_two_room_captures_owner_center_idx
  on public.one_top_two_room_captures (user_id, center_code, created_at);

alter table public.one_top_two_room_captures enable row level security;

drop policy if exists "one_top_two_room_captures_select_own" on public.one_top_two_room_captures;
create policy "one_top_two_room_captures_select_own" on public.one_top_two_room_captures for select to authenticated using (auth.uid() = user_id);
drop policy if exists "one_top_two_room_captures_insert_own" on public.one_top_two_room_captures;
create policy "one_top_two_room_captures_insert_own" on public.one_top_two_room_captures for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "one_top_two_room_captures_update_own" on public.one_top_two_room_captures;
create policy "one_top_two_room_captures_update_own" on public.one_top_two_room_captures for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "one_top_two_room_captures_delete_own" on public.one_top_two_room_captures;
create policy "one_top_two_room_captures_delete_own" on public.one_top_two_room_captures for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.one_top_two_room_captures to authenticated;
comment on table public.one_top_two_room_captures is '1탑2실 작업용 임시 촬영 사진. 작업 완료 후 사용자가 화면에서 삭제한다.';
notify pgrst, 'reload schema';
