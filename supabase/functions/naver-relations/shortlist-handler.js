import {createShortlistPlan,rankShortlist,SHORTLIST_POLICY,SCORE_SCOPE} from './shortlist-model.js';
import {queryShortlistLeg} from './provider.js';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const maxAgeMs=1800000;

// Validate the stored token against its stored numeric coordinates. Address selection
// itself was performed by the completed browser validation job, never by this API.
function verifiedPoint(checked,address){
 const p=checked?.point,fields=p?.token?.split(',')??[];
 if(checked?.status!=='valid'||checked.query!==address.trim()||!p?.text||fields.length!==5||!/^[-A-Za-z0-9_]{0,80}$/.test(fields[3])||!['ADDRESS_POI','PLACE_POI','SIMPLE_POI','BUS_STATION','SUBWAY_STATION'].includes(fields[4])||decodeURIComponent(fields[2])!==p.label?.trim())throw fail('A stored address validation is incomplete',422);
 let decoded;
 if(fields.slice(0,2).every(s=>/^-?\d+(?:\.\d+)?$/.test(s))){const [x,y]=fields.map(Number),r=6378137;decoded=[x/r*180/Math.PI,Math.atan(Math.sinh(y/r))*180/Math.PI];}
 else{
  const alphabet='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  decoded=fields.slice(0,2).map(s=>{if(!/^[A-Za-z0-9]{1,12}$/.test(s))throw fail('Invalid stored coordinate token',422);let n=0n;for(const c of s)n=n*62n+BigInt(alphabet.indexOf(c));if(n>BigInt(Number.MAX_SAFE_INTEGER))throw fail('Invalid stored coordinate token',422);return (Number(n)-2000000000)/1e7;});
 }
 if(!Array.isArray(p.coordinates)||p.coordinates.length!==2||p.coordinates.some((n,i)=>!Number.isFinite(n)||!Number.isFinite(decoded[i])||Math.abs(n-decoded[i])>1e-7)||Math.abs(p.coordinates[0])>180||Math.abs(p.coordinates[1])>90)throw fail('Stored token and coordinates disagree',422);
 return {id:address,coordinates:[...p.coordinates]};
}

function rankCourses(state,now){
 state.shortlists={};
 for(const [id,plan] of Object.entries(state.plans))state.shortlists[id]=rankShortlist(plan,state.matrixRows,{now,maxAgeMs});
 state.completed=Object.values(state.shortlists).filter(result=>result.completeMatrix).length;
}

export function shortlistSummary(job){
 // Freshness is evaluated on every response without rewriting historical results
 // or making provider requests. A completed job can no longer offer expired plans.
 const s=structuredClone(job.state??{});
 rankCourses(s,new Date().toISOString());
 const shortlists=s.shortlists??{},plannedCourses=Object.keys(s.plans??{}).length;
 const completedCourses=Object.values(shortlists).filter(result=>result.completeMatrix).length;
 return {id:job.id,kind:'capture-shortlist',status:job.status,error:job.error??'',updatedAt:job.updated_at,validationJob:s.validationJob,policy:SHORTLIST_POLICY,scoreScope:SCORE_SCOPE,approximate:true,globalMinimumGuaranteed:false,
  complete:job.status==='completed'&&!(s.issues?.length)&&completedCourses===s.courses?.length,
  totalCourses:s.courses?.length??0,plannedCourses,completedCourses,totalWebCandidates:Object.values(shortlists).reduce((n,r)=>n+(r.completeMatrix?r.candidates.length:0),0),
  totalEdges:s.edges?.length??0,processed:s.edgeCursor??0,cached:s.cached??0,failed:s.failed??0,issues:s.issues??[],apiIssue:s.apiIssue??null,shortlists,
  directionsAttempts:job.directions_attempts??0,directionsBudget:job.directions_budget,geocodingAttempts:job.geocoding_attempts??0,geocodingBudget:job.geocoding_budget};
}

