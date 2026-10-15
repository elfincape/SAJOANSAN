import {chromium} from 'playwright';
import {browserDistance} from './lib/naver-map-browser.mjs';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({locale:'ko-KR',viewport:{width:1280,height:1000}});
 let result;
 try{result=await browserDistance(page,'경기도 평택시 산단로 263','경기도 오산시 성호대로 141',{diagnostic:true});}
 catch(e){console.log('Public-address probe suggestions: '+JSON.stringify(await page.locator('[id^="instant-search-item"]').allTextContents()));console.log('Public probe input state: '+JSON.stringify(await page.getByRole('combobox').evaluateAll(es=>es.map(e=>e.value))));throw e;}
 if(result.routeLabel!=='거리우선'||!(result.distanceKm>0))throw Error('Naver distance-priority verification failed');
 console.log('Server browser read genuine Naver distance-priority card: '+JSON.stringify(result));
}finally{await browser.close();}
