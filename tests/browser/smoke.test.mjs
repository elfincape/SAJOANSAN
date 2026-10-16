import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startBrowserServer } from '../helpers/browser-server.mjs';

let server;
let browser;

before(async () => {
  server = await startBrowserServer();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function isolatedPage(testContext, authenticated = false) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  testContext.after(() => context.close());
  const errors = [];
  const unexpectedRequests = [];
  const mock = await readFile(
    new URL('../fixtures/browser-supabase.mjs', import.meta.url),
    'utf8',
  );
  await context.addInitScript((authenticated) => {
    if (authenticated) localStorage.setItem('browser-test-session', 'active');
  }, authenticated);
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === server.url && url.pathname === '/js/supabase.js') {
      return route.fulfill({ contentType: 'text/javascript', body: mock });
    }
    if (url.origin === server.url && request.method() === 'GET') {
      return route.continue();
    }
    if (url.origin === 'https://cdn.tailwindcss.com') {
      return route.fulfill({ contentType: 'text/javascript', body: '' });
    }
    if (
      url.hostname === 'fonts.googleapis.com' ||
      (url.hostname === 'cdn.jsdelivr.net' &&
        url.pathname.startsWith('/gh/orioncactus/pretendard@'))
    ) {
      return route.fulfill({ contentType: 'text/css', body: '' });
    }
    unexpectedRequests.push(request.method() + ' ' + request.url());
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', (error) => {
    errors.push(error.message);
    testContext.diagnostic(error.message);
  });
  testContext.after(() => {
    assert.deepEqual(
      unexpectedRequests,
      [],
      'Unexpected requests were blocked',
    );
    assert.deepEqual(errors, [], 'No uncaught browser errors');
  });
  return page;
}

test('login rejects invalid credentials and accepts the mock account', async (testContext) => {
  const page = await isolatedPage(testContext);
  await page.goto(server.url + '/login.html');
  await page.locator('#email').fill('browser@example.test');
  await page.locator('#password').fill('wrong-password');
  await page.locator('#submit-btn').click();
  await page.waitForFunction(() =>
    document.querySelector('#form-error').textContent.trim(),
  );
  assert.equal(new URL(page.url()).pathname, '/login.html');
  await page.locator('#password').fill('browser-test-password');
  await page.locator('#submit-btn').click();
  await page.waitForURL((url) => url.pathname === '/');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('browser-test-session')),
    'active',
  );
});

for (const path of ['/?center=ansan', '/portal/?center=001']) {
  test(
    'unauthenticated access redirects to login: ' + path,
    async (testContext) => {
      const page = await isolatedPage(testContext);
      await page.goto(server.url + path);
      await page.waitForURL((url) => url.pathname === '/login.html');
      if (path.startsWith('/portal/')) {
        assert.equal(new URL(page.url()).searchParams.get('next'), path);
      }
    },
  );
}

test('dashboard loads mock course data and filters without a backend', async (testContext) => {
  const page = await isolatedPage(testContext, true);
  await page.goto(server.url + '/?center=ansan');
  await page
    .locator('#flat-view')
    .getByText('브라우저 검증 납품처', { exact: true })
    .waitFor();
  assert.match(
    await page.locator('#user-badge').textContent(),
    /브라우저 검증 사용자/,
  );
  await page.locator('#search-input').fill('존재하지않는납품처');
  await page.waitForFunction(
    () =>
      !document
        .querySelector('#flat-view')
        .textContent.includes('브라우저 검증 납품처'),
  );
  await page.locator('#search-input').fill('');
  await page
    .locator('#flat-view')
    .getByText('브라우저 검증 납품처', { exact: true })
    .waitFor();
});

test('portal loads authenticated empty state and changes list view', async (testContext) => {
  const page = await isolatedPage(testContext, true);
  await page.goto(server.url + '/portal/?center=001');
  await page.waitForFunction(
    () =>
      document.querySelector('#user').textContent === '브라우저 검증 사용자',
  );
  await page.waitForFunction(() =>
    document.querySelector('#items').textContent.trim(),
  );
  assert.equal(await page.locator('#message.error').count(), 0);
  await page
    .locator('[data-view-control="task-layout"][data-value="list"]')
    .click();
  assert.equal(
    await page
      .locator('[data-view-control="task-layout"][data-value="list"]')
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await page.locator('#message.error').count(), 0);
});
