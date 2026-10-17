import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startBrowserServer } from '../helpers/browser-server.mjs';
import { OWNER_ID } from '../../supabase/functions/private-mail-diagnostic/handler.js';
const server = await startBrowserServer(),
  browser = await chromium.launch({ headless: true });
const source = await readFile(
  new URL('../fixtures/browser-supabase.mjs', import.meta.url),
  'utf8',
);
let owner = true,
  calls = 0;
const errors = [],
  unexpected = [];
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(() =>
    localStorage.setItem('browser-test-session', 'active'),
  );
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin === server.url && url.pathname === '/js/supabase.js')
      return route.fulfill({
        contentType: 'text/javascript',
        body: source.replace(
          "id: 'browser-test-user'",
          "id: '" + (owner ? OWNER_ID : 'browser-test-user') + "'",
        ),
      });
    if (url.pathname.endsWith('/private-mail-diagnostic')) {
      calls++;
      assert.equal(request.method(), 'POST');
      assert.equal(request.headers().authorization, 'Bearer mock-only');
      assert.deepEqual(request.postDataJSON(), {});
      await new Promise((resolve) => setTimeout(resolve, 200));
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          stages: { dns: 'ok', tcp: 'ok', tls: 'ok', greeting: 'ok' },
          checked_at: '2026-10-17T00:00:00Z',
        }),
      });
    }
    if (url.pathname.endsWith('/private-mail-status'))
      return route.fulfill({
        contentType: 'application/json',
        body: '{"mailboxes":[]}',
      });
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
  const button = page.getByRole('button', {
    name: '클라우드 POP 연결 확인',
    exact: true,
  });
  await button.waitFor();
  assert.equal(calls, 0);
  assert.ok(
    (await page.locator('#mail-connection-diagnostic').textContent()).includes(
      '클라우드 연결 미검증',
    ),
  );
  await button.click();
  assert.equal(await button.isDisabled(), true);
  await page.evaluate(() =>
    document.querySelector('#mail-connection-diagnostic button').click(),
  );
  await page.getByText('TLS 인증서 검증 · 성공', { exact: true }).waitFor();
  assert.equal(calls, 1);
  assert.equal(await button.isDisabled(), false);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  owner = false;
  await page.reload();
  await page.locator('#portal-title').waitFor();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#mail-connection-diagnostic').count(), 0);
  assert.equal(await page.locator('[data-view=mail]').isVisible(), false);
  assert.equal(calls, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(
    'PASS diagnostic UI: configured owner without mailbox row, no automatic probe, existing session request, double-click prevention, staged results, nonowner hidden, desktop/mobile layout',
  );
} finally {
  await browser.close();
  await server.close();
}
