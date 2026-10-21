begin;
create extension if not exists pg_net with schema extensions;
alter table public.operations_automation_state add column if not exists request_id bigint;
create function public.operations_ai_dispatch() returns bigint language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare credential text;queued bigint;today date:=(now() at time zone 'Asia/Seoul')::date;previous_request bigint;reply record;
begin
 perform pg_advisory_xact_lock(hashtextextended('operations-ai-dispatch',0));
 select request_id into previous_request from public.operations_automation_state where name='briefing-dispatch';
 if previous_request is not null then
  select status_code,timed_out into reply from net._http_response where id=previous_request;
  if found and (coalesce(reply.status_code,0)>=400 or coalesce(reply.timed_out,false)) then
   update public.operations_automation_state set last_error='AI 예약 요청 실패 · HTTP '||coalesce(reply.status_code::text,'시간 초과') where name='briefing-dispatch';
  elsif found and reply.status_code=200 then
   update public.operations_automation_state set last_error=null,last_success_at=now() where name='briefing-dispatch';
  end if;
 end if;
 if exists(select 1 from public.operations_ai_results where cache_key='briefing:'||today::text and
  ((status='ready' and generated_at>=(today+time '08:00') at time zone 'Asia/Seoul') or (status='running' and lease_until>now()))) then return null;end if;
 -- Reuse the existing server credential inside Vault; never return it to clients.
 select decrypted_secret into credential from vault.decrypted_secrets where name='notion_health_cron_key';
 if credential is null then raise exception '기존 서버 예약 실행 인증 설정이 없습니다';end if;
 select net.http_post(url:='https://vvrppotrnpwrwpwqaiet.supabase.co/functions/v1/operations-assistant/scheduled-briefing',headers:=jsonb_build_object('Content-Type','application/json','apikey',credential,'Authorization','Bearer '||credential),body:='{"force":true}'::jsonb,timeout_milliseconds:=90000) into queued;
 insert into public.operations_automation_state(name,request_id,attempts) values('briefing-dispatch',queued,1)
 on conflict(name) do update set request_id=queued,last_attempt_at=now(),attempts=operations_automation_state.attempts+1;
 return queued;
end $$;
revoke all on function public.operations_ai_dispatch() from public,anon,authenticated,service_role;
select cron.schedule('operations-hq-ai-briefing','0,5,10,15 23 * * *','select public.operations_ai_dispatch();');
notify pgrst,'reload schema';
commit;
