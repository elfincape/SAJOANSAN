import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../repo-root/js/config.js', import.meta.url), 'utf8')
  .replaceAll('export const ', 'const ');
function load(hostname) {
  const context = vm.createContext({ URL, location: { hostname } });
  vm.runInContext(source, context);
  return context;
}

const production = load('sajoansan.vercel.app');
assert.equal(vm.runInContext('ENV', production), 'prod');
assert.equal(vm.runInContext('SUPABASE_URL', production), 'https://vvrppotrnpwrwpwqaiet.supabase.co');
for (const host of ['localhost', '127.0.0.1', '[::1]']) {
  assert.throws(() => load(host), /별도 Supabase 연결 설정/);
}
for (const host of ['preview.vercel.app', 'sajoansan.vercel.app.example.com', '']) {
  const preview = load(host);
  assert.equal(vm.runInContext('ENV', preview), 'staging');
  assert.equal(vm.runInContext('SUPABASE_URL', preview), 'https://yvdialfqlbpjbbmcetev.supabase.co');
}
production.environments = {
  prod: { url: 'https://prod.supabase.co', anonKey: 'public' },
  dev: { url: 'https://prod.supabase.co/other', anonKey: 'different-public' },
  staging: { url: 'https://staging.supabase.co', anonKey: 'public' }
};
assert.throws(() => vm.runInContext('resolveConfig("localhost", environments)', production), /운영 Supabase/);
assert.equal(vm.runInContext('resolveConfig("preview.vercel.app", environments).environment', production), 'staging');
production.environments.dev.url = 'http://127.0.0.1:54321';
assert.equal(vm.runInContext('resolveConfig("localhost", environments).environment', production), 'dev');
production.environments.dev.url = 'http://external.example.com';
assert.throws(() => vm.runInContext('resolveConfig("localhost", environments)', production), /HTTPS/);
console.log('Deployment environment guards passed (no network requests).');
