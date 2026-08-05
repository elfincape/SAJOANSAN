import {displayFieldValue,matchesCondition,normalizeCenter,OPERATIONS_QUERY_SCHEMA,readFieldValue,validateQueryPlan,type QueryPlan} from './tools.ts';

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const MODEL='claude-haiku-4-5-20251001',AI_URL='https://aiapiflow.com/v1/messages',MAX_SOURCE_ROWS=5000;
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
    const plan=await classify(question,env.aiKey),result=await searchOperations(plan,env,token,centerCode),rows=result.rows.slice(0,plan.limit),truncated=result.rows.length>plan.limit;
    console.log(JSON.stringify({requestId,userId:user.id,centerCode,tool:'search_operations',conditionCount:plan.conditions.length,rowCount:rows.length,truncated}));
    return json({answer:rows.length?`조건에 맞는 결과는 ${rows.length}건입니다.`:'조회 결과 없음',columns:result.columns,rows,notices:[],meta:{centerCode,rowCount:rows.length,truncated,requestId,generatedAt:new Date().toISOString()}});
  }catch(error){const x=error as Error&{code?:string;status?:number;publicMessage?:string};console.error(JSON.stringify({requestId,code:x.code||'INTERNAL_ERROR'}));return fail(x.code||'INTERNAL_ERROR',x.publicMessage||publicMessage(x.code),x.status||500,requestId)}
});

