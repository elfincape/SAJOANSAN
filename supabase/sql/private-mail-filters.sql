-- LOCAL DRAFT, after private-mail-automation.sql. No mail is removed or blocked on POP.
begin;
alter table public.private_mailboxes
 add column if not exists analysis_rules jsonb not null default '[]' check(jsonb_typeof(analysis_rules)='array'),
 add column if not exists briefing_overrides jsonb not null default '{}';
alter table public.private_mail_messages
 add column if not exists analysis_excluded boolean not null default false,
 add column if not exists analysis_exclusion jsonb,
 add column if not exists analysis_filter_override text not null default 'inherit' check(analysis_filter_override in ('inherit','include','exclude')),
 add column if not exists analysis_filter_checked_at timestamptz;

create or replace function public.private_mail_filter_allowed(p_box uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.private_mailboxes b join public.user_profiles p on p.id=b.owner_id and p.active
 where b.id=p_box and b.id='39045005-313e-42e1-b50c-2394b3b6ff26'::uuid
 and b.owner_id='2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid);
$$;

-- Adapter validates Unicode/address syntax through validateMailRule before storing.
create or replace function public.private_mail_filter_rules_save(p_box uuid,p_rules jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; c jsonb;
begin
 if not public.private_mail_filter_allowed(p_box) then raise exception 'FILTER_SCOPE'; end if;
 if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules)>50
 or octet_length(p_rules::text)>300000 then raise exception 'MAIL_RULE_INVALID'; end if;
 for r in select value from jsonb_array_elements(p_rules) loop
  if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  or jsonb_typeof(r->'name') is distinct from 'string' or length(btrim(r->>'name')) not between 1 and 100
  or jsonb_typeof(r->'enabled') is distinct from 'boolean' or coalesce(r->>'mode','') not in ('all','any')
  or jsonb_typeof(r->'conditions') is distinct from 'array' then raise exception 'MAIL_RULE_INVALID'; end if;
  if jsonb_array_length(r->'conditions') not between 1 and 10 then raise exception 'MAIL_RULE_INVALID'; end if;
  for c in select value from jsonb_array_elements(r->'conditions') loop
   if coalesce(c->>'field','') not in ('subject','body','sender','domain')
   or jsonb_typeof(c->'value') is distinct from 'string' or length(btrim(c->>'value')) not between 1 and 500 then raise exception 'MAIL_RULE_INVALID'; end if;
  end loop;
 end loop;
 if (select count(*)<>count(distinct lower(value->>'id')) from jsonb_array_elements(p_rules)) then raise exception 'MAIL_RULE_INVALID'; end if;
 update public.private_mailboxes set analysis_rules=p_rules where id=p_box;return p_rules;
end; $$;

create or replace function public.private_mail_filter_match_valid(p_box uuid,p_match jsonb)
returns boolean language sql stable security invoker set search_path='' as $$
 select jsonb_typeof(p_match)='object' and jsonb_typeof(p_match->'excluded')='boolean'
 and octet_length(p_match::text)<=4096 and jsonb_typeof(p_match->'matchedFields')='array'
 and not exists(select 1 from jsonb_array_elements_text(p_match->'matchedFields') f where f not in ('subject','body','sender','domain'))
 and (case when p_match->>'reason'='RULE_MATCH' then
  p_match->>'excluded'='true' and exists(select 1 from public.private_mailboxes b,
  lateral jsonb_array_elements(b.analysis_rules) r where b.id=p_box and r->>'id'=p_match->>'ruleId' and r->>'enabled'='true')
 else coalesce(p_match->>'reason','') in ('','MANUAL_INCLUDE','MANUAL_EXCLUDE') end);
$$;

-- The worker calls this after local body extraction and BEFORE any paid model request.
create or replace function public.private_mail_filter_record(p_message uuid,p_lease uuid,p_match jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; m public.private_mail_messages; excluded boolean; reason jsonb;
begin
 select b0.* into b from public.private_mailboxes b0 join public.private_mail_messages m0 on m0.mailbox_id=b0.id where m0.id=p_message for update of b0;
 select * into m from public.private_mail_messages where id=p_message for update;
 if not public.private_mail_filter_allowed(b.id) or m.analysis_status is distinct from 'processing'
 or m.analysis_lease is distinct from p_lease or m.analysis_lease_until is null
 or m.analysis_lease_until<=clock_timestamp() then return false; end if;
 if public.private_mail_filter_match_valid(b.id,p_match) is distinct from true then raise exception 'FILTER_MATCH'; end if;
 excluded=case m.analysis_filter_override when 'include' then false when 'exclude' then true else (p_match->>'excluded')::boolean end;
 reason=case m.analysis_filter_override when 'include' then '{"excluded":false,"reason":"MANUAL_INCLUDE","ruleId":null,"ruleName":null,"matchedFields":[]}'::jsonb
 when 'exclude' then '{"excluded":true,"reason":"MANUAL_EXCLUDE","ruleId":null,"ruleName":null,"matchedFields":[]}'::jsonb else p_match end;
 update public.private_mail_messages set analysis_excluded=excluded,analysis_exclusion=reason,analysis_filter_checked_at=clock_timestamp(),
 analysis_status=case when excluded then 'blocked' else analysis_status end,
 analysis_lease=case when excluded then null else analysis_lease end,
 analysis_lease_until=case when excluded then null else analysis_lease_until end where id=p_message;
 return true;
end; $$;

-- Owner-approved application of a local preview result to one existing message.
create or replace function public.private_mail_filter_apply(p_box uuid,p_message uuid,p_match jsonb,p_confirm boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; m public.private_mail_messages; page jsonb; d text; excluded boolean; reason jsonb;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 select * into m from public.private_mail_messages where id=p_message and mailbox_id=p_box for update;
 if not public.private_mail_filter_allowed(p_box) or m.id is null then raise exception 'FILTER_SCOPE'; end if;
 if public.private_mail_filter_match_valid(p_box,p_match) is distinct from true then raise exception 'FILTER_MATCH'; end if;
 excluded=case m.analysis_filter_override when 'include' then false when 'exclude' then true else (p_match->>'excluded')::boolean end;
 reason=case m.analysis_filter_override when 'include' then '{"excluded":false,"reason":"MANUAL_INCLUDE","ruleId":null,"ruleName":null,"matchedFields":[]}'::jsonb
 when 'exclude' then '{"excluded":true,"reason":"MANUAL_EXCLUDE","ruleId":null,"ruleName":null,"matchedFields":[]}'::jsonb else p_match end;
 d=m.report_day::text;page=coalesce(b.briefing_pages->d,'{}'::jsonb);
 if excluded is distinct from m.analysis_excluded and m.analysis is not null and not coalesce(p_confirm,false)
 and (page->>'pageId' is not null or page->>'createAttempted'='true' or page->'pendingWrite' is not null and page->'pendingWrite'<>'null'::jsonb
 or (page->>'leaseUntil')::timestamptz>clock_timestamp()) then raise exception 'FILTER_REPORT_CONFIRM_REQUIRED'; end if;
 update public.private_mail_messages set analysis_excluded=excluded,analysis_exclusion=reason,analysis_filter_checked_at=clock_timestamp(),
 analysis_status=case when analysis is not null then 'ready' when excluded then 'blocked' else 'pending' end,
 analysis_attempts=case when not excluded and analysis is null then 0 else analysis_attempts end,
 analysis_next_at=case when not excluded and analysis is null then clock_timestamp() else analysis_next_at end,
 analysis_lease=null,analysis_lease_until=null where id=p_message;
 if coalesce(p_confirm,false) and excluded is distinct from m.analysis_excluded and m.analysis is not null then
  page=page||jsonb_build_object('revision',coalesce((page->>'revision')::integer,0)+1,'dirty',true);
  update public.private_mailboxes set briefing_pages=jsonb_set(briefing_pages,array[d],page) where id=p_box;
 end if;
 if coalesce(p_confirm,false) then perform public.private_mail_dispatch(p_box); end if;
 return jsonb_build_object('excluded',excluded,'exclusion',reason,'override',m.analysis_filter_override,'reportDay',d,'reportChangeConfirmed',coalesce(p_confirm,false));
end; $$;

create or replace function public.private_mail_filter_override(p_box uuid,p_message uuid,p_override text,p_confirm boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.private_mail_messages; matched jsonb; result jsonb;
begin
 if p_override is null or p_override not in ('inherit','include','exclude') then raise exception 'FILTER_OVERRIDE'; end if;
 perform 1 from public.private_mailboxes where id=p_box for update;
 select * into m from public.private_mail_messages where id=p_message and mailbox_id=p_box for update;
 if not public.private_mail_filter_allowed(p_box) or m.id is null then raise exception 'FILTER_SCOPE'; end if;
 update public.private_mail_messages set analysis_filter_override=p_override where id=p_message;
 if p_override='inherit' then
  -- Keep the last exclusion until the adapter applies a fresh local rule preview.
  update public.private_mail_messages set analysis_filter_checked_at=null where id=p_message;
  return jsonb_build_object('excluded',m.analysis_excluded,'exclusion',m.analysis_exclusion,
  'override','inherit','needsFilterCheck',true,'reportDay',m.report_day);
 end if;
 matched=jsonb_build_object('excluded',p_override='exclude','reason',case p_override when 'include' then 'MANUAL_INCLUDE' when 'exclude' then 'MANUAL_EXCLUDE' else null end,
 'ruleId',null,'ruleName',null,'matchedFields','[]'::jsonb);
 result=public.private_mail_filter_apply(p_box,p_message,matched,p_confirm);
 return result;
end; $$;

create or replace function public.private_mail_item_override(p_box uuid,p_message uuid,p_ref text,p_done boolean,p_day date)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.private_mailboxes; m public.private_mail_messages; parts text[]; items jsonb; item jsonb; n integer; page jsonb; d text=p_day::text;
begin
 select * into b from public.private_mailboxes where id=p_box for update;
 select * into m from public.private_mail_messages where id=p_message and mailbox_id=p_box;
 if not public.private_mail_filter_allowed(p_box) or m.id is null or p_done is null or p_day is null
 or p_ref is null or length(p_ref)>128 then return false; end if;
 parts=string_to_array(p_ref,':');
 if cardinality(parts)<>3 or parts[1]<>p_message::text or parts[2] not in ('tasks','imageTasks')
 or parts[3] !~ '^(0|[1-9][0-9]{0,3})$' then return false; end if;
 n=parts[3]::integer;
 items=case parts[2] when 'tasks' then m.analysis->'tasks' else m.analysis->'imageItems'->'tasks' end;
 if jsonb_typeof(items) is distinct from 'array' or n>=jsonb_array_length(items) then return false; end if;
 item=items->n;
 if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'text','')='' then return false; end if;
 -- Any retained source can appear on later daily pages; only persisted page days are accepted.
 if p_day<>m.report_day and not b.briefing_pages ? d then return false; end if;
 page=coalesce(b.briefing_pages->d,'{}'::jsonb)||jsonb_build_object('revision',coalesce((b.briefing_pages->d->>'revision')::integer,0)+1,'dirty',true);
 update public.private_mailboxes set briefing_overrides=jsonb_set(briefing_overrides,array[p_ref],jsonb_build_object('done',p_done,'updatedAt',clock_timestamp(),'actor','owner')),
 briefing_pages=jsonb_set(briefing_pages,array[d],page) where id=p_box;
 perform public.private_mail_dispatch(p_box);return true;
end; $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('private_mail_filter_allowed','private_mail_filter_rules_save','private_mail_filter_match_valid',
 'private_mail_filter_record','private_mail_filter_apply','private_mail_filter_override','private_mail_item_override') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
