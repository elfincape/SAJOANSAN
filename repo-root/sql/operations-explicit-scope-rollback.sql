-- Function-only rollback. Does not change stored grants, memberships or business rows.
begin;
CREATE OR REPLACE FUNCTION public.operations_can_edit_resource(p_resource text, p_center text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select public.operations_resource_allowed(p_resource,'edit',p_center) and exists(select 1 from public.user_profiles p where p.id=auth.uid() and p.active and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p.id and m.center_code=p_center))));
$function$
;
CREATE OR REPLACE FUNCTION public.operations_commit_file(p_id uuid, p_actor uuid, p_drive text, p_item text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare file_row public.operations_files;subject_row jsonb;
begin
 select * into file_row from public.operations_files where id=p_id for update;
 if file_row.id is not null and not public.operations_permission_for_actor(case when file_row.task_id is not null then 'tasks' when file_row.incident_id is not null then 'incidents' else 'forms' end,'edit',file_row.center_code,p_actor) then raise exception '이 목록의 첨부 권한이 없습니다' using errcode='42501';end if;
 if not found or file_row.uploaded_by<>p_actor or not exists(select 1 from public.user_profiles p where id=p_actor and active and (role='admin' or (role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p_actor and m.center_code=file_row.center_code))))
  then raise exception '첨부 저장 권한이 변경되었습니다' using errcode='42501';end if;
 if file_row.status='saved' then return file_row.id;end if;
 if nullif(p_drive,'') is null or nullif(p_item,'') is null or file_row.drive_id is distinct from p_drive or file_row.item_id is distinct from p_item then raise exception '실제 저장한 파일을 확인해 주세요' using errcode='22023';end if;
 if file_row.task_id is not null then select to_jsonb(t) into subject_row from public.operations_tasks t where id=file_row.task_id;
 elsif file_row.incident_id is not null then select to_jsonb(i) into subject_row from public.operations_incidents i where id=file_row.incident_id;
 else select to_jsonb(s) into subject_row from public.operations_surveys s where id=file_row.survey_id;end if;
 update public.operations_files set status='saved',verified_at=now(),last_error=null where id=p_id;
 insert into public.operations_task_events(task_id,incident_id,survey_id,actor_id,request_id,request_body,action,after_value)
 values(file_row.task_id,file_row.incident_id,file_row.survey_id,p_actor,file_row.request_id,
 jsonb_build_object('operation','file_upload','file_id',file_row.id,'data',jsonb_build_object('note',file_row.file_name)),
 'file_uploaded',subject_row||jsonb_build_object('file',jsonb_build_object('id',file_row.id,'name',file_row.file_name,'bytes',file_row.byte_size)));
 return file_row.id;
end $function$
;
CREATE OR REPLACE FUNCTION public.operations_handoff_people(p_center text)
 RETURNS TABLE(id uuid, name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if not public.operations_can_write(p_center) then raise exception '센터 수정 권한이 없습니다' using errcode='42501'; end if;
 return query select p.id,coalesce(nullif(p.display_name,''),p.email,'직원') from public.user_profiles p where p.active
 and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p.id and m.center_code=p_center))) order by 2;
end $function$
;
CREATE OR REPLACE FUNCTION public.operations_participant_options(p_center text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind',s.kind,'user_id',s.user_id,'center_code',s.center_code,'role_key',s.role_key,
 'name',case s.kind when 'person' then coalesce(nullif(p.display_name,''),'이름 미설정') when 'center' then c.name else '배송팀' end,
 'centers',case when s.kind='person' then (select coalesce(jsonb_agg(center_code order by center_code),'[]') from public.operations_center_members where user_id=s.user_id) else '[]'::jsonb end,
 'role',p.role,'eligible',case when s.kind='person' then coalesce(p.active and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members where user_id=p.id and center_code=p_center))),false) when s.kind='center' then c.active else true end) order by s.kind,p.display_name,c.name),'[]') from public.operations_subjects s left join public.user_profiles p on p.id=s.user_id left join public.centers c on c.code=s.center_code);