export async function handleShortlist({body,user,env,db,rpc,fetcher,sleep}){
 const ownerScope={owner_id:'eq.'+user.id,center_code:'eq.'+body.center};
 if(body.action==='shortlist-create'){
  if(!uuid(body.validationJobId))throw fail('A validation job ID is required');
  const sourceRows=await db('naver_browser_jobs?'+new URLSearchParams({select:'id,owner_id,center_code,kind,status,courses,results',id:'eq.'+body.validationJobId,...ownerScope,kind:'eq.validation',status:'eq.completed'}));
  const source=sourceRows?.[0];
  if(!source||source.owner_id!==user.id||source.center_code!==body.center||source.kind!=='validation'||source.status!=='completed')throw fail('A completed validation job owned by this user is required',404);
  if(!Array.isArray(source.courses)||!source.courses.length||source.courses.length>2000)throw fail('The validation job requires one to 2000 courses',422);
  const active=await db('naver_api_jobs?'+new URLSearchParams({select:'id',...ownerScope,status:'in.(queued,running)',limit:'2'}));
  if(active?.length>=2)throw fail('Complete the existing API jobs first',409);
  const state={kind:'capture-shortlist',phase:'directions',validationJob:source.id,courses:structuredClone(source.courses),plans:{},matrixRows:[],shortlists:{},edges:[],edgeCursor:0,cached:0,failed:0,completed:0,issues:[]};
  const seen=new Set(),edges=new Map();
  for(const course of source.courses){
   if(typeof course?.id!=='string'||!course.id||seen.has(course.id)||['__proto__','constructor','prototype'].includes(course.id))throw fail('Course IDs must be unique',422);
   seen.add(course.id);
   try{
    if(!Array.isArray(course.stops))throw fail('Course stops are missing',422);
    const points=new Map(course.stops.map(stop=>{if(typeof stop!=='string')throw fail('Invalid course stop',422);return [stop,verifiedPoint(source.results?.[stop.trim()],stop)];}));
    const plan=createShortlistPlan(course,points);
    if(!plan.webEligible){state.issues.push({courseId:course.id,code:'WEB_WAYPOINT_LIMIT',webWaypoints:plan.webWaypoints});continue;}
    state.plans[course.id]=plan;
    for(const edge of plan.edges)if(!edge.zeroCost&&!edges.has(edge.key))edges.set(edge.key,edge);
   }catch{state.issues.push({courseId:course.id,code:'ADDRESS_VALIDATION_REQUIRED'});}
  }
  state.edges=[...edges.values()];
  if(state.edges.length>25000)throw fail('The directed edge budget exceeds 25000 requests',422);
  // Cache is isolated to this owner's same-center shortlist jobs. Never overwrite
  // legacy address/leg tables or reuse their single-option recommendation rows.
  const previous=await db('naver_api_jobs?'+new URLSearchParams({select:'owner_id,center_code,state',...ownerScope,'state->>kind':'eq.capture-shortlist',order:'created_at.desc',limit:'100'}));
  const now=new Date().toISOString(),cache=new Map();
  for(const job of previous??[]){
   if(job.owner_id!==user.id||job.center_code!==body.center||job.state?.kind!=='capture-shortlist')continue;
   for(const row of job.state.matrixRows??[]){
    if(!edges.has(row?.key)||cache.has(row.key))continue;
    // Reuse the model's exact freshness/settings/shape validation.
    const edge=edges.get(row.key),check=rankShortlist({policy:SHORTLIST_POLICY,settings:{options:['traoptimal','trafast','tracomfort']},edges:[edge],candidates:[]},[row],{now,maxAgeMs});
    if(check.completeMatrix)cache.set(row.key,{...row,cached:true});
   }
  }
  state.matrixRows=[...cache.values()];state.cached=cache.size;rankCourses(state,now);
  const terminal=state.edges.length===cache.size;
  if(terminal)state.edgeCursor=state.edges.length;
  const status=terminal?(state.issues.length?'attention':'completed'):'queued';
  const jobs=await db('naver_api_jobs',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({owner_id:user.id,center_code:body.center,status,state,directions_budget:state.edges.length,geocoding_budget:0})});
  if(!jobs?.[0])throw fail('Could not create the API shortlist job',502);
  return shortlistSummary(jobs[0]);
 }
 if(!uuid(body.jobId))throw fail('An API shortlist job ID is required');
 const jobs=await db('naver_api_jobs?'+new URLSearchParams({select:'*',id:'eq.'+body.jobId,...ownerScope}));
 let job=jobs?.[0];
 if(!job||job.owner_id!==user.id||job.center_code!==body.center||job.state?.kind!=='capture-shortlist')throw fail('An API shortlist job owned by this user is required',404);
 if(body.action==='shortlist-status'||!['queued','running'].includes(job.status))return shortlistSummary(job);
 if(!env.NAVER_MAPS_CLIENT_ID||!env.NAVER_MAPS_CLIENT_SECRET)throw fail('Existing Naver Maps settings are missing',503);
 const lock=crypto.randomUUID(),claimed=await rpc('naver_api_claim',{p_job:job.id,p_lock:lock});
 if(!claimed)return {...shortlistSummary(job),busy:job.status==='running'};
 job=claimed;
 if(job.owner_id!==user.id||job.center_code!==body.center||job.state?.kind!=='capture-shortlist')throw fail('The job owner or scope changed',409);
 const state=structuredClone(job.state),started=Date.now();let calls=0,status='queued',error=null;
 try{
  const ready=new Set(state.matrixRows.map(row=>row.key));
  while(state.edgeCursor<state.edges.length){
   const edge=state.edges[state.edgeCursor];
   if(ready.has(edge.key)){state.edgeCursor++;continue;}
   if(calls>=15||Date.now()-started>=40000)break;
   try{
    const result=await queryShortlistLeg(edge.from,edge.to,env,async(url,init)=>{
     if(Date.now()-started>=45000)throw fail('Continue in the next batch',408);
     await sleep(500);
     if(!await rpc('naver_api_reserve',{p_job:job.id,p_lock:lock,p_kind:'directions'}))throw fail('The request budget or worker lease is no longer available',409);
     calls++;return fetcher(url,init);
    },AbortSignal.timeout(Math.max(1,Math.min(10000,45000-(Date.now()-started)))));
    state.matrixRows.push({key:edge.key,...result});ready.add(edge.key);
   }catch(e){
    if([401,403,429,409,408,503].includes(e.status))throw e;
    state.failed++;state.issues.push({key:edge.key,code:'DIRECTED_LEG_FAILED'});
   }
   state.edgeCursor++;
  }
  rankCourses(state,new Date().toISOString());
  if(state.edgeCursor>=state.edges.length)status=state.issues.length||Object.values(state.shortlists).some(r=>!r.completeMatrix)?'attention':'completed';
 }catch(e){
  status=e.status===408?'queued':'attention';error=e.status===409?'The API request budget or worker lease needs attention':e.status===429?'Naver API request quota needs attention':e.status===401||e.status===403?'Naver API access needs attention':'API shortlist processing needs attention';
  state.apiIssue={code:e.status??502,message:error};rankCourses(state,new Date().toISOString());
 }
 const released=await rpc('naver_api_release',{p_job:job.id,p_lock:lock,p_state:state,p_status:status,p_error:error});
 if(!released)throw fail('The API shortlist worker lease was lost',409);
 return shortlistSummary(released);
}
