export const COMPARISON_POLICY='naver-all-driving-options-meters-v2';
export const SHORTLIST_WEB_POLICY='naver-api-top3-web-meters-v1';

import {coursePermutations} from '../../supabase/functions/naver-relations/course-permutations.js';
export {coursePermutations};

const validDistance=r=>typeof r?.routeLabel==='string'&&r.routeLabel.trim()&&r.method==='naver-map-display'&&Number.isFinite(r.distanceKm)&&r.distanceKm>=0&&typeof r.distanceText==='string'&&(r.distanceMeters===undefined||Number.isSafeInteger(r.distanceMeters)&&r.distanceMeters>=0&&r.distanceKm===r.distanceMeters/1000);
const inputKeyFor=course=>JSON.stringify([COMPARISON_POLICY,course.rotation??0,course.stops]);
export function comparisonScope(course,candidatePlan){
 const all=coursePermutations(course);
 if(!candidatePlan)return {routes:all,policy:COMPARISON_POLICY,inputKey:inputKeyFor(course)};
 let source;try{source=JSON.parse(candidatePlan.inputKey??'null');}catch{throw Object.assign(Error('서버 API 후보 입력 증거를 읽지 못했습니다.'),{code:'SHORTLIST_INVALID_INPUT'});}const candidates=candidatePlan.candidates;
 if(candidatePlan.policy!=='naver-directed-leg-meter-shortlist-v2'||candidatePlan.scoreScope!=='center-through-deliveries'||!candidatePlan.completeMatrix||candidatePlan.globalMinimumGuaranteed!==false||candidatePlan.webEligible!==true||candidatePlan.totalPermutations!==all.length||!Array.isArray(source)||source[1]!== (course.rotation??0)||JSON.stringify(source[2])!==JSON.stringify(course.stops)||!Array.isArray(candidates)||candidates.length!==Math.min(3,all.length)||new Set(candidates.map(c=>c.index)).size!==candidates.length||candidates.some(c=>!Number.isInteger(c.index)||!all[c.index]||JSON.stringify(c.stops)!==JSON.stringify(all[c.index])||!Number.isSafeInteger(c.apiPartialMeters)||c.apiPartialMeters<0))throw Object.assign(Error('서버 API 후보 증거가 현재 코스와 일치하지 않습니다.'),{code:'SHORTLIST_INVALID_INPUT'});
 const ordered=[...candidates].sort((a,b)=>a.index-b.index);
 return {routes:ordered.map(c=>c.stops),policy:SHORTLIST_WEB_POLICY,inputKey:JSON.stringify([SHORTLIST_WEB_POLICY,course.rotation??0,course.stops,candidatePlan.inputKey,ordered.map(c=>c.index)]),selection:candidatePlan};
}
const pointKey=url=>{try{const p=new URL(url).pathname.split('/');return p[6]==='car'?p.slice(3,6):null;}catch{return null;}};
const evidenceKey=r=>JSON.stringify([r.distanceMeters??null,r.legEvidence?.source??null,r.legEvidence?.verified??null,r.legEvidence?.pathIdentity??null,r.legEvidence?.totalMeters??null,r.legEvidence?.distancesMeters??null,r.legEvidence?.logicalPointMapping??null,r.legEvidence?.providerOption?[r.legEvidence.providerOption.main,r.legEvidence.providerOption.sub]:null,r.requestSettings?Object.entries(r.requestSettings).sort(([a],[b])=>a.localeCompare(b)):null,pointKey(r.sourceUrl)]);
export function captureResultVerified(course,result){
 try{
  const state=result?.optimization,scope=comparisonScope(course,state?.selection),routes=scope.routes,keys=routes.map(stops=>JSON.stringify(stops)),selected=JSON.stringify(result?.orderedStops);
  if(!result?.imagePath||!result.sourceUrl?.startsWith('https://map.naver.com/')||!validDistance(result)||!state?.complete||state.policy!==scope.policy||state.inputKey!==scope.inputKey||state.total!==routes.length||state.completed!==routes.length||state.failed?.length!==0||Object.keys(state.evaluations??{}).length!==routes.length||!keys.includes(selected)||JSON.stringify(result.requestedStops)!==selected)return false;
  const evaluations=keys.map(key=>state.evaluations[key]),winner=state.evaluations[selected];
  return evaluations.every(validDistance)&&result.distanceKm===Math.min(...evaluations.map(r=>r.distanceKm))&&result.distanceKm===winner.distanceKm&&result.routeLabel===winner.routeLabel&&evidenceKey(result)===evidenceKey(winner);
 }catch{return false;}
}
export async function optimizeCourseCapture(page,course,{measure,previous,candidatePlan,onProgress=async()=>{},checkActive=async()=>{},cache=new Map(),addressCache=new Map(),routeContext={}}={}) {
 const started=performance.now(),metrics={routeLookups:0,routeCacheHits:0,addressResolutionMs:0,searchRefreshMs:0,routeRequestMs:0,optionCompareMs:0,captureMs:0,addressQueries:0,addressCacheHits:0,routeRequests:0,networkAddressRequests:0};
 const lookup=async(stops,options)=>{metrics.routeLookups++;const result=await measure(page,stops,{...options,addressCache,routeContext});for(const key of Object.keys(metrics))if(typeof result.timings?.[key]==='number')metrics[key]+=result.timings[key];return result;};
 const scope=comparisonScope(course,candidatePlan),{routes,inputKey}=scope;
 const evaluations={},state={version:1,policy:scope.policy,inputKey,total:routes.length,completed:0,failed:[],evaluations,complete:false,...(scope.selection?{selection:scope.selection,allPermutations:scope.selection.totalPermutations,globalMinimumGuaranteed:false}:{})};
 if(previous?.version===1&&previous.inputKey===inputKey)for(const stops of routes){const key=JSON.stringify(stops),saved=previous.evaluations?.[key];if(validDistance(saved))evaluations[key]=saved;}
 const report=async()=>{state.completed=Object.keys(evaluations).length;await onProgress(structuredClone(state));};
 await checkActive();await report();let consecutiveFailures=0,bestCapture;
 for(const [index,stops] of routes.entries()) {
  await checkActive();const key=JSON.stringify(stops),cacheKey=JSON.stringify([COMPARISON_POLICY,stops]);
  state.current=index+1;
  if(evaluations[key])continue;
  try {
   let result=cache.get(cacheKey);
   if(!validDistance(result))result=await lookup(stops,{screenshot:false,checkActive,captureIf:candidate=>validDistance(candidate)&&Object.values(evaluations).every(other=>candidate.distanceKm<other.distanceKm)});else metrics.routeCacheHits++;
   if(!validDistance(result))throw Error('거리우선 주행거리 확인 필요');
   const {png,...details}=result;
   // Keep only the current winning image, from the exact lookup used in the comparison.
   // Buffers never enter checkpoints/cache; a resumed winner without an image is revalidated below.
   if(png?.length&&Object.values(evaluations).every(other=>result.distanceKm<other.distanceKm))bestCapture={key,result};
   evaluations[key]=details;cache.set(cacheKey,details);consecutiveFailures=0;
  }catch(e){
   if(e.code==='CAPTURE_PAUSED')throw e;
   state.failed.push({index:index+1,code:e.code??(e.name==='TimeoutError'?'BROWSER_TIMEOUT':'ROUTE_LOOKUP_FAILED'),message:String(e.message).split('\n')[0].slice(0,160),...(e.routeDiagnostics?{routeDiagnostics:e.routeDiagnostics}:{})});
   consecutiveFailures++;
   await report();
   if(['ADDRESS_NOT_FOUND','NAVER_SEARCH_UNAVAILABLE','NAVER_ROUTE_UNAVAILABLE'].includes(e.code)){e.optimization=structuredClone(state);throw e;}
   if(consecutiveFailures>=3)break;
   continue;
  }
  await report();
 }
 await checkActive();
 if(state.failed.length||state.completed!==routes.length)throw Object.assign(Error(`납품처 순서 비교 미완료 · ${state.completed}/${state.total}개 확인 · 실패 ${state.failed.length}개. 재시도해 주세요.`),{code:'OPTIMIZATION_INCOMPLETE',optimization:structuredClone(state)});
 let selected=routes[0];
 for(const stops of routes)if(evaluations[JSON.stringify(stops)].distanceKm<evaluations[JSON.stringify(selected)].distanceKm)selected=stops;
 const expected=evaluations[JSON.stringify(selected)];state.bestStops=selected;
 await report();await checkActive();
 const captured=bestCapture?.key===JSON.stringify(selected)?bestCapture.result:await lookup(selected,{screenshot:true,checkActive});
 await checkActive();
 if(!validDistance(captured)||captured.distanceKm!==expected.distanceKm||captured.routeLabel!==expected.routeLabel||evidenceKey(captured)!==evidenceKey(expected)||!captured.png?.length||JSON.stringify(captured.requestedStops??selected)!==JSON.stringify(selected)||(expected.resolvedStops&&JSON.stringify(captured.resolvedStops)!==JSON.stringify(expected.resolvedStops))) {
  delete evaluations[JSON.stringify(selected)];cache.delete(JSON.stringify([COMPARISON_POLICY,selected]));await report();
  throw Object.assign(Error('최종 캡처의 순서·거리가 비교 결과와 달라 최단 검증을 완료하지 못했습니다. 재시도해 주세요.'),{code:'CAPTURE_DISTANCE_CHANGED',optimization:structuredClone(state)});
 }
 state.complete=true;state.failed=[];await report();
 return {...captured,orderedStops:selected,optimization:structuredClone(state),metrics:{...metrics,elapsedMs:performance.now()-started}};
}
