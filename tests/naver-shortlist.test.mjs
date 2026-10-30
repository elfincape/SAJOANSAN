import assert from 'node:assert/strict';
import {createShortlistPlan, minimumRouteMeters, rankShortlist} from '../scripts/lib/naver-candidate-shortlist.mjs';

const now='2026-10-30T12:00:00Z';
const points=Object.fromEntries(['G','C','A','B','D','E','F'].map((id,i)=>[id,{id,coordinates:[127+i/100,37]}]));
const course=(n=4,rotation=0)=>({rotation,stops:rotation===2?['C',...['A','B','D','E','F'].slice(0,n),'G']:['G','C',...['A','B','D','E','F'].slice(0,n),rotation===1?'C':'G']});
const matrixFor=(plan,meters=100)=>plan.edges.filter(e=>!e.zeroCost).map(e=>({key:e.key,distanceMeters:meters,option:'traoptimal',measuredAt:now}));
const rank=(plan,matrix)=>rankShortlist(plan,matrix,{now});

for(const [n,count,edges] of [[4,24,16],[5,120,25]]){
 const plan=createShortlistPlan(course(n),points);
 assert.equal(plan.candidates.length,count);assert.equal(plan.edges.length,edges);
 assert.equal(plan.webWaypoints,n+1);assert.equal(plan.webEligible,n<=4);
 const result=rank(plan,matrixFor(plan));
 assert.equal(result.completeMatrix,true);assert.equal(result.candidates.length,3);
 assert.equal(result.globalMinimumGuaranteed,false);assert.equal(result.scores.length,count);
 assert.deepEqual(result.candidates.map(c=>c.index),[0,1,2]);
 assert.equal(result.candidates[0].scoreMeters,n*100);
 assert.equal(result.timestamps.length,edges);
 assert(!plan.edges.some(e=>e.from.id==='G'||e.to.id==='G'||e.to.id==='C'));
 assert.equal(result.scoreScope,'center-through-deliveries');
 assert.equal(result.candidates[0].apiPartialMeters,n*100);
 assert(plan.edges.some(e=>e.from.id==='A'&&e.to.id==='B'));
 assert(plan.edges.some(e=>e.from.id==='B'&&e.to.id==='A'));
}
for(const rotation of [1,2]){
 const plan=createShortlistPlan(course(5,rotation),points);
 assert.equal(plan.edges.length,25);
 assert.equal(plan.webWaypoints,rotation===1?6:5);
 assert(plan.candidates.every(c=>c.stops.at(-1)===(rotation===1?'C':'G')));
 assert(plan.candidates.every(c=>c.stops[0]===(rotation===1?'G':'C')));
}
{
 const plan=createShortlistPlan(course(3),points),matrix=matrixFor(plan,500);
 const desired=['G','C','D','A','B','G'];
 const candidate=plan.candidates.find(c=>JSON.stringify(c.stops)===JSON.stringify(desired));
 for(const key of candidate.matrixKeys)matrix.find(e=>e.key===key).distanceMeters=1;
 assert.deepEqual(rank(plan,matrix).candidates[0].stops,desired,'Road meters determine ranking regardless of city names or straight-line ordering');
 assert.equal(rank(plan,matrix).candidates.length,3,'Three deliveries still produce a top-three shortlist');
 const reverse=plan.edges.find(e=>e.from.id==='B'&&e.to.id==='A');
 assert.equal(matrix.find(e=>e.key===reverse.key).distanceMeters,500,'Directions remain asymmetric');
}
{
 const plan=createShortlistPlan(course(2),points);
 assert.equal(rank(plan,matrixFor(plan)).candidates.length,2);
 const missing=rank(plan,matrixFor(plan).slice(1));
 assert.equal(missing.completeMatrix,false);assert.equal(missing.candidates.length,0);assert(missing.missingKeys.length);
 for(const change of [{distanceMeters:1.5},{distanceMeters:-1},{distanceMeters:undefined,durationSeconds:1},{measuredAt:'2026-10-29T12:00:00Z'},{measuredAt:'2026-10-31T12:00:00Z'},{option:'unknown'},{status:'failed'}]){
  const matrix=matrixFor(plan);Object.assign(matrix[0],change);
  const bad=rank(plan,matrix);assert.equal(bad.completeMatrix,false);assert.equal(bad.candidates.length,0);assert(bad.invalidKeys.length);
 }
 assert.equal(rank(plan,[...matrixFor(plan),matrixFor(plan)[0]]).completeMatrix,false);
}
{
 const duplicate={...points,B:{id:'B',coordinates:points.A.coordinates}};
 const plan=createShortlistPlan({stops:['G','C','A','B','A','G']},duplicate);
 assert.equal(plan.candidates.length,3,'Repeated identical stops reuse optimizer permutation deduplication');
 assert(plan.edges.some(e=>e.zeroCost));
 assert.equal(new Set(plan.edges.map(e=>e.key)).size,plan.edges.length);
 const result=rank(plan,matrixFor(plan));assert.equal(result.completeMatrix,true);
 assert(result.scores.every(c=>c.scoreMeters===100));
 const changed=createShortlistPlan(course(2),points,{cartype:2});
 assert.notEqual(changed.edges[0].key,createShortlistPlan(course(2),points).edges[0].key);
 assert.throws(()=>createShortlistPlan(course(2),{...points,A:{coordinates:[NaN,37]}}));
 assert.throws(()=>createShortlistPlan({...course(2),rotations:2,rotation:0},points));
}
{
 const response={code:0,currentDateTime:'2026-10-30T21:00:00',route:{traoptimal:[{summary:{distance:321,duration:1}},{summary:{distance:250,duration:100}}],trafast:[{summary:{distance:300,duration:0}}]}};
 assert.deepEqual(minimumRouteMeters(response,['traoptimal','trafast'],now),{distanceMeters:250,option:'traoptimal',measuredAt:now});
 assert.throws(()=>minimumRouteMeters(response,['tracomfort'],now));
 assert.throws(()=>minimumRouteMeters({...response,code:3},['traoptimal'],now));
 assert.throws(()=>minimumRouteMeters({code:0,route:{traoptimal:[{summary:{distance:1.1}}]}},['traoptimal'],now));
 assert.throws(()=>minimumRouteMeters({code:0,route:{traoptimal:[{summary:{duration:100}}]}},['traoptimal'],now));
}
console.log('Naver shortlist: directed matrix, fixed rotations, 24/120 permutations, duplicates, fail-closed evidence and raw-meter option comparison passed');
