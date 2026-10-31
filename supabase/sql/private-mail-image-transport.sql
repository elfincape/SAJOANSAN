-- Short-lived, single-URL image transport using the existing hashed worker capability store.
begin;
create or replace function public.private_mail_dispatch_target_allowed(p_box uuid,p_kind text,p_target text)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare b public.private_mailboxes; d date; image_target text;
begin
 select * into b from public.private_mailboxes where id=p_box;
 if b.id is distinct from '39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 or b.owner_id is distinct from '2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid or not b.enabled
 or not exists(select 1 from public.user_profiles p where p.id=b.owner_id and p.active) then return false; end if;
 if p_kind='remote-image' then
  image_target=split_part(p_target,':',1);
  if image_target is null or (p_target<>image_target and substring(p_target from 38) !~ '^[a-f0-9]{64}$') then return false; end if;
  if image_target='11111111-1111-4111-8111-111111111111' then return true; end if;
  if image_target !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  return coalesce(b.automation_config->'analysisScopes'->>image_target is distinct from 'body_headers'
   and jsonb_typeof(b.automation_config->'remoteImages'->image_target->'approvedUrls')='array'
   and jsonb_array_length(b.automation_config->'remoteImages'->image_target->'approvedUrls') between 1 and 5,false);
 end if;
 if p_kind='history' then
  if coalesce(p_target,'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  return exists(select 1 from public.private_mail_analysis_history h where h.id=p_target::uuid
   and h.mailbox_id=p_box and h.owner_id=b.owner_id and h.status in ('pending','processing'));
 end if;
 if p_kind='collect' then
  if b.automation_job->>'id' is distinct from p_target then return false; end if;
  -- Pausing stops new claims while the active chunk can finish and release POP state.
  if b.automation_job->>'status'='running' and (b.automation_job->>'leaseUntil')::timestamptz>clock_timestamp() then return true; end if;
  return public.private_mail_automation_allowed(p_box) and coalesce(b.automation_job->>'status' in ('queued','running')
   and not coalesce((b.automation_job->>'stopRequested')::boolean,false),false);
 end if;
 if p_kind='report' then
  if coalesce(p_target,'') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  d=p_target::date;
  return public.private_mail_report_allowed(p_box,d) and coalesce((b.briefing_pages->p_target->>'dirty'='true'
   or (b.briefing_pages->p_target->>'leaseUntil')::timestamptz>clock_timestamp()),false);
 end if;
 -- Explicitly submitted manual messages use the existing analyze transport,
 -- independently of the scheduled POP/mail-analysis switch.
 if p_kind='analyze' and b.manual_entries ? p_target then
  return (b.manual_entries->p_target->>'status') in ('pending','processing','failed')
   and coalesce((b.manual_entries->p_target->>'attempts')::integer,0)<3;
 end if;
 if not public.private_mail_automation_allowed(p_box) or b.automation_config->>'analysisConsent' is distinct from 'true' then return false; end if;
 if p_kind='analyze' then
  if coalesce(p_target,'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  return exists(select 1 from public.private_mail_messages m where m.id=p_target::uuid and m.mailbox_id=p_box
   and public.private_mail_analysis_allowed(m.id) and m.analysis_status in ('pending','failed','processing'));
 end if;
 return false;
 exception when others then return false;
end; $$;
create or replace function public.private_mail_image_transport_grant(p_box uuid,p_user uuid,p_message uuid,p_url text)
returns text language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; token text; token_hash text; caps jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 if not public.private_mail_manual_allowed(p_box,p_user) or p_url is null or length(p_url)>2000
 or public.private_mail_dispatch_target_allowed(p_box,'remote-image',p_message::text) is distinct from true then raise exception 'IMAGE_TRANSPORT_SCOPE'; end if;
 if p_message='11111111-1111-4111-8111-111111111111'::uuid then
  if p_url not in ('https://placehold.co/480x160.png','https://sajoansan.vercel.app/diagnostics/mail-body-fixture.png') then raise exception 'IMAGE_TRANSPORT_SCOPE'; end if;
 elsif not exists(select 1 from public.private_mail_messages m where m.id=p_message and m.mailbox_id=p_box and m.owner_id=p_user)
 or (b.automation_config->'remoteImages'->p_message::text->'approvedUrls' ? p_url) is distinct from true then raise exception 'IMAGE_TRANSPORT_SCOPE'; end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into caps from jsonb_each(b.automation_dispatch)
 where (value->>'expiresAt')::timestamptz>clock_timestamp();
 if (select count(*) from jsonb_object_keys(caps))>=16 then raise exception 'IMAGE_TRANSPORT_BUSY'; end if;
 token='pmjob_'||encode(extensions.gen_random_bytes(32),'hex');
 token_hash=rtrim(translate(encode(extensions.digest(convert_to(token,'UTF8'),'sha256'),'base64'),'+/','-_'),'=');
 caps=caps||jsonb_build_object(token_hash,jsonb_build_object('kind','remote-image','target',p_message::text||':'||encode(extensions.digest(convert_to(p_url,'UTF8'),'sha256'),'hex'),
  'urlHash',encode(extensions.digest(convert_to(p_url,'UTF8'),'sha256'),'hex'),
  'issuedAt',clock_timestamp(),'expiresAt',clock_timestamp()+interval '60 seconds'));
 update public.private_mailboxes set automation_dispatch=caps where id=p_box;
 return token;
end; $$;
create or replace function public.private_mail_image_transport_auth(p_box uuid,p_hash text,p_message uuid,p_url text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; cap jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 cap=b.automation_dispatch->p_hash;
 if p_hash is null or cap is null or cap->>'kind' is distinct from 'remote-image'
 or cap->>'target' is distinct from (p_message::text||':'||encode(extensions.digest(convert_to(p_url,'UTF8'),'sha256'),'hex')) or p_url is null or length(p_url)>2000
 or cap->>'urlHash' is distinct from encode(extensions.digest(convert_to(p_url,'UTF8'),'sha256'),'hex')
 or coalesce((cap->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
 or public.private_mail_dispatch_target_allowed(p_box,'remote-image',p_message::text) is distinct from true then return false; end if;
 if p_message='11111111-1111-4111-8111-111111111111'::uuid then
  if p_url not in ('https://placehold.co/480x160.png','https://sajoansan.vercel.app/diagnostics/mail-body-fixture.png') then return false; end if;
 elsif not exists(select 1 from public.private_mail_messages m where m.id=p_message and m.mailbox_id=p_box and m.owner_id=b.owner_id)
 or (b.automation_config->'remoteImages'->p_message::text->'approvedUrls' ? p_url) is distinct from true then return false; end if;
 update public.private_mailboxes set automation_dispatch=automation_dispatch-p_hash where id=p_box;
 return true;
end; $$;
revoke all on function public.private_mail_image_transport_grant(uuid,uuid,uuid,text),public.private_mail_image_transport_auth(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.private_mail_image_transport_grant(uuid,uuid,uuid,text),public.private_mail_image_transport_auth(uuid,text,uuid,text) to service_role;
commit;
