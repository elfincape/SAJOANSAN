import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {excelAddresses,longestRows,distanceWorkbook,DEFAULTS,resultValues} from '../repo-root/js/destination-distance-model.js';
import {destinationRegion,calculateNaverRoute} from '../supabase/functions/naver-distance/provider.js';
const require=createRequire(import.meta.url),XLSX=require('xlsx'),ExcelJS=require('exceljs');
const sheet=XLSX.utils.aoa_to_sheet([['다른 제목','주소'],['A','경기도 수원시 주소'],['B','서울특별시 강남구 주소'],['C','#N/A'],['D',null]]);
const parsed=excelAddresses(sheet,XLSX,{addressColumn:1,nameColumn:0,startRow:1});assert.equal(parsed.length,3);assert.equal(parsed[2].address,'');assert(parsed[2].issue);assert.equal(parsed[0].sourceRow,2);
const merged=XLSX.utils.aoa_to_sheet([['A','주소A'],['B'],['C','주소C']]);merged['!merges']=[{s:{r:0,c:1},e:{r:1,c:1}}];assert.equal(excelAddresses(merged,XLSX,{addressColumn:1})[1].address,'주소A');
assert.equal(destinationRegion({roadAddress:'서울특별시 강남구 테헤란로 1'}).region,'서울 강남구');assert.equal(destinationRegion({roadAddress:'경기도 수원시 영통구 광교로 1'}).region,'수원시');assert.notEqual(destinationRegion({roadAddress:'경기도 광주시 중앙로 1'}).regionKey,destinationRegion({roadAddress:'광주광역시 북구 중앙로 1'}).regionKey);
const rows=[{sourceRow:2,name:'A',address:'주소A',region:'수원시',regionKey:'경기|수원',distanceKm:10},{sourceRow:3,name:'B',address:'주소B',region:'수원시',regionKey:'경기|수원',distanceKm:20},{sourceRow:4,name:'C',address:'주소C',region:'서울 강남구',regionKey:'서울|강남',distanceKm:3}];assert.deepEqual(longestRows(rows).map(r=>r.longest),[false,true,true]);assert.equal(resultValues(rows[0],DEFAULTS)[5],10/8.3);
const buf=await distanceWorkbook(ExcelJS,rows,DEFAULTS,'기준주소'),wb=new ExcelJS.Workbook();await wb.xlsx.load(buf);const ws=wb.getWorksheet(1);assert.equal(ws.getCell('E3').fill.fgColor.argb,'FFFFEB3B');assert.equal(ws.getCell('E2').fill?.fgColor,undefined);assert.equal(ws.getCell('F2').value,10/8.3);assert.equal(ws.getCell('J2').value,2.5);assert(ws.autoFilter);assert.equal(ws.views[0].ySplit,1);
let directions=0;const result=await calculateNaverRoute({origin:'출발',priority:'MIN_DISTANCE',stops:[{address:'주소'}]},{NAVER_MAPS_CLIENT_ID:'id',NAVER_MAPS_CLIENT_SECRET:'secret'},async url=>{
 const u=new URL(url);if(u.pathname.includes('geocode'))return new Response(JSON.stringify({status:'OK',meta:{totalCount:1},addresses:[{x:u.searchParams.get('query')==='출발'?127:128,y:37,roadAddress:'경기도 수원시 주소'}]}));
 directions++;assert.equal(u.searchParams.get('option'),'traoptimal:trafast:tracomfort');return new Response(JSON.stringify({code:0,route:{traoptimal:[{summary:{distance:3000,duration:1000}}],trafast:[{summary:{distance:2500,duration:900}}],tracomfort:[{summary:{distance:2000,duration:1200}}]}}));
});assert.equal(result.sections[0].distanceMeters,2000);assert.equal(directions,1);assert.equal(result.regions[0].region,'수원시');
console.log('Arbitrary columns, merged addresses, formula errors, city/Seoul-district regions, regional maxima, all-ton liters, styled XLSX and single-request minimum candidate passed');
