import {chromium} from 'playwright';
import {browserDistance} from './lib/naver-map-browser.mjs';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({locale:'ko-KR',viewport:{width:1280,height:1000}});
 const result=await browserDistance(page,'경기도 평택시 산단로 263','경기도 오산시 성호대로 141',{diagnostic:true});
 if(result.routeLabel!=='거리우선'||!(result.distanceKm>0))throw Error('Naver distance-priority verification failed');
 console.log('Server browser read genuine Naver distance-priority card: '+JSON.stringify(result));
}finally{await browser.close();}
