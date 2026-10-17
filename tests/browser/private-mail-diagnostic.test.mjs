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
  collectCalls = 0,
  collectionFailure = false;
let collectionCode = 'DRIVE_OWNER_UNAVAILABLE',
  collectionStage = 'begin';
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
    if (url.pathname.endsWith('/private-mail-collect')) {
      collectCalls++;
      assert.equal(request.headers().authorization, 'Bearer mock-only');
      assert.deepEqual(request.postDataJSON(), { mode: 'collect' });
      await new Promise((resolve) => setTimeout(resolve, 200));
      return route.fulfill({
        status: collectionFailure ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          collectionFailure
            ? {
                error: 'PRIVATE_UPSTREAM_TEXT',
                code: collectionCode,
                stage: collectionStage,
              }
            : { ok: true, counts: { saved: 1, deferred: 3 } },
        ),
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
  await page
    .getByText('아직 개인 메일함이 구성되지 않았습니다.', { exact: true })
    .waitFor();
  const receive = page.getByRole('button', {
    name: '메일 가져오기',
    exact: true,
  });
  assert.equal(await receive.count(), 1);
  assert.equal(await page.locator('#mail-connection-diagnostic').count(), 0);
  assert.equal(await page.locator('#private-mail-folder-url').count(), 0);
  assert.equal(
    await page
      .getByRole('button', { name: /폴더 연결|폴더 확인|POP 연결/ })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByText(/비공개 폴더|DNS·TCP|보안 권한|외부 이미지와 활성/)
      .count(),
    0,
  );
  assert.equal(collectCalls, 0);
  await receive.click();
  assert.equal(await receive.isDisabled(), true);
  await page
    .locator('#quick-actions button')
    .evaluate((button) => button.click());
  await page.getByText('1건 저장 · 대기 3건', { exact: true }).waitFor();
  assert.equal(collectCalls, 1);
  assert.equal(await receive.isDisabled(), false);
  collectionFailure = true;
  await receive.click();
  await page
    .getByText('메일함 준비 실패 · DRIVE_OWNER_UNAVAILABLE', { exact: true })
    .waitFor();
  assert.equal(collectCalls, 2);
  collectionStage = 'login';
  for (const code of [
    'POP_PASSWORD_REJECTED',
    'POP_AUTH_TIMEOUT',
    'POP_MAILBOX_BUSY',
  ]) {
    collectionCode = code;
    await receive.click();
    await page
      .getByText('메일 로그인 실패 · ' + code, { exact: true })
      .waitFor();
    assert.equal(
      await page.getByText('PRIVATE_UPSTREAM_TEXT', { exact: true }).count(),
      0,
    );
  }
  assert.equal(await receive.isDisabled(), false);
  assert.equal(
    await page.getByText(/수신 설정|권한을 확인|COLLECTION_NOT/).count(),
    0,
  );
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
  await page.waitForTimeout(200);
  assert.equal(
    await page
      .getByRole('button', { name: '메일 가져오기', exact: true })
      .count(),
    0,
  );
  assert.equal(await page.locator('[data-view=mail]').isVisible(), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(
    'PASS mail UI: setup/diagnostics absent, explicit owner-only receipt, existing session, no auto request, duplicate click denied, compact success/error, desktop/mobile layout',
  );
} finally {
  await browser.close();
  await server.close();
}
