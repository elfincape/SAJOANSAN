-- Preserve mailbox delivery, sender date and local collection as separate clocks.
begin;
alter table public.private_mail_messages add column if not exists received_at timestamptz;
alter table public.private_mail_messages alter column report_day set expression as ((coalesce(received_at,sent_at) at time zone 'Asia/Seoul')::date);

create or replace function public.private_mail_analysis_finish(p_message uuid,p_lease uuid,p_analysis jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare m public.private_mail_messages; b public.private_mailboxes; d text; page jsonb; old_day date;
begin
 if jsonb_typeof(p_analysis) is distinct from 'object' or octet_length(p_analysis::text)>65536 then raise exception 'ANALYSIS_VALUE'; end if;
 -- All operations touching both records lock mailbox first, including INSERT trigger.
 select b0.* into b from public.private_mailboxes b0 join public.private_mail_messages m0 on m0.mailbox_id=b0.id where m0.id=p_message for update of b0;
 select * into m from public.private_mail_messages where id=p_message for update;
 if m.id is null or not public.private_mail_analysis_allowed(m.id)
 or m.analysis_lease is distinct from p_lease or m.analysis_status<>'processing'
 or m.analysis_lease_until is null or m.analysis_lease_until<=clock_timestamp() then return false; end if;
 old_day=m.report_day;
 update public.private_mail_messages set analysis=p_analysis,analysis_status='ready',analysis_error=null,
 sent_at=coalesce((p_analysis->'source'->>'sentAt')::timestamptz,sent_at),
 received_at=(p_analysis->'source'->>'receivedAt')::timestamptz,
 analysis_lease=null,analysis_lease_until=null,analysis_next_at=null where id=p_message returning * into m;
 for d in select distinct x::text from unnest(array[m.report_day,old_day]) x where x is not null loop
  if coalesce((b.briefing_pages->d->>'ownerPreviewHold')::boolean,false) then continue; end if;
  page=coalesce(b.briefing_pages->d,'{}'::jsonb);
  page=page||jsonb_build_object('revision',coalesce((page->>'revision')::integer,0)+1,'dirty',true);
  update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page) where id=b.id returning * into b;
 end loop;
 perform public.private_mail_dispatch_clear(b.id,'analyze',p_message::text);
 perform public.private_mail_dispatch(b.id);return true;
end; $$;

-- Rebuild already-published former collection-day outputs; do not create historical
-- pages or change held previews/user memo regions.
update public.private_mailboxes b set briefing_pages=(select coalesce(jsonb_object_agg(p.key,
 case when coalesce((p.value->>'ownerPreviewHold')::boolean,false)=false
 and p.value->>'pageId' is not null
 and exists(select 1 from public.private_mail_messages m where m.mailbox_id=b.id
 and m.analysis is not null and (m.created_at at time zone 'Asia/Seoul')::date=p.key::date
 and m.report_day<>p.key::date)
 then p.value||jsonb_build_object('dirty',true,'revision',coalesce((p.value->>'revision')::integer,0)+1)
 else p.value end),'{}'::jsonb) from jsonb_each(b.briefing_pages) p)
where b.id='39045005-313e-42e1-b50c-2394b3b6ff26';

commit;
