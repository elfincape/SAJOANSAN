import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readCompareSheet, compareSheets, buildCompareWorkbook, resultValues } from '../repo-root/js/excel-compare.js';

// Same SheetJS bundle as the existing admin tools; set XLSX_TEST_MODULE or install xlsx.
const XLSX = createRequire(import.meta.url)(process.env.XLSX_TEST_MODULE || 'xlsx');
const sheet = rows => readCompareSheet(XLSX.utils.aoa_to_sheet(rows), XLSX);
const pair = [{ left: 0, right: 0 }];
const fixture = () => ({
  left: sheet([['거래처', '코드', '지역', '수량'], ['가', '01', '안산', 2], ['나', '02', '부산', 3], ['다', '03', '서울', 4], ['가', '01', '안산', 5], ['가', '', '안산', 6]]),
  right: sheet([['금액', '거래처', '코드', '메모', '기타', '지역'], [30, '나', '02', '부산값', '', '부산'], [20, '가', '01', '첫값', '', '안산'], [50, '가', '01', '둘째값', '', '안산'], [90, '라', '04', '다른값', '', '제주']]),
  pairs: [{ left: 0, right: 1 }, { left: 1, right: 2 }, { left: 2, right: 5 }]
});

test('A/B/C ↔ B/C/F and shuffled rows: import into each original row in both directions', () => {
  const { left, right, pairs } = fixture();
  const result = compareSheets(left, right, pairs);
  assert.deepEqual(result.left.stats, { total: 5, eligible: 4, excluded: 1, found: 3, missing: 1, matched: 3, duplicate: 2 });
  assert.deepEqual(result.right.stats, { total: 4, eligible: 4, excluded: 0, found: 3, missing: 1, matched: 3, duplicate: 2 });
  assert.deepEqual(result.left.rows.map(row => row.matchIndex), [1, 0, null, 2, null]);
  assert.deepEqual(result.right.rows.map(row => row.matchIndex), [1, 0, 3, null]);
  assert.deepEqual(resultValues(left, right, result.left.rows[0], [0, 3], false).slice(-2), ['20', '첫값']);
  assert.deepEqual(resultValues(right, left, result.right.rows[2], [3], false).slice(-1), ['5']);
});

test('existence does not consume duplicate keys; 1:1 extraction shows shortage', () => {
  const left = sheet([['키'], ['같음'], ['같음'], ['같음']]), right = sheet([['키'], ['같음']]);
  const result = compareSheets(left, right, pair);
  assert.deepEqual(result.left.rows.map(row => row.exists), [true, true, true]);
  assert.deepEqual(result.left.rows.map(row => row.matchIndex), [0, null, null]);
  assert.equal(result.left.rows[1].status, '중복 · 상대 행 부족');
  assert.equal(compareSheets(left, right, pair, { duplicates: 'first' }).left.stats.matched, 3);
  const unique = compareSheets(left, right, pair, { duplicates: 'unique' });
  assert.equal(unique.left.stats.matched, 0); assert.equal(unique.right.stats.matched, 0);
});

test('blank/whitespace/error/uncached formula excluded; zero and FALSE are values', () => {
  const raw = XLSX.utils.aoa_to_sheet([['키', '기타'], [0, '숫자'], [false, '불리언'], ['', '빈칸'], ['  ', '공백'], ['오류', '오류'], ['수식', '계산 안 됨'], [null, null], ['x', '데이터']]);
  raw.A6 = { t: 'e', v: 7 }; raw.A7 = { t: 'n', f: '1+1' };
  const left = readCompareSheet(raw, XLSX), right = sheet([['키'], [0], [false], ['x']]);
  const result = compareSheets(left, right, pair);
  assert.equal(result.left.stats.total, 7); assert.equal(result.left.stats.eligible, 3); assert.equal(result.left.stats.excluded, 4);
  assert.equal(result.left.stats.found, 3); assert.equal(left.rows.at(-1).rowNumber, 9);
  assert.equal(result.left.rows[2].exists, null);
});

test('tuple boundaries, case/space options, and displayed leading zeros are respected', () => {
  const left = sheet([['a', 'b'], ['a|b', 'c'], [' CODE ', 'x'], ['001', 'x']]);
  const right = sheet([['a', 'b'], ['a', 'b|c'], ['code', 'x'], [1, 'x']]);
  const pairs = [{ left: 0, right: 0 }, { left: 1, right: 1 }];
  assert.equal(compareSheets(left, right, pairs).left.stats.found, 0);
  assert.equal(compareSheets(left, right, pairs, { ignoreCase: true }).left.stats.found, 1);
  assert.equal(compareSheets(left, right, pairs, { ignoreCase: true, trim: false }).left.stats.found, 0);
  const formatted = XLSX.utils.aoa_to_sheet([['키'], [1]]); formatted.A2.z = '000';
  assert.equal(compareSheets(sheet([['키'], ['001']]), readCompareSheet(formatted, XLSX), pair, { valueMode: 'display' }).left.stats.found, 1);
});

test('raw values do not falsely match rounded numbers; display mode is explicit', () => {
  const a = XLSX.utils.aoa_to_sheet([['값'], [1.234], [1], [false]]);
  const b = XLSX.utils.aoa_to_sheet([['값'], [1.233], ['1'], ['FALSE']]);
  a.A2.z = b.A2.z = '0.00';
  const left = readCompareSheet(a, XLSX), right = readCompareSheet(b, XLSX);
  assert.equal(compareSheets(left, right, pair).left.stats.found, 0);
  assert.equal(compareSheets(left, right, pair, { valueMode: 'display' }).left.stats.found, 3);
  b.A2.v = 1.234; b.A2.z = '0.00000';
  assert.equal(compareSheets(left, readCompareSheet(b, XLSX), pair).left.stats.found, 1);
});

