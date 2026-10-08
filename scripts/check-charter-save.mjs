const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Supabase deployment secrets are missing');
const query = `
begin;
do $check$
declare actor uuid;trip_id text:='charter-smoke-'||gen_random_uuid();payload jsonb;result jsonb;stored_version bigint;blocked boolean:=false;
begin
 select id into actor from public.user_profiles where active and role in ('admin','editor') order by role limit 1;
 if actor is null then raise exception 'No active editor available for rollback save verification';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 payload:=jsonb_build_object('id',trip_id,'centerCode','002','date',null,'deliveries',jsonb_build_array());
 result:=public.save_charter_trips('002',jsonb_build_array(jsonb_build_object('payload',payload,'expectedVersion',0)));
 if jsonb_array_length(result)<>1 or (result->0->>'version')::int<>1 then raise exception 'Insert result verification failed';end if;
 result:=public.save_charter_trips('002',jsonb_build_array(jsonb_build_object('payload',payload,'expectedVersion',1)));
 select version into stored_version from public.charter_trips where center_code='002' and id=trip_id;
 if stored_version<>2 then raise exception 'Update verification failed';end if;
 begin
  perform public.save_charter_trips('002',jsonb_build_array(jsonb_build_object('payload',payload,'expectedVersion',1)));
 exception when raise_exception then blocked:=true;
 end;
 if not blocked then raise exception 'Stale version was accepted';end if;
end $check$;
rollback;
`;
const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok){
 let detail=await response.text();for(const secret of [token,ref])detail=detail.split(secret).join('[redacted]');
 throw new Error('Charter DB save verification failed: '+detail.slice(0,1500));
}
console.log('Charter DB insert/update and stale-version rejection verified; test transaction rolled back');
