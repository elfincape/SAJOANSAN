import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {parseCharterSources} from '../repo-root/js/pyeongtaek-charter-import.js';
import {buildNormalizedWorkbook,readArchive,makeArchive} from '../repo-root/js/pyeongtaek-charter-model.js';
const XLSX=createRequire(import.meta.url)(process.env.XLSX_TEST_MODULE||'xlsx');
function book(date,quantity=10){
 const sheet=XLSX.utils.aoa_to_sheet([[],[],['임의 제목'],[null,date,'용차','코스1','101','D1','첫 납품처','경기도 수원시','고객',quantity,6,4,2,15,null,'비고',2.5,'기사','12가3456'],[null,null,null,null,null,'D2','둘째 납품처','경기도 오산시','고객',5,3,2]]);
 sheet['!merges']=[XLSX.utils.decode_range('B4:B5')];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'내역');return wb;
}
const one={name:'첫째.xlsx',workbook:book('2026-10-01'),sheetName:'내역'},two={name:'둘째.xlsx',workbook:book('2026-10-02'),sheetName:'내역'};
let result=parseCharterSources([one,two],XLSX,{centerCode:'002',year:2026});
assert.equal(result.trips.length,2);assert.deepEqual(result.trips.map(t=>t.date),['2026-10-01','2026-10-02']);assert.equal(result.trips[0].deliveries.length,2);assert.equal(result.trips[0].sourceName,'첫째.xlsx');
assert.equal(readArchive(makeArchive(result.trips,'002'),'002').length,2);
const output=buildNormalizedWorkbook(result.trips,XLSX).Sheets['평택 용차내역'];assert.equal(output.C4.v,'2026-10-01');assert.equal(output.C5.v,'2026-10-02');
assert.equal(parseCharterSources([one,{...one,name:'복사본.xlsx'}],XLSX,{centerCode:'002'}).duplicates,1);
assert.throws(()=>parseCharterSources([one,{...one,name:'수정본.xlsx',workbook:book('2026-10-01',99)}],XLSX,{centerCode:'002'}),/첫째.xlsx.*수정본.xlsx/);
const alternate=book('2026-10-03');XLSX.utils.book_append_sheet(alternate,book('2026-10-04').Sheets['내역'],'선택시트');assert.equal(parseCharterSources([{name:'여러시트.xlsx',workbook:alternate,sheetName:'선택시트'}],XLSX).trips[0].date,'2026-10-04');
assert.throws(()=>parseCharterSources([{...one,name:'빈파일.xlsx',sheetName:'없는시트'}],XLSX),/빈파일.xlsx.*없는시트/);
const errors=book('2026-10-05');errors.Sheets['내역'].K4={t:'e',v:42};const faulty=parseCharterSources([{name:'오류.xlsx',workbook:errors}],XLSX).trips[0];assert.equal(faulty.deliveries[0].frozen,null);assert(faulty.issues.some(i=>i.cell==='K4'));
console.log('PASS: multi-file dates/merges, per-file sheets, duplicate exclusion, conflicting-ID rejection, error provenance, formula-error blanks and horizontal export');

const formatted=book('2026-10-10');
formatted.Sheets['내역']['!ref']='A1:U5';
formatted.Sheets['내역'].F4={t:'n',v:123,z:'000000'};
formatted.Sheets['내역'].T4={t:'n',v:1012345678,z:'00000000000'};
formatted.Sheets['내역'].Q4={t:'n',v:2.5,z:'0.0'};
formatted.Sheets['내역'].J4={t:'n',v:10.25,z:'0.00'};
const reopened=XLSX.read(XLSX.write(formatted,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellDates:false,cellNF:true});
const styled=parseCharterSources([{name:'숫자서식.xlsx',workbook:reopened}],XLSX).trips[0];
assert.equal(styled.deliveries[0].code,'000123');
assert.equal(styled.phone,'01012345678');
assert.equal(styled.tons,2.5);
assert.equal(styled.deliveries[0].quantity,10.25);
console.log('PASS: uploaded XLSX numeric-cell formatting uses utils.format_cell, preserves leading zeros and keeps quantities numeric');
