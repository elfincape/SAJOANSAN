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
assert.deepEqual(parseCharterSheet(badHeader, XLSX), parsed);
delete badHeader.B3; delete badHeader.G3;
assert.deepEqual(parseCharterSheet(badHeader, XLSX), parsed);
assert.throws(() => parseCharterSheet({}, XLSX), /비어/);
assert.throws(() => parseCharterSheet({ '!ref': 'A1:G3', B3: s('일자'), G3: s('납품처명') }, XLSX), /운행이 없습니다/);
const crossing = fixture(); crossing['!merges'][0].e.c = 2;
assert.deepEqual(parseCharterSheet(crossing, XLSX), parsed);
const mergedFour = {
  '!ref': 'A1:G7', B3: s('운행일'), G3: s('거래처'), B4: { ...date },
  G4: s('가'), G5: s('나'), G6: s('다'), G7: s('라'),
  '!merges': [{ s: { r: 3, c: 1 }, e: { r: 6, c: 1 } },
    { s: { r: 0, c: 0 }, e: { r: 2, c: 6 } }]
};
for (const bookType of ['xlsx', 'biff8']) {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, mergedFour, '원본');
  const input = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType }), { type: 'buffer', cellNF: true });
  const result = parseCharterSheet(input.Sheets['원본'], XLSX);
  assert.equal(result.records.length, 1);
  const out = buildCharterWorkbook(result, input, XLSX).Sheets['평택 용차내역'];
  assert.equal(out.C4.v, date.v);
  assert.deepEqual(['G4', 'H4', 'I4', 'J4'].map(key => out[key].v), ['가', '나', '다', '라']);
}
// Ignore header merges even when they extend into the first data row.
mergedFour['!merges'].push({ s: { r: 2, c: 0 }, e: { r: 3, c: 2 } });
assert.equal(parseCharterSheet(mergedFour, XLSX).records.length, 1);
mergedFour['!merges'][0].e.r = 20;
assert.deepEqual(parseCharterSheet(mergedFour, XLSX).records[0].destinations, ['가', '나', '다', '라']);
// B belongs to an A:B merged date: use the merged cell's actual anchor.
const leftAnchor = fixture();
leftAnchor.A4 = leftAnchor.B4; delete leftAnchor.B4;
leftAnchor['!merges'][0].s.c = 0;
assert.equal(parseCharterSheet(leftAnchor, XLSX).records[0].date.v, date.v);
const errorCell = fixture(); errorCell.G5 = { t: 'e', v: 7 };
assert.throws(() => parseCharterSheet(errorCell, XLSX), /G5/);
const many = fixture();
many['!ref'] = 'A1:G30'; many['!merges'] = [{ s: { r: 3, c: 1 }, e: { r: 29, c: 1 } }];
for (let i = 4; i <= 30; i++) many[`G${i}`] = s(`경유${i - 3}`);
const wide = buildCharterWorkbook(parseCharterSheet(many, XLSX), {}, XLSX).Sheets['평택 용차내역'];
assert.equal(wide.AM4.v, '경유27');
const addresses = {
  '!ref': 'A1:H11', B4: s('9월 8일'), B10: s('9월 8일'),
  '!merges': [ { s: { r: 3, c: 1 }, e: { r: 8, c: 1 } },
    { s: { r: 9, c: 1 }, e: { r: 10, c: 1 } },
    { s: { r: 3, c: 7 }, e: { r: 4, c: 7 } } ],
  H4: s('경기도 평택시 중앙로 1'), H6: s('부산광역시 강서구 1'),
  H7: s('서울특별시 강남구 1'), H8: s('세종특별자치시 한누리대로 1'),
  H9: s('경기도 평택시 중앙로 1'), H10: s('충북 음성군 대소면'), H11: s('경기도 시흥시 정왕동')
};
for (let r = 4; r <= 11; r++) addresses[`G${r}`] = s(`납품처${r}`);
const addressResult = parseCharterSheet(addresses, XLSX);
assert.equal(addressResult.records[0].stopCount, 5);
assert.deepEqual(addressResult.records[0].cities, ['평택', '부산', '서울', '세종', '평택']);
assert.equal(addressResult.records[1].stopCount, 2);
assert.deepEqual(addressResult.records[1].cities, ['', '시흥']);
assert.match(addressResult.warnings[0], /H10/);
const addressOutput = buildCharterWorkbook(addressResult, {}, XLSX);
const reopenedAddress = XLSX.read(XLSX.write(addressOutput, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' }).Sheets['평택 용차내역'];
assert.equal(reopenedAddress.Y4.v, 5);
assert.equal(reopenedAddress.Y4.t, 'n');
assert.deepEqual(['T4','U4','V4','W4','X4'].map(key => reopenedAddress[key].v), ['평택','부산','서울','세종','평택']);
assert.equal(reopenedAddress.U5.v, '시흥');
// Six unmerged addresses preserve their order without overwriting Y.
addresses.H5 = s('대구광역시 동구'); addresses['!merges'].pop();
const six = buildCharterWorkbook(parseCharterSheet(addresses, XLSX), {}, XLSX).Sheets['평택 용차내역'];
assert.equal(six.Y4.v, 6); assert.equal(six.Z4.v, '평택');
console.log('PASS: merged vehicle groups, same-date separation, warnings, C/G layout, XLS/XLSX round trips, date epochs, text safety, and >Z columns');
