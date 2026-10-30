-- capture-shortlist-v1: API evidence is written only by the authenticated server function.
alter table public.naver_browser_jobs add column if not exists shortlist_job_id uuid references public.naver_api_jobs(id);
alter table public.naver_browser_jobs add column if not exists candidate_plans jsonb not null default '{}'::jsonb check(jsonb_typeof(candidate_plans)='object');
create or replace function public.naver_capture_shortlist_enqueue(p_center text,p_courses jsonb,p_validation_job uuid,p_shortlist_job uuid,p_previous_job uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare api public.naver_api_jobs;job uuid;c jsonb;source_course jsonb;plan jsonb;pending jsonb;prior_result jsonb;selected jsonb:='[]'::jsonb;plans jsonb:='{}'::jsonb;begin
 -- capture-shortlist-v1
 if auth.uid() is null or p_center is null or p_center not in ('001','002') or public.operations_resource_allowed('delivery_points','read',p_center) is not true then raise exception '해당 센터 납품처 조회 권한이 없습니다.';end if;
 select * into api from public.naver_api_jobs where id=p_shortlist_job and owner_id=auth.uid() and center_code=p_center and status in ('completed','attention') and state->>'kind'='capture-shortlist' and state->>'validationJob'=p_validation_job::text;
 if not found then raise exception '같은 주소 검증 작업의 API 후보 선정을 먼저 완료해 주세요.';end if;
 job:=public.naver_capture_validated_enqueue(p_center,p_courses,p_validation_job,p_previous_job);
 select addresses into pending from public.naver_browser_jobs where id=job;
 for c in select value from jsonb_array_elements(p_courses) loop
  if not pending @> jsonb_build_array(c->>'id') then continue;end if;
  source_course:=null;
  select value into source_course from jsonb_array_elements(api.state->'courses') where value->>'id'=c->>'id';
  plan:=api.state->'shortlists'->(c->>'id');
  if source_course->>'name'=c->>'name' and coalesce(source_course->>'rotation','0')=coalesce(c->>'rotation','0') and source_course->'stops'=c->'stops'
   and plan->>'policy'='naver-directed-leg-meter-shortlist-v2' and plan->>'scoreScope'='center-through-deliveries' and plan->>'completeMatrix'='true' and plan->>'globalMinimumGuaranteed'='false' and plan->>'webEligible'='true' and jsonb_typeof(plan->'candidates')='array' and jsonb_array_length(plan->'candidates') between 1 and 3
   and jsonb_typeof(plan->'timestamps')='array' and not exists(select 1 from jsonb_array_elements(plan->'timestamps') t where t->>'measuredAt' is null or (t->>'measuredAt')::timestamptz not between clock_timestamp()-interval '30 minutes' and clock_timestamp()) then
   plans:=plans||jsonb_build_object(c->>'id',plan);
   select h.results->(c->>'id') into prior_result from public.naver_browser_jobs h where h.owner_id=auth.uid() and h.center_code=p_center and h.kind='capture' and h.status not in ('queued','running') and h.candidate_plans->(c->>'id')=plan
    and (h.results->(c->>'id')->>'imagePath' is not null or h.results->(c->>'id')->'optimization'->>'policy'='naver-api-top3-web-meters-v1')
    and exists(select 1 from jsonb_array_elements(h.courses) old where old->>'id'=c->>'id' and old->>'name'=c->>'name' and old->'stops'=c->'stops' and coalesce(old->>'rotation','0')=coalesce(c->>'rotation','0')) order by h.created_at desc limit 1;
   if found then update public.naver_browser_jobs set results=results||jsonb_build_object(c->>'id',prior_result) where id=job;end if;
   if prior_result->>'imagePath' is null then selected:=selected||jsonb_build_array(c->>'id');end if;
  else
   update public.naver_browser_jobs set results=results||jsonb_build_object(c->>'id',coalesce(results->(c->>'id'),'{}'::jsonb)||jsonb_build_object('issue','API 후보 선정 미완료: 현재 코스의 행렬과 후보를 확인해 주세요.')) where id=job;
  end if;
 end loop;
 update public.naver_browser_jobs set shortlist_job_id=p_shortlist_job,candidate_plans=plans,addresses=selected,status=case when jsonb_array_length(selected)=0 then 'completed' else 'queued' end where id=job;
 return job;
end $$;
revoke all on function public.naver_capture_shortlist_enqueue(text,jsonb,uuid,uuid,uuid) from public,anon;
grant execute on function public.naver_capture_shortlist_enqueue(text,jsonb,uuid,uuid,uuid) to authenticated;
