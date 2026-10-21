begin;
-- Search runs as the signed-in caller: existing master RLS remains authoritative.
create or replace function public.operations_search(p_query text,p_center text default null,p_page integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb; term text:=lower(trim(p_query));
begin
 if not public.operations_can_read() then raise exception '활성 계정으로 로그인해 주세요.' using errcode='42501'; end if;
 if term is null or length(term)<2 or length(term)>100 or p_page is null or p_page<0 or p_page>100 then
  raise exception '검색어는 2~100자, 검색 페이지는 0~100이어야 합니다.';
 end if;
 with sources(kind,data) as (
  select 'task',to_jsonb(t) from public.operations_tasks t
  union all select 'incident',to_jsonb(i) from public.operations_incidents i
  union all select 'survey',to_jsonb(s) from public.operations_surveys s
  union all select 'vehicles',to_jsonb(v) from public.vehicles v
  union all select 'drivers',to_jsonb(d) from public.drivers d
  union all select 'routes',to_jsonb(r) from public.routes r
  union all select 'companies',to_jsonb(c) from public.companies c
  union all select 'delivery_points',to_jsonb(d) from public.delivery_points d
  union all select 'file',jsonb_build_object('id',f.id,'center_code',f.center_code,'file_name',f.file_name,
   'original_name',f.original_name,'task_id',f.task_id,'incident_id',f.incident_id,'survey_id',f.survey_id,'status',f.status)
   from public.operations_files f where f.status='saved'
 ), normalized as (
  select kind,data->>'id' id,data->>'center_code' center_code,
   coalesce(nullif(data->>'title',''),nullif(data->>'plate_number',''),nullif(data->>'name',''),data->>'file_name',data->>'code','이름 없음') title,
   data->>'status' status,data->>'work_date' work_date,
   data->>'task_id' task_id,data->>'incident_id' incident_id,data->>'survey_id' survey_id,
   lower(concat_ws(' ',data->>'title',data->>'name',data->>'plate_number',data->>'car_number',data->>'phone',
    data->>'code',data->>'address',data->>'region',data->>'kind',data->>'note',data->>'description',
    data->>'file_name',data->>'original_name',case when kind in ('task','incident','survey') then coalesce(data->>'inputs',data->>'details') end)) haystack
   from sources
 ), matches as (
  select *,row_number() over(partition by kind order by title,id) ordinal,count(*) over(partition by kind) total
  from normalized where (p_center is null or center_code=p_center) and strpos(haystack,term)>0
 ), groups as (
  select kind,max(total) total,coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'center_code',center_code,
   'status',status,'work_date',work_date,'task_id',task_id,'incident_id',incident_id,'survey_id',survey_id) order by ordinal)
   filter(where ordinal>p_page*20 and ordinal<=(p_page+1)*20),'[]'::jsonb) items
  from matches group by kind
 ) select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'total',total,'items',items) order by kind),'[]'::jsonb) into result from groups;
 return jsonb_build_object('query',trim(p_query),'page',p_page,'groups',result);
end $$;
revoke all on function public.operations_search(text,text,integer) from public,anon;
grant execute on function public.operations_search(text,text,integer) to authenticated;
commit;
