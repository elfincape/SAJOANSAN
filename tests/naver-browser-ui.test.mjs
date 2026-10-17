import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
import * as base from '../repo-root/js/destination-distance-model.js';import * as db from '../repo-root/js/destination-distance-db.js';import * as jobs from '../repo-root/js/naver-browser-model.js';import {permissionAllowed} from '../repo-root/js/portal-permissions.js';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom'),XLSX=require('xlsx'),ExcelJS=require('exceljs');
const dom=new JSDOM(fs.readFileSync(new URL('../repo-root/admin/naver-shortest-distance.html',import.meta.url),'utf8'),{url:'https://sajoansan.vercel.app/admin/naver-shortest-distance.html?center=ansan'}),document=dom.window.document;
const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['착지','주소'],['A','주소A'],['B','주소B']]),'주소');const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});Object.defineProperty(document.getElementById('file'),'files',{value:[{name:'test.xlsx',size:bytes.length,arrayBuffer:async()=>bytes}]});
let submitted,jobStatus='completed',blob;class TestURL extends URL{static createObjectURL(b){blob=b;return 'blob:test';}static revokeObjectURL(){}}dom.window.HTMLAnchorElement.prototype.click=function(){};
const client={rpc:async(name,args)=>{assert.equal(name,'naver_browser_enqueue');submitted=args;return {data:'test-job'};},from:table=>{assert.equal(table,'naver_browser_jobs');const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:{id:'test-job',center_code:'001',origin:'경기도 안산시 단원구 성곡로 125',addresses:['주소A','주소B']}}),single:async()=>({data:{id:'test-job',status:jobStatus,addresses:submitted?.p_addresses??['주소A','주소B'],results:{'주소A':{distanceKm:15,distanceText:'15km',routeLabel:'거리우선',method:'naver-map-display',region:'수원시',regionKey:'경기|수원',measuredAt:'2026-10-15T00:00:00Z'},'주소B':{issue:'거리우선 결과 없음'}}}})};return q;}};
const context={...base,...db,...jobs,watchBrowserJob:async(client,id,onUpdate)=>{for(const status of ['running','queued','attention']){onUpdate({status,results:{'주소A':{distanceKm:15,distanceText:'15km',routeLabel:'거리우선',method:'naver-map-display',region:'수원시',regionKey:'경기|수원'}}});assert.equal(document.querySelectorAll('#results .longest').length,0,'No maximum highlight until the entire job is completed');}return jobs.watchBrowserJob(client,id,onUpdate);},permissionAllowed,menuPermissions:async()=>({access:{delivery_points:{read_centers:['001','002']}}}),requireRole:async()=>({id:'browser-user'}),supabase:client,document,location:dom.window.location,Option:dom.window.Option,URL:TestURL,Blob,localStorage:dom.window.localStorage,XLSX,ExcelJS,setTimeout:()=>0,fetch:()=>{throw Error('Public API fallback is forbidden');}};context.globalThis=context;
const code=fs.readFileSync(new URL('../repo-root/js/naver-browser-ui.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');await vm.runInNewContext(code,context);
await document.getElementById('file').onchange();document.getElementById('address-column').value='1';document.getElementById('name-column').value='0';document.getElementById('start-row').value='2';await document.getElementById('calculate').onclick();
assert.equal(submitted.p_center,'001');assert.deepEqual(Array.from(submitted.p_addresses),['주소A','주소B']);assert.equal(document.querySelectorAll('#results tbody tr').length,2);assert(document.getElementById('results').textContent.includes('15km'));assert(document.getElementById('count').textContent.includes('1확인 필요'));
assert.equal(document.querySelectorAll('#results .longest').length,1,'Highlight maximum once completed');
await document.getElementById('download').onclick();const exported=new ExcelJS.Workbook();await exported.xlsx.load(await blob.arrayBuffer());assert.equal(exported.getWorksheet(2).getCell('B2').value,'네이버 지도 거리우선 표시값');assert.equal(exported.getWorksheet(1).getCell('L2').value,'15km');assert.equal(exported.getWorksheet(1).getCell('E3').value,null);
const saved=dom.window.localStorage.getItem('sajo.naver-browser.browser-user.job');assert(saved.includes('test-job'));await vm.runInNewContext(code,{...context,globalThis:context});assert(document.getElementById('source-label').textContent.includes('최근 서버 작업'));
console.log('Browser-only job submit, saved work reconnect, exact Naver display evidence, missing result blanks and styled workbook passed');

dom.window.localStorage.removeItem('sajo.naver-browser.browser-user.job');await document.getElementById('restore-job').onclick();assert.equal(document.getElementById('origin').value,'경기도 안산시 단원구 성곡로 125');assert(document.getElementById('results').textContent.includes('15km'));assert.equal(document.querySelectorAll('#results tbody tr').length,2);console.log('Recent owned server job restores results without browser-local history');

assert.equal(document.getElementById('relations-panel'),null,'Web distance-priority page must not contain the API collector');
const dispatchHtml=fs.readFileSync(new URL('../repo-root/admin/pyeongtaek-dispatch.html',import.meta.url),'utf8');
const dispatchDocument=new JSDOM(dispatchHtml).window.document;
assert(dispatchDocument.getElementById('relations-panel'),'API collector belongs to provisional dispatch');
assert.equal(dispatchDocument.getElementById('relation-budget').value,'25000');
assert.equal(dispatchDocument.getElementById('relation-db-single').open,false);
assert.equal(dispatchDocument.getElementById('relation-settings').open,false);
assert.equal(dispatchDocument.getElementById('relation-limit').max,'50');
const relationCode=fs.readFileSync(new URL('../repo-root/js/naver-relations-ui.js',import.meta.url),'utf8');
assert(relationCode.includes('naver-relations'));assert(!relationCode.includes('SERVICE_ROLE'));
assert(relationCode.includes('naver_api_cancel'));assert(relationCode.includes('measuredAt'));
console.log('Integrated route collection controls, safe pilot default, stop/resume and dated estimates passed');

const relationDom=new JSDOM(dispatchHtml,{url:'http://127.0.0.1:8772/admin/pyeongtaek-dispatch.html?center=pyeongtaek&view=roads'}),relationDocument=relationDom.window.document;
let relationRequests=[],bulkBatches=0,resumableJobs=[],resumeExisting=false;
const relationResult={id:'test-route-job',updatedAt:'2026-10-17T00:00:00Z',status:'completed',stops:2,sourceRows:3,geoDone:3,geoTotal:3,candidates:4,completed:4,cached:1,failed:0,deferred:0,directionsAttempts:3,directionsBudget:60,geocodingAttempts:3,geocodingBudget:2000,lastResults:[{from:'주소 A',to:'주소 B',reason:'nearby',distanceMeters:1234,durationSeconds:123,measuredAt:'2026-10-17T00:00:00Z',cached:true}]};
const relationClient={functions:{invoke:async(name,{body})=>{
 assert.equal(name,'naver-relations');assert.equal(body.center,'002');relationRequests.push(body);
 if(resumeExisting&&body.action==='status')return {data:{...relationResult,status:'attention'}};
 if(resumeExisting&&body.action==='resume')return {data:{...relationResult,status:'queued'}};
 if(body.action==='batch'&&bulkBatches>0){bulkBatches--;return {data:{...relationResult,status:bulkBatches?'queued':'completed'}};}
 return {data:body.action==='preview'?{stops:body.directionsBudget===25000?500:2,sourceRows:3,invalidRows:0,estimatedCandidates:4,directionsBudget:body.directionsBudget}:body.action==='create'?{...relationResult,status:'queued'}:relationResult};
}},from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:resumableJobs})};return q;},rpc:async(name)=>{assert.equal(name,'naver_api_cancel');return {data:null};}};
const destinationRecords=[{id:'dp-a',code:'P001',name:'알파',address:'주소 A',center_code:'002',dispatch_profile:{otd:'09:00 이전',mode:'unmanned'}},{id:'dp-b',code:'P002',name:'베타',address:'주소 B',center_code:'002'},{id:'dp-empty',code:'NOADDR',name:'주소 없음',address:'',center_code:'002'},{id:'dp-other',code:'OTHER',name:'타센터',address:'주소 A',center_code:'001'}];
const relationContext={getDestinations:()=>destinationRecords,requireRole:async()=>({id:'test-user'}),supabase:relationClient,menuPermissions:async()=>({access:{delivery_points:{edit_centers:['002']}}}),permissionAllowed,excelAddresses:base.excelAddresses,XLSX,ExcelJS,document:relationDocument,location:relationDom.window.location,URL,Blob,setTimeout:fn=>{fn();return 0;},addEventListener:()=>{}};relationContext.globalThis=relationContext;
await vm.runInNewContext(relationCode.replace(/^import .*;\r?\n/gm,'').replace('export function createRelationsUI','function createRelationsUI')+'\ncreateRelationsUI({actor:{id:"test-user"},getDestinations,permissions:{access:{delivery_points:{edit_centers:["002"]}}}});',relationContext);
assert.equal(relationDocument.getElementById('relations-panel').hidden,false);
assert.equal(relationDocument.getElementById('relation-destination').options.length,3,'Only Pyeongtaek destinations');
const search=relationDocument.getElementById('relation-destination-search');
for(const [query,id] of [['p001','dp-a'],['베타','dp-b'],['주소 A','dp-a']]){search.value=query;search.oninput();assert.equal(relationDocument.getElementById('relation-destination').value,id);}
assert(relationDocument.getElementById('relation-destination-info').textContent.includes('09:00 이전'));
assert.equal(relationRequests.length,0,'Opening collector must not start provider requests');
await relationDocument.getElementById('relation-center-pair').onclick();
let selectedPair=relationRequests.findLast(r=>r.action==='create'&&r.kind==='single');assert.equal(selectedPair.origin,'경기도 평택시 산단로 263');assert.equal(selectedPair.rows[0].address,'주소 A');
const beforeSelection=relationRequests.length;
await relationDocument.getElementById('relation-select-from').onclick();search.value='P002';search.oninput();await relationDocument.getElementById('relation-select-to').onclick();
assert.equal(relationRequests.length,beforeSelection,'Selecting DB records must not call Naver');
await relationDocument.getElementById('relation-pair').onclick();selectedPair=relationRequests.findLast(r=>r.action==='create'&&r.kind==='single');assert.equal(selectedPair.origin,'주소 A');assert.equal(selectedPair.rows[0].address,'주소 B');
search.value='NOADDR';search.oninput();assert.equal(relationDocument.getElementById('relation-center-pair').disabled,true);const beforeNoAddress=relationRequests.length;await relationDocument.getElementById('relation-center-pair').onclick();assert.equal(relationRequests.length,beforeNoAddress);
search.value='not-found';search.oninput();assert.equal(relationDocument.getElementById('relation-destination').options.length,0);assert.equal(relationDocument.getElementById('relation-select-to').disabled,true);
search.value='';search.oninput();
console.log('DB code/name/address lookup, center route, destination pair, zero-call selection and missing-address guards passed');
await relationDocument.getElementById('relation-preview').onclick();assert.equal(relationDocument.getElementById('relation-start').disabled,false);
await relationDocument.getElementById('relation-start').onclick();assert.equal(relationDocument.querySelectorAll('#relation-results tr').length,1);
assert(relationDocument.getElementById('relation-results').textContent.includes('오래된 추정'));
assert(relationDocument.getElementById('relation-count').textContent.includes('캐시 1'));
assert.equal(relationDocument.getElementById('relation-stop').hidden,true);
const dispatchWb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(dispatchWb,XLSX.utils.aoa_to_sheet([['코스','고객사','착지','주소','물량','OTD'],['평택97','한성','A','주소 A',20.9333,'03:00'],['평택97','오양','B','주소 A',10,'04:00']]),'Sheet1');const dispatchBytes=XLSX.write(dispatchWb,{type:'buffer',bookType:'xlsx'});
Object.defineProperty(relationDocument.getElementById('relation-files'),'files',{value:[{name:'dispatch.xlsx',size:dispatchBytes.length,arrayBuffer:async()=>dispatchBytes}],configurable:true});
await relationDocument.getElementById('relation-files').onchange();const uploaded=relationRequests.at(-1).rows;
assert.equal(uploaded.length,2);assert.equal(uploaded[0].quantity,20.9333);assert.equal(uploaded[0].customer,'한성');assert.equal(uploaded[0].originalCourse,'평택97');assert.equal(uploaded[1].otd,'04:00');assert.equal(uploaded[0].sourceSheet,'Sheet1');
const beforeBulk=relationRequests.length;bulkBatches=3;await relationDocument.getElementById('relation-bulk').onclick();
const bulkRequests=relationRequests.slice(beforeBulk),bulkCreate=bulkRequests.find(r=>r.action==='create');
assert(!Object.hasOwn(bulkCreate,'rows'),'Bulk source must be the complete server DB, never the selected record or uploaded file');
assert.equal(bulkCreate.directionsBudget,25000);assert.equal(bulkCreate.limit,49,'500 center legs plus 49 candidates per stop fit within 25,000');
assert.equal(bulkRequests.filter(r=>r.action==='batch').length,3,'One click automatically continues multiple batches');
assert.equal(relationDocument.getElementById('relation-source-label').textContent,'평택 납품정보 DB 전체');
console.log('One-click whole-DB collection ignores manual selections/files, reserves center budget and runs all batches automatically');
resumableJobs=[{id:relationResult.id,status:'attention',directions_attempts:728,state:{origin:'경기도 평택시 산단로 263',groups:[{sources:[{source:'delivery_points'}]}]}}];resumeExisting=true;
const beforeResume=relationRequests.length;await relationDocument.getElementById('relation-bulk').onclick();const resumedRequests=relationRequests.slice(beforeResume);
assert.equal(resumedRequests.filter(r=>r.action==='create').length,0,'A stopped DB collection must not be recreated');
assert(resumedRequests.some(r=>r.action==='resume'&&r.jobId===relationResult.id));assert(resumedRequests.some(r=>r.action==='batch'));
resumableJobs=[];resumeExisting=false;
Object.assign(relationResult,{failed:1,routeIssues:[{from:'주소 A',to:'주소 B',error:'도로 지점이 같습니다. (네이버 코드 1)'}]});
await relationDocument.getElementById('relation-start').onclick();assert(relationDocument.getElementById('relation-issue-list').textContent.includes('네이버 코드 1'));assert(relationDocument.getElementById('relation-status').textContent.includes('확인 필요 구간'));
Object.assign(relationResult,{failed:0,routeIssues:[]});
console.log('Stopped whole-DB jobs resume without resetting cached progress; route-specific issues remain visible');
console.log('Collector UI modes, no automatic live call, preview/create/batch, stale estimate display and customer/volume/course/OTD file preservation passed');
Object.assign(relationResult,{error:'요청 한도 도달',deferred:100,directionsBudget:25000,origin:'저장된 센터 주소',limit:25});
await relationDocument.getElementById('relation-start').onclick();
assert(relationDocument.getElementById('relation-status').textContent.includes('조회 한도 도달'));
assert.equal(relationDocument.getElementById('relation-origin').value,'저장된 센터 주소');assert.equal(relationDocument.getElementById('relation-limit').value,'25');assert.equal(relationDocument.getElementById('relation-budget').value,'25000');
await relationDocument.getElementById('relation-resume').onclick();assert.equal(relationRequests.at(-1).directionsBudget,25000);assert.equal(relationRequests.at(-1).expectedUpdatedAt,relationResult.updatedAt);
Object.assign(relationResult,{error:'',deferred:0,directionsBudget:60,origin:'경기도 평택시 산단로 263',limit:50});
console.log('Error-bearing job summaries stay visible and restored origin/limit/budget survive resume passed');
relationDocument.getElementById('relation-pair-from').value='주소 A';relationDocument.getElementById('relation-pair-to').value='주소 A';const beforePair=relationRequests.length;
await relationDocument.getElementById('relation-pair').onclick();assert.equal(relationRequests.length,beforePair);assert(relationDocument.getElementById('relation-pair-status').textContent.includes('0분'));
relationDocument.getElementById('relation-pair-to').value='주소 B';await relationDocument.getElementById('relation-pair').onclick();
const pairRequest=relationRequests.findLast(r=>r.action==='create'&&r.kind==='single');assert.equal(pairRequest.origin,'주소 A');assert.equal(pairRequest.rows.length,1);assert.equal(pairRequest.rows[0].address,'주소 B');assert.equal(pairRequest.directionsBudget,3);
assert(relationDocument.getElementById('relation-pair-status').textContent.includes('1.23km'));
console.log('Missing directed-pair collection preserves main job and identical addresses make zero requests passed');

