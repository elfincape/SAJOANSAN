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
