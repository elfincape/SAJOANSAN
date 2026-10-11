begin;
create table public.operations_ai_results(
 cache_key text primary key,kind text not null check(kind in ('briefing','survey_draft')),
 work_date date not null,survey_id uuid references public.operations_surveys(id),
 fingerprint text not null,status text not null check(status in ('running','ready','failed')),
 body jsonb,lease_id uuid,lease_until timestamptz,last_error text,
 requested_by uuid references public.user_profiles(id),last_attempt_at timestamptz not null default now(),generated_at timestamptz,
 check((kind='survey_draft')=(survey_id is not null))
);
alter table public.operations_ai_results enable row level security;
create policy operations_ai_hq_read on public.operations_ai_results for select to authenticated using(exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin'));
revoke all on public.operations_ai_results from public,anon,authenticated;
grant select(cache_key,kind,work_date,survey_id,fingerprint,status,body,last_error,last_attempt_at,generated_at) on public.operations_ai_results to authenticated;
grant all on public.operations_ai_results to service_role;
create function public.operations_ai_snapshot() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare today date:=(now() at time zone 'Asia/Seoul')::date;day_start timestamptz;previous_start timestamptz;
begin
 if coalesce(auth.role(),'')<>'service_role' and not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then raise exception 'HQ 브리핑 권한이 필요합니다' using errcode='42501';end if;
 day_start:=today::timestamp at time zone 'Asia/Seoul';previous_start:=(today-1)::timestamp at time zone 'Asia/Seoul';
 return jsonb_build_object('date',today,
 'centers',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name) order by code),'[]') from public.centers where active),
 'counts',jsonb_build_object('pending_tasks',(select count(*) from public.operations_tasks where status in ('pending','in_progress') and work_date<=today),'open_incidents',(select count(*) from public.operations_incidents where status='open'),'yesterday_events',(select count(*) from public.operations_task_events where occurred_at>=previous_start and occurred_at<day_start and (task_id is not null or incident_id is not null)),'master_changes',(select count(*) from public.audit_log where changed_at>=previous_start and changed_at<day_start and table_name in ('drivers','vehicles','routes'))),
 'tasks',(select coalesce(jsonb_agg(x order by x.work_date,x.id),'[]') from (select id,center_code,title,owner_id,status,version,work_date,due_at,cj_share_due_at,coalesce(inputs->>'cj_shared','false')='true' as cj_shared from public.operations_tasks where status in ('pending','in_progress') and work_date<=today order by least(due_at,cj_share_due_at) nulls last,work_date,id limit 300)x),
 'incidents',(select coalesce(jsonb_agg(x order by x.id),'[]') from (select id,center_code,title,kind,status,support_state,version,task_id,created_at from public.operations_incidents where status='open' order by case when support_state in ('requested','supporting') then 0 else 1 end,created_at,id limit 200)x),
 'events',(select coalesce(jsonb_agg(x order by x.occurred_at,x.id),'[]') from (select id::text,task_id,incident_id,action,occurred_at,after_value->>'title' as title,after_value->>'center_code' as center_code from public.operations_task_events where occurred_at>=previous_start and occurred_at<day_start and (task_id is not null or incident_id is not null) order by occurred_at desc,id desc limit 300)x),
 'changes',(select coalesce(jsonb_agg(x order by x.changed_at,x.id),'[]') from (select a.id::text,a.table_name,a.row_id,a.action,a.changed_at,coalesce(a.center_code,a.new_data->>'center_code',a.old_data->>'center_code') as center_code,coalesce(a.new_data->>'name',a.old_data->>'name',a.new_data->>'plate_number',a.old_data->>'plate_number','기록 '||a.row_id::text) as title,
 (select coalesce(jsonb_agg(k),'[]') from unnest(case when a.table_name='drivers' then array['name','phone','company_id','center_code','active'] when a.table_name='vehicles' then array['plate_number','tonnage','company_id','center_code','active'] else array['name','car_number','primary_driver_id','secondary_driver_id','primary_vehicle_id','secondary_vehicle_id','closed_days','active','center_code'] end) k where (a.old_data->k) is distinct from (a.new_data->k)) as changed_fields
 from public.audit_log a where changed_at>=previous_start and changed_at<day_start and table_name in ('drivers','vehicles','routes') order by changed_at desc,id desc limit 200)x));
end $$;
create function public.operations_ai_acquire(p_kind text,p_day date,p_survey uuid,p_fingerprint text,p_actor uuid,p_force boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare key_name text;entry public.operations_ai_results;nonce uuid;
begin
 if p_kind is null or p_kind not in ('briefing','survey_draft') or p_day is null or p_fingerprint is null or length(p_fingerprint)<>43
  or (p_kind='survey_draft')<>(p_survey is not null) or (p_kind='survey_draft' and p_actor is null) then raise exception 'AI 요청을 확인해 주세요' using errcode='22023';end if;
 if p_actor is not null and not exists(select 1 from public.user_profiles where id=p_actor and active and role='admin') then raise exception 'HQ 권한이 필요합니다' using errcode='42501';end if;
 if p_survey is not null and not exists(select 1 from public.operations_surveys where id=p_survey) then raise exception '업무조사를 확인해 주세요' using errcode='22023';end if;
 key_name:=case when p_kind='briefing' then 'briefing:'||p_day::text else 'survey:'||p_survey::text end;
 perform pg_advisory_xact_lock(hashtextextended('ai:'||key_name,0));
 select * into entry from public.operations_ai_results where cache_key=key_name for update;
 if found then
  if (entry.status='running' and entry.lease_until>now()) or
   (entry.status='ready' and entry.fingerprint=p_fingerprint and not coalesce(p_force,false)) or
   entry.last_attempt_at>now()-interval '1 minute' then return jsonb_build_object('acquired',false,'entry',to_jsonb(entry)-array['lease_id','lease_until']);end if;
 end if;
 nonce:=gen_random_uuid();
 insert into public.operations_ai_results(cache_key,kind,work_date,survey_id,fingerprint,status,lease_id,lease_until,requested_by)
 values(key_name,p_kind,p_day,p_survey,p_fingerprint,'running',nonce,now()+interval '2 minutes',p_actor)
 on conflict(cache_key) do update set fingerprint=p_fingerprint,status='running',lease_id=nonce,lease_until=now()+interval '2 minutes',requested_by=p_actor,last_attempt_at=now(),last_error=null
 returning * into entry;
 return jsonb_build_object('acquired',true,'lease',nonce,'key',key_name);
end $$;
create function public.operations_ai_finish(p_key text,p_lease uuid,p_body jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_error is null and (p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>131072) then raise exception 'AI 결과 형식을 확인해 주세요' using errcode='22023';end if;
 update public.operations_ai_results set status=case when p_error is null then 'ready' else 'failed' end,
 body=case when p_error is null then p_body else body end,generated_at=case when p_error is null then now() else generated_at end,
 last_error=left(p_error,500),lease_id=null,lease_until=null where cache_key=p_key and lease_id=p_lease;
 return found;
end $$;
revoke all on function public.operations_ai_snapshot() from public,anon;
grant execute on function public.operations_ai_snapshot() to authenticated,service_role;
revoke all on function public.operations_ai_acquire(text,date,uuid,text,uuid,boolean),public.operations_ai_finish(text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.operations_ai_acquire(text,date,uuid,text,uuid,boolean),public.operations_ai_finish(text,uuid,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
