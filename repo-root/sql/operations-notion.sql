-- Private integration state; no employee-facing database or service impersonation API.
begin;
create table public.operations_notion_identities (
  notion_user_id uuid primary key,
  user_id uuid not null unique references public.user_profiles(id),
  verified_at timestamptz not null default now()
);
create table public.operations_notion_links (
  page_id uuid primary key,
  task_id uuid not null unique references public.operations_tasks(id),
  base_values jsonb not null,
  observed_edit_at timestamptz,
  synced_at timestamptz not null default now(),
  conflict_fields text[] not null default '{}'
);
alter table public.operations_notion_identities enable row level security;
alter table public.operations_notion_links enable row level security;
revoke all on public.operations_notion_identities,public.operations_notion_links from public,anon,authenticated;
grant all on public.operations_notion_identities,public.operations_notion_links to service_role;

create function public.operations_import_notion_task(
  p_notion_actor uuid,p_request_id uuid,p_task_id uuid,p_expected_version integer,
  p_center text,p_title text,p_work_date date,p_inputs jsonb,p_status text
) returns public.operations_tasks
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid; v_claims text; v_old_sub text; v_old_role text; v_result public.operations_tasks;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception '서버 전용 연결입니다' using errcode='42501';
  end if;
  select i.user_id into v_actor from public.operations_notion_identities i
    join public.user_profiles p on p.id=i.user_id and p.active where i.notion_user_id=p_notion_actor;
  if v_actor is null then raise exception '노션 수정자의 활성 웹 계정 연결이 필요합니다' using errcode='42501'; end if;
  v_claims:=current_setting('request.jwt.claims',true);
  v_old_sub:=current_setting('request.jwt.claim.sub',true);
  v_old_role:=current_setting('request.jwt.claim.role',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  -- Use the same authorization, version, retry, template and completion validation.
  v_result:=public.operations_save_task(p_request_id,p_task_id,p_expected_version,p_center,p_title,p_work_date,p_inputs,p_status);
  perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(v_old_sub,''),true);
  perform set_config('request.jwt.claim.role',coalesce(v_old_role,''),true);
  return v_result;
end;
$$;
revoke all on function public.operations_import_notion_task(uuid,uuid,uuid,integer,text,text,date,jsonb,text) from public,anon,authenticated;
grant execute on function public.operations_import_notion_task(uuid,uuid,uuid,integer,text,text,date,jsonb,text) to service_role;
commit;
