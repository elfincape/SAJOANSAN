import {randomUUID} from 'node:crypto';
import {query,quote} from './naver-browser-db.mjs';
import {captureResultVerified} from './lib/naver-course-optimizer.mjs';
async function inspectPublicSearch(page,run){
 const pending=[],failures=[],responses=[];
 const failed=request=>{try{const u=new URL(request.url());if(/(?:^|\.)naver\.(?:com|net)$/.test(u.hostname)||u.hostname.endsWith('.pstatic.net'))failures.push({host:u.hostname,path:u.pathname,type:request.resourceType(),error:request.failure()?.errorText});}catch{}};
 const status=response=>{try{const u=new URL(response.url());if(response.status()>=400)responses.push({host:u.hostname,path:u.pathname,status:response.status()});}catch{}};
 const inspect=response=>{if(response.status()>=400&&new URL(response.url()).pathname==='/p/api/search/instant-search')pending.push((async()=>{
  const url=new URL(response.url()),body=await response.text().catch(()=>''),contentType=response.headers()['content-type'];let error;
  try{const json=JSON.parse(body),detail=typeof json.error==='object'&&json.error?json.error:json;error=Object.fromEntries(['code','message','error','status'].filter(key=>typeof detail[key]==='string'||typeof detail[key]==='number').map(key=>[key,String(detail[key]).slice(0,160)]));}catch{error={htmlTitle:body.match(/<title>([^<]{0,160})<\/title>/i)?.[1]};}
  console.error(JSON.stringify({event:'public_search_http_error',status:response.status(),contentType,bodyBytes:Buffer.byteLength(body),query:url.searchParams.get('query'),paramKeys:[...url.searchParams.keys()],coordinates:Object.fromEntries(['coords','x','y','longitude','latitude','searchCoord','boundary'].filter(key=>url.searchParams.has(key)).map(key=>[key,url.searchParams.get(key)])),error}));
 })());};
 // Called only for the public fixtures below; never user jobs, headers or cookies.
 page.on('response',inspect);page.on('response',status);page.on('requestfailed',failed);
 try{return await run();}catch(error){console.error(JSON.stringify({event:'public_probe_page_state',title:await page.title().catch(()=>''),url:page.url(),controls:await page.locator('button,[role="tab"],[role="combobox"]').evaluateAll(es=>es.slice(0,35).map(e=>({role:e.getAttribute('role')||e.tagName,label:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,100)}))).catch(()=>[]),bodyState:await page.locator('body').evaluate(el=>{const text=el.innerText;return {length:text.length,loading:/로딩|불러오|loading/i.test(text),accessRestricted:/접근.*제한|비정상.*접근|captcha|자동입력|Access Denied/i.test(text),error:/오류|문제|error|실패/i.test(text)};}).catch(()=>null),failures:failures.slice(-20),responses:responses.slice(-20)}));throw error;}
 finally{page.off('response',inspect);page.off('response',status);page.off('requestfailed',failed);await Promise.allSettled(pending);}
}
async function waitForResult(id,db=query,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
 for(let attempt=0;attempt<36;attempt++) {
  const rows=await db('select status,results from public.naver_browser_jobs where id='+quote(id)+'::uuid');
  if(!rows[0])throw Error('Server verification job disappeared');
  if(!['queued','running'].includes(rows[0].status))return rows[0];
  await sleep(5000);
 }
 throw Error('Server verification result wait timed out');
}
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
await query(`begin;
do $checkpoint$ declare actor uuid; previous uuid; resumed uuid; fixture jsonb; begin
 select id into actor from public.user_profiles where active and role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 fixture:=jsonb_build_array(jsonb_build_object('id','row-2','sourceRow',2,'name','Public checkpoint verification','stops',jsonb_build_array('경기도 오산시 경기대로 78-7','경기도 안산시 단원구 성곡로 125','경기도 용인시 처인구 남사읍 당하로 121','경기도 오산시 경기대로 78-7')));
 previous:=public.naver_capture_enqueue('002',fixture);
 update public.naver_browser_jobs set status='attention',results='{"row-2":{"optimization":{"version":1,"policy":"naver-all-driving-options-meters-v2","completed":1}}}'::jsonb where id=previous;
 resumed:=public.naver_capture_enqueue('002',fixture,previous);
 if not exists(select 1 from public.naver_browser_jobs where id=resumed and results->'row-2'->'optimization'->>'completed'='1' and addresses @> '["row-2"]'::jsonb) then raise exception 'Exact-meter retry checkpoint was dropped or treated as a completed image';end if;
end $checkpoint$;
rollback;`);
console.log('Exact-meter retry checkpoint survives queue resubmission; transactional fixture rolled back');
if(process.argv.includes('--live')){
 const actors=await query("select id from public.user_profiles where active and role='admin' limit 1"),actor=actors[0]?.id;
 const result=await query("select set_config('request.jwt.claim.sub',"+quote(actor)+",true);select public.naver_browser_enqueue('002','경기도 평택시 산단로 263','[\"경기도 오산시 성호대로 141\"]'::jsonb) as id");
 const id=result.at(-1)?.id;if(!id)throw Error('Live queue fixture could not be created');
 try{
  const {runWorker}=await import('./naver-browser-worker.mjs');
  const {browserDistance}=await import('./lib/naver-map-browser.mjs');
  await runWorker({jobId:id,lookup:async(page,origin,address)=>{
   try{return await inspectPublicSearch(page,()=>browserDistance(page,origin,address,{diagnostic:true}));}
   catch(e){
    // This probe uses only the public fixture addresses above, never user jobs or credentials.
    console.error(JSON.stringify({event:'public_distance_probe_failed',code:e.code??e.name,message:String(e.message).split('\n').slice(0,12).join('\n'),searchDiagnostics:e.searchDiagnostics,url:page.url(),inputs:await page.getByRole('combobox').evaluateAll(es=>es.map(e=>e.value)).catch(()=>[]),suggestions:await page.locator('[id^="instant-search-item-poi-"]').allTextContents().catch(()=>[])}));
    throw e;
   }
  }});
  const completed=await waitForResult(id);
  const r=completed.results?.['경기도 오산시 성호대로 141'];if(completed.status!=='completed'||r?.method!=='naver-map-display'||r?.routeLabel!=='거리우선'||!(r?.distanceKm>0))throw Error('Live queued browser result verification failed');
  console.log('End-to-end server queue/browser/result persistence verified: '+r.distanceText);
 }finally{await query('delete from public.naver_browser_jobs where id='+quote(id)+'::uuid and owner_id='+quote(actor)+'::uuid');}
}
if(process.argv.includes('--capture')) {
 const actors=await query("select id from public.user_profiles where active and role='admin' limit 1"),actor=actors[0]?.id;
 // Public street addresses from the reported input; an isolated two-rotation smoke fixture.
 const stops=['경기도 오산시 경기대로 78-7','경기도 안산시 단원구 성곡로 125','경기도 용인시 처인구 남사읍 당하로 121','경기도 오산시 경기대로 78-7'];
 const courses=[{id:'row-2',sourceRow:2,name:'공개 주소 검증 1회',rotation:1,groupName:'공개 주소 검증',garage:stops[0],center:stops[1],stops:[...stops.slice(0,-1),stops[1]]},{id:'row-3',sourceRow:3,name:'공개 주소 검증 2회',rotation:2,groupName:'공개 주소 검증',garage:stops[0],center:stops[1],stops:[...stops.slice(1,-1),stops[0]]}];
 const reservationId=randomUUID();
 const result=await query("do $probe$ declare job uuid;begin perform set_config('request.jwt.claim.sub',"+quote(actor)+",true);job:=public.naver_capture_enqueue('002',"+quote(JSON.stringify(courses))+"::jsonb);update public.naver_browser_jobs set status='running',worker_id="+quote(reservationId)+"::uuid,updated_at=now() where id=job;end $probe$;select id from public.naver_browser_jobs where worker_id="+quote(reservationId)+"::uuid");
 const id=result.at(-1)?.id;if(!id)throw Error('Capture queue fixture could not be created');
 let images=[];
 try {
  const {runWorker}=await import('./naver-browser-worker.mjs');
  const {browserCourseCapture}=await import('./lib/naver-map-browser.mjs');
  await runWorker({jobId:id,reservationId,capture:async(page,addresses,options)=>{
   return inspectPublicSearch(page,()=>browserCourseCapture(page,addresses,options));
  }});
  const completed=await waitForResult(id);
  images=Object.values(completed.results??{}).map(r=>r.imagePath).filter(Boolean);
  if(completed.status!=='completed'||images.length!==2||new Set(images).size!==2||courses.some(course=>!captureResultVerified(course,completed.results[course.id]))){
   console.error(JSON.stringify({event:'public_capture_probe_failed',status:completed.status,results:courses.map(course=>{const r=completed.results?.[course.id];return {rotation:course.rotation,issue:r?.issue,image:!!r?.imagePath,addressReason:r?.addressReason,addressDiagnostics:r?.addressDiagnostics,comparison:r?.optimization?{completed:r.optimization.completed,total:r.optimization.total,failed:r.optimization.failed}:null};})}));
   throw Error('Live multi-course capture/storage verification failed');
  }
  console.log('Two separate actual Naver rotation screenshots (garage to center, then center to garage) uploaded to private Storage and saved to distinct course results');
 }finally {
  const {removeCourseCaptures}=await import('./lib/naver-capture-storage.mjs');
  // Keep the owned job if cleanup fails so its private files remain traceable.
  await removeCourseCaptures(images);
  await query('delete from public.naver_browser_jobs where id='+quote(id)+'::uuid and owner_id='+quote(actor)+'::uuid');
 }
}
