-- OPTIONAL LOCAL DRAFT: do not execute while manual POP collection is active.
-- Requires existing pg_net, pg_cron and Vault extensions, and the existing scoped
-- collector key stored by its owner under Vault NAME private_mail_collector_key.
-- This file neither creates/rotates credentials nor enables mailbox automation.
begin;
-- Narrow definer: reads one fixed Vault secret solely to POST to one fixed worker.
-- No secret, headers, response body or request metadata is returned to callers.
create or replace function public.private_mail_dispatch(p_box uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare b public.private_mailboxes; secret text; item record; queued boolean=false; headers jsonb;
begin
 if p_box is distinct from '39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 or not public.private_mail_automation_allowed(p_box) then return false; end if;
 if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then return false; end if;
 select * into b from public.private_mailboxes where id=p_box;
 execute 'select decrypted_secret from vault.decrypted_secrets where name=$1 limit 1'
 into secret using 'private_mail_collector_key';
 if secret is null or length(secret)<16 then return false; end if;
 headers=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret);
 if b.automation_job->>'status' in ('queued','running')
 and not coalesce((b.automation_job->>'stopRequested')::boolean,false)
 and coalesce((b.automation_job->>'notBefore')::timestamptz,'-infinity')<=clock_timestamp()
 and coalesce((b.automation_job->>'leaseUntil')::timestamptz,'-infinity')<=clock_timestamp()
 and coalesce(b.lease_until,'-infinity')<=clock_timestamp() then
  execute 'select net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=250000)'
  using 'https://sajoansan.vercel.app/api/private-mail-worker',headers,
  jsonb_build_object('kind','collect','mailboxId',p_box,'jobId',b.automation_job->>'id');
  queued=true;
 end if;
 if b.automation_config->>'analysisConsent'='true' and b.automation_config->>'analysisConsentAt' is not null then
  for item in select m.id from public.private_mail_messages m where m.mailbox_id=p_box
   and (not m.analysis_excluded or m.analysis_filter_override='include')
   and m.analysis_status in ('pending','failed','processing') and m.analysis_attempts<5
   and m.created_at>=(b.automation_config->>'analysisConsentAt')::timestamptz
   and m.sent_at>=(b.automation_config->>'analysisConsentAt')::timestamptz
   and coalesce(m.analysis_next_at,'-infinity')<=clock_timestamp()
   and coalesce(m.analysis_lease_until,'-infinity')<=clock_timestamp()
   order by m.created_at,m.id limit 5 loop
   execute 'select net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=250000)'
   using 'https://sajoansan.vercel.app/api/private-mail-worker',headers,
   jsonb_build_object('kind','analyze','mailboxId',p_box,'messageId',item.id);
   queued=true;
  end loop;
  for item in select key from jsonb_each(b.briefing_pages) where value->>'dirty'='true'
   and coalesce((value->>'leaseUntil')::timestamptz,'-infinity')<=clock_timestamp()
   and coalesce((value->>'notBefore')::timestamptz,'-infinity')<=clock_timestamp()
   order by key limit 3 loop
   execute 'select net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=250000)'
   using 'https://sajoansan.vercel.app/api/private-mail-worker',headers,
   jsonb_build_object('kind','report','mailboxId',p_box,'day',item.key);
   queued=true;
  end loop;
 end if;
 return queued;
 -- pg_net/Vault failures must never abort the POP publication transaction.
 exception when others then return false;
end; $$;
revoke all on function public.private_mail_dispatch(uuid) from public,anon,authenticated;
grant execute on function public.private_mail_dispatch(uuid) to service_role;
-- Read-only metadata check; never accesses vault.decrypted_secrets or returns credentials.
create or replace function public.private_mail_scheduler_ready()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare has_secret boolean=false; has_job boolean=false; definition text;
begin
 if to_regclass('vault.secrets') is null or to_regclass('cron.job') is null then return false; end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='net' and p.proname='http_post') then return false; end if;
 definition=pg_get_functiondef('public.private_mail_dispatch(uuid)'::regprocedure);
 if position('https://sajoansan.vercel.app/api/private-mail-worker' in definition)=0
 or position('private_mail_collector_key' in definition)=0
 or position('net.http_post' in definition)=0 then return false; end if;
 -- vault.secrets.secret is ciphertext; this verifies stored metadata, never key validity.
 execute 'select exists(select 1 from vault.secrets where name=$1 and octet_length(secret)>16)'
 into has_secret using 'private_mail_collector_key';
 execute 'select exists(select 1 from cron.job where jobname=$1 and active and command=$2)'
 into has_job using 'private-mail-recovery','select public.private_mail_automation_tick()';
 return has_secret and has_job;
 exception when others then return false;
end; $$;
revoke all on function public.private_mail_scheduler_ready() from public,anon,authenticated;
grant execute on function public.private_mail_scheduler_ready() to service_role;
-- Recovery for unacknowledged dispatch, expired leases and due analysis/report retries.
select cron.schedule('private-mail-recovery','* * * * *','select public.private_mail_automation_tick()');
commit;
