import assert from 'node:assert/strict';
import {DEFAULT_ORIGIN,DEFAULT_EFFICIENCY,efficiencyFor,originalStops,fuelResult,fuelSummary,fuelRows,RESULT_HEADERS,loadFuelTrips} from '../repo-root/js/charter-fuel-model.js';
import {makeHandler} from '../supabase/functions/kakao-distance/handler.js';
assert.equal(DEFAULT_ORIGIN,'경기도 평택시 산단로 263');assert.deepEqual(DEFAULT_EFFICIENCY,{'1':8.3,'2.5':6.7,'3.5':6,'5':4.8,'11':4});
assert.equal(efficiencyFor(21),4);assert.equal(efficiencyFor(11),4);assert.equal(efficiencyFor(2.5),6.7);assert.equal(efficiencyFor(null),null);assert.equal(efficiencyFor(7.5),null);
const trip={id:'one',tons:1,vehicleNumber:'PRIVATE_PLATE',driver:'PRIVATE_DRIVER',deliveries:[{id:'a',stopId:'H4',name:'착지 A',address:'주소 A'},{id:'b',stopId:'H4',name:'착지 B',address:'주소 A'},{id:'c',stopId:'H6',name:'착지 C',address:'주소 C'}]};
assert.deepEqual(originalStops(trip),[{name:'착지 A / 착지 B',address:'주소 A'},{name:'착지 C',address:'주소 C'}]);
const settings={efficiencies:DEFAULT_EFFICIENCY,price:1650};
const r=fuelResult(trip,{sections:[{distanceMeters:30000},{distanceMeters:53000}]},settings);
assert.equal(r.distanceKm,83);assert.equal(r.liters,10);assert(Math.abs(r.fuelCost-16500)<1e-8);assert(Math.abs(fuelSummary([r,{...r,id:'two'}])[0].averageFuelCost-16500)<1e-8);
assert.equal(r.rows[0].fromAddress,DEFAULT_ORIGIN);assert.equal(r.rows[1].fromAddress,'주소 A');assert.equal(r.rows[1].order,2);
assert.deepEqual(originalStops({deliveries:[{sourceRow:7,name:'후순위',address:'B'},{sourceRow:4,name:'선순위',address:'A'}]}).map(s=>s.address),['A','B']);
assert(!JSON.stringify(fuelRows([r])).includes('PRIVATE'));assert.equal(RESULT_HEADERS.length,7);
assert.throws(()=>fuelResult(trip,{sections:[]},settings));
assert.throws(()=>originalStops({...trip,deliveries:[...trip.deliveries,{stopId:'H4',address:'주소 X'}]}));
const selects=[],ranges=[];
const client={from:table=>{assert.equal(table,'charter_trips');const q={select:s=>{selects.push(s);return q;},eq:(field,value)=>{assert.equal(field,'center_code');assert.equal(value,'002');return q;},order:()=>q,gte:()=>q,lte:()=>q,range:(a,b)=>{ranges.push([a,b]);return q;},then:resolve=>resolve({data:[{id:trip.id,tons:1,deliveries:trip.deliveries}]})};return q;}};
const loaded=await loadFuelTrips(client,{from:'2026-10-01',through:'2026-10-13'});assert.equal(loaded[0].tons,1);assert(!selects[0].includes('vehicle')&&!selects[0].includes('driver'));assert(!('driver' in loaded[0]));
let allowed=true,ambiguous=false,routeFailed=false,providerCalls=[],requestBody;
const env={SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',KAKAO_REST_API_KEY:'test-key'};
const fetcher=async(url,init={})=>{
 if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'user'}));
 if(url.endsWith('/rpc/operations_resource_allowed')){assert.deepEqual(JSON.parse(init.body),{p_resource:'charter',p_action:'read',p_center:'002'});return new Response(JSON.stringify(allowed));}
 providerCalls.push(url);assert.equal(init.headers.Authorization,'KakaoAK test-key');
 if(url.includes('/search/address.json')){
  const address=new URL(url).searchParams.get('query'),x=address==='출발지'?127:address==='주소 A'?127.1:127.2;
  return new Response(JSON.stringify({meta:{total_count:ambiguous?2:1},documents:[{x,y:37}]}));
 }
 if(url.includes('/waypoints/directions')){requestBody=JSON.parse(init.body);return new Response(JSON.stringify({routes:[{result_code:routeFailed?101:0,sections:[{distance:30000,duration:1800},{distance:53000,duration:2400}]}]}));}
 if(url.includes('/v1/directions?'))return new Response(JSON.stringify({routes:[{result_code:0,summary:{distance:10000,duration:600}}]}));
 throw Error('Unexpected URL');
};
const handler=makeHandler(env,fetcher);
const call=(body={},token=true,origin='https://sajoansan.vercel.app')=>handler(new Request('https://db.test/functions/v1/kakao-distance',{method:'POST',headers:{...(token?{authorization:'Bearer user-token'}:{}),origin,'Content-Type':'application/json'},body:JSON.stringify({center:'002',origin:'출발지',priority:'DISTANCE',stops:[{address:'주소 A'},{address:'주소 C'}],...body})}));
let response=await call();assert.equal(response.status,200);let result=await response.json();assert.deepEqual(result.sections.map(s=>s.distanceMeters),[30000,53000]);assert.equal(result.totalDistanceMeters,83000);
assert.equal(requestBody.priority,'DISTANCE');assert.equal(requestBody.destination.x,127.2);assert.deepEqual(requestBody.waypoints,[{x:127.1,y:37}]);assert(!JSON.stringify(result).includes('test-key'));
allowed=false;providerCalls=[];assert.equal((await call()).status,403);assert.equal(providerCalls.length,0);allowed=true;
assert.equal((await call({},false)).status,401);assert.equal((await call({},true,'https://evil.test')).status,403);
assert.equal((await call({center:'001'})).status,400);assert.equal((await call({stops:[{address:''}]})).status,400);
assert.equal((await call({stops:Array(31).fill({address:'住所'})})).status,400);
ambiguous=true;assert.equal((await call()).status,422);ambiguous=false;
routeFailed=true;assert.equal((await call()).status,422);routeFailed=false;
response=await call({stops:[{address:'출발지'},{address:'주소 A'},{address:'주소 A'}]});assert.equal(response.status,200);result=await response.json();assert.deepEqual(result.sections.map(s=>s.distanceMeters),[0,10000,0]);
response=await call({stops:[{address:'주소 A'},{address:'출발지'}]});assert.equal(response.status,200);assert.equal((await response.json()).sections.length,2);
const missing=makeHandler({...env,KAKAO_REST_API_KEY:''},fetcher);assert.equal((await missing(new Request('https://db.test',{method:'POST',headers:{authorization:'Bearer user'},body:'{}'}))).status,503);
console.log('User defaults, merged stops, original order, one-way segments, 11+ ton grouping, fuel averages, private-field exclusion and authenticated Kakao scope passed');
