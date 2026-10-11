import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { buildCoupangWorkbook } from '../repo-root/js/coupang-workbook.js';
const require = createRequire(import.meta.url);
const ExcelJS = require(process.env.EXCELJS_TEST_BUNDLE || '../staging-private/exceljs-4.4.0.cjs');
const JSZip = require(process.env.JSZIP_TEST_MODULE || 'C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/jszip');
const templateBuffer = await readFile(new URL('../repo-root/templates/sazocoupang.xlsx', import.meta.url));
const baseline = new ExcelJS.Workbook(); await baseline.xlsx.load(templateBuffer);
const baseSheet = baseline.worksheets[0];
const input = { ExcelJS, JSZip, templateBuffer, date: '2026-10-11', matches: [{ include: true,
  schedule: { centerRaw: 'ㅍㅌ2 B2B', reservationTime: '09:00' },
  match: { matchedDispatch: { driver: '시험기사', groupFill: 'FFE2F0CB' } } }],
  image: { mediaType: 'image/png', width: 1, height: 1,
    base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VLsAAAAASUVORK5CYII=' } };
const generated = await buildCoupangWorkbook(input);
assert.equal(generated.filename, '쿠팡 입문확인_20261011.xlsx');
assert.equal(generated.written, 1);
const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(generated.buffer);
const sheet = workbook.worksheets[0];
assert.equal(sheet.name, '10월11일(일요일)');
assert.equal(sheet.getCell('G3').value, '10월11일(일요일)');
assert.equal(sheet.getCell('I8').value, '평택2b2b');
assert.equal(sheet.getCell('J8').value, '시험기사');
assert.equal(sheet.getCell('I8').fill.fgColor.argb, 'FFE2F0CB');
assert.equal(sheet.getCell('J8').numFmt, '@');
assert.equal(sheet.pageSetup.orientation, baseSheet.pageSetup.orientation);
for (let row = 6; row <= 23; row++) for (const col of [7, 8]) {
  assert.deepEqual(sheet.getRow(row).getCell(col).value, baseSheet.getRow(row).getCell(col).value, 'Time table preserved');
}
const zip = await JSZip.loadAsync(generated.buffer);
assert.ok(Object.keys(zip.files).some(p => /^xl\/media\/image/.test(p)), 'Image embedded in real XLSX');
assert.ok(Object.keys(zip.files).some(p => /^xl\/drawings\/drawing/.test(p)), 'Image drawing relationship exists');
assert.ok(!(await zip.file('xl/workbook.xml').async('string')).includes('filterPrivacy="1"'));
for (const path of Object.keys(zip.files).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
  assert.ok(!(await zip.file(path).async('string')).includes('<conditionalFormatting'));
}
await assert.rejects(() => buildCoupangWorkbook({ ...input, date: '2026-02-30' }), /날짜/);
await assert.rejects(() => buildCoupangWorkbook({ ...input, matches: [] }), /배차정보/);
await assert.rejects(() => buildCoupangWorkbook({ ...input, matches: [{ ...input.matches[0], schedule: { centerRaw: '평택', reservationTime: '17:00' } }] }), /시간 없음/);
const overflow = Array.from({ length: 8 }, () => input.matches[0]);
await assert.rejects(() => buildCoupangWorkbook({ ...input, matches: overflow }), /자리 없음/);
const partial = await buildCoupangWorkbook({ ...input, matches: overflow, strict: false });
assert.equal(partial.written, 7); assert.equal(partial.errors.length, 1);
console.log('PASS: real XLSX template/date/cells/styles/image, unchanged time table, invalid-input/overflow refusal, legacy partial-download behavior');
