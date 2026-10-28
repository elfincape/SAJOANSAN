import {randomUUID} from 'node:crypto';
import {appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {query,quote} from './naver-browser-db.mjs';
import {browserDistance,browserCourseCapture} from './lib/naver-map-browser.mjs';
import {saveCourseCapture} from './lib/naver-capture-storage.mjs';
const ready="(status='queued' or (status='running' and updated_at<now()-interval '5 minutes'))";
export async function runWorker({db=query,lookup=browserDistance,capture=browserCourseCapture,saveCapture=saveCourseCapture,browserFactory,keepAlive=false,durationMs=20*60*1000,pollMs=30000,jobId=null,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),log=console.log}={}){
 const create=browserFactory??(async()=>{const {chromium}=await import('playwright');return chromium.launch({headless:true});});
 const browser=await create(),worker=randomUUID(),stopAt=now()+durationMs;
 try{
  const page=await browser.newPage({locale:'ko-KR',viewport:{width:1280,height:1000}});
  for(;now()<stopAt;){
   const filter=jobId?' and id='+quote(jobId)+'::uuid':'';
   const claimed=await db("with next as(select id from public.naver_browser_jobs where "+ready+filter+" order by created_at for update skip locked limit 1) update public.naver_browser_jobs j set status='running',worker_id="+quote(worker)+"::uuid,updated_at=now() from next where j.id=next.id returning j.id,j.origin,j.addresses,j.cursor,j.results,j.kind,j.courses,j.owner_id");
   const job=claimed[0];
   if(!job){if(!keepAlive)break;await sleep(Math.min(pollMs,Math.max(0,stopAt-now())));continue;}
   log('Server browser started queued work');let interrupted=false,failures=0;
   for(let i=job.cursor;i<job.addresses.length;i++){
    const state=await db('select status from public.naver_browser_jobs where id='+quote(job.id)+'::uuid');if(state[0]?.status!=='running'){interrupted=true;break;}
    if(now()>stopAt){await db("update public.naver_browser_jobs set status='queued',updated_at=now() where id="+quote(job.id)+"::uuid and worker_id="+quote(worker)+"::uuid and status='running'");interrupted=true;break;}
    const address=job.addresses[i];let result;
    try{
     if(job.kind==='capture'){const course=job.courses.find(c=>c.id===address);if(!course)throw Error('코스 입력 확인 필요');const {png,...details}=await capture(page,course.stops);const imagePath=await saveCapture(job,course,worker,png);result={...details,imagePath};}
     else result=await lookup(page,job.origin,address);
     failures=0;
    }catch(e){failures=e.code==='ADDRESS_NOT_FOUND'?0:failures+1;result={issue:e.code==='ADDRESS_NOT_FOUND'?e.message:job.kind==='capture'?'코스 캡처 확인 필요 — 주소 검색·지도 응답·저장 상태를 확인해 주세요.':'네이버 지도 거리우선 결과 확인 필요',measuredAt:new Date().toISOString()};}
    await db("update public.naver_browser_jobs set results=results||jsonb_build_object("+quote(address)+','+quote(JSON.stringify(result))+"::jsonb),cursor="+(i+1)+",updated_at=now() where id="+quote(job.id)+"::uuid and worker_id="+quote(worker)+"::uuid and status='running'");
    log(result.distanceText?'Server route result saved':'Server route needs attention');
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
