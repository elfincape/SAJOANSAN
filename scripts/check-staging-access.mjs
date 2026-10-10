import { mkdir, writeFile } from 'node:fs/promises';

const stagingRef = 'yvdialfqlbpjbbmcetev';
const productionRef = 'vvrppotrnpwrwpwqaiet';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (process.env.SUPABASE_PROJECT_REF !== stagingRef || !token) {
  throw new Error('Separate staging credentials and the expected staging project are required.');
}
if (!token.startsWith('sbp_fc')) {
  throw new Error('An explicitly project-scoped Supabase token is required. Classic tokens are refused.');
}
async function request(path) {
  return fetch('https://api.supabase.com/v1/projects/' + path, {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(30000)
  });
}

const response = await request(stagingRef);
if (!response.ok) throw new Error(`Staging access failed (HTTP ${response.status}).`);
const project = await response.json();
if (project.id !== stagingRef || project.name !== 'ian-operations-staging') {
  throw new Error('Staging project identity does not match.');
}
const denied = await request(productionRef);
if (![403, 404].includes(denied.status)) {
  throw new Error('Production access must be denied to the staging token.');
}
const keysResponse = await request(stagingRef + '/api-keys?reveal=false');
if (!keysResponse.ok) throw new Error(`Public API key lookup failed (HTTP ${keysResponse.status}).`);
const keys = await keysResponse.json();
const publicKey = keys.find(key => key.type === 'publishable' || key.name === 'anon');
const value = publicKey?.api_key;
if (typeof value !== 'string' || !(value.startsWith('sb_publishable_') || publicKey.name === 'anon' && value.startsWith('eyJ'))) {
  throw new Error('A recognized public client key was not returned.');
}
if (value.startsWith('eyJ')) {
  const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
  if (claims.role !== 'anon' || claims.ref !== stagingRef) {
    throw new Error('Only the staging anonymous key may be exported.');
  }
}
await mkdir('staging-output', { recursive: true });
await writeFile('staging-output/public-config.json', JSON.stringify({
  environment: 'staging',
  url: `https://${stagingRef}.supabase.co`,
  anonKey: value
}, null, 2));
console.log('Staging identity verified; production access denied; public client config generated.');
