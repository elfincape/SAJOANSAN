-- Explicitly selected empty summaries can be repaired without deleting their previous analysis.
begin;
create or replace function public.private_mail_analysis_select(p_box uuid,p_message uuid,p_user uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; m public.private_mail_messages; d text; page jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 select * into m from public.private_mail_messages where id=p_message and mailbox_id=p_box for update;
 if p_user is distinct from '2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid
 or b.id is distinct from '39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 or b.owner_id is distinct from p_user or m.owner_id is distinct from p_user or m.id is null or not b.enabled
 or not exists(select 1 from public.user_profiles p where p.id=p_user and p.active) then raise exception 'ANALYSIS_SELECTION_SCOPE'; end if;
 update public.private_mail_messages set analysis_manual_selected_at=coalesce(analysis_manual_selected_at,clock_timestamp())
 where id=p_message returning * into m;
 -- Retry only the explicitly selected invalid empty reference; retain its prior JSON.
 if m.analysis_status='ready' and m.analysis->'source'->>'intent' in ('reference','routine')
 and m.analysis->'summary'='[]'::jsonb and coalesce(m.analysis->'imageFacts','[]'::jsonb)='[]'::jsonb
 and (not m.analysis_excluded or m.analysis_filter_override='include')
 and (m.analysis_lease_until is null or m.analysis_lease_until<=clock_timestamp()) then
  update public.private_mail_messages set analysis_status='failed',analysis_error='ANALYSIS_SUMMARY_EMPTY' where id=p_message returning * into m;
 end if;
 -- A new explicit click may retry this failed mail without resetting in-flight or ready work.
 if m.analysis_status='failed' and (not m.analysis_excluded or m.analysis_filter_override='include')
 and (m.analysis_lease_until is null or m.analysis_lease_until<=clock_timestamp()) then
  update public.private_mail_messages set analysis_status='pending',analysis_attempts=0,analysis_next_at=clock_timestamp(),
  analysis_error=null,analysis_lease=null,analysis_lease_until=null where id=p_message returning * into m;
 end if;
 if m.analysis_status='ready' and m.analysis is not null and (not m.analysis_excluded or m.analysis_filter_override='include')
 and coalesce((b.briefing_pages->m.report_day::text->>'ownerPreviewHold')::boolean,false)=false then
  d=m.report_day::text;page=coalesce(b.briefing_pages->d,'{}'::jsonb);
  page=page||jsonb_build_object('revision',coalesce((page->>'revision')::integer,0)+1,'dirty',true);
  update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page) where id=p_box;
 end if;
 return jsonb_build_object('id',m.id,'status',m.analysis_status,'analysis_status',m.analysis_status,
 'excluded',m.analysis_excluded and m.analysis_filter_override<>'include','reportDay',m.report_day,'selectedAt',m.analysis_manual_selected_at);
end; $$;
commit;
