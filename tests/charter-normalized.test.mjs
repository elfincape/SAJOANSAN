import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FIELDS,normalizeValue,parseNormalizedSheet,makeArchive,readArchive,activeIssues,updateField,calculatedStops,buildNormalizedWorkbook,charterWorkbookFilename,horizontalData,routingSummary } from '../repo-root/js/pyeongtaek-charter-model.js';
const XLSX=createRequire(import.meta.url)(process.env.XLSX_TEST_MODULE||'xlsx');
const text=v=>({t:'s',v}),num=v=>({t:'n',v});
const sheet={'!ref':'A1:U8',B4:num(46273),C4:text('용차'),D4:text('광역1'),E4:text('고정3'),Q4:num(2.5),R4:text('기사'),S4:text('12가3456'),T4:text('01001234567'),N4:num(60),M4:num(3),O4:num(0.25),P4:text('06:30 출차'),
 F4:text('001'),G4:text('수원 A'),H4:text('경기도 수원시'),I4:text('고객1'),J4:num(15),K4:num(10),L4:num(5),
 F5:text('002'),G5:text('수원 B'),I5:text('고객2'),J5:num(20),K5:num(0),L5:num(20),
 F6:text('003'),G6:text('부산점'),H6:text('부산광역시 강서구'),I6:text('고객3'),J6:num(25),K6:num(25),L6:num(0),U6:text('부산'),
 F7:text('004'),G7:text('#NA'),H7:text('서울특별시 노원구'),J7:{t:'e',v:42},K7:text('#N/A'),L7:{t:'e',v:15},
 B8:text('#NA'),D8:text('오류 운행'),Q8:{t:'e',v:42},S8:{t:'e',v:23},G8:text('정상점'),H8:text('경기도 시흥시'),K8:num(4),L8:num(5),
 '!merges':[{s:{r:3,c:1},e:{r:6,c:1}},{s:{r:3,c:7},e:{r:4,c:7}},...[2,3,4,12,13,14,15,16,17,18,19].map(c=>({s:{r:3,c},e:{r:6,c}}))]
};
const parsed=parseNormalizedSheet(sheet,XLSX,{centerCode:'002',sourceName:'test.xlsx',sheetName:'원본',year:2026});
assert.equal(parsed.length,2);assert.equal(parsed[0].date,'2026-09-08');assert.equal(parsed[0].vehicleSequence,'고정3');assert.equal(parsed[0].tons,2.5);
assert.equal(parsed[0].phone,'01001234567');assert.equal(parsed[0].arrivalTime,'06:00');assert.equal(parsed[0].departureTime,'06:30 출차');
assert.equal(parsed[0].deliveries.length,4);assert.equal(calculatedStops(parsed[0]),3);
assert.equal(parsed[0].deliveries[2].customer,'고객3');
assert.equal(parsed[0].deliveries[3].name,null);assert.equal(parsed[0].deliveries[3].quantity,null);assert.equal(parsed[0].deliveries[1].frozen,0);
assert.equal(parsed[1].date,null);assert.equal(parsed[1].tons,null);assert.equal(parsed[1].vehicleNumber,null);
assert.ok(activeIssues(parsed[0]).some(i=>i.cell==='J7'));assert.ok(activeIssues(parsed[1]).some(i=>i.field==='date'));
assert.deepEqual(parseNormalizedSheet(sheet,XLSX,{centerCode:'002',sourceName:'test.xlsx',sheetName:'原本'}).map(t=>t.id)[0],parsed[0].id);
const round=readArchive(JSON.parse(JSON.stringify(makeArchive(parsed,'002'))),'002');
assert.equal(round[1].date,null);assert.equal(round[0].deliveries[1].frozen,0);
assert.throws(()=>readArchive(makeArchive(parsed,'002'),'001'),/센터/);
assert.throws(()=>readArchive({...makeArchive(parsed,'002'),trips:[parsed[0],parsed[0]]},'002'),/운행ID/);
const originalId=parsed[1].id;updateField(parsed[1],null,'date','2026-10-08');assert.equal(parsed[1].id,originalId);assert.equal(parsed[1].date,'2026-10-08');
assert.ok(parsed[1].issues.filter(i=>i.field==='date').every(i=>i.resolved));
updateField(parsed[0],'d-7','quantity','99');assert.equal(parsed[0].deliveries[3].quantity,99);
assert.throws(()=>updateField(parsed[0],null,'date','2026-02-30'),/일자/);
const output=buildNormalizedWorkbook(parsed,XLSX);
const reopened=XLSX.read(XLSX.write(output,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}).Sheets['평택 용차내역'];
assert.equal(reopened.C4.v,'2026-09-08');assert.equal(reopened.E4.v,'12가3456');assert.equal(reopened.H4.v,2.5);assert.equal(reopened.AG4.v,3);
assert.equal(reopened.I4.v,'부산점');assert.equal(reopened.U4.v,'부산');assert.equal(reopened.V4.v,'노원');assert.equal(reopened.W4.v,'수원');
assert.equal(reopened.AP4.v,'고객3');assert.equal(reopened.AQ4.v,25);assert.equal(reopened.AS4.v,25);
assert.equal(reopened.F4.v,'기사');assert.equal(reopened.G4.v,'01001234567');
assert.equal(Object.values(reopened).some(c=>c?.t==='e'),false);
const summary=routingSummary(parsed,'001');assert.equal(summary.count,1);assert.equal(summary.frozen,10);assert.equal(summary.chilled,5);assert.equal(summary.quantity,15);assert.ok(summary.companions.some(([name])=>name==='부산점'));assert.equal(summary.daily[0].date,'2026-09-08');
const day={'!ref':'A1:U6',B4:text('2026-10-08'),D4:text('코스1'),S4:text('차량1'),G4:text('A'),H4:text('수원시'),D5:text('코스2'),S5:text('차량2'),G5:text('B'),H5:text('부산광역시'),D6:text('코스2'),S6:text('차량2'),G6:text('C'),H6:text('부산광역시'),'!merges':[{s:{r:3,c:1},e:{r:5,c:1}}]};
assert.equal(parseNormalizedSheet(day,XLSX).length,2);
const more={...parsed[0],deliveries:Array.from({length:14},(_,i)=>({...parsed[0].deliveries[0],id:'d'+i,stopId:'same',name:'거래처'+i}))};
const wide=horizontalData([more]);assert.ok(wide.rows[0].includes('거래처13'));
console.log('PASS: B:U mapping, date/merge grouping, #NA errors retained as null, stable trip IDs, DB-editable issues, JSON validation, paired rate sorting, horizontal Excel quantities and routing analytics');

