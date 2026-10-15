import {query,quote} from './naver-browser-db.mjs';
await query(`begin;
do $test$ declare actor uuid;job uuid;n integer;begin
 select id into actor from public.user_profiles where active and role='admin' limit 1;
 if actor is null then raise exception 'No active admin for rollback queue verification';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 execute 'set local role authenticated';
 job:=public.naver_browser_enqueue('002','경기도 평택시 산단로 263','["경기도 오산시 성호대로 141"]'::jsonb);
 select count(*) into n from public.naver_browser_jobs where id=job;if n<>1 then raise exception 'Owner cannot read queued work';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 select count(*) into n from public.naver_browser_jobs where id=job;if n<>0 then raise exception 'Cross-user queue leak';end if;
 perform public.naver_browser_cancel(job);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if (select status from public.naver_browser_jobs where id=job)<>'queued' then raise exception 'Cross-user cancellation accepted';end if;
 perform public.naver_browser_cancel(job);
 if (select status from public.naver_browser_jobs where id=job)<>'cancelled' then raise exception 'Owner cancellation failed';end if;
end $test$;rollback;`);
console.log('Queue submit, owner-only read and cancellation verified; fixture rolled back');
if(process.argv.includes('--live')){
 const actors=await query("select id from public.user_profiles where active and role='admin' limit 1"),actor=actors[0]?.id;
 const result=await query("select set_config('request.jwt.claim.sub',"+quote(actor)+",true);select public.naver_browser_enqueue('002','경기도 평택시 산단로 263','[\"경기도 오산시 성호대로 141\"]'::jsonb) as id");
 const id=result.at(-1)?.id;if(!id)throw Error('Live queue fixture could not be created');
 try{
  const {runWorker}=await import('./naver-browser-worker.mjs');await runWorker({jobId:id});
  const rows=await query('select status,results from public.naver_browser_jobs where id='+quote(id)+'::uuid');
  const r=rows[0]?.results?.['경기도 오산시 성호대로 141'];if(rows[0]?.status!=='completed'||r?.method!=='naver-map-display'||r?.routeLabel!=='거리우선'||!(r?.distanceKm>0))throw Error('Live queued browser result verification failed');
  console.log('End-to-end server queue/browser/result persistence verified: '+r.distanceText);
 }finally{await query('delete from public.naver_browser_jobs where id='+quote(id)+'::uuid and owner_id='+quote(actor)+'::uuid');}
}