test('header offset/no header/sparse rows/empty data and validation', () => {
  const raw = XLSX.utils.aoa_to_sheet([['보고서'], [], ['키', '이름'], ['a', '가'], [], ['b', '나']]);
  assert.deepEqual(readCompareSheet(raw, XLSX, 3).rows.map(row => row.rowNumber), [4, 6]);
  assert.equal(readCompareSheet(raw, XLSX, 0).rows[0].rowNumber, 1);
  const offset = { '!ref': 'C5:D6', C5: { t: 's', v: '첫값' }, D6: { t: 's', v: '둘째값' } };
  assert.deepEqual(readCompareSheet(offset, XLSX, 0).rows.map(row => row.rowNumber), [5, 6]);
  assert.equal(compareSheets(sheet([['키']]), sheet([['키'], ['a']]), pair).right.stats.missing, 1);
  assert.throws(() => readCompareSheet({}, XLSX), /비어/);
  assert.throws(() => readCompareSheet(raw, XLSX, 1.5), /정수/);
  assert.throws(() => readCompareSheet(raw, XLSX, 50), /범위/);
  const data = sheet([['키'], ['a']]);
  assert.throws(() => compareSheets(data, data, []), /한 쌍/);
  assert.throws(() => compareSheets(data, data, [{ left: null, right: 0 }]), /모두 선택/);
  assert.throws(() => compareSheets(data, data, [pair[0], pair[0]]), /중복 선택/);
  assert.throws(() => readCompareSheet({ '!ref': 'A1:A100002' }, XLSX), /10만 행/);
});

test('export round trip preserves typed values, booleans, source order, and adds imports safely', () => {
  const { left, right, pairs } = fixture();
  right.rows[1].cells[3] = { t: 's', v: '=HYPERLINK("https://example.com")' };
  right.rows[0].cells[0] = { t: 'n', v: 30, f: '10+20', z: '#,##0' };
  const before = JSON.stringify({ left, right });
  const comparison = compareSheets(left, right, pairs);
  const output = buildCompareWorkbook(left, right, comparison, { leftImports: [0, 3], rightImports: [3] }, XLSX);
  const book = XLSX.read(XLSX.write(output, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellNF: true });
  assert.deepEqual(book.SheetNames, ['비교 요약', '시트1 결과', '시트2 결과']);
  const s = book.Sheets['시트1 결과'];
  assert.equal(s.B2.t, 'b'); assert.equal(s.B2.v, true); assert.equal(s.B4.v, false); assert.equal(s.B6, undefined);
  assert.equal(s.J2.t, 'n'); assert.equal(s.J2.v, 20); assert.equal(s.J3.v, 30); assert.equal(s.J3.f, undefined);
  assert.equal(s.K2.t, 's'); assert.match(s.K2.v, /^=HYPERLINK/); assert.equal(s.K2.f, undefined);
  assert.equal(s.A5.v, 5); assert.equal(book.Sheets['시트2 결과'].L4.v, 5);
  assert.equal(JSON.stringify({ left, right }), before);
  const only = buildCompareWorkbook(left, right, comparison, { existenceOnly: true, leftImports: [0] }, XLSX);
  assert.equal(XLSX.utils.decode_range(only.Sheets['시트1 결과']['!ref']).e.c, 8);
  assert.equal(only.Sheets['시트1 결과'].E2, undefined);
});

test('1904 dates match displayed 1900 dates and export using one date system', () => {
  const old = XLSX.utils.aoa_to_sheet([['날짜'], [1]]); old.A2.z = 'yyyy-mm-dd';
  const modern = XLSX.utils.aoa_to_sheet([['날짜'], [1463]]); modern.A2.z = 'yyyy-mm-dd';
  const left = readCompareSheet(old, XLSX, 1, true), right = readCompareSheet(modern, XLSX);
  const result = compareSheets(left, right, pair);
  assert.equal(result.left.stats.found, 1);
  const book = buildCompareWorkbook(left, right, result, { rightImports: [0] }, XLSX);
  assert.equal(book.Sheets['시트1 결과'].F2.v, 1463);
  assert.equal(book.Sheets['시트2 결과'].G2.v, 1463);
  old.A2 = { t: 'n', v: 1.5, z: '[h]:mm' };
  const duration = readCompareSheet(old, XLSX, 1, true);
  const durations = compareSheets(duration, duration, pair);
  const durationBook = buildCompareWorkbook(duration, duration, durations, {}, XLSX);
  assert.equal(durationBook.Sheets['시트1 결과'].F2.v, 1.5);
  assert.equal(duration.rows[0].texts[0], '36:00');
});

test('100,000 rows use indexed matching and preserve the last result', () => {
  const rows = Array.from({ length: 100000 }, (_, index) => ({ rowNumber: index + 2, cells: [{ t: 'n', v: index }], texts: [String(index)] }));
  const left = { columns: [{ index: 0, label: '키' }], rows }, right = { ...left, rows: [...rows].reverse() };
  const result = compareSheets(left, right, pair);
  assert.equal(result.left.stats.matched, 100000); assert.equal(result.left.rows.at(-1).matchIndex, 0);
});
