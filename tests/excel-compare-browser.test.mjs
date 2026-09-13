import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

// Optional browser integration: RUN_BROWSER_TESTS=1, PLAYWRIGHT_TEST_MODULE,
// XLSX_TEST_MODULE, and optionally BROWSER_EXECUTABLE / BROWSER_TEST_OUTPUT.
test('browser: upload, mapping, export, filters, invalidation, mobile and auth guard', { skip: !process.env.RUN_BROWSER_TESTS, timeout: 60000 }, async () => {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_TEST_MODULE || 'playwright');
  const XLSX = require(process.env.XLSX_TEST_MODULE || 'xlsx');
  const root = resolve('repo-root');
  const server = createServer(async (req, res) => {
    try {
      const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
      if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const content = await readFile(path);
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream');
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // Isolated auth double only; the real center integration runs below.
    await context.route('**/js/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireRole(role) { if(role !== "editor") throw Error("role"); return { display_name: "검증 사용자", role: "editor" }; }' }));
    await context.route('https://cdn.jsdelivr.net/**', async route => {
      if (route.request().url().endsWith('xlsx.full.min.js')) await route.fulfill({ contentType: 'text/javascript', body: await readFile(process.env.XLSX_TEST_MODULE) });
      else await route.fulfill({ contentType: 'text/css', body: '' });
    });
    await context.route('https://cdn.tailwindcss.com/**', async route => route.fulfill({ contentType: 'text/javascript', body: process.env.TAILWIND_TEST_MODULE ? await readFile(process.env.TAILWIND_TEST_MODULE) : '' }));
    const url = `http://127.0.0.1:${server.address().port}/admin/excel-compare.html?center=ansan`;
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById('workspace').disabled);
    assert.equal(await page.locator('a[href="/admin/?center=ansan"]').count(), 1);
    assert.equal(await page.locator('#center-switcher button').count(), 2);
    const file = (name, rows, extra = []) => {
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '데이터');
      for (const [sheetName, sheetRows] of extra) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheetRows), sheetName);
      return { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })) };
    };
    const left = file('시트1.xlsx', [['거래처', '코드', '지역', '수량'], ['가', '01', '안산', 2], ['나', '02', '부산', 3], ['다', '03', '서울', 4], ['가', '01', '안산', 5], ['가', '', '안산', 6]], [['다른 시트', [['다른 제목'], ['값']]]]);
    const right = file('시트2.xlsx', [['금액', '거래처', '코드', '메모', '기타', '지역'], [30, '나', '02', '부산값', '', '부산'], [20, '가', '01', '첫값', '', '안산'], [50, '가', '01', '둘째값', '', '안산'], [90, '라', '04', '다른값', '', '제주']]);
    await page.locator('#left-file').setInputFiles(left); await page.locator('#right-file').setInputFiles(right);
    assert.ok((await page.locator('#left-sheet').boundingBox()).height >= 36);
    await page.locator('.pair select[data-side=left]').selectOption('0'); await page.locator('.pair select[data-side=right]').selectOption('1');
    await page.locator('#add-pair').click(); await page.locator('.pair').nth(1).locator('[data-side=left]').selectOption('1'); await page.locator('.pair').nth(1).locator('[data-side=right]').selectOption('2');
    await page.locator('#add-pair').click(); await page.locator('.pair').nth(2).locator('[data-side=left]').selectOption('2'); await page.locator('.pair').nth(2).locator('[data-side=right]').selectOption('5');
    await page.locator('#left-imports input[value="0"]').check(); await page.locator('#left-imports input[value="3"]').check(); await page.locator('#right-imports input[value="3"]').check();
    await page.locator('#run-btn').click(); await page.locator('#result-section').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#preview tbody tr').count(), 5);
    assert.equal(await page.locator('#preview tbody tr').first().locator('td').last().textContent(), '첫값');
    assert.match(await page.locator('#statistics').textContent(), /조건 충족 행4/);
    const downloadPromise = page.waitForEvent('download'); await page.locator('#download-btn').click();
    const download = await downloadPromise;
    const book = XLSX.read(await readFile(await download.path()), { type: 'buffer' });
    assert.equal(book.Sheets['시트1 결과'].J2.v, 20); assert.equal(book.Sheets['시트1 결과'].B4.v, false);
    await page.locator('#result-side').selectOption('right'); assert.equal(await page.locator('#preview tbody tr').count(), 4);
    await page.locator('#result-filter').selectOption('false'); assert.equal(await page.locator('#preview tbody tr').count(), 1);
    await page.locator('#result-filter').selectOption('all');
    const out = process.env.BROWSER_TEST_OUTPUT;
    if (out) { await mkdir(out, { recursive: true }); await page.screenshot({ path: resolve(out, 'excel-compare-desktop.png'), fullPage: true }); }
    await page.locator('input[value=exists]').check(); assert.equal(await page.locator('#result-section').isVisible(), false);
    await page.locator('#run-btn').click(); await page.locator('#result-section').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#preview thead th').count(), 9);
    await page.locator('#left-header').fill(''); assert.equal(await page.locator('#result-section').isVisible(), false); assert.equal(await page.locator('#run-btn').isDisabled(), true);
    await page.locator('#left-header').fill('1'); await page.locator('#left-sheet').selectOption('다른 시트');
    assert.equal(await page.locator('.pair').count(), 1); assert.equal(await page.locator('#run-btn').isDisabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (out) await page.screenshot({ path: resolve(out, 'excel-compare-mobile.png'), fullPage: true });
    await page.locator('#right-file').setInputFiles({ name: 'broken.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]) });
    await page.waitForFunction(() => document.getElementById('right-info').textContent.includes('불러오기 실패'));
    assert.equal(await page.locator('#run-btn').isDisabled(), true);
    assert.deepEqual(errors, []);
    // A denied profile cannot enable file controls.
    await context.route('**/js/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireRole() { return null; }' }));
    await page.reload(); assert.equal(await page.locator('#left-file').isDisabled(), true);
    await context.close();
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
