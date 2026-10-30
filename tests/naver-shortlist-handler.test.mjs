import assert from 'node:assert/strict';
import {makeRelationsHandler} from '../supabase/functions/naver-relations/handler.js';
import {queryShortlistLeg} from '../supabase/functions/naver-relations/provider.js';

const owner='00000000-0000-4000-8000-000000000001',validationId='00000000-0000-4000-8000-000000000002',jobId='00000000-0000-4000-8000-000000000003';
const env={SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'fake-anon',SUPABASE_SERVICE_ROLE_KEY:'fake-service',NAVER_MAPS_CLIENT_ID:'fake-id',NAVER_MAPS_CLIENT_SECRET:'fake-secret'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const point=(address,i)=>{const lng=127+i/100,lat=37,r=6378137;return {query:address,status:'valid',point:{label:address,text:address,coordinates:[lng,lat],token:`${lng*Math.PI/180*r},${Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))*r},${encodeURIComponent(address)},,ADDRESS_POI`}};};
const stops=['Garage','Center','Osan1','Ansan','Osan2','Seoul','Garage'];
function fixture({center='002',courseStops=stops,allowed=true,providerStatus=200,sourceOwner=owner,invalid=false,failAt=0}={}){
 let source={id:validationId,kind:'validation',status:'completed',owner_id:sourceOwner,center_code:center,courses:[{id:'course1',stops:courseStops}],results:Object.fromEntries([...new Set(courseStops)].map((s,i)=>[s,point(s,i)]))};
 if(invalid)source.results.Osan1.status='not_found';
 let job,calls=0,reservations=0,prior=[],denyReserve=false;const writes=[],waits=[];
 const fetcher=async(url,init={})=>{
  const u=new URL(url),query=u.searchParams;
  if(u.pathname.endsWith('/auth/v1/user'))return json({id:owner});
  if(u.pathname.endsWith('/rpc/operations_resource_allowed')){assert.equal(JSON.parse(init.body).p_center,center);assert.equal(JSON.parse(init.body).p_action,'edit');return json(allowed);}
  if(u.hostname==='maps.apigw.ntruss.com'){
   calls++;assert.equal(query.get('option'),'traoptimal:trafast:tracomfort');assert.equal(query.get('waypoints'),null);
   if(providerStatus!==200)return json({error:{errorCode:String(providerStatus),message:'fake-secret'}},providerStatus);
   if(calls===failAt)return json({code:3});
   return json({code:0,route:{traoptimal:[{summary:{distance:123,duration:1}}],trafast:[{summary:{distance:150,duration:0}}],tracomfort:[{summary:{distance:100,duration:999}}]}});
  }
  if(u.pathname.endsWith('/naver_browser_jobs')){assert.equal(query.get('owner_id'),'eq.'+owner);assert.equal(query.get('center_code'),'eq.'+center);return json(source.owner_id===owner?[source]:[]);}
  if(u.pathname.endsWith('/naver_api_jobs')){
   if(init.method==='POST'){job={id:jobId,status:'queued',...JSON.parse(init.body),directions_attempts:0,geocoding_attempts:0};writes.push(job);return json([job]);}
   assert.equal(query.get('owner_id'),'eq.'+owner);assert.equal(query.get('center_code'),'eq.'+center);
   return json(query.has('id')?(job?[job]:[]):query.has('status')?[]:prior);
  }
  if(u.pathname.endsWith('/rpc/naver_api_claim')){job={...job,status:'running'};return json(job);}
  if(u.pathname.endsWith('/rpc/naver_api_reserve')){assert.equal(JSON.parse(init.body).p_kind,'directions');reservations++;if(denyReserve)return json(false);job.directions_attempts++;return json(true);}
  if(u.pathname.endsWith('/rpc/naver_api_release')){const b=JSON.parse(init.body);job={...job,state:b.p_state,status:b.p_status,error:b.p_error};writes.push(structuredClone(job));return json(job);}
  throw Error('Unexpected mocked request '+url);
 };
 const handler=makeRelationsHandler(env,fetcher,async ms=>waits.push(ms));
 const request=async body=>{const response=await handler(new Request('https://db.test/functions/v1/naver-relations',{method:'POST',headers:{authorization:'Bearer fake-token'},body:JSON.stringify({center,...body})}));return {status:response.status,body:await response.json()};};
 return {request,get job(){return job;},get calls(){return calls;},get reservations(){return reservations;},writes,waits,setPrior:value=>{prior=value;},denyReserve:()=>{denyReserve=true;},source};
}

for(const center of ['001','002']){
 const f=fixture({center});let r=await f.request({action:'shortlist-create',validationJobId:validationId,points:{forged:true},courses:[]});
 assert.equal(r.status,200);assert.equal(f.job.state.kind,'capture-shortlist');assert.equal(f.job.directions_budget,16);assert.equal(f.job.geocoding_budget,0);assert.equal(f.calls,0);
 assert.deepEqual(f.job.state.courses[0].stops,stops,'Client-supplied courses and points are never trusted');
 r=await f.request({action:'shortlist-batch',jobId});assert.equal(f.calls,15);assert.equal(r.body.status,'queued');assert.equal(f.reservations,15);assert(f.waits.every(ms=>ms===500));
 r=await f.request({action:'shortlist-status',jobId});assert.equal(f.calls,15);assert.equal(r.body.complete,false);
 r=await f.request({action:'shortlist-batch',jobId});assert.equal(f.calls,16);assert.equal(r.body.status,'completed');assert.equal(r.body.complete,true);assert.equal(r.body.totalWebCandidates,3);assert.equal(r.body.shortlists.course1.candidates[0].scoreMeters,400);
 await f.request({action:'shortlist-batch',jobId});assert.equal(f.calls,16,'Completed batches cannot make more provider requests');
 const saved=structuredClone(f.job.state);
 for(const row of f.job.state.matrixRows)row.measuredAt='2020-01-01T00:00:00Z';
 const expired=await f.request({action:'shortlist-status',jobId});
 assert.equal(expired.body.complete,false);assert.equal(expired.body.completedCourses,0);assert.equal(expired.body.totalWebCandidates,0);assert.equal(expired.body.shortlists.course1.candidates.length,0);assert.equal(f.calls,16,'Expired status never retries a provider request');
 assert.equal(f.job.state.shortlists.course1.completeMatrix,true,'Status freshness checks do not mutate the stored historical shortlist');
 f.job.state=saved;
}
{
 const f=fixture({allowed:false});assert.equal((await f.request({action:'shortlist-create',validationJobId:validationId})).status,403);assert.equal(f.writes.length,0);
 const foreign=fixture({sourceOwner:'someone-else'});assert.equal((await foreign.request({action:'shortlist-create',validationJobId:validationId})).status,404);assert.equal(foreign.calls,0);
 const bad=fixture({invalid:true});const r=await bad.request({action:'shortlist-create',validationJobId:validationId});assert.equal(r.status,200);assert.equal(r.body.complete,false);assert.equal(r.body.totalWebCandidates,0);assert(r.body.issues.length);assert.equal(bad.calls,0);
 const tooMany=fixture({courseStops:['Garage','Center','A','B','D','E','F','Garage']});const blocked=await tooMany.request({action:'shortlist-create',validationJobId:validationId});assert.equal(blocked.body.totalWebCandidates,0);assert.equal(tooMany.job.directions_budget,0);assert(blocked.body.issues.some(i=>i.code==='WEB_WAYPOINT_LIMIT'));
}
for(const providerStatus of [401,403,429]){
 const f=fixture({providerStatus});await f.request({action:'shortlist-create',validationJobId:validationId});const r=await f.request({action:'shortlist-batch',jobId});assert.equal(f.calls,1);assert.equal(r.body.status,'attention');assert.equal(r.body.complete,false);assert.equal(r.body.totalWebCandidates,0);assert(!JSON.stringify(r.body).includes('fake-secret'));
 await f.request({action:'shortlist-batch',jobId});assert.equal(f.calls,1,'A provider access/quota rejection remains paused');
}
{
 const f=fixture();await f.request({action:'shortlist-create',validationJobId:validationId});f.denyReserve();const r=await f.request({action:'shortlist-batch',jobId});assert.equal(f.calls,0);assert.equal(r.body.status,'attention');assert.equal(r.body.complete,false);
}
{
 const previous=fixture();await previous.request({action:'shortlist-create',validationJobId:validationId});await previous.request({action:'shortlist-batch',jobId});await previous.request({action:'shortlist-batch',jobId});
 const f=fixture();f.setPrior([previous.job]);await f.request({action:'shortlist-create',validationJobId:validationId});const r=await f.request({action:'shortlist-batch',jobId});assert.equal(f.calls,0);assert.equal(r.body.complete,true);assert.equal(r.body.cached,16);
 const stale=structuredClone(previous.job);for(const row of stale.state.matrixRows)row.measuredAt='2020-01-01T00:00:00Z';
 const fresh=fixture();fresh.setPrior([stale]);await fresh.request({action:'shortlist-create',validationJobId:validationId});await fresh.request({action:'shortlist-batch',jobId});assert.equal(fresh.calls,15);
 const foreign=structuredClone(previous.job);foreign.owner_id='someone-else';
 const own=fixture();own.setPrior([foreign]);await own.request({action:'shortlist-create',validationJobId:validationId});await own.request({action:'shortlist-batch',jobId});assert.equal(own.calls,15,'Foreign owner cache is never reused');
 const otherCenter=structuredClone(previous.job);otherCenter.center_code='001';
 const sameCenter=fixture();sameCenter.setPrior([otherCenter]);await sameCenter.request({action:'shortlist-create',validationJobId:validationId});await sameCenter.request({action:'shortlist-batch',jobId});assert.equal(sameCenter.calls,15,'Other center cache is never reused');
}
{
 const f=fixture({failAt:1});f.source.courses.push({id:'unaffected-course',stops:['Garage','Center','Seoul','Garage']});
 await f.request({action:'shortlist-create',validationJobId:validationId});await f.request({action:'shortlist-batch',jobId});const r=await f.request({action:'shortlist-batch',jobId});
 assert.equal(r.body.status,'attention');assert.equal(r.body.complete,false);assert.equal(r.body.failed,1);
 assert.equal(r.body.shortlists.course1.completeMatrix,false);assert.equal(r.body.shortlists.course1.candidates.length,0);
 assert.equal(r.body.shortlists['unaffected-course'].completeMatrix,true);assert.equal(r.body.totalWebCandidates,1,'An individual leg failure preserves other completed courses');
 const zero=fixture({courseStops:['Same','Same','Same','Same']});const z=await zero.request({action:'shortlist-create',validationJobId:validationId});assert.equal(z.body.complete,true);assert.equal(z.body.shortlists.course1.candidates[0].apiPartialMeters,0);assert.equal(zero.calls,0);assert.equal(zero.job.directions_budget,0);
}
{
 const f=fixture();await f.request({action:'shortlist-create',validationJobId:validationId});f.job.owner_id='someone-else';
 assert.equal((await f.request({action:'shortlist-status',jobId})).status,404);assert.equal((await f.request({action:'shortlist-batch',jobId})).status,404);assert.equal(f.calls,0);
 const pending=fixture();pending.source.status='running';assert.equal((await pending.request({action:'shortlist-create',validationJobId:validationId})).status,404);
 const inconsistent=fixture();inconsistent.source.results.Osan1.point.coordinates[0]+=1;
 const r=await inconsistent.request({action:'shortlist-create',validationJobId:validationId});assert.equal(r.body.complete,false);assert.equal(inconsistent.calls,0);assert.equal(inconsistent.job.directions_budget,0);
}
{
 let count=0;const p={coordinates:[127,37]},q={coordinates:[128,37]};
 const result=await queryShortlistLeg(p,q,env,async()=>{count++;return json({code:0,route:{traoptimal:[{summary:{distance:300}}],trafast:[{summary:{distance:200}}],tracomfort:[{summary:{distance:100}}]}});});
 assert.equal(result.distanceMeters,100);assert.equal(count,1);
 await assert.rejects(()=>queryShortlistLeg(p,q,env,async()=>json({code:0,route:{traoptimal:[{summary:{distance:100}}]}})));
}
console.log('Shortlist Edge mocked create/batch/status: auth ownership, server snapshots, 15-call resumes, options, cache, budgets and access pauses passed');
