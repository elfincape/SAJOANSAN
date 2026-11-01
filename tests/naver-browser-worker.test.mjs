import assert from 'node:assert/strict';
import {runWorker} from '../scripts/naver-browser-worker.mjs';
let clock=0,polls=0,closed=0,saved=[],served=false;
const job={id:'00000000-0000-0000-0000-000000000001',origin:'출발지',addresses:['착지'],cursor:0};
await runWorker({
 keepAlive:true,durationMs:90,pollMs:30,now:()=>clock,sleep:async ms=>{clock+=ms;},
 browserFactory:async()=>({newPage:async()=>({}),close:async()=>closed++}),
 db:async sql=>{
  if(sql.startsWith('with next')){polls++;if(clock>=30&&!served){served=true;return [job];}return [];}
  if(sql.startsWith('select status')||sql.endsWith('returning status'))return [{status:'running'}];saved.push(sql);return [];
 },
 lookup:async()=>({distanceKm:15,distanceText:'15km',method:'naver-map-display',routeLabel:'거리우선'}),log:()=>{}
});
assert(served,'An initially empty queue must accept new work without restarting');
assert(polls>=3);assert.equal(closed,1);assert(saved.some(sql=>sql.includes("status='completed'")));assert(saved.some(sql=>sql.includes('15km')));
let lookups=0,writes=[];
await runWorker({
 jobId:job.id,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),
 db:async sql=>{writes.push(sql);if(sql.startsWith('with next')){assert(sql.includes("and id='"+job.id+"'::uuid"));return [{...job,addresses:['A','B','C','D']}];}if(sql.startsWith('select status')||sql.endsWith('returning status'))return [{status:'running'}];return [];},
 lookup:async()=>{lookups++;throw Error('No route');},log:()=>{}
});
assert.equal(lookups,3);assert(writes.some(sql=>sql.includes("status='attention'")));
console.log('Idle worker accepts later jobs, persists progress, stops on access failures and isolates live fixtures');
{
 const calls=[],writes=[];const validateJob={...job,kind:'validation',addresses:['A','B','C'],results:{old:{query:'old',status:'valid'}}};
 await runWorker({jobId:job.id,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),db:async sql=>{if(sql.startsWith('with next'))return [validateJob];if(sql.startsWith('select status')||sql.endsWith('returning status'))return [{status:'running'}];writes.push(sql);return [];},validate:async(_page,address)=>{calls.push(address);return {query:address,status:address==='B'?'not_found':'valid'};},lookup:async()=>{throw Error('Validation must not run a road-distance query');},log:()=>{}});
 assert.deepEqual(calls,['A','B','C']);assert(writes.some(sql=>sql.includes("status='completed'")));assert(writes.some(sql=>sql.includes('not_found')));
 const paused=[];calls.length=0;
 await runWorker({jobId:job.id,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),db:async sql=>{if(sql.startsWith('with next'))return [validateJob];if(sql.startsWith('select status')||sql.endsWith('returning status'))return [{status:'running'}];paused.push(sql);return [];},validate:async(_page,address)=>{calls.push(address);return {query:address,status:'network_error',reason:'PROVIDER_ACCESS_RESTRICTED'};},lookup:async()=>{throw Error('No distance requests');},log:()=>{}});
 assert.deepEqual(calls,['A']);assert(paused.some(sql=>sql.includes("status='attention'")));assert(!paused.some(sql=>/cursor=1/.test(sql)));
}

let addressAttempts=0,addressWrites=[];
await runWorker({jobId:job.id,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),db:async sql=>{addressWrites.push(sql);if(sql.startsWith('with next'))return [{...job,addresses:['A','B','C','D']}];if(sql.startsWith('select status')||sql.endsWith('returning status'))return [{status:'running'}];return [];},lookup:async()=>{addressAttempts++;throw Object.assign(Error('Missing address'),{code:'ADDRESS_NOT_FOUND'});},log:()=>{}});
assert.equal(addressAttempts,4);assert(addressWrites.some(sql=>sql.includes("status='completed'")));assert(!addressWrites.some(sql=>sql.includes("status='attention'")));console.log('Individual missing addresses do not halt the remaining destinations');

