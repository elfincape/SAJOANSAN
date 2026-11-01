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
const nowon=addressSearch('서울시 노원구 동일로 191 가길 66');
assert.deepEqual(nowon.road,{street:'동일로191가길',number:'66'});assert.equal(nowon.province,'서울');assert.equal(nowon.city,'서울');assert(nowon.queries.some(q=>q.includes('동일로191가길 66')));assert(map.addressCandidateMatches(nowon,'서울 노원구 동일로191가길 66'));assert(!map.addressCandidateMatches(nowon,'서울 노원구 동일로 191'));assert(!map.addressCandidateMatches(nowon,'서울 노원구 동일로191가길 66-1'));
const garak=addressSearch('서울특별시 송파구양재대로932 판매동2층27-1');assert(map.addressCandidateMatches(garak,'서울 송파구 양재대로 932'));assert(!map.addressCandidateMatches(garak,'서울 강남구 양재대로 932'));assert(garak.addressOnly);assert(!addressSearch('서울특별시 서초구 잠원로 51 뉴코아 강남점 1층').addressOnly);assert(map.addressCandidateMatches(addressSearch('대전시 대덕구 한남로 150 번길 206'),'대전 대덕구 한남로150번길 206'));assert(map.addressCandidateMatches(addressSearch('경기도 광주시 도척면 궁평리 58'),'경기 광주시 도척면 궁평리 58'));
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
await reviewCheck('search evidence distinguishes empty/read-failed/blocked responses without secrets',async()=>{
 const response={status:()=>400,url:()=> 'https://map.naver.com/p/api/search/instant-search?query=test&coords=0,0&types=place,address&token=secret',headers:()=>({'content-type':'text/html; charset=utf-8','set-cookie':'secret','authorization':'secret'}),text:async()=>'<html><title>Access Denied</title>captcha token=secret</html>',finished:async()=>null,fromServiceWorker:()=>false};
 const evidence=await map.searchResponseEvidence(response);assert.deepEqual(evidence.coords,[0,0]);assert.equal(evidence.bodyFormat,'html');assert(evidence.markers.access&&evidence.markers.captcha);assert.equal(evidence.finished,true);assert(!JSON.stringify(evidence).includes('secret'));assert(!JSON.stringify(evidence).includes('cookie'));
 assert.equal((await map.searchResponseEvidence({...response,text:async()=>''})).bodyBytes,0);assert.equal((await map.searchResponseEvidence({...response,text:async()=>{throw Error('secret');}})).bodyReadFailed,true);
});
await reviewCheck('initial Naver input waits for normal page load completion',async()=>{
 let release,clicks=0,inputs=0;const page={goto:async(url,options)=>{assert.equal(options.waitUntil,'load');assert.equal(new URL(url).pathname,'/p/directions/-/-/-/car');await new Promise(r=>{release=r;});},getByRole:role=>role==='tab'?{click:async()=>{clicks++;}}:{first:()=>({waitFor:async()=>{inputs++;}})}};
 const opening=map.openCarDirections(page);await Promise.resolve();assert.equal(clicks,0);release();await opening;assert.equal(clicks,1);assert.equal(inputs,1);
});
await reviewCheck('raw provider refresh during option selection cannot be captured',async()=>{
 const otherAddress=pointAddress.replace('121','122'),otherLabel=pointLabel.replace('121','122'),other={...point,token:'3zp3AK,2AujZe,'+encodeURIComponent(otherLabel)+',,ADDRESS_POI',label:otherLabel,text:otherLabel,coordinates:[127.1542266,37.1440432]};
 const stops=[pointAddress,otherAddress,pointAddress,otherAddress,pointAddress],cache=new Map([[pointAddress,point],[otherAddress,other]]),url=map.naverCourseUrl(stops,cache),frame={url:()=>url},query=new URL('https://map.naver.com/p/api/directions/car');
 const parameters=stops.map(s=>cache.get(s).coordinates.join(',')+',name='+Buffer.from(cache.get(s).label).toString('base64url'));
 for(const [key,value] of [['start',parameters[0]],['goal',parameters[4]],['waypoints',parameters.slice(1,-1).join('|')],['crs','EPSG:4326'],['respversion','4'],['output','pbf']])query.searchParams.set(key,value);
 const listeners=new Map(),request={url:()=>query.href,timing:()=>({startTime:Date.now()+1}),frame:()=>frame},r={request:()=>request,url:()=>query.href,ok:()=>true,body:async()=>response};
 const cards={first:()=>({waitFor:async()=>{}}),evaluateAll:async()=>[{routeLabel:'실시간 추천',distanceText:'212km'}],nth:()=>({click:async()=>{const second={...r,request:()=>({...request})};listeners.get('response')?.(second);}})};
 const page={on:(k,fn)=>listeners.set(k,fn),off:k=>listeners.delete(k),setDefaultTimeout(){},setViewportSize:async()=>{},mainFrame:()=>frame,waitForResponse:async predicate=>{assert(predicate(r));return r;},goto:async()=>listeners.get('response')?.(r),locator:()=>cards,getByRole:()=>({evaluateAll:async()=>stops.map(s=>cache.get(s).label)}),mouse:{move:async()=>{}},waitForFunction:async()=>{},url:()=>url};
 await assert.rejects(()=>map.browserCourseCapture(page,stops,{addressCache:cache,screenshot:false}),/경로 응답이 변경/);assert(!listeners.size,'Request/response listeners are removed on failure');
});
assert.deepEqual(reviewFailures,[],reviewFailures.join('\n'));

