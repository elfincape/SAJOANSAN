// Verify exact staging content scope before registering server configuration.
const ref = process.env.SUPABASE_PROJECT_REF, access = process.env.SUPABASE_ACCESS_TOKEN;
const notion = process.env.OPERATIONS_NOTION_TOKEN;
if (ref !== 'yvdialfqlbpjbbmcetev' || !access?.startsWith('sbp_fc') || !notion) throw Error('Staging configuration required');
const root = '3f5b98bf-5f20-8174-aea9-e2967e4d678d';
const taskSource = '910d7f0f-7ca6-496a-90a0-1ef44b4dc262';
const incidentSource = 'dd440c37-755e-4073-85ba-666c4a2c2bc2';
const identityResponse = await fetch('https://api.notion.com/v1/users/me', { headers: {
  Authorization: `Bearer ${notion}`, 'Notion-Version': '2025-09-03'
}, signal: AbortSignal.timeout(30000) });
if (!identityResponse.ok) throw Error(`Integration identity HTTP ${identityResponse.status}`);
const identity = await identityResponse.json();
if (identity.name !== '이안 운영 STAGING') throw Error('Unexpected Notion integration identity');
console.log('Notion integration identity verified:', identity.name, identity.bot?.workspace_name ?? '');
async function check(path, allowed) {
  const r = await fetch('https://api.notion.com/v1/' + path, { headers: {
    Authorization: `Bearer ${notion}`, 'Notion-Version': '2025-09-03'
  }, signal: AbortSignal.timeout(30000) });
  if (allowed ? !r.ok : ![403, 404].includes(r.status)) {
    const detail = await r.json().catch(() => ({}));
    throw Error(`Content scope check failed: ${path} HTTP ${r.status} ${detail.code ?? ''} ${detail.message ?? ''}`);
  }
  return r;
}
await check('pages/' + root, true);
await check('data_sources/' + taskSource, true);
await check('data_sources/' + incidentSource, true);
await check('pages/3f4b98bf-5f20-81c2-992e-fecda52668d7', false);
await check('data_sources/8882bcc6-45ef-435d-87f8-b9ccfdec5c1a', false);
const values = { OPERATIONS_NOTION_TOKEN: notion, OPERATIONS_NOTION_ROOT: root,
  OPERATIONS_NOTION_TASK_SOURCE: taskSource, OPERATIONS_NOTION_INCIDENT_SOURCE: incidentSource,
  OPERATIONS_ENVIRONMENT: 'staging' };
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
  method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(Object.entries(values).map(([name, value]) => ({ name, value }))),
  signal: AbortSignal.timeout(30000)
});
if (!r.ok) throw Error(`Staging configuration HTTP ${r.status}`);
console.log('Staging Notion pages readable; production pages denied; server configuration registered.');