end; $function$
;
CREATE OR REPLACE FUNCTION public.operations_permission_for_actor(p_resource text, p_action text, p_center text, p_actor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  config public.operations_permissions;
  role_name text;
  personal jsonb;
  in_scope boolean;
  can_read boolean;
  can_edit boolean;
begin
  select role into role_name
  from public.user_profiles where id = p_actor and active;
  if role_name is null or p_action is null or p_action not in ('read', 'edit') then
    return false;
  end if;
  select * into config from public.operations_permissions where resource = p_resource;
  if not found then return false; end if;
  if role_name = 'admin' then return true; end if;
  if config.admin_only then return false; end if;

  if config.member_overrides ? p_actor::text then
    personal := config.member_overrides -> p_actor::text;
    if jsonb_typeof(personal) is distinct from 'object'
      or coalesce(personal ->> 'level', '') not in ('none', 'read', 'edit')
      or coalesce(personal ->> 'scope', '') not in ('own', 'all') then
      return false;
    end if;
    if personal ->> 'level' = 'none' then return false; end if;
    in_scope := personal ->> 'scope' = 'all' or exists (
      select 1 from public.operations_center_members m
      where m.user_id = p_actor and (p_center is null or m.center_code = p_center)
    );
    can_read := in_scope;
    can_edit := personal ->> 'level' = 'edit' and in_scope
      and (role_name = 'editor' or p_resource in ('incidents', 'notifications'));
  else
    can_read := public.operations_permission_match(config.read_rule, p_actor, p_center);
    can_edit := (role_name = 'editor' or p_resource in ('incidents', 'notifications'))
      and public.operations_permission_match(config.write_rule, p_actor, p_center);
  end if;

  if can_edit and p_resource in (
    'tasks', 'forms', 'trash', 'drivers', 'vehicles', 'companies',
    'delivery_points', 'routes', 'transfers', 'charter', 'dispatch_parser', 'one_top'
  ) then
    can_edit := exists (
      select 1 from public.operations_center_members m
      where m.user_id = p_actor and (p_center is null or m.center_code = p_center)
    );
  end if;
  if p_action = 'read' then return can_read or can_edit; end if;
  return can_edit;
end $function$
;
CREATE OR REPLACE FUNCTION public.operations_reserve_file(p_request uuid, p_actor uuid, p_kind text, p_subject uuid, p_hash text, p_bytes integer, p_mime text, p_original text, p_extension text)
 RETURNS operations_files
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare file_row public.operations_files;subject_row jsonb;center_name text;next_ordinal integer;stem text;file_date date;
begin
 if p_request is null or p_actor is null or p_hash is null or p_hash !~ '^[A-Za-z0-9_-]{43}$' or p_bytes not between 1 and 10485760
  or p_extension is null or p_extension not in ('jpg','png','webp','pdf','xlsx','xls','docx','doc','pptx','csv','txt')
  or p_original is null or length(p_original) not between 1 and 255 or p_mime is null then raise exception '첨부 요청을 확인해 주세요' using errcode='22023';end if;
 if p_kind='task' then select to_jsonb(t) into subject_row from public.operations_tasks t where id=p_subject;
 elsif p_kind='incident' then select to_jsonb(i) into subject_row from public.operations_incidents i where id=p_subject;
 elsif p_kind='survey' then select to_jsonb(s) into subject_row from public.operations_surveys s where id=p_subject;
 else raise exception '첨부 대상이 올바르지 않습니다' using errcode='22023';end if;
 if subject_row is not null and not public.operations_permission_for_actor(case p_kind when 'task' then 'tasks' when 'incident' then 'incidents' else 'forms' end,'edit',subject_row->>'center_code',p_actor) then raise exception '이 목록의 첨부 권한이 없습니다' using errcode='42501';end if;
 if subject_row is null or not exists(select 1 from public.user_profiles p where id=p_actor and active and (role='admin' or (role='editor' and exists(select 1 from public.operations_center_members m where m.user_id=p_actor and m.center_code=subject_row->>'center_code'))))
  then raise exception '센터 첨부 권한이 없습니다' using errcode='42501';end if;
 select name into center_name from public.centers where code=subject_row->>'center_code' and active;
 if not found then raise exception '활성 센터를 확인해 주세요' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('file-request:'||p_actor::text||p_request::text,0));
 select * into file_row from public.operations_files where uploaded_by=p_actor and request_id=p_request;
 if found then
  if coalesce(file_row.task_id,file_row.incident_id,file_row.survey_id)<>p_subject or
   (case when file_row.task_id is not null then 'task' when file_row.incident_id is not null then 'incident' else 'survey' end)<>p_kind or
   file_row.content_hash<>p_hash or file_row.byte_size<>p_bytes or file_row.mime_type<>p_mime or file_row.original_name<>p_original then
   raise exception '재시도에는 같은 첨부 파일과 요청 번호를 사용해 주세요' using errcode='22023';end if;
  return file_row;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('file-subject:'||p_kind||p_subject::text,0));
 select coalesce(max(ordinal),0)+1 into next_ordinal from public.operations_files where
  (p_kind='task' and task_id=p_subject) or (p_kind='incident' and incident_id=p_subject) or (p_kind='survey' and survey_id=p_subject);
 file_date:=coalesce((subject_row->>'work_date')::date,((subject_row->>'created_at')::timestamptz at time zone 'Asia/Seoul')::date);
 stem:=to_char(file_date,'YYYYMMDD')||'_'||left(regexp_replace(center_name,'[\\/:*?"<>|[:cntrl:]]','-','g'),35)||'_'||left(regexp_replace(subject_row->>'title','[\\/:*?"<>|[:cntrl:]]','-','g'),60);
 insert into public.operations_files(task_id,incident_id,survey_id,center_code,uploaded_by,request_id,content_hash,original_name,file_name,mime_type,byte_size,ordinal)
 values(case when p_kind='task' then p_subject end,case when p_kind='incident' then p_subject end,case when p_kind='survey' then p_subject end,
 subject_row->>'center_code',p_actor,p_request,p_hash,p_original,stem||'_'||lpad(next_ordinal::text,greatest(3,length(next_ordinal::text)),'0')||'.'||p_extension,p_mime,p_bytes,next_ordinal) returning * into file_row;
 return file_row;
