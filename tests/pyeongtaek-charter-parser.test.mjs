import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseCharterSheet, buildCharterWorkbook, displayCharterDate } from '../repo-root/js/pyeongtaek-charter-parser.js';

// Set XLSX_TEST_MODULE to a local SheetJS 0.18.5 bundle, or install xlsx.
const XLSX = createRequire(import.meta.url)(process.env.XLSX_TEST_MODULE || 'xlsx');
const s = v => ({ t: 's', v });
const date = { t: 'n', v: 46273, z: 'yyyy-mm-dd' };
const fixture = () => ({
  '!ref': 'A1:G13', B3: s('일자'), G3: s('납품처명'),
  B4: { ...date }, G4: s('거래처 A'), G5: s('거래처 B'), G6: s('거래처 A'),
  B7: { ...date }, G7: s('별도 차량'), G8: s('두 번째 경유지'),
  B9: s('9월 8일'), G9: s('단독 운행'),
  G10: s('날짜 누락'), B11: s('9월 9일'),
  B12: s('9월 10일'), G12: s('<img src=x onerror=alert(1)>'),
  B13: s('9월 11일'), G13: s('=HYPERLINK("https://example.com")'),
  '!merges': [{ s: { r: 3, c: 1 }, e: { r: 5, c: 1 } }, { s: { r: 6, c: 1 }, e: { r: 7, c: 1 } }]
});
let parsed = parseCharterSheet(fixture(), XLSX);
assert.equal(parsed.records.length, 5);
assert.deepEqual(parsed.records[0].destinations, ['거래처 A', '거래처 B', '거래처 A']);
assert.deepEqual(parsed.records[1].destinations, ['별도 차량', '두 번째 경유지']);
assert.equal(parsed.records[2].date.v, '9월 8일');
assert.equal(parsed.warnings.length, 2);
assert.match(parsed.warnings[0], /10행/);
assert.match(parsed.warnings[1], /11행/);

for (const bookType of ['xlsx', 'biff8']) {
  for (const date1904 of [false, true]) {
    const source = XLSX.utils.book_new();
    source.Workbook = { WBProps: { date1904 } };
    XLSX.utils.book_append_sheet(source, fixture(), '원본');
    const input = XLSX.read(XLSX.write(source, { type: 'buffer', bookType }), { type: 'buffer', cellNF: true });
    const result = parseCharterSheet(input.Sheets['원본'], XLSX);
    assert.equal(result.records.length, 5);
    const output = buildCharterWorkbook(result, input, XLSX);
    const reopened = XLSX.read(XLSX.write(output, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellNF: true });
    const sheet = reopened.Sheets['평택 용차내역'];
    assert.equal(sheet.C3.v, '일자');
    assert.equal(sheet.G3.v, '납품처1');
    assert.equal(sheet.C4.v, date.v);
    assert.equal(sheet.C4.t, 'n');
    assert.equal(sheet.C4.z, date.z);
    assert.equal(!!reopened.Workbook.WBProps.date1904, date1904);
    assert.equal(displayCharterDate(sheet.C4, date1904, XLSX), XLSX.SSF.format(date.z, date.v, { date1904 }));
    assert.deepEqual(['G4', 'H4', 'I4'].map(key => sheet[key].v), ['거래처 A', '거래처 B', '거래처 A']);
    assert.equal(sheet.G5.v, '별도 차량');
    assert.equal(sheet.G8.t, 's');
    assert.equal(sheet.G8.f, undefined);
    for (const col of ['A', 'B', 'D', 'E', 'F']) assert.equal(sheet[`${col}4`], undefined);
    assert.equal(sheet['!merges'], undefined);
  }
}
const noMerge = fixture(); noMerge['!merges'] = [];
assert.deepEqual(parseCharterSheet(noMerge, XLSX).records[0].destinations, ['거래처 A']);
const badHeader = fixture(); badHeader.G3 = s('다른 양식');
assert.throws(() => parseCharterSheet(badHeader, XLSX), /3행/);
assert.throws(() => parseCharterSheet({}, XLSX), /비어/);
assert.throws(() => parseCharterSheet({ '!ref': 'A1:G3', B3: s('일자'), G3: s('납품처명') }, XLSX), /운행이 없습니다/);
const crossing = fixture(); crossing['!merges'][0].e.c = 2;
assert.throws(() => parseCharterSheet(crossing, XLSX), /B열 안/);
const errorCell = fixture(); errorCell.G5 = { t: 'e', v: 7 };
assert.throws(() => parseCharterSheet(errorCell, XLSX), /G5/);
const many = fixture();
many['!ref'] = 'A1:G30'; many['!merges'] = [{ s: { r: 3, c: 1 }, e: { r: 29, c: 1 } }];
for (let i = 4; i <= 30; i++) many[`G${i}`] = s(`경유${i - 3}`);
const wide = buildCharterWorkbook(parseCharterSheet(many, XLSX), {}, XLSX).Sheets['평택 용차내역'];
assert.equal(wide.AG4.v, '경유27');
console.log('PASS: merged vehicle groups, same-date separation, warnings, C/G layout, XLS/XLSX round trips, date epochs, text safety, and >Z columns');
