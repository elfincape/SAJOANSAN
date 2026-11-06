-- Explicit employee scope is authoritative. Unknown function versions abort atomically.
-- Stored grants, memberships, business records and function ACLs are preserved.
begin;
do $patch$
declare item jsonb; part jsonb; source text;
begin
 for item in select value from jsonb_array_elements($changes$
[
  {
    "signature": "public.operations_permission_for_actor(text,text,text,uuid)",
    "before": "b37a9f5bfa0f5842406c9320b831d5ed",
    "after": "4463dba79f288916ac14b4283e043745",
    "replacements": [
      {
        "old": "if can_edit and p_resource in (",
        "new": "if can_edit and not (config.member_overrides ? p_actor::text) and p_resource in ("
      }
    ]
  },
  {
    "signature": "public.operations_can_edit_resource(text,text)",
    "before": "8ad6136753a2bdc3e937340d28e05d3c",
    "after": "3b93bd459338d1a6ab4f39ff9b34a240",
    "replacements": [
      {
        "old": "(p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p.id and m.center_code=p_center)))",
        "new": "(p.role='admin' or (p.role='editor' and (exists(select 1 from public.operations_center_members m where m.user_id=p.id and m.center_code=p_center) or exists(select 1 from public.operations_permissions c where c.resource=p_resource and c.member_overrides->p.id::text->>'level'='edit' and c.member_overrides->p.id::text->>'scope'='all'))))"
      }
    ]
  },
  {
    "signature": "public.operations_reserve_file(uuid,uuid,text,uuid,text,integer,text,text,text)",
    "before": "d4cef9d1b02504292b7b655e4958546d",
    "after": "99f2b72ca0b8c9275ad0c0f1a87e190e",
    "replacements": [
      {
        "old": "(role='admin' or (role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p_actor and m.center_code=subject_row->>'center_code')))",
        "new": "(role='admin' or (role='editor' and (exists(select 1 from public.operations_center_members m where m.user_id=p_actor and m.center_code=subject_row->>'center_code') or exists(select 1 from public.operations_permissions c where c.resource=case p_kind when 'task' then 'tasks' when 'incident' then 'incidents' else 'forms' end and c.member_overrides->p_actor::text->>'level'='edit' and c.member_overrides->p_actor::text->>'scope'='all'))))"
      },
      {
        "old": " select name into center_name from public.centers",
        "new": " if (subject_row->'inputs' ? 'personal_work' or subject_row->'inputs' ? 'personal_monthly') and subject_row->>'owner_id' is distinct from p_actor::text then raise exception '개인 업무 첨부 권한이 없습니다' using errcode='42501';end if;\n select name into center_name from public.centers"
      }
    ]
  },
  {
    "signature": "public.operations_commit_file(uuid,uuid,text,text)",
    "before": "e4e4496c188572e208d42b5ad3c92ddc",
    "after": "45b482d68dc79e7840a8f0606a28c996",
    "replacements": [
      {
        "old": "(role='admin' or (role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p_actor and m.center_code=file_row.center_code)))",
        "new": "(role='admin' or (role='editor' and (exists(select 1 from public.operations_center_members m where m.user_id=p_actor and m.center_code=file_row.center_code) or exists(select 1 from public.operations_permissions c where c.resource=case when file_row.task_id is not null then 'tasks' when file_row.incident_id is not null then 'incidents' else 'forms' end and c.member_overrides->p_actor::text->>'level'='edit' and c.member_overrides->p_actor::text->>'scope'='all'))))"
      },
      {
        "old": " if file_row.task_id is not null then select to_jsonb(t) into subject_row from public.operations_tasks t where id=file_row.task_id;\n elsif file_row.incident_id is not null then select to_jsonb(i) into subject_row from public.operations_incidents i where id=file_row.incident_id;\n else select to_jsonb(s) into subject_row from public.operations_surveys s where id=file_row.survey_id;end if;\n",
        "new": ""
      },
      {
        "old": " if file_row.status='saved'",
        "new": " if file_row.task_id is not null then select to_jsonb(t) into subject_row from public.operations_tasks t where id=file_row.task_id;\n elsif file_row.incident_id is not null then select to_jsonb(i) into subject_row from public.operations_incidents i where id=file_row.incident_id;\n else select to_jsonb(s) into subject_row from public.operations_surveys s where id=file_row.survey_id;end if;\n if (subject_row->'inputs' ? 'personal_work' or subject_row->'inputs' ? 'personal_monthly') and subject_row->>'owner_id' is distinct from p_actor::text then raise exception '개인 업무 첨부 권한이 없습니다' using errcode='42501';end if;\n if file_row.status='saved'"
      }
    ]
  },
  {
    "signature": "public.operations_handoff_people(text)",
    "before": "8323bddba7d90dca800bcbb7a9a4e345",
    "after": "90ff3d9938d96c42df497ae8e2502075",
    "replacements": [
      {
        "old": "public.operations_can_write(p_center)",
        "new": "public.operations_can_edit_resource('tasks',p_center)"
      },
      {
        "old": "(p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p.id and m.center_code=p_center)))",
        "new": "public.operations_permission_for_actor('tasks','edit',p_center,p.id)"
      }
    ]
  },
  {
    "signature": "public.operations_participant_options(text)",
    "before": "1a82c36a10bdcd622da0a0bd006dc05e",
    "after": "0ec9d006cea3a14c509cec90a70a95bf",
    "replacements": [
      {
        "old": "p.active and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members where user_id=p.id and center_code=p_center)))",
        "new": "public.operations_permission_for_actor('tasks','edit',p_center,p.id)"
      }
    ]
  },
  {
    "signature": "public.operations_set_task_participants(uuid,uuid,integer,uuid,uuid,uuid,text)",
    "before": "04ad664da0384c1dd69782db19cda578",
    "after": "a89acd01c003117c9a49b39c7749da31",
    "replacements": [
      {
        "old": "not exists(select 1 from public.user_profiles p where p.id=subject.user_id and p.active and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members where user_id=p.id and center_code=t.center_code))))",
        "new": "not public.operations_permission_for_actor('tasks','edit',t.center_code,subject.user_id)"
      }
    ]
  },
  {
    "signature": "public.operations_task_action(uuid,uuid,integer,text,jsonb)",
    "before": "738854b06ddda1be7e0e079462a253b8",
    "after": "a5fb2fd2f06f846146cfb8c2eab1d5f6",
    "replacements": [
      {
        "old": "not exists(select 1 from public.user_profiles p\n     where p.id=target and p.active and (p.role='admin' or (p.role='editor' and exists(\n       select 1 from public.operations_center_members m where m.user_id=target and m.center_code=t.center_code))))",
        "new": "not public.operations_permission_for_actor('tasks','edit',t.center_code,target)"
      }
    ]
  },
  {
    "signature": "public.operations_task_from_template(uuid,uuid,date,jsonb,uuid,boolean)",
    "before": "714e23b2a0157071a97c2e0f8d510a4b",
    "after": "1cc393f06f3ff4f885a76ec76cafaa05",
    "replacements": [
      {
        "old": "not exists(select 1 from public.user_profiles p where p.id=owner and p.active and (p.role='admin'\n   or (p.role='editor' and exists(select 1 from public.operations_center_members m\n     where m.user_id=p.id and m.center_code=template.center_code))))",
        "new": "not public.operations_permission_for_actor('tasks','edit',template.center_code,owner)"
      }
    ]
  },
  {
    "signature": "public.operations_portal_context()",
    "before": "fd32ecd30d28b58c7b8329f3bf44ed6e",
    "after": "b201fdced1a30feb96a5d0997c01230c",
    "replacements": [
      {
        "old": "public.operations_can_write(code)",
        "new": "(public.operations_can_edit_resource('tasks',code) or public.operations_can_edit_resource('forms',code) or public.operations_resource_allowed('incidents','edit',code))"
      }
    ]
  },
  {
    "signature": "public.operations_survey_delete(uuid,uuid,integer)",
    "before": "81b3815e03805fa77b9ff43443120d7f",
    "after": "abe8f6d870e7dd1288fa6e48e477a0e1",
    "replacements": [
      {
        "old": "not public.operations_can_write(s.center_code) or not public.operations_resource_allowed('forms','edit',s.center_code)",
        "new": "not public.operations_can_edit_resource('forms',s.center_code)"
      }
    ]
  }
]
$changes$::jsonb) loop
  source:=pg_get_functiondef((item->>'signature')::regprocedure);
  if md5(source)=item->>'after' then continue;end if;
  if md5(source)<>item->>'before' then raise exception '권한 함수 버전이 변경되었습니다: %',item->>'signature' using errcode='40001';end if;
  for part in select value from jsonb_array_elements(item->'replacements') loop
   if (length(source)-length(replace(source,part->>'old','')))/length(part->>'old')<>1 then raise exception '권한 함수 교정 위치를 확인하세요: %',item->>'signature';end if;
   source:=replace(source,part->>'old',part->>'new');
  end loop;
  if md5(source)<>item->>'after' then raise exception '권한 함수 검증 실패: %',item->>'signature';end if;
  execute source;
 end loop;
end $patch$;
notify pgrst,'reload schema';
commit;
