import fs from 'node:fs';
const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Deployment secrets missing');
const query=fs.readFileSync(new URL('../repo-root/sql/operations-survey-delete.sql',import.meta.url),'utf8');
const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!r.ok)throw new Error('Survey delete migration failed: HTTP '+r.status);
console.log('Survey deletion and read policy applied');

const verification=`begin;
do $$
declare actor uuid; center text; item public.operations_surveys; removed public.operations_surveys; request uuid=gen_random_uuid();
begin
 if has_function_privilege('anon','public.operations_survey_delete(uuid,uuid,integer)','execute')
 or not has_function_privilege('authenticated','public.operations_survey_delete(uuid,uuid,integer)','execute')
 then raise exception 'Survey deletion function grants invalid'; end if;
 select id into actor from public.user_profiles where active and role='admin' limit 1;
 if actor is null then raise exception 'No active admin to verify deletion'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select code into center from public.centers where active and public.operations_can_write(code) and public.operations_resource_allowed('forms','edit',code) limit 1;
 if center is null then raise exception 'No editable center to verify deletion'; end if;
 insert into public.operations_surveys(center_code,title,details,created_by,updated_by) values(center,'삭제 검증 임시 조사','{}',actor,actor) returning * into item;
 begin
  perform public.operations_survey_delete(gen_random_uuid(),item.id,item.version+1);
  raise exception 'Wrong version deletion was accepted';
 exception when serialization_failure then null;
 end;
 removed=public.operations_survey_delete(request,item.id,item.version);
 if removed.deleted_at is null or removed.version<>item.version+1 then raise exception 'Deletion failed'; end if;
 removed=public.operations_survey_delete(request,item.id,item.version);
 if removed.version<>item.version+1 then raise exception 'Retry incremented version'; end if;
 if (select count(*) from public.operations_task_events where survey_id=item.id and request_id=request)<>1 then raise exception 'Duplicate deletion event'; end if;
end $$;
rollback;`;
const checked=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:verification}),signal:AbortSignal.timeout(60000)});
if(!checked.ok)throw new Error('Survey delete verification failed: HTTP '+checked.status);
console.log('Survey deletion grants, version conflict and idempotent retry verified in rolled-back transaction');
