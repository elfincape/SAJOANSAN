const fail=(message,status=502)=>Object.assign(new Error(message),{status});
const same=(a,b)=>Math.abs(a.x-b.x)<1e-7&&Math.abs(a.y-b.y)<1e-7;
export function destinationRegion(address){
 const text=[address.roadAddress,address.jibunAddress].filter(Boolean).join(' ');
 const province=address.addressElements?.find(e=>e.types?.includes('SIDO')||e.type?.includes('SIDO'))?.longName||text.split(' ')[0]||'';
 const seoul=/서울/.test(province),district=text.match(/(?:^|\s)([가-힣]+구)(?=\s|$)/)?.[1];
 const city=text.match(/(?:^|\s)([가-힣]+(?:특별자치시|광역시|특별시|시|군))(?=\s|$)/g)?.map(s=>s.trim()).find(s=>!s.endsWith('도'));
 const local=seoul?district:city;
 return local?{region:seoul?'서울 '+local:local,regionKey:province+'|'+local}:{region:'',regionKey:''};
}
export function naverSections(route,count){
 if(count===1)return [{distanceMeters:route.summary?.distance,durationSeconds:route.summary?.duration/1000}];
 const sections=[];let distance=0,duration=0;
 for(const guide of route.guide??[]){
  if(!Number.isFinite(guide.distance)||guide.distance<0||!Number.isFinite(guide.duration)||guide.duration<0)throw fail('네이버 구간거리 응답을 확인하지 못했습니다.');
  distance+=guide.distance;duration+=guide.duration;
  if(guide.type===87||guide.type===88){sections.push({distanceMeters:distance,durationSeconds:duration/1000});distance=0;duration=0;}
 }
 if(sections.length!==count||distance!==0||duration!==0||Math.abs(sections.reduce((n,s)=>n+s.distanceMeters,0)-route.summary?.distance)>count)throw fail('네이버 착지별 거리 응답을 확인하지 못했습니다.');
 return sections;
}
export async function calculateNaverRoute(input,env,fetcher=fetch,signal=AbortSignal.timeout(90000)){
 const id=env.NAVER_MAPS_CLIENT_ID,key=env.NAVER_MAPS_CLIENT_SECRET;
 if(!id||!key)throw fail('네이버 Client ID·Client Secret 등록을 확인해 주세요.',503);
 const option={RECOMMEND:'traoptimal',TIME:'trafast',MIN_DISTANCE:'traoptimal:trafast:tracomfort'}[input.priority];
 if(!option)throw fail('네이버는 추천 경로 또는 최단시간을 선택해 주세요.',400);
 const headers={'x-ncp-apigw-api-key-id':id,'x-ncp-apigw-api-key':key,Accept:'application/json'};
 async function request(url){
  const r=await fetcher(url,{headers,signal});
  if(!r.ok)throw fail(r.status===401||r.status===403?'네이버 인증키와 Maps API 사용 설정을 확인해 주세요.':r.status===429?'네이버 이용 한도 또는 API 선택 설정을 확인해 주세요.':'네이버 거리 조회에 실패했습니다.',r.status===429?429:502);
  return r.json();
 }
 const coords=new Map();
 for(const address of new Set([input.origin,...input.stops.map(s=>s.address)])){
  const data=await request('https://maps.apigw.ntruss.com/map-geocode/v2/geocode?'+new URLSearchParams({query:address,count:'2'}));
  if(data.status!=='OK'||data.meta?.totalCount!==1||data.addresses?.length!==1)throw fail('주소를 한 곳으로 특정하지 못했습니다: '+address,422);
  const d=data.addresses[0],point={x:Number(d.x),y:Number(d.y)};
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>180||Math.abs(point.y)>90)throw fail('네이버 주소 좌표를 확인하지 못했습니다.');
  coords.set(address,{...point,...destinationRegion(d)});
 }
 const points=[coords.get(input.origin)],indexes=[];
 for(const stop of input.stops){const point=coords.get(stop.address);if(same(points.at(-1),point))indexes.push(-1);else{indexes.push(points.length-1);points.push(point);}}
 const legs=[],usage={directions5:0,directions15:0};
 for(let start=0;start<points.length-1;){
  let end=Math.min(start+16,points.length-1);
  // Naver rejects an identical origin/destination; split a returning route at its first leg.
  if(same(points[start],points[end]))end=start+1;
  const chunk=points.slice(start,end+1),kind=chunk.length-2<=5?'directions5':'directions15';
  const pair=p=>p.x+','+p.y,params=new URLSearchParams({start:pair(chunk[0]),goal:pair(chunk.at(-1)),option,fueltype:'diesel'});
  if(chunk.length>2)params.set('waypoints',chunk.slice(1,-1).map(pair).join('|'));
  const data=await request('https://maps.apigw.ntruss.com/'+(kind==='directions5'?'map-direction':'map-direction-15')+'/v1/driving?'+params);
  const route=input.priority==='MIN_DISTANCE'?option.split(':').flatMap(o=>data.route?.[o]??[]).filter(r=>Number.isFinite(r.summary?.distance)&&r.summary.distance>=0&&Number.isFinite(r.summary?.duration)&&r.summary.duration>=0).sort((a,b)=>a.summary.distance-b.summary.distance)[0]:data.route?.[option]?.[0];
  if(data.code!==0||!route)throw fail('네이버에서 해당 도로 경로를 찾지 못했습니다.',422);
  legs.push(...naverSections(route,chunk.length-1));usage[kind]++;start=end;
 }
 if(legs.length!==points.length-1||legs.some(s=>!Number.isFinite(s.distanceMeters)||s.distanceMeters<0||!Number.isFinite(s.durationSeconds)||s.durationSeconds<0))throw fail('네이버 구간거리 값이 올바르지 않습니다.');
 const sections=indexes.map(i=>i<0?{distanceMeters:0,durationSeconds:0}:legs[i]);
 return {provider:'naver',regions:input.stops.map(s=>{const p=coords.get(s.address);return {region:p.region,regionKey:p.regionKey};}),sections,totalDistanceMeters:sections.reduce((n,s)=>n+s.distanceMeters,0),totalDurationSeconds:sections.reduce((n,s)=>n+s.durationSeconds,0),calculatedAt:new Date().toISOString(),priority:input.priority,usage};
}
