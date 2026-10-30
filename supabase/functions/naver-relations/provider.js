import {destinationRegion} from '../naver-distance/provider.js';
import {minimumRouteMeters} from './shortlist-model.js';

const fail=(message,status=502)=>Object.assign(new Error(message),{status});
const routeErrors={1:'출발·도착 도로 지점이 같습니다.',2:'출발지 또는 도착지가 도로 주변이 아닙니다.',3:'자동차 경로를 제공할 수 없습니다.',4:'경유지가 도로 주변이 아닙니다.',5:'경로의 직선거리 합이 허용 범위를 초과합니다.'};
function point(p){
 if(!p||typeof p.x!=='number'||typeof p.y!=='number'||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>180||Math.abs(p.y)>90)throw fail('좌표 값을 확인해 주세요.',422);
 return p.x+','+p.y;
}
export const coordinateKey=(from,to)=>point(from)+'>'+point(to)+'|diesel|1';
function routeFailureBody(data){
 const bodies=[data,data?.error?.details];
 for(let body of bodies){
  if(typeof body==='string'&&body.length<20000)try{body=JSON.parse(body);}catch{continue;}
  const code=Number(body?.code);
  if(Number.isInteger(code)&&Object.hasOwn(routeErrors,code))return {...body,code};
 }
 return null;
}
function providerDetail(data,env){
 let text=JSON.stringify({code:data?.code,message:data?.message,errorMessage:data?.errorMessage,error:data?.error?{errorCode:data.error.errorCode,message:data.error.message,errorMessage:data.error.errorMessage,details:data.error.details}:undefined});
 for(const key of ['NAVER_MAPS_CLIENT_ID','NAVER_MAPS_CLIENT_SECRET','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY'])if(env[key])text=text.replaceAll(env[key],'[redacted]');
 return text.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,1800);
}
async function request(path,params,env,fetcher,signal){
 if(!env.NAVER_MAPS_CLIENT_ID||!env.NAVER_MAPS_CLIENT_SECRET)throw fail('네이버 Maps 인증 설정이 없습니다.',503);
 const base=env.NAVER_MAPS_API_BASE||'https://maps.apigw.ntruss.com';
 if(!['https://maps.apigw.ntruss.com','https://naveropenapi.apigw.ntruss.com'].includes(base))throw fail('네이버 API 주소 설정을 확인해 주세요.',503);
 const res=await fetcher(base+path+'?'+new URLSearchParams(params),{headers:{'x-ncp-apigw-api-key-id':env.NAVER_MAPS_CLIENT_ID,'x-ncp-apigw-api-key':env.NAVER_MAPS_CLIENT_SECRET,Accept:'application/json'},signal});
 let data;try{data=await res.json();}catch{if(res.ok)throw fail('네이버 응답을 해석하지 못했습니다.');}
 // Directions returns documented route failures with HTTP 400 as well as 200.
 const detail=providerDetail(data,env),routeFailure=path==='/map-direction/v1/driving'&&res.status===400?routeFailureBody(data):null;
 if(!res.ok&&!routeFailure){
  const rawCode=data?.error?.errorCode;
  const providerCode=/^[a-z0-9_.-]{1,80}$/i.test(String(rawCode??''))?String(rawCode):null;
  const quota=res.status===429||/quota\s*exceed|throttle\s*limited|rate\s*limited/i.test(detail),status=quota?429:res.status;
  throw Object.assign(fail((status===401||status===403?'네이버 Maps 인증 또는 상품 설정을 확인해 주세요.':quota?'네이버 Maps 이용 한도에 도달했습니다.':status===400?'네이버 구간 요청이 거부되었습니다.':'네이버 구간 조회 연결 오류입니다.')+` (HTTP ${res.status}${providerCode?`, 코드 ${providerCode}`:''})`,status),{providerStatus:res.status,providerCode,providerDetail:detail});
 }
 return routeFailure?{...routeFailure,providerDetail:detail}:data;
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
 if(Number.isInteger(data?.code)&&Object.hasOwn(routeErrors,data.code))throw Object.assign(fail(routeErrors[data.code]+` (네이버 코드 ${data.code})`,422),{providerCode:data.code,providerDetail:data.providerDetail??providerDetail(data,env)});
 const summary=data?.route?.[option]?.[0]?.summary;
 if(data?.code!==0||!summary)throw fail('네이버 경로 응답이 올바르지 않습니다.');
 if(!Number.isFinite(summary.distance)||summary.distance<0||!Number.isFinite(summary.duration)||summary.duration<0)throw fail('네이버 구간 거리·시간 값이 올바르지 않습니다.');
 return {distance_meters:summary.distance,duration_seconds:summary.duration/1000,measured_at:new Date().toISOString()};
}

// Candidate scoring only: one metered request, all three requested options checked.
export async function queryShortlistLeg(from,to,env,fetcher=fetch,signal=AbortSignal.timeout(10000)){
 const start=point({x:from?.coordinates?.[0],y:from?.coordinates?.[1]}),goal=point({x:to?.coordinates?.[0],y:to?.coordinates?.[1]});
 const options=['traoptimal','trafast','tracomfort'];
 if(start===goal)return {distanceMeters:0,option:options[0],measuredAt:new Date().toISOString()};
 const data=await request('/map-direction/v1/driving',{start,goal,option:options.join(':'),fueltype:'diesel',cartype:'1'},env,fetcher,signal);
 if(Number.isInteger(data?.code)&&Object.hasOwn(routeErrors,data.code))throw Object.assign(fail('Naver could not provide this directed road leg.',422),{providerCode:data.code});
 return minimumRouteMeters(data,options,new Date().toISOString());
}
