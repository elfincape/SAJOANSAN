begin;
create or replace function public.operations_master_dispatch() returns bigint language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare credential text;queued bigint;previous record;reply record;pending boolean;closed_month text;started timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('operations-master-dispatch',0));
 select * into previous from public.operations_automation_state where name='master-backup-dispatch';
 if previous.request_id is not null then
  select status_code,timed_out into reply from net._http_response where id=previous.request_id;
  if found and reply.status_code=200 and not coalesce(reply.timed_out,false) then
   update public.operations_automation_state set last_error=null,last_success_at=now() where name='master-backup-dispatch';
  elsif found then
   update public.operations_automation_state set last_error='원본 보관 요청 실패 · HTTP '||coalesce(reply.status_code::text,'시간 초과') where name='master-backup-dispatch';
  elsif previous.last_attempt_at>now()-interval '3 minutes' then return null;end if;
 end if;
 closed_month:=to_char((now() at time zone 'Asia/Seoul')-interval '1 month','YYYY-MM');
 select min(captured_at) into started from public.operations_master_backups;
 if started is not null and started<(date_trunc('month',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
  and not exists(select 1 from public.operations_master_backups where period=closed_month) then
  insert into public.operations_notifications(user_id,title,reason_key)
   select id,closed_month||' 월말 운영 원본 누락 · 원본 보관 화면 확인','backup:missing:'||closed_month from public.user_profiles where active and role='admin' on conflict do nothing;
 end if;
 update public.operations_notifications n set title=b.file_name||' OneDrive 저장 복구 완료 · 원본 보관 화면에서 확인'
  from public.operations_master_backups b where b.status='saved' and n.reason_key='backup:failed:'||b.id::text
  and n.title<>b.file_name||' OneDrive 저장 복구 완료 · 원본 보관 화면에서 확인';
 insert into public.operations_notifications(user_id,title,reason_key)
  select p.id,b.file_name||' OneDrive 저장 실패 · 원본 보관 화면에서 확인','backup:failed:'||b.id::text
  from public.operations_master_backups b cross join public.user_profiles p where b.status='failed' and p.active and p.role='admin' on conflict do nothing;
 select exists(select 1 from public.operations_master_backups where status<>'saved') into pending;
 if not pending then return null;end if;
 select decrypted_secret into credential from vault.decrypted_secrets where name='notion_health_cron_key';
 if credential is null then raise exception '기존 서버 예약 실행 인증 설정이 없습니다';end if;
 select net.http_post(url:='https://vvrppotrnpwrwpwqaiet.supabase.co/functions/v1/onedrive-auth/backups-scheduled',
  headers:=jsonb_build_object('Content-Type','application/json','apikey',credential,'Authorization','Bearer '||credential),body:='{}'::jsonb,timeout_milliseconds:=120000) into queued;
 insert into public.operations_automation_state(name,request_id,attempts) values('master-backup-dispatch',queued,1)
 on conflict(name) do update set request_id=queued,last_attempt_at=now(),attempts=operations_automation_state.attempts+1;
 return queued;
end $$;
revoke all on function public.operations_master_dispatch() from public,anon,authenticated,service_role;
select cron.schedule('operations-master-monthly-original','59 14 28-31 * *','select public.operations_master_capture(false); select public.operations_master_dispatch();');
select cron.schedule('operations-master-backup-retry','*/5 * * * *','select public.operations_master_dispatch();');
notify pgrst,'reload schema';
commit;
