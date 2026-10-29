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
