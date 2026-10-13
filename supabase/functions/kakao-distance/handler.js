const SITE='https://sajoansan.vercel.app';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function validateRequest(body){
 if(!body||body.center!=='002'||typeof body.origin!=='string'||!body.origin.trim()||body.origin.length>300)throw fail('평택 DB와 출발지 주소를 확인해 주세요.');
 if(!Array.isArray(body.stops)||body.stops.length<1||body.stops.length>30)throw fail('착지는 1~30곳까지 계산할 수 있습니다.');
 if(!['DISTANCE','RECOMMEND','TIME'].includes(body.priority))throw fail('경로 기준을 확인해 주세요.');
 return {origin:body.origin.trim(),priority:body.priority,stops:body.stops.map((s,i)=>{
  if(typeof s?.address!=='string'||!s.address.trim()||s.address.length>300)throw fail((i+1)+'번째 착지 주소가 비어 있거나 너무 깁니다.');
  return {address:s.address.trim()};
 })};
}
const same=(a,b)=>Math.abs(a.x-b.x)<1e-7&&Math.abs(a.y-b.y)<1e-7;
export function makeHandler(env,fetcher=fetch){
 const cors={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:cors});
 return async req=>{
  if(req.headers.get('origin')&&req.headers.get('origin')!==SITE)return reply(403,{error:'허용되지 않은 출처입니다.'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply(405,{error:'POST 요청만 가능합니다.'});
  const deadline=AbortSignal.timeout(90000);
  try{
   const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
   if(!token)return reply(401,{error:'로그인이 필요합니다.'});
   const base=env.SUPABASE_URL,anon=env.SUPABASE_ANON_KEY,key=env.KAKAO_REST_API_KEY;
   if(!base||!anon||!key)throw fail('카카오 연결 설정을 확인해 주세요.',503);
   const authHeaders={apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json'};
   const auth=await fetcher(base+'/auth/v1/user',{headers:authHeaders,signal:deadline});
   if(!auth.ok)throw fail('다시 로그인해 주세요.',401);
   const user=await auth.json();
   const access=await fetcher(base+'/rest/v1/rpc/operations_resource_allowed',{method:'POST',headers:authHeaders,body:JSON.stringify({p_resource:'charter',p_action:'read',p_center:'002'}),signal:deadline});
   if(!user.id||!access.ok||await access.json()!==true)throw fail('평택 용차 DB 열람 권한이 없습니다.',403);
   const raw=await req.text();if(raw.length>20000)throw fail('요청이 너무 큽니다.',413);
   let body;try{body=JSON.parse(raw);}catch{throw fail('계산 요청을 확인해 주세요.');}
   const input=validateRequest(body),headers={Authorization:'KakaoAK '+key,'Content-Type':'application/json'};
   const coordinates=new Map(),addresses=[...new Set([input.origin,...input.stops.map(s=>s.address)])];let next=0;
   await Promise.all(Array.from({length:Math.min(4,addresses.length)},async()=>{
    while(next<addresses.length){
     const address=addresses[next++],r=await fetcher('https://dapi.kakao.com/v2/local/search/address.json?query='+encodeURIComponent(address),{headers,signal:deadline});
     if(!r.ok)throw fail(r.status===429?'카카오 무료 사용 한도에 도달했습니다.':'주소 변환에 실패했습니다. 카카오 사용 설정을 확인해 주세요.',r.status===429?429:502);
     const data=await r.json();
     if(data.meta?.total_count!==1||!data.documents?.length)throw fail('주소를 한 곳으로 특정하지 못했습니다: '+address,422);
     const d=data.documents[0],point={x:Number(d.x),y:Number(d.y)};
     if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>180||Math.abs(point.y)>90)throw fail('주소 좌표를 확인하지 못했습니다.',502);
     coordinates.set(address,point);
    }
   }));
   const points=[coordinates.get(input.origin)],indexes=[];
   for(const stop of input.stops){
    const point=coordinates.get(stop.address);
    if(same(points.at(-1),point))indexes.push(-1);else{indexes.push(points.length-1);points.push(point);}
   }
   async function singleLeg(a,b){
    const params=new URLSearchParams({origin:a.x+','+a.y,destination:b.x+','+b.y,priority:input.priority,summary:'true',car_fuel:'DIESEL'});
    const r=await fetcher('https://apis-navi.kakaomobility.com/v1/directions?'+params,{headers,signal:deadline});
    if(!r.ok)throw fail(r.status===429?'카카오 무료 사용 한도에 도달했습니다.':'거리 조회에 실패했습니다.',r.status===429?429:502);
    const route=(await r.json()).routes?.[0];
    if(route?.result_code!==0)throw fail('도로 경로를 찾지 못했습니다.',422);
    return {distance:route.summary?.distance,duration:route.summary?.duration};
   }
   let legs=[];
   if(points.length===2||points.length>2&&same(points[0],points.at(-1))){
    for(let i=1;i<points.length;i++)legs.push(await singleLeg(points[i-1],points[i]));
   }else if(points.length>2){
    const r=await fetcher('https://apis-navi.kakaomobility.com/v1/waypoints/directions',{method:'POST',headers,signal:deadline,body:JSON.stringify({origin:points[0],destination:points.at(-1),waypoints:points.slice(1,-1),priority:input.priority,car_fuel:'DIESEL',summary:true,road_details:false})});
    if(!r.ok)throw fail(r.status===429?'카카오 무료 사용 한도에 도달했습니다.':'다중 착지 거리 조회에 실패했습니다.',r.status===429?429:502);
    const route=(await r.json()).routes?.[0];
    if(route?.result_code!==0)throw fail('도로 경로를 찾지 못했습니다.',422);
    legs=route.sections??[];
   }
   if(legs.length!==points.length-1||legs.some(s=>!Number.isFinite(s.distance)||s.distance<0||!Number.isFinite(s.duration)||s.duration<0))throw fail('착지별 거리 응답을 확인하지 못했습니다.',502);
   const sections=indexes.map(i=>i<0?{distanceMeters:0,durationSeconds:0}:{distanceMeters:legs[i].distance,durationSeconds:legs[i].duration});
   return reply(200,{sections,totalDistanceMeters:sections.reduce((n,s)=>n+s.distanceMeters,0),totalDurationSeconds:sections.reduce((n,s)=>n+s.durationSeconds,0),calculatedAt:new Date().toISOString(),priority:input.priority});
  }catch(error){
   return reply(error.status??502,{error:error.name==='TimeoutError'||error.name==='AbortError'?'거리 계산 시간이 초과되었습니다. 다시 시도해 주세요.':error.status?error.message:'거리 계산 중 연결 오류가 발생했습니다.'});
  }
 };
}
