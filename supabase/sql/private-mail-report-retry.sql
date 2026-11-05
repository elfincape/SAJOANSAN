-- Bounded OneNote retries in existing mailbox JSON; no record rewrites.
begin;
create or replace function public.private_mail_briefing_save(p_box uuid,p_day date,p_lease uuid,p_value jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; page jsonb; d text=p_day::text;
begin
 if jsonb_typeof(p_value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_value) k
 where k not in ('pageId','managedHash','fingerprint','createAttempted','pendingWrite','imageProgress','error','notBefore','retryAttempts','retryHold','hold'))
 or octet_length(p_value::text)>8192 then raise exception 'BRIEFING_VALUE'; end if;
 if p_value ? 'retryAttempts' and (jsonb_typeof(p_value->'retryAttempts') is distinct from 'number' or (p_value->>'retryAttempts') !~ '^[0-3]$') then raise exception 'BRIEFING_VALUE'; end if;
 if exists(select 1 from jsonb_each(p_value) pair where pair.key in ('hold','retryHold') and jsonb_typeof(pair.value) is distinct from 'boolean') then raise exception 'BRIEFING_VALUE'; end if;
 select * into b from public.private_mailboxes where id=p_box for update;page=b.briefing_pages->d;
 if page->>'lease' is distinct from p_lease::text or page->>'leaseUntil' is null
 or (page->>'leaseUntil')::timestamptz<=clock_timestamp() or not public.private_mail_report_allowed(p_box,p_day) then return false; end if;
 update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page||p_value) where id=p_box;return true;
end; $$;


create or replace function public.private_mail_briefing_retry(p_box uuid,p_user uuid,p_day date)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; page jsonb; d text=p_day::text;
begin
 select * into b from public.private_mailboxes where id=p_box for update; page=b.briefing_pages->d;
 if not public.private_mail_manual_allowed(p_box,p_user) or p_day is null or page is null
 or page->>'retryHold' is distinct from 'true' or page->>'ownerPreviewHold'='true'
 or coalesce((page->>'leaseUntil')::timestamptz,'-infinity')>clock_timestamp() then return false; end if;
 page=page||jsonb_build_object('retryAttempts',0,'retryHold',false,'hold',false,'error',null,'notBefore',null,'dirty',true);
 update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page) where id=p_box;
 return true;
end; $$;
revoke all on function public.private_mail_briefing_retry(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.private_mail_briefing_retry(uuid,uuid,date) to service_role;

commit;
