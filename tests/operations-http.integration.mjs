import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const ref = process.env.SUPABASE_PROJECT_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
if (ref !== 'yvdialfqlbpjbbmcetev' || !token?.startsWith('sbp_fc')) throw Error('Staging only');
const root = `https://${ref}.supabase.co`;
async function management(path, body) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) throw Error(`Management HTTP ${r.status}`);
  return r.json();
}
const keys = await management('api-keys?reveal=true');
const adminKey = keys.find(k => k.name === 'service_role')?.api_key ?? keys.find(k => k.type === 'secret')?.api_key;
const publicKey = keys.find(k => k.type === 'publishable')?.api_key ?? keys.find(k => k.name === 'anon')?.api_key;
if (!adminKey || !publicKey) throw Error('Staging HTTP credentials unavailable');
const users = [], tasks = [];
async function http(path, { method = 'GET', body, jwt, admin = false } = {}) {
  const key = admin ? adminKey : publicKey;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (jwt || admin) headers.Authorization = `Bearer ${jwt ?? adminKey}`;
  return fetch(root + path, { method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000) });
}
try {
  for (const center of ['001', '002', '001', null]) {
    const email = `operations-http-${randomUUID()}@example.invalid`, password = randomUUID() + 'Aa1!';
    const created = await http('/auth/v1/admin/users', { admin: true, method: 'POST', body: { email, password, email_confirm: true } });
    assert.equal(created.status, 200, 'Create isolated auth fixture');
    const user = await created.json();
    assert.match(user.id, /^[0-9a-f-]{36}$/);
    users.push(user.id);
    await management('database/query', { query: `insert into public.user_profiles(id,email,role) values('${user.id}','${email}','${center ? 'editor' : 'admin'}'); ${center ? `insert into public.operations_center_members(user_id,center_code) values('${user.id}','${center}');` : ''}` });
    const login = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    assert.equal(login.status, 200, 'Real password login');
    user.jwt = (await login.json()).access_token;
    user.center = center;
    users[users.length - 1] = user;
  }
  const [ansan, pyeongtaek, nextOwner, hq] = users;
  const request = { p_request_id: randomUUID(), p_task_id: null, p_expected_version: null,
    p_center: '001', p_title: 'HTTP 시험 업무', p_work_date: '2026-10-11', p_inputs: {}, p_status: 'pending' };
  const create = await http('/rest/v1/rpc/operations_save_task', { method: 'POST', jwt: ansan.jwt, body: request });
  assert.equal(create.status, 200, 'Authenticated task creation');
  const task = await create.json(); tasks.push(task.id);
  const retry = await http('/rest/v1/rpc/operations_save_task', { method: 'POST', jwt: ansan.jwt, body: request });
  assert.equal(retry.status, 200); assert.equal((await retry.json()).id, task.id);
  const denied = await http('/rest/v1/rpc/operations_save_task', { method: 'POST', jwt: pyeongtaek.jwt,
    body: { ...request, p_request_id: randomUUID(), p_task_id: task.id, p_expected_version: 1, p_status: 'completed' } });
  assert.equal(denied.status, 403, 'Other center cannot mutate');
  const handoff = await http('/rest/v1/rpc/operations_task_action', { method: 'POST', jwt: ansan.jwt,
    body: { p_request_id: randomUUID(), p_task_id: task.id, p_expected_version: 1, p_action: 'handoff',
      p_data: { owner_id: nextOwner.id, memo: '다음 담당자 확인' } } });
  assert.equal(handoff.status, 200); assert.equal((await handoff.json()).owner_id, nextOwner.id);
  const incidentRequest = { p_request_id: randomUUID(), p_incident_id: null, p_expected_version: null,
    p_action: 'create', p_data: { center_code: '001', title: '배차 지연', kind: '차량 섭외 지연', task_id: task.id } };
  const incidentCreated = await http('/rest/v1/rpc/operations_incident_action', { method: 'POST', jwt: ansan.jwt, body: incidentRequest });
  assert.equal(incidentCreated.status, 200);
  let incident = await incidentCreated.json();
  for (const [actor, action, data] of [[ansan, 'request_support', {}], [hq, 'support', { note: '대체 차량 섭외 확인', done: true }],
    [pyeongtaek, 'resolve', {}], [pyeongtaek, 'reopen', {}]]) {
    const r = await http('/rest/v1/rpc/operations_incident_action', { method: 'POST', jwt: actor.jwt,
      body: { p_request_id: randomUUID(), p_incident_id: incident.id, p_expected_version: incident.version, p_action: action, p_data: data } });
    assert.equal(r.status, 200, action);
    incident = await r.json();
    if (action === 'support') assert.equal(incident.status, 'open', 'HQ support does not resolve');
  }
  assert.equal(incident.status, 'open'); assert.equal(incident.task_id, task.id);
  const complete = await http('/rest/v1/rpc/operations_save_task', { method: 'POST', jwt: nextOwner.jwt,
    body: { ...request, p_request_id: randomUUID(), p_task_id: task.id, p_expected_version: 2, p_status: 'completed' } });
  assert.equal(complete.status, 200); assert.equal((await complete.json()).completed_by, nextOwner.id);
  const logs = await http(`/rest/v1/operations_daily_log?task_id=eq.${task.id}`, { jwt: ansan.jwt });
  assert.equal(logs.status, 200); assert.equal((await logs.json()).length, 3);
  const anonymous = await http(`/rest/v1/operations_tasks?id=eq.${task.id}`);
  assert.ok([401, 403].includes(anonymous.status), 'Anonymous blocked');
  console.log('PASS: real login → creation/retry → center denial → same task handoff → same incident/HQ action → other-center resolve/reopen → completion/daily log → anonymous denial');
} finally {
  const ids = users.map(u => typeof u === 'string' ? u : u.id);
  if (ids.length) {
    const literals = ids.map(id => `'${id}'`).join(',');
    await management('database/query', { query: `begin;
      delete from public.operations_task_events where actor_id in (${literals});
      delete from public.operations_incidents where created_by in (${literals});
      delete from public.operations_tasks where created_by in (${literals});
      delete from public.operations_center_members where user_id in (${literals});
      delete from public.user_profiles where id in (${literals}); commit;` });
    for (const id of ids) {
      const removed = await http(`/auth/v1/admin/users/${id}`, { admin: true, method: 'DELETE' });
      assert.equal(removed.status, 200, 'Remove staging auth fixture');
    }
    console.log('Staging HTTP fixtures removed.');
  }
}
