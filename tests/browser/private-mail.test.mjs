import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startBrowserServer } from '../helpers/browser-server.mjs';
import { safeMailHtml } from '../../supabase/functions/onedrive-auth/private-mail.js';
const server = await startBrowserServer();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
});
const mock = await readFile(
  new URL('../fixtures/browser-supabase.mjs', import.meta.url),
  'utf8',
);
const errors = [],
  unexpected = [];
let owner = true,
  searches = [];
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    if (window === window.top)
      localStorage.setItem('browser-test-session', 'active');
  });
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin === server.url && url.pathname === '/js/supabase.js')
      return route.fulfill({
        contentType: 'text/javascript',
        body: mock.replace(
          "table === 'course_view'",
          "table === 'private_mailboxes' ? " +
            (owner ? '[{id:"fixture"}]' : '[]') +
            " : table === 'course_view'",
        ),
      });
    if (url.pathname.includes('/functions/v1/onedrive-auth/private-mail-')) {
      const action = url.pathname.split('/').at(-1),
        body = request.postDataJSON();
      let result = {};
      if (action === 'private-mail-status')
        result = {
          mailboxes: owner
            ? [{ status: 'disabled', enabled: false, account: 'fixture' }]
            : [],
        };
      if (action === 'private-mail-list') {
        searches.push(body.query);
        result = {
          messages:
            body.query === 'none'
              ? []
              : [
                  {
                    id: 'fixture',
                    subject: '거래명세서 수신 확인',
                    sender: 'sender@example.test',
                    sent_at: '2026-10-17T01:00:00Z',
                  },
                ],
          more: false,
        };
      }
      if (action === 'private-mail-detail')
        result = {
          message: {
            subject: '거래명세서 수신 확인',
            sender: 'sender@example.test',
            sent_at: '2026-10-17T01:00:00Z',
            files: [
              { index: 0, kind: 'html', name: 'body', size: 100 },
              { index: 1, kind: 'attachment', name: 'invoice.pdf', size: 1024 },
            ],
          },
        };
      if (action === 'private-mail-download')
        return route.fulfill({
          contentType: 'text/html',
          body: safeMailHtml(
            '<p>안녕하세요. 거래명세서를 첨부합니다.</p><script>parent.__mailExecuted=true</script><img src="https://tracker.test/pixel"><svg onload="parent.__mailExecuted=true"></svg>',
          ),
        });
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(result),
      });
    }
    if (url.origin === server.url && request.method() === 'GET')
      return route.continue();
    if (
      url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'cdn.jsdelivr.net'
    )
      return route.fulfill({ contentType: 'text/css', body: '' });
    unexpected.push(request.url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url + '/portal/?view=mail');
  await page
    .getByRole('heading', { name: '개인 메일함', exact: true })
    .first()
    .waitFor();
  await page.locator('#items .task-row').click();
  await page.locator('iframe.private-mail-body').waitFor();
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), '');
  assert.equal(await page.evaluate(() => window.__mailExecuted), undefined);
  assert.equal(
    await page
      .locator('iframe')
      .contentFrame()
      .locator('img,script,svg,a')
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole('button', { name: /invoice.pdf/ }).count(),
    1,
  );
  await mkdir(new URL('../../test-results/', import.meta.url), {
    recursive: true,
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 1000)
      await page.waitForFunction(
        () =>
          getComputedStyle(document.getElementById('app-sidebar')).display ===
          'none',
      );
    await page.screenshot({
      path: new URL(
        '../../test-results/private-mail-' + width + '.png',
        import.meta.url,
      ).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      'no horizontal viewport overflow',
    );
  }
  await page.getByRole('searchbox').fill('none');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await page.getByText('검색 결과가 없습니다.', { exact: true }).waitFor();
  assert.ok(searches.includes('none'));
  owner = false;
  await page.reload();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-view=mail]').isVisible(), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(
    'PASS browser: portal integration, body sandbox, no external requests/script, search/empty state, nonowner hidden, desktop/mobile no overflow',
  );
} finally {
  await browser.close();
  await server.close();
}
