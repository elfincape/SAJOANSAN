import assert from 'node:assert/strict';
import {distanceFromCard,regionFromAddress,addressSearch} from '../scripts/lib/naver-map-browser.mjs';
import {browserJobRows,watchBrowserJob,enqueueBrowserJob} from '../repo-root/js/naver-browser-model.js';
assert.equal(distanceFromCard('5 거리우선 30 분 15km 택시비 18000원').distanceKm,15);
assert.equal(distanceFromCard('거리 우선 2분 850m').distanceKm,.85);
assert.throws(()=>distanceFromCard('추천 15km'));
assert.throws(()=>distanceFromCard('거리우선 결과없음'));
assert.equal(regionFromAddress('서울특별시 강남구 도산대로 1').region,'서울 강남구');assert.equal(regionFromAddress('경기도 수원시 영통구 주소').region,'수원시');
const rows=[{address:'A'},{address:'B'}];
assert.equal(browserJobRows(rows,{status:'completed',results:{A:{method:'api',routeLabel:'추천',distanceKm:10}}})[0].distanceKm,undefined);
assert.equal(browserJobRows(rows,{status:'completed',results:{A:{method:'naver-map-display',routeLabel:'거리우선',distanceKm:15,regionKey:'x'}}})[0].distanceKm,15);
assert.equal(browserJobRows(rows,{status:'attention',results:{}})[1].issue,'미계산');
let polls=0,updates=0;const client={from:table=>{assert.equal(table,'naver_browser_jobs');const q={select:()=>q,eq:()=>q,single:async()=>({data:{status:++polls===1?'running':'completed',results:{}}})};return q;},rpc:async(name,body)=>{assert.equal(name,'naver_browser_enqueue');assert.equal(body.p_center,'001');return {data:'job'};}};
await watchBrowserJob(client,'job',()=>updates++,async()=>{});assert.equal(updates,2);assert.equal(await enqueueBrowserJob(client,'001','출발',['주소']),'job');
console.log('Genuine distance-priority-only parsing, display units, region grouping, candidate rejection and queued/terminal job handling passed');

assert.equal(addressSearch('경기도 가상시 이전면 예제로 72-8').queries.at(-1),'예제로 72-8');assert.equal(addressSearch('서울특별시 관악구 예제로1 예시동').queries.at(-1),'예제로 1');assert.equal(addressSearch('서울특별시 구로구 예제로 152, 지하 1층').road.number,'152');assert.equal(addressSearch('서울특별시 강서구 양천로 67길 99').road.street,'양천로67길');assert.equal(addressSearch('서울특별시 강서구 양천로 67길 99').gu,'강서구');

