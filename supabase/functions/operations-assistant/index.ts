import {normalizeCenter} from './tools.ts';

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const MODEL='claude-haiku-4-5-20251001',AI_URL='https://aiapiflow.com/v1/messages',MAX_TABLE_ROWS=5000,MAX_COURSE_ROWS_FOR_LLM=3000;
const rate=new Map<string,{minute:number;minuteCount:number;day:string;dayCount:number}>();

Deno.serve(async req=>{
  const requestId=crypto.randomUUID();if(req.method==='OPTIONS')return json({ok:true});if(req.method!=='POST')return fail('INVALID_INPUT','POST 요청만 지원합니다.',405,requestId);
  try{
    const token=bearer(req);if(!token)return fail('UNAUTHENTICATED','로그인이 필요합니다.',401,requestId);
    const body=await req.json().catch(()=>null),question=String(body?.question||'').trim();if(!question||question.length>1000)return fail('INVALID_INPUT','질문은 1~1000자로 입력해주세요.',400,requestId);
    const centerCode=normalizeCenter(body?.center);if(!centerCode)return fail('INVALID_INPUT','알 수 없는 센터입니다.',400,requestId);
    const env=envs(),user=await authUser(env,token);if(!user)return fail('UNAUTHENTICATED','로그인 세션이 유효하지 않습니다.',401,requestId);rateCheck(user.id);
    const profile=await rest(env,token,'user_profiles',`select=id,role,active&id=eq.${enc(user.id)}&limit=1`),p=profile[0];if(!p?.active||!['viewer','editor','admin'].includes(p.role))return fail('FORBIDDEN','사용 권한이 없습니다.',403,requestId);
    let access:null|unknown[]=null;try{access=await rest(env,token,'user_center_access',`select=center_code&user_id=eq.${enc(user.id)}&center_code=eq.${centerCode}&limit=1`)}catch{/* 이전 스키마는 운영 테이블 RLS가 최종 경계를 강제한다. */}if(access&&!access.length)return fail('FORBIDDEN','선택 센터 조회 권한이 없습니다.',403,requestId);
    if(/이전 지시|sql\s*(실행|쿼리)|다른 센터/i.test(question))return fail('UNSUPPORTED_QUESTION','SQL 실행이나 다른 센터 데이터 요청은 지원하지 않습니다.',400,requestId);
    const snapshot=await buildOperationsSnapshot(env,token,centerCode),answer=await answerFromSnapshot(question,snapshot,env.aiKey,centerCode,requestId);
    console.log(JSON.stringify({requestId,userId:user.id,centerCode,mode:'snapshot_chat',routeCount:snapshot.summary.routes,deliveryPointCount:snapshot.summary.deliveryPoints,rowCount:answer.rows.length,truncated:answer.meta.truncated}));
    return json(answer);
  }catch(error){const x=error as Error&{code?:string;status?:number;publicMessage?:string};console.error(JSON.stringify({requestId,code:x.code||'INTERNAL_ERROR'}));return fail(x.code||'INTERNAL_ERROR',x.publicMessage||publicMessage(x.code),x.status||500,requestId)}
});

