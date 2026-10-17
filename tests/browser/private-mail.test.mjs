import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
  searches = [],
  format = 'html';
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() => {
    if (window === window.top) {
      localStorage.setItem('browser-test-session', 'active');
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text) => {
            window.__mailCopied = text;
          },
        },
      });
    }
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
      if (action === 'private-mail-detail' && body.id !== 'fixture')
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: '열람 권한이 없습니다.' }),
        });
      if (action === 'private-mail-detail')
        result = {
          message: {
            subject: '거래명세서 수신 확인',
            sender: 'sender@example.test',
            sent_at: '2026-10-17T01:00:00Z',
            files: [
              {
                index: 0,
                kind: format === 'html' ? 'html' : 'text',
                name: 'body',
                size: 100,
              },
              { index: 1, kind: 'attachment', name: 'invoice.pdf', size: 1024 },
              ...(format === 'both'
                ? [{ index: 2, kind: 'html', name: 'body', size: 100 }]
                : []),
            ],
          },
        };
      if (action === 'private-mail-download')
        return route.fulfill({
          contentType:
            format !== 'html' && body.index === 0 ? 'text/plain' : 'text/html',
          body:
            format !== 'html' && body.index === 0
              ? 'HQ 일반 본문\n<script>window.__mailExecuted=true</script>'
              : safeMailHtml(
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
  await page.locator('#detail .private-mail-text').waitFor();
  assert.match(
    await page.locator('#detail .private-mail-text').innerText(),
    /거래명세서를 첨부합니다/,
  );
  assert.equal(new URL(page.url()).searchParams.get('message'), 'fixture');
  await page.getByRole('button', { name: '본문 복사', exact: true }).click();
  const copied = await page.evaluate(() => window.__mailCopied);
  assert.match(copied, /거래명세서 수신 확인/);
  assert.match(copied, /sender@example.test/);
  assert.match(copied, /invoice.pdf/);
  assert.match(copied, /거래명세서를 첨부합니다/);
  assert.ok(!copied.includes('parent.__mailExecuted'));
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '본문 저장', exact: true }).click();
  const downloaded = await downloadEvent;
  assert.equal(downloaded.suggestedFilename(), 'mail-fixture.txt');
  assert.equal(await readFile(await downloaded.path(), 'utf8'), copied);
  await page.reload();
  await page.locator('#detail .private-mail-text').waitFor();
  await page.getByRole('button', { name: '서식 보기', exact: true }).click();
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
  await page.getByRole('button', { name: '텍스트 보기', exact: true }).click();
  await page.locator('#detail .private-mail-text').waitFor();
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
      path: fileURLToPath(
        new URL(
          '../../test-results/private-mail-' + width + '.png',
          import.meta.url,
        ),
      ),
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
  for (format of ['text', 'both']) {
    await page.reload();
    await page.locator('#detail .private-mail-text').waitFor();
    assert.match(
      await page.locator('#detail .private-mail-text').innerText(),
      /HQ 일반 본문/,
    );
    assert.equal(await page.evaluate(() => window.__mailExecuted), undefined);
    assert.equal(await page.locator('#detail script').count(), 0);
    assert.equal(
      await page
        .getByRole('button', { name: '서식 보기', exact: true })
        .count(),
      format === 'both' ? 1 : 0,
    );
    if (format === 'both') {
      await page
        .getByRole('button', { name: '서식 보기', exact: true })
        .click();
      await page.locator('iframe.private-mail-body').waitFor();
    }
  }
  await page.goto(server.url + '/portal/?view=mail&message=not-owned');
  await page
    .getByText('메일을 열지 못했습니다. 목록에서 다시 선택해 주세요.', {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator('#detail .private-mail-text').count(), 0);
  owner = false;
  await page.reload();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-view=mail]').isVisible(), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(
    'PASS browser: dot-readable text, metadata clipboard/TXT, owner-checked deep link, text/HTML modes, sandbox, no external requests/script, search/empty state, nonowner hidden, desktop/mobile no overflow',
  );
} finally {
  await browser.close();
  await server.close();
}