const map=await import('../scripts/lib/naver-map-browser.mjs');
assert.equal(typeof map.shortestRouteOption,'function','Every offered driving option is compared by road distance');
const routeChoice=map.shortestRouteOption([{routeLabel:'실시간 추천',distanceText:'184km'},{routeLabel:'무료우선',distanceText:'175km'},{routeLabel:'거리우선',distanceText:'184km'}]);
assert.equal(routeChoice.routeLabel,'무료우선');assert.equal(routeChoice.distanceKm,175);assert.equal(routeChoice.index,1);
assert.equal(map.shortestRouteOption([{routeLabel:'실시간 추천',distanceText:'850m'},{routeLabel:'거리우선',distanceText:'0.85km'}]).index,0);
assert.throws(()=>map.shortestRouteOption([{routeLabel:'추천',distanceText:'unknown'},{routeLabel:'거리우선',distanceText:'12km'}]),/경로 옵션/,'An unreadable alternative cannot be silently omitted');
assert.equal(typeof map.addressCandidateMatches,'function','Exact building-number comparison is required');
const hanam=addressSearch('경기도 하남시 미사강변대로 270');
assert(map.addressCandidateMatches(hanam,'경기 하남시 미사강변대로 270 미사강변 센트리버'));
for(const suffix of ['-1','-2','-3','0'])assert(!map.addressCandidateMatches(hanam,'경기 하남시 미사강변대로 270'+suffix));
assert.equal(map.chooseAddressCandidate(hanam,[{text:'경기 하남시 미사강변대로 270',addressOnly:false},{text:'경기 하남시 미사강변대로 270',addressOnly:true}]),1,'A unique exact road-address result is preferred for an address input');
assert.equal(map.chooseAddressCandidate(hanam,[{text:'경기 하남시 미사강변대로 270',addressOnly:false},{text:'경기 하남시 미사강변대로 270',addressOnly:false}]),-1,'Unverified duplicate POIs stay ambiguous');
assert.equal(addressSearch('경기도 경기도 김포시 양촌읍 듬박로 81-5').queries[0],'경기도 김포시 양촌읍 듬박로 81-5');
const parcel=addressSearch('경기도 경기도 이천시 부발읍 신하리 120번지');
assert(map.addressCandidateMatches(parcel,'경기 이천시 부발읍 신하리 120'),'Actual parcel address accepts province abbreviation and 번지 notation');
assert(!map.addressCandidateMatches(parcel,'경기 이천시 부발읍 신하리 120-1'));
assert(map.addressCandidateMatches(addressSearch('경기도 여주시 웅골로161'),'경기 여주시 웅골로 161'));
assert(!map.addressCandidateMatches(addressSearch('강원특별자치도 고성군 중앙로 1'),'경남 고성군 중앙로 1'),'Equal city/road/building in another province is a different location');
const formerSeo=addressSearch('인천광역시 인천광역시 서구 봉수대로 1274');assert(map.addressCandidateMatches(formerSeo,'인천 검단구 봉수대로 1274'),'Official Incheon 2026 district split preserves exact road addresses');assert(!map.addressCandidateMatches(formerSeo,'인천 부평구 봉수대로 1274'));assert(!map.addressCandidateMatches(formerSeo,'인천 검단구 봉수대로 1274-1'));
assert(!map.addressCandidateMatches(addressSearch('부산광역시 서구 중앙로 1'),'부산 강서구 중앙로 1'),'District names match complete administrative tokens, not substrings');
let fresh=false,selected=-1,searchTrace=[];
let currentQuery='';const addressInput={fill:async value=>{currentQuery=value;searchTrace.push('fill:'+value);if(!value)fresh=false;},evaluate:async()=>currentQuery};
const searchOptions={first:()=>({waitFor:async()=>{}}),evaluateAll:async()=>fresh?[{text:'경기 용인시 처인구 남사읍 당하로 121',addressOnly:false},{text:'경기 용인시 처인구 남사읍 당하로 121',addressOnly:true}]:[{text:'경기 하남시 미사강변대로 270',addressOnly:true}],nth:index=>({click:async()=>{selected=index;}})};
await map.selectAddress({locator:()=>searchOptions,waitForFunction:async()=>searchTrace.push('cleared'),waitForTimeout:async()=>{},waitForResponse:async predicate=>{searchTrace.push('await-new-response');assert(predicate({url:()=> 'https://map.naver.com/p/api/search/instant-search?query='+encodeURIComponent('경기도 용인시 처인구 남사읍 당하로 121')}));return {ok:()=>true,finished:async()=>{fresh=true;searchTrace.push('fresh-response');}};}},addressInput,'경기도 용인시 처인구 남사읍 당하로 121');
assert.equal(selected,1);assert(searchTrace.indexOf('await-new-response')<searchTrace.indexOf('fill:경기도 용인시 처인구 남사읍 당하로 121'));assert(searchTrace.includes('fresh-response'));
let cachedQuery='',cachedSelected=false;
const cachedInput={fill:async q=>{cachedQuery=q;},evaluate:async()=>cachedQuery};
const cachedOptions={first:()=>({waitFor:async()=>{}}),evaluateAll:async()=>[{text:'경기 용인시 처인구 남사읍 당하로 121',addressOnly:true}],nth:()=>({click:async()=>{cachedSelected=true;}})};
await map.selectAddress({locator:()=>cachedOptions,waitForFunction:async()=>{},waitForTimeout:async()=>{},waitForResponse:async()=>{throw Error('No network event for memoized autocomplete');}},cachedInput,'경기도 용인시 처인구 남사읍 당하로 121');assert(cachedSelected,'Fresh exact-address DOM candidates remain usable when Naver serves an in-memory cached query');