// Consecutive identical coordinates must preserve every logical visit and only
// insert a proven zero leg, without removing a later return to the same point.
assert.equal(typeof map.consecutivePointPlan,'function');
assert.equal(typeof map.addressValidationFailure,'function');
assert.equal(map.addressValidationFailure('bad',{code:'ADDRESS_NOT_FOUND',reason:'SEARCH_NO_CANDIDATES',message:'no candidates'}).status,'not_found');
assert.equal(map.addressValidationFailure('two',{code:'ADDRESS_NOT_FOUND',reason:'SAME_ADDRESS_DUPLICATES',candidateSummaries:['A','B'],message:'ambiguous'}).status,'ambiguous');
assert.equal(map.addressValidationFailure('offline',{code:'NAVER_SEARCH_UNAVAILABLE',reason:'PROVIDER_HTTP_ERROR',message:'network'}).status,'network_error');
const preflightCached=await map.browserValidateAddress({},pointAddress,{addressCache:pointCache});assert.equal(preflightCached.status,'valid');assert.equal(preflightCached.source,'cache');assert.equal(preflightCached.point.token,pointToken);
const logical=['garage','center','delivery-a','delivery-a-alias','center','garage'];
const plan=map.consecutivePointPlan(logical,[{coordinates:[127,37]},{coordinates:[128,37]},{coordinates:[129,37]},{coordinates:[129,37]},{coordinates:[128,37]},{coordinates:[127,37]}]);
assert.deepEqual(plan.mapStops,['garage','center','delivery-a','center','garage']);
assert.deepEqual(plan.logicalToMap,[0,1,2,2,3,4]);
assert.deepEqual(map.expandLogicalLegs([10,20,30,40],plan.logicalToMap),[10,20,0,30,40]);
assert.deepEqual(map.expandLogicalLegs([10,null,30,40],plan.logicalToMap),[10,null,0,30,40]);
assert.throws(()=>map.expandLogicalLegs([10,20],plan.logicalToMap));
assert.deepEqual(map.consecutivePointPlan(['a','b'],[{coordinates:[127,37]},{coordinates:[127.00000001,37]}]).logicalToMap,[0,1]);
assert.throws(()=>map.consecutivePointPlan(['a','b'],[{coordinates:[NaN,37]},{coordinates:[NaN,37]}]));
{
 const otherAddress=pointAddress.replace('121','122'),otherLabel=pointLabel.replace('121','122');
 const other=map.naverPointFromUrl('https://map.naver.com/p/directions/3zp3AK,2AujZe,'+encodeURIComponent(otherLabel)+',,ADDRESS_POI/-/-/car',otherAddress,{text:otherLabel,label:otherLabel});
 const stops=[pointAddress,otherAddress,pointAddress,pointAddress,otherAddress,pointAddress],mapStops=[pointAddress,otherAddress,pointAddress,otherAddress,pointAddress],cache=new Map([[pointAddress,point],[otherAddress,other]]),url=map.naverCourseUrl(mapStops,cache),frame={url:()=>url},query=new URL('https://map.naver.com/p/api/directions/car');
 const parameters=mapStops.map(s=>cache.get(s).coordinates.join(',')+',name='+Buffer.from(cache.get(s).label).toString('base64url'));
 for(const [key,value] of [['start',parameters[0]],['goal',parameters[4]],['waypoints',parameters.slice(1,-1).join('|')],['crs','EPSG:4326'],['respversion','4'],['output','pbf']])query.searchParams.set(key,value);
 const listeners=new Map(),request={url:()=>query.href,timing:()=>({startTime:Date.now()+1}),frame:()=>frame},r={request:()=>request,url:()=>query.href,ok:()=>true,body:async()=>response};
 const cards={first:()=>({waitFor:async()=>{}}),evaluateAll:async()=>[{routeLabel:'실시간 추천',distanceText:'212km'}],nth:()=>({click:async()=>{}})};
 const page={on:(k,fn)=>listeners.set(k,fn),off:k=>listeners.delete(k),setDefaultTimeout(){},setViewportSize:async()=>{},mainFrame:()=>frame,waitForResponse:async predicate=>{assert(predicate(r));return r;},goto:async requested=>{assert.equal(requested,url);listeners.get('response')?.(r);},locator:()=>cards,getByRole:()=>({evaluateAll:async()=>mapStops.map(s=>cache.get(s).label)}),mouse:{move:async()=>{}},waitForFunction:async()=>{},url:()=>url};
 const result=await map.browserCourseCapture(page,stops,{addressCache:cache,screenshot:false});
 assert.deepEqual(result.requestedStops,stops);assert.equal(result.resolvedStops.length,6);assert.equal(result.distanceMeters,211800);
 assert.deepEqual(result.legEvidence.distancesMeters,[43594,50828,0,42665,74713]);assert(result.legEvidence.verified);
 assert.deepEqual(result.legEvidence.logicalPointMapping.logicalToMap,[0,1,2,2,3,4]);
 assert.deepEqual(result.legEvidence.logicalPointMapping.mapDistancesMeters,[43594,50828,42665,74713]);
 assert.equal(result.legEvidence.pathIdentity,evidence.routes[0].pathIdentity);assert(!listeners.size);

 const jsonDenied={...r,ok:()=>false,status:()=>400,text:async()=>JSON.stringify({error:{code:400,message:'Access denied'}}),json:async()=>({error:{code:400,message:'Access denied'}}),headers:()=>({'content-type':'application/json'})};
 await assert.rejects(()=>map.browserCourseCapture({...page,waitForResponse:async()=>jsonDenied,goto:async()=>listeners.get('response')?.(jsonDenied)},stops,{addressCache:cache,screenshot:false}),e=>{assert.equal(map.courseLocalRouteFailure(e),false,'JSON access markers must never enter independent-course continuation');return true;});
 const denied={...r,ok:()=>false,status:()=>429,text:async()=>'',headers:()=>({})};
 const rejected={...r,ok:()=>false,status:()=>400,text:async()=>'',headers:()=>({})};
 await assert.rejects(()=>map.browserCourseCapture({...page,waitForResponse:async()=>rejected,goto:async()=>listeners.get('response')?.(rejected)},stops,{addressCache:cache,screenshot:false}),e=>{
  const shape=e.routeDiagnostics.requestShape;assert.equal(shape.queryLength,null,'route requests do not use the search query field');assert(shape.paramKeys.includes('start')&&shape.paramKeys.includes('goal')&&shape.paramKeys.includes('waypoints'));assert.equal(shape.pointCount,mapStops.length);assert.equal(shape.coordinatesValid,true);return true;
 });

 const absentCards={...cards,first:()=>({waitFor:async()=>{throw Object.assign(Error('route panel timeout'),{name:'TimeoutError'});}})};
 const deniedPage={...page,waitForResponse:async predicate=>{assert(predicate(denied));return denied;},goto:async()=>listeners.get('response')?.(denied),locator:()=>absentCards};
 await assert.rejects(()=>map.browserCourseCapture(deniedPage,stops,{addressCache:cache,screenshot:false}),e=>e.code==='NAVER_ROUTE_UNAVAILABLE'&&e.reason==='PROVIDER_ACCESS_RESTRICTED'&&e.routeDiagnostics.responseEvidence.status===429);
 await assert.rejects(()=>map.browserCourseCapture({...deniedPage,waitForResponse:async()=>r,goto:async()=>listeners.get('response')?.(r)},stops,{addressCache:cache,screenshot:false}),e=>e.name==='TimeoutError'&&e.routeDiagnostics.stage==='route-panel'&&e.routeDiagnostics.rawRouteCount===1);
}

