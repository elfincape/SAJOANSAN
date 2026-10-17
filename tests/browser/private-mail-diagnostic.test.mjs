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
  calls = 0,
  collectCalls = 0,
  tlsFailure = false;
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
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, counts: { saved: 1, deferred: 3 } }),
      });
    }
    if (url.pathname.endsWith('/private-mail-diagnostic')) {
      calls++;
      assert.equal(request.method(), 'POST');
      assert.equal(request.headers().authorization, 'Bearer mock-only');
      assert.deepEqual(request.postDataJSON(), {});
      await new Promise((resolve) => setTimeout(resolve, 200));
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: !tlsFailure,
          ...(tlsFailure
            ? {
                code: 'TLS_FAILED',
                tls_phase: 'TLS_HANDSHAKE',
                tls_error: 'CERT_TRUST',
              }
            : {}),
          execution_region: 'ap-northeast-2',
          execution_platform: 'vercel-node',
          ...(!tlsFailure
            ? {
                tls_protocol: 'TLSv1.2',
                tls_cipher: 'TLS_RSA_WITH_AES_256_GCM_SHA384',
              }
            : {}),
          stages: {
            dns: 'ok',
            tcp: 'ok',
            tls: tlsFailure ? 'failed' : 'ok',
            greeting: tlsFailure ? 'pending' : 'ok',
          },
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
  await page.getByText('TLS 연결/검증 · 성공', { exact: true }).waitFor();
  await page.getByText('실행 환경 · vercel-node', { exact: true }).waitFor();
  await page.getByText('TLS 버전 · TLSv1.2', { exact: true }).waitFor();
  await page
    .getByText('TLS 암호군 · TLS_RSA_WITH_AES_256_GCM_SHA384', { exact: true })
    .waitFor();
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
  assert.equal(collectCalls, 0);
  const receive = page.getByRole('button', {
    name: '메일 1회 수신',
    exact: true,
  });
  await receive.click();
  assert.equal(await receive.isDisabled(), true);
  await page
    .getByText('저장 1건 · 다음 배치 대기 3건. 목록을 새로고침해 주세요.', {
      exact: true,
    })
    .waitFor();
  assert.equal(collectCalls, 1);
  tlsFailure = true;
  await button.click();
  await page.getByText('TLS 연결/검증 · 실패', { exact: true }).waitFor();
  await page
    .getByText('TLS 실패 지점 · TLS_HANDSHAKE', { exact: true })
    .waitFor();
  await page.getByText('TLS 오류 분류 · CERT_TRUST', { exact: true }).waitFor();
  await page.getByText('실행 지역 · ap-northeast-2', { exact: true }).waitFor();
  owner = false;
  await page.reload();
  await page.locator('#portal-title').waitFor();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#mail-connection-diagnostic').count(), 0);
  assert.equal(await page.locator('[data-view=mail]').isVisible(), false);
  assert.equal(calls, 2);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(
    'PASS diagnostic UI: configured owner without mailbox row, no automatic probe, existing session request, double-click prevention, staged results, nonowner hidden, desktop/mobile layout',
  );
} finally {
  await browser.close();
  await server.close();
}