const {coursePermutations,optimizeCourseCapture,captureResultVerified}=await import('../scripts/lib/naver-course-optimizer.mjs');
const course={id:'row-8',stops:['G','C','A','B','D','G']};
const permutations=coursePermutations(course);
assert.equal(permutations.length,6);assert.equal(new Set(permutations.map(JSON.stringify)).size,6);
for(const stops of permutations){assert.deepEqual(stops.slice(0,2),['G','C']);assert.equal(stops.at(-1),'G');assert.deepEqual(stops.slice(2,-1).sort(),['A','B','D']);}
assert.deepEqual(coursePermutations({rotation:1,stops:['G','C','B','A','C']}).map(s=>[s[0],s[1],s.at(-1)]),[['G','C','C'],['G','C','C']]);
assert.deepEqual(coursePermutations({rotation:2,stops:['C','B','A','G']}).map(s=>[s[0],s.at(-1)]),[['C','G'],['C','G']]);
assert.equal(coursePermutations({stops:['G','C','A','A','B','G']}).length,3,'Repeated addresses preserve visits without equivalent queries');
let measurements=[],captures=[],states=[];
const roadMeasure=async(_page,stops,{screenshot})=>{(screenshot?captures:measurements).push(stops);const distanceKm=stops[2]==='D'&&stops[3]==='A'?4:12;return {distanceKm,distanceText:distanceKm+'km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:stops,...(screenshot?{png:Buffer.from('winner')}:{} )};};
let winner=await optimizeCourseCapture({},course,{measure:roadMeasure,onProgress:async s=>states.push(structuredClone(s))});
assert.equal(measurements.length,6);assert.equal(captures.length,1);assert.deepEqual(winner.orderedStops,['G','C','D','A','B','G'],'Actual road distance wins even when the input/straight-line order would be shorter');assert.deepEqual(captures[0],winner.orderedStops);assert.equal(winner.distanceKm,4);assert.equal(winner.optimization.complete,true);
const points={G:[0,0],C:[0,0],A:[1,0],B:[1,1],D:[0,1]};const straightDistance=stops=>stops.slice(1).reduce((sum,s,i)=>sum+Math.hypot(points[s][0]-points[stops[i]][0],points[s][1]-points[stops[i]][1]),0);assert(straightDistance(course.stops)<straightDistance(winner.orderedStops),'The geometric ranking deliberately disagrees with real-road lookup distances');
const stored={...winner,imagePath:'owned/winner.png',sourceUrl:'https://map.naver.com/p/directions/example'};
assert.equal(typeof captureResultVerified,'function','Deployment probe must validate the full comparison proof, not a fixed route label');
assert(captureResultVerified(course,stored));assert(!captureResultVerified(course,{...stored,optimization:{...stored.optimization,complete:false}}));assert(!captureResultVerified(course,{...stored,orderedStops:['G','D','C','A','B','G']}));assert(!captureResultVerified(course,{...stored,distanceKm:99}));
const tied=await optimizeCourseCapture({},course,{measure:async(_p,s,{screenshot})=>({distanceKm:5,distanceText:'5km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:s,...(screenshot?{png:Buffer.from('tie')}: {})})});assert.deepEqual(tied.orderedStops,course.stops,'Distance ties retain the original permutation order');
let checkpoint,attempts=0;
await assert.rejects(()=>optimizeCourseCapture({},course,{measure:async(_p,s)=>{attempts++;if(s[2]==='B'&&s[3]==='A')throw Error('network');return {distanceKm:7,distanceText:'7km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:s};},onProgress:async s=>{checkpoint=structuredClone(s);}}),e=>e.code==='OPTIMIZATION_INCOMPLETE');
assert.equal(checkpoint.completed,5);assert.equal(checkpoint.complete,false);
let retryMeasures=0;winner=await optimizeCourseCapture({},course,{previous:checkpoint,measure:async(_p,s,{screenshot})=>{if(!screenshot)retryMeasures++;return {distanceKm:7,distanceText:'7km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:s,...(screenshot?{png:Buffer.from('retry')}: {})};}});assert.equal(retryMeasures,1);assert(winner.optimization.complete);
let checks=0;await assert.rejects(()=>optimizeCourseCapture({},course,{checkActive:async()=>{if(++checks===3)throw Object.assign(Error('cancelled'),{code:'CAPTURE_PAUSED'});},measure:roadMeasure}),e=>e.code==='CAPTURE_PAUSED');
await assert.rejects(()=>optimizeCourseCapture({},course,{measure:async(_p,s,{screenshot})=>({distanceKm:screenshot?8:7,distanceText:screenshot?'8km':'7km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:s,...(screenshot?{png:Buffer.from('changed')}: {})})}),e=>e.code==='CAPTURE_DISTANCE_CHANGED');
console.log('Exact address selection, fixed-stop permutations, road-distance ranking, ties, checkpoints, retry, cancel and capture verification passed');

let snapshotQueries=0,snapshotCaptures=0;
const snapshotWinner=await optimizeCourseCapture({},course,{measure:async(_p,stops,{screenshot,captureIf})=>{
 snapshotQueries++;assert.equal(screenshot,false,'An available winning snapshot must avoid a new Naver route request');
 const distanceKm=stops[2]==='D'&&stops[3]==='A'?4:12;
 const result={distanceKm,distanceText:distanceKm+'km',routeLabel:'무료우선',method:'naver-map-display',requestedStops:stops,resolvedStops:stops};
 if(captureIf?.(result)){snapshotCaptures++;result.png=Buffer.from(stops.join('|'));}return result;
}});
assert.equal(snapshotQueries,6);assert.equal(snapshotCaptures,2,'Only a new strict best gets a snapshot; equal routes retain the earlier winner');assert.equal(snapshotWinner.png.toString(),snapshotWinner.orderedStops.join('|'));assert.equal(snapshotWinner.optimization.complete,true);assert(!Object.values(snapshotWinner.optimization.evaluations).some(e=>'png' in e),'Checkpoint JSON never contains screenshot buffers');

const rawApi=await import('../scripts/lib/naver-route-evidence.mjs');
const varint=n=>{const bytes=[];n=BigInt(n);do{bytes.push(Number(n&127n)|(n>127n?128:0));n>>=7n;}while(n);return Buffer.from(bytes);};
const field=(n,bytes)=>Buffer.concat([varint(n*8+2),varint(bytes.length),bytes]);
const packed=(n,values)=>field(n,Buffer.concat(values.map(varint)));
const numeric=(n,v)=>Buffer.concat([varint(n*8),varint(v)]);
const text=(n,v)=>field(n,Buffer.from(v));
// Minimal wire-schema fixture: one same-route summary, repeated waypoint positions and a raw total.
const keys=['distance','pointIndex','mainOption','subOption'].map(name=>field(1,text(1,name)));
const dictionary=field(23,Buffer.concat([...keys,packed(11,[211800*2,43594*2,50828*2,42665*2,74713*2,3*2,1*2,0]) ]));
const tags=(pairs)=>packed(1,pairs.flat());
const summary=Buffer.concat([tags([[0,0]]),...[[1,13],[2,13],[3,13],[4,12]].map(([value,n])=>field(n,tags([[0,value],[1,7]])))]);
const wirePath=field(2,packed(1,[0,0,2,2]));
const response=Buffer.concat([numeric(1,0),dictionary,field(21,Buffer.concat([field(1,summary),wirePath])),field(22,Buffer.concat([tags([[2,5],[3,6]]),packed(2,[0])]))]);
const evidence=rawApi.decodeNaverDirections(response);assert.equal(evidence.routes[0].distanceMeters,211800);assert.deepEqual(evidence.routes[0].legDistancesMeters,[43594,50828,42665,74713]);
const matched=rawApi.matchNaverRouteOptions(evidence,[{routeLabel:'실시간 추천',distanceText:'212km'}],5);assert.equal(matched[0].legsVerified,true);assert.equal(matched[0].distanceMeters,211800);
assert.throws(()=>rawApi.decodeNaverDirections(response.subarray(0,-1)),/네이버/,'Truncated provider response cannot invent a partial zero');
assert.throws(()=>rawApi.matchNaverRouteOptions(evidence,[{routeLabel:'무료우선',distanceText:'212km'}],5),/네이버/,'A different option cannot borrow this route legs');
assert.throws(()=>rawApi.matchNaverRouteOptions(evidence,[{routeLabel:'실시간 추천',distanceText:'220km'}],5),/네이버/,'Raw total must match the rendered distance precision');
assert.equal(rawApi.matchNaverRouteOptions(evidence,[{routeLabel:'실시간 추천',distanceText:'212km'}],4)[0].legsVerified,false,'Wrong stop count is explicit unknown evidence');
const broken=structuredClone(evidence);broken.routes[0].legDistancesMeters[2]=null;assert.equal(rawApi.matchNaverRouteOptions(broken,[{routeLabel:'실시간 추천',distanceText:'212km'}],5)[0].legsVerified,false,'A missing leg does not become zero');
assert.equal(map.shortestRouteOption([{routeLabel:'추천',distanceText:'103km',distanceMeters:103400},{routeLabel:'무료우선',distanceText:'103km',distanceMeters:103100}]).index,1,'Raw meters resolve displayed-distance ties');
assert.equal(typeof map.naverPointFromUrl,'function');
const pointAddress='경기도 용인시 처인구 남사읍 당하로 121',pointLabel='경기 용인시 처인구 남사읍 당하로 121',pointToken='3zp3AJ,2AujZe,'+encodeURIComponent(pointLabel)+',,ADDRESS_POI';
const point=map.naverPointFromUrl('https://map.naver.com/p/directions/'+pointToken+'/-/-/car',pointAddress,{text:pointLabel,label:pointLabel});
assert.equal(point.token,pointToken);assert.throws(()=>map.naverPointFromUrl('https://example.com/p/directions/'+pointToken+'/-/-/car',pointAddress,{text:pointLabel,label:pointLabel}),/네이버/);
assert.throws(()=>map.naverPointFromUrl('https://map.naver.com/p/directions/'+pointToken+'/-/-/car','경기도 용인시 처인구 남사읍 당하로 121-1',{text:pointLabel,label:pointLabel}),/네이버/);
const pointCache=new Map([[pointAddress,point]]),cachedUrl=map.naverCourseUrl([pointAddress,pointAddress,pointAddress],pointCache);
assert.deepEqual(new URL(cachedUrl).pathname.split('/').slice(3,6),[pointToken,pointToken,pointToken]);assert.equal(map.naverCourseUrl([pointAddress,'미해결 주소',pointAddress],pointCache),null);

const reviewFailures=[];const reviewCheck=async(name,fn)=>{try{await fn();}catch(e){reviewFailures.push(name+': '+e.message.split('\n')[0]);}};
await reviewCheck('same-total changed legs cannot resume a winning proof',async()=>{
 const c={id:'raw',stops:['G','C','A','G']};const old={distanceKm:3,distanceMeters:3000,distanceText:'3km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:c.stops,resolvedStops:c.stops,sourceUrl:'https://map.naver.com/p/directions/start/goal/via/car',legEvidence:{source:'naver-same-route-response',verified:true,totalMeters:3000,distancesMeters:[1000,1000,1000],pathIdentity:'old',providerOption:{main:9,sub:1}}};
 const first=await optimizeCourseCapture({},c,{measure:async(_p,_s,o)=>({...old,...(o.screenshot||o.captureIf?.(old)?{png:Buffer.from('old')}: {})})});
 const changed={...old,legEvidence:{...old.legEvidence,distancesMeters:[500,1000,1500],pathIdentity:'changed'}};
 await assert.rejects(()=>optimizeCourseCapture({},c,{previous:first.optimization,measure:async()=>({...changed,png:Buffer.from('new')})}),e=>e.code==='CAPTURE_DISTANCE_CHANGED');
 assert(!captureResultVerified(c,{...first,imagePath:'winner.png',...changed}));
});
await reviewCheck('waypoints cannot stand in for a missing goal',async()=>{
 const noGoalSummary=Buffer.concat([tags([[0,0]]),...[1,2,3,4].map(value=>field(13,tags([[0,value],[1,7]])))]);
 const noGoal=rawApi.decodeNaverDirections(Buffer.concat([numeric(1,0),dictionary,field(21,Buffer.concat([field(1,noGoalSummary),wirePath])),field(22,Buffer.concat([tags([[2,5],[3,6]]),packed(2,[0])]))]));
 const options=rawApi.matchNaverRouteOptions(noGoal,[{routeLabel:'실시간 추천',distanceText:'212km'}],5);assert.equal(options[0].legsVerified,false);assert(options[0].legDistancesMeters.every(n=>n===null));
});
await reviewCheck('request coordinates and navigation freshness',async()=>{
 assert.deepEqual(point.coordinates,[127.1542265,37.1440432]);assert.equal(typeof map.naverCourseRequestMatches,'function');
 const frame={url:()=>cachedUrl},query=new URL('https://map.naver.com/p/api/directions/car');for(const k of ['start','goal','waypoints'])query.searchParams.set(k,'127.1542265,37.1440432,name='+Buffer.from(pointLabel).toString('base64url'));
 query.searchParams.set('crs','EPSG:4326');query.searchParams.set('respversion','4');query.searchParams.set('output','pbf');
 const request={url:()=>query.href,timing:()=>({startTime:1001}),frame:()=>frame};const context={startedAt:1000,frame,url:cachedUrl};
 assert(map.naverCourseRequestMatches(request,[pointAddress,pointAddress,pointAddress],pointCache,context));query.searchParams.set('start','999999,888888,name='+Buffer.from(pointLabel).toString('base64url'));assert(!map.naverCourseRequestMatches(request,[pointAddress,pointAddress,pointAddress],pointCache,context));
 query.searchParams.set('start','127.1542265,37.1440432,name='+Buffer.from(pointLabel).toString('base64url'));assert(!map.naverCourseRequestMatches({...request,timing:()=>({startTime:999})},[pointAddress,pointAddress,pointAddress],pointCache,context));assert(!map.naverCourseRequestMatches({...request,frame:()=>({url:()=>cachedUrl})},[pointAddress,pointAddress,pointAddress],pointCache,context));
});
await reviewCheck('provider HTTP400 aborts query variants without blaming an address',async()=>{
 let queries=0;const input={fill:async q=>{if(q)queries++;}},options={first:()=>({waitFor:async()=>{throw Error('No candidates');}})};
  await assert.rejects(()=>map.selectAddress({locator:()=>options,waitForFunction:async()=>{},waitForResponse:async()=>({ok:()=>false,status:()=>400,url:()=> 'https://map.naver.com/p/api/search/instant-search?query=test&searchCoord=NaN;NaN&token=secret',json:async()=>({code:'400',message:'Invalid coordinates secret',token:'secret'})})},input,pointAddress),e=>{assert.equal(e.code,'NAVER_SEARCH_UNAVAILABLE');assert.equal(e.httpStatus,400);const d=e.searchDiagnostics[0];assert.equal(d.coordinateState,'invalid');assert.equal(d.requestShape.queryEncodingValid,true);assert.equal(d.responseShape.errorCategory,'coordinates');assert(!JSON.stringify(d).includes('secret'));return true;});assert.equal(queries,1);
});
await reviewCheck('raw provider refresh during option selection cannot be captured',async()=>{
 const stops=Array(5).fill(pointAddress),cache=new Map([[pointAddress,point]]),url=map.naverCourseUrl(stops,cache),frame={url:()=>url},query=new URL('https://map.naver.com/p/api/directions/car');
 for(const [key,value] of [['start','127.1542265,37.1440432'],['goal','127.1542265,37.1440432'],['waypoints',Array(3).fill('127.1542265,37.1440432,name='+Buffer.from(pointLabel).toString('base64url')).join('|')],['crs','EPSG:4326'],['respversion','4'],['output','pbf']])query.searchParams.set(key,key==='start'||key==='goal'?value+',name='+Buffer.from(pointLabel).toString('base64url'):value);
 const listeners=new Map(),request={url:()=>query.href,timing:()=>({startTime:Date.now()+1}),frame:()=>frame},r={request:()=>request,url:()=>query.href,ok:()=>true,body:async()=>response};
 const cards={first:()=>({waitFor:async()=>{}}),evaluateAll:async()=>[{routeLabel:'실시간 추천',distanceText:'212km'}],nth:()=>({click:async()=>{const second={...r,request:()=>({...request})};listeners.get('response')?.(second);}})};
 const page={on:(k,fn)=>listeners.set(k,fn),off:k=>listeners.delete(k),setDefaultTimeout(){},setViewportSize:async()=>{},mainFrame:()=>frame,waitForResponse:async predicate=>{assert(predicate(r));return r;},goto:async()=>listeners.get('response')?.(r),locator:()=>cards,getByRole:()=>({evaluateAll:async()=>stops.map(()=>pointLabel)}),mouse:{move:async()=>{}},waitForFunction:async()=>{},url:()=>url};
 await assert.rejects(()=>map.browserCourseCapture(page,stops,{addressCache:cache,screenshot:false}),/경로 응답이 변경/);assert(!listeners.size,'Request/response listeners are removed on failure');
});
assert.deepEqual(reviewFailures,[],reviewFailures.join('\n'));
