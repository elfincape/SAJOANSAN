-- Continue the exact owner-approved frozen job; never rebuild its candidate plan or discard progress.
create or replace function public.naver_capture_resume(p_job uuid,p_center text,p_courses jsonb,p_strategy text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.naver_browser_jobs;pending jsonb;
begin
 if auth.uid() is null or public.operations_resource_allowed('delivery_points','read',p_center) is not true then raise exception '센터 납품처 열람 권한이 없습니다.';end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select * into j from public.naver_browser_jobs where id=p_job and owner_id=auth.uid() and center_code=p_center and kind='capture' for update;
 if not found then raise exception '저장된 본인 캡처 작업을 확인해 주세요.';end if;
 if j.courses is distinct from p_courses or p_strategy not in ('api3','full') or p_strategy is null
  or (p_strategy='api3') is distinct from (j.shortlist_job_id is not null) then raise exception '입력 또는 비교 방식이 변경되었습니다. 현재 입력으로 검증·계산해 주세요.';end if;
 if j.status='queued' or (j.status='running' and j.updated_at>=clock_timestamp()-interval '5 minutes') then return j.id;end if;
 select coalesce(jsonb_agg(a.value order by a.ordinality),'[]') into pending from jsonb_array_elements(j.addresses) with ordinality a(value,ordinality)
 where not(coalesce(length(j.results->(a.value#>>'{}')->>'imagePath')>0,false)
  and coalesce(j.results->(a.value#>>'{}')->'optimization'->>'complete'='true',false)
  and coalesce(j.results->(a.value#>>'{}')->'optimization'->>'completed'=j.results->(a.value#>>'{}')->'optimization'->>'total',false)
  and coalesce(jsonb_array_length(j.results->(a.value#>>'{}')->'optimization'->'failed')=0,false));
 if jsonb_array_length(pending)=0 then return j.id;end if;
 if (select count(*) from public.naver_browser_jobs where owner_id=auth.uid() and id<>j.id and status in ('queued','running'))>=2 then raise exception '진행 중인 서버 작업을 완료하거나 중지해 주세요.';end if;
 update public.naver_browser_jobs set addresses=pending,cursor=0,status='queued',worker_id=null,updated_at=clock_timestamp() where id=j.id;
 return j.id;
end $$;
revoke all on function public.naver_capture_resume(uuid,text,jsonb,text) from public,anon;
grant execute on function public.naver_capture_resume(uuid,text,jsonb,text) to authenticated;