end $function$
;
CREATE OR REPLACE FUNCTION public.operations_set_task_participants(p_request_id uuid, p_task_id uuid, p_expected_version integer, p_handler uuid, p_from uuid DEFAULT NULL::uuid, p_to uuid DEFAULT NULL::uuid, p_memo text DEFAULT ''::text)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb; target uuid; subject public.operations_subjects; option_id uuid;
begin
 if not public.operations_resource_allowed('tasks','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if auth.uid() is null or p_request_id is null or length(coalesce(p_memo,''))>2000 then raise exception '활성 사용자 인증과 인계 요청을 확인하세요' using errcode='42501';end if;
 body:=jsonb_build_object('operation','set_task_participants','task',p_task_id,'version',p_expected_version,'handler',p_handler,'from',p_from,'to',p_to,'data',jsonb_build_object('memo',p_memo));
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into t from public.operations_tasks where id=p_task_id for update;
 if not found or not public.operations_can_edit_resource('tasks',t.center_code) then raise exception '센터 업무 수정 권한이 없습니다' using errcode='42501';end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023';end if;if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;end if;
 if p_expected_version is null or t.version<>p_expected_version then raise exception '다른 사용자가 수정했습니다. 새로고침하세요' using errcode='40001';end if;
 if t.deleted_at is not null or t.status in ('completed','not_applicable') then raise exception '진행 중인 업무만 담당을 변경하거나 인계할 수 있습니다' using errcode='22023';end if;
 target:=coalesce(p_to,p_handler);if target is null or (p_to is not null and p_from is null) then raise exception '처리 담당과 인계하는 담당을 선택하세요' using errcode='22023';end if;
 foreach option_id in array array[target,p_from] loop
  if option_id is null then continue;end if;
  select * into subject from public.operations_subjects where id=option_id;
  if not found or (subject.kind='person' and not exists(select 1 from public.user_profiles p where p.id=subject.user_id and p.active and (p.role='admin' or (p.role='editor' and exists(select 1 from public.operations_center_members where user_id=p.id and center_code=t.center_code)))))
  or(subject.kind='center' and not exists(select 1 from public.centers where code=subject.center_code and active)) then raise exception '유효한 사람·센터·역할을 선택하세요' using errcode='22023';end if;
 end loop;
 if p_to is not null and p_to=p_from then raise exception '서로 다른 인계 대상을 선택하세요' using errcode='22023';end if;
 before_row:=to_jsonb(t);select * into subject from public.operations_subjects where id=target;
 update public.operations_tasks set handler_subject_id=target,owner_id=subject.user_id,
 handoff_from_subject_id=case when p_to is not null then p_from else handoff_from_subject_id end,
 handoff_to_subject_id=case when p_to is not null then p_to else handoff_to_subject_id end,
 handoff_actor_id=case when p_to is not null then auth.uid() else handoff_actor_id end,
 handoff_at=case when p_to is not null then now() else handoff_at end,version=version+1,updated_at=now() where id=t.id returning * into t;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value) values(t.id,auth.uid(),p_request_id,body,case when p_to is null then 'task_assigned' else 'task_handoff' end,before_row,to_jsonb(t));
 if p_to is not null then
  insert into public.operations_notifications(user_id,event_id,title,task_id)
  select p.id,e.id,'인계받은 업무: '||t.title,t.id from public.user_profiles p cross join public.operations_task_events e
  where e.actor_id=auth.uid() and e.request_id=p_request_id and p.active and (p.id=subject.user_id or (subject.kind='center' and exists(select 1 from public.operations_center_members where user_id=p.id and center_code=subject.center_code)) or(subject.kind='role' and p.role='admin')) on conflict do nothing;
 end if;if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end; $function$
