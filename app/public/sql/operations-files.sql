begin;
create table public.operations_files(
 id uuid primary key default gen_random_uuid(),
 task_id uuid references public.operations_tasks(id),incident_id uuid references public.operations_incidents(id),survey_id uuid references public.operations_surveys(id),
 center_code text not null references public.centers(code),uploaded_by uuid not null references public.user_profiles(id),
 request_id uuid not null,content_hash text not null,original_name text not null,file_name text not null,
 mime_type text not null,byte_size integer not null check(byte_size between 1 and 10485760),ordinal integer not null check(ordinal>0),
 status text not null default 'reserved' check(status in ('reserved','saved','failed')),
 drive_id text,folder_id text,item_id text,last_error text,created_at timestamptz not null default now(),verified_at timestamptz,
 check(num_nonnulls(task_id,incident_id,survey_id)=1),unique(uploaded_by,request_id),
 check(status<>'saved' or (item_id is not null and drive_id is not null and verified_at is not null))
);
create index operations_files_task on public.operations_files(task_id,ordinal);
create index operations_files_incident on public.operations_files(incident_id,ordinal);
create index operations_files_survey on public.operations_files(survey_id,ordinal);
alter table public.operations_files enable row level security;
create policy operations_files_read on public.operations_files for select to authenticated using(public.operations_can_read());
revoke all on public.operations_files from public,anon,authenticated;
grant select(id,task_id,incident_id,survey_id,center_code,uploaded_by,request_id,original_name,file_name,mime_type,byte_size,ordinal,status,last_error,created_at,verified_at) on public.operations_files to authenticated;
grant all on public.operations_files to service_role;
alter table public.operations_task_events drop constraint operations_task_events_action_check;
alter table public.operations_task_events add constraint operations_task_events_action_check check(action in
 ('created','updated','completed','not_applicable','handoff','deadline','incident_created','incident_updated','support_requested','support_action','resolved','reopened','template_created','template_approved','template_retired','task_reopened','survey_submit','survey_edit','survey_stage','survey_template','membership_assigned','membership_revoked','cj_shared','cj_share_retracted','file_uploaded'));
create function public.operations_reserve_file(p_request uuid,p_actor uuid,p_kind text,p_subject uuid,p_hash text,p_bytes integer,p_mime text,p_original text,p_extension text)
returns public.operations_files language plpgsql security definer set search_path=public,pg_temp as $$
declare file_row public.operations_files;subject_row jsonb;center_name text;next_ordinal integer;stem text;file_date date;
begin
 if p_request is null or p_actor is null or p_hash is null or p_hash !~ '^[A-Za-z0-9_-]{43}$' or p_bytes not between 1 and 10485760
  or p_extension is null or p_extension not in ('jpg','png','webp','pdf','xlsx','xls','docx','doc','pptx','csv','txt')
  or p_original is null or length(p_original) not between 1 and 255 or p_mime is null then raise exception '첨부 요청을 확인해 주세요' using errcode='22023';end if;
 if p_kind='task' then select to_jsonb(t) into subject_row from public.operations_tasks t where id=p_subject;
 elsif p_kind='incident' then select to_jsonb(i) into subject_row from public.operations_incidents i where id=p_subject;
 elsif p_kind='survey' then select to_jsonb(s) into subject_row from public.operations_surveys s where id=p_subject;
 else raise exception '첨부 대상이 올바르지 않습니다' using errcode='22023';end if;
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
end $$;
create function public.operations_commit_file(p_id uuid,p_actor uuid,p_drive text,p_item text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare file_row public.operations_files;subject_row jsonb;
begin
 select * into file_row from public.operations_files where id=p_id for update;
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
end $$;
revoke all on function public.operations_reserve_file(uuid,uuid,text,uuid,text,integer,text,text,text),public.operations_commit_file(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.operations_reserve_file(uuid,uuid,text,uuid,text,integer,text,text,text),public.operations_commit_file(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
