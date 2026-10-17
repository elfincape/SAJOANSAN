import {destinationRegion} from '../naver-distance/provider.js';

const fail=(message,status=502)=>Object.assign(new Error(message),{status});
function point(p){
 if(!p||typeof p.x!=='number'||typeof p.y!=='number'||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>180||Math.abs(p.y)>90)throw fail('좌표 값을 확인해 주세요.',422);
 return p.x+','+p.y;
}
export const coordinateKey=(from,to)=>point(from)+'>'+point(to)+'|diesel|1';
async function request(path,params,env,fetcher,signal){
 if(!env.NAVER_MAPS_CLIENT_ID||!env.NAVER_MAPS_CLIENT_SECRET)throw fail('네이버 Maps 인증 설정이 없습니다.',503);
 const base=env.NAVER_MAPS_API_BASE||'https://maps.apigw.ntruss.com';
 if(!['https://maps.apigw.ntruss.com','https://naveropenapi.apigw.ntruss.com'].includes(base))throw fail('네이버 API 주소 설정을 확인해 주세요.',503);
 const res=await fetcher(base+path+'?'+new URLSearchParams(params),{headers:{'x-ncp-apigw-api-key-id':env.NAVER_MAPS_CLIENT_ID,'x-ncp-apigw-api-key':env.NAVER_MAPS_CLIENT_SECRET,Accept:'application/json'},signal});
 if(!res.ok)throw fail(res.status===401||res.status===403?'네이버 Maps 인증 또는 상품 설정을 확인해 주세요.':res.status===429?'네이버 Maps 이용 한도에 도달했습니다.':'네이버 구간 조회 연결 오류입니다.',res.status);
 return res.json();
}
export async function geocodeAddress(address,env,fetcher=fetch,signal=AbortSignal.timeout(10000)){
 const data=await request('/map-geocode/v2/geocode',{query:address,count:'2'},env,fetcher,signal);
 if(data.status!=='OK'||data.meta?.totalCount!==1||data.addresses?.length!==1)throw fail('주소를 한 곳으로 특정하지 못했습니다.',422);
 const d=data.addresses[0];if(d.x==null||d.y==null||d.x===''||d.y==='')throw fail('주소 좌표 값이 없습니다.',422);
 const p={x:Number(d.x),y:Number(d.y)};point(p);
 const region=destinationRegion(d);
 return {...p,standard_address:d.roadAddress||d.jibunAddress||address,region:region.region,region_key:region.regionKey,measured_at:new Date().toISOString()};
}
export async function queryLeg(from,to,env,fetcher=fetch,signal=AbortSignal.timeout(10000),priority='RECOMMEND'){
 const start=point(from),goal=point(to),option={RECOMMEND:'traoptimal',TIME:'trafast'}[priority];
 if(!option)throw fail('구간 조회 옵션을 확인해 주세요.',400);
 if(start===goal)return {distance_meters:0,duration_seconds:0,measured_at:new Date().toISOString()};
 const data=await request('/map-direction/v1/driving',{start,goal,option,fueltype:'diesel',cartype:'1'},env,fetcher,signal);
 const summary=data.route?.[option]?.[0]?.summary;
 if(data.code!==0||!summary)throw fail('해당 도로 경로를 찾지 못했습니다.',422);
 if(!Number.isFinite(summary.distance)||summary.distance<0||!Number.isFinite(summary.duration)||summary.duration<0)throw fail('네이버 구간 거리·시간 값이 올바르지 않습니다.');
 return {distance_meters:summary.distance,duration_seconds:summary.duration/1000,measured_at:new Date().toISOString()};
}
