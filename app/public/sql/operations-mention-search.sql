begin;
-- Clone the current search function, retaining its invoker RLS and permission checks.
do $migration$
declare source text;
begin
 source:=pg_get_functiondef('public.operations_search(text,text,integer)'::regprocedure);
 if position('length(term)<2' in replace(source,' ',''))=0 then raise exception '검색 함수의 최소 길이를 확인하세요';end if;
 source:=replace(source,'operations_search(','operations_mention_search(');
 source:=regexp_replace(source,'length\(term\)\s*<\s*2','length(term)<1','g');
 source:=replace(source,'2~100','1~100');
 execute source;
end $migration$;
revoke all on function public.operations_mention_search(text,text,integer) from public,anon;
grant execute on function public.operations_mention_search(text,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