;
CREATE OR REPLACE FUNCTION public.operations_task_action(p_request_id uuid, p_task_id uuid, p_expected_version integer, p_action text, p_data jsonb)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.operations_tasks; prior public.operations_task_events; body jsonb; before_row jsonb;
 target uuid; deadline timestamptz; cj_deadline timestamptz;
begin
 if not public.operations_resource_allowed('tasks','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if auth.uid() is null or p_request_id is null or p_action not in ('handoff','deadline')
   or p_action is null or p_data is null or jsonb_typeof(p_data)<>'object' then
   raise exception '인계 또는 마감시간 요청을 확인해 주세요' using errcode='22023';
 end if;
 body:=jsonb_build_object('operation','task_action','task',p_task_id,'version',p_expected_version,'action',p_action,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into t from public.operations_tasks where id=p_task_id for update;
 if not found or not public.operations_can_edit_resource('tasks',t.center_code) then
   raise exception '업무 수정 권한이 없습니다' using errcode='42501'; end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
   if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
 end if;
 if p_expected_version is null or t.version<>p_expected_version then
   raise exception '다른 사용자가 수정했습니다' using errcode='40001'; end if;
 if t.status in ('completed','not_applicable') then
   raise exception '확정된 업무는 인계하거나 기한을 변경할 수 없습니다' using errcode='22023'; end if;
 before_row:=to_jsonb(t);
 if p_action='handoff' then
   target:=(p_data->>'owner_id')::uuid;
   if target is null or target=t.owner_id or not exists(select 1 from public.user_profiles p
     where p.id=target and p.active and (p.role='admin' or (p.role='editor' and exists(
       select 1 from public.operations_center_members m where m.user_id=target and m.center_code=t.center_code)))) then
     raise exception '해당 센터 업무를 맡을 수 있는 다음 담당자를 선택해 주세요' using errcode='22023'; end if;
   if p_data - array['owner_id','memo'] <> '{}'::jsonb then
     raise exception '인계에서 업무 내용이나 기한은 변경하지 않습니다' using errcode='22023'; end if;
   update public.operations_tasks set owner_id=target,version=version+1,updated_at=now()
     where id=t.id returning * into t;
 else
   if p_data - array['due_at','cj_share_due_at','reason'] <> '{}'::jsonb then
     raise exception '마감시간 요청을 확인해 주세요' using errcode='22023'; end if;
   deadline:=case when p_data ? 'due_at' then (p_data->>'due_at')::timestamptz else t.due_at end;
   cj_deadline:=case when p_data ? 'cj_share_due_at' then (p_data->>'cj_share_due_at')::timestamptz else t.cj_share_due_at end;
   if deadline is not distinct from t.due_at and cj_deadline is not distinct from t.cj_share_due_at then
     raise exception '변경된 마감시간이 없습니다' using errcode='22023'; end if;
   if ((t.due_at is not null and deadline is distinct from t.due_at)
     or (t.cj_share_due_at is not null and cj_deadline is distinct from t.cj_share_due_at))
     and nullif(trim(p_data->>'reason'),'') is null then
     raise exception '기존 마감시간 변경 사유를 입력해 주세요' using errcode='22023'; end if;
   update public.operations_tasks set due_at=deadline,cj_share_due_at=cj_deadline,
     version=version+1,updated_at=now() where id=t.id returning * into t;
 end if;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,before_value,after_value)
   values(t.id,auth.uid(),p_request_id,body,p_action,before_row,to_jsonb(t));
 if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.operations_task_from_template(p_request_id uuid, p_template_id uuid, p_work_date date, p_inputs jsonb, p_owner_id uuid DEFAULT NULL::uuid, p_recurring boolean DEFAULT false)
 RETURNS operations_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare template public.operations_templates; t public.operations_tasks; prior public.operations_task_events;
 body jsonb; owner uuid:=coalesce(p_owner_id,auth.uid()); steps jsonb; occurrence text; repeat_kind text;
begin
 if not public.operations_resource_allowed('tasks','edit',null) then raise exception '이 목록의 수정 권한이 없습니다' using errcode='42501';end if;

 if auth.uid() is null or p_request_id is null or p_work_date is null or p_recurring is null
   or p_inputs is null or jsonb_typeof(p_inputs)<>'object' then
   raise exception '업무 생성 요청을 확인해 주세요' using errcode='22023'; end if;
 select * into template from public.operations_templates where id=p_template_id;
 if not found or (not public.operations_can_edit_resource('tasks',template.center_code) or not public.operations_resource_allowed('forms','read',template.center_code)) then
   raise exception '해당 센터 업무 생성 권한이 없습니다' using errcode='42501'; end if;
 if template.spec ? 'personal_monthly' and (auth.uid()::text is distinct from template.spec->'personal_monthly'->>'ownerId' or owner::text is distinct from template.spec->'personal_monthly'->>'ownerId') then raise exception 'MONTHLY_OWNER';end if; if template.spec ? 'personal_monthly' and not p_recurring then raise exception 'MONTHLY_RECURRING';end if; body:=jsonb_build_object('operation','from_template','template',p_template_id,'date',p_work_date,'inputs',p_inputs,'owner',owner,'recurring',p_recurring);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
   select * into t from public.operations_tasks where id=prior.task_id; if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
 end if;
 if template.status<>'approved' or coalesce((template.spec->>'effective_from')::date,(template.approved_at at time zone 'Asia/Seoul')::date)>p_work_date
   or exists(select 1 from public.operations_templates other where other.family_id=template.family_id
     and other.status in ('approved','retired') and other.version>template.version
     and coalesce((other.spec->>'effective_from')::date,(other.approved_at at time zone 'Asia/Seoul')::date)<=p_work_date) then
   raise exception '해당 날짜의 최신 승인 양식이 필요합니다' using errcode='22023'; end if;
 if not exists(select 1 from public.user_profiles p where p.id=owner and p.active and (p.role='admin'
   or (p.role='editor' and exists(select 1 from public.operations_center_members m
     where m.user_id=p.id and m.center_code=template.center_code)))) then
   raise exception '담당자의 센터 업무 권한을 확인해 주세요' using errcode='22023'; end if;
 if p_inputs ? 'steps' then raise exception '새 업무의 단계는 미완료로 시작합니다' using errcode='22023'; end if;
 if p_recurring then
   repeat_kind:=coalesce(template.spec->'repeat'->>'kind','none');
   if not (repeat_kind='daily' or (repeat_kind='weekdays' and template.spec->'repeat'->'days' @> to_jsonb(array[extract(isodow from p_work_date)::integer]))
     or (repeat_kind='monthly' and extract(day from p_work_date)::integer=(template.spec->'repeat'->>'day')::integer)
     or (repeat_kind='once' and p_work_date=(template.spec->'repeat'->>'date')::date)) then
     raise exception '반복 일정에 해당하지 않는 날짜입니다' using errcode='22023'; end if;
   occurrence:=case when template.spec ? 'personal_monthly' then template.family_id::text||':monthly:'||to_char(p_work_date,'YYYY-MM')||':'||owner::text else template.family_id::text||':'||p_work_date::text||':'||owner::text end;
   perform pg_advisory_xact_lock(hashtextextended(occurrence,0));
   select * into t from public.operations_tasks where occurrence_key=occurrence;
   if found then if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t; end if;
 end if;
 select coalesce(jsonb_object_agg(value->>'key','pending'::text),'{}') into steps
   from jsonb_array_elements(template.spec->'steps');
 insert into public.operations_tasks(center_code,title,work_date,owner_id,created_by,inputs,template_id,template_snapshot,occurrence_key)
   values(template.center_code,template.title,p_work_date,owner,auth.uid(),p_inputs||jsonb_build_object('steps',steps),
     template.id,to_jsonb(template),occurrence) returning * into t;
 insert into public.operations_task_events(task_id,actor_id,request_id,request_body,action,after_value)
   values(t.id,auth.uid(),p_request_id,body,'created',to_jsonb(t));
 if not public.operations_resource_allowed('tasks','read',t.center_code) then raise exception '이 업무의 열람 권한이 없습니다' using errcode='42501';end if;return t;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.operations_portal_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501'; end if;
 return jsonb_build_object('centers',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name) order by code),'[]') from public.centers where active),
 'writable_centers',(select coalesce(jsonb_agg(code order by code),'[]') from public.centers where active and public.operations_can_write(code)));
