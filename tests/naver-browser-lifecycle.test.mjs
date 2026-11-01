import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const originalFetch=globalThis.fetch,names=['GITHUB_REPOSITORY','GITHUB_RUN_ID','GH_TOKEN'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]])),calls=[];
try{
 Object.assign(process.env,{GITHUB_REPOSITORY:'example/repo',GITHUB_RUN_ID:'9',GH_TOKEN:'test-only'});
 globalThis.fetch=async(url,options={})=>{
  calls.push({url,options});assert.equal(options.headers.Authorization,'Bearer test-only');
  if(url.endsWith('/runs?per_page=30'))return {ok:true,json:async()=>({workflow_runs:[{id:9,head_branch:'main',status:'in_progress'},{id:8,head_branch:'main',status:'in_progress'},{id:7,head_branch:'main',status:'completed'},{id:6,head_branch:'feature',status:'queued'}]})};
  return {ok:true,status:204};
 };
 const run=async file=>import('data:text/javascript,'+encodeURIComponent(await readFile(new URL('../scripts/'+file,import.meta.url),'utf8')));
 await run('naver-browser-replace.mjs');assert.equal(calls.length,2);assert(calls[1].url.endsWith('/actions/runs/8/force-cancel'));assert.equal(calls[1].options.method,'POST');
 calls.length=0;await run('naver-browser-handoff.mjs');assert.equal(calls.length,1);assert(calls[0].url.endsWith('/actions/workflows/naver-browser-server.yml/dispatches'));assert.deepEqual(JSON.parse(calls[0].options.body),{ref:'main'});
}finally{globalThis.fetch=originalFetch;for(const name of names)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
console.log('Worker replacement excludes current/completed/other-branch runs; continuation only dispatches the same main workflow');

const {upgradeCaptureContract}=await import('../scripts/lib/naver-capture-contract.mjs');
const captureSql=await readFile(new URL('../repo-root/sql/naver-course-captures.sql',import.meta.url),'utf8');
const oldSaved="where e.value->>'imagePath' is not null";
const expectedDefinition=captureSql.slice(captureSql.indexOf('create or replace function'),captureSql.indexOf('revoke all'));
const checkpointRule=oldSaved+" or (e.value->'optimization'->>'version'='1' and e.value->'optimization'->>'policy' in ('naver-all-driving-options-v1','naver-all-driving-options-meters-v2'))";
const oldDefinition=expectedDefinition.replace(checkpointRule,oldSaved).replace("where saved->(value->>'id')->>'imagePath' is null","where not(saved ? (value->>'id'))");
assert.notEqual(oldDefinition,expectedDefinition,'Exercise the deployed pre-checkpoint retry contract');
const upgraded=upgradeCaptureContract(oldDefinition);
assert.equal(upgraded,expectedDefinition);
assert(upgraded.includes(checkpointRule),'Retries retain both display-distance and exact-meter checkpoints as well as completed images');
assert.equal(upgradeCaptureContract(expectedDefinition.replace(" in ('naver-all-driving-options-v1','naver-all-driving-options-meters-v2')","='naver-all-driving-options-v1'")),expectedDefinition,'Upgrade the currently deployed v1 retry policy without dropping other validation');
assert.equal(upgradeCaptureContract(upgraded),upgraded,'Queue upgrade is idempotent');
assert(upgraded.includes("where not(saved ? (value->>'id'))")===false,'A checkpoint must not count as a completed image');
const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')),workflow=await readFile(new URL('../.github/workflows/naver-browser-server.yml',import.meta.url),'utf8');
assert([...workflow.matchAll(/playwright@([\d.]+)/g)].every(m=>m[1]===manifest.devDependencies.playwright),'Server verify and worker must use the browser version pinned by the project');

assert(workflow.includes("if: ${{ !cancelled() && steps.browser_worker.outcome != 'skipped' }}"),'Infrastructure failures retain handoff; cancellation and setup failures do not restart work');
{
 const {sameCaptureInput,canResumeCapture}=await import('../app/src/domain/naver-address-validation.ts');
 const input=[{id:'row-2',sourceRow:2,name:'가상 1회',rotation:1,stops:['G','C','A','C']}];
 assert.equal(typeof canResumeCapture,'function');
 const frozen={courses:input,addresses:['row-2'],results:{},validation_job_id:'old-approval',shortlist_job_id:'plan'};
 assert.equal(canResumeCapture(frozen,input,'api3','old-approval'),true);
 assert.equal(canResumeCapture({...frozen,addresses:[]},input,'api3','old-approval'),false,'blocked courses require a newly approved enqueue');
 assert.equal(canResumeCapture(frozen,input,'api3','new-approval'),false,'new validation must not be ignored by frozen resume');
 assert.equal(sameCaptureInput(input,[{stops:['G','C','A','C'],rotation:1,name:'가상 1회',sourceRow:2,id:'row-2'}]),true);
 for(const change of [{stops:['G','C','B','C']},{rotation:2},{sourceRow:3},{name:'다른 호차'}])assert.equal(sameCaptureInput(input,[{...input[0],...change}]),false);
}
if(process.env.PGLITE_MODULE){
 const {PGlite}=await import(process.env.PGLITE_MODULE);const pg=new PGlite();
 try{
  const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',validation='44444444-4444-4444-8444-444444444444',shortlist='55555555-5555-4555-8555-555555555555';
  await pg.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function operations_resource_allowed(text,text,text) returns boolean language sql stable as $$select auth.uid() is not null and $3 in ('001','002')$$;grant usage on schema auth,public to authenticated;`);
  await pg.exec(await readFile(new URL('../repo-root/sql/naver-browser-jobs.sql',import.meta.url),'utf8'));
  await pg.exec("alter table naver_browser_jobs add column kind text default 'capture',add column courses jsonb,add column validation_job_id uuid,add column shortlist_job_id uuid,add column candidate_plans jsonb default '{}' ");
  await pg.exec(await readFile(new URL('../repo-root/sql/naver-capture-resume.sql',import.meta.url),'utf8'));
  {
   const {runWorker}=await import('../scripts/naver-browser-worker.mjs'),captureId='66666666-6666-4666-8666-666666666666',courses=[{id:'partial',stops:['G','C','A','B','G']},{id:'independent',rotation:2,stops:['C','D','G']}];let rejected=false,clock=0;
   await pg.query("insert into naver_browser_jobs(id,owner_id,center_code,origin,addresses,status,kind,courses) values($1,$2,'001','synthetic',$3,'queued','capture',$4)",[captureId,owner,courses.map(c=>c.id),courses]);
   const execute=()=>{clock=0;return runWorker({jobId:captureId,durationMs:100,now:()=>clock,db:async sql=>(await pg.query(sql)).rows,browserFactory:async()=>({newPage:async()=>({}),close:async()=>{}}),capture:async(_p,stops,o)=>{
    if(stops.includes('B')&&stops.indexOf('B')<stops.indexOf('A')){rejected=true;clock=101;throw Object.assign(Error('route400'),{code:'NAVER_ROUTE_UNAVAILABLE',reason:'PROVIDER_HTTP_ERROR',httpStatus:400,routeDiagnostics:{responseEvidence:{restrictionConfirmed:false}}});}
    const r={distanceKm:10,distanceText:'10km',routeLabel:'거리우선',method:'naver-map-display',requestedStops:stops};return{...r,...(o.screenshot||o.captureIf?.(r)?{png:Buffer.from('png')}:{})};
   },saveCapture:async(_j,c)=>c.id+'.png',log:()=>{}});};
   await execute();const yielded=(await pg.query('select * from naver_browser_jobs where id=$1',[captureId])).rows[0];assert.equal(yielded.status,'queued');assert.equal(yielded.cursor,1);assert.equal(yielded.results.partial.retryRequired,true);assert(!yielded.results.independent);
   await execute();const stored=(await pg.query('select * from naver_browser_jobs where id=$1',[captureId])).rows[0];
   assert(rejected);assert.equal(stored.status,'attention');assert.equal(stored.cursor,2);assert.equal(stored.results.partial.retryRequired,true);assert.equal(stored.results.partial.optimization.completed,1);assert(!stored.results.partial.imagePath);assert.equal(stored.results.independent.imagePath,'independent.png');
   await pg.exec(`set "request.jwt.claim.sub"='${owner}'`);await pg.query("select naver_capture_resume($1,'001',$2,'full')",[captureId,courses]);const resumed=(await pg.query('select * from naver_browser_jobs where id=$1',[captureId])).rows[0];assert.deepEqual(resumed.addresses,['partial']);assert.deepEqual(resumed.results,stored.results);await pg.query('delete from naver_browser_jobs where id=$1',[captureId]);
   console.log('PASS individual HTTP400: real worker SQL preserves partial comparison, continues independent rotation, ends attention, resumes only unfinished work');
  }

  const courses=[{id:'row-2',rotation:1,stops:['G','C','A','C']},{id:'row-3',rotation:2,stops:['C','B','D','G']}],results={'row-2':{imagePath:'keep.png',optimization:{version:1,policy:'naver-api-top3-web-meters-v1',complete:true,completed:1,total:1,failed:[]}},'row-3':{optimization:{version:1,policy:'naver-api-top3-web-meters-v1',complete:false,completed:1,total:2,failed:[{code:'NAVER_ROUTE_UNAVAILABLE'}],evaluations:{keep:{distanceKm:7}}}}};
  await pg.query("insert into naver_browser_jobs(id,owner_id,center_code,origin,addresses,status,cursor,kind,courses,results,validation_job_id,shortlist_job_id,candidate_plans) values($1,$2,'001','synthetic',$3,'attention',1,'capture',$4,$5,$6,$7,$8)",[id,owner,['row-2','row-3'],courses,results,validation,shortlist,{frozen:'approved'}]);
  await pg.exec(`set role authenticated;set "request.jwt.claim.sub"='${owner}'`);
  const resume=(input=courses,strategy='api3')=>pg.query('select naver_capture_resume($1,$2,$3,$4) id',[id,'001',input,strategy]);
  await assert.rejects(()=>resume([{...courses[0],stops:['X','C','A','C']},courses[1]]),/변경/);
  await assert.rejects(()=>resume(courses,'full'),/변경/);
  assert.equal((await resume()).rows[0].id,id);
  const resumed=(await pg.query('select * from naver_browser_jobs where id=$1',[id])).rows[0];
  assert.equal(resumed.status,'queued');assert.equal(resumed.cursor,0);assert.deepEqual(resumed.addresses,['row-3']);assert.deepEqual(resumed.results,results);assert.deepEqual(resumed.candidate_plans,{frozen:'approved'});assert.equal(resumed.validation_job_id,validation);assert.equal(resumed.shortlist_job_id,shortlist);
  await Promise.all([resume(),resume()]);assert.deepEqual((await pg.query('select * from naver_browser_jobs where id=$1',[id])).rows[0],resumed,'Repeated resume does not reset or duplicate active work');
  await pg.exec(`set "request.jwt.claim.sub"='${other}'`);await assert.rejects(()=>resume(),/본인/);assert.equal((await pg.query('select * from naver_browser_jobs')).rows.length,0);
  await pg.exec('reset role');assert.equal((await pg.query('select count(*)::int n from naver_browser_jobs')).rows[0].n,1);
  assert.equal((await pg.query("select has_function_privilege('anon','naver_capture_resume(uuid,text,jsonb,text)','EXECUTE') allowed")).rows[0].allowed,false);
  await pg.query("update naver_browser_jobs set status='completed' where id=$1",[id]);
  const captureSql=await readFile(new URL('../repo-root/sql/naver-course-captures.sql',import.meta.url),'utf8');
  await pg.exec(captureSql.slice(0,captureSql.indexOf('insert into storage.buckets')));
  await pg.exec(await readFile(new URL('../repo-root/sql/naver-address-validation.sql',import.meta.url),'utf8'));
  await pg.exec('create table naver_api_jobs(id uuid primary key,owner_id uuid,center_code text,status text,state jsonb)');
  await pg.exec(await readFile(new URL('../repo-root/sql/naver-capture-shortlist.sql',import.meta.url),'utf8'));
  const actualCourses=[{id:'row-2',sourceRow:2,name:'가상1호차1회',rotation:1,garage:'G',center:'C',groupName:'가상1호차',stops:['G','C','A','C']},{id:'row-3',sourceRow:3,name:'가상1호차2회',rotation:2,garage:'G',center:'C',groupName:'가상1호차',stops:['C','B','D','G']}];
  const points=Object.fromEntries(['G','C','A','B','D'].map((name,i)=>[name,{id:name,coordinates:[127+i/100,37]}]));
  const {createShortlistPlan,rankShortlist}=await import('../scripts/lib/naver-candidate-shortlist.mjs');
  const planSet=(time,settings)=>Object.fromEntries(actualCourses.map(c=>{const p=createShortlistPlan(c,points,settings),rows=p.edges.filter(e=>!e.zeroCost).map(e=>({key:e.key,distanceMeters:100,option:'traoptimal',measuredAt:time}));return[c.id,rankShortlist(p,rows,{now:time})];}));
  const oldPlans=planSet(new Date(Date.now()-60000).toISOString()),newPlans=planSet(new Date().toISOString());
  const checkedResults=Object.fromEntries(Object.keys(points).map(query=>[query,{query,status:'valid',point:{}}]));
  await pg.query("insert into naver_browser_jobs(id,owner_id,center_code,origin,addresses,status,kind,courses,results) values($1,$2,'001','synthetic', '[]','completed','validation',$3,$4)",[validation,owner,actualCourses,checkedResults]);
  const stateFor=plans=>({kind:'capture-shortlist',validationJob:validation,courses:actualCourses,shortlists:plans});
  await pg.query("insert into naver_api_jobs values($1,$2,'001','completed',$3)",[shortlist,owner,stateFor(oldPlans)]);
  await pg.exec(`set role authenticated;set "request.jwt.claim.sub"='${owner}'`);
  const enqueue=api=>pg.query('select naver_capture_shortlist_enqueue($1,$2,$3,$4) id',['001',actualCourses,validation,api]);
  const oldCapture=(await enqueue(shortlist)).rows[0].id;
  await pg.exec('reset role');
  await pg.query("update naver_browser_jobs set status='attention',results=$2 where id=$1",[oldCapture,{'row-2':{imagePath:'preserved-approved.png',optimization:{policy:'naver-api-top3-web-meters-v1',complete:true}}}]);
  const refreshedApi='66666666-6666-4666-8666-666666666666';
  await pg.query("insert into naver_api_jobs values($1,$2,'001','completed',$3)",[refreshedApi,owner,stateFor(newPlans)]);
  await pg.exec(`set role authenticated;set "request.jwt.claim.sub"='${owner}'`);
  const continued=(await enqueue(refreshedApi)).rows[0].id;
  const newJob=(await pg.query('select * from naver_browser_jobs where id=$1',[continued])).rows[0];
  assert.equal(newJob.results['row-2'].imagePath,'preserved-approved.png','refreshing approval timestamps alone preserves the unchanged completed rotation');
  assert.deepEqual(newJob.addresses,['row-3']);assert.deepEqual(newJob.candidate_plans['row-2'],newPlans['row-2']);
  await pg.exec('reset role');
  const changedApi='77777777-7777-4777-8777-777777777777';
  await pg.query("insert into naver_api_jobs values($1,$2,'001','completed',$3)",[changedApi,owner,stateFor(planSet(new Date().toISOString(),{cartype:2}))]);
  await pg.exec(`set role authenticated;set "request.jwt.claim.sub"='${owner}'`);
  const changed=(await enqueue(changedApi)).rows[0].id;
  assert.equal((await pg.query('select results from naver_browser_jobs where id=$1',[changed])).rows[0].results['row-2']?.imagePath,undefined,'changed vehicle conditions never reuse the old image');
  await pg.exec('reset role');
  console.log('PASS isolated frozen capture resume: unchanged checkpoint/images/approval references, only unfinished independent rotation, repeat/cross-owner/input/mode fences');
 }finally{await pg.close();}
}else console.log('SKIP isolated resume SQL: PGLITE_MODULE not configured');