// A new selection with the same POI label must wait for its new URL token.
{
 const token='3zp3AK,2AujZe,Store,old,PLACE_POI',url='https://map.naver.com/p/directions/'+token+'/-/-/car';let value='';
 const input={fill:async s=>{value=s;},evaluate:async fn=>fn({value})};
 const response={url:()=> 'https://map.naver.com/p/api/search/instant-search?query=B',status:()=>200,ok:()=>true,finished:async()=>null,headers:()=>({}),text:async()=>'{}'};
 const options={first:()=>({waitFor:async()=>{}}),evaluateAll:async()=>[{text:'Store B',addressOnly:false}],nth:()=>({click:async()=>{value='Store';}})};
 const page={url:()=>url,locator:()=>options,getByRole:()=>({first:()=>input}),waitForResponse:async()=>response,waitForTimeout:async()=>{},waitForFunction:async(fn,args)=>{if(args?.label){const saved=globalThis.location;try{globalThis.location=new URL(url);if(!fn(args))throw Error('freshness rejected');}finally{if(saved===undefined)delete globalThis.location;else globalThis.location=saved;}}}};
 const result=await map.browserValidateAddress(page,'B',{routeContext:{validationReady:true}});
 assert.equal(result.status,'network_error');assert.equal(result.point,undefined,'Unchanged URL token cannot validate a different selected address');
}