function envs(){const url=Deno.env.get('SUPABASE_URL')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'',aiKey=Deno.env.get('AIAPIFLOW_API_KEY')||'';if(!url||!anon||!aiKey)throw coded('INTERNAL_ERROR',500);return{url,anon,aiKey}}
function bearer(req:Request){return req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]||''}
async function authUser(e:ReturnType<typeof envs>,token:string){const response=await fetch(`${e.url}/auth/v1/user`,{headers:{apikey:e.anon,authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});return response.ok?await response.json():null}
async function rest(e:ReturnType<typeof envs>,token:string,table:string,query:string){const response=await fetch(`${e.url}/rest/v1/${table}?${query}`,{headers:{apikey:e.anon,authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!response.ok)throw coded('QUERY_FAILED',502);return await response.json()}

const fieldNames=Object.keys(OPERATIONS_QUERY_SCHEMA),operators=['eq','contains','lt','lte','gt','gte','between','is_empty'];
const TOOL={name:'search_operations',description:'현재 센터 코스표의 허용된 모든 운영 컬럼을 AND 조건으로 통합 조회한다.',input_schema:{type:'object',additionalProperties:false,required:['conditions','select','sort','limit'],properties:{conditions:{type:'array',maxItems:20,items:{type:'object',additionalProperties:false,required:['field','operator'],properties:{field:{type:'string',enum:fieldNames},operator:{type:'string',enum:operators},value:{}}}},select:{type:'array',minItems:1,maxItems:33,items:{type:'string',enum:fieldNames}},sort:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,required:['field','direction'],properties:{field:{type:'string',enum:fieldNames},direction:{type:'string',enum:['asc','desc']}}}},limit:{type:'integer',minimum:1,maximum:100}}}};
async function classify(question:string,key:string):Promise<QueryPlan>{
  const schemaGuide=fieldNames.map(name=>{const f=OPERATIONS_QUERY_SCHEMA[name];return`${name}(${f.type}; 별칭:${f.aliases.join('/')})`}).join(', ');
  const prompt=`자연어 질문을 search_operations 도구 인자로 정확히 변환하라. 질문에 포함된 모든 조건은 conditions에 넣고 반드시 AND로 적용한다. 이름 일부 검색은 contains, 명확한 완전일치는 eq를 사용한다. 시간은 HH:mm 문자열로 쓴다. 파생 체크 항목(5톤이상/무인/탑차 등)은 eq true/false를 쓴다. '~가 없는', '공란', '비어있는', '누락된' 조건은 해당 원본 텍스트 필드에 is_empty를 사용한다. '코스에 등록되지 않은 납품처', '미등록 납품처'는 코스등록 eq false를 사용한다. select에는 사용자가 요구한 열과 필터 확인에 꼭 필요한 열만 넣는다. 임의의 전체 목록으로 대체하지 마라. 조건 컬럼이나 값을 확정할 수 없으면 존재하지 않는 필드를 만들지 말고 도구 호출을 하지 마라.
예: '거래처 중 22시 이전 납품되는 곳' → 납품마감 lt 22:00, select 납품처명/납품마감. '5톤 이상 들어갈 수 있는 거래처' → 5톤이상 eq true. '대-11호 코스에서 5톤 이상 가능하고 무인인 거래처' → 코스명 eq 대-11호 AND 5톤이상 eq true AND 무인 eq true. 'OO운수 소속 기사 중 탑차 기사' → 운수사 contains OO운수 AND 탑차 eq true. '야적 가능한 거래처 중 연락처와 주소' → 야적 eq true, select 납품처명/연락처/주소. '납품방식이 공란인 거래처' → 납품방식 is_empty, select 코드/납품처명/납품방식/주소. '코스에 등록되지 않은 납품처' → 코스등록 eq false, select 코드/납품처명/주소/납품방식.
허용 스키마: ${schemaGuide}
질문: ${JSON.stringify(question)}`;
  const response=await fetch(AI_URL,{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL,max_tokens:1400,tools:[TOOL],tool_choice:{type:'tool',name:'search_operations'},messages:[{role:'user',content:prompt}]}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw coded(response.status===429?'RATE_LIMITED':'MODEL_FAILED',response.status===429?429:502);const data=await response.json(),call=(data.content||[]).find((item:any)=>item.type==='tool_use'&&item.name==='search_operations');
  try{const plan=patchPlanForMissingConditions(question,validateQueryPlan(call?.input));if(/(중|이전|이후|이상|이하|가능|불가|소속|에서|인 곳|인 거래처|없는|공란|비어|누락|미등록|등록되지)/.test(question)&&!plan.conditions.length)throw new Error('질문의 필터 컬럼 또는 값을 확인하지 못했습니다.');return plan}catch(error){const out=coded('UNSUPPORTED_QUESTION',400) as Error&{publicMessage?:string};out.publicMessage=error instanceof Error?error.message:'질문의 필터 조건을 확인할 수 없습니다.';throw out}
}

function patchPlanForMissingConditions(question:string,plan:QueryPlan){
  const normalized=question.replace(/\s+/g,'');
  const has=(field:string,operator?:string)=>plan.conditions.some(c=>c.field===field&&(!operator||c.operator===operator));
  const ensureSelect=(fields:string[])=>{plan.select=[...new Set([...plan.select,...fields])]};
  const removeEmptyWordEq=(field:string)=>{
    plan.conditions=plan.conditions.filter(c=>!(c.field===field&&c.operator==='eq'&&['','없음','없는','공란','빈값'].includes(String(c.value??'').trim())));
  };
  if(/납품방식|납품방법|배송방식/.test(question)&&/(공란|비어|비어있|없는|없음|누락)/.test(question)){
    removeEmptyWordEq('납품방식');
    if(!has('납품방식','is_empty'))plan.conditions.push({field:'납품방식',operator:'is_empty'});
    ensureSelect(['코드','납품처명','납품방식','주소']);
  }
  if(/진입방식|출입방식/.test(question)&&/(공란|비어|비어있|없는|없음|누락)/.test(question)){
    removeEmptyWordEq('진입방식');
    if(!has('진입방식','is_empty'))plan.conditions.push({field:'진입방식',operator:'is_empty'});
    ensureSelect(['코드','납품처명','진입방식','주소']);
  }
  if(/납품장소|하차장소|배송장소/.test(question)&&/(공란|비어|비어있|없는|없음|누락)/.test(question)){
    removeEmptyWordEq('납품장소');
    if(!has('납품장소','is_empty'))plan.conditions.push({field:'납품장소',operator:'is_empty'});
    ensureSelect(['코드','납품처명','납품장소','주소']);
  }
  if(/(미등록납품처|미등록거래처|코스에등록되지않은|코스등록되지않은|등록안된납품처|등록안된거래처)/.test(normalized)&&!has('코스등록')){
    plan.conditions.push({field:'코스등록',operator:'eq',value:false});ensureSelect(['코드','납품처명','주소','납품방식']);
  }
  return plan;
}

async function fetchUnregisteredDeliveryPoints(e:ReturnType<typeof envs>,token:string,center:string){
  const [points,stops]=await Promise.all([
    rest(e,token,'delivery_points',`select=id,code,name,region,address,contact,delivery_method,access_method,delivery_location,deadline_business_min,security_key_location,security_password,allow_under_1ton,allow_under_3_5ton,allow_over_5ton,allow_unmanned_yard&center_code=eq.${center}&limit=${MAX_SOURCE_ROWS}`),
    rest(e,token,'route_stops',`select=delivery_point_id,routes!inner(center_code)&routes.center_code=eq.${center}&limit=${MAX_SOURCE_ROWS}`)
  ]);
  const registered=new Set(stops.map((row:any)=>row.delivery_point_id));
  return points.filter((p:any)=>!registered.has(p.id)).map((p:any)=>({
    route_name:'',car_number:'',company_name:'',primary_driver_name:'',secondary_driver_name:'',primary_vehicle_plate:'',primary_vehicle_tonnage:null,stop_order:null,
    arrival_business_min:null,unloading_start_business_min:null,unloading_end_business_min:null,effective_deadline_business_min:p.deadline_business_min,
    dp_code:p.code,dp_name:p.name,dp_region:p.region,dp_address:p.address,dp_contact:p.contact,
    delivery_method:p.delivery_method,access_method:p.access_method,delivery_location:p.delivery_location,
    security_key_location:p.security_key_location,security_password:p.security_password,
    allow_under_1ton:p.allow_under_1ton,allow_under_3_5ton:p.allow_under_3_5ton,allow_over_5ton:p.allow_over_5ton,allow_unmanned_yard:p.allow_unmanned_yard,
    stop_memo:'',__route_registered:false
  }));
}

async function searchOperations(plan:QueryPlan,e:ReturnType<typeof envs>,token:string,center:string){
  let source:any[];
  if(plan.conditions.some(condition=>condition.field==='코스등록'&&condition.operator==='eq'&&condition.value===false))source=await fetchUnregisteredDeliveryPoints(e,token,center);
  else{try{source=(await rest(e,token,'course_view',`select=*&center_code=eq.${center}&limit=${MAX_SOURCE_ROWS}`)).map((row:any)=>({...row,__route_registered:true}))}catch{const routes=await rest(e,token,'routes',`select=id&center_code=eq.${center}&limit=1000`),ids=routes.map((r:any)=>r.id);source=ids.length?(await rest(e,token,'course_view',`select=*&route_id=in.(${ids.map(enc).join(',')})&limit=${MAX_SOURCE_ROWS}`)).map((row:any)=>({...row,__route_registered:true})):[]}}
  let rows=source.filter(row=>plan.conditions.every(condition=>matchesCondition(row,condition)));
  rows.sort((a,b)=>compareRows(a,b,plan));
  const columns=plan.select.map(field=>{const def=OPERATIONS_QUERY_SCHEMA[field];return{key:field,label:def.label,type:def.type==='number'?'number':'text'}});
  const seen=new Set<string>(),outputRows=rows.map(row=>Object.fromEntries(plan.select.map(field=>[field,displayFieldValue(row,OPERATIONS_QUERY_SCHEMA[field])]))).filter(row=>{const key=JSON.stringify(row);if(seen.has(key))return false;seen.add(key);return true});
  return{columns,rows:outputRows};
}
function compareRows(a:any,b:any,plan:QueryPlan){for(const rule of plan.sort){const def=OPERATIONS_QUERY_SCHEMA[rule.field],av=readFieldValue(a,def),bv=readFieldValue(b,def),result=def.type==='text'?String(av??'').localeCompare(String(bv??''),'ko',{numeric:true}):Number(av??0)-Number(bv??0);if(result)return rule.direction==='desc'?-result:result}return 0}

function enc(value:unknown){return encodeURIComponent(String(value))}
function rateCheck(id:string){const now=Date.now(),day=new Date().toISOString().slice(0,10),value=rate.get(id)||{minute:now,minuteCount:0,day,dayCount:0};if(now-value.minute>60000){value.minute=now;value.minuteCount=0}if(value.day!==day){value.day=day;value.dayCount=0}value.minuteCount++;value.dayCount++;rate.set(id,value);if(value.minuteCount>10||value.dayCount>100)throw coded('RATE_LIMITED',429)}
function coded(code:string,status:number){return Object.assign(new Error(code),{code,status})}
function publicMessage(code?:string){return({RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 시도해주세요.',QUERY_FAILED:'운영 데이터 조회에 실패했습니다.',MODEL_FAILED:'질문 분석에 실패했습니다.',INTERNAL_ERROR:'일시적인 오류가 발생했습니다.'}as Record<string,string>)[code||'']||'요청을 처리하지 못했습니다.'}
function fail(code:string,message:string,status:number,requestId:string){return json({error:{code,message,requestId}},status)}
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{...CORS,'content-type':'application/json; charset=utf-8'}})}
