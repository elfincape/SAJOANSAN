import {randomUUID} from 'node:crypto';
import {appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {query,quote} from './naver-browser-db.mjs';
import {browserDistance,browserCourseCapture,browserValidateAddress,naverPointFromUrl,addressSearch} from './lib/naver-map-browser.mjs';
import {optimizeCourseCapture} from './lib/naver-course-optimizer.mjs';
import {saveCourseCapture} from './lib/naver-capture-storage.mjs';
const ready="(status='queued' or (status='running' and updated_at<now()-interval '5 minutes'))";
export async function runWorker({db=query,lookup=browserDistance,capture=browserCourseCapture,validate=browserValidateAddress,saveCapture=saveCourseCapture,browserFactory,keepAlive=false,durationMs=20*60*1000,pollMs=30000,jobId=null,reservationId=null,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),log=console.log}={}){
 const create=browserFactory??(async()=>{const {chromium}=await import('playwright');return chromium.launch({headless:true});});
 const browser=await create(),worker=randomUUID(),stopAt=now()+durationMs;
 log(JSON.stringify({event:'naver_browser_runtime',browserVersion:browser.version?.()??'unknown',...( /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA??'')?{commit:process.env.GITHUB_SHA}:{})}));
 try{
  const page=await browser.newPage({locale:'ko-KR',viewport:{width:1280,height:1000}});
  for(;now()<stopAt;){
   const filter=jobId?' and id='+quote(jobId)+'::uuid':'';
   const eligible=jobId&&reservationId?'('+ready+" or (status='running' and worker_id="+quote(reservationId)+'::uuid))':ready;
   const claimed=await db("with next as(select id from public.naver_browser_jobs where "+eligible+filter+" order by created_at for update skip locked limit 1) update public.naver_browser_jobs j set status='running',worker_id="+quote(worker)+"::uuid,updated_at=now() from next where j.id=next.id returning j.id,j.origin,j.addresses,j.cursor,j.results,j.kind,j.courses,j.owner_id,j.center_code,j.validation_job_id,j.shortlist_job_id,j.candidate_plans");
   const job=claimed[0];
   if(!job){if(!keepAlive)break;await sleep(Math.min(pollMs,Math.max(0,stopAt-now())));continue;}
   log('Server browser started queued work');let interrupted=false,failures=0,validationResults;const routeCache=new Map(),addressCache=new Map(),routeContext={};
   if(job.kind==='validation'){
    const forced=new Set(job.addresses.filter(a=>job.results?.[a]?.status==='valid').map(a=>addressSearch(a).original));
    for(const [address,result]of Object.entries(job.results??{}))if(result?.status==='valid'&&result.query===address&&result.point&&!forced.has(addressSearch(address).original))try{const point=naverPointFromUrl('https://map.naver.com/p/directions/'+result.point.token+'/-/-/car',address,result.point);addressCache.set(address,point);addressCache.set(addressSearch(address).original,point);}catch{}
   }
   for(let i=job.cursor;i<job.addresses.length;i++){
    const state=await db('select status from public.naver_browser_jobs where id='+quote(job.id)+'::uuid');if(state[0]?.status!=='running'){interrupted=true;break;}
    if(now()>stopAt){await db("update public.naver_browser_jobs set status='queued',updated_at=now() where id="+quote(job.id)+"::uuid and worker_id="+quote(worker)+"::uuid and status='running'");interrupted=true;break;}
    const address=job.addresses[i];let result,optimization=job.results?.[address]?.optimization,providerPaused=false;
    const checkActive=async()=>{
     const current=await db("update public.naver_browser_jobs set updated_at=now() where id="+quote(job.id)+"::uuid and worker_id="+quote(worker)+"::uuid and status='running' returning status");
     if(current[0]?.status!=='running')throw Object.assign(Error('캡처 작업이 중지되었습니다.'),{code:'CAPTURE_PAUSED'});
     if(now()>stopAt){await db("update public.naver_browser_jobs set status='queued',updated_at=now() where id="+quote(job.id)+"::uuid and worker_id="+quote(worker)+"::uuid and status='running'");throw Object.assign(Error('다음 서버 작업에서 이어서 비교합니다.'),{code:'CAPTURE_PAUSED'});}
    };
    try{
     if(job.kind==='validation'){
      result=await validate(page,address,{checkActive,addressCache,routeContext});providerPaused=result.status==='network_error';
     }
     else if(job.kind==='capture'){
      const course=job.courses.find(c=>c.id===address);if(!course)throw Error('코스 입력 확인 필요');
      if(job.validation_job_id){
       if(!validationResults){const rows=await db("select results from public.naver_browser_jobs where id="+quote(job.validation_job_id)+"::uuid and kind='validation' and status='completed' and owner_id="+quote(job.owner_id)+"::uuid and center_code="+quote(job.center_code));validationResults=rows[0]?.results;}
       for(const stop of course.stops){const checked=validationResults?.[stop.trim()];if(checked?.status!=='valid'||checked.query!==stop.trim()||!checked.point)throw Object.assign(Error('주소 사전 검증 결과를 확인한 뒤 이 코스를 다시 실행해 주세요.'),{code:'ADDRESS_VALIDATION_REQUIRED'});try{const point=naverPointFromUrl('https://map.naver.com/p/directions/'+checked.point.token+'/-/-/car',stop,checked.point);addressCache.set(stop,point);}catch{throw Object.assign(Error('저장된 주소 확인 증거를 재검증해 주세요.'),{code:'ADDRESS_VALIDATION_REQUIRED'});}}
      }
      const onProgress=async state=>{optimization=state;await db("update public.naver_browser_jobs set results=results||jsonb_build_object("+quote(address)+','+quote(JSON.stringify({optimization:state}))+"::jsonb),updated_at=now() where id="+quote(job.id)+"::uuid and worker_id="+quote(worker)+"::uuid and status='running'");};
      if(job.shortlist_job_id&&!job.candidate_plans?.[address])throw Object.assign(Error('이 코스의 서버 API 후보 증거가 없습니다.'),{code:'SHORTLIST_INVALID_INPUT'});
      const {png,...details}=await optimizeCourseCapture(page,course,{measure:capture,previous:optimization,candidatePlan:job.candidate_plans?.[address],onProgress,checkActive,cache:routeCache,addressCache,routeContext});
      await checkActive();const uploadStarted=performance.now(),imagePath=await saveCapture(job,course,worker,png);details.metrics.uploadMs=performance.now()-uploadStarted;await checkActive();result={...details,imagePath};
     }
     else result=await lookup(page,job.origin,address);
     failures=0;
    }catch(e){
     if(e.code==='CAPTURE_PAUSED'){interrupted=true;break;}
     if(job.kind==='capture') {
      const known=['코스 주소 또는 경유지 한도 확인 필요','네이버 경유지 입력 개수 확인 필요','방문지 입력 누락 확인 필요','거리우선 경로 선택 확인 필요','네이버 코스 결과 패널을 확인하지 못했습니다.','네이버 캡처 영역 확인 필요','캡처 저장 서버 설정 확인 필요','캡처 이미지 크기 확인 필요','캡처 저장 인증 확인 필요','캡처 저장 서버 키 확인 필요','캡처 파일 저장 실패','네이버 경로 옵션 확인 필요','네이버 경로 옵션 거리 확인 필요','네이버 최단 표시거리 경로 선택 확인 필요','네이버 경로 옵션이 갱신되어 다시 조회해야 합니다.'];
      const stage=['ADDRESS_NOT_FOUND','NAVER_SEARCH_UNAVAILABLE','NAVER_ROUTE_UNAVAILABLE','OPTIMIZATION_INCOMPLETE','CAPTURE_DISTANCE_CHANGED'].includes(e.code)?e.code:known.includes(e.message)?e.message:e.name==='TimeoutError'?'BROWSER_TIMEOUT':'UNCLASSIFIED';
      const operation=String(e.message).match(/^(?:page|locator|browserContext|browser)\.[A-Za-z]+/)?.[0];
      console.error(JSON.stringify({event:'naver_capture_failed',stage,...(operation?{operation}:{}),...(e.reason?{reason:e.reason}:{}),...(e.searchDiagnostics?{searchDiagnostics:e.searchDiagnostics}:{}),...(e.routeDiagnostics?{routeDiagnostics:e.routeDiagnostics}:{}),...(e.optimization?{comparison:{completed:e.optimization.completed,total:e.optimization.total,failed:e.optimization.failed?.map(f=>({index:f.index,code:f.code,routeDiagnostics:f.routeDiagnostics}))}}:{})}));
     }
     const comparisonIssue=['OPTIMIZATION_INCOMPLETE','CAPTURE_DISTANCE_CHANGED','ADDRESS_VALIDATION_REQUIRED','SHORTLIST_INVALID_INPUT'].includes(e.code);providerPaused=['NAVER_SEARCH_UNAVAILABLE','NAVER_ROUTE_UNAVAILABLE'].includes(e.code);
     failures=e.code==='ADDRESS_NOT_FOUND'||comparisonIssue?0:failures+1;result={issue:providerPaused||e.code==='ADDRESS_NOT_FOUND'||comparisonIssue?e.message:job.kind==='capture'?'코스 캡처 확인 필요 — 주소 검색·지도 응답·저장 상태를 확인해 주세요.':'네이버 지도 거리우선 결과 확인 필요',...(providerPaused?{providerUnavailable:true,httpStatus:e.httpStatus}:{}),...(e.reason?{addressReason:e.reason}:{}),...(e.searchDiagnostics?{addressDiagnostics:e.searchDiagnostics}:{}),...(e.routeDiagnostics?{routeDiagnostics:e.routeDiagnostics}:{}),...(optimization?{optimization:e.optimization??optimization}:{}),measuredAt:new Date().toISOString()};}
    if(providerPaused){await db("update public.naver_browser_jobs set results=results||jsonb_build_object("+quote(address)+','+quote(JSON.stringify(result))+"::jsonb),status='attention',updated_at=now() where id="+quote(job.id)+"::uuid and worker_id="+quote(worker)+"::uuid and status='running'");interrupted=true;break;}
    await db("update public.naver_browser_jobs set results=results||jsonb_build_object("+quote(address)+','+quote(JSON.stringify(result))+"::jsonb),cursor="+(i+1)+",updated_at=now() where id="+quote(job.id)+"::uuid and worker_id="+quote(worker)+"::uuid and status='running'");
    log(job.kind==='validation'?'Server address validation saved':result.distanceText?'Server route result saved':'Server route needs attention');
    if(failures>=3){await db("update public.naver_browser_jobs set status='attention',updated_at=now() where id="+quote(job.id)+"::uuid and worker_id="+quote(worker)+"::uuid and status='running'");interrupted=true;break;}
   }
   if(!interrupted)await db("update public.naver_browser_jobs set status='completed',updated_at=now() where id="+quote(job.id)+"::uuid and worker_id="+quote(worker)+"::uuid and status='running'");
   if(jobId)break;
  }
 }finally{await browser.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--has-work')){
  const rows=await query('select exists(select 1 from public.naver_browser_jobs where '+ready+') as pending');
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'pending='+!!rows[0]?.pending+'\n');
  console.log(rows[0]?.pending?'Server browser work is pending':'No pending browser work');
 }else await runWorker({keepAlive:process.argv.includes('--serve'),durationMs:Number(process.env.NAVER_WORKER_MINUTES||20)*60000});
}