const rotated=[{id:'row-10',rotation:1,stops:['G','C','A','B','C']},{id:'row-11',rotation:2,stops:['C','D','E','G']}];
let captureWrites=[],measuredRoutes=[],storedCourses=[];
await runWorker({jobId:job.id,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),db:async sql=>{captureWrites.push(sql);if(sql.startsWith('with next'))return [{...job,kind:'capture',courses:rotated,addresses:rotated.map(c=>c.id),results:{}}];if(sql.startsWith('select status')||sql.endsWith('returning status'))return [{status:'running'}];return [];},capture:async(_p,stops,{screenshot}={})=>{measuredRoutes.push({stops,screenshot});if(stops.includes('E'))throw Object.assign(Error('1번째 방문지 주소를 한 곳으로 특정하지 못했습니다.'),{code:'ADDRESS_NOT_FOUND'});return {distanceKm:10,distanceText:'10km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:stops,...(screenshot?{png:Buffer.from('png')}: {})};},saveCapture:async(_job,c)=>{storedCourses.push(c.id);return c.id+'.png';},log:()=>{}});
assert.deepEqual(storedCourses,['row-10'],'Only a fully compared rotation is stored');
assert.equal(measuredRoutes.filter(r=>r.screenshot===false&&!r.stops.includes('E')).length,2);
assert(captureWrites.some(s=>s.includes('"complete":true')),'A complete permutation proof is persisted');
assert(captureWrites.some(s=>s.includes('"completed":1')),'Permutation progress is persisted before the final image');
assert(captureWrites.some(s=>s.includes('row-11')&&s.includes('ADDRESS_NOT_FOUND')));
assert(captureWrites.some(s=>s.includes("status='completed'")),'One address error preserves the successful other rotation');
let cancelled=false,cancelWrites=[],cancelCaptures=0;
await runWorker({jobId:job.id,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),db:async sql=>{cancelWrites.push(sql);if(sql.startsWith('with next'))return [{...job,kind:'capture',courses:[rotated[0]],addresses:['row-10'],results:{}}];if(sql.startsWith('select status')||sql.endsWith('returning status'))return [{status:cancelled?'cancelled':'running'}];return [];},capture:async()=>{cancelCaptures++;cancelled=true;return {distanceKm:10,distanceText:'10km',routeLabel:'거리우선',method:'naver-map-display'};},saveCapture:async()=>{throw Error('A cancelled comparison must not upload');},log:()=>{}});
assert.equal(cancelCaptures,1);assert(!cancelWrites.some(s=>s.includes('cursor=1')));assert(!cancelWrites.some(s=>s.includes("status='completed'")));
console.log('Permutation checkpoints, per-rotation image isolation, partial success and cancellation without cursor advancement passed');

let ownsLease=true,leaseMeasures=0,leaseUploads=0,leaseWrites=[];
await runWorker({jobId:job.id,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),db:async sql=>{leaseWrites.push(sql);if(sql.startsWith('with next'))return [{...job,kind:'capture',courses:[rotated[0]],addresses:['row-10'],results:{}}];if(sql.endsWith('returning status'))return ownsLease?[{status:'running'}]:[];if(sql.startsWith('select status')||sql.endsWith('returning status'))return [{status:'running'}];return [];},capture:async()=>{leaseMeasures++;ownsLease=false;return {distanceKm:1,distanceText:'1km',routeLabel:'거리우선',method:'naver-map-display'};},saveCapture:async()=>{leaseUploads++;return 'unexpected.png';},log:()=>{}});
assert.equal(leaseMeasures,1,'A reclaimed running job must stop at its next lease check');assert.equal(leaseUploads,0);assert(!leaseWrites.some(s=>s.includes('cursor=1')));

let providerQueries=0,providerWrites=[];
await runWorker({jobId:job.id,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),db:async sql=>{providerWrites.push(sql);if(sql.startsWith('with next'))return [{...job,kind:'capture',courses:rotated,addresses:rotated.map(c=>c.id),results:{'previous-success':{imagePath:'keep.png'}}}];if(sql.startsWith('select status')||sql.endsWith('returning status'))return [{status:'running'}];return [];},capture:async()=>{providerQueries++;throw Object.assign(Error('네이버 검색 요청 HTTP400'),{code:'NAVER_SEARCH_UNAVAILABLE',httpStatus:400});},saveCapture:async()=>{throw Error('No incomplete upload');},log:()=>{}});
assert.equal(providerQueries,1,'A common search rejection must not poison every permutation and rotation');assert(providerWrites.some(s=>s.includes("status='attention'")));assert(!providerWrites.some(s=>s.includes('cursor=1')||s.includes('cursor=2')));assert(!providerWrites.some(s=>s.includes("status='completed'")));assert(!providerWrites.some(s=>/set results\s*=\s*'/.test(s)),'Only merge current issue/checkpoint; preserve previous success');

{
 const {naverPointFromUrl}=await import('../scripts/lib/naver-map-browser.mjs'),{createShortlistPlan,rankShortlist}=await import('../scripts/lib/naver-candidate-shortlist.mjs');
 const c={id:'row-2',sourceRow:2,name:'Trusted shortlist worker fixture',stops:['G','C','A','B','D','G']},checks={};
 for(const address of new Set(c.stops)){const token='3zp3AK,2AujZe,'+address+',id,PLACE_POI';checks[address]={query:address,status:'valid',point:naverPointFromUrl('https://map.naver.com/p/directions/'+token+'/-/-/car',address,{label:address,text:address})};}
 const plan=createShortlistPlan(c,Object.fromEntries(Object.entries(checks).map(([a,r])=>[a,r.point]))),selection=rankShortlist(plan,[],{now:new Date().toISOString()});
 const selectedJob={...job,kind:'capture',owner_id:job.id,center_code:'002',validation_job_id:job.id,shortlist_job_id:job.id,candidate_plans:{'row-2':selection},courses:[c],addresses:['row-2'],results:{keep:{imagePath:'keep.png'}}};let measured=0,stored=0;const changes=[];
 const db=async sql=>{if(sql.startsWith('with next'))return[selectedJob];if(sql.startsWith('select results'))return[{results:checks}];if(sql.startsWith('select status')||sql.endsWith('returning status'))return[{status:'running'}];changes.push(sql);return[];};
 await runWorker({jobId:job.id,db,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),capture:async(_p,stops,o)=>{measured++;const r={distanceKm:10,distanceMeters:10000,distanceText:'10km',routeLabel:'free',method:'naver-map-display',requestedStops:stops,sourceUrl:'https://map.naver.com/p/directions/a/b/c/car'};return{...r,...(o.screenshot||o.captureIf?.(r)?{png:Buffer.from('winner')}:{})};},saveCapture:async()=>{stored++;return'winner.png';},log:()=>{}});
 assert.equal(measured,3);assert.equal(stored,1);assert(changes.some(s=>s.includes('naver-api-top3-web-meters-v1')&&s.includes('globalMinimumGuaranteed')));assert(!changes.some(s=>/set results\s*=\s*'/.test(s)));
}

{
 let heartbeat=0,measures=0,claims=0;const pauses=[];
 await runWorker({jobId:job.id,sleep:async ms=>pauses.push(ms),browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),
  db:async sql=>{if(sql.startsWith('with next')){claims++;return[{...job,kind:'capture',courses:[rotated[0]],addresses:[rotated[0].id],results:{}}];}if(sql.startsWith('select status'))return[{status:'running'}];if(sql.endsWith('returning status')){if(++heartbeat===1)throw Object.assign(Error('synthetic queue502'),{status:502});return[{status:'running'}];}return[];},
  capture:async(_p,stops,o)=>{measures++;const result={distanceKm:10,distanceText:'10km',method:'naver-map-display',routeLabel:'거리우선',requestedStops:stops};return{...result,...(o.screenshot||o.captureIf?.(result)?{png:Buffer.from('winner')}:{})};},saveCapture:async()=> 'synthetic.png',log:()=>{}});
 assert.equal(claims,1);assert.equal(measures,2);assert.equal(pauses.length,1,'queue retry reuses the current comparison, not the whole route job');
}
{
 const {optimizeCourseCapture}=await import('../scripts/lib/naver-course-optimizer.mjs');
 const c=rotated[0],proof=await optimizeCourseCapture({},c,{measure:async(_p,stops,o)=>{const r={distanceKm:10,distanceText:'10km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:stops,sourceUrl:'https://map.naver.com/p/directions/a/b/c/car'};return{...r,...(o.screenshot||o.captureIf?.(r)?{png:Buffer.from('winner')}:{})};}});
 const {png,...saved}=proof;saved.imagePath='already-saved.png';let repeatedQueries=0,repeatedUploads=0;
 await runWorker({jobId:job.id,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),db:async sql=>sql.startsWith('with next')?[{...job,kind:'capture',courses:[c],addresses:[c.id],cursor:0,results:{[c.id]:saved}}]:sql.startsWith('select status')||sql.endsWith('returning status')?[{status:'running'}]:[],capture:async()=>{repeatedQueries++;throw Error('Unexpected query');},saveCapture:async()=>{repeatedUploads++;return'repeated.png';},log:()=>{}});
 assert.equal(repeatedQueries,0,'confirmed capture must not be queried again after lost cursor acknowledgment');assert.equal(repeatedUploads,0);
}
{
 let attempts=0,advanced=false,measured=0;const sleeps=[];
 await assert.rejects(()=>runWorker({jobId:job.id,sleep:async ms=>sleeps.push(ms),browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),
  db:async sql=>{if(sql.startsWith('with next'))return[{...job,kind:'capture',courses:[rotated[0]],addresses:[rotated[0].id],results:{}}];if(sql.startsWith('select status'))return[{status:'running'}];if(sql.endsWith('returning status')){attempts++;throw Object.assign(Error('synthetic queue502'),{status:502});}if(sql.includes('cursor='))advanced=true;return[];},capture:async()=>{measured++;return{};},log:()=>{}}),/queue502/);
 assert.equal(attempts,3);assert.equal(sleeps.length,2);assert.equal(advanced,false,'persistent queue outage is not recorded as a route failure or completed cursor');assert.equal(measured,0);
 let claims=0;await assert.rejects(()=>runWorker({jobId:job.id,sleep:async()=>assert.fail('ambiguous claims must not be replayed'),browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),db:async()=>{claims++;throw Object.assign(Error('claim acknowledgment lost'),{status:502});},log:()=>{}}),/acknowledgment/);assert.equal(claims,1);
}
{
 const {saveCourseCapture}=await import('../scripts/lib/naver-capture-storage.mjs');
 const previous={ref:process.env.SUPABASE_PROJECT_REF,token:process.env.SUPABASE_ACCESS_TOKEN};
 process.env.SUPABASE_PROJECT_REF='abcdefghijklmnopqrst';process.env.SUPABASE_ACCESS_TOKEN='SYNTHETIC_MANAGEMENT_TOKEN';
 let posts=0;const paths=[];
 try{
  const fetcher=async(url,options)=>{if(url.includes('/api-keys'))return Response.json([{name:'service_role',api_key:'SYNTHETIC_STORAGE_KEY'}]);paths.push(url);posts++;return new Response(null,{status:posts===1?502:200});};
  const c={id:'row-2'},j={owner_id:'owner',id:'frozen-job'};
  const first=await saveCourseCapture(j,c,'worker-one',Buffer.from('png'),fetcher,{sleep:async()=>{}});
  const second=await saveCourseCapture(j,c,'worker-two',Buffer.from('png'),fetcher,{sleep:async()=>{}});
  assert.equal(first,second);assert.equal(new Set(paths).size,1,'same frozen output has one object path after retry/worker reconnect');assert.equal(posts,3);
  const newer=await saveCourseCapture(j,c,'worker-new',Buffer.from('newer-png'),fetcher,{sleep:async()=>{}});assert.notEqual(first,newer,'late stale upload cannot overwrite a different verified image');
 }finally{for(const [name,value]of [['SUPABASE_PROJECT_REF',previous.ref],['SUPABASE_ACCESS_TOKEN',previous.token]])if(value===undefined)delete process.env[name];else process.env[name]=value;}
}
{
 let uploads=0;const writes=[];
 await runWorker({jobId:job.id,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),db:async sql=>{if(sql.startsWith('with next'))return[{...job,kind:'capture',courses:rotated,addresses:rotated.map(c=>c.id),results:{}}];if(sql.startsWith('select status')||sql.endsWith('returning status'))return[{status:'running'}];writes.push(sql);return[];},capture:async(_p,stops,o)=>{const r={distanceKm:10,distanceText:'10km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:stops};return{...r,...(o.screenshot||o.captureIf?.(r)?{png:Buffer.from('winner')}:{})};},saveCapture:async()=>{uploads++;throw Object.assign(Error('synthetic storage outage'),{code:'CAPTURE_STORAGE_UNAVAILABLE'});},log:()=>{}});
 assert.equal(uploads,1,'storage outage pauses before starting another independent rotation');assert.ok(writes.some(s=>s.includes("status='attention'")));assert.ok(!writes.some(s=>s.includes('cursor=1')));assert.ok(writes.some(s=>s.includes('"complete":true')),'completed route proof remains durable before storage retry');
}

{
 let beats=0,advanced=false;
 await assert.rejects(()=>runWorker({jobId:job.id,sleep:async()=>{},browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),db:async sql=>{
  if(sql.startsWith('with next'))return[{...job,kind:'capture',courses:[rotated[0]],addresses:[rotated[0].id],results:{}}];if(sql.startsWith('select status'))return[{status:'running'}];if(sql.endsWith('returning status')){beats++;if(beats>=3&&beats<=5)throw Object.assign(Error('queue failed inside capture'),{status:502});return[{status:'running'}];}if(sql.includes('cursor=1'))advanced=true;return[];
 },capture:async(_p,stops,options)=>{await options.checkActive();return{distanceKm:7,distanceText:'7km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:stops,png:Buffer.from('png')};},saveCapture:async()=> 'unexpected.png',log:()=>{}}),/inside capture/);
 assert.equal(advanced,false,'queue failures inside browser measurement stay infrastructure failures');
}
