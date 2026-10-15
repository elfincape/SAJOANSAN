import assert from 'node:assert/strict';
import {runWorker} from '../scripts/naver-browser-worker.mjs';
let clock=0,polls=0,closed=0,saved=[],served=false;
const job={id:'00000000-0000-0000-0000-000000000001',origin:'출발지',addresses:['착지'],cursor:0};
await runWorker({
 keepAlive:true,durationMs:90,pollMs:30,now:()=>clock,sleep:async ms=>{clock+=ms;},
 browserFactory:async()=>({newPage:async()=>({}),close:async()=>closed++}),
 db:async sql=>{
  if(sql.startsWith('with next')){polls++;if(clock>=30&&!served){served=true;return [job];}return [];}
  if(sql.startsWith('select status'))return [{status:'running'}];saved.push(sql);return [];
 },
 lookup:async()=>({distanceKm:15,distanceText:'15km',method:'naver-map-display',routeLabel:'거리우선'}),log:()=>{}
});
assert(served,'An initially empty queue must accept new work without restarting');
assert(polls>=3);assert.equal(closed,1);assert(saved.some(sql=>sql.includes("status='completed'")));assert(saved.some(sql=>sql.includes('15km')));
let lookups=0,writes=[];
await runWorker({
 jobId:job.id,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),
 db:async sql=>{writes.push(sql);if(sql.startsWith('with next')){assert(sql.includes("and id='"+job.id+"'::uuid"));return [{...job,addresses:['A','B','C','D']}];}if(sql.startsWith('select status'))return [{status:'running'}];return [];},
 lookup:async()=>{lookups++;throw Error('No route');},log:()=>{}
});
assert.equal(lookups,3);assert(writes.some(sql=>sql.includes("status='attention'")));
console.log('Idle worker accepts later jobs, persists progress, stops on access failures and isolates live fixtures');
