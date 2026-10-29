import {chromium} from 'playwright';
import {browserDistance,selectAddress,searchResponseEvidence} from './lib/naver-map-browser.mjs';
async function firstSearchProbe(page,browser){
 const address='경기도 오산시 경기대로 78-7',started=Date.now(),events=[],pending=[];let phase='opening',failure;
 const state=()=>page.evaluate(()=>({readyState:document.readyState,carSelected:[...document.querySelectorAll('[role="tab"]')].some(e=>e.textContent.trim()==='자동차'&&e.getAttribute('aria-selected')==='true'),inputs:document.querySelectorAll('[role="combobox"]').length,canvases:[...document.querySelectorAll('canvas')].slice(0,3).map(e=>({width:e.width,height:e.height,visible:!!e.getBoundingClientRect().width})),accessRestricted:/access\s+denied|captcha|접근.{0,12}제한|자동\s*입력\s*방지/i.test(document.body.innerText)}));
 const inspect=response=>{try{const u=new URL(response.url());if(!['/p/api/search/instant-search','/p/api/search/bubble-keyword-list'].includes(u.pathname)||events.length+pending.length>=8)return;if(u.pathname.endsWith('instant-search')&&u.searchParams.get('query')!==address)return;const observedPhase=phase,atMs=Date.now()-started;pending.push((async()=>events.push({phase:observedPhase,atMs,evidence:await searchResponseEvidence(response)}))());}catch{}};
 page.on('response',inspect);const report={event:'naver_first_search_probe',address,browserVersion:browser.version(),events};
 try{
  await page.goto('https://map.naver.com/p/directions/-/-/-/car',{waitUntil:'domcontentloaded',timeout:45000});await page.getByRole('tab',{name:'자동차',exact:true}).click();
  report.runtime=await page.evaluate(()=>({userAgent:navigator.userAgent,language:navigator.language,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}));report.before=await state();phase='cold-search';
  await selectAddress(page,page.getByRole('combobox').first(),address);report.firstSelected=true;report.afterFirst=await state();
  await page.waitForFunction(()=>{const p=location.pathname.split('/');return p[3]&&p[3]!=='-';});
  phase='prepared-search';await selectAddress(page,page.getByRole('combobox').first(),address);report.preparedSelected=true;report.afterPrepared=await state();
 }catch(error){failure=error;report.failure={code:error.code??error.name,reason:error.reason,diagnostics:error.searchDiagnostics};report.afterFailure=await state().catch(()=>null);phase='passive-after-failure';await page.waitForTimeout(2000);report.afterPassiveWait=await state().catch(()=>null);}
 finally{page.off('response',inspect);await Promise.allSettled(pending);report.elapsedMs=Date.now()-started;console.log(JSON.stringify(report));}
 if(failure)throw failure;
}
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({locale:'ko-KR',viewport:{width:1280,height:1000}});
 if(process.argv.includes('--first-search')){await firstSearchProbe(page,browser);}else{
 let result;
 try{result=await browserDistance(page,'경기도 평택시 산단로 263','경기도 오산시 성호대로 141',{diagnostic:true});}
 catch(e){console.log('Public-address probe suggestions: '+JSON.stringify(await page.locator('[id^="instant-search-item"]').allTextContents()));console.log('Public probe input state: '+JSON.stringify(await page.getByRole('combobox').evaluateAll(es=>es.map(e=>e.value))));throw e;}
 if(result.routeLabel!=='거리우선'||!(result.distanceKm>0))throw Error('Naver distance-priority verification failed');
 console.log('Server browser read genuine Naver distance-priority card: '+JSON.stringify(result));
 }
}finally{await browser.close();}