// API partial-distance ranking selects candidates; the web compares full routes.
{
 const {createShortlistPlan,rankShortlist}=await import('../scripts/lib/naver-candidate-shortlist.mjs');
 const c={id:'row-4',sourceRow:4,name:'API shortlist fixture',stops:['G','C','A','B','D','G']},at='2026-10-30T01:00:00Z';
 const points=Object.fromEntries(['G','C','A','B','D'].map((a,i)=>[a,{coordinates:[127+i*.01,37]}]));
 const plan=createShortlistPlan(c,points),selection=rankShortlist(plan,plan.edges.filter(e=>!e.zeroCost).map(e=>({key:e.key,distanceMeters:100,option:'traoptimal',measuredAt:at})),{now:at});
 const looked=[];const result=await optimizeCourseCapture({},c,{candidatePlan:selection,measure:async(_p,stops,o)=>{
  const index=coursePermutations(c).findIndex(s=>JSON.stringify(s)===JSON.stringify(stops));looked.push(index);
  const detail={method:'naver-map-display',distanceMeters:[30000,10000,20000,1000,2000,3000][index],distanceKm:[30,10,20,1,2,3][index],distanceText:'web full route',routeLabel:'free',sourceUrl:'https://map.naver.com/p/directions/a/b/c/car',requestedStops:stops};
  return {...detail,...(o.screenshot||o.captureIf?.(detail)?{png:Buffer.from('winner-'+index)}:{})};
 }});
 assert.deepEqual(looked,[0,1,2]);assert.equal(result.distanceMeters,10000);assert.equal(result.png.toString(),'winner-1');assert.equal(result.optimization.total,3);assert.equal(result.optimization.allPermutations,6);assert.equal(result.optimization.globalMinimumGuaranteed,false);assert.equal(result.optimization.selection.candidates[0].apiPartialMeters,300);
 assert(captureResultVerified(c,{...result,imagePath:'winner.png'}));
 const bad=structuredClone(selection);bad.candidates[0].stops=['G','A','C','B','D','G'];await assert.rejects(()=>optimizeCourseCapture({},c,{candidatePlan:bad,measure:async()=>{throw Error('must not query');}}),e=>e.code==='SHORTLIST_INVALID_INPUT');
 const reordered=structuredClone(selection);reordered.candidates.reverse();
 const tied=await optimizeCourseCapture({},c,{candidatePlan:reordered,measure:async(_p,stops,o)=>{const r={method:'naver-map-display',distanceKm:5,distanceMeters:5000,distanceText:'5km',routeLabel:'free',requestedStops:stops};return {...r,...(o.screenshot||o.captureIf?.(r)?{png:Buffer.from('tie')}:{})};}});
 assert.deepEqual(tied.orderedStops,coursePermutations(c)[0],'Web ties use original permutation order, not API score order');
}

{
 const settings={cartype:'1',fueltype:'1',output:'pbf'};let checkpoint;
 await assert.rejects(()=>optimizeCourseCapture({},course,{measure:async(_p,stops)=>{
  if(stops[2]==='B'&&stops[3]==='A')throw Error('synthetic interruption');
  return{distanceKm:7,distanceText:'7km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:stops,requestSettings:settings};
 },onProgress:async state=>{checkpoint=structuredClone(state);}}),error=>error.code==='OPTIMIZATION_INCOMPLETE');
 const prior=structuredClone(checkpoint);
 await assert.rejects(()=>optimizeCourseCapture({},course,{previous:checkpoint,measure:async(_p,stops)=>({distanceKm:7,distanceText:'7km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:stops,requestSettings:{...settings,cartype:'2'},png:Buffer.from('wrong-settings')})}),error=>error.code==='OPTIMIZATION_SETTINGS_CHANGED');
 assert.deepEqual(checkpoint,prior,'changed conditions never alter the previous checkpoint');
}
