export const COMPARISON_POLICY='naver-all-driving-options-v1';

export function coursePermutations(course) {
 const {stops,rotation}=course;
 if(course.rotations===2&&!rotation)throw Error('이전 통합 코스는 원본 엑셀을 다시 등록해 주세요.');
 if(!Array.isArray(stops)||stops.length<(rotation===2?3:4)||stops.length>7||stops.some(s=>typeof s!=='string'||!s.trim()))throw Error('코스 주소 또는 경유지 한도 확인 필요');
 const fixed=rotation===2?1:2,deliveries=stops.slice(fixed,-1),routes=[];
 function visit(prefix,remaining){
  if(!remaining.length){routes.push([...stops.slice(0,fixed),...prefix,stops.at(-1)]);return;}
  const used=new Set();
  for(let i=0;i<remaining.length;i++)if(!used.has(remaining[i])){used.add(remaining[i]);visit([...prefix,remaining[i]],remaining.filter((_,j)=>j!==i));}
 }
 visit([],deliveries);return routes;
}

const validDistance=r=>typeof r?.routeLabel==='string'&&r.routeLabel.trim()&&r.method==='naver-map-display'&&Number.isFinite(r.distanceKm)&&r.distanceKm>=0&&typeof r.distanceText==='string';
const inputKeyFor=course=>JSON.stringify([COMPARISON_POLICY,course.rotation??0,course.stops]);
export function captureResultVerified(course,result){
 try{
  const routes=coursePermutations(course),state=result?.optimization,keys=routes.map(stops=>JSON.stringify(stops)),selected=JSON.stringify(result?.orderedStops);
  if(!result?.imagePath||!result.sourceUrl?.startsWith('https://map.naver.com/')||!validDistance(result)||!state?.complete||state.policy!==COMPARISON_POLICY||state.inputKey!==inputKeyFor(course)||state.total!==routes.length||state.completed!==routes.length||state.failed?.length!==0||Object.keys(state.evaluations??{}).length!==routes.length||!keys.includes(selected)||JSON.stringify(result.requestedStops)!==selected)return false;
  const evaluations=keys.map(key=>state.evaluations[key]),winner=state.evaluations[selected];
  return evaluations.every(validDistance)&&result.distanceKm===Math.min(...evaluations.map(r=>r.distanceKm))&&result.distanceKm===winner.distanceKm&&result.routeLabel===winner.routeLabel;
 }catch{return false;}
}
export async function optimizeCourseCapture(page,course,{measure,previous,onProgress=async()=>{},checkActive=async()=>{},cache=new Map()}={}) {
 const routes=coursePermutations(course),inputKey=inputKeyFor(course);
 const evaluations={},state={version:1,policy:COMPARISON_POLICY,inputKey,total:routes.length,completed:0,failed:[],evaluations,complete:false};
 if(previous?.version===1&&previous.inputKey===inputKey)for(const stops of routes){const key=JSON.stringify(stops),saved=previous.evaluations?.[key];if(validDistance(saved))evaluations[key]=saved;}
 const report=async()=>{state.completed=Object.keys(evaluations).length;await onProgress(structuredClone(state));};
 await checkActive();await report();let consecutiveFailures=0;
 for(const [index,stops] of routes.entries()) {
  await checkActive();const key=JSON.stringify(stops),cacheKey=JSON.stringify([COMPARISON_POLICY,stops]);
  state.current=index+1;
  if(evaluations[key])continue;
  try {
   let result=cache.get(cacheKey);
   if(!validDistance(result))result=await measure(page,stops,{screenshot:false,checkActive});
   if(!validDistance(result))throw Error('거리우선 주행거리 확인 필요');
   const {png,...details}=result;
   evaluations[key]=details;cache.set(cacheKey,details);consecutiveFailures=0;
  }catch(e){
   if(e.code==='CAPTURE_PAUSED')throw e;
   state.failed.push({index:index+1,code:e.code??(e.name==='TimeoutError'?'BROWSER_TIMEOUT':'ROUTE_LOOKUP_FAILED'),message:String(e.message).split('\n')[0].slice(0,160)});
   consecutiveFailures++;
   await report();
   if(e.code==='ADDRESS_NOT_FOUND'){e.optimization=structuredClone(state);throw e;}
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
 const captured=await measure(page,selected,{screenshot:true,checkActive});
 await checkActive();
 if(!validDistance(captured)||captured.distanceKm!==expected.distanceKm||captured.routeLabel!==expected.routeLabel||!captured.png?.length||JSON.stringify(captured.requestedStops??selected)!==JSON.stringify(selected)||(expected.resolvedStops&&JSON.stringify(captured.resolvedStops)!==JSON.stringify(expected.resolvedStops))) {
  delete evaluations[JSON.stringify(selected)];cache.delete(JSON.stringify([COMPARISON_POLICY,selected]));await report();
  throw Object.assign(Error('최종 캡처의 순서·거리가 비교 결과와 달라 최단 검증을 완료하지 못했습니다. 재시도해 주세요.'),{code:'CAPTURE_DISTANCE_CHANGED',optimization:structuredClone(state)});
 }
 state.complete=true;state.failed=[];await report();
 return {...captured,orderedStops:selected,optimization:structuredClone(state)};
}
