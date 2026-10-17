import assert from 'node:assert/strict';
import {calculateNaverRoute,naverSections} from '../supabase/functions/naver-distance/provider.js';
import {makeHandler} from '../supabase/functions/naver-distance/handler.js';
const env={SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',NAVER_MAPS_CLIENT_ID:'fake-id',NAVER_MAPS_CLIENT_SECRET:'fake-secret'};
let calls=[],allowed=true,validUser=true,ambiguous=false,providerStatus=200;
const response=data=>new Response(JSON.stringify(data));
const fetcher=async(url,init)=>{
 if(url.endsWith('/auth/v1/user'))return validUser?response({id:'user'}):new Response('',{status:401});
 if(url.endsWith('/rpc/operations_resource_allowed')){const p=JSON.parse(init.body);assert(['charter','delivery_points'].includes(p.p_resource));assert.equal(p.p_action,'read');assert(['001','002'].includes(p.p_center));if(p.p_resource==='charter')assert.equal(p.p_center,'002');return response(allowed);}
 const u=new URL(url);assert.equal(u.host,'maps.apigw.ntruss.com');assert.equal(init.headers['x-ncp-apigw-api-key-id'],'fake-id');assert.equal(init.headers['x-ncp-apigw-api-key'],'fake-secret');
 calls.push(u);
 if(providerStatus!==200)return new Response('',{status:providerStatus});
 if(u.pathname.includes('geocode')){const n=Number(u.searchParams.get('query'));return response({status:'OK',meta:{totalCount:ambiguous?2:1},addresses:[{x:127+n/10000,y:37}]});}
 const start=Number(u.searchParams.get('start').split(',')[0]),goal=Number(u.searchParams.get('goal').split(',')[0]);assert.notEqual(start,goal);
 const points=[u.searchParams.get('start'),...(u.searchParams.get('waypoints')?.split('|')??[]),u.searchParams.get('goal')];
 const count=points.length-1,option=u.searchParams.get('option');
 return response({code:0,route:{[option]:[{summary:{distance:count*1000,duration:count*2000},section:[{distance:999999}],guide:points.slice(1).flatMap((_,i)=>[{type:1,distance:600,duration:1000},{type:i===count-1?88:87,distance:400,duration:1000}])}]}});
};
const input=count=>({center:'002',origin:'0',priority:'RECOMMEND',stops:Array.from({length:count},(_,i)=>({address:String(i+1)}))});
for(const count of [1,3,6,7,16,17,30]){
 calls=[];const result=await calculateNaverRoute(input(count),env,fetcher);assert.equal(result.sections.length,count);assert(result.sections.every(s=>s.distanceMeters===1000&&s.durationSeconds===2));assert.equal(result.totalDistanceMeters,count*1000);
 const directions=calls.filter(c=>c.pathname.includes('direction'));assert.equal(directions.length,Math.ceil(count/16));
 for(const call of directions){const waypoints=call.searchParams.get('waypoints')?.split('|')??[];assert(waypoints.length<=15);assert.equal(call.pathname.includes('direction-15'),waypoints.length>5);}
 if(count===17)assert.equal(directions[1].searchParams.get('start'),directions[0].searchParams.get('goal'));
 assert(!JSON.stringify(result).includes('fake-secret'));
}
let result=await calculateNaverRoute({...input(1),stops:[{address:'0'},{address:'1'},{address:'1'}]},env,fetcher);assert.deepEqual(result.sections.map(s=>s.distanceMeters),[0,1000,0]);
result=await calculateNaverRoute({...input(1),stops:[{address:'1'},{address:'0'}]},env,fetcher);assert.equal(result.sections.length,2);
await assert.rejects(()=>calculateNaverRoute({...input(1),priority:'DISTANCE'},env,fetcher),/추천 경로/);
await assert.rejects(()=>calculateNaverRoute(input(1),{...env,NAVER_MAPS_CLIENT_SECRET:''},fetcher),/등록/);
ambiguous=true;await assert.rejects(()=>calculateNaverRoute(input(1),env,fetcher),/특정/);ambiguous=false;
providerStatus=401;await assert.rejects(()=>calculateNaverRoute(input(1),env,fetcher),/인증키/);providerStatus=429;await assert.rejects(()=>calculateNaverRoute(input(1),env,fetcher),/한도/);providerStatus=200;
assert.throws(()=>naverSections({summary:{distance:2000},guide:[{type:88,distance:1000,duration:2000}]},2),/착지별/);
assert.throws(()=>naverSections({summary:{distance:9999},guide:[{type:87,distance:1000,duration:2000},{type:88,distance:1000,duration:2000}]},2),/착지별/);
const handler=makeHandler(env,fetcher),req=(body=input(3),token='user',origin='https://sajoansan.vercel.app')=>new Request('https://db.test/functions/v1/naver-distance',{method:'POST',headers:{...(token?{authorization:'Bearer '+token}:{}),origin},body:JSON.stringify(body)});
assert.equal((await handler(req())).status,200);
calls=[];assert.equal((await handler(req(input(1),null))).status,401);assert.equal(calls.length,0);
allowed=false;assert.equal((await handler(req())).status,403);assert.equal(calls.length,0);allowed=true;
validUser=false;assert.equal((await handler(req())).status,401);validUser=true;
assert.equal((await handler(req({...input(1),center:'001'}))).status,400);assert.equal((await handler(req(input(1),'user','https://evil.test'))).status,403);
assert.equal((await handler(req(input(31)))).status,400);
assert.equal((await handler(req({...input(1),center:'001',resource:'delivery_points'}))).status,200);
assert.equal((await handler(req({...input(1),center:'003',resource:'delivery_points'}))).status,400);
allowed=false;calls=[];assert.equal((await handler(req({...input(1),center:'001',resource:'delivery_points'}))).status,403);assert.equal(calls.length,0);allowed=true;
console.log('Naver auth/scope, ordered variable stops, Directions 5/15 selection, 30-stop chunk continuity, waypoint guide segments, duplicates, loops and safe errors passed');

const {geocodeAddress,queryLeg,coordinateKey}=await import('../supabase/functions/naver-relations/provider.js');
let pairCalls=[];
const pairFetch=async(url,init)=>{
 const u=new URL(url);pairCalls.push(u);assert.equal(init.headers['x-ncp-apigw-api-key'],'fake-secret');
 if(u.pathname.includes('geocode'))return response({status:'OK',meta:{totalCount:1},addresses:[{x:'127.1',y:'37.1',roadAddress:'경기도 평택시 산단로 263'}]});
 assert.equal(u.searchParams.get('waypoints'),null);assert.equal(u.searchParams.get('option'),'traoptimal');
 return response({code:0,route:{traoptimal:[{summary:{distance:12345,duration:654321}}]}});
};
const p=await geocodeAddress('경기도 평택시 산단로 263',env,pairFetch);
assert.equal(p.x,127.1);assert.equal(p.y,37.1);assert.equal(p.standard_address,'경기도 평택시 산단로 263');
const q={x:127.2,y:37.2},leg=await queryLeg(p,q,env,pairFetch);
assert.equal(leg.distance_meters,12345);assert.equal(leg.duration_seconds,654.321);assert(leg.measured_at);
assert.notEqual(coordinateKey(p,q),coordinateKey(q,p));
const beforeSame=pairCalls.length;assert.equal((await queryLeg(p,p,env,pairFetch)).distance_meters,0);assert.equal(pairCalls.length,beforeSame);
for(const status of [401,403,429])await assert.rejects(()=>queryLeg(p,q,env,async()=>new Response('',{status})),e=>e.status===status);
await assert.rejects(()=>geocodeAddress('ambiguous',env,async()=>response({status:'OK',meta:{totalCount:2},addresses:[{},{}]})),e=>e.status===422);
await assert.rejects(()=>queryLeg(p,q,env,async()=>response({code:0,route:{traoptimal:[{summary:{distance:-1,duration:10}}]}})),/값/);
assert(!JSON.stringify(leg).includes('fake-secret'));
console.log('Persistent collector provider: one-call legs, directional coordinates, zero travel, exact geocoding and preserved 401/403/429 passed');

const {makeRelationsHandler}=await import('../supabase/functions/naver-relations/handler.js');
let relationCalls=[],relationAccess=true;
const relationFetcher=async(url,init)=>{
 relationCalls.push(url);
 if(url.endsWith('/auth/v1/user'))return response({id:'user'});
 if(url.endsWith('/rpc/operations_resource_allowed')){const b=JSON.parse(init.body);assert.equal(b.p_center,'002');assert.equal(b.p_action,'edit');return response(relationAccess);}
 throw Error('Unexpected external call '+url);
};
const relationHandler=makeRelationsHandler({...env,SUPABASE_SERVICE_ROLE_KEY:'service'},relationFetcher);
const relationReq=(body,token='user',origin='https://sajoansan.vercel.app')=>new Request('https://db.test/functions/v1/naver-relations',{method:'POST',headers:{...(token?{authorization:'Bearer '+token}:{}),origin},body:JSON.stringify(body)});
assert.equal((await relationHandler(relationReq({action:'preview',center:'002'},null))).status,401);
assert.equal((await relationHandler(relationReq({action:'preview',center:'001'}))).status,400);
assert.equal((await relationHandler(relationReq({action:'preview',center:'002'},'user','https://evil.test'))).status,403);
relationAccess=false;assert.equal((await relationHandler(relationReq({action:'preview',center:'002'}))).status,403);relationAccess=true;
const relationPreview=await relationHandler(relationReq({action:'preview',center:'002',rows:[{address:'주소 A'},{address:'주소 A'},{address:'주소 B'}]}));
assert.equal(relationPreview.status,200);const previewData=await relationPreview.json();assert.equal(previewData.stops,2);assert.equal(previewData.estimatedCandidates,4);
assert.equal((await relationHandler(relationReq({action:'preview',center:'002',limit:51,rows:[{address:'주소 A'}]}))).status,400);
assert(relationCalls.every(url=>url.startsWith('https://db.test/')));
console.log('Collector authentication, center edit scope, zero-call preview and candidate upper bounds passed');

const collectorStore={jobs:[],addresses:[],legs:[],geo:0,driving:0,cancelDuringGeo:false,providerCode:200};
const collectorFetch=async(url,init={})=>{
 const u=new URL(url),payload=init.body?JSON.parse(init.body):null,path=u.pathname;
 if(path.endsWith('/auth/v1/user'))return response({id:'user'});
 if(path.endsWith('/rpc/operations_resource_allowed'))return response(true);
 if(path.endsWith('/charter_trips'))return response([]);
 if(u.host==='maps.apigw.ntruss.com'){
  const geo=path.includes('geocode');if(geo)collectorStore.geo++;else collectorStore.driving++;
  if(collectorStore.cancelDuringGeo&&geo){collectorStore.jobs.at(-1).status='paused';collectorStore.cancelDuringGeo=false;}
  if(collectorStore.providerCode!==200)return new Response('',{status:collectorStore.providerCode});
  if(geo){const address=u.searchParams.get('query'),x=address.includes('산단로')?127:address.includes('A')?127.1:127.2;return response({status:'OK',meta:{totalCount:1},addresses:[{x:String(x),y:'37',roadAddress:address}]});}
  return response({code:0,route:{traoptimal:[{summary:{distance:1000,duration:60000}}]}});
 }
 assert.equal(u.host,'db.test');
 if(path.includes('/rpc/')){
  const j=collectorStore.jobs.find(j=>j.id===payload.p_job);
  if(path.endsWith('naver_api_claim')){
   if(!j||!['queued','running'].includes(j.status)||j.worker_id&&Date.parse(j.lease_until)>Date.now())return response(null);
   Object.assign(j,{status:'running',worker_id:payload.p_lock,lease_until:new Date(Date.now()+90000).toISOString()});return response(j);
  }
  if(path.endsWith('naver_api_reserve')){
   const kind=payload.p_kind,key=kind+'_attempts',budget=kind+'_budget';
   if(!j||j.status!=='running'||j.worker_id!==payload.p_lock||j[key]>=j[budget])return response(false);j[key]++;return response(true);
  }
  if(path.endsWith('naver_api_release')){
   if(!j||j.worker_id!==payload.p_lock)return response(null);
   Object.assign(j,{state:payload.p_state,status:j.status==='paused'?'paused':payload.p_status,error:payload.p_error,worker_id:null,lease_until:null,updated_at:new Date().toISOString()});return response(j);
  }
  if(path.endsWith('naver_api_save_address')||path.endsWith('naver_api_save_leg')){
   if(!j||j.worker_id!==payload.p_lock||Date.parse(j.lease_until)<=Date.now()||!['running','paused'].includes(j.status))return response(null);
   const value=payload.p_value,isAddress=path.endsWith('naver_api_save_address'),store=isAddress?collectorStore.addresses:collectorStore.legs,keys=isAddress?['center_code','address_key']:['center_code','from_id','to_id','priority','coords_key'];
   const prior=store.find(r=>keys.every(k=>r[k]===value[k]));
   if(prior){if(!prior.measured_at||!value.measured_at||Date.parse(value.measured_at)>=Date.parse(prior.measured_at))Object.assign(prior,value);return response(prior);}
   const row={id:crypto.randomUUID(),...value};store.push(row);return response(row);
  }
 }
 const table=path.split('/').at(-1),store=table==='naver_api_jobs'?collectorStore.jobs:table==='naver_api_addresses'?collectorStore.addresses:table==='naver_api_legs'?collectorStore.legs:null;
 assert(store,'Known collector table '+table);
 if(init.method==='POST'){
  if(table==='naver_api_jobs'){
   const j={...payload,id:crypto.randomUUID(),status:'queued',directions_attempts:0,geocoding_attempts:0,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};store.push(j);return response([j]);
  }
  const keys=(u.searchParams.get('on_conflict')||'id').split(','),prior=store.find(r=>keys.every(k=>r[k]===payload[k]));
  if(prior){Object.assign(prior,payload);return response([prior]);}const row={id:crypto.randomUUID(),...payload};store.push(row);return response([row]);
 }
 const filtered=store.filter(row=>[...u.searchParams].every(([k,v])=>v.startsWith('eq.')?String(row[k])===v.slice(3):v.startsWith('in.(')?v.slice(4,-1).split(',').includes(row[k]):true));
 if(init.method==='PATCH'){for(const row of filtered)Object.assign(row,payload);return response(filtered);}
 return response(filtered);
};
const batchHandler=makeRelationsHandler({...env,SUPABASE_SERVICE_ROLE_KEY:'service'},collectorFetch,async()=>{});
const invokeCollector=async body=>{const r=await batchHandler(relationReq(body));const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
const smallRows=[{address:'주소 A',sourceRow:2},{address:'주소 B',sourceRow:3},{address:'주소 A',sourceRow:4}];
let collected=await invokeCollector({action:'create',center:'002',rows:smallRows,directionsBudget:1});
collected=await invokeCollector({action:'batch',center:'002',jobId:collected.id});
assert.equal(collected.status,'completed');assert.equal(collected.directionsAttempts,1);assert.equal(collected.completed,1);assert.equal(collected.deferred,3);assert.equal(collectorStore.geo,3);
collected=await invokeCollector({action:'resume',center:'002',jobId:collected.id,directionsBudget:4,expectedUpdatedAt:collected.updatedAt});
collected=await invokeCollector({action:'batch',center:'002',jobId:collected.id});
assert.equal(collected.completed,4);assert.equal(collected.deferred,0);assert.equal(collectorStore.driving,4);assert.equal(collectorStore.geo,3);assert.equal(collectorStore.legs.length,4);
const beforeComplete=collectorStore.driving;await invokeCollector({action:'batch',center:'002',jobId:collected.id});assert.equal(collectorStore.driving,beforeComplete);
let cachedJob=await invokeCollector({action:'create',center:'002',rows:smallRows,directionsBudget:4});
for(let i=0;i<3&&cachedJob.status!=='completed';i++)cachedJob=await invokeCollector({action:'batch',center:'002',jobId:cachedJob.id});
assert.equal(cachedJob.completed,4);assert.equal(cachedJob.cached,4);assert.equal(cachedJob.directionsAttempts,0);assert.equal(cachedJob.geocodingAttempts,0);
assert.equal(collectorStore.geo,3);assert.equal(collectorStore.driving,4);
const foreignId=crypto.randomUUID();assert.equal((await batchHandler(relationReq({action:'status',center:'002',jobId:foreignId}))).status,404);
const foreignJob=await invokeCollector({action:'create',center:'002',rows:[{address:'new C'}]});collectorStore.providerCode=401;
const authFailed=await invokeCollector({action:'batch',center:'002',jobId:foreignJob.id});assert.equal(authFailed.status,'attention');assert.equal(authFailed.geocodingAttempts,1);collectorStore.providerCode=200;
const cancelledJob=await invokeCollector({action:'create',center:'002',rows:[{address:'new D'},{address:'new E'}]});collectorStore.cancelDuringGeo=true;const beforeCancel=collectorStore.geo;
const cancelledResult=await invokeCollector({action:'batch',center:'002',jobId:cancelledJob.id});assert.equal(cancelledResult.status,'paused');assert.equal(collectorStore.geo-beforeCancel,1);assert.equal(cancelledResult.geoDone,2);
assert(!JSON.stringify(cancelledResult).includes('fake-secret'));
console.log('Collector persistence, budget including center legs, deferred resume, cross-job cache, completed no-op, provider auth failure and in-flight cancellation passed');

collectorStore.addresses.push(...['창고 A','창고 B'].map(address=>({id:crypto.randomUUID(),center_code:'002',address_key:address,address,standard_address:'동일 건물 주소',x:127.3,y:37.3,status:'ready',measured_at:new Date().toISOString()})));
let sameBuilding=await invokeCollector({action:'create',center:'002',rows:[{address:'창고 A'},{address:'창고 B'}],directionsBudget:4});
sameBuilding=await invokeCollector({action:'batch',center:'002',jobId:sameBuilding.id});
assert.equal(sameBuilding.stops,2,'Provider-standard address/coordinates alone do not establish the same physical stop');
assert.equal(sameBuilding.candidates,4);assert.equal(sameBuilding.origin,'경기도 평택시 산단로 263');
assert.equal((await batchHandler(relationReq({action:'resume',center:'002',jobId:collected.id,directionsBudget:60,expectedUpdatedAt:'1970-01-01T00:00:00Z'}))).status,409,'A stale tab cannot overwrite the latest saved budget');
