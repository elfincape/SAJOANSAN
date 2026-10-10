begin;
create function public.operations_create_notion_task(
 p_page_id uuid,p_notion_actor uuid,p_request_id uuid,p_center text,p_title text,
 p_work_date date,p_inputs jsonb,p_base_values jsonb,p_edit_at timestamptz
) returns public.operations_tasks language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.operations_tasks; linked uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception '서버 전용 연결입니다' using errcode='42501'; end if;
 if p_page_id is null then raise exception '노션 페이지 ID가 필요합니다' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('notion-page:'||p_page_id::text,0));
 select task_id into linked from public.operations_notion_links where page_id=p_page_id;
 if found then select * into t from public.operations_tasks where id=linked;return t;end if;
 t:=public.operations_import_notion_task(p_notion_actor,p_request_id,null,null,p_center,p_title,p_work_date,p_inputs,'pending');
 insert into public.operations_notion_links(page_id,task_id,base_values,observed_edit_at)
 values(p_page_id,t.id,p_base_values,p_edit_at);
 return t;
end;$$;
revoke all on function public.operations_create_notion_task(uuid,uuid,uuid,text,text,date,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.operations_create_notion_task(uuid,uuid,uuid,text,text,date,jsonb,jsonb,timestamptz) to service_role;
commit;
