-- address-prevalidation-v2: reuse the existing owner-scoped browser queue.
alter table public.naver_browser_jobs drop constraint if exists naver_browser_jobs_kind_check;
alter table public.naver_browser_jobs add constraint naver_browser_jobs_kind_check check(kind in ('distance','capture','validation'));
alter table public.naver_browser_jobs add column if not exists validation_job_id uuid references public.naver_browser_jobs(id);

create or replace function public.naver_address_validate_enqueue(p_center text,p_courses jsonb,p_previous_job uuid default null,p_addresses jsonb default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare job uuid; previous public.naver_browser_jobs; queries jsonb; pending jsonb; saved jsonb:='{}'::jsonb; lookup_address text; historical_result jsonb; begin
 -- address-prevalidation-v2
 if auth.uid() is null or p_center is null or p_center not in ('001','002') or public.operations_resource_allowed('delivery_points','read',p_center) is not true then raise exception '센터 납품처 열람 권한이 없습니다.';end if;
 -- The capture RPC validates every course, fixed point, source row and size.
 job:=public.naver_capture_enqueue(p_center,p_courses);
 select jsonb_agg(address order by position) into queries from (
  select trim(s.value#>>'{}') address,min((c.ordinality-1)*8+s.ordinality) position
  from jsonb_array_elements(p_courses) with ordinality c(value,ordinality),jsonb_array_elements(c.value->'stops') with ordinality s(value,ordinality)
  group by trim(s.value#>>'{}')
 ) q;
 if p_previous_job is not null then
  select * into previous from public.naver_browser_jobs where id=p_previous_job and owner_id=auth.uid() and center_code=p_center and kind='validation' and status not in ('queued','running');
  if not found then raise exception '이전 주소 검증 작업을 확인해 주세요.';end if;
  select coalesce(jsonb_object_agg(q.value,previous.results->q.value),'{}'::jsonb) into saved from jsonb_array_elements_text(queries) q where previous.results->q.value->>'query'=q.value;
 end if;
 for lookup_address in select value from jsonb_array_elements_text(queries) loop
  if not (saved ? lookup_address) then
   select h.results->lookup_address into historical_result from public.naver_browser_jobs h
    where h.owner_id=auth.uid() and h.center_code=p_center and h.kind='validation' and h.status not in ('queued','running') and h.results->lookup_address->>'query'=lookup_address order by h.created_at desc limit 1;
   if found then saved:=saved||jsonb_build_object(lookup_address,historical_result);end if;
  end if;
 end loop;
 if p_addresses is not null then
  if jsonb_typeof(p_addresses) is distinct from 'array' then raise exception '재검증할 주소를 확인해 주세요.';end if;
  if exists(select 1 from jsonb_array_elements(p_addresses) a where jsonb_typeof(a)<>'string' or not queries @> jsonb_build_array(trim(a#>>'{}'))) then raise exception '현재 코스에 있는 주소만 검증할 수 있습니다.';end if;
  select coalesce(jsonb_agg(distinct trim(value)), '[]'::jsonb) into p_addresses from jsonb_array_elements_text(p_addresses);
 end if;
 select coalesce(jsonb_agg(q.value),'[]'::jsonb) into pending from jsonb_array_elements_text(queries) q
 where case when p_addresses is null then coalesce(saved->q.value->>'status','')<>'valid' else p_addresses @> jsonb_build_array(q.value) end;
 update public.naver_browser_jobs set kind='validation',origin='코스 주소 검증',addresses=pending,results=saved,status=case when jsonb_array_length(pending)=0 then 'completed' else 'queued' end where id=job;
 return job;
end $$;
revoke all on function public.naver_address_validate_enqueue(text,jsonb,uuid,jsonb) from public,anon;
grant execute on function public.naver_address_validate_enqueue(text,jsonb,uuid,jsonb) to authenticated;

create or replace function public.naver_capture_validated_enqueue(p_center text,p_courses jsonb,p_validation_job uuid,p_previous_job uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare validation public.naver_browser_jobs; previous public.naver_browser_jobs; job uuid; c jsonb; prior_course jsonb; historical_result jsonb; saved jsonb:='{}'::jsonb; pending jsonb:='[]'::jsonb; missing integer; begin
 -- address-prevalidation-v2
 if auth.uid() is null or p_center is null or p_center not in ('001','002') or public.operations_resource_allowed('delivery_points','read',p_center) is not true then raise exception '센터 납품처 열람 권한이 없습니다.';end if;
 select * into validation from public.naver_browser_jobs where id=p_validation_job and kind='validation' and owner_id=auth.uid() and center_code=p_center and status='completed';
 if not found then raise exception '주소 검증을 완료한 뒤 확인된 코스를 실행해 주세요.';end if;
 job:=public.naver_capture_enqueue(p_center,p_courses);
 if p_previous_job is not null then
  select * into previous from public.naver_browser_jobs where id=p_previous_job and kind='capture' and owner_id=auth.uid() and center_code=p_center and status not in ('queued','running');
  if not found then raise exception '이전 캡처 작업을 확인해 주세요.';end if;
 end if;
 for c in select value from jsonb_array_elements(p_courses) loop
  prior_course:=null;
  if p_previous_job is not null then select value into prior_course from jsonb_array_elements(previous.courses) where value->>'id'=c->>'id';end if;
  if prior_course->>'name'=c->>'name' and coalesce(prior_course->>'rotation','0')=coalesce(c->>'rotation','0') and prior_course->'stops'=c->'stops'
   and ((previous.results->(c->>'id')->>'imagePath' is not null and coalesce(previous.results->(c->>'id')->'optimization'->>'policy','')<>'naver-api-top3-web-meters-v1') or (previous.results->(c->>'id')->'optimization'->>'version'='1' and previous.results->(c->>'id')->'optimization'->>'policy' in ('naver-all-driving-options-v1','naver-all-driving-options-meters-v2'))) then
   saved:=saved||jsonb_build_object(c->>'id',previous.results->(c->>'id'));
  end if;
  if saved->(c->>'id')->>'imagePath' is null then
   select h.results->(c->>'id') into historical_result from public.naver_browser_jobs h
   where h.owner_id=auth.uid() and h.center_code=p_center and h.kind='capture' and h.status not in ('queued','running') and h.results->(c->>'id')->>'imagePath' is not null and coalesce(h.results->(c->>'id')->'optimization'->>'policy','')<>'naver-api-top3-web-meters-v1'
    and exists(select 1 from jsonb_array_elements(h.courses) old where old->>'id'=c->>'id' and old->>'name'=c->>'name' and coalesce(old->>'rotation','0')=coalesce(c->>'rotation','0') and old->'stops'=c->'stops')
   order by h.created_at desc limit 1;
   if found then saved:=saved||jsonb_build_object(c->>'id',historical_result);end if;
  end if;
  if saved->(c->>'id')->>'imagePath' is not null then continue;end if;
  select count(*) into missing from jsonb_array_elements_text(c->'stops') s where
   coalesce(validation.results->trim(s.value)->>'status','')<>'valid'
   or validation.results->trim(s.value)->>'query' is distinct from trim(s.value)
   or jsonb_typeof(validation.results->trim(s.value)->'point') is distinct from 'object';
  if missing=0 then pending:=pending||jsonb_build_array(c->>'id');
  else saved:=saved||jsonb_build_object(c->>'id',coalesce(saved->(c->>'id'),'{}'::jsonb)||jsonb_build_object('issue','주소 검증 미완료: 주소 검증 표에서 이 호차의 미확인 주소를 확인해 주세요.','addressValidationBlocked',true));end if;
 end loop;
 update public.naver_browser_jobs set addresses=pending,results=saved,validation_job_id=p_validation_job,status=case when jsonb_array_length(pending)=0 then 'completed' else 'queued' end where id=job;
 return job;
end $$;
revoke all on function public.naver_capture_validated_enqueue(text,jsonb,uuid,uuid) from public,anon;
grant execute on function public.naver_capture_validated_enqueue(text,jsonb,uuid,uuid) to authenticated;
