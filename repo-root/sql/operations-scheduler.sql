begin;
alter table public.operations_notifications alter column event_id drop not null;
alter table public.operations_notifications add column reason_key text;
create unique index operations_notification_reason on public.operations_notifications(user_id,reason_key) where reason_key is not null;
create table public.operations_automation_state(
 name text primary key,last_attempt_at timestamptz not null default now(),last_success_at timestamptz,last_error text,
 attempts integer not null default 0
);
alter table public.operations_automation_state enable row level security;
create policy operations_automation_hq on public.operations_automation_state for select to authenticated
 using(exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin'));
revoke all on public.operations_automation_state from public,anon,authenticated;
grant select on public.operations_automation_state to authenticated;

create function public.operations_validate_schedule() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare owner jsonb;
begin
 if new.spec ? 'owner_ids' then
  if jsonb_typeof(new.spec->'owner_ids')<>'array' then raise exception '반복 담당자를 확인해 주세요' using errcode='22023'; end if;
  for owner in select value from jsonb_array_elements(new.spec->'owner_ids') loop
   if not exists(select 1 from public.user_profiles p where p.id=(owner#>>'{}')::uuid and p.active and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p.id and m.center_code=new.center_code)))) then
    raise exception '반복 담당자의 센터 권한을 확인해 주세요' using errcode='22023'; end if;
  end loop;
 end if;
 if (new.spec ? 'due_time' and new.spec->>'due_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  or (new.spec ? 'cj_share_time' and new.spec->>'cj_share_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception '마감시간을 확인해 주세요' using errcode='22023'; end if;
 return new;
end $$;
create trigger operations_template_schedule before insert or update on public.operations_templates for each row execute function public.operations_validate_schedule();
create function public.operations_template_deadlines() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.template_snapshot->'spec' ? 'due_time' then new.due_at:=(new.work_date+(new.template_snapshot->'spec'->>'due_time')::time) at time zone 'Asia/Seoul';end if;
 if new.template_snapshot->'spec' ? 'cj_share_time' then new.cj_share_due_at:=(new.work_date+(new.template_snapshot->'spec'->>'cj_share_time')::time) at time zone 'Asia/Seoul';end if;
 return new;
end $$;
create trigger operations_task_template_deadlines before insert on public.operations_tasks for each row execute function public.operations_template_deadlines();

create function public.operations_run_scheduler() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare template public.operations_templates; owner jsonb; today date:=(now() at time zone 'Asia/Seoul')::date;
 old_sub text:=current_setting('request.jwt.claim.sub',true);old_claims text:=current_setting('request.jwt.claims',true);
 total integer:=0; failed integer:=0; t public.operations_tasks; name_key text;
begin
 perform pg_advisory_xact_lock(hashtextextended('operations-scheduler',0));
 for template in select x.* from (select distinct on(family_id) * from public.operations_templates where status in ('approved','retired')
  and coalesce((spec->>'effective_from')::date,(approved_at at time zone 'Asia/Seoul')::date)<=today order by family_id,version desc) x
  where x.status='approved' and coalesce(x.spec->'repeat'->>'kind','none')<>'none' and jsonb_array_length(coalesce(x.spec->'owner_ids','[]'))>0 loop
  name_key:='repeat:'||template.id::text;
  begin
   if not exists(select 1 from public.user_profiles where id=template.approved_by and active and role='admin') then raise exception '양식 승인자의 HQ 권한을 확인해 주세요'; end if;
   if not (template.spec->'repeat'->>'kind'='daily' or (template.spec->'repeat'->>'kind'='weekdays' and template.spec->'repeat'->'days' @> to_jsonb(array[extract(isodow from today)::integer]))
    or (template.spec->'repeat'->>'kind'='monthly' and extract(day from today)::integer=(template.spec->'repeat'->>'day')::integer)
    or (template.spec->'repeat'->>'kind'='once' and today=(template.spec->'repeat'->>'date')::date)) then continue; end if;
   perform set_config('request.jwt.claim.sub',template.approved_by::text,true);
   perform set_config('request.jwt.claims',jsonb_build_object('sub',template.approved_by)::text,true);
   for owner in select value from jsonb_array_elements(template.spec->'owner_ids') loop
    t:=public.operations_task_from_template(gen_random_uuid(),template.id,today,'{}',(owner#>>'{}')::uuid,true);total:=total+1;
   end loop;
   insert into public.operations_automation_state(name,last_success_at,attempts) values(name_key,now(),1)
    on conflict(name) do update set last_attempt_at=now(),last_success_at=now(),last_error=null,attempts=operations_automation_state.attempts+1;
  exception when others then
   failed:=failed+1;
   insert into public.operations_automation_state(name,last_error,attempts) values(name_key,left(sqlerrm,500),1)
    on conflict(name) do update set last_attempt_at=now(),last_error=excluded.last_error,attempts=operations_automation_state.attempts+1;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,'{}'),true);
 insert into public.operations_notifications(user_id,title,task_id,reason_key)
 select recipient.id,'CJ 공유 마감 확인: '||t.title,t.id,'cj:'||t.id::text||':'||t.cj_share_due_at::text
 from public.operations_tasks t join public.user_profiles recipient on recipient.active and (recipient.id=t.owner_id or recipient.role='admin')
 where t.status in ('pending','in_progress') and t.cj_share_due_at<=now()+interval '1 hour'
 and coalesce(t.inputs->>'cj_shared','false')<>'true'
 on conflict(user_id,reason_key) where reason_key is not null do nothing;
 return jsonb_build_object('checked',total,'failed',failed);
end $$;
revoke all on function public.operations_validate_schedule(),public.operations_template_deadlines(),public.operations_run_scheduler() from public,anon,authenticated;
grant execute on function public.operations_run_scheduler() to service_role;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('operations-recurring-and-deadlines','* * * * *','select public.operations_run_scheduler();');
notify pgrst,'reload schema';
commit;