end $function$
;
CREATE OR REPLACE FUNCTION public.operations_survey_delete(p_request_id uuid, p_id uuid, p_expected_version integer)
 RETURNS operations_surveys
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s public.operations_surveys; prior public.operations_task_events; body jsonb; before_row jsonb;
begin
 if p_request_id is null or not public.operations_can_read() then raise exception '활성 사용자 인증이 필요합니다' using errcode='42501'; end if;
 body=jsonb_build_object('operation','survey_delete','id',p_id,'version',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into s from public.operations_surveys where id=p_id for update;
 if not found or not public.operations_can_write(s.center_code) or not public.operations_resource_allowed('forms','edit',s.center_code)
 then raise exception '센터 업무조사 수정 권한이 없습니다' using errcode='42501'; end if;
 select * into prior from public.operations_task_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.request_body<>body then raise exception '이미 사용된 요청 번호입니다' using errcode='22023'; end if;
  return s;
 end if;
 if s.version is distinct from p_expected_version or s.deleted_at is not null then raise exception '다른 사용자가 수정했습니다. 새로고침해 주세요' using errcode='40001'; end if;
 before_row=to_jsonb(s);
 update public.operations_surveys set deleted_at=now(),updated_by=auth.uid(),updated_at=now(),version=version+1 where id=s.id returning * into s;
 insert into public.operations_task_events(survey_id,actor_id,request_id,request_body,action,before_value,after_value)
 values(s.id,auth.uid(),p_request_id,body,'survey_edit',before_row,to_jsonb(s));
 return s;
end $function$
;
notify pgrst,'reload schema';
commit;