for(const [input,expected] of [
 ['09:30 이전','09:30'],['전일 23:00 이전','전일 23:00'],[' 전일   9:05 이전 ','전일 09:05'],
 ['06:00:00','06:00'],['23:59','23:59'],['24:00 이전',null],['12:60 이전',null],
 ['시간 미정',null],['#N/A',null],[null,null],[0,'00:00'],[0.25,'06:00'],[0.99999,'23:59']
])assert.equal(normalizeValue(input,'time'),expected);
const arrivalSheet={...sheet,O4:text('전일 23:00 이전'),P4:text('메모: 출차 대기')};
const timed=parseNormalizedSheet(arrivalSheet,XLSX,{centerCode:'002'});
assert.equal(timed[0].arrivalTime,'전일 23:00');assert.equal(timed[0].departureTime,'메모: 출차 대기');
updateField(timed[0],null,'arrivalTime','09:30 이전');assert.equal(timed[0].arrivalTime,'09:30');
const legacy=makeArchive(timed,'002');legacy.trips[0].arrivalTime='전일 22:30 이전';
assert.equal(readArchive(legacy,'002')[0].arrivalTime,'전일 22:30');
const timeOutput=horizontalData(timed);assert.equal(timeOutput.headers[35],'비고');assert.equal(timeOutput.rows[0][34],'09:30');assert.equal(timeOutput.rows[0][35],'메모: 출차 대기');
assert.equal(FIELDS.find(f=>f[0]==='P')[2],'비고');
console.log('PASS: arrival HH:MM extraction, previous-day prefix, Excel serial and legacy JSON normalization, editable time and plain remarks export');

const testRoute=names=>({...parsed[0],tons:null,deliveries:names.map((name,i)=>({id:'r'+i,stopId:'s'+i,name:'거래처'+i,customer:'고객',address:name+'시',region:name,frozen:12.99,chilled:0.75,quantity:13.74}))});
for(const [names,total,moves] of [[['논산','논산','논산','인천'],4,1],[['논산','인천','대전'],3,2]]){
 const data=horizontalData([testRoute(names)]);assert.equal(data.rows[0][32],total);assert.equal(data.rows[0][33],moves);
 assert.equal(data.rows[0][42],12);assert.equal(data.rows[0][43],0);assert.equal(data.rows[0][44],13);
 assert.deepEqual(data.headers.slice(40,45),['납품처명1','고객사1','냉동1','냉장1','총수량1']);
 assert.equal(data.headers.at(-2),'확인 필요');assert.equal(data.headers.at(-1),'착지수확인');assert.equal(data.headers.some(h=>h.includes('단가')),false);
}
const hidden=output.Sheets['평택 용차내역']['!cols'];
for(let i=0;i<hidden.length;i++)assert.equal(!!hidden[i].hidden,(i>=13&&i<=19)||(i>=25&&i<=31));
const hiddenRound=XLSX.read(XLSX.write(output,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellStyles:true}).Sheets['평택 용차내역']['!cols'];
assert.equal(hiddenRound[13].hidden,true);assert.equal(hiddenRound[25].hidden,true);assert.equal(!!hiddenRound[12].hidden,false);
console.log('PASS: integer export quantities, E/F/G vehicle contacts, compact delivery detail, hidden 6-12 columns, region stops/transitions and final issue column');

for(const [original,expected] of [[3,0],[2,1],[4,-1],[0,3],[null,null]]){
 const trip={...testRoute(['논산','인천','대전']),providedStopCount:original};
 const data=horizontalData([trip]);assert.equal(data.headers.at(-1),'착지수확인');assert.equal(data.rows[0].at(-1),expected);
}
const stopCheckBook=buildNormalizedWorkbook([{...testRoute(['논산','인천','대전']),providedStopCount:2}],XLSX);
const checkSheet=XLSX.read(XLSX.write(stopCheckBook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}).Sheets['평택 용차내역'];
const lastColumn=XLSX.utils.decode_range(checkSheet['!ref']).e.c;
assert.equal(checkSheet[XLSX.utils.encode_cell({r:2,c:lastColumn})].v,'착지수확인');
assert.equal(checkSheet[XLSX.utils.encode_cell({r:3,c:lastColumn})].v,1);
console.log('PASS: final stop-count difference column with matching, positive, negative, zero and missing original counts');

assert.equal(charterWorkbookFilename([{date:'2026-10-08'}]),'2026-10-08_평택센터_용차내역서_내부.xlsx');
assert.equal(charterWorkbookFilename([{date:'2026-10-08'},{date:'2026-10-01'},{date:'2026-10-08'}]),'2026-10-01~2026-10-08_평택센터_용차내역서_내부.xlsx');
assert.equal(charterWorkbookFilename([{date:null}]),'일자미정_평택센터_용차내역서_내부.xlsx');
console.log('PASS: Excel filename uses exported business date or date range and requested center/report suffix');
