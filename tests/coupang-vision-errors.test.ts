import assert from 'node:assert/strict';
import { test } from 'node:test';

let handler: (req: Request) => Promise<Response>;
const runtime = globalThis as any;
runtime.Deno = { env: { get: () => 'test-key' }, serve: (fn: typeof handler) => { handler = fn; } };
await import('../supabase/functions/coupang-vision/index.ts');
delete runtime.Deno;

async function request(upstream: Response, body: unknown = { imageBase64: 'dGVzdA==', prompt: 'test' }) {
  const originalFetch = globalThis.fetch;
  runtime.Deno = { env: { get: () => 'test-key' } };
  globalThis.fetch = async () => upstream;
  try { return await handler(new Request('https://example.test/functions/v1/coupang-vision', { method: 'POST', body: JSON.stringify(body) })); }
  finally { globalThis.fetch = originalFetch; delete runtime.Deno; }
}

test('malformed upstream HTTP 200 remains an HTTP 502 error', async () => {
  const response = await request(new Response('not JSON', {status: 200}));
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.status, 502);
  assert.equal(payload.upstreamStatus, 200);
});

test('rate limits remain visible to the one-top retry logic', async () => {
  const response = await request(new Response('{"error":{"message":"limit reached"}}', {status: 429}));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).status, 429);
});

test('non-JSON upstream rate limits preserve status 429', async () => {
  const response = await request(new Response('limit reached', {status: 429}));
  assert.equal(response.status, 429);
});

test('null request body is rejected with HTTP 400', async () => {
  const response = await request(new Response('{}'), null);
  assert.equal(response.status, 400);
});

test('valid vision response preserves the frontend text contract', async () => {
  const response = await request(new Response('{"content":[{"type":"text","text":"[]"}]}'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, '[]');
});
