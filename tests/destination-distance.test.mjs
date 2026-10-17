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

const relations=await import('../supabase/functions/naver-relations/model.js').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return null;
 throw error;
});
assert.ok(relations,'Route relation helpers must exist');
const {normalizeAddress,groupAddresses,buildCandidates}=relations;
assert.equal(normalizeAddress('  Road\t\uff11\uff12  Building A\n Unit 201  '),'Road 12 Building A Unit 201');
assert.equal(normalizeAddress(null),'');
const sources=[
 {sourceRow:2,name:'First customer',address:' Road 12\tUnit 201 ',customer:'A',quantity:1.5,sourceName:'input.xlsx',sheetName:'Orders',deliveryPointId:'dp-a'},
 {sourceRow:3,name:'Second customer',address:'Road 12  Unit 201',customer:'B',quantity:2.25},
 {sourceRow:4,name:'First customer',address:'Road 12 Unit 202',customer:'A'},
 {sourceRow:5,name:'First customer',address:'Road12 Unit 201',customer:'A'},
 {sourceRow:6,name:'Blank',address:' \t '}
];
const sourceSnapshot=structuredClone(sources),grouped=groupAddresses(sources);
assert.equal(grouped.length,3,'Only exact normalized addresses merge; unit and internal spacing differences survive');
assert.equal(grouped[0].key,'Road 12 Unit 201');
assert.equal(grouped[0].address,'Road 12 Unit 201');
assert.equal(grouped[0].name,'First customer');
assert.deepEqual(grouped[0].sources,sources.slice(0,2),'All original customer and provenance fields survive grouping');
assert.notEqual(grouped[0].sources[0],sources[0]);
assert.deepEqual(sources,sourceSnapshot,'Grouping does not change input rows');

const points=[
 {id:'center',x:127,y:37},
 {id:'a',x:127.01,y:37,regionKey:'local',otd:540},
 {id:'b',x:127.02,y:37,regionKey:'local',otd:600},
 {id:'c',x:127.03,y:37,regionKey:'other'},
 {id:'d',x:129,y:37,regionKey:'local',otd:480}
];
const pointSnapshot=structuredClone(points),edges=buildCandidates(points,{limit:2,originId:'center',preferred:[{from:'a',to:'c'},{from:'a',to:'c'},{from:'a',to:'a'},{from:'missing',to:'a'}]});
assert.deepEqual(edges.slice(0,4).map(e=>[e.from,e.to,e.reason]),[['center','a','center'],['center','b','center'],['center','c','center'],['center','d','center']]);
assert.deepEqual(edges.slice(4,8).map(e=>e.from),['a','b','c','d'],'A truncated budget visits every origin before its second candidate');
assert.deepEqual(edges.slice(8).map(e=>e.from),['a','b','c','d']);
assert.deepEqual(edges.filter(e=>e.from==='a').map(e=>[e.to,e.reason,e.rank]),[['c','historical',1],['b','region',2]]);
assert.equal(edges.length,12);
assert.equal(new Set(edges.map(e=>JSON.stringify([e.from,e.to]))).size,12);
assert(edges.every(e=>e.from!==e.to&&e.to!=='center'&&Number.isFinite(e.distanceMeters)&&e.distanceMeters>=0));
assert(edges.some(e=>e.from==='a'&&e.to==='b')&&edges.some(e=>e.from==='b'&&e.to==='a'),'Opposite directions remain independent');
assert.deepEqual(points,pointSnapshot);
assert.deepEqual(buildCandidates([...points].reverse(),{limit:2,originId:'center',preferred:[{from:'a',to:'c'}]}),edges,'Input order does not change deterministic candidate ordering');
assert.equal(buildCandidates(points,{limit:0,originId:'center'}).length,4,'Center edges do not consume the per-stop limit');
assert.equal(buildCandidates(points,{limit:1}).find(e=>e.from==='a').to,'b','A very distant same-region point cannot displace a nearby candidate');
assert.equal(buildCandidates([{id:'a',x:127,y:37,regionKey:'r'},{id:'near',x:127.01,y:37},{id:'far',x:129,y:37,regionKey:'r'}],{limit:1})[0].to,'near');

const ties=[{id:'origin',x:127,y:37,otd:540},{id:'a-earlier',x:127.01,y:37,otd:480},{id:'z-later',x:127.01,y:37,otd:600},{id:'m-unknown',x:127.01,y:37}];
assert.deepEqual(buildCandidates(ties,{limit:3}).filter(e=>e.from==='origin').map(e=>e.to),['z-later','m-unknown','a-earlier'],'OTD only breaks distance ties and never prunes earlier or unknown windows');
assert.equal(buildCandidates([{id:'b',x:127,y:37},{id:'a',x:127,y:37},{id:'c',x:127,y:37}],{limit:1})[0].to,'b','Coordinate equality does not merge distinct points and IDs break ties');
assert.throws(()=>buildCandidates([{id:'bad',x:NaN,y:37}]),/coordinate/i);
assert.throws(()=>buildCandidates([{id:'bad',x:127,y:Infinity}]),/coordinate/i);
assert.throws(()=>buildCandidates([{id:'bad',x:181,y:37}]),/coordinate/i);
assert.throws(()=>buildCandidates([{id:'same',x:127,y:37},{id:'same',x:128,y:37}]),/id/i);
assert.throws(()=>buildCandidates(points,{limit:-1}),/limit/i);
assert.deepEqual(buildCandidates([]),[]);
assert.deepEqual(buildCandidates([{id:'only',x:127,y:37}]),[]);
const oneDegree=buildCandidates([{id:'a',x:0,y:0},{id:'b',x:1,y:0}],{limit:1});
assert(Math.abs(oneDegree[0].distanceMeters-111195)<1,'Candidate distance is great-circle meters, not kilometers or degrees');
const many=Array.from({length:500},(_,i)=>({id:'stop-'+String(i).padStart(3,'0'),x:127+(i%25)*.001,y:37+Math.floor(i/25)*.001}));
const large=buildCandidates([{id:'center',x:126.9,y:37},...many],{originId:'center',limit:100});
assert.equal(large.length,25500,'500 stops generate 25,000 directed neighbors plus all 500 center edges');
assert(large.slice(0,500).every(e=>e.reason==='center'));
assert.equal(new Set(large.slice(500,1000).map(e=>e.from)).size,500,'The first neighbor round spreads remaining budget across all 500 origins');
const outgoing=new Map();for(const edge of large)outgoing.set(edge.from,(outgoing.get(edge.from)??0)+1);
assert.equal(outgoing.get('center'),500);assert(many.every(p=>outgoing.get(p.id)===50));
assert.equal(new Set(large.map(e=>JSON.stringify([e.from,e.to]))).size,25500);
const budgetOutgoing=new Map();for(const edge of large.slice(0,25000))if(edge.reason!=='center')budgetOutgoing.set(edge.from,(budgetOutgoing.get(edge.from)??0)+1);
assert(many.every(p=>budgetOutgoing.get(p.id)===49),'A 25,000-edge budget keeps all center edges and defers one neighbor per stop fairly');
assert.equal(buildCandidates([...many,{id:'stop-500',x:127.1,y:37.1}],{limit:1}).length,501,'There is no 500-destination cap');
console.log('Exact address/source grouping, directed distance-weighted candidates, soft OTD ties, coordinate validation, center-first round-robin budgets and 500-stop scale passed');