function envs(){const url=Deno.env.get('SUPABASE_URL')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'',aiKey=Deno.env.get('AIAPIFLOW_API_KEY')||'';if(!url||!anon||!aiKey)throw coded('INTERNAL_ERROR',500);return{url,anon,aiKey}}
function bearer(req:Request){return req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]||''}
async function authUser(e:ReturnType<typeof envs>,token:string){const response=await fetch(`${e.url}/auth/v1/user`,{headers:{apikey:e.anon,authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});return response.ok?await response.json():null}
async function rest(e:ReturnType<typeof envs>,token:string,table:string,query:string){const response=await fetch(`${e.url}/rest/v1/${table}?${query}`,{headers:{apikey:e.anon,authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!response.ok)throw coded('QUERY_FAILED',502);return await response.json()}

type Snapshot={summary:Record<string,number|boolean|string[]>;routes:any[];deliveryPoints:any[];drivers:any[];vehicles:any[];courseRows:any[];rawTables:Record<string,any[]>;truncated:boolean};
async function buildOperationsSnapshot(e:ReturnType<typeof envs>,token:string,center:string):Promise<Snapshot>{
  const unavailableTables:string[]=[];
  const [companies,routes,stops,points,drivers,vehicles,courseRowsRaw]=await Promise.all([
    safeRest(e,token,'companies',`select=*&center_code=eq.${center}&limit=${MAX_TABLE_ROWS}`,unavailableTables),
    safeRest(e,token,'routes',`select=*&center_code=eq.${center}&limit=${MAX_TABLE_ROWS}`,unavailableTables),
    safeRouteStops(e,token,center,unavailableTables),
    safeRest(e,token,'delivery_points',`select=*&center_code=eq.${center}&limit=${MAX_TABLE_ROWS}`,unavailableTables),
    safeRest(e,token,'drivers',`select=*&center_code=eq.${center}&limit=${MAX_TABLE_ROWS}`,unavailableTables),
    safeRest(e,token,'vehicles',`select=*&center_code=eq.${center}&limit=${MAX_TABLE_ROWS}`,unavailableTables),
    safeCourseRows(e,token,center,unavailableTables)
  ]);
  const companiesById=new Map(companies.map((c:any)=>[c.id,c])),driversById=new Map(drivers.map((d:any)=>[d.id,d])),vehiclesById=new Map(vehicles.map((v:any)=>[v.id,v]));
  const stopCountByRoute=new Map<string,number>(),routeIdsByPoint=new Map<string,Set<string>>(),routeCountByDriver=new Map<string,number>(),routeCountByVehicle=new Map<string,number>();
  for(const stop of stops){stopCountByRoute.set(stop.route_id,(stopCountByRoute.get(stop.route_id)||0)+1);if(!routeIdsByPoint.has(stop.delivery_point_id))routeIdsByPoint.set(stop.delivery_point_id,new Set());routeIdsByPoint.get(stop.delivery_point_id)!.add(stop.route_id)}
  for(const route of routes){for(const id of [route.primary_driver_id,route.secondary_driver_id].filter(Boolean))routeCountByDriver.set(id,(routeCountByDriver.get(id)||0)+1);for(const id of [route.primary_vehicle_id,route.secondary_vehicle_id].filter(Boolean))routeCountByVehicle.set(id,(routeCountByVehicle.get(id)||0)+1)}
  const routeList=routes.map((r:any)=>({id:r.id,코스명:r.name,호차:r.car_number,운수사:companiesById.get(r.company_id)?.name||'',활성:r.active!==false,주기사:driversById.get(r.primary_driver_id)?.name||'',보조기사:driversById.get(r.secondary_driver_id)?.name||'',주차량:vehiclesById.get(r.primary_vehicle_id)?.plate_number||'',보조차량:vehiclesById.get(r.secondary_vehicle_id)?.plate_number||'',납품처수:stopCountByRoute.get(r.id)||0,휴무일:r.closed_days||[]}));
  const deliveryPointList=points.map((p:any)=>({id:p.id,코드:p.code,납품처명:p.name,지역:p.region,주소:p.address,연락처:p.contact,납품방식:p.delivery_method,진입방식:p.access_method,납품장소:p.delivery_location,납품마감:minToTime(p.deadline_business_min),일톤이하:!!p.allow_under_1ton,삼점오톤이하:!!p.allow_under_3_5ton,오톤이상:!!p.allow_over_5ton,무인야적납:!!p.allow_unmanned_yard,열쇠보관장소:p.security_key_location,비밀번호:p.security_password,코스등록:routeIdsByPoint.has(p.id),등록코스수:routeIdsByPoint.get(p.id)?.size||0}));
  const driverList=drivers.map((d:any)=>({id:d.id,기사명:d.name,연락처:d.phone,운수사:companiesById.get(d.company_id)?.name||'',배정코스수:routeCountByDriver.get(d.id)||0}));
  const vehicleList=vehicles.map((v:any)=>({id:v.id,차량번호:v.plate_number,톤수:v.tonnage,팔레트:v.pallet_count??v.pallet_capacity??v.pallet,운수사:companiesById.get(v.company_id)?.name||'',배정코스수:routeCountByVehicle.get(v.id)||0}));
  const courseRows=courseRowsRaw.slice(0,MAX_COURSE_ROWS_FOR_LLM).map((r:any)=>({코스명:r.route_name,호차:r.car_number,운수사:r.company_name,차량번호:r.primary_vehicle_plate,톤수:r.primary_vehicle_tonnage,운전자명:[r.primary_driver_name,r.secondary_driver_name].filter(Boolean).join(', '),납품처명:r.dp_name,코드:r.dp_code,주소:r.dp_address,지역:r.dp_region,연락처:r.dp_contact,납품방식:r.delivery_method,진입방식:r.access_method,납품장소:r.delivery_location,납품마감:minToTime(r.effective_deadline_business_min),오톤이상:!!r.allow_over_5ton,무인야적납:!!r.allow_unmanned_yard,비고:r.stop_memo}));
  return{summary:{routes:routes.length,activeRoutes:routes.filter((r:any)=>r.active!==false).length,inactiveRoutes:routes.filter((r:any)=>r.active===false).length,deliveryPoints:points.length,registeredDeliveryPoints:deliveryPointList.filter((p:any)=>p.코스등록).length,unregisteredDeliveryPoints:deliveryPointList.filter((p:any)=>!p.코스등록).length,drivers:drivers.length,vehicles:vehicles.length,courseRows:courseRowsRaw.length,unavailableTables},routes:routeList,deliveryPoints:deliveryPointList,drivers:driverList,vehicles:vehicleList,courseRows,rawTables:{companies,routes,route_stops:stops,delivery_points:points,drivers,vehicles},truncated:courseRowsRaw.length>courseRows.length||routes.length>=MAX_TABLE_ROWS||points.length>=MAX_TABLE_ROWS};
}
async function safeRest(e:ReturnType<typeof envs>,token:string,table:string,query:string,unavailableTables:string[]){try{return await rest(e,token,table,query)}catch{unavailableTables.push(table);return[]}}
async function safeRouteStops(e:ReturnType<typeof envs>,token:string,center:string,unavailableTables:string[]){try{return await rest(e,token,'route_stops',`select=*&routes!inner(center_code)&routes.center_code=eq.${center}&limit=${MAX_TABLE_ROWS*3}`)}catch{try{const routes=await safeRest(e,token,'routes',`select=id&center_code=eq.${center}&limit=${MAX_TABLE_ROWS}`,unavailableTables),ids=routes.map((r:any)=>r.id);return ids.length?await rest(e,token,'route_stops',`select=*&route_id=in.(${ids.map(enc).join(',')})&limit=${MAX_TABLE_ROWS*3}`):[]}catch{unavailableTables.push('route_stops');return[]}}}
async function safeCourseRows(e:ReturnType<typeof envs>,token:string,center:string,unavailableTables:string[]){try{return await rest(e,token,'course_view',`select=*&center_code=eq.${center}&limit=${MAX_TABLE_ROWS*3}`)}catch{try{const routes=await safeRest(e,token,'routes',`select=id&center_code=eq.${center}&limit=${MAX_TABLE_ROWS}`,unavailableTables),ids=routes.map((r:any)=>r.id);return ids.length?await rest(e,token,'course_view',`select=*&route_id=in.(${ids.map(enc).join(',')})&limit=${MAX_TABLE_ROWS*3}`):[]}catch{unavailableTables.push('course_view');return[]}}}

async function answerFromSnapshot(question:string,snapshot:Snapshot,key:string,centerCode:string,requestId:string){
  const prompt=`너는 현재 센터 운영 DB 스냅샷을 직접 검사해 답하는 한국어 도우미다. SQL을 만들거나 실행하지 않는다. 제공된 JSON 안의 summary, 가공 목록, rawTables 원본 데이터를 모두 사용해 질문에 필요한 집계, 필터, 그룹화를 직접 판단해서 답하라. 가능하면 Excel에 바로 붙여넣기 쉬운 표를 만든다. 질문이 개수면 1행 표를 만든다. 결과 행은 최대 100개만 반환한다. 데이터가 부족하거나 summary.unavailableTables에 필요한 테이블이 있으면 추측하지 말고 조회 결과 없음 또는 확인 불가라고 답한다. 응답은 반드시 JSON 하나만 반환한다. 형식: {"answer":"요약","columns":[{"key":"col","label":"표시명","type":"text|number"}],"rows":[{"col":"값"}],"notices":[],"meta":{"truncated":false}}
센터:${centerCode}
질문:${JSON.stringify(question)}
스냅샷:${JSON.stringify(snapshot)}`;
  const response=await fetch(AI_URL,{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL,max_tokens:2600,messages:[{role:'user',content:prompt}]}),signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw coded(response.status===429?'RATE_LIMITED':'MODEL_FAILED',response.status===429?429:502);
  const data=await response.json(),text=(data.content||[]).map((item:any)=>item.text||'').join('\n').trim(),parsed=parseJsonObject(text);
  return normalizeAssistantResult(parsed,snapshot,centerCode,requestId);
}
function parseJsonObject(text:string){const raw=text.match(/\{[\s\S]*\}/)?.[0]||text;try{return JSON.parse(raw)}catch{throw coded('MODEL_FAILED',502)}}
function normalizeAssistantResult(value:any,snapshot:Snapshot,centerCode:string,requestId:string){
  const columns=Array.isArray(value?.columns)?value.columns.slice(0,40).filter((c:any)=>c&&typeof c.key==='string').map((c:any)=>({key:String(c.key).slice(0,60),label:String(c.label||c.key).slice(0,80),type:c.type==='number'?'number':'text'})):[];
  const rows=Array.isArray(value?.rows)?value.rows.slice(0,100).map((row:any)=>Object.fromEntries(columns.map(c=>[c.key,row?.[c.key]??'']))):[];
  return{answer:String(value?.answer||'조회 결과 없음').slice(0,1000),columns,rows,notices:Array.isArray(value?.notices)?value.notices.map(String).slice(0,5):[],meta:{centerCode,rowCount:rows.length,truncated:!!value?.meta?.truncated||snapshot.truncated,requestId,generatedAt:new Date().toISOString()}};
}

function minToTime(value:unknown){const n=Number(value);if(!Number.isFinite(n)||n<0||n>=1440)return'';return`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`}
function enc(value:unknown){return encodeURIComponent(String(value))}
function rateCheck(id:string){const now=Date.now(),day=new Date().toISOString().slice(0,10),value=rate.get(id)||{minute:now,minuteCount:0,day,dayCount:0};if(now-value.minute>60000){value.minute=now;value.minuteCount=0}if(value.day!==day){value.day=day;value.dayCount=0}value.minuteCount++;value.dayCount++;rate.set(id,value);if(value.minuteCount>10||value.dayCount>100)throw coded('RATE_LIMITED',429)}
function coded(code:string,status:number){return Object.assign(new Error(code),{code,status})}
function publicMessage(code?:string){return({RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 시도해주세요.',QUERY_FAILED:'운영 데이터 조회에 실패했습니다.',MODEL_FAILED:'질문 분석에 실패했습니다.',INTERNAL_ERROR:'일시적인 오류가 발생했습니다.'}as Record<string,string>)[code||'']||'요청을 처리하지 못했습니다.'}
function fail(code:string,message:string,status:number,requestId:string){return json({error:{code,message,requestId}},status)}
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{...CORS,'content-type':'application/json; charset=utf-8'}})}
