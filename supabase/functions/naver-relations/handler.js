import {handleShortlist,shortlistSummary} from './shortlist-handler.js';
import {normalizeAddress,groupAddresses,buildCandidates,pointIdentity,consolidateCoordinates} from './model.js';
import {geocodeAddress,queryLeg,coordinateKey} from './provider.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const originDefault='경기도 평택시 산단로 263';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function integer(value,fallback,min,max){const n=value??fallback;if(!Number.isInteger(n)||n<min||n>max)throw fail('조회 범위와 요청 한도를 확인해 주세요.');return n;}
function summary(job){
 if(job.state?.kind==='capture-shortlist')return shortlistSummary(job);
 const s=structuredClone(job.state??{});consolidateCoordinates(s);
 const points=s.points??[],byId=new Map(points.map(p=>[p.id,p]));
 return {id:job.id,status:job.status,error:job.error||'',updatedAt:job.updated_at,
  phase:s.phase,stops:s.phase==='directions'?Math.max(0,points.length-1):s.groups?.length??0,sourceRows:s.sourceRows??0,geoDone:s.geoCursor??0,geoTotal:(s.groups?.length??0)+1,
  geoIssues:s.geoIssues??[],candidates:s.edges?.length??0,processed:s.edgeCursor??0,completed:s.completed??0,cached:s.cached??0,failed:s.failed??0,deferred:s.deferred??0,
  routeIssues:(s.routeIssues??[]).map(r=>({...r,from:byId.get(r.fromId)?.address??'',to:byId.get(r.toId)?.address??''})),
  directionsAttempts:job.directions_attempts,directionsBudget:job.directions_budget,geocodingAttempts:job.geocoding_attempts,geocodingBudget:job.geocoding_budget,
  lastResults:(s.lastResults??[]).map(r=>({...r,from:byId.get(r.fromId)?.address??'',to:byId.get(r.toId)?.address??''})),
  apiIssue:s.apiIssue?{...s.apiIssue,from:byId.get(s.apiIssue.fromId)?.address??'',to:byId.get(s.apiIssue.toId)?.address??''}:null,
  origin:s.origin,sameLocation:!!s.sameLocation,mergedEdges:s.mergedEdges??0,allowanceVerified:false,policy:'coordinates-v1',limit:s.limit??50};
}
export function makeRelationsHandler(env,fetcher=fetch,sleep=wait){
 return async req=>{
  const origin=req.headers.get('origin'),allowedOrigin=!origin||origin==='https://sajoansan.vercel.app'||/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
  const cors={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':allowedOrigin&&origin?origin:'https://sajoansan.vercel.app','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
  const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:cors});
  let claimed=null,lock=null,state=null;
  try{
   if(!allowedOrigin)return reply(403,{error:'허용되지 않은 출처입니다.'});
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
   if(req.method!=='POST')return reply(405,{error:'POST 요청만 가능합니다.'});
   const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!token)throw fail('로그인이 필요합니다.',401);
   const raw=await req.text();if(raw.length>4000000)throw fail('입력 자료가 너무 큽니다.',413);
   let body;try{body=JSON.parse(raw);}catch{throw fail('조회 요청을 확인해 주세요.');}
   const shortlistAction=['shortlist-create','shortlist-batch','shortlist-status'].includes(body?.action);
   if(!body||!(shortlistAction?['001','002'].includes(body.center):body.center==='002'&&['preview','create','batch','status','resume'].includes(body.action)))throw fail('Invalid center or API action');
   const headers={apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'};
   const auth=await fetcher(env.SUPABASE_URL+'/auth/v1/user',{headers,signal:AbortSignal.timeout(10000)});
   if(!auth.ok)throw fail('다시 로그인해 주세요.',401);const user=await auth.json();if(!user.id)throw fail('로그인이 필요합니다.',401);
   const permission=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/operations_resource_allowed',{method:'POST',headers,body:JSON.stringify({p_resource:'delivery_points',p_action:'edit',p_center:body.center}),signal:AbortSignal.timeout(10000)});
   if(!permission.ok||await permission.json()!==true)throw fail('평택 납품처 수정 권한이 없습니다.',403);
   async function db(path,init={},service=true){
    if(service&&!env.SUPABASE_SERVICE_ROLE_KEY)throw fail('구간 저장 서버 설정이 없습니다.',503);
    const h=service?{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'}:headers;
    const res=await fetcher(env.SUPABASE_URL+'/rest/v1/'+path,{...init,headers:{...h,...init.headers},signal:AbortSignal.timeout(10000)});
    if(!res.ok)throw fail('구간 자료 저장·조회에 실패했습니다.',502);
    const text=await res.text();return text?JSON.parse(text):null;
   }
   const rpc=(name,args)=>db('rpc/'+name,{method:'POST',body:JSON.stringify(args)});
   if(shortlistAction)return reply(200,await handleShortlist({body,user,env,db,rpc,fetcher,sleep}));
   if(body.action==='preview'||body.action==='create'){
    const limit=integer(body.limit,50,1,50),directionsBudget=integer(body.directionsBudget,60,1,25000),geocodingBudget=integer(body.geocodingBudget,2000,1,2000);
    const centerOrigin=normalizeAddress(body.origin??originDefault);if(!centerOrigin||centerOrigin.length>300)throw fail('센터 출발지 주소를 확인해 주세요.');
    let rows=body.rows;
    if(rows==null){
     rows=[];for(let offset=0;offset<20000;offset+=500){
      const page=await db('delivery_points?'+new URLSearchParams({select:'id,code,name,address',center_code:'eq.002',order:'id',offset:String(offset),limit:'500'}),{},false);
      rows.push(...page.map(d=>({sourceRow:rows.length+page.indexOf(d)+1,name:d.name,address:d.address,sourceId:d.id,sourceCode:d.code,source:'delivery_points'})));if(page.length<500)break;
     }
    }
    if(!Array.isArray(rows)||!rows.length||rows.length>20000)throw fail('1~20,000행의 주소 자료를 확인해 주세요.');
    const valid=rows.filter(r=>r&&typeof r.address==='string'&&r.address.trim()&&!r.issue);
    if(valid.some(r=>r.address.length>300))throw fail('주소는 300자 이하로 입력해 주세요.');
    const groups=groupAddresses(valid).filter(g=>g.key!==centerOrigin).sort((a,b)=>a.key.localeCompare(b.key,'ko'));
    if(!groups.length||groups.length>1999)throw fail('센터 주소를 제외한 유효 착지는 1~1,999개까지 처리합니다.');
    const preview={stops:groups.length,sourceRows:rows.length,invalidRows:rows.length-valid.length,estimatedCandidates:groups.length*(1+Math.min(limit,groups.length-1)),directionsBudget,geocodingBudget,limit,allowanceVerified:false};
    if(body.action==='preview')return reply(200,preview);
    const active=await db('naver_api_jobs?'+new URLSearchParams({select:'id',owner_id:'eq.'+user.id,center_code:'eq.002',status:'in.(queued,running)',limit:'2'}));
    if(active.length>=2)throw fail('진행 중인 수집 작업을 먼저 중지하거나 재개해 주세요.',409);
    state={kind:body.kind==='single'?'single':'collection',phase:'geocode',origin:centerOrigin,groups,sourceRows:rows.length,invalidRows:preview.invalidRows,limit,geoCursor:0,geoIssues:[],points:[],aliases:{},edges:[],edgeCursor:0,completed:0,cached:0,failed:0,deferred:0,lastResults:[]};
    const jobs=await db('naver_api_jobs',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_id:user.id,center_code:'002',state,directions_budget:directionsBudget,geocoding_budget:geocodingBudget})});
    return reply(200,{...summary(jobs[0]),preview});
   }
   if(!uuid(body.jobId))throw fail('수집 작업을 확인해 주세요.');
   const jobs=await db('naver_api_jobs?'+new URLSearchParams({select:'*',id:'eq.'+body.jobId,center_code:'eq.002'}),{},false);
   if(!jobs?.length)throw fail('수집 작업이 없거나 열람 권한이 없습니다.',404);let job=jobs[0];
   if(job.state?.kind==='capture-shortlist')throw fail('Use the owner-scoped shortlist actions');
   if(body.action==='status')return reply(200,summary(job));
   if(body.action==='resume'){
    if(typeof body.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(body.expectedUpdatedAt)))throw fail('최근 작업을 불러온 뒤 재개해 주세요.');
    if(body.expectedUpdatedAt!==job.updated_at)throw fail('다른 화면에서 작업이 변경되었습니다. 최근 작업을 다시 불러와 주세요.',409);
    if(job.worker_id&&Date.parse(job.lease_until)>Date.now())throw fail('현재 조회가 끝난 뒤 재개해 주세요.',409);
    const budget=integer(body.directionsBudget,job.directions_budget,job.directions_attempts||1,25000);
    if(job.status==='completed'&&!(job.state?.deferred>0))return reply(200,summary(job));
    const resumed=await db('naver_api_jobs?'+new URLSearchParams({id:'eq.'+job.id,center_code:'eq.002',updated_at:'eq.'+body.expectedUpdatedAt}),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'queued',directions_budget:budget,error:null,worker_id:null,lease_until:null,updated_at:new Date().toISOString()})});
    if(!resumed?.length)throw fail('작업 상태가 변경되었습니다. 다시 불러와 주세요.',409);return reply(200,summary(resumed[0]));
   }
   if(!env.NAVER_MAPS_CLIENT_ID||!env.NAVER_MAPS_CLIENT_SECRET)throw fail('네이버 Maps 인증 설정이 없습니다.',503);
   lock=crypto.randomUUID();claimed=await rpc('naver_api_claim',{p_job:job.id,p_lock:lock});
   if(!claimed)return reply(200,{...summary(job),busy:job.status==='running'});
   job=claimed;state=structuredClone(job.state);consolidateCoordinates(state);const started=Date.now();let processed=0,jobStatus='queued',jobError=null;
   async function external(kind,url,init){
    if(Date.now()-started>45000)throw fail('다음 배치에서 이어서 조회합니다.',408);
    await sleep(500);
    if(!await rpc('naver_api_reserve',{p_job:job.id,p_lock:lock,p_kind:kind}))throw fail('요청 한도에 도달했거나 수집이 중지되었습니다.',409);
    return fetcher(url,init);
   }
   async function retry(kind,operation){
    for(let attempt=0;;attempt++)try{return await operation((url,init)=>external(kind,url,init));}catch(e){
     if(attempt>=2||[401,403,408,409,422,429,503].includes(e.status)||e.status&&e.status<500)throw e;
     await sleep(500*(attempt+1));
    }
   }
   const remember=result=>{state.lastResults=[...(state.lastResults??[]),result].slice(-50);};
   while(processed<5&&Date.now()-started<30000){
    if(state.phase==='geocode'){
     const entries=[{key:state.origin,address:state.origin,name:'평택센터'},...state.groups];
     if(state.geoCursor>=entries.length){
      const center=state.points.find(p=>p.addressKey===state.origin);if(!center)throw fail('센터 출발지 주소를 확인한 후 새 작업을 시작해 주세요.',422);
      const preferred=[];
      const historyAccess=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/operations_resource_allowed',{method:'POST',headers,body:JSON.stringify({p_resource:'charter',p_action:'read',p_center:'002'}),signal:AbortSignal.timeout(10000)});
      if(historyAccess.ok&&await historyAccess.json()===true){
       const byAddress=new Map(state.points.map(p=>[p.addressKey,p.id]));for(const [key,id] of Object.entries(state.aliases??{}))byAddress.set(key,id);
       for(let offset=0;offset<2000;offset+=500){
        const trips=await db('charter_trips?'+new URLSearchParams({select:'deliveries:payload->deliveries',center_code:'eq.002',order:'business_date.desc,id',offset:String(offset),limit:'500'}),{},false);
        for(const trip of trips){
         const stops=(trip.deliveries??[]).slice().sort((a,b)=>Number(a.sourceRow??Infinity)-Number(b.sourceRow??Infinity)).map(d=>byAddress.get(normalizeAddress(d.address)));
         for(let i=1;i<stops.length;i++)if(stops[i-1]&&stops[i]&&stops[i-1]!==stops[i])preferred.push({from:stops[i-1],to:stops[i]});
        }
        if(trips.length<500)break;
       }
      }
      const edges=buildCandidates(state.points,{limit:state.limit,originId:center.id,preferred});
      state.sameLocation=state.kind==='single'&&state.points.length===1&&state.geoIssues.length===0;
      const indexes=new Map(state.points.map((p,i)=>[p.id,i]));state.edges=edges.map(e=>[indexes.get(e.from),indexes.get(e.to),e.reason]);state.phase='directions';continue;
     }
     const entry=entries[state.geoCursor];
     const cached=await db('naver_api_addresses?'+new URLSearchParams({select:'*',center_code:'eq.002',address_key:'eq.'+entry.key}));
     let p=cached?.find(r=>r.status==='ready');
     try{
      if(!p){
       const data=await retry('geocoding',f=>geocodeAddress(entry.address,env,f));
       p=await rpc('naver_api_save_address',{p_job:job.id,p_lock:lock,p_value:{center_code:'002',address_key:entry.key,address:entry.address,status:'ready',error:null,...data}});
       if(!p)throw fail('작업 잠금이 갱신되었습니다. 다시 불러와 주세요.',409);
      }
      const standard=normalizeAddress(p.standard_address||entry.address),detail=/\d+\s*(?:동|호)(?:\s|$)|지하|출입구|후문|정문/.test(entry.address);
      const identity=pointIdentity(p),alias=identity&&state.points.find(previous=>pointIdentity(previous)===identity);
      if(alias){state.aliases[entry.key]=alias.id;alias.addresses=[...new Set([...(alias.addresses??[alias.address]),entry.address])];}
      else state.points.push({id:p.id,address:entry.address,addressKey:entry.key,standardAddress:standard,detail,name:entry.name,x:Number(p.x),y:Number(p.y),regionKey:p.region_key,otd:entry.sources?.find(s=>s.otd)?.otd});
      state.geoCursor++;processed++;
     }catch(e){
      if(e.status!==422)throw e;
      const saved=await rpc('naver_api_save_address',{p_job:job.id,p_lock:lock,p_value:{center_code:'002',address_key:entry.key,address:entry.address,status:'attention',error:e.message}});
      if(!saved)throw fail('작업 잠금이 갱신되었습니다. 다시 불러와 주세요.',409);
      state.geoIssues.push({address:entry.address,error:e.message});state.geoCursor++;processed++;
     }
    }else{
     if(state.edgeCursor>=state.edges.length){jobStatus='completed';state.deferred=0;break;}
     const [fromIndex,toIndex,reason]=state.edges[state.edgeCursor],from=state.points[fromIndex],to=state.points[toIndex],coords=coordinateKey(from,to);
     const cached=await db('naver_api_legs?'+new URLSearchParams({select:'*',center_code:'eq.002',priority:'eq.RECOMMEND',coords_key:'eq.'+coords,order:'measured_at.desc',limit:'1'}));
     const prior=cached?.sort((a,b)=>Date.parse(b.measured_at)-Date.parse(a.measured_at))[0],fresh=prior&&Number.isFinite(Date.parse(prior.measured_at))&&(Date.parse(prior.measured_at)>=Date.parse(job.created_at)||Date.now()-Date.parse(prior.measured_at)<=1800000);
     try{
      let leg=prior;
      if(!fresh){
       leg=await retry('directions',f=>queryLeg(from,to,env,f));
       const saved=await rpc('naver_api_save_leg',{p_job:job.id,p_lock:lock,p_value:{center_code:'002',from_id:from.id,to_id:to.id,priority:'RECOMMEND',coords_key:coords,...leg}});
       if(!saved)throw fail('작업 잠금이 갱신되었습니다. 다시 불러와 주세요.',409);
       leg=saved;
      }
      if(fresh)state.cached++;state.completed++;state.consecutiveRejections=0;state.apiIssue=null;
      remember({fromId:from.id,toId:to.id,reason,distanceMeters:Number(leg.distance_meters),durationSeconds:Number(leg.duration_seconds),measuredAt:leg.measured_at,cached:!!fresh});
      state.edgeCursor++;processed++;
     }catch(e){
      const rejected=e.status===400&&e.providerStatus===400&&e.providerCode==='400';
      if(e.status!==422&&!rejected){state.apiIssue={phase:state.phase,fromId:from.id,toId:to.id,error:e.message,providerStatus:e.providerStatus,providerCode:e.providerCode,providerDetail:e.providerDetail};throw e;}
      const routeIssue={fromId:from.id,toId:to.id,reason,error:e.message,providerStatus:e.providerStatus,providerCode:e.providerCode,providerDetail:e.providerDetail,rejected};
      state.routeIssues=[...(state.routeIssues??[]),routeIssue].slice(-500);
      state.failed++;remember(routeIssue);state.edgeCursor++;processed++;
      state.consecutiveRejections=rejected?(state.consecutiveRejections??0)+1:0;
      if(state.consecutiveRejections>=3){state.apiIssue={...routeIssue,phase:state.phase};e.message='네이버가 연속 3개 구간의 요청을 거부해 수집을 중지했습니다. 오류 상세를 확인해 주세요.';throw e;}
     }
    }
   }
   if(state.phase==='directions'&&state.edgeCursor>=state.edges.length){jobStatus='completed';state.deferred=0;}
   const released=await rpc('naver_api_release',{p_job:job.id,p_lock:lock,p_state:state,p_status:jobStatus,p_error:jobError});claimed=null;
   if(!released)throw fail('작업 잠금이 갱신되었습니다. 다시 불러와 주세요.',409);
   return reply(200,summary(released));
  }catch(e){
   if(claimed&&state&&lock){
    try{
     if(e.providerDetail)state.apiIssue={...state.apiIssue,phase:state.phase,error:e.message,providerStatus:e.providerStatus,providerCode:e.providerCode,providerDetail:e.providerDetail};
     state.deferred=state.phase==='directions'?Math.max(0,state.edges.length-state.edgeCursor):0;
     const code=e.status??502,status=code===409&&state.phase==='directions'?'completed':code===408?'queued':'attention';
     const res=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/naver_api_release',{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({p_job:claimed.id,p_lock:lock,p_state:state,p_status:status,p_error:e.status?e.message:'구간 조회가 중단되었습니다. 저장된 지점에서 재개할 수 있습니다.'}),signal:AbortSignal.timeout(10000)});
     if(res.ok){const released=await res.json();if(released)return reply(200,summary(released));}
    }catch{}
   }
   return reply(e.status??502,{error:e.status?e.message:'구간 수집 연결 오류입니다. 저장된 작업을 불러와 주세요.'});
  }
 };
}
