import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { charterRegion, CHARTER_RATES } from '../repo-root/js/pyeongtaek-charter-rates.js';
import { parseCharterSheet, buildCharterWorkbook } from '../repo-root/js/pyeongtaek-charter-parser.js';
const XLSX = createRequire(import.meta.url)(process.env.XLSX_TEST_MODULE || 'xlsx');
for (const [address, region] of [
  ['서울특별시 중구 세종대로', '중구'], ['서울 노원구 동일로', '노원'],
  ['서울특별시 강서구 공항대로', '강서'], ['부산광역시 강서구', '부산'],
  ['광주광역시 북구', '전광주'], ['경기도 광주시', '광주'],
  ['인천광역시 부평구', '부평'], ['인천광역시 강화군', '강화'],
  ['인천광역시 중구 인천국제공항', '인천공항'],
  ['경기도 화성시 동탄동', '동탄'], ['경기도 평택시 포승읍', '포승'],
  ['경기도 남양주시 진접읍', '진접'], ['경북 경산시 하양읍', '하양'],
  ['충청북도 음성군', '음성'], ['세종특별자치시 한누리대로', '세종']
]) assert.equal(charterRegion(address).name, region, address);
assert.equal(charterRegion('서울특별시 마포구').rate, null);
assert.equal(charterRegion('광주광역시 북구').rate.rates['2.5'], 310000);
assert.equal(charterRegion('경기도 광주시').rate.rates['2.5'], 135000);
assert.equal(new Set(CHARTER_RATES.map(row => row.name)).size, CHARTER_RATES.length);
const s = v => ({ t: 's', v }), n = v => ({ t: 'n', v });
const sheet = {
  '!ref': 'A1:S9', B4: s('2026-09-08'), Q4: n(2.5), S4: n(123456),
  G4: s('수원 A'), G5: s('수원 B'), G6: s('부산'), G7: s('노원'), G8: s('강남'), G9: s('미등록'),
  H4: s('경기도 수원시'), H6: s('부산광역시 강서구'), H7: s('서울특별시 노원구'),
  H8: s('서울특별시 강남구'), H9: s('알수없는주소'),
  '!merges': [{ s: {r:3,c:1}, e:{r:8,c:1} }, { s:{r:3,c:7}, e:{r:4,c:7} },
    {s:{r:3,c:16}, e:{r:8,c:16}}, {s:{r:3,c:18}, e:{r:8,c:18}}]
};
const parsed = parseCharterSheet(sheet, XLSX);
assert.deepEqual(parsed.records[0].cities, ['부산','노원','강남','수원','']);
assert.deepEqual(parsed.records[0].destinations, ['부산','노원','강남','수원 A','수원 B','미등록']);
assert.equal(parsed.records[0].stopCount, 5);
const wb = buildCharterWorkbook(parsed, {}, XLSX);
const out = XLSX.read(XLSX.write(wb, {type:'buffer',bookType:'xlsx'}), {type:'buffer'}).Sheets['평택 용차내역'];
assert.equal(out.F4.v, 2.5); assert.equal(out.E4.v, 123456);
assert.equal(out.AF4.v, 5); assert.equal(out.T4.v, '부산'); assert.equal(out.G4.v, '부산');
assert.equal(out.AE3.v, '지역12'); assert.equal(out.AF3.v, '총착지');
// 3.5-ton Seoul rates tie; source order is retained. 2.5-ton rates differ.
sheet.H4 = s('서울특별시 강남구'); sheet.H6 = s('서울특별시 노원구');
sheet.Q4 = n(3.5);
assert.equal(parseCharterSheet(sheet, XLSX).records[0].destinations[0], '수원 A');
sheet.Q4 = n(2.5);
assert.equal(parseCharterSheet(sheet, XLSX).records[0].destinations[0], '부산');
// No value is silently lost when a vehicle contains conflicting Q/S values.
sheet['!merges'] = sheet['!merges'].slice(0,2); sheet.S5 = n(999);
assert.throws(() => parseCharterSheet(sheet, XLSX), /S열 값이 여러 개/);
const record = { ...parsed.records[0], cities: Array(12).fill('부산') };
assert.equal(buildCharterWorkbook({records:[record]}, {}, XLSX).Sheets['평택 용차내역'].AE4.v, '부산');
assert.throws(() => buildCharterWorkbook({records:[{...record,cities:Array(13).fill('부산')}]}, {}, XLSX), /12개/);
console.log('PASS: supplied rates, regional exceptions, Q/S mappings, paired sorting by ton, stable ties, merged stops, AF total and T:AE boundaries');
