-- ISOLATED DEVELOPMENT ONLY. No operating activation or private template seed is included.
begin;
alter table public.operations_templates alter column center_code drop not null;
alter table public.operations_templates add constraint monthly_private_template_scope check(center_code is not null or spec ? 'personal_monthly');

create or replace function public.private_mail_monthly_template_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb;
begin
 if exists(select 1 from public.operations_templates sibling where sibling.family_id=new.family_id and sibling.id<>new.id
  and ((sibling.spec ? 'personal_monthly') is distinct from (new.spec ? 'personal_monthly')
   or (sibling.spec ? 'personal_monthly' and sibling.spec->'personal_monthly'->>'ownerId' is distinct from new.spec->'personal_monthly'->>'ownerId'))) then raise exception 'MONTHLY_FAMILY';end if;
 if tg_op='UPDATE' and old.spec ? 'personal_monthly' and not(new.spec ? 'personal_monthly') then raise exception 'MONTHLY_SOURCE';end if;
 if not(new.spec ? 'personal_monthly') then return new;end if;
 c=new.spec->'personal_monthly';
 if jsonb_typeof(c) is distinct from 'object' or c->>'ownerId' is distinct from '2a828c2d-9a6f-40d4-8e13-336b591811cc'
 or (auth.uid() is not null and auth.uid()::text<>c->>'ownerId') or new.created_by::text<>c->>'ownerId'
 or (new.approved_by is not null and new.approved_by::text<>c->>'ownerId') then raise exception 'MONTHLY_OWNER';end if;
 if new.center_code is not null or new.spec->'owner_ids' is distinct from jsonb_build_array(c->>'ownerId')
 or new.spec->'repeat'->>'kind' is distinct from 'monthly' or coalesce(new.spec->'repeat'->>'day','') !~ '^([1-9]|[12][0-9]|3[01])$'
 or c->'leadDays' is distinct from '3'::jsonb or coalesce(c->>'qualifier','') not in ('on','before')
 or coalesce(c->>'targetPeriod','') not in ('','previous_second_half','current_first_half')
 or nullif(btrim(c->>'originalSchedule'),'') is null or length(c->>'originalSchedule')>500
 or c->'source'->>'kind' is distinct from 'onenote' or nullif(btrim(c->'source'->>'pageId'),'') is null or length(c->'source'->>'pageId')>500
 or coalesce(new.spec->>'effective_from','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or new.spec ?| array['due_time','cj_share_time'] then raise exception 'MONTHLY_TEMPLATE';end if;
 perform (new.spec->>'effective_from')::date;
 return new;
end $$;
create trigger operations_monthly_template_guard before insert or update on public.operations_templates for each row execute function public.private_mail_monthly_template_guard();
create policy monthly_private_templates on public.operations_templates as restrictive for select to authenticated
 using(not(spec ? 'personal_monthly') or spec->'personal_monthly'->>'ownerId'=auth.uid()::text);
create policy monthly_private_tasks on public.operations_tasks as restrictive for select to authenticated
 using(not(inputs ? 'personal_monthly') or owner_id=auth.uid());
create policy monthly_private_events on public.operations_task_events as restrictive for select to authenticated
 using((coalesce(after_value#>>'{inputs,personal_monthly,ownerId}',before_value#>>'{inputs,personal_monthly,ownerId}') is null or coalesce(after_value#>>'{inputs,personal_monthly,ownerId}',before_value#>>'{inputs,personal_monthly,ownerId}')=auth.uid()::text)
 and (coalesce(after_value#>>'{spec,personal_monthly,ownerId}',before_value#>>'{spec,personal_monthly,ownerId}') is null or coalesce(after_value#>>'{spec,personal_monthly,ownerId}',before_value#>>'{spec,personal_monthly,ownerId}')=auth.uid()::text));

create or replace function public.private_mail_monthly_task_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare template public.operations_templates;c jsonb; scheduled date; visible date; target jsonb; marker jsonb;
begin
 if tg_op='DELETE' then if old.inputs ? 'personal_monthly' then raise exception 'MONTHLY_KEEP_HISTORY';end if;return old;end if;
 if tg_op='UPDATE' and old.inputs ? 'personal_monthly' then
  if (auth.uid() is not null and auth.uid()<>old.owner_id) or new.owner_id<>old.owner_id then raise exception 'MONTHLY_OWNER';end if;
  if new.inputs->'personal_monthly' is distinct from old.inputs->'personal_monthly' or new.template_id is distinct from old.template_id
   or new.template_snapshot is distinct from old.template_snapshot or new.work_date<>old.work_date then raise exception 'MONTHLY_SOURCE';end if;
  return new;
 end if;
 if not(new.template_snapshot->'spec' ? 'personal_monthly') then
  if new.inputs ? 'personal_monthly' then raise exception 'MONTHLY_SOURCE';end if;return new;
 end if;
 select * into template from public.operations_templates where id=new.template_id;
 if not found or template.status<>'approved' or new.template_snapshot is distinct from to_jsonb(template) then raise exception 'MONTHLY_SOURCE';end if;
 c=template.spec->'personal_monthly';
 if new.owner_id::text<>c->>'ownerId' or new.created_by<>new.owner_id or (auth.uid() is not null and auth.uid()<>new.owner_id) then raise exception 'MONTHLY_OWNER';end if;
 scheduled=new.work_date;
 if new.occurrence_key is distinct from template.family_id::text||':monthly:'||to_char(scheduled,'YYYY-MM')||':'||new.owner_id::text then raise exception 'MONTHLY_OCCURRENCE';end if;
 if extract(day from scheduled)::integer<>(template.spec->'repeat'->>'day')::integer or scheduled<(template.spec->>'effective_from')::date then raise exception 'MONTHLY_DATE';end if;
 visible=scheduled-3;
 target=case c->>'targetPeriod' when 'previous_second_half' then jsonb_build_object('from',(date_trunc('month',scheduled)-interval '1 month')::date+15,'through',date_trunc('month',scheduled)::date-1)
  when 'current_first_half' then jsonb_build_object('from',date_trunc('month',scheduled)::date,'through',date_trunc('month',scheduled)::date+14) else 'null'::jsonb end;
 new.center_code=null;new.work_scope='delivery_team';new.work_date=visible;new.work_end_date=visible;new.due_at=null;
 new.inputs=jsonb_set(new.inputs,'{personal_monthly}',jsonb_build_object('ownerId',new.owner_id,'familyId',template.family_id,'scheduledMonth',to_char(scheduled,'YYYY-MM'),'scheduledDate',scheduled,'visibleFrom',visible,'qualifier',c->>'qualifier','originalSchedule',c->>'originalSchedule','targetPeriod',target,'source',c->'source'));
 marker=jsonb_build_object('schema','sajo-daily-work-v1','workId','source:'||new.id::text,'ownerId',new.owner_id,'scope',jsonb_build_object('kind','delivery_team','centerCode',null,'workCategory',null),'sourceKeys',jsonb_build_array('source:'||new.id::text),
  'category','task','reportKind',null,'status','pending','summary','[]'::jsonb,'nextAction',null,'progress',null,'waitingFor',null,'customer',null,'requester',null,'requestedAt',new.created_at,'dueDate',null,'serviceDate',null,'needsConfirmation',false,'ownerStateAt',null,'inferredStateAt',null,'verifiedCompletionAt',null,'closedAt',null,'ownerFields',jsonb_build_array('title'));
 new.inputs=jsonb_set(new.inputs,'{personal_work}',marker);
 return new;
end $$;
create trigger operations_monthly_task_guard before insert or update or delete on public.operations_tasks for each row execute function public.private_mail_monthly_task_guard();

create or replace function public.private_mail_monthly_notification_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.operations_tasks where id=new.task_id and inputs ? 'personal_monthly' and owner_id<>new.user_id) then return null;end if;return new;
end $$;
create trigger operations_monthly_notification_guard before insert or update on public.operations_notifications for each row execute function public.private_mail_monthly_notification_guard();

do $patch$
declare source text;before_key text:='occurrence:=template.family_id::text||'':''||p_work_date::text||'':''||owner::text;';
begin
 source:=pg_get_functiondef('public.operations_task_from_template(uuid,uuid,date,jsonb,uuid,boolean)'::regprocedure);
 if position(before_key in source)=0 or position('body:=jsonb_build_object(''operation'',''from_template'',' in source)=0 then raise exception 'MONTHLY_NATIVE_CONTRACT';end if;
 source:=replace(source,'body:=jsonb_build_object(''operation'',''from_template'',','if template.spec ? ''personal_monthly'' and (auth.uid()::text is distinct from template.spec->''personal_monthly''->>''ownerId'' or owner::text is distinct from template.spec->''personal_monthly''->>''ownerId'') then raise exception ''MONTHLY_OWNER'';end if; if template.spec ? ''personal_monthly'' and not p_recurring then raise exception ''MONTHLY_RECURRING'';end if; body:=jsonb_build_object(''operation'',''from_template'',');
 source:=replace(source,before_key,'occurrence:=case when template.spec ? ''personal_monthly'' then template.family_id::text||'':monthly:''||to_char(p_work_date,''YYYY-MM'')||'':''||owner::text else template.family_id::text||'':''||p_work_date::text||'':''||owner::text end;');execute source;
end $patch$;

create or replace function public.private_mail_generate_monthly(p_now timestamptz default clock_timestamp()) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;template public.operations_templates;t public.operations_tasks;today date:=(p_now at time zone 'Asia/Seoul')::date;scheduled date;occurrence text;created integer:=0;existing integer:=0;failed integer:=0;
 old_sub text:=current_setting('request.jwt.claim.sub',true);old_claims text:=current_setting('request.jwt.claims',true);
begin
 if p_now is null then raise exception 'MONTHLY_DATE';end if;
 if not public.private_mail_manual_allowed('39045005-313e-42e1-b50c-2394b3b6ff26','2a828c2d-9a6f-40d4-8e13-336b591811cc') then return jsonb_build_object('created',0,'existing',0,'disabled',true);end if;
 perform pg_advisory_xact_lock(hashtextextended('personal-monthly:2a828c2d-9a6f-40d4-8e13-336b591811cc',0));
 for r in select distinct on(family_id,month_start) id,month_start,version from (
  select x.id,x.family_id,x.version,m::date month_start,(m::date+(x.spec->'repeat'->>'day')::integer-1) scheduled_date,(x.spec->>'effective_from')::date effective
  from public.operations_templates x cross join lateral generate_series(date_trunc('month',(x.spec->>'effective_from')::date),date_trunc('month',today)+interval '1 month',interval '1 month') m
  where x.spec ? 'personal_monthly' and x.spec->'personal_monthly'->>'ownerId'='2a828c2d-9a6f-40d4-8e13-336b591811cc' and x.status in ('approved','retired')
 ) candidates where date_trunc('month',scheduled_date)::date=month_start and scheduled_date>=effective order by family_id,month_start,version desc loop
  select * into template from public.operations_templates where id=r.id;
  if template.status<>'approved' then continue;end if;
  scheduled=r.month_start+(template.spec->'repeat'->>'day')::integer-1;
  if scheduled-3>today then continue;end if;
  occurrence=template.family_id::text||':monthly:'||to_char(scheduled,'YYYY-MM')||':2a828c2d-9a6f-40d4-8e13-336b591811cc';
  perform pg_advisory_xact_lock(hashtextextended(occurrence,0));
  if exists(select 1 from public.operations_tasks where occurrence_key=occurrence) then existing=existing+1;continue;end if;
  begin
   perform set_config('request.jwt.claim.sub','2a828c2d-9a6f-40d4-8e13-336b591811cc',true);
   perform set_config('request.jwt.claims','{"sub":"2a828c2d-9a6f-40d4-8e13-336b591811cc"}',true);
   t:=public.operations_task_from_template(gen_random_uuid(),template.id,scheduled,'{}','2a828c2d-9a6f-40d4-8e13-336b591811cc',true);created=created+1;
   update public.operations_automation_state set last_success_at=clock_timestamp(),last_error=null where name='personal-monthly:'||occurrence;
  exception when others then
   failed=failed+1;
   insert into public.operations_automation_state(name,last_error,attempts)
   values('personal-monthly:'||occurrence,'MONTHLY_OCCURRENCE_FAILED:'||sqlstate,1)
   on conflict(name) do update set last_attempt_at=clock_timestamp(),last_error=excluded.last_error,attempts=operations_automation_state.attempts+1;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,'{}'),true);
 if failed=0 then update public.operations_automation_state set last_success_at=clock_timestamp(),last_error=null where name='personal-monthly:2a828c2d-9a6f-40d4-8e13-336b591811cc';end if;
 return jsonb_build_object('created',created,'existing',existing,'failed',failed);
end $$;
revoke all on function public.private_mail_monthly_template_guard(),public.private_mail_monthly_task_guard(),public.private_mail_monthly_notification_guard(),public.private_mail_generate_monthly(timestamptz) from public,anon,authenticated;
grant execute on function public.private_mail_generate_monthly(timestamptz) to service_role;

-- Shared HQ AI output/cache must never contain owner-private monthly work, even for its owner.
do $shared_ai$
declare source text;event_filter text;
begin
 if to_regprocedure('public.operations_ai_snapshot()') is null then return;end if;
 source=pg_get_functiondef('public.operations_ai_snapshot()'::regprocedure);
 if position('from public.operations_tasks where' in source)=0 or position('from public.operations_task_events where occurred_at' in source)=0 then raise exception 'MONTHLY_SHARED_AI_CONTRACT';end if;
 source=replace(source,'from public.operations_tasks where','from public.operations_tasks where not(inputs ? ''personal_monthly'') and ');
 event_filter='from public.operations_task_events where not exists(select 1 from public.operations_tasks private_task where private_task.id=operations_task_events.task_id and private_task.inputs ? ''personal_monthly'') and coalesce(after_value#>>''{spec,personal_monthly,ownerId}'',before_value#>>''{spec,personal_monthly,ownerId}'') is null and occurred_at';
 source=replace(source,'from public.operations_task_events where occurred_at',event_filter);
 execute source;
end $shared_ai$;

do $hook$
declare source text;anchor text:='if not (template.spec->''repeat''->>''kind''=''daily''';
begin
 source:=pg_get_functiondef('public.operations_run_scheduler()'::regprocedure);
 if position(anchor in source)=0 or position('perform pg_advisory_xact_lock(hashtextextended(''operations-scheduler'',0));' in source)=0 then raise exception 'MONTHLY_SCHEDULER_CONTRACT';end if;
 source:=replace(source,anchor,'if template.spec ? ''personal_monthly'' then continue;end if; '||anchor);
 source:=replace(source,'perform pg_advisory_xact_lock(hashtextextended(''operations-scheduler'',0));','perform pg_advisory_xact_lock(hashtextextended(''operations-scheduler'',0)); begin perform public.private_mail_generate_monthly(clock_timestamp()); exception when others then insert into public.operations_automation_state(name,last_error,attempts) values(''personal-monthly:2a828c2d-9a6f-40d4-8e13-336b591811cc'',''MONTHLY_SCHEDULER_FAILED:''||sqlstate,1) on conflict(name) do update set last_attempt_at=clock_timestamp(),last_error=excluded.last_error,attempts=operations_automation_state.attempts+1; end;');execute source;
end $hook$;
commit;