if(process.env.ROUTE_SOURCE_FILES){
 const paths=JSON.parse(process.env.ROUTE_SOURCE_FILES),files=paths.map(path=>{const bytes=fs.readFileSync(path);return {name:path.split(/[\\/]/).at(-1),size:bytes.length,arrayBuffer:async()=>bytes};});
 Object.defineProperty(relationDocument.getElementById('relation-files'),'files',{value:files,configurable:true});
 await relationDocument.getElementById('relation-files').onchange();
 const input=relationRequests.at(-1).rows;assert(input?.length>0);assert(input.every(r=>r.source&&r.sourceSheet&&r.sourceRow));
 assert.equal(new Set(input.map(r=>r.source)).size,files.length);
 console.log(`Actual source workbook import passed: ${files.length} files, ${input.length} address rows; no real external API call`);
}

if(process.env.ROUTE_UI_BROWSER==='1'){
 const {chromium}=await import('playwright'),browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_CHANNEL?{channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL}:{})});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/js/auth.js*',route=>route.fulfill({contentType:'application/javascript',body:"export const requireAuth=async()=>({id:'test',role:'admin',active:true,username:'테스트'});export const requireRole=requireAuth;export const getCurrentProfile=requireAuth;export const signOut=async()=>{};"}));
  await page.route('**/js/supabase.js*',route=>route.fulfill({contentType:'application/javascript',body:`const access={charter:{read_centers:['002'],edit_centers:['002']},delivery_points:{read_centers:['001','002'],edit_centers:['002']}};export const supabase={rpc:async(name)=>({data:name==='operations_resource_allowed'?true:{access}}),from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[]})};return q;},functions:{invoke:async(name,{body})=>({data:body.action==='preview'?{stops:500,sourceRows:750,invalidRows:0,estimatedCandidates:25500,directionsBudget:body.directionsBudget}:${JSON.stringify(relationResult)}})}};`}));
  await page.route('**/@vite/client',route=>route.fulfill({contentType:'application/javascript',body:''}));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx@*/**',route=>route.fulfill({contentType:'application/javascript',body:'window.XLSX={};'}));
  for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
   await page.setViewportSize(viewport);await page.goto((process.env.ROUTE_UI_BASE_URL||'http://127.0.0.1:8772')+'/admin/pyeongtaek-dispatch.html?center=pyeongtaek&view=roads');
   await page.locator('#relations-panel').waitFor({state:'visible'});await page.locator('#relation-bulk').click();
   await page.locator('#relation-status').filter({hasText:'수집 완료'}).waitFor();
   const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,heading:document.querySelector('#relations-panel h4').getBoundingClientRect().toJSON()}));
   assert(bounds.scroll<=bounds.width+1,`${name} page overflow: ${JSON.stringify(bounds)}`);
   assert(bounds.heading.width>0);await page.screenshot({path:`C:/Users/USER/Documents/New project/ui-references/workspace-artifacts/route-relations-${name}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log('Playwright desktop/mobile collector screenshots, shared shell, interaction and zero page overflow passed');
 }finally{await browser.close();}
}
