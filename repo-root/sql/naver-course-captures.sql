alter table public.naver_browser_jobs add column if not exists kind text not null default 'distance' check(kind in ('distance','capture'));
alter table public.naver_browser_jobs add column if not exists courses jsonb;
create or replace function public.naver_capture_enqueue(p_center text,p_courses jsonb,p_previous_job uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare job uuid; c jsonb; s jsonb; saved jsonb := '{}'::jsonb; pending jsonb; begin
 if auth.uid() is null or p_center is null or p_center not in ('001','002') or public.operations_resource_allowed('delivery_points','read',p_center) is not true then raise exception '센터 납품처 열람 권한이 없습니다.';end if;
 if jsonb_typeof(p_courses) is distinct from 'array' then raise exception '코스 목록을 확인해 주세요.';end if;
 if jsonb_array_length(p_courses) not between 1 and 100 then raise exception '1~100코스를 입력해 주세요.';end if;
 for c in select value from jsonb_array_elements(p_courses) loop
  if jsonb_typeof(c) is distinct from 'object' or c->>'id' is null or c->>'id' !~ '^row-[0-9]{1,7}$' or jsonb_typeof(c->'name') is distinct from 'string' or length(trim(c->>'name')) not between 1 and 100 or jsonb_typeof(c->'stops') is distinct from 'array' then raise exception '코스 형식을 확인해 주세요.';end if;
  if jsonb_typeof(c->'sourceRow') is distinct from 'number' or c->>'sourceRow' !~ '^[0-9]{1,7}$' or (c->>'sourceRow')::int<1 or c->>'id' <> 'row-'||(c->>'sourceRow') then raise exception '원본 행 번호를 확인해 주세요.';end if;
  if jsonb_array_length(c->'stops') not between 4 and 7 then raise exception '센터 포함 경유지는 2~5곳입니다.';end if;
  for s in select value from jsonb_array_elements(c->'stops') loop
   if jsonb_typeof(s) is distinct from 'string' or length(trim(s#>>'{}')) not between 1 and 300 then raise exception '각 주소는 1~300자로 입력해 주세요.';end if;
  end loop;
  if c->'stops'->>0 is distinct from c->'stops'->>(jsonb_array_length(c->'stops')-1) then raise exception '같은 차고지로 복귀해야 합니다.';end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_courses))<>jsonb_array_length(p_courses) then raise exception '코스 식별자가 중복됩니다.';end if;
 if p_previous_job is not null then
  select coalesce((select jsonb_object_agg(e.key,e.value) from jsonb_each(j.results) e where e.value->>'imagePath' is not null),'{}'::jsonb) into saved
  from public.naver_browser_jobs j where j.id=p_previous_job and j.owner_id=auth.uid() and j.center_code=p_center and j.kind='capture' and j.courses=p_courses and j.status not in ('queued','running');
  if saved is null then raise exception '재시도할 작업을 확인해 주세요.';end if;
 end if;
 select jsonb_agg(value->>'id') into pending from jsonb_array_elements(p_courses) where not(saved ? (value->>'id'));
 if pending is null then raise exception '모든 코스가 완료되었습니다.';end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 if (select count(*) from public.naver_browser_jobs where owner_id=auth.uid() and status in ('queued','running'))>=2 then raise exception '진행 중인 서버 작업을 완료하거나 중지해 주세요.';end if;
 insert into public.naver_browser_jobs(owner_id,center_code,origin,addresses,kind,courses,results)
 values(auth.uid(),p_center,'코스 캡처',pending,'capture',p_courses,saved) returning id into job;
 return job;
end $$;
revoke all on function public.naver_capture_enqueue(text,jsonb,uuid) from public,anon;
grant execute on function public.naver_capture_enqueue(text,jsonb,uuid) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('naver-course-captures','naver-course-captures',false,2097152,array['image/png']) on conflict(id) do nothing;
drop policy if exists naver_capture_owner_read on storage.objects;
create policy naver_capture_owner_read on storage.objects for select to authenticated using(
 bucket_id='naver-course-captures' and (storage.foldername(name))[1]=auth.uid()::text
 and exists(select 1 from public.naver_browser_jobs j where j.id::text=(storage.foldername(name))[2] and j.kind='capture' and j.owner_id=auth.uid() and public.operations_resource_allowed('delivery_points','read',j.center_code))
);
