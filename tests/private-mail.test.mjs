import assert from 'node:assert/strict';
{
  const { providerModels, modelCapabilities, handleApiManagement } =
    await import('../supabase/functions/_shared/ai-providers.js');
  let requests = 0,
    writes = 0;
  const env = {
    AIAPIFLOW_API_KEY: 'PRIVATE_FLOW_KEY_SENTINEL',
    OPENAI_API_KEY: 'PRIVATE_OPENAI_KEY_SENTINEL',
  };
  const fetcher = async (url, options) => {
    requests++;
    assert.ok(
      [
        'https://aiapiflow.com/v1/models',
        'https://api.openai.com/v1/models',
      ].includes(url),
    );
    assert.equal(options.redirect, 'error');
    assert.ok(options.headers.authorization.startsWith('Bearer '));
    return Response.json({
      data: [
        { id: 'gpt-5.6-luna' },
        { id: 'gpt-6-luna' },
        { id: 'claude-haiku-4-5-20251001' },
        { id: 'text-embedding-3-small' },
        { id: 'unknown-vendor-model' },
        { id: 'gpt-6-luna' },
        { id: '<script>PRIVATE_INVALID</script>', owned_by: 'PRIVATE_ACCOUNT' },
      ],
    });
  };
  const unconfigured = await providerModels('openai', {}, () =>
    assert.fail('unconnected catalog must not fetch'),
  );
  assert.equal(unconfigured.catalogStatus, 'not_configured');
  assert.equal(unconfigured.models[0].available, false);
  const catalog = await providerModels('openai', env, fetcher);
  assert.equal(
    catalog.models.filter((item) => item.id === 'gpt-6-luna').length,
    1,
  );
  assert.equal(
    catalog.models.find((item) => item.id === 'text-embedding-3-small').support,
    'unsupported',
  );
  assert.equal(
    catalog.models.find((item) => item.id === 'unknown-vendor-model').support,
    'unknown',
  );
  for (const value of Object.values(env))
    assert.ok(!JSON.stringify(catalog).includes(value));
  assert.ok(!JSON.stringify(catalog).includes('PRIVATE_ACCOUNT'));
  assert.equal(modelCapabilities('openai', 'claude-haiku-4-5-20251001'), null);
  await assert.rejects(
    () => providerModels('__proto__', env, fetcher),
    /AI_PROVIDER_INVALID/,
  );
  assert.equal(
    (
      await providerModels('openai', env, async () =>
        Response.json({ error: 'PRIVATE_SECRET_ERROR' }, { status: 401 }),
      )
    ).catalogStatus,
    'access_denied',
  );
  let current = {
    provider: 'aiapiflow',
    model: 'gpt-5.6-luna',
    protocol: 'responses',
    revision: 2,
  };
  const ctx = {
    env,
    fetcher,
    json: Response.json,
    db: async (path, options) => {
      if (path.startsWith('onedrive_settings?'))
        return [{ ai_defaults: current }];
      assert.equal(path, 'rpc/onedrive_ai_default_save');
      writes++;
      if (options.body.p_revision !== current.revision)
        throw Error('AI_CONFIG_CHANGED');
      current = {
        provider: options.body.p_provider,
        model: options.body.p_model,
        protocol: options.body.p_protocol,
        revision: current.revision + 1,
      };
      return current;
    },
  };
  const before = requests;
  await assert.rejects(
    () => handleApiManagement('api-admin-status', {}, { role: 'editor' }, ctx),
    /ADMIN_REQUIRED/,
  );
  assert.equal(requests, before);
  const response = await handleApiManagement(
    'api-admin-default',
    { provider: 'openai', model: 'gpt-6-luna', revision: 2 },
    { role: 'admin', id: 'owner' },
    ctx,
  );
  assert.equal((await response.json()).default.provider, 'openai');
  assert.equal(current.protocol, 'responses');
  await assert.rejects(
    () =>
      handleApiManagement(
        'api-admin-default',
        { provider: 'openai', model: 'gpt-6-luna', revision: 2 },
        { role: 'admin', id: 'owner' },
        ctx,
      ),
    /AI_CONFIG_CHANGED/,
  );
  await assert.rejects(
    () =>
      handleApiManagement(
        'api-admin-default',
        { provider: 'openai', model: 'text-embedding-3-small', revision: 3 },
        { role: 'admin', id: 'owner' },
        ctx,
      ),
    /AI_MODEL_UNSUPPORTED/,
  );
  await assert.rejects(
    () =>
      handleApiManagement(
        'api-admin-default',
        { provider: 'openai', model: 'gpt-6-luna', revision: 3 },
        { role: 'admin', id: 'owner' },
        { ...ctx, fetcher: async () => Response.json({ data: [] }) },
      ),
    /AI_MODEL_UNAVAILABLE/,
  );
  assert.equal(modelCapabilities('openai', 'gpt-4o-search-preview'), null);
  assert.equal(modelCapabilities('openai', 'gpt-4o-mini-search-preview'), null);
  assert.equal(modelCapabilities('aiapiflow', 'claude-3-haiku-20240307'), null);
  assert.equal(modelCapabilities('aiapiflow', 'claude-3-opus-20240229'), null);
  assert.equal(current.model, 'gpt-6-luna');
  assert.equal(writes, 2);
  console.log(
    'PASS API admin: safe catalog/no paid requests, provider isolation, unavailable/unsupported states, admin fence, default save and stale revision rejection',
  );
}
{
  const { handleMailAutomation } =
    await import('../supabase/functions/onedrive-auth/private-mail-background.js');
  const owner = '2a828c2d-9a6f-40d4-8e13-336b591811cc',
    mailbox = '39045005-313e-42e1-b50c-2394b3b6ff26',
    source = '00000000-0000-4000-8000-000000000001';
  const calls = [];
  const ctx = {
    json: Response.json,
    fail: (message, status) => Object.assign(Error(message), { status }),
    db: async (path, options) => {
      if (path.startsWith('private_mailboxes?'))
        return [{ id: mailbox, owner_id: owner, automation_config: {} }];
      calls.push({ path, body: options.body });
      return true;
    },
  };
  for (const reference of [true, false]) {
    const result = await handleMailAutomation(
      'private-mail-intent-correction',
      { id: source, reference },
      { id: owner },
      ctx,
    );
    assert.equal((await result.json()).saved, true);
    assert.deepEqual(calls.at(-1), {
      path: 'rpc/private_mail_intent_correct',
      body: { p_message: source, p_user: owner, p_reference: reference },
    });
  }
  await assert.rejects(
    () =>
      handleMailAutomation(
        'private-mail-intent-correction',
        { id: source, reference: 'true' },
        { id: owner },
        ctx,
      ),
    /CORRECTION_INVALID/,
  );
  await assert.rejects(
    () =>
      handleMailAutomation(
        'private-mail-intent-correction',
        { id: source, reference: true },
        { id: 'other' },
        ctx,
      ),
    /OWNER_REQUIRED/,
  );
  assert.equal(
    calls.length,
    2,
    'correction invokes only scoped RPC, never model or collection',
  );
}
import { callLuna, LUNA_MODEL } from '../supabase/functions/_shared/luna.js';
{
  let calls = 0;
  const result = await callLuna({
    provider: 'aiapiflow',
    model: 'claude-haiku-4-5-20251001',
    key: 'mock-anthropic',
    prompt: 'public fixture',
    images: [{ mediaType: 'image/png', data: 'AA==' }],
    schemaName: 'fixture',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, 'https://aiapiflow.com/v1/messages');
      assert.equal(options.headers['x-api-key'], 'mock-anthropic');
      assert.equal(options.headers.authorization, undefined);
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'claude-haiku-4-5-20251001');
      assert.equal(body.messages[0].content[0].type, 'image');
      assert.ok(
        body.messages[0].content[1].text.includes(
          '"additionalProperties":false',
        ),
      );
      return Response.json({
        model: body.model,
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"ok":true}' }],
        usage: { input_tokens: 10, output_tokens: 4 },
      });
    },
  });
  assert.equal(result.content[0].text, '{"ok":true}');
  assert.equal(calls, 1);
  assert.equal(result.provider, 'aiapiflow');
  await assert.rejects(
    () =>
      callLuna({
        provider: 'openai',
        model: 'text-embedding-3-small',
        key: 'mock',
        prompt: 'fixture',
        fetcher: () => assert.fail('unsupported model must never transmit'),
      }),
    /AI_MODEL_UNSUPPORTED/,
  );
  console.log(
    'PASS Anthropic adapter: distinct endpoint/header/image/schema prompt, normalized response, no unsupported model request',
  );
}
{
  const { OPENAI_LUNA_MODEL, mailAiConfiguration, lunaInference } =
    await import('../supabase/functions/_shared/luna.js');
  const legacy = 'mock-legacy-key',
    official = 'mock-official-key';
  assert.deepEqual(mailAiConfiguration({ AIAPIFLOW_API_KEY: legacy }), {
    aiKey: legacy,
    aiProvider: 'aiapiflow',
  });
  assert.deepEqual(
    mailAiConfiguration({
      PRIVATE_MAIL_AI_PROVIDER: 'openai',
      OPENAI_API_KEY: official,
      AIAPIFLOW_API_KEY: legacy,
    }),
    { aiKey: official, aiProvider: 'openai' },
  );
  const missing = mailAiConfiguration({
    PRIVATE_MAIL_AI_PROVIDER: 'openai',
    AIAPIFLOW_API_KEY: legacy,
  });
  assert.equal(
    missing.aiKey,
    undefined,
    'official configuration never falls back to another provider key',
  );
  assert.equal(
    mailAiConfiguration({
      PRIVATE_MAIL_AI_PROVIDER: 'arbitrary',
      OPENAI_API_KEY: official,
    }).aiKey,
    undefined,
  );
  await assert.rejects(
    () =>
      callLuna({
        provider: missing.aiProvider,
        key: missing.aiKey,
        prompt: 'fixture',
        fetcher: () => assert.fail('missing official key must not transmit'),
      }),
    /AI_NOT_CONFIGURED/,
  );
  let requests = 0;
  const response = await callLuna({
    provider: 'openai',
    key: official,
    prompt: 'public fixture only',
    images: [{ mediaType: 'image/png', data: 'AA==' }],
    schemaName: 'fixture',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    fetcher: async (url, options) => {
      requests++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.authorization, 'Bearer ' + official);
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.equal(body.model, OPENAI_LUNA_MODEL);
      assert.equal(body.store, false);
      assert.deepEqual(body.text.format, { type: 'json_object' });
      assert.ok(
        body.input[0].content[0].text.includes('mandatory output contract'),
      );
      assert.equal(body.input[0].content[1].type, 'input_image');
      const result = await lunaResponseFixture([
        { type: 'text', text: '{"ok":true}' },
      ]).json();
      result.model = OPENAI_LUNA_MODEL;
      return Response.json(result);
    },
  });
  assert.equal(requests, 1);
  assert.equal(lunaInference(response).provider, 'openai');
  assert.equal(lunaInference(response).model, 'gpt-6-luna');
  assert.equal(response.content[0].text, '{"ok":true}');
  console.log(
    'PASS official OpenAI Responses: explicit server selection, separate key, fixed endpoint/model, text/image/schema, provenance, no fallback or live call',
  );
}
function lunaResponseFixture(content, stopReason = 'end_turn') {
  return Response.json({
    model: LUNA_MODEL,
    status:
      stopReason === 'end_turn'
        ? 'completed'
        : stopReason === 'max_tokens'
          ? 'incomplete'
          : stopReason,
    incomplete_details:
      stopReason === 'max_tokens' ? { reason: 'max_output_tokens' } : null,
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: content.map((block) =>
          block?.type === 'text'
            ? { type: 'output_text', text: block.text }
            : block,
        ),
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
}
import {
  handlePrivateMail,
  safeMailHtml,
  mailFilename,
} from '../supabase/functions/onedrive-auth/private-mail.js';
import {
  makeHandler,
  fail,
  hash,
} from '../supabase/functions/onedrive-auth/handler.js';
const owner = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002',
  id = '00000000-0000-4000-8000-000000000003',
  lease = '00000000-0000-4000-8000-000000000004';
const box = {
  id,
  owner_id: owner,
  enabled: true,
  drive_id: 'drive',
  folder_id: 'private',
  lease,
  lease_until: new Date(Date.now() + 600000).toISOString(),
  cutoff_at: '2026-09-01T00:00:00Z',
};
const original = new TextEncoder().encode(
  'Date: Sat, 17 Oct 2026 01:00:00 +0000\r\nSubject: sample\r\n\r\nhello\r\n',
);
const fingerprint = Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', original)),
  (v) => v.toString(16).padStart(2, '0'),
).join('');
const m = {
  uidl: 'a'.repeat(64),
  hash: fingerprint,
  subject: 'sample',
  sender: 'sender@example.test',
  sent: '2026-10-17T01:00:00Z',
  files: [
    {
      kind: 'eml',
      name: 'original.eml',
      data: Buffer.from(original).toString('base64'),
    },
    {
      kind: 'html',
      name: 'html',
      data: Buffer.from(
        '<p>Hi</p><img src="https://tracker.test"><script>alert(1)</script>',
      ).toString('base64'),
    },
    {
      kind: 'attachment',
      name: '../../evil.exe',
      data: Buffer.from('MZ').toString('base64'),
    },
  ],
};
const json = (b) =>
    new Response(JSON.stringify(b), {
      headers: { 'Cache-Control': 'no-store' },
    }),
  items = new Map();
let row = null,
  failPublish = true,
  puts = 0,
  reads = 0,
  corrupt = false,
  shared = false,
  sharedItem = false;
async function db(path, opts = {}) {
  if (path.startsWith('onedrive_locks?')) return [{ holder: lease }];
  if (path.startsWith('private_mailboxes?'))
    return opts.token === 'other' ? [] : [structuredClone(box)];
  if (path.startsWith('private_mail_messages?'))
    return row && opts.token !== 'other' ? [structuredClone(row)] : [];
  if (path === 'rpc/private_mail_publish') {
    if (failPublish) throw fail('DB unavailable', 502);
    row = {
      id,
      mailbox_id: id,
      owner_id: owner,
      subject: m.subject,
      sender: m.sender,
      sent_at: m.sent,
      files: opts.body.p_files,
    };
    return id;
  }
  throw Error('Unexpected DB ' + path);
}
async function graph(path, access, opts = {}) {
  assert.equal(access, 'access');
  if (path.startsWith('/me/drive'))
    return json({ id: 'drive', owner: { user: { id: 'drive-owner' } } });
  if (path.startsWith('/drives/drive/items/private?'))
    return json({
      id: 'private',
      folder: {},
      parentReference: { driveId: 'drive' },
    });
  if (path.endsWith('/permissions'))
    return json({
      value:
        shared || (sharedItem && !path.includes('/items/private/'))
          ? [{ link: { scope: 'anonymous' } }]
          : [],
    });
  if (path.startsWith('/drives/drive/items/private?'))
    return json({ id: 'private', folder: {} });
  if (path.includes('/content') && opts.method !== 'PUT') {
    reads++;
    const item = [...items.values()].find((i) =>
      path.includes('/items/' + i.id + '/'),
    );
    return new Response(corrupt ? new Uint8Array([1]) : item.bytes);
  }
  if (path.includes('private:/')) {
    const name = decodeURIComponent(path.split('private:/')[1].split(':/')[0]);
    if (opts.method === 'PUT') {
      assert.ok(!items.has(name));
      puts++;
      const item = {
        id: 'item' + puts,
        name,
        size: opts.body.length,
        file: {},
        parentReference: { id: 'private', driveId: 'drive' },
        bytes: opts.body,
      };
      items.set(name, item);
      return json(item);
    }
    return items.has(name) ? json(items.get(name)) : null;
  }
  const item = [...items.values()].find((i) => path.endsWith('/items/' + i.id));
  if (item) return json(item);
  throw Error('Unexpected Graph ' + path);
}
const ctx = {
  collectorMailboxId: id,
  db,
  graph,
  connected: async () => ({ accessToken: 'access' }),
  settings: async () => ({ expected_drive_id: 'drive' }),
  withLock: (f) => f(lease),
  json,
  fail,
  hash,
  fetcher: () => {
    throw Error('unexpected fetch');
  },
};
const request = (body) =>
  new Request('https://example.test/private-mail-sync', {
    method: 'POST',
    body: JSON.stringify(body),
  });
const ingest = () =>
  handlePrivateMail(
    'private-mail-sync',
    request({ operation: 'ingest', mailbox: id, lease, message: m }),
    {},
    ctx,
  );
await assert.rejects(ingest, /DB unavailable/);
assert.equal(row, null);
assert.equal(puts, 3);
assert.equal(reads, 3);
failPublish = false;
await ingest();
assert.equal(puts, 3);
assert.equal(reads, 6);
assert.equal(row.files.length, 3);
await ingest();
assert.equal(puts, 3);
assert.equal(reads, 6, 'published UIDL skips storage');
const user = { id: owner, token: 'owner' },
  outsider = { id: other, token: 'other' };
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-download',
      request({ id, index: 0 }),
      outsider,
      ctx,
    ),
  (e) => e.status === 403,
);
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-detail',
      request({ id }),
      { id: other, token: 'owner' },
      ctx,
    ),
  (e) => e.status === 403,
  'explicit UUID check even if mock RLS errs',
);
{
 const original=row;
 row={...row,received_at:null,analysis:{summary:[{text:'가상센터가 월간 마감자료를 전달했습니다.'}],source:{envelope:{to:[{address:'owner@example.test',name:'담당자'}],cc:[]}}}};
 const detail=await (await handlePrivateMail('private-mail-detail',request({id}),user,ctx)).json();
 assert.equal(detail.message.received_at,null,'unknown received header must not be replaced with collection time');
 assert.deepEqual(detail.message.summary,['가상센터가 월간 마감자료를 전달했습니다.']);
 assert.deepEqual(detail.message.recipients.to,['담당자 <owner@example.test>']);
 assert(!('analysis' in detail.message),'detail returns display context without raw model/evidence payload');
 row=original;
}
const res = await handlePrivateMail(
    'private-mail-download',
    request({ id, index: 1 }),
    user,
    ctx,
  ),
  html = await res.text();
assert.ok(!/<(?:img|script|iframe|style|svg|form)\b/i.test(html));
assert.ok(!/\son\w+=/i.test(html));
assert.equal(res.headers.get('cache-control'), 'no-store');
assert.match(res.headers.get('content-security-policy'), /sandbox/);
assert.equal(mailFilename('../../evil.exe'), 'evil.exe.download');
assert.equal(mailFilename('bill.pdf'), 'bill.pdf');
corrupt = true;
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-download',
      request({ id, index: 0 }),
      user,
      ctx,
    ),
  (e) => e.status === 409,
);
corrupt = false;
shared = true;
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-download',
      request({ id, index: 0 }),
      user,
      ctx,
    ),
  (e) => e.status === 409,
);
shared = false;
sharedItem = true;
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-download',
      request({ id, index: 0 }),
      user,
      ctx,
    ),
  (e) => e.status === 409,
);
sharedItem = false;
const publishedRow = row;
row = null;
sharedItem = true;
await assert.rejects(ingest, (e) => e.status === 409);
assert.equal(row, null);
assert.equal(puts, 3);
sharedItem = false;
row = publishedRow;
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-sync',
      request({ operation: 'begin', mailbox: other }),
      {},
      ctx,
    ),
  (e) => e.status === 403,
);
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-sync',
      request({ operation: 'begin', mailbox: id }),
      {},
      { ...ctx, collectorMailboxId: undefined },
    ),
  (e) => e.status === 503,
);
box.lease_until = '2000-01-01';
await assert.rejects(ingest, (e) => e.status === 409);
box.lease_until = new Date(Date.now() + 600000).toISOString();
const safe = safeMailHtml(
  '<svg/onload=alert(1)><p style="background:url(https://tracker)">ok</p><a href="javascript:alert(1)">x</a>',
);
assert.ok(!/<svg|<a\b|\sstyle=/i.test(safe));
assert.match(safe, /<p>ok<\/p>/);
let authCalls = 0;
const handler = makeHandler(
  {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'server',
    SUPABASE_ANON_KEY: 'anon',
  },
  async () => {
    authCalls++;
    throw Error('must not fetch');
  },
);
assert.equal(
  (
    await handler(
      new Request(
        'https://db.test/functions/v1/onedrive-auth/private-mail-sync',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer invalid' },
          body: '{}',
        },
      ),
    )
  ).status,
  403,
);
assert.equal(authCalls, 0);
console.log(
  'PASS private mail: partial publish recovery, immutable verified files, UIDL duplicates, lease expiry, UUID denial, corrupt content, safe HTML/filenames, disabled collector authentication',
);

const collectionOwner = {
  id: '2a828c2d-9a6f-40d4-8e13-336b591811cc',
  token: 'owner',
  role: 'admin',
};
let collectionBox = {
  id,
  owner_id: collectionOwner.id,
  enabled: true,
  lease,
  lease_until: new Date(Date.now() + 600000).toISOString(),
  last_counts: {},
  cutoff_at: '2026-09-01T00:00:00Z',
};
const controlContext = {
  ...ctx,
  ownerSync: true,
  collectorMailboxId: id,
  db: async (path, options = {}) => {
    if (path.startsWith('private_mailboxes?')) {
      if (options.method === 'PATCH')
        Object.assign(collectionBox, options.body);
      return [structuredClone(collectionBox)];
    }
    if (path.startsWith('private_mail_messages?'))
      return [{ uidl_hash: 'a'.repeat(64) }];
    throw Error('Unexpected collection test DB');
  },
};
const controlCall = (body) =>
  handlePrivateMail(
    'private-mail-sync',
    request({ mailbox: id, lease, ...body }),
    collectionOwner,
    controlContext,
  );
const startedCollection = await (
  await controlCall({
    operation: 'start-cycle',
    uidls: ['a'.repeat(64), 'b'.repeat(64)],
  })
).json();
assert.equal(startedCollection.cycle.pending.length, 2);
assert.equal(collectionBox.last_counts.cycle.id, startedCollection.cycle.id);
assert.deepEqual(
  await (
    await controlCall({
      operation: 'seen-many',
      uidls: ['a'.repeat(64), 'b'.repeat(64)],
    })
  ).json(),
  { seen: ['a'.repeat(64)], publishedSince: [] },
);
await assert.rejects(
  () => controlCall({ operation: 'start-cycle', uidls: ['c'.repeat(64)] }),
  (e) => e.status === 409,
);
const attached = await (
  await controlCall({
    operation: 'attach-cycle',
    cycleId: startedCollection.cycle.id,
    requestId: '00000000-0000-4000-8000-000000000095',
  })
).json();
assert.equal(attached.cycle.requestId, '00000000-0000-4000-8000-000000000095');
assert.deepEqual(attached.cycle.pending, startedCollection.cycle.pending);
await assert.rejects(
  () =>
    controlCall({
      operation: 'seen-many',
      uidls: Array.from({ length: 76 }, (_, i) =>
        i.toString(16).padStart(64, '0'),
      ),
    }),
  (e) => e.status === 400,
);
await controlCall({
  operation: 'end',
  counts: { saved: 1 },
  processedUidls: ['a'.repeat(64)],
  cycleId: startedCollection.cycle.id,
});
assert.deepEqual(collectionBox.last_counts.cycle.pending, ['b'.repeat(64)]);
assert.equal(collectionBox.last_counts.cycle.saved, 1);
assert.equal(collectionBox.lease_until, null);
console.log(
  'PASS owner collection: frozen targets persisted in existing mailbox JSON, no overwrite of active cycle, bulk UIDL lookup and fenced checkpoint/release',
);

const briefing =
  await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
assert.deepEqual(briefing.dailyReportIdentity('2026-10-30T14:59:59Z'), {
  day: '2026-10-30',
  title: '261030 일일정리',
});
assert.deepEqual(briefing.dailyReportIdentity('2026-10-30T15:00:00Z'), {
  day: '2026-10-31',
  title: '261031 일일정리',
});
assert.throws(() => briefing.dailyReportIdentity('invalid'), /REPORT_DATE/);
const mailSource = {
  id: '00000000-0000-4000-8000-000000000031',
  uidl_hash: '7'.repeat(64),
  subject: '<img src=x onerror=alert(1)> 배차표',
  sender: 'fixture@example.test',
  sent_at: '2026-10-30T03:00:00Z',
  text: '배차표를 확인해 주세요. 담당: 김담당. 제출기한: 2026-10-31.',
};
const analysisInput = {
  summary: [{ text: '배차표 확인 요청', evidence: '배차표를 확인해 주세요.' }],
  issues: [],
  tasks: [
    {
      text: '배차표 확인',
      evidence: mailSource.text,
      assignee: '김담당',
      due: '2026-10-31',
    },
  ],
};
const normalized = briefing.normalizeMailAnalysis(analysisInput, mailSource);
{
  const originalQuote = '요청: [A.+] 냉장 5톤\r\n\t  수량 12개\u00a0확인';
  const evidence = '요청: [A.+] 냉장 5톤 수량 12개 확인';
  const input = {
    summary: [{ text: '수량 확인', evidence }],
    issues: [],
    tasks: [],
  };
  const source = {
    ...mailSource,
    text: '앞 내용\n' + originalQuote + '\n뒤 내용',
  };
  assert.equal(
    briefing.normalizeMailAnalysis(input, source).summary[0].evidence,
    originalQuote,
  );
  assert.equal(
    briefing.normalizeMailAnalysis(input, {
      ...source,
      text: '',
      subject: originalQuote,
    }).summary[0].evidence,
    originalQuote,
  );
  for (const changed of [
    evidence.replace('12', '13'),
    evidence.replace('냉장', '냉동'),
    evidence.replace('[A.+]', '[AX+]'),
  ]) {
    assert.throws(
      () =>
        briefing.normalizeMailAnalysis(
          { ...input, summary: [{ text: '수량 확인', evidence: changed }] },
          source,
        ),
      /ANALYSIS_EVIDENCE/,
    );
  }
  assert.throws(
    () =>
      briefing.normalizeMailAnalysis(input, {
        ...source,
        text: originalQuote.replace(/\r\n\t  /, ' 다른 내용 '),
      }),
    /ANALYSIS_EVIDENCE/,
  );
}
assert.equal(normalized.tasks[0].due, '2026-10-31');
assert.equal(normalized.tasks[0].assignee, '김담당');
assert.throws(
  () =>
    briefing.normalizeMailAnalysis(
      {
        ...analysisInput,
        summary: [{ text: '없는 내용', evidence: '원문에 없는 인용' }],
      },
      mailSource,
    ),
  /ANALYSIS_EVIDENCE/,
);
assert.throws(
  () =>
    briefing.normalizeMailAnalysis(
      {
        ...analysisInput,
        tasks: [{ ...analysisInput.tasks[0], due: '2026-11-01' }],
      },
      mailSource,
    ),
  /ANALYSIS_DEADLINE/,
);
assert.throws(
  () =>
    briefing.normalizeMailAnalysis(
      {
        ...analysisInput,
        tasks: [{ ...analysisInput.tasks[0], assignee: '없는담당' }],
      },
      mailSource,
    ),
  /ANALYSIS_ASSIGNEE/,
);
const relative = briefing.normalizeMailAnalysis(
  {
    ...analysisInput,
    summary: [{ text: '자료 확인 요청', evidence: '내일까지 확인해 주세요.' }],
    tasks: [
      {
        text: '자료 확인',
        evidence: '내일까지 확인해 주세요.',
        due: '내일',
        assignee: null,
      },
    ],
  },
  { ...mailSource, text: '내일까지 확인해 주세요.' },
);
assert.equal(relative.tasks[0].due, null);
assert.equal(relative.tasks[0].dueOriginal, '내일');
const report = briefing.renderDailyBriefing({
  now: '2026-10-30T03:00:00Z',
  analyses: [normalized, normalized],
});
assert.equal(report.title, '261030 일일정리');
assert.equal(report.sourceIds.length, 1);
assert.equal(
  (report.html.match(/<h3>/g) || []).length,
  0,
  'actionable work has no duplicate mail-summary section',
);
assert.ok(!report.html.includes('<img'));
assert.ok(
  !report.html.includes('&lt;img'),
  'source subject is not repeated in the human summary',
);
assert.ok(!report.html.includes('<h2>출처</h2>'));
assert.ok(
  !report.html.includes('메일 요약') &&
    !report.html.includes('정리된 이슈 없음') &&
    report.html.includes('To Do'),
);
assert.throws(
  () =>
    briefing.renderDailyBriefing({
      now: '2026-10-30T03:00:00Z',
      analyses: [
        normalized,
        {
          ...normalized,
          summary: [{ text: '충돌', evidence: '배차표를 확인해 주세요.' }],
        },
      ],
    }),
  /ANALYSIS_CONFLICT/,
);
console.log(
  'PASS daily briefing: Korean midnight, source quotes, explicit deadlines and assignees, relative deadline uncertainty, UIDL dedup, conflicting versions and escaped HTML',
);

const dayIdentity = { day: '2026-10-30', title: '261030 일일정리' },
  dailyPage = {
    id: 'observed-page-1',
    title: '261030 일일정리',
    parent_section: {
      id: '0-6DACE80AD4C07B59!sc05c0cb6700f4ebf941a3345ff8a9981',
    },
  };
assert.deepEqual(
  briefing.selectDailyPage({
    identity: dayIdentity,
    pages: [dailyPage],
    pagesComplete: true,
  }),
  { kind: 'existing', pageId: 'observed-page-1' },
);
assert.deepEqual(
  briefing.selectDailyPage({
    identity: dayIdentity,
    pages: [],
    pagesComplete: true,
  }),
  { kind: 'create', pageId: null },
);
assert.throws(
  () =>
    briefing.selectDailyPage({
      identity: dayIdentity,
      pages: [],
      pagesComplete: false,
    }),
  /PAGE_LIST_INCOMPLETE/,
);
assert.throws(
  () =>
    briefing.selectDailyPage({
      identity: dayIdentity,
      pages: [dailyPage, { ...dailyPage, id: 'observed-page-2' }],
      pagesComplete: true,
    }),
  /PAGE_AMBIGUOUS/,
);
assert.throws(
  () =>
    briefing.selectDailyPage({
      identity: dayIdentity,
      pages: [],
      savedPageId: 'missing-page',
      pagesComplete: true,
    }),
  /PAGE_REFERENCE_MISSING/,
);
assert.deepEqual(
  briefing.selectDailyPage({
    identity: dayIdentity,
    pages: [dailyPage],
    savedPageId: dailyPage.id,
    pagesComplete: true,
  }),
  { kind: 'existing', pageId: 'observed-page-1' },
);
assert.deepEqual(
  briefing.selectDailyPage({
    identity: dayIdentity,
    pages: [{ ...dailyPage, parent_section: { id: 'other-section' } }],
    pagesComplete: true,
  }),
  { kind: 'create', pageId: null },
);
assert.equal(
  briefing.checkManagedContent({
    expectedHash: 'a'.repeat(64),
    currentHash: 'a'.repeat(64),
  }),
  true,
);
assert.equal(
  briefing.checkManagedContent({
    expectedHash: 'a'.repeat(64),
    currentHash: 'b'.repeat(64),
  }),
  false,
);
assert.equal(
  briefing.checkManagedContent({
    expectedHash: null,
    currentHash: 'b'.repeat(64),
  }),
  false,
);
assert.equal(
  briefing.checkManagedContent({
    expectedHash: 'a'.repeat(64),
    currentHash: null,
  }),
  false,
);
console.log(
  'PASS daily page: stable observed IDs, lost-response lookup, same-title conflicts, partial listings, deleted references and manual-edit protection',
);

assert.equal(
  briefing.planManagedUpdate({
    expectedHash: 'a'.repeat(64),
    currentHash: 'a'.repeat(64),
    desiredHash: 'a'.repeat(64),
  }),
  'skip',
);
assert.equal(
  briefing.planManagedUpdate({
    expectedHash: 'a'.repeat(64),
    currentHash: 'b'.repeat(64),
    desiredHash: 'b'.repeat(64),
  }),
  'skip',
);
assert.equal(
  briefing.planManagedUpdate({
    expectedHash: 'a'.repeat(64),
    currentHash: 'a'.repeat(64),
    desiredHash: 'c'.repeat(64),
  }),
  'replace',
);
assert.equal(
  briefing.planManagedUpdate({
    expectedHash: null,
    currentHash: null,
    desiredHash: 'c'.repeat(64),
  }),
  'append',
);
assert.equal(
  briefing.planManagedUpdate({
    expectedHash: 'a'.repeat(64),
    currentHash: 'b'.repeat(64),
    desiredHash: 'c'.repeat(64),
  }),
  'conflict',
);
assert.throws(() => briefing.dailyReportIdentity(null), /REPORT_DATE/);
const receiptDay = briefing.dailyReportIdentity('2026-10-30T14:59:59Z');
assert.equal(
  briefing.renderDailyBriefing({
    now: '2026-10-30T14:59:59Z',
    analyses: [normalized],
  }).title,
  receiptDay.title,
);
const richer = {
  ...normalized,
  revision: 2,
  issues: [{ text: '회신 도착', evidence: '배차표를 확인해 주세요.' }],
};
assert.equal(
  briefing.renderDailyBriefing({
    now: '2026-10-30T03:00:00Z',
    analyses: [normalized, richer],
  }).sourceIds.length,
  1,
);
assert.equal(
  briefing.renderDailyBriefing({
    now: '2026-10-30T03:00:00Z',
    analyses: [normalized, richer],
  }).html,
  briefing.renderDailyBriefing({
    now: '2026-10-30T03:00:00Z',
    analyses: [richer, normalized],
  }).html,
);
console.log(
  'PASS immediate daily updates: stable receipt day, unchanged content skip, lost acknowledgement recovery, newer analysis revision and protected manual edits',
);

let noteGraphCalls = 0,
  noteStatus = 200,
  notebookShared = false;
const noteHelpers = {
  db: async () => {
    throw Error('unexpected database write');
  },
  settings: async () => {
    throw Error('unexpected settings change');
  },
  connected: async () => ({ accessToken: 'fixture-graph-token' }),
  withLock: async (fn) => fn('fixture-lock'),
  json: (body) => Response.json(body),
  fail,
  hash,
  graph: async (path, _access, options) => {
    noteGraphCalls++;
    assert.ok(!options?.method || options.method === 'GET');
    if (noteStatus !== 200)
      throw Object.assign(Error('private provider error'), {
        status: noteStatus,
      });
    return Response.json(
      path.includes('/notebooks/')
        ? {
            id: briefing.BRIEFING_TARGET.notebookId,
            displayName: '할 일 목록',
            isShared: notebookShared,
            userRole: 'Owner',
          }
        : {
            id: briefing.BRIEFING_TARGET.sectionId,
            displayName: '일일정리',
            parentNotebook: { id: briefing.BRIEFING_TARGET.notebookId },
          },
    );
  },
};
const notesRequest = () =>
  new Request('https://fixture.test/private-mail-briefing-status', {
    method: 'POST',
    body: '{}',
  });
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-briefing-status',
      notesRequest(),
      { id: other },
      noteHelpers,
    ),
  (error) => error.status === 403,
);
assert.equal(noteGraphCalls, 0);
const noteOwner = { id: '2a828c2d-9a6f-40d4-8e13-336b591811cc' };
let noteCheck = await (
  await handlePrivateMail(
    'private-mail-briefing-status',
    notesRequest(),
    noteOwner,
    noteHelpers,
  )
).json();
assert.equal(noteCheck.readable, true);
assert.equal(noteCheck.writeVerified, false);
assert.equal(noteCheck.sectionName, '일일정리');
assert.ok(!JSON.stringify(noteCheck).includes('fixture-graph-token'));
noteStatus = 403;
noteCheck = await (
  await handlePrivateMail(
    'private-mail-briefing-status',
    notesRequest(),
    noteOwner,
    noteHelpers,
  )
).json();
assert.equal(noteCheck.readable, false);
assert.equal(noteCheck.reason, 'NOTES_PERMISSION_REQUIRED');
assert.ok(!JSON.stringify(noteCheck).includes('private provider error'));
noteStatus = 200;
notebookShared = true;
noteCheck = await (
  await handlePrivateMail(
    'private-mail-briefing-status',
    notesRequest(),
    noteOwner,
    noteHelpers,
  )
).json();
assert.equal(noteCheck.readable, false);
assert.equal(noteCheck.reason, 'NOTEBOOK_SHARED');
console.log(
  'PASS OneNote readiness: owner-only before Graph, pinned target, GET-only, permission denial and private notebook requirement',
);

const historicalText = '회의일은 2026-10-31입니다. 담당: 김담당 미정입니다.';
const uncertain = briefing.normalizeMailAnalysis(
  {
    summary: [],
    issues: [],
    tasks: [
      {
        text: '회의 준비',
        evidence: historicalText,
        due: '2026-10-31',
        assignee: '김담당',
      },
    ],
  },
  { ...mailSource, text: historicalText },
);
assert.equal(uncertain.tasks[0].due, null);
assert.equal(uncertain.tasks[0].assigneeConfirmed, false);
assert.throws(
  () =>
    briefing.selectDailyPage({
      identity: dayIdentity,
      savedPageId: dailyPage.id,
      pages: [dailyPage, { ...dailyPage, id: 'duplicate-page' }],
      pagesComplete: true,
    }),
  /PAGE_AMBIGUOUS/,
);

const fixtureService = 'notes-fixture-service';
const fixtureKey = await crypto.subtle.importKey(
  'raw',
  await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(fixtureService + ':onedrive-tokens:v1'),
  ),
  'AES-GCM',
  false,
  ['encrypt'],
);
const fixtureIv = new Uint8Array(12);
const fixtureEncrypted = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv: fixtureIv },
  fixtureKey,
  new TextEncoder().encode(
    JSON.stringify({
      accessToken: 'fixture-graph-only',
      expiresAt: Date.now() + 3600000,
    }),
  ),
);
const fixtureB64 = (bytes) => Buffer.from(bytes).toString('base64url');
const fixtureConnection =
  fixtureB64(fixtureIv) + '.' + fixtureB64(fixtureEncrypted);
const notesHandler = makeHandler(
  {
    SUPABASE_URL: 'https://notes-db.test',
    SUPABASE_ANON_KEY: 'fixture-anon',
    SUPABASE_SERVICE_ROLE_KEY: fixtureService,
  },
  async (url) => {
    if (url.endsWith('/auth/v1/user'))
      return Response.json({ id: noteOwner.id });
    if (url.includes('/user_profiles?'))
      return Response.json([
        { id: noteOwner.id, active: true, role: 'viewer' },
      ]);
    if (url.includes('/rpc/onedrive_acquire')) return Response.json(true);
    if (url.includes('/onedrive_connection?'))
      return Response.json([{ encrypted_tokens: fixtureConnection }]);
    if (url.includes('/onedrive_locks?')) return Response.json([]);
    if (url.startsWith('https://graph.microsoft.com/'))
      return Response.json(
        { error: { code: 'AccessDenied', message: 'fixture only' } },
        { status: 403 },
      );
    throw Error('Unexpected fixture URL');
  },
);
const liveWrapperCheck = await (
  await notesHandler(
    new Request(
      'https://notes-db.test/functions/v1/onedrive-auth/private-mail-briefing-status',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer fixture-owner' },
        body: '{}',
      },
    ),
  )
).json();
assert.equal(liveWrapperCheck.reason, 'NOTES_PERMISSION_REQUIRED');
console.log(
  'PASS review regressions: uncertain attribution, saved duplicate page and production Graph status mapping',
);

let connectActor = noteOwner.id;
const connectEnv = {
  SUPABASE_URL: 'https://connect-db.test',
  SUPABASE_ANON_KEY: 'fixture-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  ONEDRIVE_CLIENT_ID: '56899a37-25c3-43e2-b006-6e001d538185',
  ONEDRIVE_CLIENT_SECRET: 'fixture-secret',
};
const connectHandler = makeHandler(connectEnv, async (url, options = {}) => {
  if (url.endsWith('/auth/v1/user')) return Response.json({ id: connectActor });
  if (url.includes('/user_profiles?'))
    return Response.json([{ id: connectActor, active: true, role: 'admin' }]);
  if (url.includes('/rpc/operations_resource_allowed'))
    return Response.json(true);
  if (url.includes('/onedrive_settings?'))
    return Response.json([
      {
        expected_drive_id: 'fixture-drive',
        folders: Object.fromEntries(
          [
            'food_transport',
            'livestock_transport',
            'freight_license',
            'vehicle_registration',
            'identity',
            'health_certificate',
          ].map((kind) => [kind, 'https://1drv.ms/fixture']),
        ),
      },
    ]);
  if (url.includes('/onedrive_oauth')) return Response.json([]);
  throw Error('Unexpected connect fixture request');
});
const connectRequest = (purpose) =>
  new Request(
    'https://connect-db.test/functions/v1/onedrive-auth/' +
      (purpose === 'mail-briefing' ? 'notes-start' : 'start'),
    {
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-owner' },
      body: JSON.stringify({ purpose, returnPath: '/portal/?view=mail' }),
    },
  );
let connectResult = await (
  await connectHandler(connectRequest('mail-briefing'))
).json();
assert.ok(
  new URL(connectResult.authorizationUrl).searchParams
    .get('scope')
    .split(' ')
    .includes('Notes.ReadWrite'),
);
connectActor = other;
assert.equal(
  (await connectHandler(connectRequest('mail-briefing'))).status,
  403,
);
connectActor = noteOwner.id;
connectResult = await (await connectHandler(connectRequest(undefined))).json();
assert.equal(
  new URL(connectResult.authorizationUrl).searchParams.get('scope'),
  'offline_access Files.ReadWrite',
);
console.log(
  'PASS Notes consent preparation: explicit owner request only, Microsoft consent URL and original file-only scope unchanged',
);

const approvedMail = {
  ...mailSource,
  created_at: '2026-10-30T06:22:23Z',
  text: '평택센터 자료 확인 요청. 김담당님 회신을 기다립니다. 납품 지연으로 재확인 중입니다.',
};
const approvedAnalysis = briefing.normalizeMailAnalysis(
  {
    summary: [{ text: '자료 확인 요청', evidence: '평택센터 자료 확인 요청.' }],
    group: { name: '평택센터', evidence: '평택센터 자료 확인 요청.' },
    issues: [
      {
        text: '납품 지연',
        evidence: '납품 지연으로 재확인 중입니다.',
        impact: '납품 일정 재확인',
        status: 'needs_confirmation',
        latest: '재확인 중',
      },
    ],
    tasks: [],
    waiting: [
      {
        text: '자료 확인 회신',
        person: '김담당',
        evidence: '김담당님 회신을 기다립니다.',
      },
    ],
  },
  approvedMail,
);
const approvedReport = briefing.renderDailyBriefing({
  now: '2026-10-30T06:30:00Z',
  analyses: [approvedAnalysis],
});
for (const label of [
  '진행·회신 대기',
  '직접 메모',
  '최종 업데이트',
  '평택센터',
  '진행 중',
  '김담당',
  '2026-10-30 15:22',
])
  assert.ok(approvedReport.html.includes(label), label);
assert.ok(!approvedReport.html.includes('<blockquote>'));
assert.ok(!approvedReport.html.includes('납품 지연으로 재확인 중입니다.'));
assert.ok(
  !approvedReport.html.includes('To Do'),
  'empty sections are omitted',
);
assert.equal(
  (
    approvedReport.html.match(
      /href="https:\/\/sajoansan.vercel.app\/portal\//g,
    ) ?? []
  ).length,
  0,
  'mail source remains in the ledger, not the OneNote body',
);
assert.ok(
  !approvedReport.managedHtml.includes('직접 메모'),
  'manual area must be outside replaceable managed region',
);
assert.ok(
  approvedReport.html.indexOf('직접 메모') >
    approvedReport.html.indexOf(approvedReport.managedHtml),
);
assert.throws(
  () =>
    briefing.normalizeMailAnalysis(
      {
        ...analysisInput,
        issues: [
          {
            text: '완료',
            evidence: '배차표를 확인해 주세요.',
            status: 'resolved',
          },
        ],
      },
      mailSource,
    ),
  /ANALYSIS_COMPLETION/,
);
console.log(
  'PASS approved five-section report: source receipt KST, evidenced group/wait, status, update time and separate manual area',
);
const sameReportLater = briefing.renderDailyBriefing({
  now: '2026-10-30T07:30:00Z',
  analyses: [approvedAnalysis],
});
assert.equal(
  sameReportLater.managedHtml,
  approvedReport.managedHtml,
  'unchanged analysis must not cause another OneNote PATCH',
);
for (const phrase of ['문제 해결이 필요합니다.', '내일까지 완료 바랍니다.'])
  assert.throws(
    () =>
      briefing.normalizeMailAnalysis(
        {
          summary: [],
          issues: [
            {
              text: '해결',
              status: 'resolved',
              completionEvidence: phrase,
              evidence: phrase,
            },
          ],
          tasks: [],
        },
        { ...mailSource, text: phrase },
      ),
    /ANALYSIS_COMPLETION/,
  );
const notesAuth =
  await import('../supabase/functions/onedrive-auth/private-mail-notes-auth.js');
let consentSaved;
const consentToken = {
  scope: 'Notes.ReadWrite',
  access_token: 'fixture-access',
  refresh_token: 'fixture-refresh',
  expires_in: 3600,
};
const notesHelpers = {
  fail: (message, status) => Object.assign(Error(message), { status }),
  seal: async (data) => {
    consentSaved = data;
    return 'fixture-encrypted-notes';
  },
  db: async () => {},
  graph: async (path) =>
    Response.json(
      path.includes('/notebooks/')
        ? {
            id: briefing.BRIEFING_TARGET.notebookId,
            isShared: false,
            userRole: 'Owner',
          }
        : {
            id: briefing.BRIEFING_TARGET.sectionId,
            parentNotebook: { id: briefing.BRIEFING_TARGET.notebookId },
          },
    ),
};
await assert.rejects(
  () =>
    notesAuth.completeNotesAuth(
      { ...consentToken, scope: 'Files.ReadWrite' },
      'fixture-state',
      notesHelpers,
    ),
  (e) => e.status === 409,
);
await assert.rejects(
  () =>
    notesAuth.completeNotesAuth(
      { ...consentToken, refresh_token: undefined },
      'fixture-state',
      notesHelpers,
    ),
  (e) => e.status === 409,
);
await assert.rejects(
  () =>
    notesAuth.completeNotesAuth(consentToken, 'fixture-state', {
      ...notesHelpers,
      graph: async () =>
        Response.json({
          id: briefing.BRIEFING_TARGET.notebookId,
          isShared: true,
          userRole: 'Owner',
        }),
    }),
  (e) => e.status === 403,
);
await notesAuth.completeNotesAuth(consentToken, 'fixture-state', notesHelpers);
assert.equal(consentSaved.purpose, 'mail-briefing');
assert.equal(consentSaved.notesGranted, true);
assert.equal(consentSaved.folders, undefined);
console.log(
  'PASS Notes completion: explicit write/refresh grant and private pinned notebook required, file grant remains separate',
);
const { mailBodyText, emlHeaderText } =
  await import('../supabase/functions/onedrive-auth/private-mail-body.js');
assert.equal(
  mailBodyText(
    '<style>secret</style><p>평택 &amp; 안산<br>자료 확인</p><script>steal()</script>',
    'html',
  ),
  '평택 & 안산\n자료 확인',
);
assert.equal(
  emlHeaderText(
    new TextEncoder().encode(
      'Message-ID: <id@example.test>\r\n\r\nATTACHMENT_SENTINEL',
    ),
  ),
  'Message-ID: <id@example.test>',
);
assert.ok(
  !emlHeaderText(
    new TextEncoder().encode('X: test\r\n\r\nPRIVATE_BODY'),
  ).includes('PRIVATE_BODY'),
);
console.log(
  'PASS analyzed source boundary: HTML becomes plain text, active markup removed, RFC helper receives headers only',
);
{
  const { handleMailAutomation } =
    await import('../supabase/functions/onedrive-auth/private-mail-background.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const mailId = '11111111-1111-4111-8111-111111111111',
    ref = mailId + ':tasks:0';
  const analysis = {
    source: {
      id: mailId,
      uidl: 'a'.repeat(64),
      subject: '보고',
      sender: '발신자',
      sentAt: '2026-10-30T01:00:00Z',
      receivedAt: '2026-10-30T01:00:00Z',
    },
    revision: 1,
    summary: [],
    issues: [],
    waiting: [],
    tasks: [
      {
        text: '자료 제출',
        evidence: '자료 제출',
        status: 'pending',
        assignee: null,
        due: null,
      },
    ],
  };
  let claimed = false,
    snapshotAfterClaim = false,
    released = false;
  const mailbox = {
    id: target.mailbox_id,
    owner_id: target.owner_id,
    automation_config: {},
    briefing_overrides: {
      [ref]: { done: true, updatedAt: '2026-10-30T02:00:00Z', actor: 'owner' },
    },
  };
  const ctx = {
    fail: (message, status = 400) => Object.assign(Error(message), { status }),
    json: (value) => Response.json(value),
    db: async (path) => {
      if (path.startsWith('private_mailboxes?')) return [mailbox];
      if (path.startsWith('private_mail_messages?')) {
        snapshotAfterClaim = claimed;
        return [{ analysis }];
      }
      if (path === 'rpc/private_mail_report_allowed') return true;
      if (path === 'rpc/private_mail_briefing_claim') {
        claimed = true;
        return { revision: 2 };
      }
      if (path === 'rpc/private_mail_briefing_save') return true;
      if (path === 'rpc/private_mail_briefing_release') {
        released = true;
        return true;
      }
      if(path.startsWith('operations_tasks?select=*&owner_id=')&&path.includes('&inputs->personal_monthly->>ownerId=eq.'))return [];
      throw Error('Unexpected test query: ' + path);
    },
    connectedNotes: async () => {
      throw Error('NOTES_PERMISSION_REQUIRED');
    },
  };
  const overview = await handleMailAutomation(
    'private-mail-daily-overview',
    { day: '2026-10-30' },
    { id: target.owner_id },
    ctx,
  );
  assert.equal(
    (await overview.json()).tasks[0].status,
    'complete',
    'daily overview retains owner completion',
  );
  assert.equal(
    claimed,
    false,
    'read-only overview does not claim a writer lease',
  );
  const reportWarnings = [];
  const previousReportWarn = console.warn;
  console.warn = (...args) => reportWarnings.push(args);
  try {
    await handleMailAutomation(
      'private-mail-background-work',
      { operation: 'report', day: '2026-10-30', mailbox: target.mailbox_id },
      { id: target.owner_id },
      { ...ctx, background: true },
    );
  } finally {
    console.warn = previousReportWarn;
  }
  assert.ok(
    reportWarnings.some(
      ([label, detail]) =>
        label === 'PRIVATE_MAIL_REPORT_FAILED' &&
        detail.stage === 'notes_connection' &&
        detail.code === 'NOTES_PERMISSION_REQUIRED',
    ),
  );
  assert.equal(
    snapshotAfterClaim,
    true,
    'report snapshot is loaded only after revision lease',
  );
  assert.equal(released, true, 'failed report releases its own lease');
  const busyResult = await handleMailAutomation(
    'private-mail-background-work',
    { operation: 'report', day: '2026-10-30', mailbox: target.mailbox_id },
    { id: target.owner_id },
    {
      ...ctx,
      background: true,
      connectedNotes: async () => {
        throw Object.assign(Error('다른 서류를 처리 중입니다.'), {
          code: 'ONEDRIVE_CONNECTION_BUSY',
          status: 409,
        });
      },
    },
  );
  assert.equal(
    (await busyResult.json()).code,
    'ONEDRIVE_CONNECTION_BUSY',
    'temporary shared lock must not be mislabeled as authentication failure',
  );

  console.log(
    'PASS daily overview owner override and report claim-before-input ordering',
  );
}
{
  const { createMailSource } =
    await import('../supabase/functions/onedrive-auth/private-mail-source.js');
  const { analyzePrivateMail } =
    await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const bytes = new TextEncoder().encode('매일 광고 안내입니다.');
  const file = {
    kind: 'text',
    item_id: 'body',
    file_name: 'body.txt',
    original_name: '본문.txt',
    byte_size: bytes.length,
  };
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    owner_id: target.owner_id,
    mailbox_id: target.mailbox_id,
    uidl_hash: 'a'.repeat(64),
    subject: '안내',
    sender: 'sender@example.test',
    sent_at: '2026-10-30T01:00:00Z',
    created_at: '2026-10-30T02:00:00Z',
    files: [file, { kind: 'eml', item_id: 'never-download' }],
  };
  let metadataReads = 0,
    bodyReads = 0,
    excluded = 0;
  const source = createMailSource({
    db: async () => assert.fail('Filtered source must not load related mail'),
    withLock: async (fn) => fn(),
    mailbox: async () => ({
      drive_id: 'drive',
      folder_id: 'folder',
      analysis_rules: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: '광고',
          enabled: true,
          mode: 'all',
          conditions: [{ field: 'body', value: '광고' }],
        },
      ],
    }),
    environment: async () => ({ access: 'fixture-access' }),
    privateDestination: async () => ({}),
    privatePermissions: async () => {},
    graph: async (path) => {
      metadataReads++;
      assert.equal(path, '/drives/drive/items/body');
      return Response.json({
        id: 'body',
        file: {},
        name: file.file_name,
        size: bytes.length,
        parentReference: { id: 'folder', driveId: 'drive' },
      });
    },
    verify: async () => {
      bodyReads++;
      return bytes;
    },
  });
  const result = await analyzePrivateMail({
    messageId: row.id,
    key: 'fixture-key',
    loadMail: source.loadMail,
    fetcher: async () =>
      assert.fail('Excluded source must never reach the model'),
    store: {
      claim: async () => ({ row, lease: 'fixture-lease' }),
      exclude: async ({ match }) => {
        excluded++;
        assert.equal(match.reason, 'RULE_MATCH');
        return true;
      },
      finish: async () => assert.fail('Excluded analysis must not publish'),
      fail: async () => assert.fail('Exclusion is not an analysis failure'),
    },
  });
  assert.equal(result.status, 'excluded');
  assert.equal(excluded, 1);
  assert.equal(metadataReads, 1);
  assert.equal(bodyReads, 1);
  await assert.rejects(
    () => source.loadMail({ ...row, owner_id: other }),
    /ANALYSIS_SOURCE/,
  );
  assert.equal(metadataReads, 1, 'wrong owner is rejected before file access');
  console.log(
    'PASS actual source-loader rule exclusion before EML/photos/model and owner isolation',
  );
}
{
  const { handleMailFilter } =
    await import('../supabase/functions/onedrive-auth/private-mail-filter-actions.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  let query;
  const rows = Array.from({ length: 26 }, (_, i) => ({
    id: '11111111-1111-4111-8111-' + String(i).padStart(12, '0'),
    mailbox_id: target.mailbox_id,
    owner_id: target.owner_id,
    subject: '메일 ' + i,
  }));
  const ctx = {
    json: (value) => value,
    fail: (code, status = 400) => Object.assign(Error(code), { status }),
    db: async (path) => {
      if (path.startsWith('private_mailboxes?'))
        return [
          {
            id: target.mailbox_id,
            owner_id: target.owner_id,
            analysis_rules: [],
            briefing_overrides: {},
          },
        ];
      query = path;
      return rows;
    },
  };
  const result = await handleMailFilter(
    'private-mail-filter-status',
    { offset: 25 },
    { id: target.owner_id },
    ctx,
  );
  assert.equal(result.messages.length, 25);
  assert.equal(result.offset, 25);
  assert.equal(result.nextOffset, 50);
  assert.equal(result.hasMore, true);
  assert.match(query, /offset=25/);
  assert.match(query, /limit=26/);
  await assert.rejects(
    () =>
      handleMailFilter(
        'private-mail-filter-status',
        { offset: -1 },
        { id: target.owner_id },
        ctx,
      ),
    /MAIL_FILTER_REQUEST_INVALID/,
  );
  console.log(
    'PASS bounded mail selection pagination and invalid offset rejection',
  );
}
{
  const { handleMailAutomation } =
    await import('../supabase/functions/onedrive-auth/private-mail-background.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const calls = [];
  const response = await handleMailAutomation(
    'private-mail-automation-status',
    {},
    { id: target.owner_id },
    {
      fail: (code, status) => Object.assign(Error(code), { status }),
      json: (value) => Response.json(value),
      db: async (path) => {
        calls.push(path);
        if (path.startsWith('private_mailboxes?'))
          return [
            {
              id: target.mailbox_id,
              owner_id: target.owner_id,
              last_counts: {},
            },
          ];
        if (
          path ===
          'onedrive_connection?select=id&encrypted_notes_tokens=not.is.null'
        )
          return [{ id: true }];
        throw Error('Unexpected status query: ' + path);
      },
    },
  );
  const value = await response.json();
  assert.equal(value.schemaReady, false);
  assert.equal(
    value.notesConnected,
    true,
    'saved Notes consent must be reported even before automation schema is installed',
  );
  assert.equal(value.config.enabled, false);
  assert.equal(value.schedulerReady, false);
  assert.equal(value.workerReady, false);
  assert.equal(
    calls.length,
    2,
    'connection status reads metadata only and does not activate or query missing automation objects',
  );
  console.log(
    'PASS Notes connection status is independent from automation schema readiness',
  );
}
{
  const { authorizeMailWork } =
    await import('../supabase/functions/onedrive-auth/private-mail-worker-auth.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const token = 'pmjob_' + 'a'.repeat(64),
    job = '11111111-1111-4111-8111-111111111111';
  let session = {
    kind: 'collect',
    target: job,
    mailboxId: target.mailbox_id,
    jobRunning: true,
  };
  const context = {
    token,
    hash: async (value) => {
      assert.equal(value, token);
      return 'h'.repeat(43);
    },
    fail: (code, status) => Object.assign(Error(code), { status }),
    db: async (path, options) => {
      assert.equal(path, 'rpc/private_mail_dispatch_auth');
      assert.equal(options.body.p_hash, 'h'.repeat(43));
      return session;
    },
  };
  const req = (body) =>
    new Request('https://local.invalid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  await authorizeMailWork(
    'private-mail-background-work',
    req({ operation: 'job-claim', mailbox: target.mailbox_id, id: job, lease }),
    context,
  );
  await assert.rejects(
    () =>
      authorizeMailWork(
        'private-mail-background-work',
        req({
          operation: 'job-claim',
          mailbox: target.mailbox_id,
          id: other,
          lease,
        }),
        context,
      ),
    (e) => e.status === 403,
  );
  await authorizeMailWork(
    'private-mail-background-sync',
    req({ operation: 'attach-cycle', requestId: job }),
    context,
  );
  await assert.rejects(
    () =>
      authorizeMailWork(
        'private-mail-background-sync',
        req({ operation: 'start-cycle', requestId: other }),
        context,
      ),
    (e) => e.status === 403,
  );
  session = { ...session, jobRunning: false };
  await assert.rejects(
    () =>
      authorizeMailWork(
        'private-mail-background-sync',
        req({ operation: 'begin' }),
        context,
      ),
    (e) => e.status === 403,
  );
  session = { kind: 'analyze', target: job, mailboxId: target.mailbox_id };
  await authorizeMailWork(
    'private-mail-background-work',
    req({ operation: 'analyze', mailbox: target.mailbox_id, id: job }),
    context,
  );
  await assert.rejects(
    () =>
      authorizeMailWork(
        'private-mail-background-sync',
        req({ operation: 'begin' }),
        context,
      ),
    (e) => e.status === 403,
  );
  session = {
    kind: 'report',
    target: '2026-10-30',
    mailboxId: target.mailbox_id,
  };
  await authorizeMailWork(
    'private-mail-background-work',
    req({ operation: 'report', mailbox: target.mailbox_id, day: '2026-10-30' }),
    context,
  );
  await assert.rejects(
    () =>
      authorizeMailWork(
        'private-mail-background-work',
        req({
          operation: 'report',
          mailbox: target.mailbox_id,
          day: '2026-10-29',
        }),
        context,
      ),
    (e) => e.status === 403,
  );
  session = null;
  await assert.rejects(
    () =>
      authorizeMailWork(
        'private-mail-background-work',
        req({ operation: 'report' }),
        context,
      ),
    (e) => e.status === 403,
  );
  await assert.rejects(
    () =>
      authorizeMailWork(
        'private-mail-background-work',
        req({ operation: 'report' }),
        {
          ...context,
          token: 'invalid',
          db: async () =>
            assert.fail('Malformed authentication must not query DB'),
        },
      ),
    (e) => e.status === 403,
  );
  console.log(
    'PASS scoped short-lived worker authorization before POP and paid analysis',
  );
}
{
  const { handleMailAutomation } =
    await import('../supabase/functions/onedrive-auth/private-mail-background.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const approvedAt = '2026-10-30T12:00:00Z';
  let saved;
  let resumed = 0;
  const mailbox = {
    id: target.mailbox_id,
    owner_id: target.owner_id,
    automation_config: {
      enabled: true,
      readStateVerified: false,
      analysisConsent: true,
      analysisConsentAt: approvedAt,
      approvalSource: 'owner-request',
    },
  };
  const ctx = {
    json: (value) => Response.json(value),
    fail: (code, status) => Object.assign(Error(code), { status }),
    aiKey: 'fixture-key',
    connectedNotes: async () => ({ notesGranted: true }),
    fetcher: async (_url, options) => {
      assert.equal(
        options.headers.Authorization,
        undefined,
        'readiness probe uses no static secret',
      );
      return Response.json({ configured: true });
    },
    db: async (path, options) => {
      if (path.startsWith('private_mailboxes?')) {
        if (options?.method === 'PATCH') {
          saved = options.body.automation_config;
          return null;
        }
        return [mailbox];
      }
      if (
        path === 'rpc/private_mail_scheduler_ready' ||
        path === 'rpc/private_mail_dispatch'
      )
        return true;
      if (path === 'rpc/private_mail_job_start') {
        assert.equal(options.body.p_force, true);
        resumed++;
        return { status: 'queued' };
      }
      throw Error('Unexpected automation query: ' + path);
    },
  };
  await handleMailAutomation(
    'private-mail-automation-config',
    { enabled: false },
    { id: target.owner_id },
    ctx,
  );
  assert.equal(saved.enabled, false);
  assert.equal(saved.analysisConsent, true);
  assert.equal(saved.readStateVerified, false);
  assert.equal(saved.analysisConsentAt, approvedAt);
  await handleMailAutomation(
    'private-mail-automation-config',
    { enabled: true },
    { id: target.owner_id },
    ctx,
  );
  assert.equal(saved.enabled, true);
  assert.equal(saved.analysisConsentAt, approvedAt);
  assert.equal(
    resumed,
    1,
    'resuming approved automation immediately resumes its unfinished receipt',
  );
  await handleMailAutomation(
    'private-mail-automation-config',
    { enabled: true },
    { id: target.owner_id },
    { ...ctx, connectedNotes: async () => ({ notesGranted: false }) },
  );
  assert.equal(
    saved.enabled,
    true,
    'analysis resumes independently of Notes connection',
  );
  console.log(
    'PASS approved automation pause/resume needs no extra consent checkbox or fabricated read verification',
  );
}
{
  const { analyzePrivateMail } =
    await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
  const source = {
    id: '11111111-1111-4111-8111-111111111111',
    uidl_hash: 'a'.repeat(64),
    subject: '일정 확인',
    sender: 'fixture@example.test',
    sent_at: '2026-10-30T01:00:00Z',
    created_at: '2026-10-30T02:00:00Z',
    text: '보고서 제출을 확인해 주세요.',
  };
  const value = {
    intent: { kind: 'unknown', evidence: null },
    summary: [{ text: '제출 확인 요청', evidence: source.text }],
    issues: [],
    tasks: [],
    waiting: [],
  };
  const json = JSON.stringify(value),
    warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  const run = (content, stop_reason = 'end_turn') =>
    analyzePrivateMail({
      messageId: source.id,
      key: 'fixture-key',
      loadMail: async () => source,
      fetcher: async (url, options) => {
        assert.equal(url, 'https://aiapiflow.com/v1/responses');
        assert.equal(JSON.parse(options.body).model, 'gpt-5.6-luna');
        return lunaResponseFixture(content, stop_reason);
      },
      store: {
        claim: async () => ({ row: source, lease: 'fixture-lease' }),
        finish: async () => true,
        fail: async () => true,
      },
    });
  try {
    assert.equal((await run([{ type: 'text', text: json }])).status, 'done');
    assert.equal(
      (await run([{ type: 'text', text: '```json\n' + json + '\n```' }]))
        .status,
      'done',
    );
    assert.equal(
      (await run([{ type: 'text', text: '```\n' + json + '\n```' }])).status,
      'done',
    );
    const rejected = [
      [
        {
          type: 'text',
          text: 'PRIVATE_RESPONSE_SENTINEL\n```json\n' + json + '\n```',
        },
      ],
      [
        {
          type: 'text',
          text: '```json\n' + json + '\n```\nPRIVATE_RESPONSE_SENTINEL',
        },
      ],
      [
        {
          type: 'text',
          text: '```json\n{"summary": [PRIVATE_RESPONSE_SENTINEL}\n```',
        },
      ],
      [
        { type: 'text', text: json },
        { type: 'tool_use', name: 'PRIVATE_RESPONSE_SENTINEL', input: {} },
      ],
      [
        { type: 'thinking', thinking: 'PRIVATE_RESPONSE_SENTINEL' },
        { type: 'text', text: json },
      ],
      [
        { type: 'text', text: json },
        { type: 'text', text: json },
      ],
      [
        {
          type: 'PRIVATE_RESPONSE_SENTINEL',
          text: 'PRIVATE_RESPONSE_SENTINEL',
        },
      ],
    ];
    for (const content of rejected) {
      const count = warnings.length;
      assert.equal((await run(content)).code, 'MODEL_RESPONSE');
      assert.equal(
        warnings.length,
        count + 1,
        'each rejected shape emits one metadata warning',
      );
    }
    assert.equal(
      (await run([{ type: 'text', text: json }], 'PRIVATE_RESPONSE_SENTINEL'))
        .code,
      'MODEL_RESPONSE',
    );
    assert.equal(
      (await run([{ type: 'text', text: json }], 'max_tokens')).code,
      'MODEL_TRUNCATED',
    );
    const fabricated = {
      ...value,
      summary: [{ text: '확인', evidence: '없는 근거' }],
    };
    assert.equal(
      (
        await run([
          {
            type: 'text',
            text: '```json\n' + JSON.stringify(fabricated) + '\n```',
          },
        ])
      ).code,
      'ANALYSIS_EVIDENCE',
    );
    const evidenceWarnings = warnings.filter(
      ([label]) => label === 'PRIVATE_MAIL_EVIDENCE_REJECTED',
    );
    assert.equal(evidenceWarnings.length, 1);
    assert.deepEqual(evidenceWarnings[0][1].mismatches, [
      {
        kind: 'summary',
        index: 0,
        length: 5,
        whitespaceMatch: false,
        containsEllipsis: false,
      },
    ]);
    assert.ok(!JSON.stringify(warnings).includes('없는 근거'));
    assert.ok(!JSON.stringify(warnings).includes('PRIVATE_RESPONSE_SENTINEL'));
    assert.ok(!JSON.stringify(warnings).includes(source.subject));
    assert.ok(!JSON.stringify(warnings).includes(source.text));
    assert.ok(
      warnings
        .filter(([label]) => label === 'PRIVATE_MAIL_MODEL_RESPONSE')
        .every(
          ([label, metadata]) =>
            label === 'PRIVATE_MAIL_MODEL_RESPONSE' &&
            typeof metadata.blockCount === 'number' &&
            Array.isArray(metadata.blockTypes) &&
            typeof metadata.fenced === 'boolean',
        ),
    );
  } finally {
    console.warn = originalWarn;
  }
  console.log(
    'PASS mail model response: anchored JSON fences, rejected prose/tools/multiple blocks/truncation, exact evidence and metadata-only diagnostics',
  );
}
{
  const { analyzePrivateMail } =
    await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
  const source = {
    id: '11111111-1111-4111-8111-111111111111',
    uidl_hash: 'a'.repeat(64),
    subject: 'PRIVATE_FORMAT_SUBJECT',
    sender: 'PRIVATE_FORMAT_SENDER',
    text: '자료를 확인해 주세요.',
    sent_at: '2026-10-30T01:00:00Z',
    created_at: '2026-10-30T02:00:00Z',
  };
  const base = {
    intent: { kind: 'unknown', evidence: null },
    summary: [{ text: '확인 요청', evidence: source.text }],
    issues: [],
    tasks: [],
    waiting: [],
    group: null,
  };
  const warnings = [],
    originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  const run = (value) =>
    analyzePrivateMail({
      messageId: source.id,
      key: 'fixture-key',
      loadMail: async () => source,
      fetcher: async (url, options) => {
        assert.equal(url, 'https://aiapiflow.com/v1/responses');
        assert.equal(JSON.parse(options.body).text.format.strict, true);
        return lunaResponseFixture([
          { type: 'text', text: JSON.stringify(value) },
        ]);
      },
      store: {
        claim: async () => ({ row: source, lease: 'fixture' }),
        finish: async () => true,
        fail: async ({ code }) => {
          assert.equal(code, 'ANALYSIS_FORMAT');
          return true;
        },
      },
    });
  try {
    const cases = [
      { value: [], stage: 'parse', check: 'top_level' },
      { value: { ...base, tasks: {} }, stage: 'parse', check: 'array' },
      {
        value: {
          ...base,
          issues: [
            {
              text: 'PRIVATE_FORMAT_TEXT',
              evidence: 'PRIVATE_FORMAT_EVIDENCE',
              status: 'PRIVATE_FORMAT_STATUS',
            },
          ],
        },
        stage: 'parse',
        check: 'status',
      },
      {
        value: {
          ...base,
          summary: [{ text: 'PRIVATE_FORMAT_TEXT', evidence: [source.text] }],
        },
        stage: 'normalize_mail',
        check: 'fields',
      },
      {
        value: {
          ...base,
          summary: [{ text: ['PRIVATE_FORMAT_TEXT'], evidence: source.text }],
        },
        stage: 'normalize_mail',
        check: 'fields',
      },
      {
        value: {
          ...base,
          summary: [{ text: '가'.repeat(1001), evidence: source.text }],
        },
        stage: 'normalize_mail',
        check: 'fields',
      },
      {
        value: {
          ...base,
          group: { name: ['PRIVATE_FORMAT_NAME'], evidence: source.text },
        },
        stage: 'normalize_mail',
        check: 'fields',
      },
    ];
    for (const fixture of cases) {
      const count = warnings.length;
      assert.equal((await run(fixture.value)).code, 'ANALYSIS_FORMAT');
      assert.equal(warnings.length, count + 1);
      const [label, meta] = warnings.at(-1);
      assert.equal(label, 'PRIVATE_MAIL_ANALYSIS_FORMAT');
      assert.equal(meta.stage, fixture.stage);
      assert.equal(meta.check, fixture.check);
      assert.ok(meta.shape);
    }
    const diagnostic = JSON.stringify(warnings);
    for (const secret of [
      'PRIVATE_FORMAT_SUBJECT',
      'PRIVATE_FORMAT_SENDER',
      'PRIVATE_FORMAT_TEXT',
      'PRIVATE_FORMAT_EVIDENCE',
      'PRIVATE_FORMAT_STATUS',
      'PRIVATE_FORMAT_NAME',
      source.text,
      'fixture-key',
    ])
      assert.ok(!diagnostic.includes(secret));
    assert.equal(warnings[3][1].shape.fields.summary.evidenceTypes.array, 1);
    assert.equal(warnings[4][1].shape.fields.summary.textTypes.array, 1);
    assert.equal(warnings[5][1].shape.fields.summary.maxTextLength, 1001);
    assert.equal(warnings[6][1].shape.fields.group.name.type, 'array');
  } finally {
    console.warn = originalWarn;
  }
  console.log(
    'PASS mail analysis format diagnostics: parse vs normalization stages, enum/count/type/length metadata only, array evidence and malformed statuses remain rejected',
  );
}
{
  const { MAIL_ANALYSIS_SCHEMA } =
    await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
  const { MANUAL_MESSAGE_SCHEMA, normalizeManualItems, manualDailyView } =
    await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const checkSchema = (schema) => {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, Object.keys(schema.properties));
      for (const child of Object.values(schema.properties)) checkSchema(child);
    }
    if (schema.items) checkSchema(schema.items);
    for (const child of schema.anyOf ?? []) checkSchema(child);
  };
  checkSchema(MAIL_ANALYSIS_SCHEMA);
  checkSchema(MANUAL_MESSAGE_SCHEMA);
  assert.equal(MAIL_ANALYSIS_SCHEMA.properties.summary.maxItems, 3);
  assert.equal(
    MAIL_ANALYSIS_SCHEMA.properties.summary.items.properties.evidence.type,
    'string',
  );
  assert.equal(
    MANUAL_MESSAGE_SCHEMA.properties.items.items.properties.completionEvents,
    undefined,
  );
  const png = 'iVBORw0KGgo=',
    schema = {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    };
  let paidCalls = 0;
  const args = {
    key: 'fixture-key',
    prompt: 'fixture private input',
    schema,
    schemaName: 'fixture_schema',
    maxTokens: 2048,
  };
  const answer = {
    status: 'completed',
    model: 'gpt-5.6-luna',
    output: [
      {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'PRIVATE_LUNA_REASONING' }],
      },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: '{"ok":true}' }],
      },
    ],
    usage: {
      input_tokens: 12,
      output_tokens: 7,
      total_tokens: 19,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens_details: { reasoning_tokens: 2 },
      cost: 'PRIVATE_LUNA_COST',
    },
  };
  const response = await callLuna({
    ...args,
    images: [{ mediaType: 'image/png', data: png }],
    fetcher: async (url, options) => {
      paidCalls++;
      assert.equal(url, 'https://aiapiflow.com/v1/responses');
      assert.equal(options.headers.authorization, 'Bearer fixture-key');
      assert.equal(options.headers['x-api-key'], undefined);
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'gpt-5.6-luna');
      assert.equal(request.store, false);
      assert.equal(request.max_output_tokens, 2048);
      assert.ok(!('messages' in request));
      assert.ok(!('tools' in request));
      assert.equal(request.text.format.type, 'json_schema');
      assert.equal(request.text.format.strict, true);
      assert.deepEqual(request.text.format.schema, schema);
      assert.deepEqual(request.input[0].content, [
        { type: 'input_text', text: args.prompt },
        { type: 'input_image', image_url: 'data:image/png;base64,' + png },
      ]);
      return Response.json(answer);
    },
  });
  assert.equal(response.model, 'gpt-5.6-luna');
  assert.equal(response.stop_reason, 'end_turn');
  assert.equal(response.content[0].text, '{"ok":true}');
  assert.deepEqual(response.usage, {
    input_tokens: 12,
    output_tokens: 7,
    total_tokens: 19,
    cached_input_tokens: 3,
    reasoning_tokens: 2,
  });
  assert.ok(!JSON.stringify(response).includes('PRIVATE_LUNA_'));
  assert.equal(paidCalls, 1);
  const rejected = [
    [
      {
        ...answer,
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      },
      'MODEL_TRUNCATED',
    ],
    [
      {
        ...answer,
        status: 'incomplete',
        incomplete_details: { reason: 'PRIVATE_LUNA_REASON' },
      },
      'MODEL_RESPONSE',
    ],
    [
      { ...answer, status: 'failed', error: { message: 'PRIVATE_LUNA_ERROR' } },
      'MODEL_FAILED',
    ],
    [
      {
        ...answer,
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'refusal', refusal: 'PRIVATE_LUNA_REFUSAL' }],
          },
        ],
      },
      'MODEL_RESPONSE',
    ],
    [
      {
        ...answer,
        output: [
          {
            type: 'function_call',
            name: 'PRIVATE_LUNA_TOOL',
            arguments: 'PRIVATE_LUNA_ARGUMENTS',
          },
        ],
      },
      'MODEL_RESPONSE',
    ],
    [
      {
        ...answer,
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'in_progress',
            content: [{ type: 'output_text', text: '{"ok":true}' }],
          },
        ],
      },
      'MODEL_RESPONSE',
    ],
  ];
  for (const [body, code] of rejected)
    await assert.rejects(
      () => callLuna({ ...args, fetcher: async () => Response.json(body) }),
      (error) => {
        assert.equal(error.code, code);
        assert.ok(!JSON.stringify(error).includes('PRIVATE_LUNA_'));
        return true;
      },
    );
  for (const status of [429, 502])
    await assert.rejects(
      () =>
        callLuna({
          ...args,
          fetcher: async () => ({
            ok: false,
            status,
            json: async () => assert.fail('error bodies must not be read'),
          }),
        }),
      (error) =>
        error.code === (status === 429 ? 'RATE_LIMITED' : 'MODEL_FAILED') &&
        error.providerStatus === status,
    );
  await assert.rejects(
    () =>
      callLuna({
        ...args,
        fetcher: async () => {
          throw new DOMException('PRIVATE_LUNA_TIMEOUT', 'TimeoutError');
        },
      }),
    (error) =>
      error.code === 'MODEL_FAILED' &&
      error.status === 504 &&
      !JSON.stringify(error).includes('PRIVATE_LUNA_TIMEOUT'),
  );
  for (const images of [
    Array(6).fill({ mediaType: 'image/png', data: png }),
    [{ mediaType: 'image/png', data: 'A'.repeat(2800004) }],
  ])
    await assert.rejects(
      () =>
        callLuna({
          ...args,
          images,
          fetcher: async () =>
            assert.fail('image limits must precede paid call'),
        }),
      (error) => error.code === 'IMAGE_LIMIT',
    );
  const historicalItems = normalizeManualItems(
    {
      items: [
        {
          kind: 'dispatch',
          text: '차량 배차',
          evidence: '내일 배차해주세요',
          serviceOriginal: '내일',
        },
      ],
    },
    {
      text: '내일 배차해주세요',
      entryId: '11111111-1111-4111-8111-111111111111',
      submittedAt: '2026-10-30T10:00:00Z',
    },
  );
  assert.deepEqual(historicalItems[0].completionEvents, []);
  const entry = {
    entryId: '11111111-1111-4111-8111-111111111111',
    status: 'ready',
    submittedAt: '2026-10-30T10:00:00Z',
    items: [
      {
        ...historicalItems[0],
        done: false,
        completedAt: null,
        completionEvents: [
          { done: true, at: '2026-11-01T01:00:00Z' },
          { done: false, at: '2026-11-02T01:00:00Z' },
        ],
      },
    ],
  };
  assert.equal(manualDailyView([entry], '2026-11-01').tasks[0].done, true);
  assert.equal(
    manualDailyView([entry], '2026-11-01').tasks[0].completedAt,
    '2026-11-01T01:00:00Z',
  );
  assert.equal(manualDailyView([entry], '2026-11-02').tasks[0].done, false);
  assert.equal(
    manualDailyView([entry], '2026-11-02').tasks[0].completedAt,
    null,
  );
  assert.ok(
    !JSON.stringify(manualDailyView([entry], '2026-11-02')).includes(
      'completionEvents',
    ),
  );
  console.log(
    'PASS Luna Responses: strict mail/manual schemas, text/images, real model and integer usage, refusal/truncation/tools/HTTP/timeout boundaries, no secret output and historical manual completion',
  );
}
{
  const response = await callLuna({
    key: 'fixture-key',
    prompt: 'free text fixture',
    fetcher: async (url, options) => {
      assert.equal(url, 'https://aiapiflow.com/v1/responses');
      const request = JSON.parse(options.body);
      assert.equal(request.model, 'gpt-5.6-luna');
      assert.equal(request.store, false);
      assert.equal(request.text, undefined);
      return lunaResponseFixture([{ type: 'text', text: 'fixture answer' }]);
    },
  });
  assert.equal(response.content[0].text, 'fixture answer');
  for (const partial of [
    {
      schema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    { schemaName: 'missing_schema' },
  ])
    await assert.rejects(
      () =>
        callLuna({
          key: 'fixture-key',
          prompt: 'fixture',
          ...partial,
          fetcher: async () =>
            assert.fail('partial schema must reject before request'),
        }),
      (error) =>
        error.code === 'MODEL_FAILED' && error.reason === 'configuration',
    );
  console.log(
    'PASS generic Luna helper: absent schema omits text.format; incomplete schema configuration never reaches provider',
  );
}
{
  const { manualDailyView, normalizeManualItems } =
    await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const entryId = '88888888-8888-4888-8888-888888888888';
  const submittedAt = '2026-10-30T01:00:00Z';
  const original = '11월2일 배차 준비해주세요.';
  const items = normalizeManualItems(
    {
      items: [
        {
          kind: 'dispatch',
          text: '운행 차량 섭외 및 배차',
          evidence: original,
          serviceOriginal: '11월2일',
          dueOriginal: null,
          assignee: null,
          needsConfirmation: false,
        },
      ],
    },
    { text: original, submittedAt, referenceDate: '2026-10-30', entryId },
  );
  const entry = {
    entryId,
    submittedAt,
    referenceDate: '2026-10-30',
    referenceSource: 'received',
    status: 'ready',
    items,
  };
  const manual = manualDailyView({ [entryId]: entry }, '2026-10-30');
  const report = briefing.renderDailyBriefing({
    now: '2026-10-30T12:00:00+09:00',
    analyses: [],
    manual,
  });
  assert.ok(report.html.includes('운행 차량 섭외 및 배차'));
  assert.ok(report.html.includes('운행·납품 2026-11-02'));
  assert.ok(report.html.includes('To Do'));
  assert.ok(!report.html.includes('메일 요약'));
  assert.ok(!report.html.includes('정리된 메일 없음'));
  assert.ok(!report.html.includes(original));
  assert.ok(!report.html.replace(/<[^>]*>/g, '').includes(entryId));
  assert.ok(!report.html.includes('?entry=' + entryId));
  assert.ok(!report.html.includes('23:59'));
  assert.ok(report.sourceIds.includes(entryId));
  console.log(
    'PASS manual OneNote integration: current preparation with future service date, stable private source, concise output without fake deadline or empty mail section',
  );
}
{
  const { analyzePrivateMail, mailOwnershipContext, MAIL_ANALYSIS_SCHEMA } =
    await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
  const account = 'owner-private@example.test',
    headers =
      'From: Manager <sender@example.test>\r\nTo: Owner <' +
      account +
      '>\r\nCc: PRIVATE_CC@example.test\r\nMessage-ID: <synthetic-owner@example.test>';
  const document =
    '-----Original Message-----\nFrom: 타인\nTo: 다른 수신자\nSubject: 자료\n검토 후 재가 요청드립니다.';
  const forwarded = '참고하시라고 전달드립니다.\n' + document;
  const context = mailOwnershipContext({ text: forwarded, headers, account });
  assert.equal(context.currentBody, '참고하시라고 전달드립니다.');
  assert.ok(context.documentBody.includes('검토 후 재가'));
  assert.equal(context.ownerContext.recipientRole, 'to');
  assert.equal(context.bodySeparation, 'forwarded');
  assert.ok(!JSON.stringify(context.ownerContext).includes(account));
  const ccContext = mailOwnershipContext({
    text: '검토 후 재가 부탁드립니다.',
    headers: 'To: 다른사람 <other@example.test>\r\nCc: ' + account,
    account,
  });
  assert.equal(ccContext.ownerContext.recipientRole, 'cc');
  const quoted = mailOwnershipContext({
    text: '자료 참고 바랍니다.\n> 검토 후 재가 요청드립니다.',
    headers,
    account,
  });
  assert.equal(quoted.currentBody, '자료 참고 바랍니다.');
  assert.equal(quoted.bodySeparation, 'quoted');
  const source = {
    id: '11111111-1111-4111-8111-111111111111',
    uidl_hash: 'a'.repeat(64),
    subject: '자료 전달',
    sender: 'sender@example.test',
    text: forwarded,
    sent_at: '2026-10-30T01:00:00Z',
    created_at: '2026-10-30T02:00:00Z',
    headers,
    ...context,
  };
  const ownership = {
    forOwner: true,
    recipientScope: 'owner_direct',
    selfRequestEvidence: '검토 후 재가 요청드립니다.',
  };
  const task = {
    text: '검토 후 재가',
    evidence: '검토 후 재가 요청드립니다.',
    status: 'pending',
    assignee: null,
    due: null,
    serviceOriginal: null,
    completionEvidence: null,
    ...ownership,
  };
  const value = {
    intent: { kind: 'request', evidence: '검토 후 재가 요청드립니다.' },
    group: null,
    summary: [
      {
        text: '조건 자료를 참고용으로 전달했습니다.',
        evidence: '참고하시라고 전달드립니다.',
      },
    ],
    issues: [],
    tasks: [task],
    waiting: [
      {
        text: '재가 회신',
        evidence: task.evidence,
        person: null,
        ...ownership,
      },
    ],
    updates: [],
    imageFacts: [],
    imageDecisions: [],
    imageItems: { tasks: [], issues: [], waiting: [] },
  };
  let saved;
  const run = (mail, answer, extra = {}) =>
    analyzePrivateMail({
      messageId: mail.id,
      key: 'fixture-key',
      loadMail: async () => mail,
      fetcher: async (url, options) => {
        assert.equal(url, 'https://aiapiflow.com/v1/responses');
        const request = JSON.parse(options.body);
        assert.equal(request.model, 'gpt-5.6-luna');
        assert.equal(request.text.format.strict, true);
        assert.ok(
          options.body.includes(account),
          'normalized To metadata is supplied by the current envelope',
        );
        assert.ok(
          options.body.includes('PRIVATE_CC'),
          'normalized Cc metadata is supplied separately from To',
        );
        assert.ok(options.body.includes('sender@example.test'));
        return lunaResponseFixture([
          { type: 'text', text: JSON.stringify(answer) },
        ]);
      },
      store: {
        claim: async () => ({ row: mail, lease: 'fixture' }),
        finish: async ({ analysis }) => {
          saved = analysis;
          return true;
        },
        fail: async () => true,
      },
      ...extra,
    });
  let result = await run(source, value, { intentOverride: 'reference' });
  assert.equal(result.status, 'done');
  assert.equal(saved.intent.kind, 'reference');
  assert.equal(saved.tasks.length, 0);
  assert.equal(saved.waiting.length, 0);
  assert.equal(saved.summary.length, 1);
  assert.equal(saved.review.withheldTasks, 1);
  assert.equal(saved.source.analysisPolicy.ownerFeedback, 'owner_feedback');
  assert.equal(source.text, forwarded, 'original source must remain intact');
  result = await run(source, value);
  assert.equal(result.status, 'done');
  assert.equal(saved.tasks.length, 0);
  assert.equal(saved.waiting.length, 0);
  assert.ok(saved.review.reasons.includes('intent_not_current'));
  const direct = '장희성님, 검토 후 재가 부탁드립니다.';
  const directSource = {
    ...source,
    text: direct + '\n' + document,
    ...mailOwnershipContext({
      text: direct + '\n' + document,
      headers,
      account,
    }),
  };
  const directValue = {
    ...value,
    intent: { kind: 'request', evidence: direct },
    summary: [
      { text: '사용자에게 자료 검토와 재가를 요청했습니다.', evidence: direct },
    ],
    tasks: [{ ...task, evidence: direct, selfRequestEvidence: direct }],
    waiting: [],
  };
  result = await run(directSource, directValue);
  assert.equal(result.status, 'done');
  assert.equal(
    saved.tasks.length,
    1,
    'forwarded approval request addressed directly to owner remains valid',
  );
  assert.equal(saved.tasks[0].forOwner, true);
  assert.equal(saved.tasks[0].selfRequestEvidence, direct);
  const generic = '검토 후 재가 부탁드립니다.';
  const ccMail = { ...source, text: generic, ...ccContext };
  const ccValue = {
    ...directValue,
    intent: { kind: 'request', evidence: generic },
    summary: [{ text: '자료 검토 요청이 전달되었습니다.', evidence: generic }],
    tasks: [
      {
        ...task,
        evidence: generic,
        selfRequestEvidence: generic,
        recipientScope: 'owner_cc',
      },
    ],
  };
  result = await run(ccMail, ccValue);
  assert.equal(result.status, 'done');
  assert.equal(saved.tasks.length, 0, 'CC alone does not assign owner');
  assert.ok(saved.review.reasons.includes('recipient_not_direct'));
  const toMail = {
    ...ccMail,
    ...mailOwnershipContext({ text: generic, headers, account }),
  };
  result = await run(toMail, ccValue);
  assert.equal(result.status, 'done');
  assert.equal(
    saved.tasks.length,
    1,
    'unambiguous current request to owner To remains valid',
  );
  const other = '홍길동님, 검토 후 재가 부탁드립니다.';
  const otherMail = {
    ...source,
    text: other,
    ...mailOwnershipContext({ text: other, headers, account }),
  };
  result = await run(otherMail, {
    ...directValue,
    intent: { kind: 'request', evidence: other },
    summary: [{ text: '타인에게 자료 검토를 요청했습니다.', evidence: other }],
    tasks: [{ ...task, evidence: other, selfRequestEvidence: other }],
  });
  assert.equal(result.status, 'done');
  assert.equal(
    saved.tasks.length,
    0,
    'named other recipient does not become owner task',
  );
  assert.equal(
    MAIL_ANALYSIS_SCHEMA.properties.intent.additionalProperties,
    false,
  );
  assert.equal(
    MAIL_ANALYSIS_SCHEMA.properties.tasks.items.properties.forOwner.type,
    'boolean',
  );
  assert.ok(
    MAIL_ANALYSIS_SCHEMA.properties.tasks.items.required.includes(
      'serviceOriginal',
    ),
  );
  console.log(
    'PASS mail intent: outer forwarding vs quoted approval, source-specific reference override, no To/Cc address transmission, review-only uncertain CC/other actor and valid direct forwarded approval retained',
  );
}
{
  const { analyzePrivateMail, mailOwnershipContext } =
    await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
  const { selectBriefingImages } =
    await import('../supabase/functions/onedrive-auth/private-mail-images.js');
  const text = '업무 자료 참고 바랍니다.';
  const source = {
    id: '11111111-1111-4111-8111-111111111111',
    uidl_hash: 'a'.repeat(64),
    subject: '업무 자료',
    sender: 'sender@example.test',
    text,
    sent_at: '2026-10-30T01:00:00Z',
    created_at: '2026-10-30T02:00:00Z',
    ...mailOwnershipContext({ text }),
  };
  const makeImage = async (id, last) => {
    const bytes = new Uint8Array([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      0,
      0,
      0,
      last,
    ]);
    return {
      id,
      name: 'image00' + last + '.png',
      mediaType: 'image/png',
      width: 200,
      height: 200,
      bytes,
      contentHash: Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join(''),
    };
  };
  source.images = [await makeImage('work-1', 1), await makeImage('card-1', 2)];
  const answer = {
    intent: { kind: 'reference', evidence: text },
    summary: [
      { text: '업무 자료가 참고용으로 전달되었습니다.', evidence: text },
    ],
    group: null,
    issues: [],
    tasks: [],
    waiting: [],
    updates: [],
    imageFacts: [
      {
        imageId: 'work-1',
        text: '하역장 바닥에 물이 고여 있습니다.',
        confidence: 'readable',
      },
      {
        imageId: 'card-1',
        text: 'PRIVATE_CARD_OCR_SENTINEL',
        confidence: 'readable',
      },
    ],
    imageDecisions: [
      { imageId: 'work-1', kind: 'business_scene', include: true },
      { imageId: 'card-1', kind: 'business_card', include: false },
    ],
    imageItems: { tasks: [], issues: [], waiting: [] },
  };
  let analysis;
  const run = (value) =>
    analyzePrivateMail({
      messageId: source.id,
      key: 'fixture-key',
      loadMail: async () => source,
      fetcher: async (url, options) => {
        assert.equal(url, 'https://aiapiflow.com/v1/responses');
        const request = JSON.parse(options.body);
        assert.equal(
          request.input[0].content.filter((item) => item.type === 'input_image')
            .length,
          2,
        );
        return lunaResponseFixture([
          { type: 'text', text: JSON.stringify(value) },
        ]);
      },
      store: {
        claim: async () => ({ row: source, lease: 'fixture' }),
        finish: async ({ analysis: value }) => {
          analysis = value;
          return true;
        },
        fail: async () => true,
      },
    });
  let result = await run(answer);
  assert.equal(result.status, 'done');
  assert.deepEqual(
    analysis.source.images.map((image) => image.id),
    ['work-1'],
  );
  assert.deepEqual(
    analysis.imageFacts.map((fact) => fact.imageId),
    ['work-1'],
  );
  assert.ok(!JSON.stringify(analysis).includes('PRIVATE_CARD_OCR_SENTINEL'));
  assert.deepEqual(
    selectBriefingImages(analysis).map((image) => image.id),
    ['work-1'],
  );
  assert.equal(
    source.images.length,
    2,
    'original loaded image manifest remains intact',
  );
  result = await run({
    ...answer,
    imageDecisions: answer.imageDecisions.slice(0, 1),
  });
  assert.equal(
    result.code,
    'IMAGE_EVIDENCE',
    'every input image needs exactly one decision',
  );
  result = await run({
    ...answer,
    imageDecisions: [
      { imageId: 'work-1', kind: 'uncertain', include: true },
      answer.imageDecisions[1],
    ],
  });
  assert.equal(result.status, 'done');
  assert.equal(analysis.source.images.length, 0);
  assert.equal(analysis.imageFacts.length, 0);
  assert.equal(analysis.imageDecisions[0].include, false);
  assert.deepEqual(selectBriefingImages(analysis), []);
  console.log(
    'PASS analyzed image decisions: scene retained, card OCR excluded from stored/exported analysis, complete image coverage required, uncertain fail-closed and original files untouched',
  );
}
{
  const { createMailSource } =
    await import('../supabase/functions/onedrive-auth/private-mail-source.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const account = 'owner-private@example.test',
    bodyText =
      '참고하시라고 전달드립니다.\n-----Original Message-----\n검토 후 재가 요청드립니다.';
  const emlBytes = new TextEncoder().encode(
    'From: Manager <sender@example.test>\r\nTo: Other <other@example.test>\r\nCc: Owner <' +
      account +
      '>\r\nMessage-ID: <readonly-source@example.test>\r\n\r\nORIGINAL_EML_BODY_SENTINEL',
  );
  const files = [
    {
      kind: 'text',
      item_id: 'body',
      file_name: 'body.txt',
      original_name: '본문.txt',
      byte_size: new TextEncoder().encode(bodyText).length,
    },
    {
      kind: 'eml',
      item_id: 'eml',
      file_name: 'message.eml',
      original_name: 'message.eml',
      byte_size: emlBytes.length,
      content_hash: Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', emlBytes)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join(''),
    },
  ];
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    owner_id: target.owner_id,
    mailbox_id: target.mailbox_id,
    uidl_hash: 'a'.repeat(64),
    subject: '자료 참고',
    sender: 'sender@example.test',
    sent_at: '2026-10-30T01:00:00Z',
    created_at: '2026-10-30T02:00:00Z',
    files,
  };
  const loader = createMailSource({
    db: async () => [],
    withLock: async (fn) => fn(),
    mailbox: async () => ({
      account,
      drive_id: 'drive',
      folder_id: 'folder',
      analysis_rules: [],
    }),
    environment: async () => ({ access: 'fixture-access' }),
    privateDestination: async () => ({}),
    privatePermissions: async () => {},
    verify: async (file) => {
      assert.equal(file.item_id, 'body');
      return new TextEncoder().encode(bodyText);
    },
    graph: async (path) => {
      if (path === '/drives/drive/items/eml/content')
        return new Response(emlBytes);
      const file = files.find(
        (value) => path === '/drives/drive/items/' + value.item_id,
      );
      assert.ok(file);
      return Response.json({
        id: file.item_id,
        name: file.file_name,
        size: file.byte_size,
        file: {},
        parentReference: { driveId: 'drive', id: 'folder' },
      });
    },
  });
  const loaded = await loader.loadMail(row);
  assert.equal(loaded.ownerContext.recipientRole, 'cc');
  assert.equal(loaded.currentBody, '참고하시라고 전달드립니다.');
  assert.ok(loaded.documentBody.includes('재가 요청'));
  assert.ok(!loaded.headers.includes('ORIGINAL_EML_BODY_SENTINEL'));
  assert.equal(loaded.text, bodyText);
  assert.equal(row.files.length, 2);
  files.push({
    kind: 'attachment',
    item_id: 'blocked-image',
    file_name: 'image001.png',
    original_name: 'image001.png',
    byte_size: 100,
  });
  const scoped = createMailSource({
    db: async () => {
      throw Error('related mail must not be loaded');
    },
    withLock: async (fn) => fn(),
    mailbox: async () => ({
      account,
      drive_id: 'drive',
      folder_id: 'folder',
      analysis_rules: [],
      automation_config: { analysisScopes: { [row.id]: 'body_headers' } },
    }),
    environment: async () => ({ access: 'fixture-access' }),
    privateDestination: async () => ({}),
    privatePermissions: async () => {},
    verify: async (file) => {
      assert.equal(file.item_id, 'body');
      return new TextEncoder().encode(bodyText);
    },
    graph: async (path) => {
      if (path === '/drives/drive/items/eml/content')
        return new Response(emlBytes);
      const file = files.find(
        (value) => path === '/drives/drive/items/' + value.item_id,
      );
      assert.ok(file);
      assert.notEqual(file.item_id, 'blocked-image');
      return Response.json({
        id: file.item_id,
        name: file.file_name,
        size: file.byte_size,
        file: {},
        parentReference: { driveId: 'drive', id: 'folder' },
      });
    },
  });
  const limited = await scoped.loadMail(row);
  assert.equal(limited.analysisScope, 'body_headers');
  assert.deepEqual(limited.images, []);
  assert.deepEqual(limited.related, []);
  assert.equal(limited.text, bodyText);
  assert.equal(limited.ownerContext.recipientRole, 'cc');
  console.log(
    'PASS readonly mail source: verified EML header-only owner To/Cc role, current/forwarded bodies separated and original source preserved',
  );
}

{
  const { normalizeMailAnalysis, renderDailyBriefing } =
    await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
  const source = {
    id: '00000000-0000-4000-8000-000000000003',
    uidl_hash: 'a'.repeat(64),
    subject: '배차 요청',
    sender: '운수사',
    sent_at: '2026-10-30T08:00:00Z',
    created_at: '2026-10-30T08:01:00Z',
    text: '11월2일 배차 부탁합니다. 오늘17:00까지 회신 부탁합니다.',
  };
  const value = {
    summary: [],
    issues: [],
    tasks: [
      {
        text: '11/2 운행 차량 배차',
        evidence: source.text,
        serviceOriginal: '11월2일',
        due: null,
      },
      {
        text: '회신',
        evidence: source.text,
        serviceOriginal: null,
        due: '오늘17:00까지',
      },
    ],
    waiting: [],
  };
  const normalized = normalizeMailAnalysis(value, source);
  assert.equal(normalized.tasks[0].visibleFrom, '2026-10-30');
  assert.equal(normalized.tasks[0].serviceDate, '2026-11-02');
  assert.equal(normalized.tasks[0].dueDate, null);
  assert.equal(normalized.tasks[1].dueAt, '2026-10-30T08:00:00.000Z');
  const page = renderDailyBriefing({
    now: '2026-10-30T09:00:00Z',
    analyses: [normalized],
  });
  assert.match(page.managedHtml, /운행·납품 2026-11-02/);
  assert.match(page.managedHtml, /기한 2026-10-30 17:00/);
  assert.doesNotMatch(page.html, /<h2>\d+\./);
  console.log(
    'PASS mail: immediate task visibility, service date independent of deadline, explicit KST time, unnumbered sections',
  );
}

{
  const { dailyBriefingView, renderDailyBriefing } =
    await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
  const id = '00000000-0000-4000-8000-000000000003';
  const old = {
    source: {
      id,
      uidl: 'a'.repeat(64),
      subject: '어제 요청',
      sender: '운수사',
      sentAt: '2026-10-30T08:00:00Z',
      receivedAt: '2026-10-30T08:00:00Z',
      carryOnly: true,
    },
    revision: 1,
    updatedAt: '2026-10-30T08:00:00Z',
    summary: [{ text: '어제 참고', evidence: '요청' }],
    tasks: [
      {
        text: '11/2 배차',
        evidence: '요청',
        status: 'pending',
        serviceDate: '2026-11-02',
      },
    ],
    issues: [],
    waiting: [],
  };
  const now = '2026-10-31T09:00:00Z';
  assert.equal(dailyBriefingView({ now, analyses: [old] }).tasks.length, 1);
  const closed = dailyBriefingView({
    now,
    analyses: [old],
    overrides: {
      [id + ':tasks:0']: {
        actor: 'owner',
        done: true,
        updatedAt: '2026-10-30T09:00:00Z',
      },
    },
  });
  assert.equal(
    closed.tasks.length,
    0,
    'prior completed task must not return as today task',
  );
  const html = renderDailyBriefing({ now, analyses: [old] }).managedHtml;
  assert.match(html, /11\/2 배차/);
  assert.doesNotMatch(html, /어제 참고/);
  console.log(
    'PASS mail carry: incomplete visible now, prior completed removed, old summary not repeated',
  );
}

{
  const { createMailHistoryDocument, restoreMailHistoryDocument } =
    await import('../supabase/functions/onedrive-auth/private-mail-history.js');
  const { handleMailAutomation } =
    await import('../supabase/functions/onedrive-auth/private-mail-background.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const snapshot = {
    kind: 'mail',
    sourceId: crypto.randomUUID(),
    revision: 1,
    eventAt: '2026-10-30T08:00:00Z',
    model: 'unknown',
    rulesVersion: 'legacy-unversioned',
    structuredResult: { summary: [{ text: '참고자료' }], tasks: [] },
    correction: { intent: 'reference', reason: '발신자의 참고용 공유' },
    completionEvents: [],
  };
  const document = await createMailHistoryDocument(snapshot);
  const rawPayload = JSON.stringify(document.record, null, 2);
  const restored = await restoreMailHistoryDocument(
    JSON.parse(rawPayload),
    rawPayload,
  );
  assert.equal(new TextDecoder().decode(restored.bytes), rawPayload);
  assert.notEqual(restored.historyId, document.historyId);
  await assert.rejects(
    () =>
      createMailHistoryDocument({
        ...snapshot,
        structuredResult: { api_key: 'never-store' },
      }),
    /HISTORY_FORMAT/,
  );
  const entryId = crypto.randomUUID();
  let writes = 0,
    finishes = 0,
    claims = 0;
  const context = {
    background: true,
    db: async (path, options) => {
      if (path.startsWith('private_mailboxes?'))
        return [
          {
            id: target.mailbox_id,
            owner_id: target.owner_id,
            automation_config: {},
            briefing_pages: { '2026-10-30': { ownerPreviewHold: true } },
          },
        ];
      if (path === 'rpc/private_mail_history_claim') {
        claims++;
        return [
          {
            id: entryId,
            mailbox_id: target.mailbox_id,
            owner_id: target.owner_id,
            payload: rawPayload,
            history_id: restored.historyId,
            file_name: restored.fileName,
          },
        ];
      }
      if (path === 'rpc/private_mail_history_finish') {
        assert.equal(options.body.p_history, entryId);
        assert.equal(options.body.p_item_id, 'verified-json');
        finishes++;
        return true;
      }
      throw Error('Unexpected path ' + path);
    },
    json: Response.json,
    fail: (message, status) => Object.assign(Error(message), { status }),
    connectedNotes: () => {
      throw Error('OneNote must remain untouched');
    },
    writeHistory: async (value) => {
      writes++;
      assert.equal(value.historyId, restored.historyId);
      return { itemId: 'verified-json' };
    },
  };
  const result = await handleMailAutomation(
    'private-mail-background-work',
    { operation: 'history', id: entryId, mailbox: target.mailbox_id },
    { id: target.owner_id },
    context,
  );
  assert.equal((await result.json()).status, 'done');
  assert.equal(claims, 1);
  assert.equal(writes, 1);
  assert.equal(finishes, 1);
  const held = await handleMailAutomation(
    'private-mail-background-work',
    { operation: 'report', day: '2026-10-30', mailbox: target.mailbox_id },
    { id: target.owner_id },
    context,
  );
  assert.deepEqual(await held.json(), {
    status: 'waiting',
    code: 'OWNER_REVIEW',
  });
  assert.equal(claims, 1);
  console.log(
    'PASS history integration: raw SQL payload preserved, credential fields rejected, exact delivery acknowledgment and owner-held Note untouched',
  );
}

{
  const { deadline } =
    await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  assert.equal(
    deadline('11월2일', '회신기한: 11월2일', '2026-10-30').dueDate,
    '2026-11-02',
  );
  assert.equal(
    deadline('11월2일', '11월2일 운행, 마감: 11월1일', '2026-10-30').dueDate,
    null,
  );
  console.log(
    'PASS labelled deadline: adjacent explicit label only, no service date promoted',
  );
}

{
  const { reconcileMailItems, dailyBriefingView } =
    await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
  const source = {
    id: '00000000-0000-4000-8000-000000000003',
    uidl: 'a'.repeat(64),
    subject: '업무',
    sender: '발신자',
    sentAt: '2026-10-30T08:00:00Z',
    receivedAt: '2026-10-30T08:00:00Z',
  };
  const a = {
      text: '배차 확인',
      evidence: '배차 확인 부탁합니다',
      status: 'pending',
    },
    b = { text: '회신', evidence: '결과 회신 부탁합니다', status: 'pending' },
    c = {
      text: '서류 제출',
      evidence: '서류 제출 부탁합니다',
      status: 'pending',
    };
  const old = {
    source,
    revision: 1,
    summary: [],
    issues: [],
    waiting: [],
    tasks: [a, b],
    imageItems: { tasks: [], issues: [], waiting: [] },
  };
  const revised = structuredClone({ ...old, tasks: [b, c, a] });
  reconcileMailItems(revised, old);
  assert.deepEqual(
    revised.tasks.map((x) => x.itemIndex),
    [1, 2, 0],
  );
  const view = dailyBriefingView({
    now: '2026-10-30T09:00:00Z',
    analyses: [revised],
    overrides: {
      [source.id + ':tasks:0']: {
        actor: 'owner',
        done: true,
        updatedAt: '2026-10-30T08:30:00Z',
      },
    },
  });
  assert.equal(view.tasks.find((x) => x.text === a.text).status, 'complete');
  assert.equal(view.tasks.find((x) => x.text === c.text).status, 'pending');
  const cleared = structuredClone({ ...revised, tasks: [] });
  reconcileMailItems(cleared, revised);
  const fresh = structuredClone({
    ...cleared,
    tasks: [{ ...c, text: '새로운 업무' }],
  });
  reconcileMailItems(fresh, cleared);
  assert.equal(
    fresh.tasks[0].itemIndex,
    3,
    'retired index cannot attach old completed checkbox to new work',
  );
  console.log(
    'PASS stable mail items: reordered exact source tasks retain completion; new/reintroduced work never reuses retired refs',
  );
}

{
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const entryId = crypto.randomUUID();
  let queued = 0;
  const entry = {
    entryId,
    status: 'ready',
    submittedAt: '2026-10-30T08:00:00Z',
    referenceDate: '2026-10-30',
    items: [
      {
        itemId: 'item-001',
        text: '자료 회신',
        kind: 'task',
        visibleFrom: '2026-10-30',
        submittedAt: '2026-10-30T08:00:00Z',
        done: false,
      },
    ],
  };
  const ctx = {
    aiKey: 'mock-only',
    json: Response.json,
    fail: (message, status) => Object.assign(Error(message), { status }),
    db: async (path, options) => {
      if (path.startsWith('private_mailboxes?'))
        return [
          {
            id: target.mailbox_id,
            owner_id: target.owner_id,
            enabled: true,
            manual_entries: {},
          },
        ];
      if (path === 'rpc/private_mail_manual_claim')
        return { claimed: false, entry };
      if (path === 'rpc/private_mail_dispatch_report') {
        assert.deepEqual(options.body, {
          p_box: target.mailbox_id,
          p_report_day: '2026-10-30',
        });
        queued++;
        return true;
      }
      throw Error('Unexpected manual route ' + path);
    },
  };
  const response = await handlePrivateMail(
    'private-mail-manual-add',
    new Request('https://test.example', {
      method: 'POST',
      body: JSON.stringify({
        text: '자료 회신 부탁합니다',
        clientRequestId: entryId,
      }),
    }),
    { id: target.owner_id },
    ctx,
  );
  assert.equal((await response.json()).reportQueued, true);
  assert.equal(queued, 1);
  console.log(
    'PASS manual API route: duplicate ready result dispatches only exact named SQL report day without another model call',
  );
}

{
  const warnings = [];
  const warn = console.warn;
  console.warn = (tag, metadata) => warnings.push({ tag, metadata });
  try {
    await assert.rejects(
      () =>
        callLuna({
          key: 'PRIVATE_KEY_SENTINEL',
          prompt: 'synthetic provider failure check',
          fetcher: async () =>
            new Response('PRIVATE_PROVIDER_BODY_SENTINEL', { status: 503 }),
        }),
      (error) => error.providerStatus === 503,
    );
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, [
    {
      tag: 'PRIVATE_MAIL_MODEL_FAILURE',
      metadata: { model: LUNA_MODEL, reason: 'http', providerStatus: 503 },
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(warnings),
    /PRIVATE_KEY_SENTINEL|PRIVATE_PROVIDER_BODY_SENTINEL/,
  );
  console.log(
    'PASS model diagnostics: provider HTTP status retained without key, body or private input',
  );
}

{
  const { applyMailIntentOverride } =
    await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
  const analysis = {
    source: { id: '00000000-0000-4000-8000-000000000003' },
    summary: [{ text: '참고자료' }],
    tasks: [{ text: '과거오인업무' }],
    waiting: [{ text: '과거오인대기' }],
    updates: [{ ref: 'old' }],
    imageItems: { tasks: [{ text: '문서요청' }], waiting: [], issues: [] },
  };
  const original = structuredClone(analysis);
  const projected = applyMailIntentOverride(analysis, { intent: 'reference' });
  assert.equal(projected.tasks.length, 0);
  assert.equal(projected.waiting.length, 0);
  assert.equal(projected.updates.length, 0);
  assert.equal(projected.imageItems.tasks.length, 0);
  assert.equal(projected.source.intent, 'reference');
  assert.deepEqual(analysis, original);
  assert.deepEqual(projected.summary, original.summary);
  assert.equal(applyMailIntentOverride(analysis, undefined), analysis);
  console.log(
    'PASS owner correction projection: explicit source reference wins over legacy task inference without modifying saved analysis or completion history',
  );
}

{
  let calls = 0;
  await assert.rejects(
    () =>
      callLuna({
        key: 'mock-only',
        prompt: 'synthetic minimum boundary',
        maxTokens: 15,
        fetcher: async () => {
          calls++;
          throw Error('must not run');
        },
      }),
    (error) => error.reason === 'configuration',
  );
  assert.equal(calls, 0);
  console.log(
    'PASS Luna minimum output limit: invalid allocation rejected before provider',
  );
}
{
  const { dailyWorkItems, normalizeDailyWork, renderWorkSections } =
    await import('../supabase/functions/onedrive-auth/private-mail-work.js');
  const { readStructuredWorkInput } =
    await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const third = '33333333-3333-4333-8333-333333333333';
  const ref = first + ':manual:item-001';
  const base = { groups: [], tasks: [], issues: [], waiting: [] };
  const original = {
    entryId: first,
    submittedAt: '2026-10-30T01:00:00Z',
    items: [
      {
        ref,
        kind: 'dispatch',
        text: '11/2 운행 차량 배차',
        serviceDate: '2026-11-02',
        evidence: '11월 2일 배차 요청',
        status: 'complete',
        done: true,
        completedAt: '2026-10-30T04:00:00Z',
        ownerStateAt: '2026-10-30T04:00:00Z',
      },
    ],
  };
  const followup = {
    entryId: second,
    submittedAt: '2026-10-31T01:00:00Z',
    items: [
      {
        ref: second + ':manual:item-001',
        workRef: ref,
        kind: 'reference',
        text: '차량 정보 참고',
        evidence: '차량 정보 참고',
        status: 'pending',
        done: false,
      },
    ],
  };
  const works = dailyWorkItems(base, {
    workContext: [original],
    entries: [followup],
  });
  assert.equal(works.length, 1);
  assert.equal(works[0].workId, ref);
  assert.equal(works[0].status, 'complete');
  assert.equal(works[0].category, 'task');
  assert.equal(works[0].serviceDate, '2026-11-02');
  assert.equal(works[0].dueAt, null);
  assert.equal(
    works[0].requestedAt,
    new Date(original.submittedAt).toISOString(),
  );
  assert.ok(works[0].sourceRefs.some((source) => source.id === second));
  const pending = dailyWorkItems(base, {
    entries: [
      {
        ...original,
        items: [
          {
            ...original.items[0],
            status: 'pending',
            done: false,
            completedAt: null,
            ownerStateAt: null,
          },
        ],
      },
    ],
  });
  assert.equal(pending[0].section, 'tasks');
  assert.equal(pending[0].serviceDate, '2026-11-02');
  const unrelated = dailyWorkItems(base, {
    entries: [
      original,
      {
        ...followup,
        items: [
          {
            ...followup.items[0],
            workRef: null,
            kind: 'task',
            text: original.items[0].text,
          },
        ],
      },
    ],
  });
  assert.equal(
    unrelated.length,
    2,
    'same title alone must not join unrelated work',
  );
  const html = renderWorkSections(works);
  assert.ok(html.includes('완료'));
  assert.ok(!html.includes('담당자: 미지정'));
  assert.ok(!html.includes('?entry=' + first));
  const reference = readStructuredWorkInput(
    JSON.stringify({
      schema: 'sajo-daily-work-v1',
      origin: 'assistant',
      sourceText: '허 차장님이 참고하라고 전달한 숙소 자료',
      items: [
        {
          category: 'reference',
          title: '숙소 지원 참고자료',
          evidence: '참고하라고 전달한 숙소 자료',
        },
      ],
    }),
  );
  assert.equal(reference.items[0].kind, 'reference');
  const direct = readStructuredWorkInput(
    JSON.stringify({
      schema: 'sajo-daily-work-v1',
      origin: 'manual',
      sourceText: '장희성님 검토 및 재가 요청드립니다',
      items: [
        {
          category: 'task',
          title: '숙소 지원 검토',
          evidence: '장희성님 검토 및 재가 요청드립니다',
        },
      ],
    }),
  );
  assert.equal(direct.items[0].kind, 'task');
  assert.throws(
    () =>
      readStructuredWorkInput(JSON.stringify({ schema: 'sajo-daily-work-v2' })),
    /MANUAL_FORMAT/,
  );
  assert.throws(
    () =>
      readStructuredWorkInput(
        JSON.stringify({
          schema: 'sajo-daily-work-v1',
          origin: 'manual',
          sourceText: '처리 예정',
          items: [
            {
              category: 'task',
              title: '처리',
              evidence: '처리 예정',
              status: 'complete',
            },
          ],
        }),
      ),
    /MANUAL_EVIDENCE/,
  );
  assert.throws(
    () =>
      normalizeDailyWork({
        ref,
        category: 'task',
        title: '배차',
        status: 'pending',
        serviceDate: '2026-02-30',
        sourceRefs: [{ kind: 'manual', id: first, ref }],
      }),
    /WORK_DATE/,
  );
  console.log(
    'PASS common daily work: stable identity, future service preparation, owner completion preservation, explicit links only, reference/direct request distinction and no fabricated completion',
  );
}
{
  const { dailyWorkItems } =
    await import('../supabase/functions/onedrive-auth/private-mail-work.js');
  const { manualDailyView, normalizeManualItems, readStructuredWorkInput } =
    await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const entryId = '44444444-4444-4444-8444-444444444444',
    mailId = '55555555-5555-4555-8555-555555555555';
  const mailRef = mailId + ':tasks:0';
  const input = readStructuredWorkInput(
    JSON.stringify({
      schema: 'sajo-daily-work-v1',
      origin: 'manual',
      sourceText: '배차 처리했습니다',
      items: [
        {
          category: 'task',
          title: '배차 처리',
          evidence: '배차 처리했습니다',
          status: 'complete',
          workRef: mailRef,
        },
      ],
    }),
  );
  const items = normalizeManualItems(input, {
    text: input.sourceText,
    submittedAt: '2026-10-30T01:00:00Z',
    referenceDate: null,
    entryId,
    allowLinks: true,
    origin: 'manual',
  });
  const entry = {
    entryId,
    status: 'ready',
    submittedAt: '2026-10-30T01:00:00Z',
    referenceDate: null,
    items,
  };
  const nextDay = manualDailyView({ [entryId]: entry }, '2026-10-31');
  assert.equal(nextDay.entries.length, 0);
  assert.equal(
    nextDay.workContext.length,
    1,
    'hidden owner completion must survive as linked context',
  );
  const view = {
    day: '2026-10-31',
    groups: [],
    tasks: [
      {
        ref: mailRef,
        text: '배차 처리',
        status: 'pending',
        source: {
          id: mailId,
          subject: '배차 요청',
          receivedAt: '2026-10-30T00:00:00Z',
        },
      },
    ],
    issues: [],
    waiting: [],
  };
  assert.equal(
    dailyWorkItems(view, nextDay).length,
    0,
    'closed linked mail task must not reappear pending next day',
  );
  const reopened = {
    ...entry,
    items: [
      {
        ...items[0],
        completionEvents: [{ done: false, at: '2026-10-31T01:00:00Z' }],
      },
    ],
  };
  const open = dailyWorkItems(
    view,
    manualDailyView({ [entryId]: reopened }, '2026-10-31'),
  );
  assert.equal(open.length, 1);
  assert.equal(open[0].status, 'pending');
  const issue = dailyWorkItems(
    { groups: [], tasks: [], issues: [], waiting: [] },
    {
      entries: [
        {
          entryId,
          submittedAt: entry.submittedAt,
          items: [
            {
              ref: entryId + ':manual:item-002',
              kind: 'waiting',
              text: '운수사 회신 대기',
              status: 'pending',
              done: false,
            },
          ],
        },
      ],
    },
  );
  assert.equal(
    issue[0].controlRef,
    entryId + ':manual:item-002',
    'manual issues retain owner completion control',
  );
  console.log(
    'PASS linked owner-state carry: completed mail does not resurrect; explicit reopen wins; manual waiting remains completable',
  );
}
{
  const { callLuna } = await import('../supabase/functions/_shared/luna.js');
  let requests = 0;
  await assert.rejects(
    () =>
      callLuna({
        provider: 'openai',
        key: 'mock-only',
        prompt: 'synthetic output-budget reproduction',
        maxTokens: 6000,
        fetcher: async (url, options) => {
          requests++;
          const body = JSON.parse(options.body);
          assert.deepEqual(
            body.reasoning,
            { effort: 'low' },
            'official daily extraction must set bounded low reasoning effort',
          );
          assert.equal(
            body.max_output_tokens,
            6000,
            'do not silently increase paid output budget',
          );
          assert.equal(body.store, false);
          return Response.json({
            model: 'gpt-6-luna',
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [],
            usage: {
              input_tokens: 101,
              output_tokens: 6000,
              total_tokens: 6101,
              output_tokens_details: { reasoning_tokens: 6000 },
              private: 'NEVER_LOG',
            },
          });
        },
      }),
    (error) => {
      assert.equal(error.code, 'MODEL_TRUNCATED');
      assert.equal(
        error.modelResponseShape.incompleteReason,
        'max_output_tokens',
      );
      assert.equal(error.modelResponseShape.usage.reasoning_tokens, 6000);
      assert.equal(error.modelResponseShape.usage.output_tokens, 6000);
      assert.ok(
        !JSON.stringify(error.modelResponseShape).includes('NEVER_LOG'),
      );
      return true;
    },
  );
  assert.equal(
    requests,
    1,
    'truncation must not trigger an automatic paid retry',
  );
  console.log(
    'PASS official reasoning budget: explicit low effort, unchanged token cap, safe truncation usage diagnostics and no automatic retry',
  );
}
{
  const { callLuna } = await import('../supabase/functions/_shared/luna.js');
  const schema = {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  };
  let calls = 0;
  await assert.rejects(
    () =>
      callLuna({
        provider: 'openai',
        key: 'mock',
        prompt: '비민감 예문',
        schema,
        schemaName: 'probe',
        maxTokens: 6000,
        fetcher: async () => {
          calls++;
          return Response.json(
            {
              model: 'gpt-6-luna',
              status: 'incomplete',
              incomplete_details: { reason: 'max_output_tokens' },
              output: [],
              usage: {
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
                output_tokens_details: { reasoning_tokens: 0 },
              },
            },
            { headers: { 'x-request-id': 'req_public-diagnostic' } },
          );
        },
      }),
    (error) => {
      assert.equal(
        error.code,
        'MODEL_RESPONSE',
        'zero usage/empty response is not proof of consumed output budget',
      );
      assert.equal(error.reason, 'empty_incomplete');
      assert.equal(
        error.modelResponseShape.promptBytes >
          new TextEncoder().encode('비민감 예문').byteLength,
        true,
      );
      assert.equal(
        error.modelResponseShape.schemaBytes,
        new TextEncoder().encode(JSON.stringify(schema)).byteLength,
      );
      assert.equal(error.modelResponseShape.requestId, 'req_public-diagnostic');
      assert.equal(error.modelResponseShape.imageCount, 0);
      assert.ok(
        !JSON.stringify(error.modelResponseShape).includes('비민감 예문'),
      );
      return true;
    },
  );
  assert.equal(calls, 1);
  console.log(
    'PASS empty provider completion: zero-usage incomplete response distinguished, safe request dimensions/id logged, no automatic retries',
  );
}
{
  const { MAIL_ANALYSIS_SCHEMA } =
    await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
  const { callLuna } = await import('../supabase/functions/_shared/luna.js');
  const valid = {
    intent: { kind: 'reference', evidence: '참고용 테스트 자료입니다.' },
    group: null,
    summary: [
      {
        text: '참고용 테스트 자료 공유',
        evidence: '참고용 테스트 자료입니다.',
      },
    ],
    issues: [],
    tasks: [],
    waiting: [],
    updates: [],
    imageFacts: [],
    imageDecisions: [],
    imageItems: { tasks: [], issues: [], waiting: [] },
  };
  const response = (value) =>
    Response.json({
      model: 'gpt-6-luna',
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: JSON.stringify(value) }],
        },
      ],
      usage: {
        input_tokens: 155,
        output_tokens: 114,
        total_tokens: 269,
        output_tokens_details: { reasoning_tokens: 26 },
      },
    });
  const args = {
    provider: 'openai',
    key: 'mock-only',
    prompt: '합성 참고 자료',
    schema: MAIL_ANALYSIS_SCHEMA,
    schemaName: 'private_mail_analysis',
    maxTokens: 6000,
  };
  let calls = 0;
  const result = await callLuna({
    ...args,
    fetcher: async (url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.deepEqual(body.text.format, { type: 'json_object' });
      assert.equal(body.max_output_tokens, 6000);
      assert.deepEqual(body.reasoning, { effort: 'low' });
      assert.ok(
        body.input[0].content[0].text.includes(
          JSON.stringify(MAIL_ANALYSIS_SCHEMA),
        ),
        'full original contract must remain in instructions',
      );
      return response(valid);
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(result.content[0].text), valid);
  for (const [label, mutate] of [
    ['missing required field', (v) => delete v.intent.evidence],
    ['extra property', (v) => (v.intent.unrequested = 'forbidden')],
    ['invalid enum', (v) => (v.intent.kind = 'made-up')],
    ['wrong nullable type', (v) => (v.group = 4)],
    [
      'array exceeds original maxItems',
      (v) => (v.summary = Array(4).fill(v.summary[0])),
    ],
    [
      'string exceeds original maxLength',
      (v) => (v.summary[0].text = 'x'.repeat(1001)),
    ],
    ['string below original minLength', (v) => (v.summary[0].text = '')],
    [
      'ref violates original pattern',
      (v) =>
        (v.updates = [
          { ref: 'invalid', status: 'pending', evidence: '자료', text: null },
        ]),
    ],
    ['nested field missing', (v) => delete v.imageItems.tasks],
  ]) {
    const value = structuredClone(valid);
    mutate(value);
    let n = 0;
    await assert.rejects(
      () =>
        callLuna({
          ...args,
          fetcher: async () => {
            n++;
            return response(value);
          },
        }),
      (error) => {
        assert.equal(error.code, 'MODEL_RESPONSE', label);
        assert.equal(error.reason, 'json_contract', label);
        assert.ok(error.modelResponseShape.contractFailure.keyword);
        return true;
      },
    );
    assert.equal(n, 1, label + ' must not retry');
  }
  console.log(
    'PASS official JSON mode: full contract instruction, reasoning/message extraction, all original schema constraints fail closed without retries',
  );
}
{
  const { refreshNotesConnection } =
    await import('../supabase/functions/onedrive-auth/private-mail-notes-auth.js');
  const original = {
    purpose: 'mail-briefing',
    notesGranted: true,
    accessToken: 'old-mock',
    refreshToken: 'refresh-mock',
    expiresAt: 0,
  };
  let writes = 0;
  const helpers = {
    now: () => 100000,
    fail: (code, status) => Object.assign(Error(code), { status }),
    grant: async () => ({ access_token: 'new-mock', expires_in: 3600 }),
    save: async (data) => {
      writes++;
      assert.equal(data.refreshToken, 'refresh-mock');
    },
  };
  const renewed = await refreshNotesConnection(original, helpers);
  assert.equal(renewed.notesGranted, true);
  assert.equal(renewed.accessToken, 'new-mock');
  assert.equal(writes, 1);
  assert.equal(
    original.accessToken,
    'old-mock',
    'failed or pending refresh must not mutate prior saved grant',
  );
  await assert.rejects(
    () =>
      refreshNotesConnection(original, {
        ...helpers,
        grant: async () => ({
          scope: 'Files.ReadWrite',
          access_token: 'not-notes',
          expires_in: 3600,
        }),
      }),
    (error) =>
      error.message === 'NOTES_PERMISSION_REQUIRED' &&
      error.connectionReason === 'scope',
  );
  await assert.rejects(
    () => refreshNotesConnection({ ...original, purpose: 'files' }, helpers),
    (error) =>
      error.message === 'NOTES_PERMISSION_REQUIRED' &&
      error.connectionReason === 'purpose',
  );
  await assert.rejects(
    () =>
      refreshNotesConnection(original, {
        ...helpers,
        grant: async () => {
          throw Object.assign(Error('opaque OAuth failure'), {
            status: 409,
            oauthCode: 'invalid_grant',
          });
        },
      }),
    (error) =>
      error.message === 'NOTES_PERMISSION_REQUIRED' &&
      error.connectionReason === 'refresh' &&
      error.oauthCode === 'invalid_grant',
  );
  assert.equal(
    writes,
    1,
    'invalid scope/metadata/refresh must preserve saved connection',
  );
  for (const fresh of [
    null,
    { scope: null, access_token: 'mock', expires_in: 3600 },
  ])
    await assert.rejects(
      () =>
        refreshNotesConnection(original, {
          ...helpers,
          grant: async () => fresh,
        }),
      (error) => error.message === 'NOTES_PERMISSION_REQUIRED',
    );
  console.log(
    'PASS Notes refresh: omitted unchanged scope inherits existing valid consent; explicit scope loss/invalid metadata/revoked refresh fail closed without overwriting connection',
  );
}

{
  const { recoverMailPhotoMetadata, selectMailPhotos, needsMailPhotoMetadata } =
    await import('../supabase/functions/onedrive-auth/private-mail-images.js');
  const payload = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const hash = Buffer.from(
    await crypto.subtle.digest('SHA-256', payload),
  ).toString('hex');
  const makeRaw = (signature, name = 'image001.png') =>
    new TextEncoder().encode(
      'Date: Fri, 30 Oct 2026 09:00:00 +0900\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="case"\r\n\r\n--case\r\nContent-Type: text/html; charset=utf-8\r\n\r\n' +
        (signature
          ? '<div class="gmail_signature"><img src="cid:random-part-id"></div>'
          : '<p>현장 사진</p><img src="cid:random-part-id">') +
        '\r\n--case\r\nContent-Type: image/png' +
        (name ? '; name="' + name + '"' : '') +
        '\r\nContent-Disposition: inline' +
        (name ? '; filename="' + name + '"' : '') +
        '\r\nContent-ID: <random-part-id>\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
        payload.toString('base64') +
        '\r\n--case--\r\n',
    );
  for (const [signature, name] of [
    [true, 'image001.png'],
    [false, 'image001.png'],
    [false, null],
  ]) {
    const file = {
      kind: 'attachment',
      index: 2,
      name: name ?? 'attachment',
      original_name: name ?? 'attachment',
      content_hash: hash,
      byte_size: payload.length,
    };
    const files = await recoverMailPhotoMetadata(
      [file],
      makeRaw(signature, name),
    );
    assert.equal(files[0].index, 2);
    assert.equal(files[0].content_hash, hash);
    assert.equal(files[0].name, file.name);
    const html = signature
      ? '<div class="gmail_signature"><img src="cid:random-part-id"></div>'
      : '<p>현장 사진</p><img src="cid:random-part-id">';
    const selected = selectMailPhotos({ files, html });
    assert.equal(selected.selected.length, signature ? 0 : 1);
    if (signature) assert.equal(selected.excluded[0].reason, 'SIGNATURE_IMAGE');
  }
  console.log(
    'PASS original MIME metadata: signature excluded before model, generic/unnamed business images retained, source index/hash/name immutable',
  );

  const raw = makeRaw(false);
  const file = {
    kind: 'attachment',
    index: 2,
    name: 'image001.png',
    original_name: 'image001.png',
    content_hash: hash,
    byte_size: payload.length,
  };
  assert.equal(
    needsMailPhotoMetadata([file], '<img src="cid:random-part-id">'),
    true,
  );
  assert.equal(
    needsMailPhotoMetadata([file], '<img src="cid:image001.png">'),
    false,
  );
  await assert.rejects(
    () =>
      recoverMailPhotoMetadata(
        [{ ...file, content_hash: 'f'.repeat(64) }],
        raw,
      ),
    /IMAGE_CONTEXT_REVIEW/,
  );
  await assert.rejects(
    () =>
      recoverMailPhotoMetadata(
        [{ ...file, byte_size: payload.length + 1 }],
        raw,
      ),
    /IMAGE_CONTEXT_REVIEW/,
  );
  const duplicate = new TextEncoder().encode(
    new TextDecoder()
      .decode(raw)
      .replace(
        '--case--',
        '--case\r\nContent-Type: image/png; name="second.png"\r\nContent-Disposition: inline; filename="second.png"\r\nContent-ID: <other-cid>\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
          payload.toString('base64') +
          '\r\n--case--',
      ),
  );
  await assert.rejects(
    () => recoverMailPhotoMetadata([file], duplicate),
    /IMAGE_CONTEXT_REVIEW/,
  );
  const base64url = Buffer.from(hash, 'hex').toString('base64url');
  const recovered = await recoverMailPhotoMetadata(
    [{ ...file, content_hash: base64url }],
    raw,
  );
  assert.equal(recovered[0].content_hash, base64url);
  console.log(
    'PASS MIME recovery trust: exact original bytes hash/size, ambiguous CID rejects, legacy hash encoding and identity preserved',
  );
}
{
  const {
    readStructuredWorkInput,
    normalizeManualItems,
    manualDailyView,
    handleManualMessage,
  } =
    await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const { APPROVED_MAIL_TARGET: T } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  for (const status of ['complete', 'cancelled']) {
    const id = '77777777-7777-4777-8777-777777777777';
    const sourceText =
      status === 'complete' ? '배차 처리했습니다' : '배차 요청을 취소합니다';
    const text = JSON.stringify({
      schema: 'sajo-daily-work-v1',
      origin: 'assistant',
      sourceText,
      items: [
        {
          category: 'task',
          title: '배차 처리',
          evidence: sourceText,
          status,
          ...(status === 'cancelled'
            ? {
                workRef: '66666666-6666-4666-8666-666666666666:manual:item-001',
              }
            : {}),
        },
      ],
    });
    const structured = readStructuredWorkInput(text);
    const [item] = normalizeManualItems(structured, {
      text: sourceText,
      submittedAt: '2026-10-30T01:00:00Z',
      referenceDate: '2026-10-30',
      entryId: id,
      allowLinks: true,
      origin: 'assistant',
    });
    item.completionEvents = [
      ...(status === 'complete'
        ? [{ done: true, at: '2026-10-30T01:00:00Z' }]
        : []),
      { done: false, at: '2026-10-31T01:00:00Z' },
    ];
    item.ownerUpdatedAt = '2026-10-31T01:00:00Z';
    const entry = {
      entryId: id,
      status: 'ready',
      submittedAt: '2026-10-30T01:00:00Z',
      referenceDate: '2026-10-30',
      text,
      items: [item],
    };
    const past = manualDailyView({ [id]: entry }, '2026-10-30').entries[0]
      .items[0];
    assert.equal(past.status, status);
    assert.equal(
      Date.parse(past.ownerStateAt),
      Date.parse('2026-10-30T01:00:00Z'),
      'future reopening must not change past owner state',
    );
    const present = manualDailyView({ [id]: entry }, '2026-10-31').entries[0]
      .items[0];
    assert.equal(present.status, 'pending');
    assert.equal(present.done, false);
    const replay = await handleManualMessage(
      'private-mail-manual-add',
      { clientRequestId: '88888888-8888-4888-8888-888888888888', text },
      { id: T.owner_id },
      {
        json: (x) => Response.json(x),
        fail: (m) => Error(m),
        db: async (path) =>
          path.startsWith('private_mailboxes?')
            ? [
                {
                  id: T.mailbox_id,
                  owner_id: T.owner_id,
                  enabled: true,
                  manual_entries: { [id]: entry },
                },
              ]
            : { entry, claimed: false },
        fetcher: async () =>
          assert.fail('ready replay must not call any model'),
      },
    );
    const body = await replay.json();
    assert.equal(body.items[0].done, false);
    assert.equal(body.items[0].status, 'pending');
    assert.equal(body.items[0].completedAt, null);
    assert.equal(body.items[0].ownerStateAt, item.ownerUpdatedAt);
  }
  console.log(
    'PASS declared closed ready replay: explicit owner reopening survives retries while prior-day completed/cancelled snapshots retain their original state',
  );
}
{
  const { manualDailyView } =
    await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const id = '99999999-9999-4999-8999-999999999999';
  const entry = {
    entryId: id,
    status: 'ready',
    submittedAt: '2026-10-29T01:00:00Z',
    referenceDate: '2026-10-29',
    items: [
      {
        itemId: 'item-001',
        ref: id + ':manual:item-001',
        kind: 'task',
        text: '진행 중인 업무',
        visibleFrom: '2026-10-29',
        workflowStatus: 'in_progress',
        ownerStateDeclared: true,
        declaredAt: '2026-10-29T01:00:00Z',
        done: true,
        completedAt: '2026-10-30T01:00:00Z',
        ownerUpdatedAt: '2026-10-30T01:00:00Z',
        completionEvents: [{ done: true, at: '2026-10-30T01:00:00Z' }],
      },
    ],
  };
  assert.equal(
    manualDailyView({ [id]: entry }, '2026-10-29').entries[0].items[0].status,
    'in_progress',
    'future completion must not turn historical in-progress work into pending',
  );
  assert.equal(
    manualDailyView({ [id]: entry }, '2026-10-30').entries[0].items[0].status,
    'complete',
  );
  console.log(
    'PASS historical declared progress: future owner completion does not rewrite prior-day workflow status',
  );
}

{
  const { normalizeManualItems, manualDailyView } =
    await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const entryId = 'c0c0c0c0-1111-4111-8111-c0c0c0c0c0c0';
  const original =
    '11/2 월\n쿠팡창원 4p 배차입니다.\n하차 13:15\n경상남도 창원시 진해구 두동로 33 A동 5층';
  const address = '경상남도 창원시 진해구 두동로 33 A동 5층';
  // Synthetic extracted result: verifies the real normalizer/view/renderer, not a paid model call.
  const items = normalizeManualItems(
    {
      items: [
        {
          kind: 'dispatch',
          text: `11/2 쿠팡창원 배차 준비 · 4p · 하차 13:15 · ${address}`,
          evidence: original,
          serviceOriginal: '11/2',
          dueOriginal: null,
          assignee: null,
          needsConfirmation: false,
        },
      ],
    },
    {
      text: original,
      submittedAt: '2026-10-31T01:00:00Z',
      referenceDate: '2026-10-31',
      entryId,
    },
  );
  assert.equal(items[0].serviceDate, '2026-11-02');
  assert.deepEqual(items[0].details, ['하차 13:15', address]);
  const ambiguous = normalizeManualItems(
    {
      items: [1, 2].map(() => ({
        kind: 'dispatch',
        text: '배차 준비',
        evidence: original,
        serviceOriginal: '11/2',
        dueOriginal: null,
        assignee: null,
        needsConfirmation: false,
      })),
    },
    {
      text: original,
      submittedAt: '2026-10-31T01:00:00Z',
      referenceDate: '2026-10-31',
      entryId,
    },
  );
  assert.ok(
    ambiguous.every((item) => item.details.length === 0),
    'unassigned address/time must not cross-match multiple dispatch requests',
  );

  assert.equal(items[0].dueAt, null);
  assert.equal(items[0].dueDate, null);
  assert.equal(items[0].assignee, null);
  assert.equal(items[0].evidence, original);
  // Legacy operating records have no details and short evidence; recover only
  // explicit lines from the preserved single-dispatch original, without AI.
  delete items[0].details;
  items[0].text = '쿠팡창원 4p 배차';
  items[0].evidence = '11/2 월\n쿠팡창원 4p 배차입니다.';
  const entry = {
    entryId,
    submittedAt: '2026-10-31T01:00:00Z',
    referenceDate: '2026-10-31',
    status: 'ready',
    text: original,
    items,
  };
  for (const day of ['2026-10-31', '2026-11-01', '2026-11-02']) {
    const manual = manualDailyView({ [entryId]: entry }, day);
    const report = briefing.renderDailyBriefing({
      now: day + 'T12:00:00+09:00',
      analyses: [],
      manual,
    });
    assert.ok(report.html.includes('쿠팡창원 4p 배차'));
    assert.ok(report.html.includes('4p'));
    assert.ok(report.html.includes('2026.11.2(월) 13:15 하차'));
    assert.ok(report.html.includes(address));
    assert.ok(report.html.includes('2026.11.2(월)'));
    assert.ok(!report.html.includes('4톤'));
    assert.ok(!report.html.includes('처리기한:'));
  }
  const completed = structuredClone(entry);
  completed.items[0].done = true;
  completed.items[0].completedAt = '2026-10-31T02:00:00Z';
  completed.items[0].completionEvents = [
    { at: '2026-10-31T02:00:00Z', done: true },
  ];
  const following = manualDailyView({ [entryId]: completed }, '2026-11-01');
  assert.equal(following.tasks.length, 0);
  assert.equal(completed.items[0].serviceDate, '2026-11-02');
  console.log(
    'PASS supplied Kakao dispatch case: 4p/address/unloading time preserved; immediate preparation; no invented dispatch deadline; carry until preparation completed, service date unchanged',
  );
}

{
  const { renderWorkSections } =
    await import('../supabase/functions/onedrive-auth/private-mail-work.js');
  const id = '55555555-5555-4555-8555-555555555555';
  const source = {
    kind: 'mail',
    id,
    ref: 'source:' + id,
    title: 'RE: RE: 전달 원문 제목',
    evidence: '긴 원문 인용과 서명',
    receivedAt: '2026-10-31T06:00:00Z',
  };
  const task = {
    category: 'task',
    title: '2026년 10월 이안물류 운송실적 마감자료를 확인합니다.',
    status: 'pending',
    summary: [
      '김해마트통합센터에서 2026년 10월 이안물류 운송실적 마감자료를 전달하며 확인을 요청했습니다.',
    ],
    sourceRefs: [source],
  };
  const reference = {
    category: 'reference',
    title: source.title,
    status: 'pending',
    summary: ['안산센터 10/30~31 온도점검 자료 공유.'],
    sourceRefs: [source],
  };
  const html = renderWorkSections([task, reference]);
  assert.ok(html.includes(task.title));
  assert.ok(
    !html.includes(task.summary[0]),
    'delivery wording must not repeat the same action',
  );
  assert.ok(html.includes(reference.summary[0]));
  for (const value of ['RE: RE:', source.evidence, '<h2>출처</h2>', 'href='])
    assert.ok(!html.includes(value));
  assert.ok(
    html.includes('sajo-mail-photos-' + id),
    'verified business-photo anchor is preserved without a source list',
  );
  assert.equal(
    task.sourceRefs[0].evidence,
    source.evidence,
    'ledger provenance remains intact',
  );
  const important = renderWorkSections([
    {
      ...task,
      summary: [
        '보증금 500만원, 월 지원 40만원.',
        '변경 요청으로 승인 대기 중입니다.',
      ],
    },
  ]);
  assert.ok(important.includes('보증금 500만원'));
  assert.ok(important.includes('승인 대기'));
  console.log(
    'PASS human OneNote summary: no repeated subjects/source lists/evidence, duplicate delivery sentence removed, important conditions and business-photo anchors preserved',
  );
}

{
  const { resolveDispatchAssignment, normalizeManualItems, manualDailyView } =
    await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const { dailyWorkItems, renderWorkSections } =
    await import('../supabase/functions/onedrive-auth/private-mail-work.js');
  const first = 'dadadada-1111-4111-8111-dadadadadada',
    second = 'bcbcbcbc-2222-4222-8222-bcbcbcbcbcbc';
  const source =
    '11/2 월\n쿠팡창원 4p 배차입니다.\n하차 13:15\n경상남도 창원시 진해구 두동로 33 A동 5층';
  const original = {
    entryId: first,
    status: 'ready',
    submittedAt: '2026-10-31T06:21:08.135431+00:00',
    referenceDate: '2026-10-31',
    text: source,
    items: normalizeManualItems(
      {
        items: [
          {
            kind: 'dispatch',
            text: '쿠팡창원 4p 배차',
            evidence: '11/2 월\n쿠팡창원 4p 배차입니다.',
            serviceOriginal: '11/2 월',
            dueOriginal: null,
            assignee: null,
            needsConfirmation: false,
          },
        ],
      },
      {
        text: source,
        entryId: first,
        submittedAt: '2026-10-31T06:21:08.135431+00:00',
        referenceDate: '2026-10-31',
      },
    ),
  };
  const text =
    '11월2일\n양산공장(09:00상)-창원쿠팡\n경기12바3456 홍길동 01018832830';
  const reply = resolveDispatchAssignment(
    text,
    { [first]: original },
    '2026-10-31',
  );
  assert.equal(reply.items[0].workRef, first + ':manual:item-001');
  assert.equal(reply.items[0].workflowStatus, 'complete');
  const saved = {
    entryId: second,
    status: 'ready',
    text,
    submittedAt: '2026-10-31T08:00:00.345678+00:00',
    referenceDate: '2026-10-31',
    items: normalizeManualItems(reply, {
      text,
      entryId: second,
      submittedAt: '2026-10-31T08:00:00.345678+00:00',
      referenceDate: '2026-10-31',
      allowLinks: true,
      verifiedReplyRef: reply.items[0].workRef,
      verifiedDispatchReply: true,
      replyDetails: reply.details,
    }),
  };
  const entries = { [first]: original, [second]: saved };
  const work = dailyWorkItems(
    { day: '2026-10-31', groups: [], tasks: [], issues: [], waiting: [] },
    manualDailyView(entries, '2026-10-31'),
  );
  assert.equal(work.length, 1);
  assert.equal(work[0].workId, first + ':manual:item-001');
  assert.equal(work[0].status, 'complete');
  assert.equal(work[0].serviceDate, '2026-11-02');
  assert.equal(work[0].dueAt, null);
  const html = renderWorkSections(work);
  for (const value of [
    '4p',
    '2026.11.2(월) 13:15 하차',
    '두동로 33 A동 5층',
    '양산공장',
    '09:00',
    '경기12바3456',
    '홍길동',
    '010-1883-2830',
  ])
    assert.ok(html.includes(value), value);
  const ownerReopened = structuredClone(original);
  ownerReopened.items[0].completionEvents = [
    { done: true, at: '2026-10-31T06:30:00Z' },
    { done: false, at: '2026-10-31T07:00:00Z' },
  ];
  ownerReopened.items[0].ownerUpdatedAt = '2026-10-31T07:00:00Z';
  const ownerWins = dailyWorkItems(
    { day: '2026-10-31', groups: [], tasks: [], issues: [], waiting: [] },
    manualDailyView({ [first]: ownerReopened, [second]: saved }, '2026-10-31'),
  );
  assert.equal(ownerWins.length, 1);
  assert.equal(
    ownerWins[0].status,
    'complete',
    'verified newly received assignment advances an earlier owner reopen',
  );
  assert.equal(ownerWins[0].verifiedCompletionAt, '2026-10-31T08:00:00.345Z');
  assert.equal(ownerWins[0].closedAt, '2026-10-31T08:00:00.345Z');
  assert.ok(!html.includes('운행 완료'));
  assert.ok(!html.includes('하차 완료'));
  const next = dailyWorkItems(
    { day: '2026-11-01', groups: [], tasks: [], issues: [], waiting: [] },
    manualDailyView(entries, '2026-11-01'),
  );
  assert.equal(
    next.length,
    0,
    'linked assignment completion cannot resurrect on the following day',
  );
  const other = structuredClone(original);
  other.entryId = 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee';
  other.items[0].ref = other.entryId + ':manual:item-001';
  assert.equal(
    resolveDispatchAssignment(
      text,
      { [first]: original, [other.entryId]: other },
      '2026-10-31',
    ).items[0].workRef,
    null,
    'same-day ambiguous requests are never guessed',
  );
  const ambiguousReply = resolveDispatchAssignment(
    text,
    { [first]: original, [other.entryId]: other },
    '2026-10-31',
  );
  assert.equal(ambiguousReply.items[0].kind, 'issue');
  assert.equal(ambiguousReply.items[0].needsConfirmation, true);
  assert.equal(ambiguousReply.items[0].workflowStatus, 'pending');
  const reviewItems = normalizeManualItems(ambiguousReply, {
    text,
    entryId: second,
    submittedAt: '2026-10-31T08:00:00Z',
    referenceDate: '2026-10-31',
    allowLinks: true,
    verifiedDispatchReply: true,
    replyDetails: ambiguousReply.details,
  });
  assert.equal(reviewItems[0].workRef, undefined);
  assert.equal(reviewItems[0].done, false);
  assert.equal(reviewItems[0].resolution, 'dispatch_assignment_review_v1');

  assert.equal(
    resolveDispatchAssignment(
      text.replace('11월2일', '11월3일'),
      { [first]: original },
      '2026-10-31',
    )?.items[0].workRef ?? null,
    null,
  );
  assert.equal(
    resolveDispatchAssignment(
      text.replace('창원쿠팡', '김해쿠팡'),
      { [first]: original },
      '2026-10-31',
    )?.items[0].workRef ?? null,
    null,
  );
  assert.equal(
    resolveDispatchAssignment(
      text.replace('01018832830', ''),
      { [first]: original },
      '2026-10-31',
    )?.items[0].workRef ?? null,
    null,
  );
  assert.equal(
    original.items[0].done,
    false,
    'original request/history must remain immutable',
  );
  console.log(
    'PASS dispatch assignment follow-up: same work identity, destination word-order alias, preserved request conditions, preparation complete only, no nextday revival, ambiguity/date/destination/incomplete guards',
  );
}

{
  const { mailMessageTimes } =
    await import('../supabase/functions/onedrive-auth/private-mail-body.js');
  const collected = '2026-10-31T04:12:48.649933Z';
  const old = mailMessageTimes({
    headers:
      'Date: Wed, 19 Aug 2026 09:42:28 +0900\r\nReceived: from example.test by inbox.example.test; Wed, 19 Aug 2026 09:42:30 +0900\r\nSubject: 8월18일 자료',
    sentAt: '2026-08-19T00:42:28Z',
    collectedAt: collected,
  });
  assert.equal(old.sentAt, '2026-08-19T00:42:28.000Z');
  assert.equal(old.receivedAt, '2026-08-19T00:42:30.000Z');
  assert.equal(old.reportAt, old.receivedAt);
  assert.equal(old.collectedAt, '2026-10-31T04:12:48.649Z');
  const deliveredToday = mailMessageTimes({
    headers:
      'Date: Wed, 19 Aug 2026 09:42:28 +0900\r\nReceived: by inbox.example.test; Sat, 31 Oct 2026 13:12:00 +0900',
    sentAt: '2026-08-19T00:42:28Z',
    collectedAt: collected,
  });
  assert.equal(deliveredToday.receivedAt, '2026-10-31T04:12:00.000Z');
  assert.equal(deliveredToday.dateBasis, 'received_header');
  const unknown = mailMessageTimes({
    headers: 'Subject: 8월18일 자료',
    sentAt: '2026-08-19T00:42:28Z',
    collectedAt: collected,
  });
  assert.equal(unknown.receivedAt, null);
  assert.equal(unknown.reportAt, unknown.sentAt);
  assert.equal(unknown.dateBasis, 'sent_header');
  const boundary = mailMessageTimes({
    headers: 'Date: Fri, 30 Oct 2026 15:01:00 +0000',
    sentAt: '2026-10-30T15:01:00Z',
    collectedAt: '2026-10-31T12:00:00Z',
  });
  assert.equal(
    briefing.dailyReportIdentity(boundary.reportAt).day,
    '2026-10-31',
  );
  console.log(
    'PASS mail message clocks: historical delivery versus later collection, current delivery of older material, missing receipt stays unknown, title ignored, KST boundary',
  );
}

{
  const id = '99999999-2222-4222-8222-999999999999';
  const source = {
    id,
    uidl_hash: 'f'.repeat(64),
    subject: '8월18일 자료',
    sender: 'sender@example.test',
    sent_at: '2026-08-19T00:42:28Z',
    created_at: '2026-10-31T04:12:48Z',
    text: '자료 공유합니다. 내일까지 확인해 주세요.',
  };
  const reference = briefing.normalizeMailAnalysis(
    {
      summary: [
        { text: '8월18일 임시차 자료 공유.', evidence: '자료 공유합니다.' },
      ],
      tasks: [],
      issues: [],
      waiting: [],
    },
    source,
  );
  const projected = briefing.projectMailDates(reference, source);
  const current = briefing.dailyBriefingView({
    now: '2026-10-31T12:00:00+09:00',
    analyses: [projected],
  });
  assert.equal(
    current.workItems.length,
    0,
    'archived reference collected today is not today news',
  );
  const historical = briefing.dailyBriefingView({
    now: '2026-08-19T12:00:00+09:00',
    analyses: [projected],
  });
  assert.equal(historical.workItems.length, 1);
  const receivedToday = briefing.projectMailDates(reference, {
    ...source,
    received_at: '2026-10-31T04:12:00Z',
  });
  assert.equal(
    briefing.dailyBriefingView({
      now: '2026-10-31T12:00:00+09:00',
      analyses: [receivedToday],
    }).workItems.length,
    1,
    'current delivery of older material remains current',
  );
  const task = briefing.normalizeMailAnalysis(
    {
      summary: [],
      tasks: [
        {
          text: '자료 확인',
          evidence: '내일까지 확인해 주세요.',
          due: '내일까지',
          assignee: null,
        },
      ],
      issues: [],
      waiting: [],
    },
    source,
  );
  const rebased = briefing.projectMailDates(task, source);
  assert.equal(rebased.tasks[0].visibleFrom, '2026-08-19');
  assert.equal(rebased.tasks[0].dueDate, '2026-08-20');
  const carry = briefing.dailyBriefingView({
    now: '2026-10-31T12:00:00+09:00',
    analyses: [rebased],
  });
  assert.equal(
    carry.workItems.length,
    1,
    'unresolved historical work carries independently of reference dates',
  );
  assert.equal(carry.workItems[0].dueDate, '2026-08-20');
  console.log(
    'PASS daily mail projection: backfilled reference stays historical, current arrival of older material stays current, pending work carries with original relative deadline',
  );
}

{
  const { mailHeaderIdentity } =
    await import('../supabase/functions/onedrive-auth/private-mail-body.js');
  const name = '실제 발신자';
  const headers =
    'From: =?UTF-8?B?' +
    Buffer.from(name).toString('base64') +
    '?= <person@example.test>\r\nSender: Delivery Agent <delivery@example.test>\r\nTo: Receiver <receiver@example.test>\r\nCc: Copy <copy@example.test>\r\nDate: Sat, 31 Oct 2026 09:00:00 +0900\r\nSubject: 이안물류 - 가상자료';
  const envelope = await mailHeaderIdentity(headers);
  assert.equal(envelope.from.name, name);
  assert.equal(envelope.from.address, 'person@example.test');
  assert.equal(envelope.sender.address, 'delivery@example.test');
  assert.equal(envelope.to[0].address, 'receiver@example.test');
  assert.equal(envelope.cc[0].address, 'copy@example.test');
  const source = {
    id: '88888888-7777-4777-8777-888888888888',
    uidl_hash: 'a'.repeat(64),
    subject: '이안물류 - 가상자료',
    sender: 'person@example.test',
    sent_at: '2026-10-31T00:00:00Z',
    created_at: '2026-10-31T02:00:00Z',
    envelope,
    text: '자료를 공유합니다.',
  };
  const analysis = briefing.normalizeMailAnalysis(
    {
      summary: [
        {
          text: '이안물류가 가상자료를 공유했습니다.',
          evidence: '자료를 공유합니다.',
        },
      ],
      tasks: [],
      issues: [],
      waiting: [],
    },
    source,
  );
  assert.equal(
    analysis.summary[0].text,
    '가상자료를 공유했습니다.',
    'subject organization cannot become a fabricated mail sender',
  );
  assert.equal(analysis.source.envelope.from.name, name);
  const savedWrong = {
    ...analysis,
    summary: [
      {
        text: '이안물류가 가상자료를 공유했습니다.',
        evidence: '자료를 공유합니다.',
      },
    ],
    intent: { kind: 'reference' },
  };
  assert.equal(
    briefing.applyMailIntentOverride(savedWrong).summary[0].text,
    '가상자료를 공유했습니다.',
    'saved ordinary reference is repaired without an owner classification override or model call',
  );
  assert.equal(
    savedWrong.summary[0].text,
    '이안물류가 가상자료를 공유했습니다.',
    'stored raw analysis is not mutated',
  );
  const direct = briefing.normalizeMailAnalysis(
    {
      summary: [
        {
          text: '이안물류가 가상자료를 공유했습니다.',
          evidence: '자료를 공유합니다.',
        },
      ],
      tasks: [],
      issues: [],
      waiting: [],
    },
    {
      ...source,
      envelope: {
        ...envelope,
        from: { name: '이안물류', address: 'person@example.test' },
      },
    },
  );
  assert.equal(
    direct.summary[0].text,
    '이안물류가 가상자료를 공유했습니다.',
    'verified From display name can be used',
  );
  console.log(
    'PASS normalized mail headers: decoded actual From versus Sender/subject, To/Cc preserved, subject-only sender attribution removed',
  );
}

{
  const id = '77777777-3333-4333-8333-777777777777';
  const mail = {
    id,
    uidl_hash: 'b'.repeat(64),
    subject: '가상센터 일일 온도점검',
    sender: 'sender@example.test',
    sent_at: '2026-10-31T01:00:00Z',
    created_at: '2026-10-31T02:00:00Z',
    text: '정기 온도점검 자료입니다. 냉동 온도 이탈이 확인되어 재확인 중입니다.',
  };
  const normal = briefing.normalizeMailAnalysis(
    {
      summary: [
        {
          text: '가상센터 정기 온도점검 자료.',
          evidence: '정기 온도점검 자료입니다.',
        },
      ],
      tasks: [],
      issues: [],
      waiting: [],
    },
    mail,
  );
  normal.source.intent = 'routine';
  normal.intent = { kind: 'routine' };
  let view = briefing.dailyBriefingView({
    now: '2026-10-31T12:00:00+09:00',
    analyses: [normal],
  });
  assert.equal(view.workItems.length, 1);
  assert.equal(view.workItems[0].section, 'routine');
  assert.equal(view.workItems[0].controlRef, null);
  assert.ok(
    briefing
      .renderDailyBriefing({
        now: '2026-10-31T12:00:00+09:00',
        analyses: [normal],
      })
      .html.includes('정기보고메일'),
  );
  const abnormal = briefing.normalizeMailAnalysis(
    {
      summary: [
        { text: '정기 온도점검 자료.', evidence: '정기 온도점검 자료입니다.' },
      ],
      tasks: [],
      issues: [
        {
          text: '냉동 온도 이탈',
          evidence: '냉동 온도 이탈이 확인되어 재확인 중입니다.',
          impact: '냉동 상태 재확인',
          latest: '재확인 중',
          status: 'needs_confirmation',
        },
      ],
      waiting: [],
    },
    mail,
  );
  abnormal.source.intent = 'routine';
  abnormal.intent = { kind: 'routine' };
  view = briefing.dailyBriefingView({
    now: '2026-10-31T12:00:00+09:00',
    analyses: [abnormal],
  });
  assert.equal(view.workItems.length, 1);
  assert.equal(view.workItems[0].section, 'issues');
  assert.ok(!view.workItems[0].summary.includes('정기 온도점검 자료.'));
  const unclear = structuredClone(normal);
  unclear.source.intent = 'unknown';
  unclear.intent = { kind: 'unknown' };
  unclear.review = {
    withheldTasks: 1,
    withheldWaiting: 0,
    reasons: ['owner_not_confirmed'],
  };
  view = briefing.dailyBriefingView({
    now: '2026-10-31T12:00:00+09:00',
    analyses: [unclear],
  });
  assert.equal(view.workItems[0].section, 'review');
  assert.equal(view.workItems[0].controlRef, null);
  assert.equal(view.tasks.length, 0);
  assert.equal(
    briefing.dailyBriefingView({
      now: '2026-11-01T12:00:00+09:00',
      analyses: [unclear],
    }).workItems[0].section,
    'review',
    'unresolved ownership remains visible without another mail',
  );
  const corrected = briefing.applyMailIntentOverride(unclear, {
    intent: 'reference',
  });
  assert.equal(
    briefing.dailyBriefingView({
      now: '2026-10-31T12:00:00+09:00',
      analyses: [corrected],
    }).workItems[0].section,
    'reference',
  );
  console.log(
    'PASS work-centered report policy: routine separated, anomalies only as issues, uncertain ownership stays review not an invented task, explicit reference correction wins',
  );
}

{
  const first = '44444444-5555-4555-8555-444444444444',
    second = '66666666-5555-4555-8555-666666666666';
  const a = briefing.normalizeMailAnalysis(
    {
      summary: [
        {
          text: '운송실적자료 확인 요청.',
          evidence: '운송실적자료를 확인해 주세요.',
        },
      ],
      tasks: [
        {
          text: '운송실적자료 확인',
          evidence: '운송실적자료를 확인해 주세요.',
          assignee: null,
          due: null,
        },
      ],
      issues: [],
      waiting: [],
    },
    {
      id: first,
      uidl_hash: '1'.repeat(64),
      subject: '실적 확인',
      sender: 'sender@example.test',
      sent_at: '2026-10-31T01:00:00Z',
      created_at: '2026-10-31T01:01:00Z',
      text: '운송실적자료를 확인해 주세요.',
    },
  );
  a.source.thread = {
    messageId: '<first@example.test>',
    inReplyTo: [],
    references: [],
  };
  const b = briefing.normalizeMailAnalysis(
    {
      summary: [
        {
          text: '운송실적자료 확인 완료 회신.',
          evidence: '운송실적자료 확인을 완료했습니다.',
        },
      ],
      tasks: [],
      issues: [],
      waiting: [],
    },
    {
      id: second,
      uidl_hash: '2'.repeat(64),
      subject: 'Re: 실적 확인',
      sender: 'reply@example.test',
      sent_at: '2026-10-31T03:00:00Z',
      created_at: '2026-10-31T03:01:00Z',
      text: '운송실적자료 확인을 완료했습니다.',
    },
  );
  b.source.thread = {
    messageId: '<second@example.test>',
    inReplyTo: ['<first@example.test>'],
    references: ['<first@example.test>'],
  };
  b.updates = [
    {
      ref: first + ':tasks:0',
      sourceId: second,
      status: 'complete',
      evidence: '운송실적자료 확인을 완료했습니다.',
      text: '운송실적자료 확인 완료',
    },
  ];
  const view = briefing.dailyBriefingView({
    now: '2026-10-31T12:00:00+09:00',
    analyses: [a, b],
  });
  assert.equal(
    view.workItems.length,
    1,
    'reply status is not repeated as a separate mail-summary work item',
  );
  assert.equal(view.workItems[0].workId, first + ':tasks:0');
  assert.equal(view.workItems[0].status, 'complete');
  assert.equal(view.workItems[0].sourceRefs.length, 2);
  assert.equal(view.workItems[0].progress, '운송실적자료 확인 완료');
  assert.equal(view.workItems[0].closedAt, '2026-10-31T03:00:00.000Z');
  const owner = briefing.dailyBriefingView({
    now: '2026-10-31T12:00:00+09:00',
    analyses: [a, b],
    overrides: {
      [first + ':tasks:0']: {
        done: false,
        actor: 'owner',
        updatedAt: '2026-10-31T02:00:00Z',
      },
    },
  });
  assert.equal(
    owner.workItems[0].status,
    'pending',
    'owner decision is not overwritten by a later inferred mail reply',
  );
  assert.equal(
    owner.workItems[0].progress,
    null,
    'inferred completed progress must not contradict owner reopening',
  );
  console.log(
    'PASS mail work continuity: request plus completion reply is one stable work, only latest progress, source history retained, owner status preserved',
  );
}

{
  const { remoteMailImageManifest, loadApprovedRemoteMailImages } =
    await import('../supabase/functions/onedrive-auth/private-mail-remote-images.js');
  const urls = Array.from(
    { length: 5 },
    (_, i) => 'https://cdn.vendor.com/static/uuid-' + i,
  );
  const html =
    urls
      .map((url) => '<img src="' + url + '" width="480" height="160">')
      .join('') +
    '<img src="https://cdn.vendor.com/open" width="0" height="0">';
  const manifest = remoteMailImageManifest(html);
  assert.equal(
    remoteMailImageManifest('<img data-src="https://cdn.vendor.com/unused">')
      .content.length,
    0,
  );
  assert.equal(manifest.content.length, 5);
  assert.equal(manifest.excluded.length, 1);
  for (const url of [
    'http://127.0.0.1/a',
    'https://127.0.0.1/a',
    'https://localhost/a',
    'https://127.0.0.1.nip.io/a',
    'https://safe.vendor.com/a?recipient=owner',
    'https://user:pass@safe.vendor.com/a',
  ])
    assert.equal(
      remoteMailImageManifest('<img src="' + url + '">').content.length,
      0,
    );
  let calls = 0;
  const bytes = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAeAAAACgAQAAAAD8gILgAAADuklEQVR42u2Zz2skRRTHP1XTZHohMo0oTCAwrXjwJCMIxkumAwu7R/8Dc/S4HsRVYqYNIe5tB7yKzr+wtxzCbmfJIYKYuXlZ3N5lYebgoYcMbvfY3eUh86MTRao6CiL9TvOa+UxVvXqv37dqhKK8SSq4gv+3sHWa9Eai5vfFu+LtzMnEDZm0hK0FZ/l6Ei/8SQwwijRHTlNHQppC5+wsOP+1dj7Oh88Kv/d3sJArk3Thv7ABbEc7YCpcfte2DKNt2SsLf2AWbeXLD68+nWjSKq3nrW+HaU6L7tnwe6XO41rYSZSGSWpT4V79xeZAd80vQfrQ9Tv+xTOR1g+1M+wvHrsGuS2Cud8uURjh3I9TI3iaAv7cX48BBqHuPt+Yfz724JXXQMnxbU14ZQXw5v6qDdDWW7qoGl0FV3AF/zfg6agUnBW8zB377CtHl1apUkqpZKiUUnEj6CiR1pWeLRpVEyA5tEP1fvqkVMCkO/C5KXSnbQHj+/u/uz89GNaTj1eJ8r1PDwxGjh7l+YhR8AUAfbOtGoYv05DG040y+3z6iZU4OLs3gbZvCDueJW1gDxizbZhhhWbXDkzTM99Z+A3z3C4sdGAIR0Gax8AuqxOQuwdTA3ijd7cegTwiD8N+/0hF+rBYe7NnuSBOqd9+hvjBestkq7ZWZRM4wHLcgD1pa5fk0vKuMrNiVeWm6VlQQ2pavwZcy8u/PYW8xrSrdlPBFfwPwpNyskSSLU9kAJl3DPcSu9S0JwSe8s3X3ASo0QrZFjrXJH8+ea+yjdAc2QKyk/b4vvzyQpaYNnc2iYLuJVmiXG34M4bhzs5ClvSBkTa8z+mdvYUsGXtQCwyi7Xh7C1lCsI21brRVy0A1tgHHBFabBVFjXBheucLoAlGQz2TJzCI9WD70YKN3NJMlEAR94hd6sDjxYe2N05ksGZ8c99Ta555men4FON6tuAkcJOApsJummsRYllypZzNtcLm5G8qSK7CZLLk8bUNZUmmSCq7gfxHul4EfF/3esWcEz67y+8oH/OU9uQ6sNmft9OLI3rhjAudbhbGUZ9K0LPBb3fybnz94nn2N+5FvFrCMNmk8jUAE/bzEVtWe1A6/k3e5dEWlC1uO5QJPkRCYwtmFivC9mHHPFE6XylPzn5cCnFwIgXf85L2G0bRrDMqWhwTfn0uQ12n9aAbLR+7DPCw5sni8dVL34Dn3TGELgk79tzZ4v/CqKa1UutAh5+b3JLJwvjCOtgjKvsMuKQMnKv0CvObIVbup4Aqu4FL2B6tHQcCfFVUfAAAAAElFTkSuQmCC',
    ),
    (c) => c.charCodeAt(0),
  );
  const args = {
    html,
    sourceId: '11111111-1111-4111-8111-111111111111',
    approvedUrls: urls,
    fetcher: async (url, options) => {
      calls++;
      assert.ok(urls.includes(url));
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.referrerPolicy, 'no-referrer');
      return new Response(bytes, { headers: { 'content-type': 'image/png' } });
    },
  };
  await assert.rejects(
    () =>
      loadApprovedRemoteMailImages({ ...args, approvedUrls: urls.slice(0, 4) }),
    /REMOTE_IMAGE_REVIEW/,
  );
  assert.equal(calls, 0);
  const images = await loadApprovedRemoteMailImages(args);
  assert.equal(images.length, 1);
  assert.equal(calls, 5);
  assert.equal(images[0].id, args.sourceId + ':0');
  await assert.rejects(
    () => loadApprovedRemoteMailImages({ ...args, fetcher: undefined }),
    /REMOTE_IMAGE_REVIEW/,
  );
  assert.ok(
    images.every((x) => x.width === 480 && x.height === 160 && x.remoteUrl),
  );
  await assert.rejects(
    () =>
      loadApprovedRemoteMailImages({
        ...args,
        fetcher: async () =>
          new Response('not image', {
            headers: { 'content-type': 'text/html' },
          }),
      }),
    /REMOTE_IMAGE_SOURCE/,
  );
  await assert.rejects(
    () =>
      loadApprovedRemoteMailImages({
        ...args,
        fetcher: async () =>
          new Response(bytes, {
            headers: {
              'content-type': 'image/png',
              'content-length': '5000000',
            },
          }),
      }),
    /IMAGE_LIMIT|REMOTE_IMAGE_SOURCE/,
  );
  assert.throws(
    () =>
      remoteMailImageManifest(html + '<img src="https://cdn.vendor.com/six">'),
    /IMAGE_LIMIT/,
  );
  console.log(
    'PASS image-only HTML fallback: five extensionless body images, tracking exclusion, exact per-message URL consent, no private/IP/query/credential URLs, no auth/referrer/redirects, MIME and byte bounds; mocked downloads only',
  );
}
{
  const { analyzePrivateMail } =
    await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
  const source = {
    id: '11111111-1111-4111-8111-111111111111',
    uidl_hash: 'a'.repeat(64),
    subject: '숙소 참고',
    sender: 'sender@example.test',
    sent_at: '2026-10-30T01:00:00Z',
    created_at: '2026-10-30T02:00:00Z',
    text: '숙소 지원 참고 자료입니다.',
  };
  let writes = 0,
    code;
  const result = await analyzePrivateMail({
    messageId: source.id,
    key: 'fixture-key',
    loadMail: async () => source,
    intentOverride: 'reference',
    fetcher: async () =>
      lunaResponseFixture([
        {
          type: 'text',
          text: JSON.stringify({
            intent: { kind: 'reference', evidence: source.text },
            group: null,
            summary: [],
            issues: [],
            tasks: [],
            waiting: [],
            updates: [],
            imageFacts: [],
            imageDecisions: [],
            imageItems: { tasks: [], issues: [], waiting: [] },
          }),
        },
      ]),
    store: {
      claim: async () => ({ row: source, lease: 'fixture-lease' }),
      finish: async () => {
        writes++;
        return true;
      },
      fail: async (value) => {
        code = value.code;
        return true;
      },
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(code, 'ANALYSIS_SUMMARY_EMPTY');
  assert.equal(writes, 0);
  console.log(
    'PASS empty reference summary is not stored as ready; previous analysis remains untouched and targeted retry stays available',
  );
}

{
  const { dailyWorkItems } =
    await import('../supabase/functions/onedrive-auth/private-mail-work.js');
  const id = '11111111-1111-4111-8111-111111111111';
  const source = {
    id,
    subject: '이미지형 소식지',
    sender: 'sender@example.test',
    intent: 'reference',
    sentAt: '2026-10-30T01:00:00Z',
  };
  const mail = {
    source,
    summary: [],
    imageFacts: [
      {
        imageId: id + ':0',
        text: '가상 서비스 기능 개선 안내입니다.',
        confidence: 'readable',
      },
      { imageId: id + ':1', text: '제외할 서명 정보', confidence: 'readable' },
    ],
    imageDecisions: [
      { imageId: id + ':0', kind: 'business_document', include: true },
      { imageId: id + ':1', kind: 'signature', include: false },
    ],
  };
  const items = dailyWorkItems({
    groups: [{ name: '기타', threads: [{ mails: [mail] }] }],
    tasks: [],
    issues: [],
    waiting: [],
    resolvedWaiting: [],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].category, 'reference');
  assert.deepEqual(items[0].summary, ['가상 서비스 기능 개선 안내입니다.']);
  console.log(
    'PASS image-only reference uses readable included business-image summary, not subject-only output or signature text',
  );
}

{
  const { handleMailAutomation } =
    await import('../supabase/functions/onedrive-auth/private-mail-background.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  let calls = 0;
  const ctx = {
    db: async (path) => {
      assert.ok(path.startsWith('private_mailboxes?'));
      return [{ id: target.mailbox_id, owner_id: target.owner_id }];
    },
    json: (value) => Response.json(value),
    fail: (message, status) => Object.assign(Error(message), { status }),
    remoteFetcher: async (url, options) => {
      calls++;
      assert.equal(url, 'https://placehold.co/480x160.png');
      assert.equal(options.sourceId, '11111111-1111-4111-8111-111111111111');
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/png' },
      });
    },
  };
  const result = await (
    await handleMailAutomation(
      'private-mail-remote-verify',
      { url: 'https://127.0.0.1/forbidden' },
      { id: target.owner_id },
      ctx,
    )
  ).json();
  assert.equal(result.status, 'done');
  assert.equal(result.stored, false);
  assert.equal(result.modelCalled, false);
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      handleMailAutomation(
        'private-mail-remote-verify',
        {},
        { id: 'other' },
        ctx,
      ),
    (error) => error.status === 403,
  );
  assert.equal(calls, 1);
  console.log(
    'PASS remote verification is fixed synthetic fixture, strict owner-only, ignores caller URLs, no model or storage effects',
  );
}
{
  const { authorizeMailWork } =
    await import('../supabase/functions/onedrive-auth/private-mail-worker-auth.js');
  const box = '39045005-313e-42e1-b50c-2394b3b6ff26',
    id = '11111111-1111-4111-8111-111111111111',
    url = 'https://placehold.co/480x160.png';
  let accepted = true,
    calls = 0;
  const context = {
    token: 'pmjob_' + 'a'.repeat(64),
    hash: async () => 'hash-only-fixture',
    fail: (message, status) => Object.assign(Error(message), { status }),
    db: async (path, options) => {
      calls++;
      assert.equal(path, 'rpc/private_mail_image_transport_auth');
      assert.deepEqual(options.body, {
        p_box: box,
        p_hash: 'hash-only-fixture',
        p_message: id,
        p_url: url,
      });
      return accepted;
    },
  };
  const request = () =>
    new Request('https://first-party.test', {
      method: 'POST',
      body: JSON.stringify({
        mailbox: box,
        operation: 'image-authorize',
        id,
        url,
      }),
    });
  await authorizeMailWork('private-mail-background-work', request(), context);
  assert.equal(calls, 1);
  accepted = false;
  await assert.rejects(
    () => authorizeMailWork('private-mail-background-work', request(), context),
    (error) => error.status === 403,
  );
  await assert.rejects(
    () =>
      authorizeMailWork(
        'private-mail-background-work',
        new Request('https://first-party.test', {
          method: 'POST',
          body: JSON.stringify({
            mailbox: 'wrong',
            operation: 'image-authorize',
            id,
            url,
          }),
        }),
        context,
      ),
    (error) => error.status === 403,
  );
  assert.equal(calls, 2);
  console.log(
    'PASS image relay authorization works without legacy key, binds mailbox/message/URL to one-use SQL capability and fails closed before download',
  );
}
{
  const { readFile } = await import('node:fs/promises');
  const { handleMailAutomation } =
    await import('../supabase/functions/onedrive-auth/private-mail-background.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const image = await readFile(
    new URL('../app/public/diagnostics/mail-body-fixture.png', import.meta.url),
  );
  const id = '11111111-1111-4111-8111-111111111111',
    imageId = id + ':0';
  let modelCalls = 0,
    downloads = 0;
  const answer = {
    intent: { kind: 'unknown', evidence: null },
    group: null,
    summary: [],
    issues: [],
    tasks: [],
    waiting: [],
    updates: [],
    imageFacts: [
      {
        imageId,
        text: '상차 09:00, 하차 13:15, 수량 4P.',
        confidence: 'readable',
      },
    ],
    imageDecisions: [{ imageId, kind: 'business_document', include: true }],
    imageItems: { tasks: [], issues: [], waiting: [] },
  };
  const ctx = {
    aiProvider: 'openai',
    aiModel: 'gpt-6-luna',
    aiKey: 'fixture-only',
    db: async (path) => {
      assert.ok(path.startsWith('private_mailboxes?'));
      return [{ id: target.mailbox_id, owner_id: target.owner_id }];
    },
    json: (value) => Response.json(value),
    fail: (message, status) => Object.assign(Error(message), { status }),
    remoteFetcher: async (url, options) => {
      downloads++;
      assert.equal(
        url,
        'https://sajoansan.vercel.app/diagnostics/mail-body-fixture.png',
      );
      assert.equal(options.sourceId, id);
      return new Response(image, { headers: { 'content-type': 'image/png' } });
    },
    fetcher: async (url, options) => {
      modelCalls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-6-luna');
      assert.equal(body.store, false);
      assert.equal(body.text.format.type, 'json_object');
      assert.ok(!JSON.stringify(body).includes('장희성'));
      assert.ok(
        body.input.some((message) =>
          message.content.some((part) => part.type === 'input_image'),
        ),
      );
      return Response.json({
        status: 'completed',
        model: 'gpt-6-luna',
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: JSON.stringify(answer) }],
          },
        ],
        usage: { input_tokens: 20, output_tokens: 100, total_tokens: 120 },
      });
    },
  };
  const result = await (
    await handleMailAutomation(
      'private-mail-remote-verify',
      { analyze: true, url: 'https://127.0.0.1/ignored', text: 'ignored' },
      { id: target.owner_id },
      ctx,
    )
  ).json();
  assert.equal(result.status, 'done');
  assert.ok(Object.values(result.checks).every(Boolean));
  assert.equal(result.stored, false);
  assert.equal(result.oneNoteWritten, false);
  assert.equal(result.normalized.length, 1);
  assert.equal(result.normalized[0].category, 'reference');
  assert.equal(modelCalls, 1);
  assert.equal(downloads, 1);
  const wrong = await (
    await handleMailAutomation(
      'private-mail-remote-verify',
      { analyze: true },
      { id: target.owner_id },
      { ...ctx, aiProvider: 'aiapiflow' },
    )
  ).json();
  assert.equal(wrong.code, 'AI_VERIFY_CONFIGURATION');
  assert.equal(modelCalls, 1);
  assert.equal(downloads, 1);
  console.log(
    'PASS full synthetic image flow: remote body -> official JSON-mode model -> strict validation -> common normalized reference; expected quantity/times, no private inputs or operating business/OneNote writes',
  );
}
{
  const { readFile } = await import('node:fs/promises');
  const { createMailSource } =
    await import('../supabase/functions/onedrive-auth/private-mail-source.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const png = new Uint8Array(
    await readFile(
      new URL(
        '../app/public/diagnostics/mail-body-fixture.png',
        import.meta.url,
      ),
    ),
  );
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', png)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  const id = '11111111-1111-4111-8111-111111111111',
    urls = ['https://cdn.vendor.com/first', 'https://cdn.vendor.com/second'];
  const html = new TextEncoder().encode(
    urls.map((url) => '<img src="' + url + '">').join(''),
  );
  const descriptor = {
    sourceId: id,
    id: id + ':1',
    remoteUrl: urls[1],
    contentHash: hash,
  };
  const file = {
    kind: 'html',
    item_id: 'html',
    file_name: 'html.download',
    byte_size: html.length,
  };
  const row = {
    id,
    owner_id: target.owner_id,
    mailbox_id: target.mailbox_id,
    files: [file],
    analysis: { source: { images: [descriptor] } },
  };
  let downloads = 0,
    scope = 'body_remote_images',
    approved = urls;
  const loader = createMailSource({
    db: async () => [row],
    withLock: async (fn) => fn(),
    mailbox: async () => ({
      drive_id: 'drive',
      folder_id: 'folder',
      automation_config: {
        analysisScopes: { [id]: scope },
        remoteImages: { [id]: { approvedUrls: approved } },
      },
    }),
    environment: async () => ({ access: 'fixture' }),
    privateDestination: async () => ({}),
    privatePermissions: async () => {},
    verify: async (f) => {
      assert.equal(f.item_id, 'html');
      return html;
    },
    graph: async () =>
      Response.json({
        id: 'html',
        name: file.file_name,
        size: file.byte_size,
        file: {},
        parentReference: { driveId: 'drive', id: 'folder' },
      }),
    remoteFetcher: async (url, options) => {
      downloads++;
      assert.equal(url, urls[1]);
      assert.equal(options.sourceId, id);
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    },
  });
  const image = await loader.loadImage(descriptor);
  assert.equal(image.bytes.length, png.length);
  assert.equal(
    downloads,
    1,
    'OneNote must not download all other mail images again',
  );
  scope = 'body_headers';
  await assert.rejects(
    () => loader.loadImage(descriptor),
    /NOTES_IMAGE_SOURCE/,
  );
  assert.equal(downloads, 1);
  scope = 'body_remote_images';
  approved = [urls[0]];
  await assert.rejects(
    () => loader.loadImage(descriptor),
    /NOTES_IMAGE_SOURCE/,
  );
  assert.equal(downloads, 1);
  console.log(
    'PASS remote OneNote image restore: exact saved HTML/URL/hash/analysis match, only requested image fetched, body_headers and revoked URL block before download',
  );
}
{
  const { readFile } = await import('node:fs/promises');
  const { loadApprovedRemoteMailImages } =
    await import('../supabase/functions/onedrive-auth/private-mail-remote-images.js');
  const png = await readFile(
    new URL('../app/public/diagnostics/mail-body-fixture.png', import.meta.url),
  );
  const urls = Array.from(
      { length: 5 },
      (_, i) => 'https://cdn.vendor.com/news-' + i,
    ),
    calls = [];
  const html = urls.map((url) => '<img src="' + url + '">').join('');
  await loadApprovedRemoteMailImages({
    html,
    approvedUrls: urls.slice(0, 4),
    excludedUrls: [urls[4]],
    sourceId: '11111111-1111-4111-8111-111111111111',
    fetcher: async (url) => {
      calls.push(url);
      assert.notEqual(url, urls[4]);
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    },
  });
  assert.deepEqual(calls, urls.slice(0, 4));
  await assert.rejects(
    () =>
      loadApprovedRemoteMailImages({
        html,
        approvedUrls: urls.slice(0, 4),
        sourceId: '11111111-1111-4111-8111-111111111111',
        fetcher: async () =>
          assert.fail('unknown image must stop before any fetch'),
      }),
    /REMOTE_IMAGE_REVIEW/,
  );
  console.log(
    'PASS approved newsletter images only: explicit footer excluded before download/model, other unapproved images still fail closed',
  );
}
{
  const { readFile } = await import('node:fs/promises');
  const { analyzePrivateMail } =
    await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
  const bytes = new Uint8Array(
    await readFile(
      new URL(
        '../app/public/diagnostics/mail-body-fixture.png',
        import.meta.url,
      ),
    ),
  );
  const id = '11111111-1111-4111-8111-111111111111',
    imageId = id + ':0',
    proof = '기능 개선과 교육 일정 안내입니다.';
  const source = {
    id,
    uidl_hash: 'a'.repeat(64),
    subject: '소식지',
    sender: 'sender@example.test',
    sent_at: '2026-10-30T01:00:00Z',
    created_at: '2026-10-31T01:00:00Z',
    text: '',
    images: [
      {
        id: imageId,
        name: '문서.png',
        mediaType: 'image/png',
        width: 480,
        height: 160,
        contentHash: Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
          (b) => b.toString(16).padStart(2, '0'),
        ).join(''),
        bytes,
      },
    ],
  };
  const value = {
    intent: { kind: 'reference', evidence: proof },
    group: null,
    summary: [],
    issues: [],
    tasks: [],
    waiting: [],
    updates: [],
    imageFacts: [{ imageId, text: proof, confidence: 'readable' }],
    imageDecisions: [{ imageId, kind: 'business_document', include: true }],
    imageItems: { tasks: [], issues: [], waiting: [] },
  };
  let saved;
  const run = () =>
    analyzePrivateMail({
      messageId: id,
      key: 'fixture-key',
      loadMail: async () => source,
      fetcher: async () =>
        lunaResponseFixture([{ type: 'text', text: JSON.stringify(value) }]),
      store: {
        claim: async () => ({ row: source, lease: 'fixture' }),
        finish: async ({ analysis }) => {
          saved = analysis;
          return true;
        },
        fail: async () => true,
      },
    });
  assert.equal((await run()).status, 'done');
  assert.equal(saved.source.intent, 'reference');
  assert.equal(saved.intent.evidenceSource, 'image');
  assert.equal(saved.tasks.length, 0);
  source.text = '온라인에서 보기';
  value.intent.evidence = '이미지에 있는 소식지 제목';
  assert.equal((await run()).status, 'done');
  assert.equal(saved.source.intent, 'reference');
  assert.equal(saved.intent.evidence, proof);
  assert.equal(saved.intent.evidenceSource, 'image');
  value.summary = [
    { text: '이미지 안내 요약', evidence: '본문에는 없는 이미지 문구' },
  ];
  assert.equal((await run()).status, 'done');
  assert.equal(saved.source.intent, 'reference');
  assert.equal(saved.summary.length, 0);
  assert.equal(saved.imageFacts[0].text, proof);
  value.summary = [];
  value.intent.kind = 'request';
  assert.equal((await run()).status, 'done');
  assert.equal(saved.source.intent, 'unknown');
  assert.equal(saved.tasks.length, 0);
  console.log(
    'PASS image-only reference/routine evidence may use validated included readable facts; image evidence alone does not confirm personal request or create tasks',
  );
}

{
  const { dailyBriefingView, renderDailyBriefing } =
    await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
  const id = '11111111-1111-4111-8111-111111111111';
  const image = (index) => ({
    id: id + ':' + index,
    name: '업무자료' + index + '.png',
    mediaType: 'image/png',
    width: 480,
    height: 160,
    byteLength: 1000,
    contentHash: String(index + 1).repeat(64),
  });
  const mail = {
    source: {
      id,
      uidl: 'a'.repeat(64),
      subject: '과거 소식지',
      sender: 'sender@example.test',
      sentAt: '2026-10-30T01:00:00Z',
      intent: 'reference',
      images: [0, 1, 2, 3].map(image),
    },
    revision: 1,
    summary: [{ text: '과거 참고 소식지 안내', evidence: '소식지 안내' }],
    tasks: [],
    issues: [],
    waiting: [],
    updates: [],
    imageFacts: [],
    imageItems: { tasks: [], issues: [], waiting: [] },
  };
  const options = { now: '2026-10-31T03:00:00Z', analyses: [mail] };
  const view = dailyBriefingView(options);
  assert.equal(
    view.workItems.length,
    0,
    'past reference must not become today work',
  );
  assert.doesNotThrow(
    () => renderDailyBriefing(options),
    'four valid analyzed images must not block the next day report',
  );
  mail.source.images.push(image(4));
  assert.doesNotThrow(() => renderDailyBriefing(options));
  mail.source.images.push(image(5));
  assert.throws(() => renderDailyBriefing(options), /IMAGE_SOURCE/);
  console.log(
    'PASS report image contract: four/five valid source images do not block later-day reports, past reference remains hidden, six still rejected',
  );
}

{
  const { dailyBriefingView, renderDailyBriefing } =
    await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
  const id = '11111111-1111-4111-8111-111111111111',
    workId = 'source:' + id;
  const mail = {
    source: {
      id,
      uidl: 'a'.repeat(64),
      subject: '검토 자료',
      sender: 'test@example.test',
      sentAt: '2026-10-31T01:00:00Z',
      intent: 'reference',
    },
    revision: 1,
    summary: [{ text: '조건을 검토할 자료', evidence: '검토 자료' }],
    tasks: [],
    issues: [],
    waiting: [],
    updates: [],
  };
  const options = {
    now: '2026-10-31T03:00:00Z',
    analyses: [mail],
    overrides: {},
  };
  options.overrides['work:' + workId] = {
    actor: 'owner',
    category: 'task',
    updatedAt: '2026-10-31T03:00:00Z',
  };
  const task = dailyBriefingView(options).workItems[0];
  assert.equal(task.category, 'task');
  assert.equal(task.workId, workId);
  assert.equal(task.controlRef, 'work:' + workId);
  assert.equal(
    dailyBriefingView({ ...options, now: '2026-11-01T03:00:00Z' }).workItems
      .length,
    1,
  );
  options.overrides['work:' + workId].done = true;
  assert.equal(dailyBriefingView(options).workItems[0].status, 'complete');
  assert.equal(
    dailyBriefingView({ ...options, now: '2026-11-01T03:00:00Z' }).workItems
      .length,
    0,
  );
  options.overrides['work:' + workId].excluded = true;
  options.overrides['work:' + workId].reason = 'spam';
  assert.equal(dailyBriefingView(options).workItems.length, 0);
  assert.equal(dailyBriefingView(options).excludedWorkItems[0].workId, workId);
  assert.ok(
    !renderDailyBriefing(options).managedHtml.includes('조건을 검토할 자료'),
  );
  options.overrides['work:' + workId].excluded = false;
  options.overrides['work:' + workId].category = 'routine';
  assert.equal(dailyBriefingView(options).workItems[0].section, 'routine');
  assert.equal(mail.source.intent, 'reference');
  assert.equal(mail.tasks.length, 0);
  console.log(
    'PASS owner work corrections: stable identity, reference-to-task carry, completion/no revival, exclusion/undo, note projection and original analysis retained',
  );
}

{
  const { renderBriefingWorkNote } =
    await import('../supabase/functions/onedrive-auth/private-mail-work.js');
  const base = {
    workId: 'test',
    category: 'reference',
    status: 'pending',
    title: '직원 숙소 지원 품의',
    summary: [
      '직원 숙소 지원 품의 참고자료. 보증금 500만원, 월세 60만원, 계약기간 1년.',
    ],
    sourceRefs: [],
  };
  const note = renderBriefingWorkNote([
    base,
    {
      ...base,
      workId: 'dispatch',
      category: 'task',
      title: '11/2 가상센터 4P 배차 준비',
      summary: ['하차 13:15', '가상 하차 주소'],
      serviceDate: '2026-11-02',
    },
  ]);
  assert.ok(note.includes('To Do'));
  assert.ok(note.includes('참고사항'));
  assert.ok(note.includes('직원 숙소 지원 품의 참고자료'));
  assert.ok(!note.includes('500만원'));
  assert.ok(!note.includes('60만원'));
  assert.ok(
    note.includes('4P') &&
      note.includes('13:15') &&
      (note.includes('2026-11-02') || note.includes('2026.11.2(월)')),
  );
  assert.ok(!note.includes('미착수'));
  assert.ok(!note.includes('주요 이슈'));
  console.log(
    'PASS human briefing note: action-first, reference one-line, important dispatch details retained, no empty sections/default machine state or reference financial inventory',
  );
}

{
  const { handleApiManagement } =
    await import('../supabase/functions/_shared/ai-providers.js');
  let calls = 0;
  const body = {
    provider: 'openai',
    model: 'gpt-6-luna',
    confirmation: 'synthetic-compatibility',
  };
  const ctx = {
    env: { OPENAI_API_KEY: 'mock-only' },
    json: Response.json,
    db: () => assert.fail('verification must not read or write settings'),
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const request = JSON.parse(options.body);
      assert.equal(request.model, body.model);
      assert.equal(request.store, false);
      if (calls === 2)
        assert.equal(request.input[0].content[1].type, 'input_image');
      if (calls === 3) assert.equal(request.text.format.type, 'json_object');
      return Response.json({
        status: 'completed',
        model: body.model,
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: calls === 3 ? '{"ok":true}' : calls === 2 ? '4' : 'OK',
              },
            ],
          },
        ],
      });
    },
  };
  await assert.rejects(
    () =>
      handleApiManagement('api-admin-verify', body, { role: 'editor' }, ctx),
    /ADMIN_REQUIRED/,
  );
  await assert.rejects(
    () =>
      handleApiManagement(
        'api-admin-verify',
        { ...body, confirmation: '' },
        { role: 'admin' },
        ctx,
      ),
    /AI_VERIFICATION_CONFIRMATION_REQUIRED/,
  );
  assert.equal(calls, 0);
  const result = await (
    await handleApiManagement('api-admin-verify', body, { role: 'admin' }, ctx)
  ).json();
  assert.equal(result.passed, true);
  assert.equal(calls, 3);
  assert.equal(result.checks[1].returnedModel, body.model);
  assert.equal(result.checks[1].providerStatus, 200);
  assert.equal(result.checks[1].stopReason, 'end_turn');
  const mismatch = await (
    await handleApiManagement(
      'api-admin-verify',
      body,
      { role: 'admin' },
      {
        ...ctx,
        fetcher: async () =>
          Response.json({
            status: 'completed',
            model: 'gpt-other',
            output: [
              {
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'OK' }],
              },
            ],
          }),
      },
    )
  ).json();
  assert.equal(mismatch.passed, false);
  assert.equal(mismatch.checks[0].status, 'model_mismatch');
  assert.equal(mismatch.checks[0].returnedModel, 'gpt-other');
  for (const [http, expected] of [
    [401, 'auth'],
    [403, 'auth'],
    [404, 'model_missing'],
    [400, 'unsupported'],
    [429, 'transient'],
    [503, 'transient'],
  ]) {
    let failures = 0;
    const result = await (
      await handleApiManagement(
        'api-admin-verify',
        body,
        { role: 'admin' },
        {
          ...ctx,
          fetcher: async () => {
            failures++;
            return new Response('', { status: http });
          },
        },
      )
    ).json();
    assert.equal(result.passed, false);
    assert.equal(result.checks[0].status, expected);
    assert.equal(failures, 1, 'failure must stop without fallback or retry');
    assert.ok(!JSON.stringify(result).includes('mock-only'));
  }
  const unknownDiagnostic = await (await handleApiManagement(
    'api-admin-verify', { ...body, model: 'unknown' }, {role:'admin'},
    {...ctx, fetcher:()=>assert.fail('unknown protocol must not call provider')}
  )).json();
  assert.equal(unknownDiagnostic.checks[0].diagnosticCode,'ADAPTER_NOT_IMPLEMENTED');
  assert.equal(unknownDiagnostic.passed,false);
  await assert.rejects(
    () =>
      handleApiManagement(
        'api-admin-verify',
        body,
        { role: 'admin' },
        { ...ctx, env: {} },
      ),
    /AI_NOT_CONFIGURED/,
  );
  const timeout = await (
    await handleApiManagement(
      'api-admin-verify',
      body,
      { role: 'admin' },
      {
        ...ctx,
        fetcher: async () => {
          throw new DOMException('synthetic', 'TimeoutError');
        },
      },
    )
  ).json();
  assert.equal(timeout.checks[0].status, 'transient');
  let stored = {
    provider: 'aiapiflow',
    model: 'gpt-5.6-luna',
    protocol: 'responses',
    revision: 0,
  };
  const persisted = {
    ...ctx,
    db: async (path, options) => {
      if (path.startsWith('onedrive_settings?'))
        return [{ ai_defaults: stored }];
      assert.equal(path, 'rpc/onedrive_ai_default_save');
      stored = {
        provider: options.body.p_provider,
        model: options.body.p_model,
        protocol: options.body.p_protocol,
        revision: options.body.p_revision + 1,
      };
      return stored;
    },
    fetcher: async (url, options) => {
      if (url.endsWith('/models'))
        return Response.json({
          data: [
            {
              id: url.includes('api.openai.com')
                ? 'gpt-6-luna'
                : 'gpt-5.6-luna',
            },
          ],
        });
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(JSON.parse(options.body).model, stored.model);
      return new Response('', { status: 404 });
    },
  };
  await handleApiManagement(
    'api-admin-default',
    { provider: 'openai', model: 'gpt-6-luna', revision: 0 },
    { role: 'admin', id: 'synthetic-admin' },
    persisted,
  );
  const reloaded = await (
    await handleApiManagement(
      'api-admin-status',
      {},
      { role: 'admin' },
      persisted,
    )
  ).json();
  assert.deepEqual(reloaded.judgment, {
    provider: 'typesafe',
    keyConfigured: false,
    liveVerified: false,
  });
  const configuredJudgment = await (
    await handleApiManagement(
      'api-admin-status',
      {},
      { role: 'admin' },
      {
        ...persisted,
        env: {
          ...persisted.env,
          TYPESAFE_API_KEY: 'PRIVATE_JUDGMENT_SENTINEL',
        },
      },
    )
  ).json();
  assert.equal(configuredJudgment.judgment.keyConfigured, true);
  assert.equal(configuredJudgment.judgment.liveVerified, false);
  assert.ok(
    !JSON.stringify(configuredJudgment).includes('PRIVATE_JUDGMENT_SENTINEL'),
  );
  assert.equal(reloaded.default.revision, 1);
  assert.equal(reloaded.default.provider, 'openai');
  assert.equal(reloaded.default.model, 'gpt-6-luna');
  const routed = await (
    await handleApiManagement(
      'api-admin-verify',
      { ...reloaded.default, confirmation: 'synthetic-compatibility' },
      { role: 'admin' },
      persisted,
    )
  ).json();
  assert.equal(routed.checks[0].status, 'model_missing');
  let judgmentCalls = 0;
  const judgment = await (
    await handleApiManagement(
      'api-admin-verify',
      {
        provider: 'typesafe',
        model: 'jev-1.14.0',
        confirmation: 'synthetic-compatibility',
      },
      { role: 'admin' },
      {
        ...ctx,
        env: { TYPESAFE_API_KEY: 'PRIVATE_JEV_DIAGNOSTIC' },
        fetcher: async (url, options) => {
          judgmentCalls++;
          assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
          const request = JSON.parse(options.body);
          assert.equal(request.model, 'jev-1.14.0');
          assert.equal(request.questions.q0.type, 'noul');
          assert.equal(request.state.proposed.length, 1);
          assert.equal(request.state.proposed[0].text, '4톤 차량 배차');
          assert.ok(request.state.source.includes('4P'));
          assert.ok(!JSON.stringify(request).includes('image'));
          return Response.json({
            model: 'jev-1.14.0',
            answers: { q0: { type: 'noul', noul: 0.8 } },
            usage: { input_tokens: 10, output_tokens: 1 },
          });
        },
      },
    )
  ).json();
  assert.equal(judgmentCalls, 1);
  assert.equal(judgment.passed, true);
  assert.equal(judgment.protocol, 'systemone');
  assert.equal(judgment.checks[0].kind, 'judgment');
  assert.equal(judgment.checks[0].unsupportedProbability, 0.8);
  assert.equal(judgment.checks[0].reviewRequired, true);
  assert.equal(judgment.checks[0].returnedModel, 'jev-1.14.0');
  assert.equal(judgment.checks[0].usage.inputTokens, 10);
  assert.ok(!JSON.stringify(judgment).includes('PRIVATE_JEV_DIAGNOSTIC'));

  console.log(
    'PASS API compatibility: explicit admin confirmation, fixed synthetic text/image/JSON, no settings mutation, sanitized failure classes and no fallback',
  );
}

// JEV advisory runtime integration: synthetic inputs only, never a live provider call.
{
  const { reviewNormalizedMail, reviewNormalizedManual, JEV_VERIFIER_MODEL } =
    await import('../supabase/functions/onedrive-auth/private-mail-jev-verifier.js');
  const { analyzePrivateMail } =
    await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
  const { handleManualMessage } =
    await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const { APPROVED_MAIL_TARGET: target } =
    await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
  const id = '11111111-1111-4111-8111-111111111111',
    proof = '장희성님 11월 2일 배차 준비 부탁드립니다.';
  const mail = {
    id,
    uidl_hash: 'a'.repeat(64),
    subject: '배차 요청',
    sender: 'sender@example.test',
    headers:
      'From: Sender <sender@example.test>\r\nTo: 장희성 <jhs96@eangroup.kr>',
    text: proof,
    sent_at: '2026-10-31T01:00:00Z',
    created_at: '2026-10-31T02:00:00Z',
  };
  const value = {
    intent: { kind: 'request', evidence: proof },
    group: null,
    summary: [{ text: '배차 준비 요청', evidence: proof }],
    tasks: [
      {
        text: '배차 준비',
        evidence: proof,
        status: 'pending',
        assignee: null,
        due: null,
        serviceOriginal: '11월 2일',
        completionEvidence: null,
        forOwner: true,
        recipientScope: 'owner_direct',
        selfRequestEvidence: proof,
      },
    ],
    issues: [],
    waiting: [],
    updates: [],
    imageFacts: [],
    imageDecisions: [],
    imageItems: { tasks: [], issues: [], waiting: [] },
  };
  const mainResponse = () =>
    Response.json({
      model: 'gpt-5.6-luna',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(value) }],
        },
      ],
    });
  const configured = {
    enabled: true,
    approvedSourceIds: [id],
    key: 'SYNTHETIC_JEV_KEY',
    timeoutMs: 10,
  };
  const jevResponse = (payload, probability = 0.6) =>
    Response.json({
      model: JEV_VERIFIER_MODEL,
      answers: Object.fromEntries(
        Object.keys(payload.questions).map((q) => [
          q,
          { type: 'noul', noul: probability },
        ]),
      ),
    });
  let mainCalls = 0,
    jevCalls = 0,
    finishes = 0;
  const baseline = await analyzePrivateMail({
    messageId: id,
    key: 'synthetic-main',
    now: '2026-10-31T03:00:00Z',
    loadMail: async () => mail,
    fetcher: async () => {
      mainCalls++;
      return mainResponse();
    },
    store: {
      claim: async () => ({ row: mail, lease: 'fixture' }),
      finish: async () => {
        finishes++;
        return true;
      },
      fail: async () => assert.fail('main failure'),
    },
  });
  assert.equal(baseline.status, 'done');
  assert.equal(baseline.analysis.tasks.length, 1);
  for (const failure of [
    'missing-key',
    'timeout',
    '429',
    'invalid',
    'review',
    'resolver-error',
  ]) {
    const before = finishes,
      calls = jevCalls;
    const result = await analyzePrivateMail({
      messageId: id,
      key: 'synthetic-main',
      now: '2026-10-31T03:00:00Z',
      loadMail: async () => mail,
      fetcher: async () => {
        mainCalls++;
        return mainResponse();
      },
      resolveJevConfiguration: async () => {
        if (failure === 'resolver-error') throw Error('synthetic resolver');
        return {
          ...configured,
          key: failure === 'missing-key' ? undefined : configured.key,
          fetcher: async (url, options) => {
            jevCalls++;
            assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
            assert.equal(options.redirect, 'error');
            const payload = JSON.parse(options.body),
              state = payload.state;
            assert.equal(state.source.includes('sender@example.test'), true);
            assert.equal(state.source.includes('jhs96@eangroup.kr'), true);
            assert.ok(!JSON.stringify(payload).includes('image_url'));
            if (failure === 'timeout') return new Promise(() => {});
            if (failure === '429') return new Response('', { status: 429 });
            if (failure === 'invalid')
              return Response.json({ answers: { q0: { noul: 'yes' } } });
            return jevResponse(payload);
          },
        };
      },
      store: {
        claim: async () => ({ row: mail, lease: 'fixture' }),
        finish: async () => {
          finishes++;
          return true;
        },
        fail: async () => assert.fail('advisory must not fail main'),
      },
    });
    assert.equal(result.status, 'done');
    assert.equal(finishes, before + 1);
    assert.equal(
      jevCalls - calls,
      ['missing-key', 'resolver-error'].includes(failure) ? 0 : 1,
    );
    const { jevReview, ...unchanged } = result.analysis;
    assert.deepEqual(
      unchanged,
      baseline.analysis,
      'review preserves normalized source, stable IDs, dates and completion',
    );
    assert.equal(
      jevReview.status,
      failure === 'review' ? 'review' : 'unavailable',
    );
    assert.ok(!JSON.stringify(jevReview).includes('SYNTHETIC_JEV_KEY'));
  }
  const reference = {
    source: { id },
    revision: 1,
    intent: { kind: 'reference' },
    review: { reasons: ['reference_intent'] },
    tasks: [],
    issues: [],
    waiting: [],
    updates: [],
  };
  assert.equal(
    (
      await reviewNormalizedMail({
        analysis: reference,
        mail,
        config: { ...configured, fetcher: () => assert.fail('reference skip') },
      })
    ).status,
    'skipped',
  );
  assert.equal(
    await reviewNormalizedMail({
      analysis: reference,
      mail,
      config: { ...configured, approvedSourceIds: [] },
    }),
    null,
  );
  const manual = {
    entryId: id,
    status: 'ready',
    text: proof,
    referenceDate: '2026-10-31',
    submittedAt: mail.created_at,
    items: [
      {
        itemId: 'item-001',
        kind: 'dispatch',
        text: '배車 준비',
        evidence: proof,
        done: true,
        dueAt: null,
        dueDate: null,
        serviceDate: '2026-11-02',
        completedAt: mail.created_at,
        completionEvents: [{ done: true, at: mail.created_at }],
        ownerUpdatedAt: mail.created_at,
        workRef: 'original:manual:item-001',
      },
    ],
  };
  const snapshot = structuredClone(manual);
  const reviewed = await reviewNormalizedManual({
    entry: manual,
    related: [
      {
        ref: 'original:manual:item-001',
        text: '정규화 기존 업무',
        status: 'pending',
        raw: 'PRIVATE_OTHER_MAIL',
      },
    ],
    config: {
      ...configured,
      fetcher: async (_, options) => {
        const payload = JSON.parse(options.body);
        assert.ok(JSON.stringify(payload).includes('정규화 기존 업무'));
        assert.ok(!JSON.stringify(payload).includes('PRIVATE_OTHER_MAIL'));
        return jevResponse(payload);
      },
    },
  });
  assert.equal(reviewed.status, 'review');
  assert.deepEqual(manual, snapshot);
  let registered = null,
    registerCalls = 0,
    paidCalls = 0,
    reviewWrites = 0;
  const ctx = {
    json: Response.json,
    fail: (m) => Error(m),
    aiKey: 'synthetic-main',
    resolveJevConfiguration: async () => ({
      ...configured,
      fetcher: async (_, opts) => {
        paidCalls++;
        return jevResponse(JSON.parse(opts.body));
      },
    }),
    fetcher: async () =>
      Response.json({
        model: 'gpt-5.6-luna',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  items: [
                    {
                      kind: 'dispatch',
                      text: '배차 준비',
                      evidence: proof,
                      assignee: null,
                      serviceOriginal: '11월 2일',
                      dueOriginal: null,
                      needsConfirmation: false,
                    },
                  ],
                  authoredDate: null,inputKind:'business',
                }),
              },
            ],
          },
        ],
      }),
    db: async (path, opts) => {
      if (path.startsWith('private_mailboxes?'))
        return [
          {
            id: target.mailbox_id,
            owner_id: target.owner_id,
            enabled: true,
            manual_entries: {},
          },
        ];
      if (path === 'rpc/private_mail_manual_claim')
        return registered
          ? { claimed: false, entry: registered }
          : {
              claimed: true,
              entry: {
                entryId: id,
                text: proof,
                textHash: opts.body.p_hash,
                status: 'processing',
                submittedAt: mail.created_at,
                referenceDate: '2026-10-31',
              },
            };
      if (path === 'rpc/private_mail_manual_finish') {
        registerCalls++;
        assert.ok(!Object.hasOwn(opts.body.p_inference, 'jevReview'));
        return (registered = {
          entryId: id,
          text: proof,
          status: 'ready',
          submittedAt: mail.created_at,
          referenceDate: '2026-10-31',
          items: opts.body.p_items,
        });
      }
      if (path === 'rpc/private_mail_manual_jev_review') {
        reviewWrites++;
        assert.deepEqual(opts.body.p_items, registered.items);
        throw Error('synthetic metadata DB timeout');
      }
      assert.fail('unexpected query ' + path);
    },
  };
  const mainFetch=ctx.fetcher;
  ctx.fetcher=async (...args)=>{assert.equal(paidCalls,1,'pre-intent runs before main analysis');return mainFetch(...args);};
  const request = { clientRequestId: id, text: proof };
  const first = await (
    await handleManualMessage(
      'private-mail-manual-add',
      request,
      { id: target.owner_id },
      ctx,
    )
  ).json();
  assert.equal(first.status, 'ready');
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].serviceDate, '2026-11-02');
  await handleManualMessage(
    'private-mail-manual-add',
    request,
    { id: target.owner_id },
    ctx,
  );
  assert.equal(registerCalls, 1);
  assert.equal(paidCalls, 2);
  assert.equal(reviewWrites, 1);
  console.log(
    'PASS JEV runtime: server-approved pre-intent and post-advisory, bounded calls, reference skip, mail/manual dates and completion unchanged, no images, timeout/429/invalid/missing-key fail open and ready replay does not call again',
  );
}

{
  const { normalizeMailAnalysis, dailyBriefingView } =
    await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
  const { normalizeManualItems, manualDailyView } =
    await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const id = '22222222-2222-4222-8222-222222222222',
    entryId = '33333333-3333-4333-8333-333333333333';
  const mail = normalizeMailAnalysis(
    {
      summary: [],
      tasks: [
        {
          text: '가상 업무 확인',
          evidence: '가상 업무 확인 완료했습니다.',
          status: 'complete',
          completionEvidence: '가상 업무 확인 완료했습니다.',
        },
      ],
      issues: [],
      waiting: [],
    },
    {
      id,
      uidl_hash: 'a'.repeat(64),
      subject: '가상업무',
      sender: 'test@example.test',
      text: '가상 업무 확인 완료했습니다.',
      sent_at: '2026-10-30T01:00:00Z',
    },
  );
  const overrides = {
    ['work:' + id + ':tasks:0']: {
      actor: 'owner',
      done: false,
      updatedAt: '2026-10-31T03:00:00Z',
    },
  };
  assert.equal(
    dailyBriefingView({
      now: '2026-10-31T04:00:00Z',
      analyses: [mail],
      overrides,
    }).workItems[0].status,
    'pending',
  );
  const text = '가상 참고 자료';
  const entry = {
    entryId,
    status: 'ready',
    submittedAt: '2026-10-30T01:00:00Z',
    referenceDate: '2026-10-30',
    text,
    items: normalizeManualItems(
      {
        items: [
          {
            kind: 'reference',
            text,
            evidence: text,
            assignee: null,
            dueOriginal: null,
            serviceOriginal: null,
            needsConfirmation: false,
          },
        ],
      },
      {
        entryId,
        text,
        submittedAt: '2026-10-30T01:00:00Z',
        referenceDate: '2026-10-30',
      },
    ),
  };
  const ref = entry.items[0].ref;
  overrides['work:' + ref] = {
    actor: 'owner',
    category: 'task',
    done: false,
    updatedAt: '2026-10-31T03:00:00Z',
  };
  const manual = manualDailyView({ [entryId]: entry }, '2026-10-31', overrides);
  assert.equal(
    dailyBriefingView({
      now: '2026-10-31T04:00:00Z',
      analyses: [],
      manual,
      overrides,
    }).workItems[0].category,
    'task',
  );
  assert.equal(
    dailyBriefingView({
      now: '2026-10-30T04:00:00Z',
      analyses: [mail],
      overrides,
    }).workItems[0].status,
    'complete',
    'later reopen does not rewrite prior-day completion',
  );
  console.log(
    'PASS owner corrections precede mail/manual carry filters; owner reopen survives AI completion and reference-to-task carry; prior-day state retained',
  );
}

{
 const { diagnosticCapabilities, verifyApiCompatibility } = await import('../supabase/functions/_shared/ai-providers.js');
 assert.equal(diagnosticCapabilities('aiapiflow','claude-haiku-5-5').protocol,'anthropic');
 assert.equal(diagnosticCapabilities('openai','gpt-5-mini').protocol,'responses');
 assert.equal(diagnosticCapabilities('openai','text-embedding-3-small'),null);
 const unsupported=await verifyApiCompatibility({provider:'aiapiflow',model:'gemini-test',confirmation:'synthetic-compatibility'}, {}, ()=>assert.fail('no supported protocol must not make a paid request'));
 assert.equal(unsupported.checks[0].diagnosticCode,'ADAPTER_NOT_IMPLEMENTED');
 let n=0;
 const checked=await verifyApiCompatibility({provider:'aiapiflow',model:'claude-haiku-5-5',confirmation:'synthetic-compatibility'}, {AIAPIFLOW_API_KEY:'mock'}, async()=>Response.json({model:'claude-haiku-5-5',stop_reason:'end_turn',content:[{type:'text',text:++n===3?'```json\n{"ok":true}\n```':n===2?'4':'OK'}]}));
 assert.equal(checked.passed,true);
 const jev=await verifyApiCompatibility({provider:'typesafe',model:'jev-1.14.0',confirmation:'synthetic-compatibility'}, {TYPESAFE_API_KEY:'mock'}, async()=>new Response('{}',{status:529}));
 assert.equal(jev.checks[0].providerStatus,529);
 assert.equal(jev.checks[0].diagnosticCode,'RATE_LIMIT');
 assert.equal(jev.checks[0].status,'transient');
 console.log('PASS independently test unverified model protocols, exact fenced JSON validation and JEV HTTP diagnostics');
}

{
 const {handleManualMessage}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
 const {APPROVED_MAIL_TARGET:target}=await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
 const id='11111111-1111-4111-8111-111111111111';
 const entry={entryId:id,status:'ready',text:'11월2일 가상센터4P 배차',textHash:'a'.repeat(64),referenceDate:'2026-10-31',submittedAt:'2026-10-31T01:00:00Z',items:[{itemId:'item-001',kind:'dispatch',text:'가상센터4P 배차 준비',done:true,serviceDate:'2026-11-02',dueDate:null}]};
 const baseline=structuredClone(entry);let calls=0,writes=0,history=0;
 const ctx={json:Response.json,fail:(message,status)=>Object.assign(Error(message),{status}),resolveJevConfiguration:async()=>({enabled:true,key:'mock',approvedSourceIds:[id],fetcher:async(_,opts)=>{calls++;const req=JSON.parse(opts.body);return Response.json({model:'jev-1.14.0',answers:Object.fromEntries(Object.keys(req.questions).map(k=>[k,{type:'noul',noul:0.01}]))});}}),db:async(path,opts)=>{
 if(path.startsWith('private_mailboxes?'))return[{id:target.mailbox_id,owner_id:target.owner_id,enabled:true,manual_entries:{[id]:entry}}];
 if(path==='rpc/private_mail_manual_jev_review'){writes++;assert.deepEqual(opts.body.p_items,baseline.items);entry.jevReview=opts.body.p_review;return true;}
 if(path==='rpc/private_mail_history_capture_manual'){history++;assert.deepEqual(opts.body.p_entry_value.items,baseline.items);return {};}
 assert.fail('unexpected operation '+path);
 }};
 const body={entryId:id,confirmation:'existing-extraction'};
 const result=await(await handleManualMessage('private-mail-manual-verify',body,{id:target.owner_id},ctx)).json();
 assert.equal(result.saved,true);assert.equal(calls,1);assert.equal(writes,1);assert.equal(history,1);
 assert.deepEqual({...entry,jevReview:undefined},{...baseline,jevReview:undefined});
 const repeat=await(await handleManualMessage('private-mail-manual-verify',body,{id:target.owner_id},ctx)).json();
 assert.equal(repeat.status,'already_reviewed');assert.equal(calls,1);
 console.log('PASS review existing manual extraction without Luna, task mutation or replay call; immutable history retained');
}

{
 const {verifyApiCompatibility}=await import('../supabase/functions/_shared/ai-providers.js');
 const result=await verifyApiCompatibility({provider:'aiapiflow',model:'claude-haiku-4-5-20251001',confirmation:'synthetic-compatibility'},{AIAPIFLOW_API_KEY:'mock'},async()=>new Response('{}',{status:429,headers:{'retry-after':'7'}}));
 assert.equal(result.checks[0].status,'transient');
 assert.equal(result.checks[0].retryAfterSeconds,7);
}

{
 const {renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
 const html=renderBriefingWorkNote([{category:'task',title:'가상센터4P 배차 준비',status:'pending',summary:['하차 13:15','가상시 테스트로33 A동'],serviceDate:'2026-11-02',dueDate:'2026-11-01',sourceRefs:[]}]);
 assert.match(html,/<h2 style="[^"]*margin-top:18pt/);
 assert.match(html,/<li style="[^"]*margin-top:12pt/);
 assert.match(html,/line-height:150%/);
 assert.ok(html.includes('기한 2026-11-01'));
 assert.ok(!html.includes('<strong>'));
 assert.ok(!html.includes('<table'));
 console.log('PASS explicit OneNote heading/item spacing, readable line height and plain consistent body text');
}

{
 const {renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
 const item={category:'task',title:'가상센터4P 배차 준비',status:'pending',summary:['하차13:15'],serviceDate:'2026-11-02',sourceRefs:[]};
 const html=renderBriefingWorkNote([item,{...item,title:'두 번째 업무'}, {...item,category:'reference',title:'참고자료',summary:['품의 사례 참고']}, {...item,category:'reference',reportKind:'routine',title:'정기보고',summary:['온도점검 자료 수신']}]);
 assert.ok(html.includes('1. To Do') && html.includes('2. 참고사항'));
 assert.ok(html.includes('>가상센터4P 배차 준비<ul') && html.includes('>두 번째 업무<ul'));
 assert.ok(html.includes('>품의 사례 참고</li>') && html.includes('>온도점검 자료 수신</li>'));
 assert.match(html,/<ul style="list-style-type:disc"><li style="[^"]*">2026\.11\.2\(월\) 13:15 하차/);
 assert.match(html,/<ol style="list-style-type:decimal"><li style="[^"]*">가상센터4P 배차 준비<ul/);
 assert.ok(!html.includes('<strong>가상센터4P 배차 준비'));
 assert.ok(html.includes('font-family:Malgun Gothic,Arial,sans-serif'));
 console.log('PASS uniform report hierarchy: consecutive sections, native numbered items, nested supporting detail, plain consistent body font');
}

{
 const {workSummaryForDisplay}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
 const item={serviceDate:'2026-11-02',summary:['하차 13:15','경상남도 창원시 테스트로33']};
 const original=structuredClone(item);
 assert.deepEqual(workSummaryForDisplay(item),['2026.11.2(월) 13:15 하차','경상남도 창원시 테스트로33']);
 assert.deepEqual(item,original);
 assert.deepEqual(workSummaryForDisplay({summary:['하차 13:15']}),['하차 13:15']);
 assert.deepEqual(workSummaryForDisplay({...item,summary:['11/3 하차13:15']}),['11/3 하차13:15']);
 console.log('PASS Korean date-before-time display from confirmed service date, no source mutation or date inference');
}

{
 const {readFile}=await import('node:fs/promises');
 const {createHash}=await import('node:crypto');
 const path=new URL('../supabase/functions/onedrive-auth/private-mail-notes-writer.js',import.meta.url);
 let source=await readFile(path,'utf8');
 for(const file of ['private-mail-briefing-model.js','private-mail-briefing.js'])source=source.replace("'./"+file+"'",JSON.stringify(new URL(file,path).href));
 const {snapshot}=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {snapshot};').toString('base64'));
 const marker='sajo-mail-daily-2026-10-31';
 const inner='<table id="inner" data-id="'+marker+'"><tr><td><ol><li>업무<ul><li>세부</li></ul></li></ol></td></tr></table>';
 const page=body=>'<html><body><div>'+body+'<div data-id="sajo-mail-manual"><p>개인 메모</p></div></div></body></html>';
 const hash=async s=>createHash('sha256').update(s).digest('hex');
 const wrapped='<table id="outer" data-id="'+marker+'"><tr><td>'+inner+'</td></tr></table>';
 const checked=await snapshot({html:page(wrapped),marker,hash});
 assert.equal(checked.needsManagedCollapse,true);
 assert.equal(checked.managedTargets.length,1);
 assert.equal(checked.managedTargets[0].attrs.id,'outer');
 await assert.rejects(()=>snapshot({html:page(inner+inner.replace('id="inner"','id="other"')),marker,hash}),/PAGE_MANAGED_AMBIGUOUS/);
 await assert.rejects(()=>snapshot({html:page(wrapped.replace('<td><table','<td><p>소유자 추가 내용</p><table')),marker,hash}),/PAGE_MANAGED_AMBIGUOUS/);
 console.log('PASS recover only empty nested managed shells; reject independent duplicates and owner content outside inner region');
}

{
const {normalizeManualItems,resolveDispatchAssignment}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const day='2026-10-31',entryId='aaaaaaaa-1111-4111-8111-000000000001';
const text='11/2 쿠팡창원 4p 배차 요청\n양산공장 상차 09:00\n하차 13:15';
const raw={kind:'dispatch',text:'쿠팡창원 4p 배차',evidence:'11/2 쿠팡창원 4p 배차 요청',serviceOriginal:'11/2'};
const options={text,entryId,submittedAt:'2026-10-31T01:00:00Z',referenceDate:day};
const e={entryId,status:'ready',text,submittedAt:options.submittedAt,items:normalizeManualItems({items:[raw]},options)};
const wire='11월2일\n부산공장(09:00상)-창원쿠팡\n경기12바3456 홍길동 01018832830';
for(const [name,test] of [
 ['known origin conflict stays unlinked',()=>{const r=resolveDispatchAssignment(wire,{[entryId]:e},day);assert.equal(r.items[0].workRef,null);assert.equal(r.items[0].needsConfirmation,true)}],
 ['matching known origin links',()=>assert.equal(resolveDispatchAssignment(wire.replace('부산공장','양산공장'),{[entryId]:e},day).items[0].workRef,e.items[0].ref)],
 ['unknown origin retains existing destination match',()=>{const unknown={...e,text:'11/2 쿠팡창원 4p 배차 요청'};assert.equal(resolveDispatchAssignment(wire,{[entryId]:unknown},day).items[0].workRef,e.items[0].ref)}],
 ['deictic request normalizes into confirmation',()=>{const s='이거 해줘';const result=normalizeManualItems({items:[{kind:'issue',text:'요청 내용 확인',evidence:s,needsConfirmation:true}]},{...options,text:s});assert.equal(result[0].needsConfirmation,true);assert.equal(result[0].kind,'issue')}],
 ['deictic request must not be discarded by empty extraction',()=>{const s='이것 좀 해주세요';const result=normalizeManualItems({items:[]},{...options,text:s});assert.equal(result.length,1);assert.equal(result[0].needsConfirmation,true)}],
 ['deictic reference classification still requires confirmation',()=>{const s='그거 부탁드립니다';const result=normalizeManualItems({items:[{kind:'reference',text:'참고',evidence:s,needsConfirmation:false}]},{...options,text:s});assert.equal(result[0].kind,'issue');assert.equal(result[0].needsConfirmation,true)}],
 ['greeting remains empty',()=>assert.equal(normalizeManualItems({items:[]},{...options,text:'안녕하세요. 잘 부탁드립니다.'}).length,0)],
 ['quoted example stays rejected',()=>assert.throws(()=>normalizeManualItems({items:[{kind:'issue',text:'요청 내용 확인',evidence:'이거 해줘'}]},{...options,text:'예시: 이거 해줘'}),/MANUAL_EVIDENCE/)],
]) { test(); }
}

{
 const {handleMailAutomation}=await import('../supabase/functions/onedrive-auth/private-mail-background.js');
 const {APPROVED_MAIL_TARGET:target}=await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
 const {stressCatalogue,parseStressMail,runStressCase}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
 const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
 const ctx={db:()=>assert.fail('catalogue/unauthorized checks must not access operational storage'),json:Response.json,fail:(message)=>Error(message)};
 await assert.rejects(()=>handleMailAutomation('private-mail-stress-verify',{confirmation:'isolated-stress',list:true},{id:'not-owner'},ctx),/OWNER_REQUIRED/);
 await assert.rejects(()=>handleMailAutomation('private-mail-stress-verify',{list:true},{id:target.owner_id},ctx),/STRESS_CONFIRMATION_REQUIRED/);
 const result=await(await handleMailAutomation('private-mail-stress-verify',{confirmation:'isolated-stress',list:true},{id:target.owner_id},ctx)).json();
 assert.equal(result.cases.length,stressCatalogue().length);assert.ok(result.cases.length>=15);
 assert.equal(result.productionBusinessWritten,false);assert.equal(result.oneNoteWritten,false);
 await assert.rejects(()=>runStressCase('arbitrary-client-body',{}),/STRESS_CASE_INVALID/);
 const fixture=fixtureById('mail-cid-evidence-duplicate-signatures');
 assert.ok(Object.isFrozen(fixture.expected));
 const parsed=await parseStressMail(fixture,()=>assert.fail('CID mail does not download remote content'));
 assert.equal(parsed.parser.attachments,3);assert.equal(parsed.source.images.length,1);assert.equal(parsed.parser.excludedImages.length,2);
 console.log('PASS fixed stress corpus, frozen expectations, owner-only diagnostic, real MIME/CID extraction and no operational persistence');
}

{
 const {analyzePrivateMail}=await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
 const id='f9999999-9999-4999-8999-999999999999',proof='테스트담당자님, 가상문서 검토 부탁드립니다.';let saved;
 const value={intent:{kind:'request',evidence:proof},group:null,summary:[],tasks:[{text:'가상문서 검토',evidence:proof,status:'pending',assignee:null,due:null,serviceOriginal:null,completionEvidence:null,forOwner:true,recipientScope:'owner_direct',selfRequestEvidence:proof}],issues:[],waiting:[],updates:[],imageFacts:[],imageDecisions:[],imageItems:{tasks:[],issues:[],waiting:[]}};
 const result=await analyzePrivateMail({messageId:id,ownerName:'테스트담당자',provider:'openai',model:'gpt-6-luna',key:'mock',now:'2026-11-02T01:00:00Z',loadMail:async()=>({id,uidl_hash:'f'.repeat(64),subject:'가상 검토',sender:'sender@example.test',sent_at:'2026-11-02T00:00:00Z',created_at:'2026-11-02T01:00:00Z',headers:'From: sender@example.test\r\nTo: owner@example.test\r\nDate: Mon, 2 Nov 2026 00:00:00 +0000',text:proof,ownerContext:{recipientRole:'to',senderIsOwner:false}}),fetcher:async()=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]}),store:{claim:async()=>({row:{id,uidl_hash:'f'.repeat(64)},lease:'test'}),finish:async input=>{saved=input.analysis;return true;},fail:async()=>true}});
 assert.equal(result.status,'done');assert.equal(saved.tasks.length,1);assert.equal(saved.source.ownerContext.ownerName,'테스트담당자');
 console.log('PASS owner identity comes from trusted analysis context; synthetic named recipient is not another person');
}

{
 const {dateFrom,normalizeManualItems}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
 assert.equal(dateFrom('11월 3일(수)','2026-11-02'),null,'conflicting weekday must not become a confirmed service date');
 assert.equal(dateFrom('11월 3일(수)까지','2026-11-02'),null);
 assert.equal(dateFrom('11월 3일(화)','2026-11-02'),'2026-11-03');
 assert.equal(dateFrom('11/2 월','2026-10-31'),'2026-11-02');
 const text='이거 좀 해주세요. 자료는 뒤에 보낼게요.';
 const items=normalizeManualItems({items:[{kind:'waiting',text:'자료 전달 대기',evidence:'자료는 뒤에 보낼게요.',assignee:null,serviceOriginal:null,dueOriginal:null,needsConfirmation:false}]},{text,entryId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',submittedAt:'2026-11-02T01:00:00.000Z',referenceDate:'2026-11-02'});
 assert.equal(items.length,1);assert.equal(items[0].kind,'issue');assert.equal(items[0].needsConfirmation,true);assert.equal(items[0].evidence,text);assert.equal(items[0].serviceDate,null);
 console.log('PASS contradictory weekday withheld and contextless request retained despite secondary waiting extraction');
}

{
 const {reviewNormalizedManual}=await import('../supabase/functions/onedrive-auth/private-mail-jev-verifier.js');
 const id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',ref='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:manual:item-001';let outgoing;
 const entry={entryId:id,status:'ready',text:'11월 3일 가상구름센터 12P 차량 배정을 완료했습니다. 같은 날 8P는 배정 대기입니다.',submittedAt:'2026-11-02T01:00:00Z',referenceDate:'2026-11-02',items:[{itemId:'item-001',kind:'waiting',text:'가상구름센터 8P 차량 배정 대기',evidence:'같은 날 8P는 배정 대기입니다.'}]};
 const review=await reviewNormalizedManual({entry,related:[{ref,kind:'dispatch',text:'가상구름센터 12P 배차 준비',status:'pending',serviceDate:'2026-11-03'}],config:{enabled:true,approvedSourceIds:[id],key:'mock',timeoutMs:1000,fetcher:async(_,opts)=>{outgoing=JSON.parse(opts.body);return Response.json({model:'jev-1.14.0',answers:Object.fromEntries(Object.keys(outgoing.questions).map(k=>[k,{type:'noul',noul:k==='q0'?0.8:0.01}]))});}}});
 assert(outgoing.state.proposed.some(item=>item.text.includes('whole_extraction_coverage')),'verify omitted requested updates, not merely truth of remaining claims');
 assert(outgoing.state.source.includes(ref),'unselected but relevant existing candidate must be visible to coverage review');
 assert.match(outgoing.questions.q0.instructions,/누락/);assert.equal(review.status,'review');assert.equal(review.coverageChecked,true);assert.deepEqual(entry.items[0].kind,'waiting');
 const explicit={...entry,items:[{...entry.items[0],workRef:ref}]};
 const earlier=Array.from({length:8},(_,i)=>({ref:'earlier-'+i,kind:'dispatch',text:'가상구름센터 다른 업무 '+i,status:'pending'}));
 await reviewNormalizedManual({entry:explicit,related:[...earlier,{ref,kind:'dispatch',text:'가상구름센터 12P 배차 준비',status:'pending'}],config:{enabled:true,approvedSourceIds:[id],key:'mock',timeoutMs:1000,fetcher:async(_,opts)=>{outgoing=JSON.parse(opts.body);return Response.json({model:'jev-1.14.0',answers:Object.fromEntries(Object.keys(outgoing.questions).map(k=>[k,{type:'noul',noul:0.01}]))});}}});
 assert.equal(JSON.parse(outgoing.state.source).candidates[0].ref,ref,'explicit link wins over earlier same-center heuristic candidates');
 console.log('PASS JEV omission/linkage coverage independent of local claim support, candidate context and original extraction preserved');
}

{

const manual=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const {dailyWorkItems}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
const resolve=manual.resolveExistingManualWork??manual.resolveDispatchAssignment;
let failures=0;
for(const name of ['manual-split-supplement-exact','manual-followup-without-pronoun','manual-late-correction-targeted','manual-exact-followup-partial-evidence','manual-cancelled-then-new-request','manual-two-similar-same-day-ambiguous','manual-separate-request-same-center'])try{
 const f=fixtureById(name),entries=Object.fromEntries(f.related.map(x=>[x.entryId,structuredClone(x)])),before=JSON.stringify(entries);const resolved=resolve(f.text,entries,f.referenceDate,f.now);assert.ok(resolved,'recognized exact source-grounded update/request must survive');const newId='f9999999-1111-4111-8111-999999999999';const items=manual.normalizeManualItems(resolved,{text:f.text,entryId:newId,submittedAt:f.now,referenceDate:f.referenceDate,allowLinks:true,verifiedDispatchReply:true,verifiedReplyRef:resolved.items[0].workRef,replyDetails:resolved.details??[]});
 const expected=f.expected;const linked=items.map(x=>x.workRef).filter(Boolean);assert.deepEqual(linked,expected.link.mode==='exact'?expected.link.refs:[]);if(expected.classification==='ambiguous_link'){assert.equal(items[0].kind,'issue');assert.equal(items[0].needsConfirmation,true)}
 assert.equal(items[0].workflowStatus,expected.expectedStatus);assert.equal(items[0].dueDate,null);if(expected.serviceDate)assert.equal(items[0].serviceDate,expected.serviceDate);
 const originalItemRefs=new Set(f.related.flatMap(x=>x.items.map(i=>i.ref)));entries[newId]={entryId:newId,status:'ready',text:f.text,submittedAt:f.now,items};const work=dailyWorkItems({day:f.referenceDate,groups:[],tasks:[],issues:[],waiting:[]},manual.manualDailyView(entries,f.referenceDate));
 if(expected.link.mode==='exact'){const target=work.find(x=>x.workId===expected.link.refs[0]);assert.ok(target);assert.equal(target.status,expected.expectedStatus);assert.equal(work.filter(x=>x.workId===target.workId).length,1);if(expected.quantity)assert.ok(target.title.includes(expected.quantity+'P'),'updated quantity visible');}
 if(expected.expectedHistory?.newIndependentTask)assert.ok(items.every(x=>!originalItemRefs.has(x.ref)&&!x.workRef));
 delete entries[newId];assert.equal(JSON.stringify(entries),before,'originals unchanged');console.log('PASS',name);
}catch(e){failures++;console.log('FAIL',name,e.message)}
if(failures)process.exitCode=1;

}

{
const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');const {resolveExistingManualWork,normalizeManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');const {dailyWorkItems}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const f=fixtureById('manual-late-correction-targeted'),base=f.related[0],day=f.referenceDate,now=f.now;
const seed=()=>Object.fromEntries(f.related.map(x=>[x.entryId,structuredClone(x)]));let failures=0;
function save(entries,result,id){const items=normalizeManualItems(result,{text:result.sourceText,entryId:id,submittedAt:now,referenceDate:day,allowLinks:true,verifiedDispatchReply:true,verifiedReplyRef:result.items[0].workRef,replyDetails:result.details??[]});for(const item of items)if(result.resolution)item.resolution=result.resolution;entries[id]={entryId:id,status:'ready',text:result.sourceText,submittedAt:now,items};return items;}
for(const[name,test]of[
['correction then another supplement retains latest quantity and stable work',()=>{const entries=seed();save(entries,resolveExistingManualWork(f.text,entries,day,now),'ffffffff-1111-4111-8111-000000000001');const second=resolveExistingManualWork('11월 3일 가상구름센터 10P 요청 건 추가정보입니다. 출발은 가상별창고입니다.',entries,day,now);assert.equal(second.items[0].workRef,base.ref);assert.ok(second.items[0].text.includes('10P'))}],
['conflicting known loading place never completes',()=>{const entries=seed();entries[base.entryId].text+='\n상차지: 가상달창고';const result=resolveExistingManualWork('11월 3일 가상구름센터 12P 차량 배정 완료했습니다. 출발지: 가상별창고',entries,day,now);assert.equal(result.items[0].workRef,undefined);assert.equal(result.items[0].needsConfirmation,true)}],
['new verified preparation completion advances an earlier owner reopen',()=>{const entries=seed();entries[base.entryId].items[0].completionEvents=[{done:true,at:'2026-11-01T03:00:00Z'},{done:false,at:'2026-11-02T00:30:00Z'}];entries[base.entryId].items[0].ownerUpdatedAt='2026-11-02T00:30:00Z';const result=resolveExistingManualWork('11월 3일 가상구름센터 12P 차량 배정 완료했습니다.',entries,day,now);save(entries,result,'ffffffff-1111-4111-8111-000000000002');const work=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(entries,day)).find(x=>x.workId===base.ref);assert.equal(work.status,'complete');assert.equal(work.verifiedCompletionAt,new Date(now).toISOString())}],
['multiple independent requests use full extraction',()=>assert.equal(resolveExistingManualWork('별도 신규 요청입니다. 11월 3일 가상구름센터 12P 배차 부탁드립니다. 11월 4일 가상구름센터 8P 배차 부탁드립니다.',seed(),day,now),null)],
['completion negation never becomes completion',()=>{const r=resolveExistingManualWork('11월 3일 가상구름센터 12P 차량 배정 완료가 아닙니다.',seed(),day,now);assert.ok(!r||r.items.every(x=>x.workflowStatus!=='complete'))}],
])try{test();console.log('PASS',name)}catch(e){failures++;console.log('FAIL',name,e.message)}if(failures)process.exitCode=1;

}

{

const {runStressCase}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
const {dailyBriefingView,projectMailDates}=await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
const f=fixtureById('mail-direct-approval-reply'),proof='테스트담당자님, 가상문서 승인안 검토 후 오늘 17시까지 승인 회신 부탁드립니다.';
const value={intent:{kind:'request',evidence:proof},group:null,summary:[{text:'가상문서 승인 회신 요청',evidence:proof}],tasks:[],issues:[],waiting:[],updates:[{ref:f.related[0].ref,status:'pending',evidence:proof,text:'가상문서 승인안 검토 후 회신',due:'오늘 17시까지'}],imageFacts:[],imageDecisions:[],imageItems:{tasks:[],issues:[],waiting:[]}};
const ctx={resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'synthetic-key'}),resolveJevConfiguration:async()=>null,fetcher:async()=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]})};
const result=await runStressCase(f.id,ctx);
assert.equal(result.status,'done');assert.equal(result.saved.updates[0].dueDate,'2026-11-02');assert.equal(result.saved.updates[0].dueAt,'2026-11-02T08:00:00.000Z');
assert.equal(result.automatedChecksPassed,true);
const prior=result.diagnostics.adaptedRelated[0],original=structuredClone(prior),ref=f.related[0].ref;
const view=dailyBriefingView({now:f.now,analyses:[prior,result.saved],overrides:{[ref]:{actor:'owner',done:true,updatedAt:f.now}}});
assert.equal(view.tasks.find(t=>t.ref===ref).dueAt,'2026-11-02T08:00:00.000Z');assert.equal(view.tasks.find(t=>t.ref===ref).status,'complete');assert.deepEqual(prior,original,'projection never rewrites old source');
const rebased=projectMailDates(result.saved,{sent_at:'2026-11-04T00:00:00Z',received_at:null,created_at:'2026-11-06T00:00:00Z'});assert.equal(rebased.updates[0].dueDate,'2026-11-04');
for(const due of ['내일 09:00','오늘 17시까지 본문외추가']) {
 value.updates[0].due=due;const invalid=await runStressCase(f.id,ctx);assert.equal(invalid.status,'failed');assert.equal(invalid.code,'ANALYSIS_DEADLINE');
}
value.updates[0].due=null;const noDeadline=await runStressCase(f.id,ctx);assert.equal(noDeadline.status,'done');assert.equal(noDeadline.saved.updates[0].dueAt,undefined);
value.updates[0].due='승인 회신';const unlabeled=await runStressCase(f.id,ctx);assert.equal(unlabeled.status,'done');assert.equal(unlabeled.saved.updates[0].dueAt,null);assert.equal(unlabeled.saved.updates[0].dueDate,null);
console.log('PASS approval deadline: optional exact new-message due, computed from received/sent day, linked projection preserves old source/owner completion; unquoted dates fail and unlabelled/no deadline never invents a due');

}

{
const {runStressCase,parseStressMail}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
const {analyzePrivateMail}=await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
const empty=()=>({intent:{kind:'request',evidence:null},group:null,summary:[],tasks:[],issues:[],waiting:[],updates:[],imageFacts:[],imageDecisions:[],imageItems:{tasks:[],issues:[],waiting:[]}});
const response=value=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}});
const approvalFixture=fixtureById('mail-direct-approval-reply');
const approvalProof='테스트담당자님, 가상문서 승인안 검토 후 오늘 17시까지 승인 회신 부탁드립니다.';
const approvalValue={...empty(),intent:{kind:'request',evidence:approvalProof},summary:[{text:'승인 회신 요청',evidence:approvalProof}],updates:[{ref:approvalFixture.related[0].ref,status:'pending',evidence:approvalProof,text:'가상문서 승인안 검토 후 승인 회신',due:null}]};
let calls=0;
const ctx={resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'SYNTHETIC_ONLY'}),resolveJevConfiguration:async()=>null,fetcher:async()=>{calls++;return response(approvalValue);}};
const approval=await runStressCase(approvalFixture.id,ctx);assert.equal(approval.status,'done');assert.equal(calls,1);
assert.equal(approval.input.related[0].source.thread.messageId,'approval@thread.example.test');
assert.equal(approval.diagnostics.adaptedRelated[0].source.thread.messageId,'<approval@thread.example.test>');
assert.equal(approval.requests.length,1);assert.equal(approval.replay.length,1);assert.ok(!JSON.stringify(approval).includes('SYNTHETIC_ONLY'));
assert.equal(approval.automatedChecksPassed,false,'approval deadline metadata/fixture intent still independently evaluated; no forced pass');
console.log('CONFIRMED fixture precondition: bare related Message-ID failed before provider; harness canonical adaptation preserves original and request/replay; expected approval deadline gap remains',approval.checks);
const configFailure=await runStressCase(approvalFixture.id,{resolveAiConfiguration:async()=>({})});
assert.equal(configFailure.code,'STRESS_AI_CONFIGURATION');assert.equal(configFailure.trace.length,0);assert.equal(configFailure.input.mime,approvalFixture.mime);assert.deepEqual(configFailure.input.related,approvalFixture.related);
assert.equal(configFailure.diagnostics.stage,'configuration');
const providerFailure=await runStressCase(approvalFixture.id,{...ctx,fetcher:async()=>{throw Error('synthetic network failure');}});
assert.equal(providerFailure.input.mime,approvalFixture.mime);assert.equal(providerFailure.requests.length,1);assert.equal(providerFailure.trace[0].status,'transport_failed');
const oldFixture=fixtureById('mail-old-sent-collected-today'),oldSource=(await parseStressMail(oldFixture)).source;
const oldProof='테스트담당자님, 내일 가상별창고 6P 배차 준비 부탁드립니다.',shortProof='내일 가상별창고 6P 배차 준비 부탁드립니다.';
const task={text:'가상별창고 배차 준비',evidence:shortProof,status:'pending',assignee:'테스트담당자',due:null,serviceOriginal:'내일',completionEvidence:null,forOwner:true,recipientScope:'owner_direct',selfRequestEvidence:oldProof};
const oldValue={...empty(),intent:{kind:'request',evidence:oldProof},summary:[{text:'가상별창고 6P 배차 요청',evidence:oldProof}],tasks:[task]};
async function analyze(fn,source,value){return fn({messageId:source.id,provider:'openai',model:'gpt-6-luna',key:'SYNTHETIC_ONLY',now:oldFixture.now,ownerName:'테스트담당자',loadMail:async()=>source,fetcher:async()=>response(value),store:{claim:async()=>({row:{id:source.id,uidl_hash:source.uidl_hash},lease:'local'}),finish:async()=>true,fail:async()=>true}});}
const fixedOld=await analyze(analyzePrivateMail,oldSource,oldValue);assert.equal(fixedOld.status,'done');assert.equal(fixedOld.analysis.tasks[0].assignee,'테스트담당자');assert.equal(fixedOld.analysis.tasks[0].assigneeConfirmed,false);assert.equal(fixedOld.analysis.tasks[0].serviceDate,'2026-10-30');assert.equal(fixedOld.analysis.tasks[0].dueAt,null);
for(const invalidTask of [{...task,assignee:'다른가상인물'},{...task,selfRequestEvidence:'본문에 없는 테스트담당자님 요청'}])assert.equal((await analyze(analyzePrivateMail,oldSource,{...oldValue,tasks:[invalidTask]})).code,'ANALYSIS_ASSIGNEE');
const quotedSource={...oldSource,text:'참고 전달입니다.\n\n-----Original Message-----\n'+oldProof};
assert.equal((await analyze(analyzePrivateMail,quotedSource,oldValue)).code,'ANALYSIS_ASSIGNEE','forwarded names cannot corroborate current ownership');
console.log('CONFIRMED scoped assignee rejection: exact named same-request proof accepted; action-only/name mismatch/forged/forwarded proof still rejected; dates and unconfirmed assignee state preserved');
const cidFixture=fixtureById('mail-cid-evidence-duplicate-signatures'),cidSource=(await parseStressMail(cidFixture)).source;
const cidProof='테스트담당자님, 가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다.',fact='TEMP 4 C / ROUTINE CHECK: NORMAL';
const cidValue={...empty(),intent:{kind:'request',evidence:cidProof},summary:[{text:'가상구름센터 온도 이탈 조치 회신 요청',evidence:cidProof},{text:'이미지 점검표에는 4 C와 정상 상태가 표시됨',evidence:fact}],tasks:[{...task,text:'온도 이탈 확인 후 조치 회신',evidence:cidProof,assignee:null,serviceOriginal:null,selfRequestEvidence:cidProof}],issues:[{text:'본문의 온도 이탈 주장과 이미지의 정상 표시가 달라 확인 필요',evidence:cidProof,status:'needs_confirmation',impact:null,latest:null,completionEvidence:null}],imageFacts:[{imageId:cidSource.images[0].id,text:fact,confidence:'readable'}],imageDecisions:[{imageId:cidSource.images[0].id,kind:'business_document',include:true}]};
const cidFixed=await analyze(analyzePrivateMail,cidSource,cidValue);assert.equal(cidFixed.status,'done');assert.equal(cidFixed.analysis.summary.length,1);assert.equal(cidFixed.analysis.imageSummary[0].evidence,fact);assert.equal(cidFixed.analysis.review.needsConfirmation,true);assert.equal(cidFixed.analysis.source.intent,'request','no coerced issue classification');assert.equal(cidFixed.analysis.tasks[0].status,'pending');assert.equal(cidFixed.analysis.issues[0].status,'needs_confirmation');
const unsupported=structuredClone(cidValue);unsupported.summary[1].evidence='이미지에서 검증되지 않은 새 근거';const quarantined=await analyze(analyzePrivateMail,cidSource,unsupported);assert.equal(quarantined.status,'done');assert.equal(quarantined.analysis.summary.length,1);assert.equal(quarantined.analysis.imageSummary[0].verification,'unverified');assert.equal(quarantined.analysis.imageSummary[0].needsConfirmation,true);
const invalidTask=structuredClone(cidValue);invalidTask.tasks[0].evidence=fact;assert.equal((await analyze(analyzePrivateMail,cidSource,invalidTask)).code,'ANALYSIS_EVIDENCE','image summary fallback never accepts image evidence as body task');
console.log('CONFIRMED image-summary boundary: request/routine mixed evidence fails original; exact approved readable image evidence separated, uncertainty retained; unverified image summary stays quarantined and image-derived body tasks still fail');
console.log('PASS local hard-failure reproductions; no network calls, operating persistence, fixture/expectation edits or live semantic pass claims');
}

{
const {resolveExistingManualWork}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
for(const id of ['manual-split-supplement-exact','manual-followup-without-pronoun','manual-late-correction-targeted','manual-exact-followup-partial-evidence','manual-cancelled-then-new-request']){const f=fixtureById(id),entries=Object.fromEntries(f.related.map(e=>[e.entryId,structuredClone(e)]));const r=resolveExistingManualWork(f.text,entries,f.referenceDate,f.now);assert.ok(r);assert.ok(r.details.every(x=>!/(?:추가정보|그대로|기존|뜻은|아닙니다|요청|수량은|정정)/.test(x)),'details must contain compact operational facts, not source clauses: '+id);if(id==='manual-split-supplement-exact')assert.deepEqual(r.details,['출발 가상별창고','하차 09:00']);assert.equal(r.sourceText,f.text);assert.ok(f.text.includes(r.items[0].evidence));console.log('PASS concise details and unchanged source',id,r.details)}

}

{
// Original failed parsed model values supplied by the browser verifier; no new provider call.
const recorded=[{"caseId":"mail-cid-evidence-duplicate-signatures","value":{"intent":{"kind":"request","evidence":"테스트담당자님, 가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다."},"group":{"name":"가상구름센터","evidence":"가상구름센터"},"summary":[{"text":"가상구름센터 점검표에는 2026-11-03 서비스, 팔레트 12개, 09:00 하역, 온도 4°C 및 정기 점검 정상으로 기재되어 있습니다.","evidence":"SERVICE 2026-11-03 | PALLETS 12\nUNLOAD 09:00 | TEMP 4 C\nROUTINE CHECK: NORMAL"}],"issues":[{"text":"발신자는 가상구름센터의 온도 이탈을 확인하고 조치 내용을 회신해 달라고 요청했습니다.","evidence":"가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다.","status":"needs_confirmation","impact":"온도 이탈 여부 및 조치 내용 확인이 필요합니다.","latest":"첨부 점검표에는 TEMP 4 C 및 ROUTINE CHECK: NORMAL로 적혀 있어 본문 요청과 차이가 있습니다.","completionEvidence":null}],"tasks":[{"text":"가상구름센터 온도 이탈을 확인하고 조치 내용을 회신합니다.","evidence":"테스트담당자님, 가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다.","status":"pending","assignee":"테스트담당자","due":null,"completionEvidence":null,"serviceOriginal":null,"forOwner":true,"recipientScope":"owner_direct","selfRequestEvidence":"테스트담당자님, 가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다."}],"waiting":[],"updates":[],"imageFacts":[{"imageId":"f0000000-0000-4000-8000-000000000003:0","text":"합성 점검표: 서비스 2026-11-03, 팔레트 12개, 하역 09:00, 온도 4°C, 정기 점검 정상.","confidence":"readable"}],"imageDecisions":[{"imageId":"f0000000-0000-4000-8000-000000000003:0","kind":"business_document","include":true}],"imageItems":{"tasks":[],"issues":[],"waiting":[]}}},{"caseId":"mail-old-sent-collected-today","value":{"intent":{"kind":"request","evidence":"테스트담당자님, 내일 가상별창고 6P 배차 준비 부탁드립니다."},"group":{"name":"가상별창고","evidence":"가상별창고"},"summary":[{"text":"가상별창고 6P의 내일 배차 준비 요청이며, 하차 예정 시각은 09:00입니다.","evidence":"내일 가상별창고 6P 배차 준비 부탁드립니다. 하차 예정은 09:00입니다."}],"issues":[],"tasks":[{"text":"가상별창고 6P의 내일 배차를 준비합니다. 하차 예정 시각은 09:00입니다.","evidence":"내일 가상별창고 6P 배차 준비 부탁드립니다. 하차 예정은 09:00입니다.","status":"pending","assignee":"테스트담당자","due":null,"completionEvidence":null,"serviceOriginal":"내일","forOwner":true,"recipientScope":"owner_direct","selfRequestEvidence":"테스트담당자님, 내일 가상별창고 6P 배차 준비 부탁드립니다."}],"waiting":[],"updates":[],"imageFacts":[],"imageDecisions":[],"imageItems":{"tasks":[],"issues":[],"waiting":[]}}},{"caseId":"manual-contextless-deictic-request","value":{"items":[{"kind":"waiting","text":"자료 전달 대기","evidence":"자료는 뒤에 보낼게요.","assignee":null,"serviceOriginal":null,"dueOriginal":null,"needsConfirmation":false}],"authoredDate":null,"inputKind":"business"}}];
const {runStressCase}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
for(const {caseId,value} of recorded){const r=await runStressCase(caseId,{resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'mock'}),resolveJevConfiguration:async()=>null,fetcher:async()=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]})});assert.notEqual(r.status,'failed',caseId);if(caseId==='mail-cid-evidence-duplicate-signatures'){assert.equal(r.checks.intent,false,'original classification mismatch remains visible');assert.equal(r.saved.summary.length,0);assert.equal(r.saved.imageSummary[0].verification,'unverified');assert.equal(r.saved.imageSummary[0].needsConfirmation,true);assert.equal(r.saved.review.needsConfirmation,true)}else{assert.equal(r.automatedChecksPassed,true,caseId)}}
console.log('PASS recorded failed parsed responses replay; CID original intent mismatch retained and unverified evidence quarantined');
}
{
  // Parent-transcribed original parsed values; only the completed Responses envelope is synthetic.
  const {runStressCase,parseStressMail}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
  const {analyzePrivateMail}=await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
  const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
  const originalMailValues = [
  {
    "caseId": "mail-cid-evidence-duplicate-signatures",
    "value": {
      "intent": {
        "kind": "request",
        "evidence": "테스트담당자님, 가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다."
      },
      "group": {
        "name": "가상구름센터",
        "evidence": "가상구름센터"
      },
      "summary": [
        {
          "text": "가상구름센터 점검표에는 2026-11-03 서비스, 팔레트 12개, 09:00 하역, 온도 4°C 및 정기 점검 정상으로 기재되어 있습니다.",
          "evidence": "SERVICE 2026-11-03 | PALLETS 12\nUNLOAD 09:00 | TEMP 4 C\nROUTINE CHECK: NORMAL"
        }
      ],
      "issues": [
        {
          "text": "발신자는 가상구름센터의 온도 이탈을 확인하고 조치 내용을 회신해 달라고 요청했습니다.",
          "evidence": "가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다.",
          "status": "needs_confirmation",
          "impact": "온도 이탈 여부 및 조치 내용 확인이 필요합니다.",
          "latest": "첨부 점검표에는 TEMP 4 C 및 ROUTINE CHECK: NORMAL로 적혀 있어 본문 요청과 차이가 있습니다.",
          "completionEvidence": null
        }
      ],
      "tasks": [
        {
          "text": "가상구름센터 온도 이탈을 확인하고 조치 내용을 회신합니다.",
          "evidence": "테스트담당자님, 가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다.",
          "status": "pending",
          "assignee": "테스트담당자",
          "due": null,
          "completionEvidence": null,
          "serviceOriginal": null,
          "forOwner": true,
          "recipientScope": "owner_direct",
          "selfRequestEvidence": "테스트담당자님, 가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다."
        }
      ],
      "waiting": [],
      "updates": [],
      "imageFacts": [
        {
          "imageId": "f0000000-0000-4000-8000-000000000003:0",
          "text": "합성 점검표: 서비스 2026-11-03, 팔레트 12개, 하역 09:00, 온도 4°C, 정기 점검 정상.",
          "confidence": "readable"
        }
      ],
      "imageDecisions": [
        {
          "imageId": "f0000000-0000-4000-8000-000000000003:0",
          "kind": "business_document",
          "include": true
        }
      ],
      "imageItems": {
        "tasks": [],
        "issues": [],
        "waiting": []
      }
    }
  },
  {
    "caseId": "mail-old-sent-collected-today",
    "value": {
      "intent": {
        "kind": "request",
        "evidence": "테스트담당자님, 내일 가상별창고 6P 배차 준비 부탁드립니다."
      },
      "group": {
        "name": "가상별창고",
        "evidence": "가상별창고"
      },
      "summary": [
        {
          "text": "가상별창고 6P의 내일 배차 준비 요청이며, 하차 예정 시각은 09:00입니다.",
          "evidence": "내일 가상별창고 6P 배차 준비 부탁드립니다. 하차 예정은 09:00입니다."
        }
      ],
      "issues": [],
      "tasks": [
        {
          "text": "가상별창고 6P의 내일 배차를 준비합니다. 하차 예정 시각은 09:00입니다.",
          "evidence": "내일 가상별창고 6P 배차 준비 부탁드립니다. 하차 예정은 09:00입니다.",
          "status": "pending",
          "assignee": "테스트담당자",
          "due": null,
          "completionEvidence": null,
          "serviceOriginal": "내일",
          "forOwner": true,
          "recipientScope": "owner_direct",
          "selfRequestEvidence": "테스트담당자님, 내일 가상별창고 6P 배차 준비 부탁드립니다."
        }
      ],
      "waiting": [],
      "updates": [],
      "imageFacts": [],
      "imageDecisions": [],
      "imageItems": {
        "tasks": [],
        "issues": [],
        "waiting": []
      }
    }
  }
];
  const envelope=value=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
  const results = new Map();
  for(const {caseId,value} of originalMailValues) {
    let calls=0;
    const result=await runStressCase(caseId,{resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'SYNTHETIC_REPLAY_ONLY'}),resolveJevConfiguration:async()=>null,
      fetcher:async()=>{calls++;return envelope(value);}});
    assert.equal(calls,1);assert.equal(result.status,'done');assert.equal(result.duplicate,'skipped');results.set(caseId,result);
  }
  const cid=results.get('mail-cid-evidence-duplicate-signatures'),old=results.get('mail-old-sent-collected-today');
  const originalCid=originalMailValues.find(item=>item.caseId===cid.caseId).value;
  assert.equal(cid.saved.summary.length,0);
  assert.equal(cid.saved.imageSummary[0].verification,'unverified');assert.equal(cid.saved.imageSummary[0].needsConfirmation,true);
  assert.equal(cid.saved.imageSummary[0].evidence,originalCid.summary[0].evidence);
  assert.equal(cid.saved.imageSummary[0].imageId,undefined,'candidate source set is not asserted as independently verified OCR attribution');
  assert.deepEqual(cid.saved.imageSummary[0].candidateImageIds,[originalCid.imageFacts[0].imageId]);
  assert.equal(cid.saved.imageFacts[0].text,originalCid.imageFacts[0].text,'unverified transcription never replaces image facts');
  assert.equal(cid.saved.review.needsConfirmation,true);assert.equal(cid.saved.source.intent,'request');assert.equal(cid.checks.intent,false,'original intent disagreement remains visible');
  assert.equal(cid.saved.tasks[0].status,'pending');assert.equal(cid.saved.issues[0].status,'needs_confirmation');
  assert.equal(old.saved.tasks[0].assignee,'테스트담당자');assert.equal(old.saved.tasks[0].assigneeConfirmed,false);
  assert.equal(old.saved.tasks[0].serviceDate,'2026-10-30');assert.equal(old.saved.tasks[0].dueAt,null);assert.equal(old.parser.reportDay,'2026-10-29');
  const oldValue=originalMailValues.find(item=>item.caseId===old.caseId).value;
  const oldSource=(await parseStressMail(fixtureById(old.caseId))).source;
  const cidSource=(await parseStressMail(fixtureById(cid.caseId))).source;
  const run=async(source,value)=>analyzePrivateMail({messageId:source.id,provider:'openai',model:'gpt-6-luna',key:'SYNTHETIC_REPLAY_ONLY',ownerName:'테스트담당자',now:'2026-11-02T01:00:00Z',loadMail:async()=>source,fetcher:async()=>envelope(value),store:{claim:async()=>({row:{id:source.id,uidl_hash:source.uidl_hash},lease:'isolated-original-replay'}),finish:async()=>true,fail:async()=>true}});
  for(const proof of ['내일 가상별창고 6P 배차 준비 부탁드립니다.','본문에 없는 테스트담당자님 요청']) {
    const value=structuredClone(oldValue);value.tasks[0].selfRequestEvidence=proof;
    assert.equal((await run(oldSource,value)).code,'ANALYSIS_ASSIGNEE');
  }
  const forwarded={...oldSource,text:'참고로 전달합니다.\n\n-----Original Message-----\n'+oldSource.text};
  assert.equal((await run(forwarded,oldValue)).code,'ANALYSIS_ASSIGNEE');
  const separateProof='테스트담당자님, 참고 자료입니다. 가상다른분님, 내일 가상별창고 6P 배차 준비 부탁드립니다.';
  const separateValue=structuredClone(oldValue);separateValue.summary=[];
  separateValue.tasks[0].evidence='내일 가상별창고 6P 배차 준비 부탁드립니다.';separateValue.tasks[0].selfRequestEvidence=separateProof;
  assert.equal((await run({...oldSource,text:separateProof},separateValue)).code,'ANALYSIS_ASSIGNEE','name in a separate non-request sentence is not action ownership');
  const otherRequest=oldSource.text+'\n가상다른분님, 내일 가상별창고 6P 배차 준비 부탁드립니다. 하차 예정은 10:00입니다.';
  const disjoint=structuredClone(oldValue);disjoint.tasks[0].evidence='내일 가상별창고 6P 배차 준비 부탁드립니다. 하차 예정은 10:00입니다.';
  assert.equal((await run({...oldSource,text:otherRequest},disjoint)).code,'ANALYSIS_ASSIGNEE','same words in a disjoint request do not share the named proof');
  const imageTask=structuredClone(originalCid);imageTask.tasks[0].evidence=imageTask.summary[0].evidence;
  assert.equal((await run(cidSource,imageTask)).code,'ANALYSIS_EVIDENCE','quarantining an image summary never validates body tasks with image-only evidence');
  const noImageProof=structuredClone(originalCid);noImageProof.imageFacts=[];noImageProof.imageDecisions=[];
  assert.equal((await run({...cidSource,images:[]},noImageProof)).code,'ANALYSIS_EVIDENCE','no approved readable image means no image-summary fallback');
  const excluded=structuredClone(originalCid);excluded.imageDecisions[0].include=false;
  assert.equal((await run(cidSource,excluded)).code,'ANALYSIS_EVIDENCE','excluded image cannot enable summary metadata recovery');
  console.log('PASS exact original mail parsed replay: cross-sentence named action overlap, original dates, unverified image-summary quarantine; no unrelated/forwarded ownership or body-task/image evidence promotion');
}

{
 const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
 const {parseStressMail}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
 const {analyzePrivateMail}=await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
 const f=fixtureById('mail-old-sent-collected-today'),source=(await parseStressMail(f)).source;
 const proof='내일 가상별창고 6P 배차 준비 부탁드립니다.';
 const value={intent:{kind:'request',evidence:proof},group:null,summary:[],issues:[],tasks:[{text:'가상별창고 6P 배차 준비',evidence:proof,status:'pending',assignee:'테스트담당자',due:null,completionEvidence:null,serviceOriginal:'내일',forOwner:true,recipientScope:'owner_direct',selfRequestEvidence:proof}],waiting:[],updates:[],imageFacts:[],imageDecisions:[],imageItems:{tasks:[],issues:[],waiting:[]}};
 const run=async src=>analyzePrivateMail({messageId:src.id,provider:'openai',model:'gpt-6-luna',key:'mock',ownerName:'테스트담당자',now:f.now,loadMail:async()=>src,fetcher:async()=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]}),store:{claim:async()=>({row:{id:src.id,uidl_hash:src.uidl_hash},lease:'test'}),finish:async()=>true,fail:async()=>true}});
 const result=await run(source);assert.equal(result.status,'done');assert.equal(result.analysis.tasks[0].serviceDate,'2026-10-30');assert.equal(result.analysis.tasks[0].dueAt,null);assert.equal(result.analysis.tasks[0].assigneeConfirmed,false);
 for(const src of [{...source,text:source.text.replace('테스트담당자님, ','')},{...source,text:source.text.replace('테스트담당자님, ','다른담당자님, ')},{...source,ownerContext:{recipientRole:'cc',senderIsOwner:false}},{...source,text:source.text+'\n다른담당자님, '+proof}])assert.equal((await run(src)).code,'ANALYSIS_ASSIGNEE');
 console.log('PASS actual PR93 short addressee proof; exact same-sentence direct owner fallback only, no header-only/other-name/CC/duplicate inference');
}
{
const {renderDailyBriefing,dailyBriefingView}=await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
const {parseStressMail}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
const parsed=(await parseStressMail(fixtureById('mail-image-only-routine-table'))).source;
const img=parsed.images[0];
const base={source:{id:parsed.id,uidl:'a'.repeat(64),subject:'합성 정기 점검표',sender:'가상발신 <sender@example.test>',sentAt:'2026-11-02T00:00:00Z',receivedAt:'2026-11-02T00:01:00Z',intent:'routine',images:[{id:img.id,name:img.name,mediaType:img.mediaType,contentHash:img.contentHash,width:img.width,height:img.height,byteLength:img.bytes.length}]},revision:1,summary:[{text:'정기 점검표 제목이 확인됩니다.',evidence:'SYNTHETIC TEST'}],tasks:[],issues:[],waiting:[],updates:[],imageFacts:[{imageId:img.id,text:'온도 4°C 정기 점검표',confidence:'readable'}],imageDecisions:[{imageId:img.id,kind:'business_document',include:true}]};
const render=analysis=>renderDailyBriefing({now:'2026-11-02T01:00:00Z',analyses:[analysis]}).managedHtml;
const original=structuredClone(base),html=render(base);
assert.ok(!html.includes('제목이 확인됩니다'));assert.ok(html.includes('합성 정기 점검표 자료'));
assert.ok(html.includes('정기보고메일'));assert.ok(!html.includes('정상'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('sajo-mail-photos-'));
assert.deepEqual(base,original);assert.equal(dailyBriefingView({now:'2026-11-02T01:00:00Z',analyses:[base]}).workItems[0].summary[0],'정기 점검표 제목이 확인됩니다.');
const noImage=structuredClone(base);noImage.source.images=[];noImage.imageFacts=[];noImage.imageDecisions=[];
assert.ok(render(noImage).includes('합성 정기 점검표 자료'));
for(const meaningful of ['온도 4°C로 기재된 정기 점검표입니다.','온도 이탈 문구가 확인됩니다.','점검표 제목 누락이 확인됩니다.','보관 온도 4°C, 정기 점검 정상으로 기재되어 있습니다.']) {
 const analysis=structuredClone(base);analysis.summary=[{text:meaningful,evidence:'synthetic'}];assert.ok(render(analysis).includes(meaningful.replace(/[.]$/,'')));
}
const mixed=structuredClone(base);mixed.summary.push({text:'점검 대상은 가상구름센터이며 온도는 4°C입니다.',evidence:'synthetic'});const mixedHtml=render(mixed);assert.ok(mixedHtml.includes('점검 대상은 가상구름센터이며 온도는 4°C입니다'));assert.ok(!mixedHtml.includes('제목이 확인됩니다'));
const sameLine=structuredClone(base);sameLine.summary=[{text:'정기 점검표 제목이 확인됩니다. 온도는 4°C로 기재되어 있습니다.',evidence:'synthetic'}];const sameLineHtml=render(sameLine);assert.ok(!sameLineHtml.includes('제목이 확인됩니다'));assert.ok(sameLineHtml.includes('온도는 4°C로 기재되어 있습니다'));
const reference=structuredClone(noImage);reference.source.intent='reference';reference.source.subject='가상 안내 자료';assert.ok(render(reference).includes('제목이 확인됩니다'),'scope is routine-note presentation only');
console.log('PASS routine note topic: boilerplate replaced by original subject without invented normality, no-image fallback, meaningful/mixed business summaries retained, source/workItems unchanged and no recurring report photos');

}

{
const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');const {normalizeManualItems,manualDailyView,resolveExistingManualWork}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');const {dailyWorkItems,renderBriefingWorkNote,workSummaryForDisplay}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const previews=[];function renderPreview(items){const html=renderBriefingWorkNote(items);previews.push(html);return html;}
const newId='ffffffff-1111-4111-8111-000000009999';
function view(f,value,verified=false){const entries=Object.fromEntries((f.related??[]).map(e=>[e.entryId,structuredClone(e)]));const items=normalizeManualItems(value,{text:f.text,entryId:newId,submittedAt:f.now,referenceDate:f.referenceDate,allowLinks:verified,verifiedDispatchReply:verified,verifiedReplyRef:value.items[0]?.workRef,replyDetails:value.details??[]});for(const i of items)if(value.resolution)i.resolution=value.resolution;entries[newId]={entryId:newId,status:'ready',text:f.text,referenceDate:f.referenceDate,submittedAt:f.now,items};return {items,work:dailyWorkItems({day:f.referenceDate,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(entries,f.referenceDate))};}
let failed=0;for(const[name,test]of[
['latest quantity has no stale standalone quantity in note',()=>{const f=fixtureById('manual-late-correction-targeted'),r=resolveExistingManualWork(f.text,Object.fromEntries(f.related.map(x=>[x.entryId,x])),f.referenceDate,f.now),{work}=view(f,r,true);const target=work.find(x=>x.workId===f.related[0].ref);assert.ok(target.title.includes('10P'));const before=JSON.stringify(target);const note=renderPreview([target]);assert.ok(!note.includes('12P'),note);assert.equal(JSON.stringify(target),before);assert.ok(target.sourceRefs.some(x=>x.evidence.includes('12P')))}],
['date weekday conflict reason shown without confirmed date',()=>{const f=fixtureById('manual-conflicting-date-weekday-incomplete');const {work,items}=view(f,{items:[{kind:'dispatch',text:'가상별창고 배차 준비 부탁드립니다',evidence:f.text,serviceOriginal:'11월 3일(수)',needsConfirmation:true}]});assert.equal(items[0].serviceDate,null);const note=renderPreview(work);assert.match(note,/날짜·요일.*불일치|날짜·요일.*확인/);assert.ok(note.includes('11월 3일(수)'));assert.ok(note.includes('수량·하차 시각 미정'));assert.ok(!note.includes('운행·납품 2026-11-03'));assert.ok(!note.includes('부탁드립니다'))}],
['contextless request explains missing target without false progress',()=>{const f=fixtureById('manual-contextless-deictic-request');const {work}=view(f,{items:[]});const note=renderPreview(work);assert.match(note,/요청 대상.*자료.*확인 필요/);assert.ok(!note.includes('진행 중'));assert.ok(!note.includes('진행중'))}],
['supplement detail facts appear once',()=>{const f=fixtureById('manual-split-supplement-exact'),r=resolveExistingManualWork(f.text,Object.fromEntries(f.related.map(x=>[x.entryId,x])),f.referenceDate,f.now),{work}=view(f,r,true);const target=work.find(x=>x.workId===f.related[0].ref),note=renderPreview([target]);assert.equal((note.match(/12P/g)??[]).length,1);assert.equal((note.match(/가상구름센터/g)??[]).length,1);assert.ok(!note.includes('대상 2026'));assert.ok(note.includes('출발 가상별창고'));assert.ok(note.includes('2026.11.3(화) 09:00 하차'));assert.ok(!workSummaryForDisplay(target).includes('12P'))}],
])try{test();console.log('PASS',name)}catch(e){failed++;console.log('FAIL',name,e.message)}if(failed)process.exitCode=1;


}

{
 const {renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
 const item={workId:'synthetic',title:'내일 가상별창고 6P 배차를 준비합니다. 하차 예정은 09:00입니다.',category:'task',status:'pending',serviceDate:'2026-10-30',summary:[],sourceRefs:[],needsConfirmation:false};
 item.summary=['가상별창고 6P의 내일 배차 준비 요청입니다.'];
 const before=structuredClone(item),html=renderBriefingWorkNote([item]);assert.ok(!html.includes('내일'));assert.ok(html.includes('2026.10.30 가상별창고'));assert.deepEqual(item,before);
 assert.ok(renderBriefingWorkNote([{...item,serviceDate:null}]).includes('내일'),'unconfirmed dates must not be invented');
 const dueTitle='내일 17시까지 11월 3일 배차 회신';assert.ok(renderBriefingWorkNote([{...item,title:dueTitle}]).includes(dueTitle),'relative processing deadline must not become service day');
 console.log('PASS relative service date anchored to confirmed day in note title; raw source and processing deadlines preserved');
}

{
 const {handleMailAutomation}=await import('../supabase/functions/onedrive-auth/private-mail-background.js');
 const {APPROVED_MAIL_TARGET:t}=await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
 const {parseStressMail}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
 const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
 const ctx={db:()=>assert.fail('invalid receipt must fail before storage'),json:Response.json,fail:message=>Error(message)};
 for(const body of [{caseId:'manual-split-supplement-exact',receiptId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{caseId:'mail-old-sent-collected-today',receiptId:'not-uuid'}]) await assert.rejects(()=>handleMailAutomation('private-mail-stress-verify',{confirmation:'isolated-stress',...body},{id:t.owner_id},ctx),/STRESS_RECEIPT_INVALID/);
 const f=fixtureById('mail-old-sent-collected-today'),normal=await parseStressMail(f),bound=await parseStressMail(f,undefined,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 assert.equal(bound.source.id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.equal(normal.source.uidl_hash,bound.source.uidl_hash);assert.equal(normal.source.text,bound.source.text);assert.equal(normal.source.headers,bound.source.headers);
 console.log('PASS virtual receipt binding restricted to one frozen mail; source bytes/headers immutable');
}

{
const {normalizeManualItems,resolveExistingManualWork,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const {dailyWorkItems,renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const day='2026-10-31',at='2026-10-31T01:00:00.000Z',id='aaaa1111-1111-4111-8111-111111111111',next='bbbb2222-2222-4222-8222-222222222222';
const blocks=['11/2 월\n쿠팡창원 4p 배차입니다.\n하차 13:15\n경상남도 창원시 진해구 두동로 33 A동 5층','11/2 월\n쿠팡시흥 6p 배차입니다.\n하차 15:00\n경기도 시흥시 정왕동 2676 4,5F'];
const text=blocks.join('\n'),value={items:blocks.map((evidence,i)=>({kind:'dispatch',text:i?'쿠팡시흥 6P 배차 준비':'쿠팡창원 4P 배차 준비',evidence,serviceOriginal:'11/2',dueOriginal:null,assignee:null,needsConfirmation:false}))};
const source={entryId:id,status:'ready',text,submittedAt:at,referenceDate:day,items:normalizeManualItems(value,{text,submittedAt:at,entryId:id,referenceDate:day})};
assert.deepEqual(source.items[0].details,['하차 13:15','경상남도 창원시 진해구 두동로 33 A동 5층'],'first request retains only its own unloading/address');
assert.deepEqual(source.items[1].details,['하차 15:00','경기도 시흥시 정왕동 2676 4,5F']);
const follow='월요일 쿠팡\n창원 160박스 4p 1.7톤\n시흥 288박스 6p 2.6톤 입니다.';
const before=JSON.stringify(source),reply=resolveExistingManualWork(follow,{[id]:source},day,'2026-10-31T02:00:00Z');assert.ok(reply,'cargo rows must resolve existing requests');assert.equal(reply.items.length,2);assert.deepEqual(reply.items.map(x=>x.workRef),source.items.map(x=>x.ref));
const updates=normalizeManualItems(reply,{text:follow,entryId:next,submittedAt:'2026-10-31T02:00:00Z',referenceDate:day,allowLinks:true,verifiedDispatchReply:true,replyDetailsByItem:reply.items.map(x=>x.details)});
const entries={[id]:source,[next]:{entryId:next,status:'ready',text:follow,submittedAt:'2026-10-31T02:00:00Z',referenceDate:day,items:updates}};
const work=dailyWorkItems({groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(entries,day));assert.equal(work.length,2);assert.deepEqual(work.map(x=>x.workId),source.items.map(x=>x.ref));
for(const [i,w] of work.entries()){assert.equal(w.status,'pending');assert.equal(w.serviceDate,'2026-11-02');assert.equal(w.dueAt,null);assert.equal(w.dueDate,null);assert.ok(w.summary.includes(i?'화물 288박스 · 6P · 화물 중량 2.6톤':'화물 160박스 · 4P · 화물 중량 1.7톤'));assert.ok(w.summary.includes(i?'하차 15:00':'하차 13:15'));assert.ok(w.summary.includes(i?'경기도 시흥시 정왕동 2676 4,5F':'경상남도 창원시 진해구 두동로 33 A동 5층'));assert.equal(w.sourceRefs.length,2)}
assert.equal(JSON.stringify(source),before);assert.ok(!renderBriefingWorkNote(work).includes('차량 톤'));
console.log('PASS two requests and row-scoped cargo supplements preserve IDs, addresses, times, source evidence and unfinished state');
const resolve=t=>resolveExistingManualWork(t,{[id]:source},day,'2026-10-31T02:00:00Z');
assert.equal(resolve('월요일 쿠팡\n시흥 288박스 6p 2.6톤\n창원 160박스 4p 1.7톤').items[0].workRef,source.items[1].ref,'row order never determines target');
assert.equal(resolve('월요일 쿠팡\n창원 160박스 4p 1.7톤').items.length,1,'partial supplement updates only specified destination');
assert.equal(resolve('월요일 쿠팡\n창원 160박스 4p 1.7톤\n창원 160박스 4p 1.7톤').items.length,1,'duplicate repeated row is not a new issue/task');
for(const line of ['창원 160박스 4p 5p 1.7톤','창원 160박스 5p 1.7톤']){const r=resolve('월요일 쿠팡\n'+line);assert.equal(r.items[0].needsConfirmation,true);assert.equal(r.items[0].workRef,undefined);assert.equal(r.items[0].kind,'issue')}
const partial=resolve('월요일 쿠팡\n창원 160박스 4p 1.7톤\n부산 288박스 6p 2.6톤');assert.equal(partial.items[0].workRef,source.items[0].ref);assert.equal(partial.items[1].workRef,undefined);assert.equal(partial.items[1].needsConfirmation,true,'one unmatched row does not corrupt or discard the matched row');
assert.equal(resolve('11/3 수 쿠팡\n창원 160박스 4p 1.7톤'),null,'conflicting weekday cannot become a confirmed service day');
assert.equal(resolve('월요일 쿠팡\n창원 '+ '9'.repeat(320) +'박스 4p 1.7톤'),null,'unrepresentable quantity is never converted into fabricated numeric output');
const duplicateId='cccc3333-3333-4333-8333-333333333333';
for(const date of ['2026-11-02','2026-11-09']){const candidate=structuredClone(source);candidate.entryId=duplicateId;candidate.items=[{...candidate.items[0],ref:duplicateId+':manual:item-001',serviceDate:date,details:['하차 18:00','경상남도 창원시 다른로 1']}];const r=resolveExistingManualWork('월요일 쿠팡\n창원 160박스 4p 1.7톤',{[id]:source,[duplicateId]:candidate},day,'2026-10-31T02:00:00Z');assert.equal(r.items[0].workRef,undefined);assert.equal(r.items[0].needsConfirmation,true,'same weekday/destination/pallet ambiguity does not pick first candidate')}
const complete=structuredClone(source);complete.items[0].done=true;complete.items[0].completedAt='2026-10-31T01:30:00Z';complete.items[0].completionEvents=[{done:true,at:'2026-10-31T01:30:00Z'}];
const completedReply=resolveExistingManualWork('월요일 쿠팡\n창원 160박스 4p 1.7톤',{[id]:complete},day,'2026-10-31T02:00:00Z');assert.equal(completedReply.items[0].workRef,complete.items[0].ref);
const completedItems=normalizeManualItems(completedReply,{text:completedReply.sourceText,entryId:next,submittedAt:'2026-10-31T02:00:00Z',referenceDate:day,allowLinks:true,verifiedDispatchReply:true,replyDetailsByItem:completedReply.items.map(x=>x.details)});
const completedWork=dailyWorkItems({groups:[],tasks:[],issues:[],waiting:[]},manualDailyView({[id]:complete,[next]:{...entries[next],text:completedReply.sourceText,items:completedItems}},day));assert.equal(completedWork.find(x=>x.workId===complete.items[0].ref).status,'complete','cargo update does not reopen owner-completed preparation');
const excluded=resolveExistingManualWork('월요일 쿠팡\n창원 160박스 4p 1.7톤',{[id]:source},day,'2026-10-31T02:00:00Z',{['work:'+source.items[0].ref]:{actor:'owner',excluded:true,updatedAt:at}});assert.equal(excluded.items[0].workRef,undefined,'excluded owner work cannot be silently updated');
const again={...entries[next],entryId:duplicateId,submittedAt:'2026-10-31T03:00:00Z',items:updates.map((item,i)=>({...item,ref:duplicateId+':manual:'+item.itemId,submittedAt:'2026-10-31T03:00:00Z',receivedAt:'2026-10-31T03:00:00Z'}))};const repeated=dailyWorkItems({groups:[],tasks:[],issues:[],waiting:[]},manualDailyView({...entries,[duplicateId]:again},day));assert.equal(repeated.length,2);for(const w of repeated){assert.equal(w.summary.filter(s=>s.startsWith('화물 ')).length,1);assert.equal(w.status,'pending')}
assert.equal(JSON.stringify(source),before);
console.log('PASS cargo followup variations: reordered/partial/duplicate/conflicting rows, same route other date/time ambiguity, owner completion/exclusion and repeated delivery keep task count and source unchanged');

}

{
 const {STRESS_FIXTURES}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
 const {runStressCase}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
 for(const fixture of STRESS_FIXTURES.slice(20,26)){
  let calls=0;
  const result=await runStressCase(fixture.id,{resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'}),resolveJevConfiguration:async()=>null,fetcher:async()=>{
   calls++;const blocks=fixture.text.split(/(?=^11\/2 월$)/m);
   return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({items:blocks.map((evidence,index)=>({kind:'dispatch',text:index?'가상쿠팡별 6P 배차 준비':'가상쿠팡구름 4P 배차 준비',evidence:evidence.trim(),serviceOriginal:'11/2',dueOriginal:null,assignee:null,needsConfirmation:false})),authoredDate:null,inputKind:'business'})}]}]});
  }});
  assert.equal(result.automatedChecksPassed,true,JSON.stringify({caseId:fixture.id,status:result.status,code:result.code,checks:result.checks}));
  assert.equal(result.duplicate,'reused');assert.equal(calls,fixture.id==='manual-two-destination-requests'?1:0);
 }
 console.log('PASS additional six frozen stress cases via real manual handler with recorded/constructed response transport, no production writes or live model claims');
}

{
const {writeDailyBriefing}=await import('../supabase/functions/onedrive-auth/private-mail-notes-writer.js');
const {BRIEFING_TARGET: T}=await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
const runId='11111111-2222-4333-8444-555555555555',title='가상 검증 '+runId,now='2026-11-02T01:00:00Z';
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const pages=[],contents=new Map();let writes=0,reads=0,seq=0,staged=0;
const graph=async(path,access,options={})=>{
 assert.equal(access,'MOCK_NOTES');
 if(path.startsWith('/me/onenote/notebooks/'))return Response.json({id:T.notebookId,userRole:'Owner',isShared:false});
 if(path.startsWith('/me/onenote/sections/')&&!path.includes('/pages'))return Response.json({id:T.sectionId,parentNotebook:{id:T.notebookId}});
 if(path.includes('/sections/')&&path.includes('/pages')){
  if(options.method==='POST'){writes++;const actualTitle=/<title>([^<]+)<\/title>/.exec(options.body)[1];assert.equal(actualTitle,title,'diagnostic writer must never create ordinary daily title');const id='test-note-'+writes;pages.push({id,title:actualTitle,parentSection:{id:T.sectionId}});contents.set(id,options.body.replace(/(<[a-z][a-z0-9]*)(?=[\s>])/g,(_,tag)=>tag+' id="node-'+(++seq)+'"'));return Response.json({id})}
  return Response.json({value:pages});
 }
 if(path.includes('/pages/')&&path.includes('/content')){assert.ok(!options.method,'same synthetic result never patches owner content');reads++;return new Response(contents.get(decodeURIComponent(path.split('/pages/')[1].split('/')[0])),{headers:{ETag:'mock'}})}
 throw Error('UNEXPECTED_GRAPH');
};
const createStore=(state={})=>{const value={...state};return{state:value,claim:async()=>({lease:'local',state:value}),save:async({value:next})=>Object.assign(value,next),release:async()=>{}}};
const perform=store=>writeDailyBriefing({now,analyses:[],store,connected:async()=>({accessToken:'MOCK_NOTES',notesGranted:true}),graph,hash,diagnosticRunId:runId,beforeCreate:async()=>{staged++}});
const store=createStore();const first=await perform(store);assert.equal(first.status,'created');assert.equal(staged,1);assert.equal(writes,1);assert.ok(reads>0);
contents.set(first.pageId,contents.get(first.pageId).replace('<h2','<p>OWNER MEMO MUST SURVIVE</p><h2'));
assert.equal((await perform(store)).status,'skipped');assert.equal(writes,1);assert.ok(contents.get(first.pageId).includes('OWNER MEMO MUST SURVIVE'));
const cold=await perform(createStore({createAttempted:true}));assert.equal(cold.status,'skipped');assert.equal(writes,1,'cold retry re-reads exact dedicated page without duplicate create');
const existingBody=contents.get(first.pageId);contents.set(first.pageId,'<html><body><p>OWNER CONTENT WITHOUT MANAGED BASELINE</p></body></html>');await assert.rejects(()=>perform(createStore({createAttempted:true})),/PAGE_MANAGED_CONFLICT/);contents.set(first.pageId,existingBody);
const visible=pages.splice(0);await assert.rejects(()=>perform(createStore({createAttempted:true})),/PAGE_CREATE_UNCERTAIN/);assert.equal(writes,1);pages.push(...visible);
const pendingImage=createStore({...store.state,imageProgress:{next:0,fingerprint:store.state.fingerprint},pendingWrite:{operation:'images',previousHash:store.state.managedHash,desiredHash:'b'.repeat(64),contentHash:'c'.repeat(64),fingerprint:store.state.fingerprint,imageProgress:null}});
let recoveryPatches=0;
const recoveryGraph=async(path,access,options={})=>{if(options.method==='PATCH'){recoveryPatches++;const commands=JSON.parse(options.body);assert.equal(commands.length,1);assert.equal(commands[0].action,'replace');assert.notEqual(commands[0].target,'body');const content=commands[0].content.replace(/(<[a-z][a-z0-9]*)(?=[\s>])/g,(_,tag)=>tag+' id="node-'+(++seq)+'"');contents.set(first.pageId,'<html><head><title>'+title+'</title></head><body><p>OWNER MEMO MUST SURVIVE</p>'+content+'</body></html>');return new Response(null,{status:204});}return graph(path,access,options);};
const recover=state=>writeDailyBriefing({now,analyses:[],store:state,connected:async()=>({accessToken:'MOCK_NOTES',notesGranted:true}),graph:recoveryGraph,hash,diagnosticRunId:runId,beforeCreate:async()=>{staged++}});
await recover(pendingImage);assert.equal(pendingImage.state.pendingWrite,null);assert.equal(recoveryPatches,1);assert.equal(pages.length,1);assert(contents.get(first.pageId).includes('OWNER MEMO MUST SURVIVE'));
const unsafe=createStore({...pendingImage.state,imageProgress:{next:1,fingerprint:pendingImage.state.fingerprint},pendingWrite:{operation:'images',previousHash:pendingImage.state.managedHash,desiredHash:'b'.repeat(64),contentHash:'c'.repeat(64),fingerprint:pendingImage.state.fingerprint,imageProgress:null}});
await assert.rejects(()=>recover(unsafe),/PAGE_WRITE_UNCERTAIN/);assert.equal(recoveryPatches,1,'nonzero acknowledged image progress cannot use the initial-write recovery');

for(const variant of ['fingerprint-mismatch','missing-acknowledged-progress','page-changed']){
 const imageIntent={operation:'images',previousHash:pendingImage.state.managedHash,desiredHash:'b'.repeat(64),contentHash:'c'.repeat(64),fingerprint:pendingImage.state.fingerprint,imageProgress:null};
 const checkpoint=createStore({...pendingImage.state,imageProgress:variant==='missing-acknowledged-progress'?null:{next:0,fingerprint:variant==='fingerprint-mismatch'?'d'.repeat(64):imageIntent.fingerprint},pendingWrite:imageIntent});
 const oldBody=contents.get(first.pageId);if(variant==='page-changed')contents.set(first.pageId,oldBody.replace('최종 업데이트','OWNER CHANGED MANAGED CONTENT'));
 const before=JSON.stringify(checkpoint.state);await assert.rejects(()=>recover(checkpoint),/PAGE_WRITE_UNCERTAIN/);assert.equal(recoveryPatches,1,variant+' must not write');assert.equal(JSON.stringify(checkpoint.state),before,variant+' must retain uncertain checkpoint');contents.set(first.pageId,oldBody);
}

contents.set(first.pageId,contents.get(first.pageId).replace('최종 업데이트','USER EDITED CONTENT'));
await assert.rejects(()=>perform(createStore({createAttempted:true})),/PAGE_MANAGED_CONFLICT/);assert.equal(writes,1);
await assert.rejects(()=>writeDailyBriefing({now,analyses:[],store:createStore(),connected:async()=>assert.fail('bad ID must fail before connection'),graph,hash,diagnosticRunId:'261030 일일정리'}),/PAGE_IDENTITY/);
console.log('PASS actual writer dedicated title/create/readback/repeat/cold retry/lost response fence/manual memo/conflict protection with simulated Graph');

}

{
const {issueStressNoteProof,writeStressNote}=await import('../supabase/functions/onedrive-auth/private-mail-stress-notes.js');
const {handleMailAutomation}=await import('../supabase/functions/onedrive-auth/private-mail-background.js');
const {parseStressMail}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
const {BRIEFING_TARGET: T,normalizeMailAnalysis}=await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
const CASE='mail-old-sent-collected-today',id='11111111-2222-4333-8444-555555555555',owner='2a828c2d-9a6f-40d4-8e13-336b591811cc';
const f=fixtureById(CASE),parsed=await parseStressMail(f,undefined,id);
const evidence='내일 가상별창고 6P 배차 준비 부탁드립니다.';
const saved=normalizeMailAnalysis({summary:[{text:'가상별창고 6P 배차 준비 요청',evidence}],issues:[],tasks:[{text:'가상별창고 6P 배차 준비',evidence,status:'pending',assignee:null,due:null}]},parsed.source);saved.tasks[0].serviceDate='2026-10-30';
const proofs=new Map(),markers=new Map(),pages=[],contents=new Map();let writes=0,graphReads=0,locks=0,seq=0,failure=null;
const ctx={sealDiagnostic:async value=>{const key='sealed.token'+proofs.size;proofs.set(key,structuredClone(value));return key},openDiagnostic:async key=>{if(!proofs.has(key))throw Error('BAD_SEAL');return structuredClone(proofs.get(key))},
 db:async(path,options={})=>{if(path.startsWith('onedrive_locks?')){const name=decodeURIComponent(path.split('name=eq.')[1].split('&')[0]);if(options.method==='DELETE'){markers.delete(name);return{}}return markers.has(name)?[markers.get(name)]:[];}assert.equal(path,'onedrive_locks');assert.equal(options.method,'POST');assert.ok(!markers.has(options.body.name));markers.set(options.body.name,structuredClone(options.body));return{}},
 diagnosticNotes:async action=>{locks++;return action({accessToken:'MOCK_NOTES',notesGranted:true})},
 graph:async(path,access,options={})=>{assert.equal(access,'MOCK_NOTES');if(!options.method)graphReads++;
  if(path.startsWith('/me/onenote/notebooks/'))return Response.json({id:T.notebookId,userRole:'Owner',isShared:false});
  if(path.startsWith('/me/onenote/sections/')&&!path.includes('/pages'))return Response.json({id:T.sectionId,parentNotebook:{id:T.notebookId}});
  if(path.includes('/sections/')&&path.includes('/pages')){
   if(options.method==='POST'){if(failure==='rejected'){failure=null;throw Object.assign(Error('REJECTED'),{providerStatus:403})}assert.ok(options.body.includes('<title>가상 검증 '+id+'</title>'));writes++;const page={id:'test-note-'+writes,title:'가상 검증 '+id,parentSection:{id:T.sectionId},links:{oneNoteWebUrl:{href:'https://onedrive.live.com/?test-note='+writes}}};pages.push(page);contents.set(page.id,options.body.replace(/(<[a-z][a-z0-9]*)(?=[\s>])/g,(_,tag)=>tag+' id="node-'+(++seq)+'"'));if(failure==='lost-create'){failure=null;throw Error('LOST_ACK')}return Response.json({id:page.id})}
   return Response.json({value:pages});
  }
  if(path.includes('/pages/')&&path.includes('/content')){assert.ok(!options.method,'diagnostic never patches owner edits');return new Response(contents.get(decodeURIComponent(path.split('/pages/')[1].split('/')[0])),{headers:{ETag:'mock'}})}
  if(path.startsWith('/me/onenote/pages/'))return Response.json(pages.find(page=>page.id===decodeURIComponent(path.split('/pages/')[1].split('?')[0])));
  throw Error('UNEXPECTED_GRAPH');
 },json:Response.json,fail:code=>Error(code)};
const protectedGraph=ctx.graph;ctx.graph=()=>assert.fail('diagnostic writer must use the lock-checked Graph callback');ctx.diagnosticNotes=async action=>{locks++;return action({accessToken:'MOCK_NOTES',notesGranted:true},protectedGraph)};
const proof=await issueStressNoteProof({caseId:CASE,automatedChecksPassed:true,saved},id,ctx);assert.ok(proof);
const body={proof,stored:JSON.parse(JSON.stringify(saved))};
for(const bad of [{...body,proof:'broken.token'},{...body,stored:{...saved,summary:[]}}])await assert.rejects(()=>writeStressNote(bad,ctx),/STRESS_NOTE_PROOF|STRESS_NOTE_SQL_MISMATCH/);assert.equal(locks,0);
const expired=await ctx.sealDiagnostic({...proofs.get(proof),expiresAt:Date.now()-1});await assert.rejects(()=>writeStressNote({...body,proof:expired},ctx),/STRESS_NOTE_PROOF/);assert.equal(locks,0);
await assert.rejects(()=>handleMailAutomation('private-mail-stress-verify',{confirmation:'isolated-stress',operation:'notes',...body},{id:'other-owner'},ctx),/OWNER_REQUIRED/);assert.equal(locks,0);
const result=await writeStressNote(body,ctx);assert.equal(result.status,'passed');assert.equal(result.firstStatus,'created');assert.equal(result.repeatStatus,'skipped');assert.equal(result.readBackVerified,true);assert.equal(result.productionBusinessWritten,false);assert.equal(result.modelCalled,false);assert.equal(writes,1);assert.equal(markers.size,1);assert.ok(graphReads>0);
// Graph can acknowledge creation and return the HTML title while its metadata title remains blank.
const visibleTitle=pages[0].title;pages[0].title='';
const graphBeforeBlank=protectedGraph;
ctx.diagnosticNotes=async action=>action({accessToken:'MOCK_NOTES',notesGranted:true},async(path,...args)=>{
 const response=await graphBeforeBlank(path,...args);
 if(path.includes('/sections/')&&path.includes('/pages')&&path.includes('?')){
  const data=await response.json();if(new URL('https://graph.microsoft.com'+path).searchParams.has('$filter'))data.value=data.value.filter(page=>page.title===visibleTitle);return Response.json(data);
 }return response;
});
const recoveredBlank=await writeStressNote(body,ctx);assert.equal(recoveredBlank.status,'passed');assert.equal(writes,1,'blank indexed title must recover exact HTML title without another create');
const originalHtml=contents.get(result.pageId);contents.set(result.pageId,originalHtml.replace(/(<title[^>]*>)[^<]*(<\/title>)/,'$1OTHER PAGE$2'));
await assert.rejects(()=>writeStressNote(body,ctx),/PAGE_CREATE_UNCERTAIN|PAGE_REFERENCE_CONFLICT/);assert.equal(writes,1,'unrelated blank page must never be adopted or cause another create');
contents.set(result.pageId,originalHtml);pages[0].title=visibleTitle;ctx.diagnosticNotes=async action=>{locks++;return action({accessToken:'MOCK_NOTES',notesGranted:true},protectedGraph)};
contents.set(result.pageId,contents.get(result.pageId).replace('data-id="sajo-mail-manual">','data-id="sajo-mail-manual"><p>OWNER MEMO</p>'));
const repeat=await writeStressNote(body,ctx);assert.equal(repeat.firstStatus,'skipped');assert.equal(repeat.diagnosticStateWritten,false);assert.equal(writes,1);assert.ok(contents.get(result.pageId).includes('OWNER MEMO'));
contents.set(result.pageId,contents.get(result.pageId).replace('가상별창고 6P 배차 준비','OWNER CHANGED TASK'));await assert.rejects(()=>writeStressNote(body,ctx),/PAGE_MANAGED_CONFLICT/);assert.equal(writes,1);
// Separate simulations keep the same signed receipt but reset only local fake state.
markers.clear();pages.length=0;contents.clear();failure='lost-create';await assert.rejects(()=>writeStressNote(body,ctx),/PAGE_CREATE_UNCERTAIN/);const afterLost=writes;assert.equal((await writeStressNote(body,ctx)).status,'passed');assert.equal(writes,afterLost,'accepted-but-lost response must not duplicate a page');
markers.clear();pages.length=0;contents.clear();failure='rejected';await assert.rejects(()=>writeStressNote(body,ctx),/PAGE_CREATE_UNCERTAIN/);assert.equal(markers.size,0,'confirmed rejected create can retry the same proof');assert.equal((await writeStressNote(body,ctx)).status,'passed');
markers.clear();pages.length=0;contents.clear();
ctx.diagnosticNotes=async action=>action({accessToken:'MOCK_NOTES',notesGranted:true},async(path,...args)=>{
 const response=await protectedGraph(path,...args);
 if(args[1]?.method==='POST'&&path.includes('/sections/'))pages.at(-1).title='';
 if(path.includes('/sections/')&&path.includes('/pages')&&path.includes('?')){
  const data=await response.json();if(new URL('https://graph.microsoft.com'+path).searchParams.has('$filter'))data.value=data.value.filter(page=>page.title===visibleTitle);return Response.json(data);
 }return response;
});
const beforeBlankCreate=writes;const createdBlank=await writeStressNote(body,ctx);assert.equal(createdBlank.status,'passed');assert.equal(createdBlank.firstStatus,'created');assert.equal(writes,beforeBlankCreate+1);assert.equal(createdBlank.repeatStatus,'skipped');
assert.equal((await writeStressNote(body,ctx)).status,'passed');assert.equal(writes,beforeBlankCreate+1);
const duplicate={...pages[0],id:'duplicate-blank-page'};pages.push(duplicate);contents.set(duplicate.id,contents.get(pages[0].id));
await assert.rejects(()=>writeStressNote(body,ctx),/PAGE_AMBIGUOUS/);assert.equal(writes,beforeBlankCreate+1,'two exact blank-title HTML pages require review, never another create');pages.pop();contents.delete(duplicate.id);
const {readDiagnosticPage}=await import('../supabase/functions/onedrive-auth/private-mail-notes-writer.js');
await assert.rejects(()=>readDiagnosticPage({graph:async()=>Response.json({...pages[0],parentSection:{id:'other-section'}}),access:'MOCK_NOTES',pageId:pages[0].id,title:visibleTitle}),/PAGE_REFERENCE_CONFLICT/);

assert.equal(await issueStressNoteProof({caseId:CASE,automatedChecksPassed:false,saved},id,ctx),null);
console.log('PASS owner proof binding, exact SQL result, actual writer/Graph readback, durable attempt fence, cold retry, lost ACK, definite rejection retry, owner memo/conflict; simulated external Graph only');

}

// Fixed-synthetic followup variants; pure parser/normalizer/ledger checks, no provider or operational writes.
{
const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
const {resolveDispatchAssignment,resolveExistingManualWork,normalizeManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const {dailyWorkItems,renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const day='2026-11-02',at=day+'T01:00:00.000Z',fixture=fixtureById('manual-two-destination-cargo-supplement'),seed=structuredClone(fixture.related[0]);
const a=seed.items[0].ref,b=seed.items[1].ref,idA='a1111111-1111-4111-8111-111111111111',idB='b2222222-2222-4222-8222-222222222222';
function save(reply,id,time){return {entryId:id,status:'ready',text:reply.sourceText,submittedAt:time,referenceDate:day,items:normalizeManualItems(reply,{text:reply.sourceText,entryId:id,submittedAt:time,referenceDate:day,allowLinks:true,verifiedDispatchReply:true,replyDetails:reply.details??[],replyDetailsByItem:reply.items.map(item=>item.details??reply.details??[])})};}
const view=entries=>dailyWorkItems({groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(entries,day));
const failures=[];function test(name,run){try{run();console.log('PASS',name);}catch(error){failures.push({name,error:error.message});console.log('FAIL',name,error.message);}}
const original=JSON.stringify(seed);
test('partial completion with pending row first',()=>{
 const text='11월 2일 가상쿠팡별 6P는 아직 차량 배정 대기입니다.\n11월 2일 가상쿠팡구름 4P 차량 배정 완료했습니다.';
 const reply=resolveExistingManualWork(text,{[seed.entryId]:seed},day,at);assert.ok(reply);
 const work=view({[seed.entryId]:seed,[idA]:save(reply,idA,at)});assert.equal(work.length,2);assert.equal(work.find(w=>w.workId===a).status,'complete');assert.equal(work.find(w=>w.workId===b).status,'pending');
});
const oldText='11월2일\n가상공장(09:00상)-가상쿠팡구름\n가상12가0001 가상갑 01000000001';
const oldReply=resolveDispatchAssignment(oldText,{[seed.entryId]:seed},day,at);assert.equal(oldReply.items[0].workRef,a);const old=save(oldReply,idA,at);
test('vehicle replacement latest summary has only new vehicle',()=>{
 const text='차량 교체\n11월2일\n가상공장(09:00상)-가상쿠팡구름\n가상34나0002 가상을 01000000002';
 const entries={[seed.entryId]:seed,[idA]:old};const reply=resolveDispatchAssignment(text,entries,day,day+'T02:00:00.000Z');assert.ok(reply,'explicit full assignment replacement must remain deterministic');
 const work=view({...entries,[idB]:save(reply,idB,day+'T02:00:00.000Z')});const target=work.find(w=>w.workId===a);assert.ok(target.summary.some(t=>t.includes('가상34나0002')));assert.ok(!target.summary.some(t=>t.includes('가상12가0001')));assert.equal(target.status,'complete');assert.equal(target.sourceRefs.length,3);
});
test('unlabelled exact new assignment still replaces old vehicle',()=>{
 const text='11월2일\n가상공장(09:00상)-가상쿠팡구름\n가상34나0002 가상을 01000000002',entries={[seed.entryId]:seed,[idA]:old};
 const reply=resolveDispatchAssignment(text,entries,day,day+'T02:00:00.000Z');assert.ok(reply);const work=view({...entries,[idB]:save(reply,idB,day+'T02:00:00.000Z')});
 const target=work.find(w=>w.workId===a);assert.ok(target.summary.some(t=>t.includes('가상34나0002')));assert.ok(!target.summary.some(t=>t.includes('가상12가0001')));
});
test('P omitted from actual-style model title remains human visible',()=>{
 const items=normalizeManualItems({items:seed.items.map(item=>({kind:'dispatch',text:item.text.replace(/\s*\d+P/,''),evidence:item.evidence,serviceOriginal:'11/2',dueOriginal:null,assignee:null,needsConfirmation:false}))},{text:seed.text,entryId:seed.entryId,submittedAt:seed.submittedAt,referenceDate:seed.referenceDate});
 const work=view({[seed.entryId]:{...seed,items}});for(const [index,p] of ['4P','6P'].entries())assert.ok(JSON.stringify([work[index].title,work[index].summary]).includes(p),'human output missing '+p);
});

test('partial completion row order and two independently completed rows',()=>{
 for(const text of ['11월 2일 가상쿠팡구름 4P 차량 배정 완료했습니다.\n11월 2일 가상쿠팡별 6P는 아직 차량 배정 대기입니다.', '11월 2일 가상쿠팡구름 4P 차량 배정 완료했습니다.\n11월 2일 가상쿠팡별 6P 차량 배정 완료했습니다.']){
  const reply=resolveExistingManualWork(text,{[seed.entryId]:seed},day,at);assert.ok(reply);const work=view({[seed.entryId]:seed,[idA]:save(reply,idA,at)});assert.equal(work.length,2);assert.equal(work.find(w=>w.workId===a).status,'complete');assert.equal(work.find(w=>w.workId===b).status,text.includes('대기')?'pending':'complete');
 }
 assert.equal(resolveExistingManualWork('11월 2일 가상쿠팡구름 4P 차량 배정 완료했습니다.\n11월 2일 가상쿠팡별 6P 취소해주세요.',{[seed.entryId]:seed},day,at),null,'unsupported sibling mutation must go through full extraction');
});
test('cancelled original stays cancelled and explicit re-request creates a new ref',()=>{
 const prior=structuredClone(seed);prior.items[0].workflowStatus='cancelled';prior.items[0].declaredAt=day+'T00:00:00.000Z';prior.items[0].ownerStateDeclared=true;
 const before=JSON.stringify(prior),text='취소했던 11월 2일 가상쿠팡구름 4P 건과 별개로 새 요청을 접수합니다. 같은 조건으로 다시 배차 준비 부탁드립니다. 기존 취소 이력은 그대로 남겨주세요.';
 const reply=resolveExistingManualWork(text,{[prior.entryId]:prior},day,at);assert.ok(reply);assert.equal(reply.items[0].workRef,undefined);
 const work=view({[prior.entryId]:prior,[idA]:save(reply,idA,at)});assert.equal(work.find(w=>w.workId===a).status,'cancelled');assert.equal(work.find(w=>w.workId===idA+':manual:item-001').status,'pending');assert.equal(JSON.stringify(prior),before);
});
test('new replacement advances earlier reopen while preserving sources and receipt-order details',()=>{
 const entries={[seed.entryId]:seed,[idA]:old},newText='차량 교체\n11월2일\n가상공장(09:00상)-가상쿠팡구름\n가상34나0002 가상을 01000000002';
 const reply=resolveDispatchAssignment(newText,entries,day,day+'T02:00:00.000Z');const replacement=save(reply,idB,day+'T02:00:00.000Z');
 const reopened=structuredClone(seed);reopened.items[0].completionEvents=[{done:true,at:day+'T00:20:00.000Z'},{done:false,at:day+'T00:30:00.000Z'}];reopened.items[0].ownerUpdatedAt=day+'T00:30:00.000Z';
 const before=JSON.stringify([reopened,old,replacement]),work=view({[idB]:replacement,[idA]:old,[reopened.entryId]:reopened});const target=work.find(w=>w.workId===a);
 assert.equal(target.status,'complete');assert.ok(target.summary.some(t=>t.includes('가상34나0002')));assert.ok(!target.summary.some(t=>t.includes('가상12가0001')));
 assert.ok(target.sourceRefs.some(r=>r.id===idA&&r.evidence===oldText));assert.ok(target.sourceRefs.some(r=>r.id===idB&&r.evidence===newText));assert.equal(target.serviceDate,'2026-11-02');assert.equal(target.dueAt,null);
 const note=renderBriefingWorkNote(work);assert.ok(note.includes('가상34나0002'));assert.ok(!note.includes('가상12가0001'));assert.equal(JSON.stringify([reopened,old,replacement]),before);
 const excluded={['work:'+a]:{actor:'owner',excluded:true,updatedAt:at}};
 assert.equal(resolveDispatchAssignment(newText,entries,day,at,excluded).items[0].workRef,null,'excluded request cannot be silently assigned');
 assert.equal(resolveDispatchAssignment('이전 회신입니다. 현재 교체 차량은 변경 없습니다.\n'+oldText,entries,day,at),null,'historical reply annotation never becomes a current deterministic assignment');
});
test('P-less model titles retain row-specific pallets through next cargo supplement',()=>{
 const items=normalizeManualItems({items:seed.items.map(item=>({kind:'dispatch',text:item.text.replace(/\s*\d+P/,''),evidence:item.evidence,serviceOriginal:'11/2',dueOriginal:null,assignee:null,needsConfirmation:false}))},{text:seed.text,entryId:seed.entryId,submittedAt:seed.submittedAt,referenceDate:seed.referenceDate});
 const originalEntry={...seed,items},entries={[seed.entryId]:originalEntry};const note=renderBriefingWorkNote(view(entries));assert.ok(note.includes('4P'));assert.ok(note.includes('6P'));assert.ok(!note.includes('차량 톤급'));
 const f=fixtureById('manual-two-destination-cargo-supplement'),reply=resolveExistingManualWork(f.text,entries,day,at);assert.equal(reply.items[0].workRef,a);assert.equal(reply.items[1].workRef,b);
 const current=view({...entries,[idA]:save(reply,idA,at)});assert.equal(current.length,2);assert.ok(current.every(item=>item.status==='pending'));assert.ok(current.find(item=>item.workId===a).summary.some(t=>t.includes('160박스')));assert.ok(current.find(item=>item.workId===b).summary.some(t=>t.includes('288박스')));
});
test('ambiguous cargo includes conflicting quantities and candidate unloading facts without choosing',()=>{
 for(const id of ['manual-cargo-conflicting-pallets','manual-cargo-same-destination-other-time']){
  const f=fixtureById(id),entries=Object.fromEntries(f.related.map(e=>[e.entryId,structuredClone(e)])),before=JSON.stringify(entries),reply=resolveExistingManualWork(f.text,entries,f.referenceDate,f.now);
  assert.equal(reply.items[0].workRef,undefined);assert.equal(reply.items[0].needsConfirmation,true);
  const details=reply.items[0].details.join(' ');assert.ok(details.includes('가상쿠팡구름'));
  if(id.includes('conflicting')){assert.ok(details.includes('4P'));assert.ok(details.includes('5P'));}else{assert.ok(details.includes('13:15'));assert.ok(details.includes('18:00'));}
  const work=dailyWorkItems({groups:[],tasks:[],issues:[],waiting:[]},manualDailyView({...entries,[idA]:save(reply,idA,f.now)},f.referenceDate));const note=renderBriefingWorkNote(work);
  if(id.includes('conflicting'))assert.ok(note.includes('4P / 5P'));else{assert.ok(note.includes('13:15'));assert.ok(note.includes('18:00'));}assert.equal(JSON.stringify(entries),before);
 }
});
assert.equal(JSON.stringify(seed),original);console.log(JSON.stringify({failures},null,2));assert.deepEqual(failures,[]);

}
{
 const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
 const {normalizeManualItems}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
 const seed=fixtureById('manual-two-destination-cargo-supplement').related[0],entryId='a1111111-1111-4111-8111-111111111111';
 const value={items:[{kind:'dispatch',text:'가상쿠팡구름 배차 준비',evidence:seed.items[0].evidence,serviceOriginal:'11/2',dueOriginal:null,assignee:null,needsConfirmation:false}]};
 const items=normalizeManualItems(value,{text:seed.text,entryId,submittedAt:'2026-11-02T01:00:00Z',referenceDate:'2026-11-02',allowLinks:true,verifiedDispatchReply:true,replyDetails:['상차 08:00','하차 13:15','출발 가상공장','도착 가상쿠팡구름','화물 별도 확인','취급 주의']});
 assert.equal(items[0].details.length,6);assert.ok(items[0].details.includes('물량 4P'));
 console.log('PASS exact-evidence P fallback survives bounded six-detail output');
}

{
const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
const {parseStressMail}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
const {analyzePrivateMail}=await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
const {dailyBriefingView,renderDailyBriefing}=await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
const f=fixtureById('mail-image-only-routine-table'),source=(await parseStressMail(f)).source,imageId=source.images[0].id;
const fact='SERVICE 2026-11-03 | PALLETS 12 | UNLOAD 09:00 | TEMP 4 C | ROUTINE CHECK: NORMAL';
// Constructed model claim against the existing public synthetic raster; this is an ownership-boundary test, not an OCR correctness claim.
const value={intent:{kind:'request',evidence:fact},group:null,summary:[],issues:[],tasks:[],waiting:[],updates:[],imageFacts:[{imageId,text:fact,confidence:'readable'}],imageDecisions:[{imageId,kind:'business_document',include:true}],imageItems:{issues:[],waiting:[],tasks:[{imageId,text:'사진만으로 개인 배차 요청을 확정',evidence:fact,confidence:'readable',status:'pending',forOwner:true,recipientScope:'owner_direct',selfRequestEvidence:fact}]}};
let saves=0,calls=0;
const run=()=>analyzePrivateMail({messageId:source.id,provider:'openai',model:'gpt-6-luna',key:'SYNTHETIC_ONLY',ownerName:'테스트담당자',now:f.now,loadMail:async()=>source,fetcher:async()=>{calls++;return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]});},store:{claim:async()=>({row:source,lease:'isolated-image-ownership'}),finish:async()=>{saves++;return true;},fail:async()=>true}});
const result=await run();assert.equal(result.status,'done');assert.equal(result.analysis.source.intent,'unknown');assert.equal(result.analysis.tasks.length,0);assert.equal(result.analysis.imageItems.tasks.length,0);assert.equal(result.analysis.review.withheldTasks,1);assert.equal(result.analysis.imageFacts[0].text,fact);
const view=dailyBriefingView({now:f.now,analyses:[result.analysis]});assert.ok(view.workItems.every(w=>w.category!=='task'&&w.status!=='complete'));
value.intent.kind='routine';value.imageItems.tasks=[];const routine=await run();assert.equal(routine.status,'done');assert.equal(routine.analysis.source.intent,'routine');assert.equal(routine.analysis.tasks.length,0);const note=renderDailyBriefing({now:f.now,analyses:[routine.analysis]}).managedHtml;assert.ok(note.includes('정기보고메일'));assert.ok(!note.includes('sajo-mail-photos-'));assert.ok(!note.includes('<img'));
value.intent.kind='request';value.tasks=[{text:'사진 주장만으로 배차 준비',evidence:fact,status:'pending',assignee:null,due:null,serviceOriginal:null,completionEvidence:null,forOwner:true,recipientScope:'owner_direct',selfRequestEvidence:fact}];const invalid=await run();assert.equal(invalid.status,'failed');assert.equal(invalid.code,'ANALYSIS_EVIDENCE');assert.equal(saves,2);assert.equal(calls,3);
console.log('PASS image-only boundary: model request claims remain review without personal task/completion, image facts retained, routine compact without photos, image-only body-task evidence rejected; mocked transport only');

}

{
 const {runStressCase}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
 const result=await runStressCase('manual-late-correction-targeted',{resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'}),resolveJevConfiguration:async()=>null,fetcher:()=>assert.fail('unambiguous existing-work correction does not need a new model request')});
 assert.equal(result.saved.items[0].needsConfirmation,false,'verified old-to-new quantity correction is not an unresolved multiple-quantity request');
 assert.ok(result.saved.items[0].text.includes('10P'));assert.equal(result.automatedChecksPassed,true);
 console.log('PASS explicit resolved quantity correction remains exact while fresh ambiguous quantities require review');
}

{
 const {STRESS_FIXTURES}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
 const {runStressCase}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
 for(const fixture of STRESS_FIXTURES.filter(fixture=>['manual-two-destination-partial-completion','manual-exact-vehicle-replacement','manual-late-reply-is-historical-reference','manual-cargo-weight-only-preserves-known-fields'].includes(fixture.id))){
  const original=JSON.stringify(fixture.related);let calls=0;
  const result=await runStressCase(fixture.id,{resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'}),resolveJevConfiguration:async()=>null,fetcher:async()=>{
   calls++;assert.equal(fixture.id,'manual-late-reply-is-historical-reference');
   return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({items:[{kind:'reference',text:'교체 전 차량 회신 참고',evidence:fixture.text,serviceOriginal:null,dueOriginal:null,assignee:null,needsConfirmation:false}],authoredDate:null,inputKind:'business'})}]}]});
  }});
  assert.equal(result.automatedChecksPassed,true,JSON.stringify({caseId:fixture.id,status:result.status,code:result.code,checks:result.checks}));
  assert.equal(result.duplicate,'reused');assert.equal(calls,fixture.id==='manual-late-reply-is-historical-reference'?1:0);assert.equal(JSON.stringify(fixture.related),original);
 }
 console.log('PASS fixed state-change diagnostics: partial completion, vehicle replacement and explicit historical reply preserve target IDs/latest facts; constructed transport only');
}

{
 const {normalizeManualItems}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
 const text='11/2 월\n가상센터 4p 배차입니다.\n하차 13:15\n경기도 가상시 검증로 33';
 assert.throws(()=>normalizeManualItems({items:[text,text.replaceAll('\n','  ')].map(evidence=>({kind:'dispatch',text:'배차 준비',evidence,serviceOriginal:'11/2',needsConfirmation:false}))},{text,entryId:'11111111-2222-4333-8444-555555555555',submittedAt:'2026-11-01T01:00:00Z',referenceDate:'2026-11-01'}),/MANUAL_EVIDENCE/,'rewritten evidence is rejected rather than assigned as another original request');
 console.log('PASS rewritten source quote remains rejected without fabricated quantity/address ownership');
}

{
const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
const {resolveExistingManualWork,normalizeManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const {dailyWorkItems,renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const fixture=fixtureById('manual-two-destination-cargo-supplement'),seed=structuredClone(fixture.related[0]),day=fixture.referenceDate,entries={[seed.entryId]:seed},sourceBefore=JSON.stringify(seed);
let index=0;
function add(text){index++;const entryId='99999999-1111-4111-8111-'+String(index).padStart(12,'0'),submittedAt=day+'T0'+index+':00:00.000Z';const reply=resolveExistingManualWork(text,entries,day,submittedAt);assert.ok(reply);const items=normalizeManualItems(reply,{text,entryId,submittedAt,referenceDate:day,allowLinks:true,verifiedDispatchReply:true,replyDetails:reply.details??[],replyDetailsByItem:reply.items.map(item=>item.details??reply.details??[])});for(const item of items)item.resolution=reply.resolution;entries[entryId]={entryId,status:'ready',text,submittedAt,referenceDate:day,items};return reply;}
function work(){return dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(entries,day));}
const target=()=>work().find(item=>item.workId===seed.items[0].ref),other=()=>work().find(item=>item.workId===seed.items[1].ref);
add(fixture.text);const originalOther=JSON.stringify(other());assert.ok(target().summary.some(line=>line.includes('160박스')&&line.includes('1.7톤')));
assert.equal((renderBriefingWorkNote(work()).match(/4P/g)??[]).length,1,'visible title quantity is not repeated in compound cargo detail');
add('월요일 가상쿠팡\n구름 1.8톤');
assert.ok(target().summary.some(line=>line.includes('160박스')&&line.includes('4P')&&line.includes('1.8톤')),'weight-only supplement must preserve known boxes/pallets');
assert.ok(!target().summary.some(line=>line.includes('1.7톤')));assert.equal(JSON.stringify(other()),originalOther);
add('월요일 가상쿠팡\n구름 168박스');assert.ok(target().summary.some(line=>line.includes('168박스')&&line.includes('4P')&&line.includes('1.8톤')));
add('늦은 정정입니다. 11월 2일 가상쿠팡구름 4P 요청 건의 수량은 5P가 맞습니다. 날짜나 마감을 바꾸는 정정이 아닙니다.');assert.ok(target().title.includes('5P'));assert.ok(target().summary.some(line=>line.includes('168박스')&&line.includes('5P')&&line.includes('1.8톤')),'pallet-only correction must not discard known boxes/weight');
add('월요일 가상쿠팡\n구름 1800kg');assert.ok(target().summary.some(line=>line.includes('168박스')&&line.includes('5P')&&line.includes('1800kg')));assert.ok(!target().summary.some(line=>line.includes('1.8톤')));
const before=target().summary;add('월요일 가상쿠팡\n구름 1800kg');assert.deepEqual(target().summary,before);assert.equal(work().length,2);assert.equal(target().status,'pending');assert.equal(target().serviceDate,'2026-11-02');assert.equal(target().dueAt,null);assert.ok(target().summary.includes('하차 13:15'));assert.ok(target().summary.includes('경상남도 가상시 테스트로 33 A동 5층'));assert.equal(JSON.stringify(seed),sourceBefore);assert.equal(JSON.stringify(other()),originalOther);assert.ok(renderBriefingWorkNote(work()).includes('1800kg'));
console.log('PASS field-wise cargo supplements preserve unspecified quantities/weight, replace only supplied facts, retain IDs/routes/state/source and deduplicate repeats');

const projected=work(),snapshot=JSON.stringify(projected);renderBriefingWorkNote(projected);assert.equal(JSON.stringify(projected),snapshot,'presentation must not erase stored pallet facts');
}

{
 const {resolveDispatchAssignment,normalizeManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
 const {dailyWorkItems}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
 const id='11111111-2222-4333-8444-555555555555',day='2026-11-01',text='11/2 월\n쿠팡시흥 6P 배차입니다.\n하차 15:00\n경기도 가상시 테스트로 33';
 const items=normalizeManualItems({items:[{kind:'dispatch',text:'쿠팡시흥 6P 배차',evidence:text,serviceOriginal:'11/2',dueOriginal:null,assignee:null,needsConfirmation:false}]},{text,entryId:id,submittedAt:day+'T01:00:00Z',referenceDate:day});
 const entries={[id]:{entryId:id,status:'ready',text,submittedAt:day+'T01:00:00Z',referenceDate:day,items}};
 for(const separator of ['~','～','→','-']){
 const replyText='11/02 (월)\n가상공장(09:00상)'+separator+'시흥쿠팡\n강원80바1234 가상인 010-1234-5678';
 const reply=resolveDispatchAssignment(replyText,entries,day);assert.ok(reply,'parenthesized weekday and route separator must enter existing assignment resolver');assert.equal(reply.items[0].workRef,items[0].ref);assert.equal(reply.items[0].workflowStatus,'complete');
 const nextId='aaaaaaaa-1111-4111-8111-222222222222',next=normalizeManualItems(reply,{text:replyText,entryId:nextId,submittedAt:day+'T02:00:00Z',referenceDate:day,allowLinks:true,verifiedDispatchReply:true,replyDetails:reply.details});
 const all={...entries,[nextId]:{entryId:nextId,status:'ready',text:replyText,submittedAt:day+'T02:00:00Z',referenceDate:day,items:next}};
 const work=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(all,day));assert.equal(work.length,1);assert.equal(work[0].status,'complete');assert.ok(work[0].title.includes('6P'));assert.equal(work[0].serviceDate,'2026-11-02');
 }
}

{
 const {applyOwnerWorkCorrection,renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
 const item={workId:'test-owner-notes',title:'배차 준비',category:'task',status:'pending',summary:[],sourceRefs:[]};
 const notes=[{id:'first',text:'차량 정보 전달 완료\n메일 원문 전체는 상세에서 보존',at:'2026-11-01T01:00:00Z'},{id:'future',text:'다음날 추가 기록',at:'2026-11-02T01:00:00Z'}];
 const overrides={'work:test-owner-notes':{actor:'owner',done:true,updatedAt:'2026-11-01T01:00:00Z',processingNotes:notes}};
 const result=applyOwnerWorkCorrection(item,overrides,'2026-11-01');assert.equal(result.status,'complete');assert.equal(result.correction.processingNotes.length,2,'detail preserves full history even on older viewed day');assert.equal(result.correction.reportNotes.length,1);const html=renderBriefingWorkNote([result]);assert.ok(html.includes('차량 정보 전달 완료'));assert.ok(!html.includes('메일 원문 전체'));assert.ok(!html.includes('다음날 추가'));assert.deepEqual(overrides['work:test-owner-notes'].processingNotes,notes);
}

{
const {normalizeManualItems,resolveDispatchAssignment,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');const {dailyWorkItems}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const day='2026-11-01',id='11111111-2222-4333-8444-555555555555',followId='aaaaaaaa-1111-4111-8111-222222222222',text='11/2 월\n쿠팡시흥 6P 배차입니다.\n하차 15:00\n경기도 가상시 테스트로 33',submittedAt=day+'T00:00:00Z';
const seed={entryId:id,status:'ready',text,submittedAt,referenceDate:day,items:normalizeManualItems({items:[{kind:'dispatch',text:'쿠팡시흥 6P 배차',evidence:text,serviceOriginal:'11/2',dueOriginal:null,assignee:null,needsConfirmation:false}]},{text,entryId:id,submittedAt,referenceDate:day})};
const ref=seed.items[0].ref,replyText='11/02 (월)\n가상공장(09:00상)~시흥쿠팡\n강원80바1234 가상인 010-1234-5678';
for(const [label,receivedAt,ownerAt] of [['old-message-late-reanalysis','2026-11-01T12:18:00Z','2026-11-01T12:19:08Z'],['new-confirmation-after-reopen','2026-11-01T12:21:05Z','2026-11-01T12:19:08Z'],['same-message-retry','2026-11-01T12:21:05Z','2026-11-01T12:19:08Z']]){
 const overrides={['work:'+ref]:{actor:'owner',done:false,doneAt:ownerAt,updatedAt:ownerAt}},entries={[id]:structuredClone(seed)},before=JSON.stringify(entries);
 const reply=resolveDispatchAssignment(replyText,entries,day,receivedAt,overrides);assert.equal(reply.items[0].workRef,ref);assert.equal(reply.items[0].workflowStatus,'complete');
 const items=normalizeManualItems(reply,{text:replyText,entryId:followId,submittedAt:receivedAt,referenceDate:day,allowLinks:true,verifiedDispatchReply:true,replyDetails:reply.details});for(const item of items)item.resolution='dispatch_assignment_v1';
 const all={...entries,[followId]:{entryId:followId,status:'ready',text:replyText,submittedAt:receivedAt,referenceDate:day,items}},manual=manualDailyView(all,day,overrides),work=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manual,{workOverrides:overrides});
 assert.equal(work.length,1);assert.equal(work[0].status,label==='old-message-late-reanalysis'?'pending':'complete');assert.equal(JSON.stringify(entries),before);
 if(label==='new-confirmation-after-reopen'){
  for(const at of [receivedAt,'2026-11-01T12:22:00Z']){
   const later={['work:'+ref]:{actor:'owner',done:false,doneAt:at,updatedAt:at}};
   const projected=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(all,day,later),{workOverrides:later});assert.equal(projected[0].status,'pending','equal-time or later explicit reopen wins');
  }
  const nextDay='2026-11-02',next=dailyWorkItems({day:nextDay,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(all,nextDay,overrides),{workOverrides:overrides});assert.ok(!next.some(row=>row.workId===ref&&row.status==='pending'),'confirmed completion does not return as next-day pending');
  const {applyOwnerWorkCorrection}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
  for(const invalid of [null,'not-a-time'])assert.equal(applyOwnerWorkCorrection({...work[0],uncorrected:null,verifiedCompletionAt:invalid},overrides,day).status,'pending','missing or invalid immutable completion time does not defeat owner state');
  assert.equal(applyOwnerWorkCorrection({...work[0],uncorrected:null,needsConfirmation:true},overrides,day).status,'pending','uncertain matching cannot override owner reopen');
 }
 console.log(JSON.stringify({label,receivedAt,ownerAt,linked:true,parsedStatus:items[0].workflowStatus,inferredAt:manual.entries.find(e=>e.entryId===followId)?.items?.[0]?.inferredStateAt??null,actual:work[0].status,expected:label==='old-message-late-reanalysis'?'pending':'complete',sourceUnchanged:true}));
}

}

{
 const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');const {resolveExistingManualWork,normalizeManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');const {dailyWorkItems}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
 const f=fixtureById('manual-two-destination-cargo-supplement'),seed=structuredClone(f.related[0]),day=f.referenceDate,first=seed.items[0].ref,second=seed.items[1].ref;
 for(const status of ['both_pending','second_complete','first_reopened']){
  const overrides=status==='both_pending'?{}:status==='second_complete'?{['work:'+second]:{actor:'owner',done:true,doneAt:day+'T00:30:00Z',updatedAt:day+'T00:30:00Z'}}:{['work:'+first]:{actor:'owner',done:false,doneAt:day+'T00:30:00Z',updatedAt:day+'T00:30:00Z'}};
  const entries={[seed.entryId]:structuredClone(seed)},reply=resolveExistingManualWork(f.text,entries,day,f.now,overrides);assert.equal(reply.items.length,2);assert.ok(reply.items.every(item=>item.workflowStatus==='pending'));
  const id='aaaaaaaa-2222-4222-8222-333333333333',items=normalizeManualItems(reply,{text:f.text,entryId:id,submittedAt:f.now,referenceDate:day,allowLinks:true,verifiedDispatchReply:true,replyDetailsByItem:reply.items.map(item=>item.details)});for(const item of items)item.resolution=reply.resolution;
  entries[id]={entryId:id,status:'ready',text:f.text,submittedAt:f.now,referenceDate:day,items};const snapshot=JSON.stringify(entries);
  const project=()=>dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(entries,day,overrides),{workOverrides:overrides});const work=project();assert.equal(work.length,2);assert.equal(work.find(item=>item.workId===first).status,'pending');assert.equal(work.find(item=>item.workId===second).status,status==='second_complete'?'complete':'pending');assert.deepEqual(project(),work);assert.equal(JSON.stringify(entries),snapshot);
  assert.ok(work.find(item=>item.workId===first).summary.some(text=>text.includes('160박스')));assert.ok(work.find(item=>item.workId===second).summary.some(text=>text.includes('288박스')));
 }
}

{
 const {analyzeTargetedManual}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
 const target={workId:'11111111-2222-4333-8444-555555555555:manual:item-001',title:'쿠팡시흥 6P 배차',kind:'dispatch',serviceDate:'2026-11-02'},entry={text:'시흥 288박스 6p 2.6톤 입니다.',submittedAt:'2026-11-01T12:00:00Z',referenceDate:'2026-11-01'};
 const ai={aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'};
 const run=async(overrides={},text=entry.text,kind=target.kind)=>analyzeTargetedManual({entry:{...entry,text},target:{...target,kind},ai,fetcher:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');assert.ok(options.body.includes(target.workId));return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:'update',text:target.title,evidence:text,details:[text],completionEvidence:null,serviceOriginal:null,dueOriginal:null,...overrides})}]}]});}});
 const reference=await run({},'참고 자료 메모입니다.','reference');assert.equal(reference.reply.items[0].kind,'reference','reference update does not silently create a task');
 const saved=await run();assert.equal(saved.reply.items[0].workRef,target.workId);assert.equal(saved.reply.items[0].workflowStatus,'pending');assert.deepEqual(saved.reply.items[0].details,[entry.text]);
 const badComplete=await run({action:'complete'});assert.equal(badComplete.reply.items[0].workRef,undefined);assert.equal(badComplete.reply.items[0].needsConfirmation,true);
 const mixed=await run({},'월요일 쿠팡\n창원 160박스 4p 1.7톤\n시흥 288박스 6p 2.6톤 입니다.');assert.equal(mixed.reply.items[0].workRef,undefined,'mixed quantities cannot be forced onto selected task even if model claims a match');
 const conflict=await run({matchesTarget:false,action:'conflict'});assert.equal(conflict.reply.items[0].workRef,undefined);
 const complete=await run({action:'complete',completionEvidence:'차량 배정 완료했습니다.'},'차량 배정 완료했습니다.');assert.equal(complete.reply.items[0].workRef,target.workId);assert.equal(complete.reply.items[0].workflowStatus,'complete');
 const historical=await run({action:'complete',completionEvidence:'강원80바1234 가상인 010-1234-5678'},'이전 회신입니다. 현재 차량은 변경 없습니다. 강원80바1234 가상인 010-1234-5678');assert.equal(historical.reply.items[0].workRef,undefined);
 const wrongDay=await run({serviceOriginal:'11월 3일'},'11월 3일 시흥 배차입니다.');assert.equal(wrongDay.reply.items[0].workRef,undefined);
}

{
 const {handleManualMessage}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
 const {manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');const {dailyWorkItems}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
 const f=fixtureById('manual-two-destination-cargo-supplement'),seed=structuredClone(f.related[0]),target=seed.items[0].ref,owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',box='39045005-313e-42e1-b50c-2394b3b6ff26';
 for(const scenario of ['cargo','conflict','vehicle']){
  const text=scenario==='cargo'?f.text.split('\n').slice(0,2).join('\n'):scenario==='conflict'?f.text:'가상12가3456 가상인 010-1234-5678',id='bbbbbbbb-2222-4222-8222-333333333333',entry={entryId:id,clientRequestId:id,status:'pending',text,submittedAt:f.now,referenceDate:f.referenceDate,targetWorkId:target,items:[]},current={id:box,owner_id:owner,enabled:true,manual_entries:{[seed.entryId]:seed,[id]:entry},briefing_overrides:{}};
  const before=JSON.stringify(seed);let paid=0;
  const response=await handleManualMessage('private-mail-manual-add',{text,clientRequestId:id},{id:owner},{json:Response.json,fail:code=>Error(code),resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'}),enqueueManualReport:async()=>false,
   db:async(path,options={})=>{if(path.startsWith('private_mailboxes?'))return[current];if(path==='rpc/private_mail_manual_claim')return{claimed:true,entry};if(path==='rpc/private_mail_manual_finish'){current.manual_entries[id]={...entry,status:'ready',items:options.body.p_items};return current.manual_entries[id];}throw Error('UNEXPECTED_DB '+path);},
   fetcher:async(url,options)=>{paid++;assert.equal(url,'https://api.openai.com/v1/responses');assert.ok(options.body.includes(target));return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:scenario!=='conflict',action:scenario==='vehicle'?'complete':scenario==='conflict'?'conflict':'update',text:seed.items[0].text,evidence:text,details:[text],completionEvidence:scenario==='vehicle'?text:null,serviceOriginal:null,dueOriginal:null})}]}]});}});
  const saved=await response.json();assert.equal(saved.status,'ready');assert.equal(paid,1,'targeted handler must actually invoke configured model transport');assert.equal(JSON.stringify(seed),before);assert.ok(saved.items.every(item=>!item.workRef||item.workRef===target));
  const work=dailyWorkItems({day:f.referenceDate,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(current.manual_entries,f.referenceDate));assert.equal(work.find(item=>item.workId===seed.items[1].ref).status,'pending');assert.equal(work.find(item=>item.workId===target).status,scenario==='vehicle'?'complete':'pending');
 }
}

{
 const {applyOwnerWorkCorrection}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
 const item={workId:'selected',title:'검토',category:'task',status:'pending',ownerStateAt:'2026-11-01T12:21:00Z',summary:[],sourceRefs:[]};
 const earlier={'work:selected':{actor:'owner',done:true,doneAt:'2026-11-01T12:19:00Z',updatedAt:'2026-11-01T12:19:00Z'}};assert.equal(applyOwnerWorkCorrection(item,earlier,'2026-11-01').status,'pending','new explicit source reopen supersedes older checkbox completion');
 const later={'work:selected':{actor:'owner',done:true,doneAt:'2026-11-01T12:22:00Z',updatedAt:'2026-11-01T12:22:00Z'}};assert.equal(applyOwnerWorkCorrection(item,later,'2026-11-01').status,'complete','subsequent explicit checkbox still wins');
}

{
 const {monthlyWorkOccurrences}=await import('../supabase/functions/onedrive-auth/private-mail-monthly.js');
 const owner='2a828c2d-9a6f-40d4-8e13-336b591811cc';
 const definitions=[[1,'on','previous_full_month'],[1,'on',null],[7,'on','previous_second_half'],[8,'before',null],[10,'on',null],[23,'on','current_first_half']];
 const templates=definitions.map(([date,qualifier,targetPeriod],i)=>({id:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,family_id:`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,version:1,status:'approved',title:'합성 월별 업무 '+(i+1),spec:{effective_from:'2026-11-01',repeat:{kind:'monthly',day:date},personal_monthly:{ownerId:owner,leadDays:3,qualifier,targetPeriod,advanceKind:targetPeriod==='current_first_half'?'yangsan_first':targetPeriod==='previous_second_half'?'yangsan_second':targetPeriod==='previous_full_month'?'nonghyup':null,paymentRule:targetPeriod==='current_first_half'?'month_end':targetPeriod==='previous_second_half'?'day15':targetPeriod==='previous_full_month'?'day10':null,originalSchedule:targetPeriod==='previous_full_month'?'월초 품의':date+'일'+(qualifier==='before'?' 이전':''),source:{kind:'onenote',pageId:'isolated-monthly-source'}}}}));
 assert.equal(monthlyWorkOccurrences(templates,{now:'2026-10-28T14:59:59Z',ownerId:owner}).length,0);
 const first=monthlyWorkOccurrences(templates,{now:'2026-10-28T15:00:00Z',ownerId:owner});assert.equal(first.length,2);assert(first.every(i=>i.scheduledDate==='2026-11-01'&&i.visibleFrom==='2026-10-29'));
 assert.equal(monthlyWorkOccurrences(templates,{now:'2026-11-04T03:00:00Z',ownerId:owner}).length,3);
 const before=monthlyWorkOccurrences(templates,{now:'2026-11-05T03:00:00Z',ownerId:owner}).find(i=>i.qualifier==='before');assert.equal(before.scheduledDate,'2026-11-08');assert.equal(before.originalSchedule,'8일 이전');assert.equal(before.dueAt,null);
 const six=monthlyWorkOccurrences(templates,{now:'2026-11-20T03:00:00Z',ownerId:owner});assert.equal(six.length,6);assert.deepEqual(six.find(i=>i.scheduledDate==='2026-11-07').targetPeriod,{from:'2026-10-16',through:'2026-10-31'});assert.deepEqual(six.find(i=>i.scheduledDate==='2026-11-23').targetPeriod,{from:'2026-11-01',through:'2026-11-15'});
 assert.equal(monthlyWorkOccurrences(templates,{now:'2026-11-20T03:00:00Z',ownerId:owner,existing:six.map(i=>({occurrenceKey:i.occurrenceKey,status:'completed'}))}).length,0,'completed and pending existing month instances are never regenerated');
 const year=monthlyWorkOccurrences(templates.map(t=>({...t,spec:{...t.spec,effective_from:'2027-01-01'}})),{now:'2026-12-28T15:00:00Z',ownerId:owner});assert.equal(year.length,2);assert(year.every(i=>i.scheduledMonth==='2027-01'&&i.visibleFrom==='2026-12-29'));assert.deepEqual(year.find(item=>item.advanceKind==='nonghyup').targetPeriod,{from:'2026-12-01',through:'2026-12-31'});assert.equal(year.find(item=>item.advanceKind==='nonghyup').paymentDate,'2027-01-10');
 const leap=monthlyWorkOccurrences([templates[2]].map(t=>({...t,spec:{...t.spec,effective_from:'2028-03-01'}})),{now:'2028-03-04T03:00:00Z',ownerId:owner});assert.deepEqual(leap[0].targetPeriod,{from:'2028-02-16',through:'2028-02-29'});
 assert.throws(()=>monthlyWorkOccurrences(templates,{now:'2026-11-20T03:00:00Z',ownerId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}),/OWNER/);
 const next=monthlyWorkOccurrences(templates,{now:'2026-11-28T03:00:00Z',ownerId:owner,existing:six});assert.equal(next.length,2);assert(next.every(i=>i.scheduledMonth==='2026-12'&&!six.some(old=>old.occurrenceKey===i.occurrenceKey)));
 assert.equal(six.find(item=>item.scheduledDate==='2026-11-23').paymentDate,'2026-11-30');assert.equal(six.find(item=>item.scheduledDate==='2026-11-07').paymentDate,'2026-11-15');assert.equal(first.find(item=>item.advanceKind==='nonghyup').paymentDate,'2026-11-10');assert.deepEqual(first.find(item=>item.advanceKind==='nonghyup').targetPeriod,{from:'2026-10-01',through:'2026-10-31'});assert.equal(first.find(item=>item.advanceKind==null).paymentDate,null,'unspecified payment dates remain unknown');
 assert.equal(leap[0].paymentDate,'2028-03-15');const leapFull=monthlyWorkOccurrences([templates[0]].map(t=>({...t,spec:{...t.spec,effective_from:'2028-03-01'}})),{now:'2028-02-27T03:00:00Z',ownerId:owner})[0];assert.deepEqual(leapFull.targetPeriod,{from:'2028-02-01',through:'2028-02-29'});assert.equal(leapFull.paymentDate,'2028-03-10');
 const october=monthlyWorkOccurrences(templates.map(t=>({...t,spec:{...t.spec,effective_from:'2026-10-01'}})),{now:'2026-10-20T03:00:00Z',ownerId:owner}).find(item=>item.scheduledDate==='2026-10-23');assert.deepEqual(october.targetPeriod,{from:'2026-10-01',through:'2026-10-15'});assert.equal(october.visibleFrom,'2026-10-20');assert.equal(october.paymentDate,'2026-10-31');
 const yearSecond=monthlyWorkOccurrences([templates[2]].map(t=>({...t,spec:{...t.spec,effective_from:'2027-01-01'}})),{now:'2027-01-04T03:00:00Z',ownerId:owner})[0];assert.deepEqual(yearSecond.targetPeriod,{from:'2026-12-16',through:'2026-12-31'});assert.equal(yearSecond.paymentDate,'2027-01-15');
 console.log('PASS isolated monthly contract: six templates, KST lead/month/year/leap boundaries, strict-before qualifier, separate target periods and completed-instance deduplication');
}

{
 const {loadMonthlyPortalTasks}=await import('../supabase/functions/onedrive-auth/private-mail-monthly.js');
 const owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',id='30000000-0000-4000-8000-000000000001',otherId='30000000-0000-4000-8000-000000000002';
 const live={id,owner_id:owner,inputs:{personal_monthly:{ownerId:owner},personal_work:{workId:'source:'+id}},status:'completed'},historical={...live,status:'pending'};
 const queries=[];const db=async(path,options)=>{queries.push({path,options});return path.startsWith('rpc/')?[historical,{...historical,id:otherId}]:[live]};
 assert.deepEqual(await loadMonthlyPortalTasks({db,ownerId:owner,day:'2026-11-01'}),[historical],'historical display uses event snapshot, not latest completion');assert.equal(queries[1].options.body.p_user,owner);assert.equal(queries[1].options.body.p_day,'2026-11-01');
 assert.deepEqual(await loadMonthlyPortalTasks({db:async()=>[],ownerId:owner}),[]);
 await assert.rejects(()=>loadMonthlyPortalTasks({db:async()=>[{...live,owner_id:otherId}],ownerId:owner}),/MONTHLY_SOURCE/);
 await assert.rejects(()=>loadMonthlyPortalTasks({db,ownerId:otherId}),/MONTHLY_OWNER/);
 console.log('PASS owner monthly loading: owner-only canonical IDs, historical snapshots and empty/untrusted source handling');
}

{
 const {handleMailAutomation}=await import('../supabase/functions/onedrive-auth/private-mail-background.js');
 const {APPROVED_MAIL_TARGET:target}=await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
 const id='30000000-0000-4000-8000-000000000003',owner=target.owner_id;
 const row={id,owner_id:owner,title:'합성 월별 마감',version:1,center_code:null,work_scope:'delivery_team',work_date:'2026-10-29',updated_at:'2026-10-29T00:00:00Z',status:'pending',inputs:{personal_monthly:{ownerId:owner,scheduledMonth:'2026-11',scheduledDate:'2026-11-01',visibleFrom:'2026-10-29',qualifier:'on',originalSchedule:'1일',targetPeriod:null},personal_work:{schema:'sajo-daily-work-v1',workId:'source:'+id,ownerId:owner,scope:{kind:'delivery_team',centerCode:null,workCategory:null},category:'task',status:'pending',summary:[],sourceKeys:['source:'+id]}}};
 const queries=[],ctx={json:Response.json,fail:message=>Error(message),db:async(path)=>{queries.push(path);if(path.startsWith('private_mailboxes?'))return[{id:target.mailbox_id,owner_id:owner,automation_config:{}}];if(path.startsWith('private_mail_messages?'))return[];if(path.startsWith('operations_tasks?')||path==='rpc/private_mail_portal_snapshots')return[row];throw Error('Unexpected monthly overview query: '+path)}};
 const overview=await(await handleMailAutomation('private-mail-daily-overview',{day:'2026-11-01'},{id:owner},ctx)).json();
 assert.equal(overview.workItems.length,1,'actual overview handler must include native monthly work without a mail/manual duplicate');assert.equal(overview.workItems[0].portalTaskId,id);assert.equal(overview.workItems[0].monthly.scheduledDate,'2026-11-01');assert(!queries.some(path=>/generate|claim|finish/.test(path)),'reading the overview must not issue or change any work');
 const {hasBriefingCarryWork}=await import('../supabase/functions/onedrive-auth/private-mail-background.js');assert.equal(hasBriefingCarryWork({day:'2026-11-02',analyses:[],portalTasks:[row],portalOwnerId:owner}),true,'monthly-only work must remain a next-day note carry candidate');
 const {writeDailyBriefing}=await import('../supabase/functions/onedrive-auth/private-mail-notes-writer.js');let rendered='';const result=await writeDailyBriefing({now:'2026-11-01T12:00:00+09:00',analyses:[],portalTasks:[row],portalOwnerId:owner,hash:async text=>{rendered=text;return 'a'.repeat(64)},store:{claim:async()=>null}});assert.equal(result.status,'busy');assert(rendered.includes('합성 월별 마감'));assert(rendered.includes('2026-11-01'));
 const {handleManualMessage}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');const receipt='40000000-0000-4000-8000-000000000004',text='품의 발송 완료했습니다.',entry={entryId:receipt,clientRequestId:receipt,status:'pending',text,submittedAt:'2026-11-01T02:00:00Z',referenceDate:'2026-11-01',targetWorkId:'source:'+id,items:[]},box={id:target.mailbox_id,owner_id:owner,enabled:true,manual_entries:{[receipt]:entry},briefing_overrides:{}};let modelCalls=0,storedMonthlyItems=[];
 const monthlyResponse=await handleManualMessage('private-mail-manual-add',{text,clientRequestId:receipt},{id:owner},{json:Response.json,fail:message=>Error(message),loadMonthlyTasks:async()=>[row],resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'}),db:async(path,options={})=>{if(path.startsWith('private_mailboxes?'))return[box];if(path==='rpc/private_mail_manual_claim')return{claimed:true,entry};if(path==='rpc/private_mail_manual_finish'){storedMonthlyItems=options.body.p_items;return{...entry,status:'ready',items:storedMonthlyItems}};if(path==='rpc/private_mail_manual_fail')return{...entry,status:'failed',error:options.body.p_code};throw Error('UNEXPECTED_MONTHLY_TARGET_DB '+path)},fetcher:async(url,options)=>{modelCalls++;assert.equal(url,'https://api.openai.com/v1/responses');assert(options.body.includes('source:'+id));assert(options.body.includes('scheduledDate'));return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:'complete',text:'품의 발송 완료',evidence:text,details:[],completionEvidence:text,serviceOriginal:null,dueOriginal:null})}]}]})}});
 const monthlySaved=await monthlyResponse.json();assert.equal(monthlySaved.status,'ready',JSON.stringify(monthlySaved));assert.equal(modelCalls,1);assert.equal(monthlySaved.items[0].workRef,'source:'+id);assert.equal(storedMonthlyItems[0].resolution,'targeted_update_v1');assert.equal(monthlySaved.items[0].status,'complete');
 const {analyzeTargetedManual}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');const vehicleOnly='12가3456 가상인 010-1234-5678';const wrongCompletion=await analyzeTargetedManual({entry:{...entry,text:vehicleOnly},target:{workId:'source:'+id,title:row.title,kind:'task',monthly:overview.workItems[0].monthly},ai:{aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'},fetcher:async()=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:'complete',text:row.title,evidence:vehicleOnly,details:[],completionEvidence:vehicleOnly,serviceOriginal:null,dueOriginal:null})}]}]})});assert.equal(wrongCompletion.reply.items[0].needsConfirmation,true,'vehicle assignment is not proof that a monthly approval duty is complete');assert.equal(wrongCompletion.reply.items[0].workRef,undefined);
 const {linkMonthlyManualItems}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
 const extra='11월 3일 가상별창고 4P 배차 준비 부탁드립니다. 하차 13:15',clause='합성 월별 마감 완료했습니다.',combinedText=clause+'\n'+extra,normalValue={items:[{kind:'reference',text:'합성 월별 마감 완료',evidence:clause,assignee:null,serviceOriginal:null,dueOriginal:null,needsConfirmation:false},{kind:'dispatch',text:'가상별창고 4P 배차 준비',evidence:extra,assignee:null,serviceOriginal:'11월 3일',dueOriginal:null,needsConfirmation:false}],authoredDate:null,inputKind:'business'};let routingCalls=0;
 const linked=await linkMonthlyManualItems({value:normalValue,entry:{...entry,text:combinedText},work:overview.workItems,ai:{aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'},fetcher:async(url,options)=>{routingCalls++;assert.equal(url,'https://api.openai.com/v1/responses');const value=routingCalls===1?{matches:[{itemIndex:0,workId:'source:'+id,needsConfirmation:false}]}:{matchesTarget:true,action:'complete',text:'합성 월별 마감 완료',evidence:clause,details:[],completionEvidence:clause,serviceOriginal:null,dueOriginal:null};return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]})}});
 assert.equal(routingCalls,2);assert.equal(linked.reply.items.length,2);assert.equal(linked.reply.items[0].workRef,'source:'+id);assert.equal(linked.reply.items[0].workflowStatus,'complete');assert.equal(linked.reply.items[1].kind,'dispatch');assert.equal(linked.reply.items[1].workRef,undefined);assert(linked.reply.items[1].details.some(text=>text.includes('13:15')),'routing a monthly clause must preserve independent dispatch details');
 let ambiguousCalls=0;const olderWork={...overview.workItems[0],workId:'source:50000000-0000-4000-8000-000000000005',monthly:{...overview.workItems[0].monthly,scheduledDate:'2026-10-01',visibleFrom:'2026-09-28'}};
 const ambiguousRoute=await linkMonthlyManualItems({value:{items:[normalValue.items[0]],authoredDate:null,inputKind:'business'},entry:{...entry,text:clause},work:[...overview.workItems,olderWork],ai:{aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'},fetcher:async()=>{ambiguousCalls++;return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matches:[{itemIndex:0,workId:'source:'+id,needsConfirmation:false}]})}]}]})}});assert.equal(ambiguousCalls,1);assert.equal(ambiguousRoute.reply.items[0].needsConfirmation,true);assert.equal(ambiguousRoute.reply.items[0].workRef,undefined,'two unfinished months without an explicit month must not be forced onto a candidate');
 const failedRoute=await linkMonthlyManualItems({value:normalValue,entry:{...entry,text:combinedText},work:overview.workItems,ai:{aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'},fetcher:async()=>{throw Error('synthetic timeout')}});assert.equal(failedRoute.reply.items[0].needsConfirmation,true);assert.equal(failedRoute.reply.items[0].workRef,undefined);assert.equal(failedRoute.reply.items[1].kind,'dispatch');
 let globalCalls=0,globalItems=[],globalInference;const globalEntry={...entry,text:combinedText,targetWorkId:null},globalBox={...box,manual_entries:{[receipt]:globalEntry}};
 const globalResponse=await handleManualMessage('private-mail-manual-add',{text:combinedText,clientRequestId:receipt},{id:owner},{json:Response.json,fail:message=>Error(message),loadMonthlyTasks:async()=>[row],resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'}),db:async(path,options={})=>{if(path.startsWith('private_mailboxes?'))return[globalBox];if(path==='rpc/private_mail_manual_claim')return{claimed:true,entry:globalEntry};if(path==='rpc/private_mail_manual_finish'){globalItems=options.body.p_items;globalInference=options.body.p_inference;return{...globalEntry,status:'ready',items:globalItems}}if(path==='rpc/private_mail_manual_fail')return{...globalEntry,status:'failed',error:options.body.p_code};throw Error('UNEXPECTED_GLOBAL_MONTHLY_DB '+path)},fetcher:async(url)=>{globalCalls++;assert.equal(url,'https://api.openai.com/v1/responses');const value=globalCalls===1?normalValue:globalCalls===2?{matches:[{itemIndex:0,workId:'source:'+id,needsConfirmation:false}]}:{matchesTarget:true,action:'complete',text:'합성 월별 마감 완료',evidence:clause,details:[],completionEvidence:clause,serviceOriginal:null,dueOriginal:null};return Response.json({model:'gpt-6-luna',status:'completed',usage:{input_tokens:11,output_tokens:5,total_tokens:16},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]})}});
 const globalSaved=await globalResponse.json();assert.equal(globalSaved.status,'ready',JSON.stringify(globalSaved));assert.equal(globalCalls,3);assert.equal(globalItems.length,2);assert.equal(globalItems[0].workRef,'source:'+id);assert.equal(globalItems[0].workflowStatus,'complete');assert.equal(globalItems[1].workRef,undefined);assert.equal(globalItems[1].workflowStatus,'pending');assert.equal(globalInference.usage.total_tokens,48,'record all successful extraction/matching/target-verification calls');
 const {manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js'),{dailyBriefingView}=await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
 const finalView=dailyBriefingView({now:'2026-11-01T12:00:00+09:00',analyses:[],manual:manualDailyView({[receipt]:{...globalEntry,status:'ready',items:globalItems}},'2026-11-01'),portalTasks:[{...row,status:'completed',completed_at:globalEntry.submittedAt}],portalOwnerId:owner});const canonical=finalView.workItems.find(work=>work.portalTaskId===id);assert(canonical);assert(canonical.sourceRefs.every(source=>source.kind!=='mail'),'native monthly root must not become a fake mail source');assert.equal(finalView.workItems.length,2);
 const monthlyOverrides={['work:source:'+id]:{actor:'owner',excluded:true,reason:'manual',updatedAt:'2026-11-01T03:00:00Z',processingNotes:[{id:receipt,text:'합성 처리 기록',at:'2026-11-01T03:00:00Z'}]}};
 const correctedMonthly=dailyBriefingView({now:'2026-11-01T12:00:00+09:00',analyses:[],portalTasks:[row],portalOwnerId:owner,overrides:monthlyOverrides});assert.equal(correctedMonthly.workItems.length,0);assert.equal(correctedMonthly.excludedWorkItems.length,1);assert.equal(correctedMonthly.excludedWorkItems[0].correction.processingNotes[0].text,'합성 처리 기록');
 const {createMailHistoryDocument,restoreMailHistoryDocument}=await import('../supabase/functions/onedrive-auth/private-mail-history.js');const portalHistory=await createMailHistoryDocument({kind:'portal',sourceId:id,revision:1,eventAt:'2026-11-01T03:00:00Z',model:null,rulesVersion:'owner-work-correction-v1',structuredResult:{workId:'source:'+id}});assert(portalHistory.fileName.includes('analysis-history_portal_'+id));assert.equal((await restoreMailHistoryDocument(portalHistory.record,portalHistory.payload)).historyId,portalHistory.historyId);
 console.log('PASS monthly native task through actual daily-overview handler, no source duplicate or read-side mutation');
}

// Monthly mail uses the existing grounded updates contract, separate from RFC-only mail links.
{
 const {analyzePrivateMail}=await import('../supabase/functions/onedrive-auth/private-mail-analysis.js');
 const owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',taskId='61000000-0000-4000-8000-000000000001',id='62000000-0000-4000-8000-000000000002';
 const proof='2026년 10월분 가상 선지급 품의 상신 완료했습니다.',extra='가상 안전교육 자료는 참고용입니다.',body=proof+'\n'+extra;
 const monthly={ownerId:owner,ref:'source:'+taskId,kind:'tasks',text:'가상 선지급 품의',evidence:'가상 선지급 품의',status:'pending',monthly:{advanceKind:'nonghyup',scheduledDate:'2026-11-01',visibleFrom:'2026-10-29',qualifier:'on',originalSchedule:'월초 품의',targetPeriod:{from:'2026-10-01',through:'2026-10-31'},paymentDate:'2026-11-10'}};
 const normal={intent:{kind:'update',evidence:proof},group:null,summary:[{text:'10월분 품의 상신 완료',evidence:proof},{text:'가상 안전교육 자료 공유',evidence:extra}],tasks:[],issues:[],waiting:[],updates:[{ref:monthly.ref,status:'complete',text:'10월분 품의 상신 완료',evidence:proof,due:null}],imageFacts:[],imageDecisions:[],imageItems:{tasks:[],issues:[],waiting:[]}};
 let saved,calls=0;const result=await analyzePrivateMail({messageId:id,ownerName:'테스트담당자',key:'MOCK_ONLY',provider:'openai',model:'gpt-6-luna',monthlyCandidates:[monthly],loadMail:async()=>({id,uidl_hash:'e'.repeat(64),subject:'가상 월간 처리',sender:'owner@example.test',sent_at:'2026-11-01T01:00:00Z',created_at:'2026-11-02T01:00:00Z',headers:'From: owner@example.test\r\nTo: approval@example.test\r\nCc: owner@example.test\r\nDate: Sun, 1 Nov 2026 01:00:00 +0000',text:body,ownerContext:{recipientRole:'cc',senderIsOwner:true}}),fetcher:async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert(options.body.includes(monthly.ref));const value=calls===1?normal:{matchesTarget:true,action:'complete',text:'10월분 품의 상신 완료',evidence:proof,details:[],completionEvidence:proof,serviceOriginal:null,dueOriginal:null};return Response.json({model:'gpt-6-luna',status:'completed',usage:{input_tokens:47,output_tokens:14,total_tokens:61},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]})},store:{claim:async()=>({row:{id,uidl_hash:'e'.repeat(64)},lease:'isolated'}),finish:async value=>{saved=value.analysis;return true},fail:async()=>true}});
 assert.equal(result.status,'done',JSON.stringify(result));assert.equal(calls,2);assert.equal(saved.monthlyUpdates[0].ref,monthly.ref);assert.equal(saved.monthlyUpdates[0].status,'complete');assert.equal(saved.monthlyUpdates[0].sourceAt,'2026-11-01T01:00:00.000Z');assert.equal(saved.updates.length,0);assert.equal(saved.summary.length,2);assert.equal(saved.inference.usage.total_tokens,122);
 const {dailyBriefingView,renderDailyBriefing}=await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');const native={id:taskId,owner_id:owner,title:monthly.text,version:2,center_code:null,work_scope:'delivery_team',work_date:'2026-10-29',updated_at:'2026-11-01T01:00:00Z',completed_at:'2026-11-01T01:00:00Z',status:'completed',inputs:{personal_monthly:{...monthly.monthly,ownerId:owner,scheduledMonth:'2026-11'},personal_work:{schema:'sajo-daily-work-v1',workId:monthly.ref,ownerId:owner,scope:{kind:'delivery_team',centerCode:null,workCategory:null},category:'task',status:'complete',summary:[saved.monthlyUpdates[0].text],sourceKeys:[monthly.ref,'source:'+id],verifiedCompletionAt:'2026-11-01T01:00:00Z'}}};const view=dailyBriefingView({now:'2026-11-01T12:00:00+09:00',analyses:[saved],portalTasks:[native],portalOwnerId:owner});assert.equal(view.workItems.length,2);const nativeView=view.workItems.find(work=>work.portalTaskId===taskId);assert(nativeView.sourceRefs.some(source=>source.kind==='mail'&&source.id===id),'canonical monthly work must retain the actual mail source');const reference=view.workItems.find(work=>work.category==='reference');assert.deepEqual(reference.summary,['가상 안전교육 자료 공유'],'consumed monthly summary must not duplicate the update or erase unrelated reference content');const note=renderDailyBriefing({now:'2026-11-01T12:00:00+09:00',analyses:[saved],portalTasks:[native],portalOwnerId:owner});assert(note.managedHtml.includes('가상 안전교육 자료 공유'));assert(note.managedHtml.includes('10월분 품의 상신 완료'));
 const {normalizeMonthlyMailUpdates}=await import('../supabase/functions/onedrive-auth/private-mail-monthly.js');
 const direct=async(text,{status='complete',action='complete',candidate=monthly,override={}}={})=>{let calls=0;const value=await normalizeMonthlyMailUpdates({updates:[{ref:candidate.ref,status,evidence:text,text:'가상 월간 처리',due:null}],candidates:[candidate],mail:{id,sent_at:'2026-11-01T01:00:00Z',sender:'sender@example.test'},context:{currentBody:text,ownerContext:{recipientRole:'to',senderIsOwner:false}},ai:{aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async()=>{calls++;return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action,text:'가상 월간 처리',evidence:text,details:[],completionEvidence:action==='complete'?text:null,serviceOriginal:null,dueOriginal:null,...override})}]}]})}});return{...value,calls}};
 const material=await direct('2026년 10월분 가상 선지급 증빙 자료 송부 완료했습니다.');assert.equal(material.updates.length,0,'even a model complete label cannot turn material delivery into approval completion');assert.equal(material.review.length,1);
 const quantity=await direct('2026년 10월분 물량 4P 자료를 추가합니다.',{status:'pending',action:'update'});assert.equal(quantity.updates[0].status,'pending');
 const wrongPeriod=await direct('2026년 11월분 가상 선지급 품의 상신 완료했습니다.');assert.equal(wrongPeriod.updates.length,0);assert.equal(wrongPeriod.calls,0);
 const first={...monthly,text:'가상 직접배차 1차 품의',monthly:{...monthly.monthly,advanceKind:'yangsan_first',scheduledDate:'2026-11-23',targetPeriod:{from:'2026-11-01',through:'2026-11-15'}}};const wrongType=await direct('11월 2차 품의 상신 완료했습니다.',{candidate:first});assert.equal(wrongType.updates.length,0);assert.equal(wrongType.calls,0);
 const wrongRange=await direct('11월 16일~말일분 품의 상신 완료했습니다.',{candidate:first});assert.equal(wrongRange.updates.length,0);assert.equal(wrongRange.calls,0);
 const undated=await normalizeMonthlyMailUpdates({updates:[{ref:monthly.ref,evidence:proof}],candidates:[monthly],mail:{id},context:{currentBody:proof},ai:{},fetcher:()=>assert.fail('missing source time cannot authorize completion')});assert.equal(undated.updates.length,0);assert.equal(undated.review[0].reason,'monthly_source_time_confirmation');
 const quoted=await normalizeMonthlyMailUpdates({updates:[{ref:monthly.ref,status:'complete',evidence:proof}],candidates:[monthly],mail:{id,sent_at:'2026-11-01T01:00:00Z'},context:{currentBody:'참고 자료 전달드립니다.',ownerContext:{recipientRole:'to',senderIsOwner:false}},ai:{},fetcher:()=>assert.fail('quoted completion must not be sent for a state change')});assert.equal(quoted.updates.length,0);assert.equal(quoted.review.length,1);
 console.log('PASS actual mail analysis contract with monthly candidate, explicit approval completion and separate source-time/usage tracking');
}

{
 const {reviewNormalizedMail}=await import('../supabase/functions/onedrive-auth/private-mail-jev-verifier.js');
 const id='11111111-1111-4111-8111-111111111111',ref='source:71000000-0000-4000-8000-000000000001',text='2026년 10월분 가상 품의 상신 완료했습니다.';let outgoing;
 const analysis={source:{id},revision:1,intent:{kind:'update'},tasks:[],issues:[],waiting:[],updates:[],monthlyUpdates:[{ref,text,evidence:text,status:'complete',needsConfirmation:false}]},before=structuredClone(analysis);
 const review=await reviewNormalizedMail({analysis,mail:{id,text,sender:'sender@example.test'},
  related:[{ref,kind:'tasks',text:'가상 품의',status:'pending',monthly:{scheduledDate:'2026-11-01',targetPeriod:{from:'2026-10-01',through:'2026-10-31'},paymentDate:'2026-11-10'}}],
  config:{enabled:true,key:'MOCK_ONLY',approvedSourceIds:[id],fetcher:async(url,options)=>{
   outgoing=JSON.parse(options.body);
   return Response.json({model:'jev-1.14.0',answers:Object.fromEntries(Object.keys(outgoing.questions).map(key=>[key,{type:'noul',noul:0.01}]))});
  }}
 });
 assert.equal(review.status,'no_concerns');assert(JSON.stringify(outgoing.state).includes('monthlyUpdates'));assert(JSON.stringify(outgoing.state).includes('2026-10-31'));assert(JSON.stringify(outgoing.state).includes('2026-11-10'));assert.deepEqual(analysis,before,'monthly JEV remains advisory and cannot change the approved extraction or status');
}

{
 const {normalizeMonthlyMailUpdates}=await import('../supabase/functions/onedrive-auth/private-mail-monthly.js');
 const ref='source:71000000-0000-4000-8000-000000000001',id='11111111-1111-4111-8111-111111111111',text='2026년 10월분 가상 품의 상신 완료했습니다.';
 const candidate={ref,text:'가상 품의',status:'pending',monthly:{advanceKind:'nonghyup',targetPeriod:{from:'2026-10-01',through:'2026-10-31'}}};
 const run=details=>normalizeMonthlyMailUpdates({updates:[{ref,evidence:text,status:'complete'}],candidates:[candidate],mail:{id,sent_at:'2026-11-02T01:00:00Z'},context:{currentBody:text},ai:{aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async()=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:'progress',text:'품의 진행',evidence:text,details,completionEvidence:null,serviceOriginal:null,dueOriginal:null})}]}]})});
 const valid=await run([]);assert.equal(valid.updates[0].status,'pending','model progress is accepted as progress, never forced to complete');assert.equal(valid.review.length,0);
 const invalid=await run(['원문에 없는 요약 세부내용']);assert.equal(invalid.updates.length,0);assert.equal(invalid.review[0].code,'MANUAL_EVIDENCE');assert.equal(invalid.review[0].field,'details');assert(!JSON.stringify(invalid.review).includes('원문에 없는'));
}

// Replay the exact saved monthly failure: the verifier quoted the current-body greeting omitted by extraction.
{
 const {normalizeMonthlyMailUpdates}=await import('../supabase/functions/onedrive-auth/private-mail-monthly.js');
 const id='11111111-1111-4111-8111-111111111111',ref='source:71000000-0000-4000-8000-000000000001';
 const body='테스트담당자님, 요청하신 2026년 10월분 가상협동조합 선지급 품의 상신 완료했습니다.',anchor='2026년 10월분 가상협동조합 선지급 품의 상신 완료했습니다.';
 const recorded={matchesTarget:true,action:'progress',text:'2026년 10월분 가상협동조합 선지급 품의 상신 완료 안내',evidence:body,details:[],completionEvidence:null,serviceOriginal:null,dueOriginal:null};
 const candidate={ref,text:'가상협동조합 선지급 품의',status:'pending',monthly:{advanceKind:'nonghyup',scheduledDate:'2026-11-01',targetPeriod:{from:'2026-10-01',through:'2026-10-31'},paymentDate:'2026-11-10'}};
 let prompt;
 const run=value=>normalizeMonthlyMailUpdates({updates:[{ref,status:'complete',evidence:anchor,text:'2026년 10월분 가상협동조합 선지급 품의 상신 완료',due:null}],candidates:[candidate],mail:{id,sent_at:'2026-11-02T01:00:00Z'},context:{currentBody:body,ownerContext:{recipientRole:'to',senderIsOwner:false}},ai:{aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async(url,options)=>{prompt=JSON.parse(options.body).input[0].content[0].text;return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}]})}});
 const replay=await run(recorded);assert.equal(replay.review.length,0,JSON.stringify(replay.review));assert.equal(replay.updates[0].status,'pending','recorded progress is never coerced into completion');assert(prompt.includes('focusEvidence'));assert(prompt.includes('결재 승인·지급 완료를 기다리는 업무가 아닙니다'));
 const completed=await run({...recorded,action:'complete',completionEvidence:body});assert.equal(completed.updates[0].status,'complete');
 const invented=await run({...recorded,evidence:body.replace('요청하신','요청하셨던')});assert.equal(invented.updates.length,0);assert.equal(invented.review[0].code,'MANUAL_EVIDENCE');
 const unrelated=await run({...recorded,evidence:'테스트담당자님'});assert.equal(unrelated.updates.length,0);assert.equal(unrelated.review[0].code,'MANUAL_EVIDENCE','current-body text without the selected evidence anchor cannot update the duty');
}

// Review regressions: source-scoped monthly transitions and canonical note timestamps.
{
 const {test}=await import('node:test');
 const {normalizeMonthlyMailUpdates}=await import('../supabase/functions/onedrive-auth/private-mail-monthly.js');
 const {linkMonthlyManualItems}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
 const ref='source:71000000-0000-4000-8000-000000000001',owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',ai={aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'};
 const monthly={scheduledDate:'2026-11-01',visibleFrom:'2026-10-29',scheduledMonth:'2026-11',qualifier:'on',originalSchedule:'월초 품의',targetPeriod:{from:'2026-10-01',through:'2026-10-31'},advanceKind:'nonghyup',paymentDate:'2026-11-10'};
 const response=value=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
 await test('monthly mail preserves explicit reopen separately from progress',async()=>{
  const text='2026년 10월분 가상협동조합 품의 완료 취소하고 다시 진행합니다.';
  const run=action=>normalizeMonthlyMailUpdates({updates:[{ref,evidence:text}],candidates:[{ref,text:'가상협동조합 품의',status:'complete',monthly}],mail:{id:'71000000-0000-4000-8000-000000000002',sent_at:'2026-11-02T02:00:00Z'},context:{currentBody:text},ai,fetcher:async()=>response({matchesTarget:true,action,text:'품의 재개',evidence:text,details:[],completionEvidence:null,serviceOriginal:null,dueOriginal:null})});
  assert.equal((await run('reopen')).updates[0].stateDeclared,true);assert.notEqual((await run('progress')).updates[0].stateDeclared,true);
 });
 await test('global monthly manual matching validates full current source within focus',async()=>{
  const sentence='테스트담당자님, 2026년 10월분 가상협동조합 품의 상신 완료했습니다.',anchor=sentence.slice(9),body=sentence+'\n다른 업무 자료를 전달합니다.';let calls=0;
  const run=(quote,details=[])=>{calls=0;return linkMonthlyManualItems({value:{items:[{kind:'reference',text:'가상협동조합 품의 상신 완료',evidence:anchor,needsConfirmation:false}]},entry:{text:body,submittedAt:'2026-11-02T03:00:00Z',referenceDate:'2026-11-02'},work:[{workId:ref,title:'가상협동조합 품의',status:'pending',monthly}],ai,fetcher:async()=>response(++calls===1?{matches:[{itemIndex:0,workId:ref,needsConfirmation:false}]}:{matchesTarget:true,action:'complete',text:'품의 상신 완료',evidence:quote,details,completionEvidence:anchor,serviceOriginal:null,dueOriginal:null})});};
  const result=await run(body);assert.equal(result.reply.items[0].workRef,ref);assert.equal(result.reply.items[0].workflowStatus,'complete');
  assert.equal((await run('테스트담당자님')).reply.items[0].needsConfirmation,true);
  assert.equal((await run(sentence,['다른 업무 자료를 전달합니다.'])).reply.items[0].needsConfirmation,true,'other current-body details must not enter the selected monthly work');
 });
 await test('monthly portal progress edit supplies note latest update timestamp',async()=>{
  const {renderDailyBriefing}=await import('../supabase/functions/onedrive-auth/private-mail-briefing-model.js');
  const task={id:ref.slice(7),owner_id:owner,title:'가상 품의',status:'pending',version:2,work_date:'2026-10-29',work_scope:'delivery_team',center_code:null,updated_at:'2026-11-02T03:30:00Z',inputs:{personal_monthly:{...monthly,ownerId:owner},personal_work:{schema:'sajo-daily-work-v1',workId:ref,ownerId:owner,scope:{kind:'delivery_team',centerCode:null,workCategory:null},category:'task',status:'pending',summary:['보완자료 확인 중'],progress:'보완자료 확인 중',sourceKeys:[ref]}}};
  assert(renderDailyBriefing({now:'2026-11-02T13:00:00+09:00',analyses:[],portalTasks:[task],portalOwnerId:owner}).managedHtml.includes('최종 업데이트: 2026-11-02 12:30'));
 });
}

{
 const {test}=await import('node:test');
 await test('selected mail issue carries requested action and current stage into follow-up verification',async()=>{
  const {handleManualMessage}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',box='39045005-313e-42e1-b50c-2394b3b6ff26',mailId='72000000-0000-4000-8000-000000000001',id='72000000-0000-4000-8000-000000000002',ref=mailId+':issues:0';
  const text='10/06 가상센터 지연 비용을 협의 완료했습니다. 임시차 비용 420,000원만 지급하기로 했습니다. 해당 비용은 10월 정산에서 공제될 예정입니다.';
  const entry={entryId:id,clientRequestId:id,status:'pending',text,submittedAt:'2026-11-02T11:00:00Z',referenceDate:'2026-11-02',targetWorkId:ref,items:[]},current={id:box,owner_id:owner,enabled:true,manual_entries:{[id]:entry},briefing_overrides:{}};
  const latest='10월 정산에서 지연 비용 차감 반영을 요청했습니다.',issue={text:'가상센터 지연 비용 발생',status:'in_progress',impact:'10월 정산 차감 필요',latest,evidence:'10월 정산 시 해당 비용 차감 부탁드립니다.',itemIndex:0};let selected;
  const response=await handleManualMessage('private-mail-manual-add',{text,clientRequestId:id},{id:owner},{json:Response.json,fail:code=>Error(code),resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'}),enqueueManualReport:async()=>false,
   db:async(path,options={})=>{if(path.startsWith('private_mailboxes?'))return[current];if(path.startsWith('private_mail_messages?'))return[{analysis:{source:{id:mailId,sentAt:'2026-11-02T05:00:00Z'},issues:[issue]},analysis_excluded:false}];if(path==='rpc/private_mail_manual_claim')return{claimed:true,entry};if(path==='rpc/private_mail_manual_finish'){current.manual_entries[id]={...entry,status:'ready',items:options.body.p_items};return current.manual_entries[id];}if(path==='rpc/private_mail_manual_fail')return{...entry,status:'failed',error:options.body.p_code};throw Error('UNEXPECTED_DB '+path);},
   fetcher:async(url,options)=>{const prompt=JSON.parse(options.body).input[0].content[0].text;selected=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"selectedTarget"'))).selectedTarget;return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:'progress',text:'지연 비용 협의 완료 · 정산 공제 예정',evidence:text,details:['임시차 비용 420,000원만 지급하기로 했습니다.','해당 비용은 10월 정산에서 공제될 예정입니다.'],completionEvidence:null,serviceOriginal:null,dueOriginal:null})}]}]});}});
  assert(selected,JSON.stringify(await response.clone().json()));assert.equal(selected.kind,'issue');assert.equal(selected.status,'in_progress');assert(selected.summary.includes(latest));
  const result=await response.json();assert.equal(result.status,'ready');assert.equal(result.items.length,1);assert.equal(result.items[0].workRef,ref);assert.equal(result.items[0].done,false);assert.equal(result.items[0].serviceDate,null);assert.equal(result.items[0].dueDate,null);assert(result.items[0].details.some(t=>t.includes('420,000원')));assert(result.items[0].text.includes('협의 완료'));
 });
}

{
 const {test}=await import('node:test');
 await test('selected update repairs nonverbatim details once without relaxing evidence checks',async()=>{
  const {analyzeTargetedManual,combinedLunaInference}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const text='임시차 비용 420,000원만 지급하기로 했습니다. 해당 비용은 10월 정산에서 공제될 예정입니다.';
  const entry={text,submittedAt:'2026-11-02T11:00:00Z',referenceDate:'2026-11-02'},target={workId:'72000000-0000-4000-8000-000000000001:issues:0',title:'정산 차감 확인',kind:'issue',status:'in_progress'};
  const run=async(alwaysInvalid=false)=>{let calls=0;const result=await analyzeTargetedManual({entry,target,ai:{aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async(url,options)=>{calls++;if(calls===2)assert(options.body.includes('교정'));return Response.json({model:'gpt-6-luna',status:'completed',usage:{input_tokens:10,output_tokens:5,total_tokens:15},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:'progress',text:'비용 협의 완료 · 정산 공제 예정',evidence:text,details:calls===1||alwaysInvalid?['임시차비 42만원 확정']:['임시차 비용 420,000원만 지급하기로 했습니다.'],completionEvidence:null,serviceOriginal:null,dueOriginal:null})}]}]});}});return{result,calls};};
  const {result,calls}=await run();assert.equal(calls,2);assert.equal(result.reply.items[0].workRef,target.workId);assert.equal(result.reply.items[0].workflowStatus,'pending');assert(result.reply.items[0].details[0].includes('420,000원'));assert.equal(combinedLunaInference([result.response]).usage.total_tokens,30);
  await assert.rejects(run(true),/MANUAL_EVIDENCE/);
 });
}

{
 const {test}=await import('node:test');
 await test('same-entry request and result preserve per-request completion scope',async()=>{
  const {verifyInlineManualResults,normalizeManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const id='73000000-0000-4000-8000-000000000001',a='요청: A 자료 발송 부탁드립니다.\n처리: A 자료 발송 완료했습니다.',b='요청: B 자료 작성 후 발송 부탁드립니다.\n처리: B 자료 작성 완료했습니다. 발송은 예정입니다.',text=a+'\n'+b;
  const raw=(e,title)=>({kind:'task',text:title,evidence:e,requestEvidence:e.split('\n')[0],resultEvidence:e.split('\n')[1],needsConfirmation:false});
  let calls=0;const value={items:[raw(a,'A 자료 발송'),raw(b,'B 자료 작성 및 발송')],authoredDate:null,inputKind:'business'};
  const entry={entryId:id,text,submittedAt:'2026-11-02T11:00:00Z',referenceDate:'2026-11-02'};
  const run=async(value,action)=>verifyInlineManualResults({value,entry,ai:{aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async(url,options)=>{calls++;const prompt=JSON.parse(options.body).input[0].content[0].text;const p=JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"selectedTarget"')));const e=p.focusEvidence;const complete=action??(e===a?'complete':'progress');return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:complete,text:'처리 결과',evidence:e,details:[e.split('\n')[1]],completionEvidence:complete==='complete'?e.split('\n')[1]:null,serviceOriginal:null,dueOriginal:null})}]}]});}});
  const verified=await run(value);assert.equal(calls,2);assert.equal(verified.value.items[0].workflowStatus,'complete');assert.equal(verified.value.items[1].workflowStatus,'pending');assert.equal(verified.value.items[0].workRef,undefined);
  const items=normalizeManualItems(verified.value,{...entry,allowLinks:true,verifiedInlineResults:true});assert.equal(items.length,2);assert.equal(items[0].evidence,a);assert.equal(items[0].declaredAt,entry.submittedAt);assert(items[1].details[0].includes('발송은 예정'));assert.deepEqual(items,normalizeManualItems(verified.value,{...entry,allowLinks:true,verifiedInlineResults:true}));
  const premature=await run({items:[raw(b,'B 자료 작성 및 발송')]},'complete');assert.notEqual(premature.value.items[0].workflowStatus,'complete');
  const old='요청: C 자료 발송 부탁드립니다.\n과거 인용: C 자료 발송 완료했습니다.';
  const oldResult=await verifyInlineManualResults({value:{items:[raw(old,'C 자료 발송')]},entry:{...entry,text:old},ai:{aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async()=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:'complete',text:'C 발송',evidence:old,details:[],completionEvidence:old.split('\n')[1],serviceOriginal:null,dueOriginal:null})}]}]})});assert.notEqual(oldResult.value.items[0].workflowStatus,'complete');
  const view=manualDailyView({[id]:{...entry,status:'ready',items}},'2026-11-02');assert.equal(view.entries[0].items[0].done,true);assert.equal(view.entries[0].items[1].done,false);
  const crossed=structuredClone(value);crossed.items[0].resultEvidence=b.split('\n')[1];await assert.rejects(run(crossed),/MANUAL_EVIDENCE/);
 });
}

{
 const {test}=await import('node:test');
 await test('new request with result goes through handler save and duplicate read without new work',async()=>{
  const {handleManualMessage}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',id='73000000-0000-4000-8000-000000000002',text='A 자료 발송 부탁드립니다.\nA 자료 발송 완료했습니다.';
  const entry={entryId:id,clientRequestId:id,text,submittedAt:'2026-11-02T11:00:00Z',referenceDate:'2026-11-02',items:[],status:'pending'},current={id:'39045005-313e-42e1-b50c-2394b3b6ff26',owner_id:owner,enabled:true,manual_entries:{[id]:entry},briefing_overrides:{}};let calls=0,saves=0;
  const ctx={isolatedVerification:true,json:Response.json,fail:code=>Error(code),resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'}),enqueueManualReport:async()=>false,db:async(path,options={})=>{if(path.startsWith('private_mailboxes?'))return[current];if(path.startsWith('private_mail_messages?')){assert(path.includes('owner_id=eq.'+owner));return[];}if(path==='rpc/private_mail_manual_claim')return{claimed:current.manual_entries[id].status!=='ready',entry:current.manual_entries[id]};if(path==='rpc/private_mail_manual_finish'){saves++;return current.manual_entries[id]={...entry,status:'ready',items:options.body.p_items};}if(path==='rpc/private_mail_manual_fail')throw Error(options.body.p_code);throw Error(path);},fetcher:async()=>{calls++;const value=calls===1?{items:[{kind:'task',text:'A 자료 발송',evidence:text,requestEvidence:text.split('\n')[0],resultEvidence:text.split('\n')[1],assignee:null,serviceOriginal:null,dueOriginal:null,needsConfirmation:false}],authoredDate:null,inputKind:'business'}:{matchesTarget:true,action:'complete',text:'A 자료 발송 완료',evidence:text,details:[],completionEvidence:text.split('\n')[1],serviceOriginal:null,dueOriginal:null};return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]});}};
  const call=()=>handleManualMessage('private-mail-manual-add',{text,clientRequestId:id},{id:owner},ctx);
  const first=await (await call()).json();assert.equal(first.status,'ready');assert.equal(first.items[0].done,true);assert.equal(calls,2);const saved=structuredClone(current.manual_entries[id]);
  const duplicate=await (await call()).json();assert.equal(duplicate.items[0].done,true);assert.equal(calls,2);assert.equal(saves,1);assert.deepEqual(current.manual_entries[id],saved);assert.equal(saved.text,text);
  current.manual_entries[id]={...entry,status:'pending',items:[]};calls=0;const normalCtx={...ctx,isolatedVerification:false,fetcher:async(url,options)=>{calls++;const request=JSON.parse(options.body);assert(!JSON.stringify(request).includes('requestEvidence'));return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({items:[{kind:'task',text:'A 자료 발송',evidence:text,assignee:null,serviceOriginal:null,dueOriginal:null,needsConfirmation:false}],authoredDate:null,inputKind:'business'})}]}]});}};
  const operating=await (await handleManualMessage('private-mail-manual-add',{text,clientRequestId:id,isolatedVerification:true},{id:owner},normalCtx)).json();assert.equal(operating.status,'ready');assert.equal(operating.items[0].done,false);assert.equal(calls,1,'body cannot enable isolated next-version verification on operating path');current.manual_entries[id]={...entry,status:'pending',items:[]};calls=0;const enabled=await (await handleManualMessage('private-mail-manual-add',{text,clientRequestId:id},{id:owner},{...ctx,isolatedVerification:false,verifiedUpdatesEnabled:true})).json();assert.equal(enabled.status,'ready');assert.equal(enabled.items[0].done,true);assert.equal(calls,2,'server-enabled ordinary path must extract and verify request/result with the same contract');

 });
}

{
 const {verifyInlineManualResults}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const cases=[
 ['normal','A 자료 발송 부탁드립니다.','A 자료 발송 완료했습니다.',true],
 ['future','A 자료 발송 부탁드립니다.','A 자료 발송 완료 예정입니다.',false],
 ['refused','A 자료 발송 부탁드립니다.','A 자료 요청은 거절 처리 완료했습니다.',false],
 ['imperative','A 자료 발송 부탁드립니다.','A 자료 발송 완료해주세요.',false],
 ['quoted','A 자료 발송 부탁드립니다.','> A 자료 발송 완료했습니다.',false],
 ['cancel','A 자료 발송 부탁드립니다.','A 자료 발송 요청 취소 완료했습니다.',false],
 ['negative','A 자료 발송 부탁드립니다.','A 자료 발송은 아직 완료하지 못했습니다.',false],
];
const rows=[];
for(const [id,request,result,expected] of cases){
 const text=request+'\n'+result;const v=await verifyInlineManualResults({value:{items:[{kind:'task',text:'A 자료 발송',evidence:text,requestEvidence:request,resultEvidence:result,needsConfirmation:false}]},entry:{entryId:'73000000-0000-4000-8000-000000000003',text,referenceDate:'2026-11-02',submittedAt:'2026-11-02T11:00:00Z'},ai:{aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async()=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:'complete',text:'A 자료 발송',evidence:text,details:[],completionEvidence:result,serviceOriginal:null,dueOriginal:null})}]}]})});
 const actual=v.value.items[0].workflowStatus==='complete';rows.push({id,expected,actual,passed:expected===actual,input:text});
}
assert(rows.every(r=>r.passed),'adversarial completion guard failures');

}

{
 const {test}=await import('node:test');
 await test('monthly material progress survives one quote repair while scope and completion checks remain strict',async()=>{
  const {normalizeMonthlyMailUpdates}=await import('../supabase/functions/onedrive-auth/private-mail-monthly.js');
  const ref='source:71000000-0000-4000-8000-000000000001',id='74000000-0000-4000-8000-000000000001',anchor='2026년 10월분 가상협동조합 선지급 증빙 자료 송부 완료했습니다.',extra='다른 업무의 승인 자료도 전달합니다.',body=anchor+' 품의 상신은 아직 하지 않았습니다.\n'+extra;
  const candidate={ref,text:'가상협동조합 선지급 품의',status:'pending',monthly:{advanceKind:'nonghyup',targetPeriod:{from:'2026-10-01',through:'2026-10-31'}}};
  const run=async(firstDetail,secondDetail,action='progress')=>{let calls=0;const result=await normalizeMonthlyMailUpdates({isolatedVerification:true,updates:[{ref,evidence:anchor,status:'pending'}],candidates:[candidate],mail:{id,sent_at:'2026-11-02T01:00:00Z'},context:{currentBody:body},ai:{aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async()=>{calls++;return Response.json({model:'gpt-6-luna',status:'completed',usage:{input_tokens:10,output_tokens:5,total_tokens:15},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action,text:'10월분 증빙 자료 송부, 품의 상신 대기',evidence:anchor,details:[calls===1?firstDetail:secondDetail],completionEvidence:action==='complete'?anchor:null,serviceOriginal:null,dueOriginal:null})}]}]});}});return{result,calls};};
  const repaired=await run('10월 증빙자료 발송',anchor);assert.equal(repaired.calls,2);assert.equal(repaired.result.updates.length,1);assert.equal(repaired.result.updates[0].status,'pending');assert.equal(repaired.result.updates[0].details[0],anchor);assert.equal(repaired.result.review.length,0);
  const {combinedLunaInference}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');assert.equal(combinedLunaInference(repaired.result.responses).usage.total_tokens,30);
  const outOfFocus=await run(extra,anchor);assert.equal(outOfFocus.result.updates.length,1);assert(!outOfFocus.result.updates[0].details.includes(extra));
  const persistent=await run(extra,extra);assert.equal(persistent.calls,2);assert.equal(persistent.result.updates.length,0);assert.equal(persistent.result.review[0].field,'details');
  const falseComplete=await run(anchor,anchor,'complete');assert.equal(falseComplete.result.updates.length,0,'material delivery cannot complete the approval duty');
 });
}

{
 const {fixtureById}=await import('../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js');
 const {evaluateStressResult}=await import('../supabase/functions/onedrive-auth/private-mail-stress-verify.js');
 const fixture=fixtureById('mail-monthly-material-only'),empty={tasks:[],issues:[],waiting:[],updates:[],monthlyUpdates:[],monthlyReview:[{ref:fixture.expected.monthly.ref,reason:'monthly_verification_unavailable',code:'MANUAL_EVIDENCE',field:'details'}]};
 const lost=evaluateStressResult(fixture,empty,[],null);assert.equal(lost.checks.monthlyCompletion,true);assert.equal(lost.checks.monthlyTarget,true);assert.equal(lost.checks.monthlyCount,false);assert.equal(lost.checks.monthlyProgress,false);assert.equal(lost.automatedChecksPassed,false,'pending by default is not a preserved progress update');
 const present=evaluateStressResult(fixture,{...empty,monthlyReview:[],monthlyUpdates:[{ref:fixture.expected.monthly.ref,status:'pending',text:'10월분 증빙 자료 전달, 품의 상신 대기',details:[]}]},[],null);assert.equal(present.checks.monthlyProgress,true);assert.equal(present.automatedChecksPassed,true);
}

{
 const {test}=await import('node:test');
 await test('recorded monthly material detail paraphrases repair without dropping progress or accepting unsafe correction',async()=>{
  const {normalizeMonthlyMailUpdates}=await import('../supabase/functions/onedrive-auth/private-mail-monthly.js');
  const {combinedLunaInference}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const source='2026년 10월분 가상협동조합 선지급 증빙 자료 송부 완료했습니다. 품의 상신은 아직 하지 않았습니다.';
  // These detail arrays and progress/matching fields were returned by the real provider. Other response fields below are harness values.
  const recorded=[['2026년 10월분 증빙 자료 송부 완료','품의 상신은 아직 하지 않음'],['2026년 10월분 선지급 증빙 자료 송부 완료','품의 상신은 아직 하지 않음']];
  const ref='source:71000000-0000-4000-8000-000000000001',id='74000000-0000-4000-8000-000000000002',candidate={ref,text:'가상협동조합 선지급 품의',status:'pending',monthly:{advanceKind:'nonghyup',targetPeriod:{from:'2026-10-01',through:'2026-10-31'}}};
  const run=async(details,correction,action='progress')=>{let calls=0;const before=structuredClone(candidate);const result=await normalizeMonthlyMailUpdates({isolatedVerification:true,updates:[{ref,status:'pending',text:'증빙 자료 송부, 품의 상신 대기',evidence:source}],candidates:[candidate],mail:{id,sent_at:'2026-11-02T01:00:00Z'},context:{currentBody:source},ai:{aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async(url,options)=>{calls++;const prompt=JSON.parse(options.body).input[0].content[0].text;assert(prompt.includes(source));if(calls===2){assert(prompt.includes(JSON.stringify(details)));assert(prompt.includes('focusEvidence'));}return Response.json({model:'gpt-6-luna',status:'completed',usage:{input_tokens:10,output_tokens:5,total_tokens:15},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:calls===1?'progress':action,text:'10월분 증빙 자료 송부, 품의 상신 대기',evidence:source,details:calls===1?details:correction,completionEvidence:calls===2&&action==='complete'?source:null,serviceOriginal:null,dueOriginal:null})}]}]});}});assert.deepEqual(candidate,before);return{result,calls};};
  for(const original of recorded){
   const repaired=await run(original,['2026년 10월분 가상협동조합 선지급 증빙 자료 송부 완료했습니다.','품의 상신은 아직 하지 않았습니다.']);assert.equal(repaired.calls,2);assert.equal(repaired.result.updates.length,1);assert.equal(repaired.result.updates[0].status,'pending');assert.equal(repaired.result.updates[0].evidence,source);assert(repaired.result.updates[0].text.includes('자료 송부'));assert.equal(repaired.result.review.length,0);assert.equal(combinedLunaInference(repaired.result.responses).usage.total_tokens,30);
   const empty=await run(original,[]);assert.equal(empty.result.updates.length,1);assert.equal(empty.result.updates[0].status,'pending');assert(empty.result.updates[0].text.includes('자료 송부'));
   const stillInvalid=await run(original,original);assert.equal(stillInvalid.calls,2);assert.equal(stillInvalid.result.updates.length,0);assert.equal(stillInvalid.result.review[0].code,'MANUAL_EVIDENCE');assert.equal(stillInvalid.result.review[0].field,'details');
   const invented=await run(original,['품의 상신 완료했습니다.']);assert.equal(invented.result.updates.length,0);
   const wrongComplete=await run(original,[source],'complete');assert.equal(wrongComplete.result.updates.length,0,'a correction cannot turn material delivery plus explicit non-submission into approval completion');
  }
 });
}

{
 const {test}=await import('node:test');
 await test('selected mail reinput retains original request after prior linked progress',async()=>{
  const {handleManualMessage}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',box='39045005-313e-42e1-b50c-2394b3b6ff26',mailId='72000000-0000-4000-8000-000000000001',id='72000000-0000-4000-8000-000000000002',ref=mailId+':issues:0';
  const text='10/06 가상센터 지연 비용을 협의 완료했습니다. 임시차 비용 420,000원만 지급하기로 했습니다. 해당 비용은 10월 정산에서 공제될 예정입니다.';
  const entry={entryId:id,clientRequestId:id,status:'pending',text,submittedAt:'2026-11-02T11:00:00Z',referenceDate:'2026-11-02',targetWorkId:ref,items:[]},current={id:box,owner_id:owner,enabled:true,manual_entries:{[id]:entry},briefing_overrides:{}};
  const latest='10월 정산에서 지연 비용 차감 반영을 요청했습니다.',issue={text:'가상센터 지연 비용 발생',status:'in_progress',impact:'10월 정산 차감 필요',latest,evidence:'10월 정산 시 해당 비용 차감 부탁드립니다.',itemIndex:0};let selected;
  const priorId='72000000-0000-4000-8000-000000000003';current.manual_entries[priorId]={entryId:priorId,status:'ready',text,submittedAt:'2026-11-02T10:00:00Z',referenceDate:'2026-11-02',items:[{itemId:'item-001',ref:priorId+':manual:item-001',workRef:ref,kind:'issue',text:'지연 비용 420,000원 합의 · 공제 예정',evidence:text,details:['420,000원 합의','10월 정산 공제 예정'],workflowStatus:'pending',done:false,completedAt:null,completionEvents:[],needsConfirmation:false,submittedAt:'2026-11-02T10:00:00Z',receivedAt:'2026-11-02T10:00:00Z',declaredAt:'2026-11-02T10:00:00Z',visibleFrom:'2026-11-02'}]};
  const response=await handleManualMessage('private-mail-manual-add',{text,clientRequestId:id},{id:owner},{json:Response.json,fail:code=>Error(code),resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'}),enqueueManualReport:async()=>false,
   db:async(path,options={})=>{if(path.startsWith('private_mailboxes?'))return[current];if(path.startsWith('private_mail_messages?'))return[{analysis:{source:{id:mailId,sentAt:'2026-11-02T05:00:00Z'},issues:[issue]},analysis_excluded:false}];if(path==='rpc/private_mail_manual_claim')return{claimed:true,entry};if(path==='rpc/private_mail_manual_finish'){current.manual_entries[id]={...entry,status:'ready',items:options.body.p_items};return current.manual_entries[id];}if(path==='rpc/private_mail_manual_fail')return{...entry,status:'failed',error:options.body.p_code};throw Error('UNEXPECTED_DB '+path);},
   fetcher:async(url,options)=>{const prompt=JSON.parse(options.body).input[0].content[0].text;selected=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"selectedTarget"'))).selectedTarget;return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:'progress',text:'지연 비용 협의 완료 · 정산 공제 예정',evidence:text,details:['임시차 비용 420,000원만 지급하기로 했습니다.','해당 비용은 10월 정산에서 공제될 예정입니다.'],completionEvidence:null,serviceOriginal:null,dueOriginal:null})}]}]});}});
  assert(selected,JSON.stringify(await response.clone().json()));assert.equal(selected.kind,'issue');assert.equal(selected.status,'in_progress');assert(selected.summary.includes(latest));assert.equal(selected.originalRequest.title,issue.text);assert.equal(selected.originalRequest.evidence,issue.evidence);
  const result=await response.json();assert.equal(result.status,'ready');assert.equal(result.items.length,1);assert.equal(result.items[0].workRef,ref);assert.equal(result.items[0].done,false);assert.equal(result.items[0].serviceDate,null);assert.equal(result.items[0].dueDate,null);assert(result.items[0].details.some(t=>t.includes('420,000원')));assert(result.items[0].text.includes('협의 완료'));
 });
}

{
 const {test}=await import('node:test');
 await test('remaining settlement action replaces incident title on the same work and survives old receipt replay',async()=>{
  const {analyzeTargetedManual,normalizeManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const {dailyWorkItems,renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
  const amount='420,000',source='가상센터 지연 비용은 임시차 2건 비용 '+amount+'원만 지불 하기로 했습니다. 해당 비용은 10월 정산에서 공제 될 예정입니다.',proof='해당 비용은 10월 정산에서 공제 될 예정입니다.';
  const ref='77000000-0000-4000-8000-000000000001:issues:0',title='10월 정산에서 '+amount+'원 공제',target={workId:ref,title:'가상센터 지연 비용 발생',kind:'issue',status:'in_progress',originalRequest:{title:'가상센터 지연 비용 발생',summary:['10월 정산 차감 요청'],evidence:'10월 정산 차감 부탁드립니다.'}};
  let prompt;const run=async({text=source,id='77000000-0000-4000-8000-000000000002',at='2026-11-03T01:00:00Z',action='progress',next=proof,matches=true}={})=>{
   const entry={entryId:id,text,submittedAt:at,referenceDate:'2026-11-03'},response=await analyzeTargetedManual({entry,target,ai:{aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async(url,options)=>{prompt=JSON.parse(options.body).input[0].content[0].text;return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:matches,action,text:action==='complete'?'10월 정산 공제 반영 완료':title,evidence:text,details:[text],nextActionEvidence:next,completionEvidence:action==='complete'?text:null,serviceOriginal:null,dueOriginal:null})}]}]});}});
   const items=normalizeManualItems(response.reply,{...entry,allowLinks:true,verifiedDispatchReply:true,replyDetailsByItem:response.reply.items.map(i=>i.details??[])});return {...entry,status:'ready',items};
  };
  const current=await run(),before=structuredClone(current);assert(prompt.includes('원래 업무가 아직 끝나지 않았으면'));assert(prompt.includes(target.originalRequest.evidence));assert.equal(current.items[0].text,title);assert.equal(current.items[0].nextAction,proof);assert.equal(current.items[0].workflowStatus,'pending');assert.equal(current.items[0].workRef,ref);
  const oldId='77000000-0000-4000-8000-000000000003',old={...current,entryId:oldId,submittedAt:'2026-11-02T01:00:00Z',items:current.items.map(item=>({...item,ref:oldId+':manual:item-001',text:'가상센터 지연 비용 발생',nextAction:null,receivedAt:'2026-11-02T01:00:00Z',submittedAt:'2026-11-02T01:00:00Z',declaredAt:'2026-11-02T01:00:00Z',visibleFrom:'2026-11-02'}))};
  const project=(entries,workOverrides={})=>dailyWorkItems({day:'2026-11-03',groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(entries,'2026-11-03',workOverrides),{workOverrides});
  for(const entries of [{[oldId]:old,[current.entryId]:current},{[current.entryId]:current,[oldId]:{...old,updatedAt:'2026-11-04T01:00:00Z'}}]){const work=project(entries);assert.equal(work.length,1);assert.equal(work[0].workId,ref);assert.equal(work[0].title,title);assert.equal(work[0].nextAction,proof);assert.notEqual(work[0].status,'complete');const html=renderBriefingWorkNote(work);assert(html.includes(title));assert(html.includes(amount));assert(html.includes('10월 정산'));}
  const completed=await run({id:'77000000-0000-4000-8000-000000000004',at:'2026-11-03T02:00:00Z',text:'10월 정산에서 '+amount+'원 공제 반영 완료했습니다.',action:'complete',next:null});const work=project({[completed.entryId]:completed,[oldId]:old,[current.entryId]:current});assert.equal(work.length,1);assert.equal(work[0].workId,ref);assert.equal(work[0].status,'complete');assert.equal(work[0].nextAction,null);assert.deepEqual(current,before);const owner={['work:'+ref]:{actor:'owner',done:false,updatedAt:'2026-11-03T03:00:00Z'}};const reopened=project({[completed.entryId]:completed,[current.entryId]:current},owner);assert.equal(reopened[0].status,'pending');assert(reopened[0].sourceRefs.some(s=>s.ref===current.items[0].ref));assert.deepEqual(current,before);
  const conflict=await run({matches:false});assert.equal(conflict.items[0].needsConfirmation,true);assert.equal(conflict.items[0].workRef,undefined);assert.equal(conflict.items[0].nextAction,undefined);
  await assert.rejects(run({next:'10월 정산에서 없는 금액을 공제'}),/MANUAL_EVIDENCE/);
 });
}

{
 const {readFile}=await import('node:fs/promises');const {stripTypeScriptTypes}=await import('node:module');
 const source=await readFile(new URL('../app/src/lib/api-management.ts',import.meta.url),'utf8');
 const start=source.indexOf('export function validateStressCatalogue'),end=source.indexOf('\nexport const apiManagement',start);
 const js=stripTypeScriptTypes(source.slice(start,end).replace('export function','function'));
 const validate=new Function(js+';return validateStressCatalogue;')();
 const cases=Array.from({length:41},(_,i)=>({id:'case-'+i,kind:i%2?'mail':'manual'}));assert.equal(validate(cases).length,41);assert.equal(validate(cases.slice(0,1)).length,1);assert.equal(validate([...cases,...Array.from({length:100},(_,i)=>({id:'future-'+i,kind:'manual'}))]).length,141);
 for(const invalid of [null,[],[{id:'bad id',kind:'manual'}],[{id:'good',kind:'unknown'}],[cases[0],cases[0]]])assert.throws(()=>validate(invalid),/STRESS_CATALOGUE_INVALID/);
}

{
 const {workSummaryForDisplay,renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
 const full='A 자료 작성 완료했습니다. 발송은 아직 하지 않았습니다.',first='A 자료 작성 완료했습니다.',second='발송은 아직 하지 않았습니다.';
 const item={workId:'75000000-0000-4000-8000-000000000001:manual:item-001',title:'A 자료 작성 및 발송',category:'task',status:'in_progress',summary:[full,first,second,first],progress:full,sourceRefs:[],serviceDate:null};const before=structuredClone(item);
 assert.deepEqual(workSummaryForDisplay(item),[full]);const html=renderBriefingWorkNote([item]);assert.equal(html.split('작성 완료했습니다').length-1,1);assert.equal(html.split('발송은 아직 하지 않았습니다').length-1,1);assert.deepEqual(item,before,'display compaction cannot rewrite source summary or evidence');
 const split={...item,summary:[first,second],progress:full};const splitHtml=renderBriefingWorkNote([split]);assert.equal(splitHtml.split('작성 완료했습니다').length-1,1);assert.equal(splitHtml.split('발송은 아직 하지 않았습니다').length-1,1);
 const facts={...item,summary:['화물 160박스 4P 1.7톤','화물 160박스 4P 1.8톤','발송 예정은 11/4 09:00입니다.','발송 예정은 11/5 09:00입니다.'],progress:null};assert.equal(workSummaryForDisplay(facts).length,4,'conflicting amounts/dates are distinct facts, not duplicate wording');assert.equal(workSummaryForDisplay({...item,summary:['발송 완료?','발송 완료','주소 12 34','주소 1 234'],progress:null}).length,4,'questions and distinct numeric token boundaries must survive compaction');
}

{
 const {test}=await import('node:test');
 await test('recorded live partial and multiple notes render each fact once without state changes',async()=>{
 const {workSummaryForDisplay,renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
 // Exact title/summary/progress fragments supplied from three saved live-model runs. State follows their actual note sections.
 const recorded=[
  [{title:'A 자료 작성 후 발송',summary:['A 자료 작성 완료했습니다. 발송은 아직 하지 않았습니다.','A 자료 작성 완료했습니다.','발송은 아직 하지 않았습니다.'],progress:null,status:'pending'}],
  [{title:'A 자료 발송',summary:['처리: A 자료 발송 완료했습니다.'],progress:null,status:'complete'},{title:'B 자료 작성 후 발송',summary:['처리: B 자료 작성 완료했습니다. 발송은 예정입니다.','B 자료 작성 완료했습니다.','발송은 예정입니다.'],progress:null,status:'pending'}],
  [{title:'A 자료 발송',summary:['처리: A 자료 발송 완료했습니다.'],progress:null,status:'complete'},{title:'B 자료 작성 후 발송',summary:['처리: B 자료 작성 완료했습니다. 발송은 예정입니다.','B 자료 작성 완료','발송은 예정'],progress:null,status:'pending'}],
 ];
 for(const [run,values] of recorded.entries()){
  const items=values.map((value,index)=>({...value,workId:'76000000-0000-4000-8000-00000000000'+(index+1)+':manual:item-001',category:'task',sourceRefs:[],serviceDate:null})),before=structuredClone(items);
  for(const item of items)assert.deepEqual(workSummaryForDisplay(item),[item.summary[0]],'live run '+run+' must render each processing fact once');
  const html=renderBriefingWorkNote(items),prefix=run===0?'A':'B';assert.equal(html.split(prefix+' 자료 작성 완료').length-1,1);assert.equal(html.split(run===0?'발송은 아직 하지 않았습니다':'발송은 예정').length-1,1);assert(html.includes('1. To Do'));
  if(run>0){assert(html.includes('2. 완료'));assert.equal(html.split('처리: A 자료 발송 완료했습니다.').length-1,1);assert(html.indexOf('B 자료 작성 후 발송')<html.indexOf('2. 완료'));assert(html.indexOf('처리: A 자료 발송 완료했습니다.')>html.indexOf('2. 완료'));}
  assert.deepEqual(items,before,'read-only compaction preserves all recorded summaries, source refs and pending/completed states');
 }
 const ambiguous={title:'자료 발송',category:'task',summary:['발송 완료했습니다.','발송 완료 예정입니다.','발송은 예정입니다?','발송은 예정입니다.','발송하지 않았습니다.'],serviceDate:null};assert.equal(workSummaryForDisplay(ambiguous).length,5,'completion, planned completion, question and explicit negation are distinct');
 });
}

{
 const {test}=await import('node:test');
 await test('selected refusal remains linked progress and cannot complete an unrelated fulfilment',async()=>{
  const {analyzeTargetedManual,normalizeManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
  const {dailyWorkItems,renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
  const id='78000000-0000-4000-8000-000000000002',sourceId='78000000-0000-4000-8000-000000000001',ref=sourceId+':manual:item-003';
  const text='가상검증전용감마자료 요청은 거절 처리 완료했습니다.',title='가상검증전용감마자료 발송',day='2026-11-03';
  const target={workId:ref,title,kind:'task',status:'pending'},entry={entryId:id,text,submittedAt:'2026-11-03T03:20:14Z',referenceDate:day};
  let request;const run=async(overrides={},targetOverride={},source=text)=>analyzeTargetedManual({entry:{...entry,text:source},target:{...target,...targetOverride},ai:{aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async(url,options)=>{request=JSON.parse(options.body);return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:'decline',text:'요청 거절',evidence:source,details:[],completionEvidence:null,serviceOriginal:null,dueOriginal:null,...overrides})}]}]});}});
  const result=await run(),raw=result.reply.items[0];assert.equal(raw.workRef,ref);assert.equal(raw.workflowStatus,'pending');assert.equal(raw.needsConfirmation,false);assert.equal(raw.stateDeclared,false);assert.equal(raw.text,title);assert.deepEqual(raw.details,[text]);
  assert(request.input[0].content[0].text.includes('거절'));assert(request.input[0].content[0].text.includes('update/progress/decline/complete'));
  const originalText='요청: 가상검증전용감마자료를 발송해 주세요.\n추가 요청: 가상검증전용감마자료 발송 완료해주세요.';
  const base={entryId:sourceId,status:'ready',text:originalText,submittedAt:'2026-11-03T03:18:37Z',referenceDate:day,items:[{itemId:'item-003',ref,kind:'task',text:title,evidence:originalText,details:[],done:false,workflowStatus:'pending',submittedAt:'2026-11-03T03:18:37Z',receivedAt:'2026-11-03T03:18:37Z',declaredAt:'2026-11-03T03:18:37Z',visibleFrom:day,completionEvents:[]}]};
  const saved={...entry,status:'ready',items:normalizeManualItems(result.reply,{...entry,allowLinks:true,verifiedDispatchReply:true,replyDetailsByItem:result.reply.items.map(i=>i.details)})};const before=structuredClone(base);
  const works=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView({[sourceId]:base,[id]:saved},day));assert.equal(works.length,1);assert.equal(works[0].workId,ref);assert.equal(works[0].status,'pending');assert(works[0].summary.includes(text));assert(renderBriefingWorkNote(works).includes(text));assert.deepEqual(base,before);
  const wrongComplete=await run({action:'complete',completionEvidence:text});assert.equal(wrongComplete.reply.items[0].needsConfirmation,true);assert.equal(wrongComplete.reply.items[0].workRef,undefined);
  for(const overrides of [{matchesTarget:false},{action:'conflict'},{action:'cancel'}]){const conflict=await run(overrides);assert.equal(conflict.reply.items[0].workRef,undefined);assert(conflict.reply.items[0].text.includes(title));assert(conflict.reply.items[0].details.includes(text));}
  const refusalDuty=await run({action:'complete',completionEvidence:text},{title:'가상검증전용감마자료 요청 거절 통보',originalRequest:{title:'요청 거절 통보',evidence:'거절 결과를 안내해 주세요.'}});assert.equal(refusalDuty.reply.items[0].workflowStatus,'complete','performing a requested refusal notice is distinct from fulfilling the refused shipment');
  for(const requested of ['가상검증전용감마자료 발송 완료해주세요.','가상검증전용감마자료 요청 거절 처리 완료해주세요.']){const notDone=await run({action:'complete',completionEvidence:requested},{},requested);assert.equal(notDone.reply.items[0].needsConfirmation,true,'a selected-task completion request is not completed work');}
  const didNotRefuse='요청은 거절하지 않고 가상검증전용감마자료 발송 완료했습니다.';assert.equal((await run({action:'complete',completionEvidence:'가상검증전용감마자료 발송 완료했습니다.'},{},didNotRefuse)).reply.items[0].workflowStatus,'complete','mentioning a refusal that did not happen cannot block actual shipment proof');
  const unrelatedRefusal=await run({action:'complete',completionEvidence:text},{title:'반려된 자료 수정 후 발송',originalRequest:{title:'반려된 자료 수정 후 발송',evidence:'반려된 자료를 수정한 후 발송해 주세요.'}});assert.equal(unrelatedRefusal.reply.items[0].needsConfirmation,true,'mention of a refused document does not make another refusal fulfil the correction request');
  const completedBase=structuredClone(base);Object.assign(completedBase.items[0],{done:true,workflowStatus:'complete',completedAt:'2026-11-03T03:19:00Z',declaredAt:'2026-11-03T03:19:00Z'});const afterComplete=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView({[sourceId]:completedBase,[id]:saved},day));assert.equal(afterComplete[0].status,'complete','ordinary refusal progress cannot reopen a previously completed task');
  const sixDetails=['가상검증전용','감마자료','요청은','거절','처리','완료했습니다.'];assert.deepEqual((await run({details:sixDetails})).reply.items[0].details,sixDetails,'adding source context must not discard the sixth detail');
  const {handleManualMessage}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');const pending={...entry,clientRequestId:id,targetWorkId:ref,status:'pending',items:[]},current={id:'39045005-313e-42e1-b50c-2394b3b6ff26',owner_id:'2a828c2d-9a6f-40d4-8e13-336b591811cc',enabled:true,manual_entries:{[sourceId]:base,[id]:pending},briefing_overrides:{}};let calls=0;
  const response=await handleManualMessage('private-mail-manual-add',{text,clientRequestId:id},{id:current.owner_id},{verifiedUpdatesEnabled:true,json:Response.json,fail:code=>Error(code),resolveAiConfiguration:async()=>({aiKey:'MOCK_ONLY',aiProvider:'openai',aiModel:'gpt-6-luna'}),enqueueManualReport:async()=>false,db:async(path,options={})=>{if(path.startsWith('private_mailboxes?'))return[current];if(path==='rpc/private_mail_manual_claim')return{claimed:true,entry:pending};if(path==='rpc/private_mail_manual_finish'){current.manual_entries[id]={...pending,status:'ready',items:options.body.p_items};return current.manual_entries[id];}throw Error('UNEXPECTED_DB '+path);},fetcher:async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert(options.body.includes(ref));return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({matchesTarget:true,action:'decline',text:title,evidence:text,details:[text],completionEvidence:null,serviceOriginal:null,dueOriginal:null})}]}]});}});
  const stored=await response.json();assert.equal(stored.status,'ready');assert.equal(calls,1);assert.equal(stored.items[0].workRef,ref);assert.equal(stored.items[0].done,false);assert.deepEqual(base,before);assert.equal(dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(current.manual_entries,day)).length,1);
  const invalid=await run({evidence:'완료했습니다.',action:'decline'});assert.equal(invalid.reply.items[0].needsConfirmation,true,'a decline action needs explicit refusal evidence');
 });
}

{
 const {test}=await import('node:test');
 test('manual Jev multiselect remains bounded advisory and fails open',async()=>{
const mod=await import('../supabase/functions/onedrive-auth/private-mail-jev-verifier.js');
assert.equal(typeof mod.classifyManualIntents,'function');
const entry={entryId:'synthetic',text:'견적 확인은 끝났고 정산 반영은 내일 해 주세요. 다른 업체 자료는 참고입니다.',referenceDate:'2026-11-04'};
let calls=0;
const config={enabled:true,approvedSourceIds:['synthetic'],key:'synthetic',fetcher:async(url,opts)=>{calls++;assert.equal(opts.redirect,'error');const p=JSON.parse(opts.body);assert.equal(Object.keys(p.questions).length,9);return Response.json({model:mod.JEV_VERIFIER_MODEL,answers:Object.fromEntries(Object.keys(p.questions).map((key,i)=>[key,{type:'noul',noul:[.8,.9,.8,.95,.01,.9,.3,.1,.01][i]}]))});}};
const result=await mod.classifyManualIntents({entry,config});
assert.equal(result.status,'ready');assert.ok(result.signals.includes('new'));assert.ok(result.signals.includes('completion'));assert.ok(result.signals.includes('reference'));assert.ok(result.signals.includes('mixed'));assert.equal(result.authoritative,false);
assert.equal((await mod.classifyManualIntents({entry,config:{...config,approvedSourceIds:[]}})).status,'skipped');assert.equal(calls,1);
assert.equal((await mod.classifyManualIntents({entry,config:{...config,key:null}})).code,'NOT_CONFIGURED');
assert.equal((await mod.classifyManualIntents({entry,config:{...config,timeoutMs:10,fetcher:()=>new Promise(()=>{})}})).code,'TIMEOUT');
assert.equal((await mod.classifyManualIntents({entry,config:{...config,fetcher:async()=>Response.json({model:mod.JEV_VERIFIER_MODEL,answers:{}})}})).code,'INVALID_RESPONSE');
assert.equal(entry.text.includes('정산'),true);console.log('PASS intent multiselect, scope, missing key, deadline, malformed response, source immutable');

 });
}

{
 const {test}=await import('node:test');
 test('unselected structured dispatch uses verified fallback with date and origin fences',async()=>{
const {handleManualMessage,normalizeManualItems,resolveDispatchAssignment}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const {APPROVED_MAIL_TARGET:target}=await import('../supabase/functions/onedrive-auth/private-mail-policy.js');
const day='2026-11-04',at=day+'T01:00:00Z',id='71000000-0000-4000-8000-000000000001',newId='71000000-0000-4000-8000-000000000002';
const output=value=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
for(const [name,suffix,mode] of [['가상식자재','상온','complete'],['가상마트물류','상온 1톤','complete'],['가상식자재','상온','ambiguous'],['가상식자재','상온','otherday'],['가상식자재','상온','empty'],['가상식자재','상온','omitted_date'],['가상식자재','상온','wrong_origin']]){
 const source='11/4 '+name+' '+suffix+' 배차 요청\n가상공장 상차 08:00';
 const items=normalizeManualItems({items:[{kind:'dispatch',text:name+' '+suffix+' 배차',evidence:source,serviceOriginal:'11/4',assignee:null,dueOriginal:null,needsConfirmation:false}]},{text:source,entryId:id,submittedAt:at,referenceDate:day});
 const current={id:target.mailbox_id,owner_id:target.owner_id,enabled:true,manual_entries:{[id]:{entryId:id,text:source,status:'ready',submittedAt:at,referenceDate:day,items}},briefing_overrides:{}};
 const text=(['otherday','omitted_date'].includes(mode)?'11/05 (목)':'11/04 (수)')+'\n'+(mode==='wrong_origin'?'다른공장':'가상공장')+'(08:00상)~'+name+'\n12가3456 가상인 010-0000-0000';
 assert.equal(resolveDispatchAssignment(text,current.manual_entries,day,at).items[0].workRef,null);
 const order=[];let saved;
 const ctx={json:Response.json,fail:m=>Error(m),verifiedUpdatesEnabled:true,resolveAiConfiguration:async()=>({aiKey:'MOCK',aiProvider:'openai',aiModel:'gpt-6-luna'}),resolveJevConfiguration:async()=>({enabled:true,approvedSourceIds:[newId],key:'MOCK',fetcher:async(_,o)=>{order.push('jev');const p=JSON.parse(o.body);return Response.json({model:'jev-1.14.0',answers:Object.fromEntries(Object.keys(p.questions).map(k=>[k,{type:'noul',noul:.8}]))});}}),fetcher:async(_,o)=>{
 const p=JSON.parse(o.body),prompt=p.input[0].content[0].text;order.push(prompt.startsWith('카톡')?'extract':prompt.startsWith('새 입력')?'match':'verify');
 if(prompt.startsWith('카톡')){assert.ok(prompt.includes('jevIntent'));if(mode==='empty')return output({items:[],authoredDate:null,inputKind:'business'});return output({items:[{kind:'dispatch',text:name+' 배차 회신',evidence:text,serviceOriginal:mode==='omitted_date'?null:mode==='otherday'?'11/05':'11/04',dueOriginal:null,assignee:null,needsConfirmation:false,requestEvidence:null,resultEvidence:null}],authoredDate:null,inputKind:'business'});}
 if(prompt.startsWith('새 입력'))return output({matches:[{itemIndex:0,workId:mode==='ambiguous'?null:items[0].ref,relation:mode==='ambiguous'?'ambiguous':'followup',linkageEvidence:text,actor:'not_needed',actorEvidence:null,promiseEvidence:null}]});
 if(prompt.startsWith('자동 제안된 기존 업무'))return output({matchesTarget:mode!=='otherday',action:'complete',text:name+' 배차',evidence:text,completionEvidence:text,details:[],serviceOriginal:mode==='omitted_date'?null:'11/04',dueOriginal:null,nextActionEvidence:null,completedSteps:[],remainingSteps:[]});
 throw Error('Unexpected model');},db:async(path,o)=>{
 if(path.startsWith('private_mailboxes?'))return [current];if(path.startsWith('private_mail_messages?'))return [];
 if(path.endsWith('_claim'))return {claimed:true,entry:{entryId:newId,text,textHash:o.body.p_hash,status:'processing',submittedAt:at,referenceDate:day}};
 if(path.endsWith('_finish'))return saved={entryId:newId,text,status:'ready',submittedAt:at,referenceDate:day,items:o.body.p_items};
 if(path.endsWith('_jev_review'))return null;
 throw Error('Unexpected DB '+path);
 }};
 const result=await(await handleManualMessage('private-mail-manual-add',{text,clientRequestId:newId},{id:target.owner_id},ctx)).json();assert.equal(result.status,'ready');assert.equal(order[0],'jev');assert.ok(order.includes('match'));
 if(mode==='complete'||mode==='empty'){assert.equal(saved.items[0].workRef,items[0].ref);assert.equal(saved.items[0].workflowStatus,'complete');}else {assert.equal(saved.items[0].workRef,undefined);assert.equal(saved.items[0].needsConfirmation,true);}
 console.log('PASS synthetic',suffix,mode,order.join(' -> '));
}

 });
}

{
 const {test}=await import('node:test');
 test('photo Jev provenance and reference-only actor cannot authorize completion',async()=>{
const {Image}=await import('imagescript');
const {createHash}=await import('node:crypto');
const {analyzeManualPhotos}=await import('../supabase/functions/onedrive-auth/private-mail-manual-images.js');
const entry={entryId:'a1000000-0000-4000-8000-000000000001',text:'첨부한 두 사진의 검증코드를 이 테스트 기록에 포함해 주세요.',referenceDate:'2026-11-04',submittedAt:'2026-11-04T03:00:00Z'};
const images=[];for(let i=0;i<2;i++){const bytes=await new Image(2,2).fill(i?0xff0000ff:0x00ff00ff).encode();images.push({id:entry.entryId+':'+i,name:i+'.png',bytes,mediaType:'image/png',width:2,height:2,contentHash:createHash('sha256').update(bytes).digest('hex')});}
const facts=images.map((im,i)=>({imageId:im.id,text:'검증코드: '+['ALPHA-4729','BETA-5831'][i],confidence:'readable'})),ref=entry.entryId+':manual:item-001';
const output=value=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
for(const mode of ['reference','ambiguous','forged_completion']){
 const order=[];
 const result=await analyzeManualPhotos({entry,images,candidates:[{workId:ref,kind:'reference',title:entry.text}],startIndex:1,ai:{aiKey:'MOCK',aiProvider:'openai',aiModel:'gpt-6-luna'},jevConfig:{enabled:true,approvedSourceIds:[entry.entryId],key:'MOCK',fetcher:async(_,o)=>{order.push('jev');const p=JSON.parse(o.body);assert.ok(p.state.source.includes(images[0].id));assert.ok(p.state.source.includes('ALPHA-4729'));assert.ok(!JSON.stringify(p).includes('data:image'));return Response.json({model:'jev-1.14.0',answers:Object.fromEntries(Object.keys(p.questions).map(k=>[k,{type:'noul',noul:.9}]))});}},fetcher:async(_,o)=>{const p=JSON.parse(o.body),prompt=p.input[0].content[0].text;if(prompt.startsWith('독립')){order.push('verify');assert.ok(prompt.includes('jevIntent'));return output({accepted:true,sameTarget:mode!=='ambiguous',actor:'not_needed',currentResult:true,allObligationsComplete:true,requestConfirmed:true,completedSteps:[],remainingSteps:[]});}order.push('extract');return output({facts,items:facts.map((f,i)=>({imageId:f.imageId,text:'사진 '+(i+1)+' 검증코드 참고',evidence:f.text,kind:'reference',workRef:ref,action:mode==='forged_completion'?'complete':'reference',requestEvidence:null,completionEvidence:mode==='forged_completion'?f.text:null}))});}});
 assert.deepEqual(order,['extract','jev','verify','verify']);assert.equal(result.items.length,2);assert.notEqual(result.items[0].imageId,result.items[1].imageId);
 if(mode==='reference'){assert.ok(result.items.every(i=>i.workRef===ref&&i.kind==='reference'&&!i.needsConfirmation));assert.ok(result.items.every(i=>i.remainingSteps.length===0));}else assert.ok(result.items.every(i=>!i.workRef&&i.needsConfirmation));
 assert.ok(result.items.every(i=>i.workflowStatus!=='complete'));assert.notEqual(result.items[0].text,result.items[1].text);assert.equal(entry.text.includes('ALPHA'),false);console.log('PASS photo',mode,'two source hashes preserved, no title merge, no forged completion',order.join(' -> '));
}

 });
}

{const {test}=await import('node:test');test('manual candidate identity context stays separate from completion evidence',async()=>{
const {buildManualWorkCandidates,normalizeManualItems}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const entryId='a8000000-0000-4000-8000-000000000001',at='2026-11-04T03:00:00Z',text='가상업체 청록Q8 / 업무일 2026-12-18. 보고서를 작성하고 내부 검토자에게 전달해 주세요.',evidence='보고서를 작성하고 내부 검토자에게 전달해 주세요.';
const items=normalizeManualItems({items:[{kind:'task',text:'보고서 작성 및 전달',evidence,needsConfirmation:false}]},{text,entryId,submittedAt:at,referenceDate:'2026-11-04'});
const current={id:'39045005-313e-42e1-b50c-2394b3b6ff26',owner_id:'2a828c2d-9a6f-40d4-8e13-336b591811cc',manual_entries:{[entryId]:{entryId,text,status:'ready',submittedAt:at,items}},briefing_overrides:{}};
const [c]=await buildManualWorkCandidates({current,ownerId:current.owner_id,day:'2026-11-04',db:async()=>[]});assert.ok(c.sourceContext?.includes('청록Q8'));assert.equal(c.verificationScope.evidence,evidence);console.log('PASS header retained as context, never substituted for item completion evidence');

});}

{const {test}=await import('node:test');test('empty manual extraction with business signals keeps confirmation reference',async()=>{
const {handleManualMessage}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',box='39045005-313e-42e1-b50c-2394b3b6ff26',id='a8000000-0000-4000-8000-000000000002',text='가상 업체 보고서를 작성하고 전달해 주세요.';let saved;
const result=await(await handleManualMessage('private-mail-manual-add',{clientRequestId:id,text},{id:owner},{json:Response.json,fail:x=>Error(x),verifiedUpdatesEnabled:true,aiKey:'MOCK',resolveJevConfiguration:async()=>({enabled:true,approvedSourceIds:[id],key:'MOCK',fetcher:async(_,o)=>{const p=JSON.parse(o.body);return Response.json({model:'jev-1.14.0',answers:Object.fromEntries(Object.keys(p.questions).map(k=>[k,{type:'noul',noul:.9}]))});}}),fetcher:async()=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({items:[],authoredDate:null,inputKind:'business'})}]}]}),db:async(path,o)=>{if(path.startsWith('private_mailboxes?'))return[{id:box,owner_id:owner,enabled:true,manual_entries:{}}];if(path.startsWith('private_mail_messages?'))return[];if(path.endsWith('_claim'))return{claimed:true,entry:{entryId:id,text,status:'processing',textHash:o.body.p_hash,submittedAt:'2026-11-04T03:00:00Z',referenceDate:'2026-11-04'}};if(path.endsWith('_finish'))return saved={entryId:id,text,status:'ready',submittedAt:'2026-11-04T03:00:00Z',items:o.body.p_items};if(path.endsWith('_jev_review'))return null;throw Error(path);}})).json();assert.equal(result.status,'ready');assert.equal(saved.items.length,1);assert.equal(saved.items[0].kind,'reference');assert.equal(saved.items[0].needsConfirmation,true);assert.equal(saved.items[0].evidence,text);assert.notEqual(saved.items[0].workflowStatus,'complete');console.log('PASS empty extraction with Jev business signal retains confirmation reference, not invented executable/completed task');

});}

{const {test}=await import('node:test');test('manual extraction repairs exact item-local metadata once before linking',async()=>{
const m=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
assert.equal(typeof m.analyzeManualExtraction,'function');
const text='가상거래처 가상은빛상사R9, 업무일 2026-12-23. 모의검수표를 작성하고 내부 검토자에게 전달해 주세요.',evidence='모의검수표를 작성하고 내부 검토자에게 전달해 주세요.';
const item={kind:'task',text:'검수표 작성과 전달',evidence,serviceOriginal:'2026-12-23',dueOriginal:null,assignee:null,needsConfirmation:false};
const output=value=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
let n=0;const response=await m.analyzeManualExtraction({entry:{text},schema:m.MANUAL_MESSAGE_SCHEMA,schemaName:'private_manual_message',key:'MOCK',provider:'openai',model:'gpt-6-luna',prompt:'카톡 합성 검증',fetcher:async(_,o)=>{n++;if(n===2)assert.ok(o.body.includes('serviceOriginal'));return output({items:[{...item,evidence:n===1?evidence:text}],authoredDate:null,inputKind:'business'});},maxTokens:5000});assert.equal(n,2);assert.equal(response.evidenceRepairResponses.length,1);
n=0;await assert.rejects(()=>m.analyzeManualExtraction({entry:{text},schema:m.MANUAL_MESSAGE_SCHEMA,schemaName:'private_manual_message',key:'MOCK',provider:'openai',model:'gpt-6-luna',prompt:'카톡 합성 검증',fetcher:async()=>{n++;return output({items:[item],authoredDate:null,inputKind:'business'});},maxTokens:5000}),e=>e.message==='MANUAL_EVIDENCE'&&e.targetField==='serviceOriginal');assert.equal(n,2);console.log('PASS date outside item quote repaired once; persistent bad evidence rejects with exact field; no changed source or relaxed scope');

n=0;await assert.rejects(()=>m.analyzeManualExtraction({entry:{text},schema:m.MANUAL_MESSAGE_SCHEMA,schemaName:'private_manual_message',key:'MOCK',provider:'openai',model:'gpt-6-luna',prompt:'카톡 합성 검증',fetcher:async()=>output({items:++n===1?[item]:[],authoredDate:null,inputKind:'business'}),maxTokens:5000}),e=>e.message==='MANUAL_EVIDENCE'&&e.targetField==='items');assert.equal(n,2);console.log('PASS repair cannot erase an extracted obligation');

});}

{const {test}=await import('node:test');test('verified same-work partial results retain identity without assuming executor or reopening closed work',async()=>{
const {linkExistingManualItems}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const ref='a1000000-0000-4000-8000-000000000001:manual:item-001',text='가상보라상사S10 모의검수표 작성은 완료했습니다. 내부 검토자 전달은 아직 미완료이며 전달만 남았습니다.',done='모의검수표 작성은 완료했습니다.',remaining='내부 검토자 전달은 아직 미완료이며 전달만 남았습니다.';
const target={workId:ref,kind:'task',title:'모의검수표 작성 및 전달',serviceDate:null,originalRequest:{title:'검수표 작성 및 전달',evidence:'모의검수표를 작성하고 내부 검토자에게 전달해 주세요.'}};
const output=value=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
async function run(actor='unknown',action='progress',matchesTarget=true){let calls=0;const value=await linkExistingManualItems({value:{items:[{kind:'task',text:target.title,evidence:text,needsConfirmation:false}]},entry:{entryId:'synthetic-s10',text,referenceDate:'2026-11-04',submittedAt:'2026-11-04T03:00:00Z'},work:[target],ai:{aiKey:'MOCK',aiProvider:'openai',aiModel:'gpt-6-luna'},isolatedVerification:true,fetcher:async()=>output(++calls===1?{matches:[{itemIndex:0,workId:ref,relation:'followup',actor,linkageEvidence:'가상보라상사S10 모의검수표',actorEvidence:null,promiseEvidence:null}]}:{matchesTarget,action,text:'내부 검토자 전달',evidence:text,details:[],completionEvidence:action==='complete'?done:null,serviceOriginal:null,dueOriginal:null,nextActionEvidence:remaining,completedSteps:[done],remainingSteps:action==='complete'?[]:[remaining]})});return{item:value.reply.items[0],calls};}
let r=await run();assert.equal(r.calls,2);assert.equal(r.item.workRef,ref);assert.equal(r.item.workflowStatus,'in_progress');assert.equal(r.item.completedSteps[0].text,done);assert.equal(r.item.remainingSteps[0].text,remaining);assert.equal(r.item.needsConfirmation,false);
r=await run('unknown','complete');assert.equal(r.item.workRef,ref);assert.notEqual(r.item.workflowStatus,'complete');assert.equal(r.item.needsConfirmation,true);
r=await run('unknown','progress',false);assert.equal(r.item.workRef,undefined);assert.equal(r.item.needsConfirmation,true);
r=await run('not_needed');assert.equal(r.item.workRef,ref);assert.equal(r.item.workflowStatus,'in_progress');console.log('PASS actual S10 matcher followup/unknown reaches independent verification; partial steps remain one work; unknown cannot auto-complete; target conflict rejects');
const {normalizeManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');const {dailyWorkItems}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const oldId=ref.slice(0,36),newId='a1000000-0000-4000-8000-000000000002',at='2026-11-04T03:00:00Z',day='2026-11-04';const originalText=target.originalRequest.evidence;
const originals=normalizeManualItems({items:[{kind:'task',text:target.title,evidence:originalText,needsConfirmation:false}]},{text:originalText,entryId:oldId,submittedAt:'2026-11-04T01:00:00Z',referenceDate:day});
const partial=(await run()).item;const normalized=normalizeManualItems({items:[partial]},{text,entryId:newId,submittedAt:at,referenceDate:day,allowLinks:true,verifiedReplyRef:ref,replyDetailsByItem:[partial.details??[]]});
const entries={[oldId]:{entryId:oldId,status:'ready',text:originalText,submittedAt:'2026-11-04T01:00:00Z',referenceDate:day,items:originals},[newId]:{entryId:newId,status:'ready',text,submittedAt:at,referenceDate:day,items:normalized}};
const work=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(entries,day));assert.equal(work.length,1);assert.equal(work[0].workId,ref);assert.equal(work[0].status,'in_progress');assert.ok(JSON.stringify(work).includes(done));assert.ok(JSON.stringify(work).includes(remaining));console.log('PASS full normalize -> daily projection: one original work in progress with both verified steps');
for(const status of ['complete','cancelled'])for(const actor of ['unknown','not_needed']){target.status=status;const closed=(await run(actor)).item;assert.equal(closed.workRef,ref);assert.equal(closed.kind,'reference');assert.equal(closed.needsConfirmation,true);assert.equal(closed.stateDeclared,false);}delete target.status;console.log('PASS unknown/not-needed followups of closed targets only attach history and cannot reopen');
for(const status of ['complete','cancelled']){target.status=status;const history=(await run()).item;const historyItems=normalizeManualItems({items:[history]},{text,entryId:newId,submittedAt:at,referenceDate:day,allowLinks:true,verifiedReplyRef:ref,replyDetailsByItem:[history.details??[]]});const closedEntries={...entries,[oldId]:{...entries[oldId],items:originals.map(i=>({...i,workflowStatus:status,declaredAt:'2026-11-04T01:00:00Z'}))},[newId]:{...entries[newId],items:historyItems}};const projected=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(closedEntries,day));assert.equal(projected.find(i=>i.workId===ref).status,status);}delete target.status;console.log('PASS closed state preserved through real normalization and daily work merge');

});}

{const {test}=await import('node:test');test('duplicate manual titles require unique source-grounded automatic identity',async()=>{

const {linkExistingManualItems}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const title='전용 모의검수표 작성 및 가상 내부 검토자에게 전달';
const target={workId:'5f36badb-070a-4791-bd01-9487dd043160:manual:item-001',title,kind:'task',status:'pending',serviceDate:null,sourceContext:'가상거래처 가상호박상사T11, 업무일 2026-12-26. TEST-PR138-EGO-T11 전용 모의검수표를 작성하고 가상 내부 검토자에게 전달해 주세요.',originalRequest:{title,evidence:'TEST-PR138-EGO-T11 전용 모의검수표를 작성하고 가상 내부 검토자에게 전달해 주세요.'}};
const other={...target,workId:'14839b71-a7dc-41c1-9c03-fc522107ceb0:manual:item-001',sourceContext:'가상거래처 가상보라상사S10, 업무일 2026-12-24. TEST-PR137-EGO-S10 전용 모의검수표를 작성하고 가상 내부 검토자에게 전달해 주세요.',originalRequest:{title,evidence:'TEST-PR137-EGO-S10 전용 모의검수표를 작성하고 가상 내부 검토자에게 전달해 주세요.'}};
const text='가상거래처 가상호박상사T11, 업무일 2026-12-26의 TEST-PR138-EGO-T11 전용 모의검수표 작성 및 가상 내부 검토자 전달 건입니다. 모의검수표 작성은 완료했습니다. 가상 내부 검토자에게 전달은 아직 미완료이며, 전달만 남아 있습니다.';
const output=x=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(x)}]}]});
async function run(work,mode="valid",actor="not_needed"){let calls=0;const result=await linkExistingManualItems({entry:{entryId:'T11-readonly-reproduction',text,referenceDate:'2026-11-04',submittedAt:'2026-11-04T04:01:20Z'},value:{items:[{kind:'task',text:title,evidence:mode==='cross_item'?'모의검수표 작성은 완료했습니다.':text,serviceOriginal:'2026-12-26',details:[]}]},work,isolatedVerification:true,ai:{aiKey:'MOCK',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async(_,o)=>{calls++;const prompt=JSON.parse(o.body).input[0].content[0].text;const schema=prompt.startsWith('새 입력과')?'private_existing_work_match':prompt.startsWith('자동 연결 후보')?'private_manual_identity_check':'private_target_update';if(schema==='private_existing_work_match')return output({matches:[{itemIndex:0,relation:'followup',actor,workId:target.workId,linkageEvidence:mode==='cross_item'?'모의검수표 작성은 완료했습니다.':'가상거래처 가상호박상사T11, 업무일 2026-12-26',actorEvidence:null,promiseEvidence:null}]});if(schema==='private_manual_identity_check')return output({uniqueWorkId:target.workId,conflict:mode==='conflict',anchors:[{kind:'customer',quote:mode==='forged'?'없는거래처':mode==='shared'?'가상 내부 검토자': '가상호박상사T11'}]});return output({matchesTarget:mode!=='target_conflict',action:'progress',text:'가상 내부 검토자에게 전달',evidence:text,details:[],completionEvidence:null,serviceOriginal:'2026-12-26',dueOriginal:null,nextActionEvidence:'가상 내부 검토자에게 전달은 아직 미완료이며, 전달만 남아 있습니다.',completedSteps:['모의검수표 작성은 완료했습니다.'],remainingSteps:['가상 내부 검토자에게 전달은 아직 미완료이며, 전달만 남아 있습니다.']});}});return{calls,item:result.reply.items[0]};}
const duplicate=await run([target,other]);assert.equal(duplicate.calls,3);assert.equal(duplicate.item.workRef,target.workId);assert.equal(duplicate.item.workflowStatus,'in_progress');
for(const mode of ['conflict','forged','shared','target_conflict','cross_item']){const r=await run([target,other],mode);assert.equal(r.item.workRef,undefined,mode);assert.equal(r.item.needsConfirmation,true,mode);}
target.serviceDate='2026-12-25';const wrongDate=await run([target,other]);assert.equal(wrongDate.item.workRef,undefined);assert.equal(wrongDate.calls,1);target.serviceDate=null;
const ambiguous=await run([target,{...other,sourceContext:target.sourceContext,originalRequest:target.originalRequest}]);assert.equal(ambiguous.item.workRef,undefined);
const differentTitle=await run([target,other,{...target,workId:'a1000000-0000-4000-8000-000000000009:manual:item-001',title:'다른 제목'}]);assert.equal(differentTitle.item.workRef,undefined);
const external=await run([target,other],'valid','external');assert.equal(external.item.workRef,undefined); // absent actor/promise evidence
for(const status of ['complete','cancelled']){target.status=status;const r=await run([target,other]);assert.equal(r.item.kind,'reference');assert.equal(r.item.workRef,target.workId);}target.status='pending';
const unique=await run([target]);assert.equal(unique.calls,2);assert.equal(unique.item.workRef,target.workId);
console.log('PASS duplicate titles/source-unique anchors link partial; conflict/forged/shared/ambiguous/third-party missing evidence reject; closed targets stay references; unique target retains existing flow. MOCK MODEL ONLY');

});}

{const {test}=await import('node:test');test('inline result verification cannot bypass existing work identity',async()=>{

const {verifyInlineManualResults,linkExistingManualItems,normalizeManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const {dailyWorkItems}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const id='a9000000-0000-4000-8000-000000000001',next='a9000000-0000-4000-8000-000000000002',ref=id+':manual:item-001',day='2026-11-04',request='가상남빛상사U12 검수표 작성 및 전달 건입니다.',result='검수표 작성과 전달 모두 완료했습니다.',text=request+' '+result;
const entry={entryId:next,text,referenceDate:day,submittedAt:day+'T04:00:00Z'},ai={aiKey:'MOCK',aiProvider:'openai',aiModel:'gpt-6-luna'},raw={kind:'task',text:'검수표 작성 및 전달',evidence:text,requestEvidence:request,resultEvidence:result,needsConfirmation:false};
const target={workId:ref,title:'검수표 전달',kind:'task',status:'in_progress',originalScopeComplete:true,originalRequest:{title:'검수표 작성 및 전달',evidence:request},verificationScope:{title:'검수표 작성 및 전달',evidence:request}};
const output=x=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(x)}]}]});
async function run(mode='followup'){const calls=[];const fetcher=async(_,o)=>{const prompt=JSON.parse(o.body).input[0].content[0].text;if(prompt.startsWith('새 입력')){calls.push('match');if(mode==='network')throw Error('synthetic failure');return output({matches:[{itemIndex:0,relation:mode==='new'?'new':mode==='ambiguous'?'ambiguous':'followup',actor:mode==='unknown'?'unknown':mode==='not_needed'?'not_needed':'owner',workId:['new','ambiguous'].includes(mode)?null:ref,linkageEvidence:request,actorEvidence:null,promiseEvidence:null}]});}const inline=prompt.includes('"mode":"same_input_request_result"');calls.push(inline?'inline':'target');return output({matchesTarget:mode!=='conflict'||inline,action:'complete',text:raw.text,evidence:text,details:[],completionEvidence:result,serviceOriginal:null,dueOriginal:null,nextActionEvidence:null,completedSteps:[result],remainingSteps:[]});};const inline=await verifyInlineManualResults({value:{items:[raw]},entry,ai,fetcher});assert.equal(inline.value.items[0].workflowStatus,'complete');const linked=await linkExistingManualItems({value:inline.value,entry,work:[target],ai,fetcher,isolatedVerification:true});return{item:linked?.reply.items[0],calls};}
const linked=await run();assert.deepEqual(linked.calls,['inline','match','target']);assert.equal(linked.item.workRef,ref);assert.equal(linked.item.workflowStatus,'complete');
for(const mode of ['ambiguous','conflict','network','unknown']){const r=await run(mode);assert.ok(r.calls.includes('match'));assert.notEqual(r.item.workflowStatus,'complete',mode);assert.equal(r.item.needsConfirmation,true,mode);}
const noActorNeeded=await run('not_needed');assert.equal(noActorNeeded.item.workRef,ref);assert.equal(noActorNeeded.item.workflowStatus,'complete');
const fresh=await run('new');assert.deepEqual(fresh.calls,['inline','match']);assert.equal(fresh.item.workRef,undefined);assert.equal(fresh.item.workflowStatus,'complete');
const old=normalizeManualItems({items:[{kind:'task',text:raw.text,evidence:request,needsConfirmation:false}]},{text:request,entryId:id,referenceDate:day,submittedAt:day+'T01:00:00Z'});
const updates=normalizeManualItems({items:[linked.item]},{text,entryId:next,referenceDate:day,submittedAt:entry.submittedAt,allowLinks:true,verifiedInlineResults:true,verifiedReplyRef:ref,replyDetailsByItem:[linked.item.details]});
const entries={[id]:{entryId:id,status:'ready',text:request,submittedAt:day+'T01:00:00Z',referenceDate:day,items:old},[next]:{...entry,status:'ready',items:updates}};
const work=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(entries,day));assert.equal(work.length,1);assert.equal(work[0].workId,ref);assert.equal(work[0].status,'complete');
console.log('PASS inline request/result -> existing match -> independent original-scope verification -> one completed original work; ambiguous/conflict/network/unknown cannot retain standalone completion; genuinely new inline completion preserved. MOCK MODEL ONLY');

});}

{const {test}=await import('node:test');test('manual failure diagnostics expose stages and fields without source text',async()=>{

const {linkExistingManualItems}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const text='가상V13 검수표 전달까지 완료했습니다.',ref='aa000000-0000-4000-8000-000000000001:manual:item-001';
const output=x=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(x)}]}]});
for(const field of ['linkageEvidence','completionEvidence','completedSteps','remainingSteps','valid']){
 const logs=[],info=console.info;let calls=0;let result;
 try{console.info=(name,payload)=>{if(name==='PRIVATE_MANUAL_LINK_DECISION')logs.push(JSON.parse(payload));};
 result=await linkExistingManualItems({entry:{entryId:'v13-diagnostic-test',text,referenceDate:'2026-11-04',submittedAt:'2026-11-04T04:00:00Z'},value:{items:[{kind:'task',text:'검수표 전달',evidence:text}]},work:[{workId:ref,title:'검수표 전달',kind:'task',status:'in_progress'}],isolatedVerification:true,ai:{aiKey:'MOCK',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async()=>output(++calls===1?{matches:[{itemIndex:0,workId:ref,relation:'followup',actor:'not_needed',linkageEvidence:field==='linkageEvidence'?'원문에 없는 문구':text,actorEvidence:null,promiseEvidence:null}]}:{matchesTarget:true,action:'complete',text:'검수표 전달',evidence:text,details:[],completionEvidence:field==='completionEvidence'?'원문에 없는 문구':text,serviceOriginal:null,dueOriginal:null,nextActionEvidence:null,completedSteps:field==='completedSteps'?['원문에 없는 문구']:[text],remainingSteps:field==='remainingSteps'?['원문에 없는 문구']:[]})});
 }finally{console.info=info;}
 if(field==='valid'){assert.equal(result.reply.items[0].workRef,ref);assert.equal(result.reply.items[0].workflowStatus,'complete');assert.deepEqual(logs.map(x=>x.reason),['match','target_started','target_verified','linked']);}
 else{const failure=logs.find(x=>x.reason==='MANUAL_EVIDENCE');assert.equal(failure.field,field);assert.equal(failure.stage,field==='linkageEvidence'?'linkage':'target');assert.equal(result.reply.items[0].workRef,undefined);assert.equal(result.reply.items[0].needsConfirmation,true);assert.equal(calls,field==='linkageEvidence'?1:['completedSteps','remainingSteps'].includes(field)?3:2);}
 assert.equal(JSON.stringify(logs).includes(text),false);assert.equal(JSON.stringify(logs).includes('원문에 없는 문구'),false);
}
console.log('PASS exact stage/field logs distinguish linkage vs target completion/step quote failures; source/model text never logged; rejection and valid completion unchanged');

});}

{const {test}=await import('node:test');test('current summary retires superseded actions while source history stays immutable',async()=>{

const {normalizeManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const {dailyWorkItems,workSummaryForDisplay,renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const id='ab000000-0000-4000-8000-000000000001',pid='ab000000-0000-4000-8000-000000000002',cid='ab000000-0000-4000-8000-000000000003',ref=id+':manual:item-001',day='2026-11-04',request='가상W14 검수표를 작성하고 내부 검토자에게 전달해 주세요.',done='모의검수표 작성은 완료했습니다.',pending='가상 내부 검토자에게 전달은 아직 미완료이며, 전달만 남아 있습니다.',partial=done+' '+pending,complete='모의검수표 작성과 전달 모두 완료되어 남은 할 일은 없습니다.';
function entry(id,text,raw,hour){const at=day+'T'+hour+':00:00Z',items=normalizeManualItems({items:[raw]},{text,entryId:id,referenceDate:day,submittedAt:at,allowLinks:!!raw.workRef,verifiedReplyRef:raw.workRef??null,replyDetailsByItem:[raw.details??[]]});return{entryId:id,text,status:'ready',referenceDate:day,submittedAt:at,items};}
const entries={[id]:entry(id,request,{kind:'task',text:'검수표 작성 및 전달',evidence:request,needsConfirmation:false},'01'),[pid]:entry(pid,partial,{kind:'task',text:'검수표 전달',evidence:partial,details:[done,pending],nextAction:pending,completedSteps:[{text:done,evidenceSource:'text'}],remainingSteps:[{text:pending,evidenceSource:'text'}],workflowStatus:'in_progress',workRef:ref,needsConfirmation:false},'02')};
const view=()=>dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(entries,day))[0];
assert.ok(view().summary.includes(pending));const before=JSON.stringify(entries);
entries[cid]=entry(cid,complete,{kind:'task',text:'검수표 작성 및 전달 완료',evidence:complete,details:[],completedSteps:[{text:complete,evidenceSource:'text'}],remainingSteps:[],workflowStatus:'complete',workRef:ref,needsConfirmation:false},'03');
const result=view();assert.equal(result.status,'complete');assert.equal(result.nextAction,null);assert.equal(result.summary.includes(pending),false);assert.equal(workSummaryForDisplay(result).includes(pending),false);assert.ok(result.sourceRefs.some(source=>source.evidence?.includes(pending)));assert.equal(JSON.stringify({...entries,[cid]:undefined}),before);assert.ok(result.summary.includes(done));
console.log('PASS complete current summary excludes superseded next action; verified completed fact and immutable source evidence/history preserved; shared UI/OneNote display clean');
assert.equal(renderBriefingWorkNote([result]).includes(pending),false);
const finished=entries[cid];
entries[cid]=entry(cid,'관련 자료 참고입니다.',{kind:'reference',text:'관련 자료 참고',evidence:'관련 자료 참고입니다.',details:['관련 자료 참고입니다.'],workRef:ref,needsConfirmation:false},'03');
assert.equal(view().status,'in_progress');assert.equal(view().nextAction,pending);assert.ok(view().summary.includes(pending));
const newer='수정본 검토 및 전달만 남아 있습니다.';
entries[cid]=entry(cid,newer,{kind:'task',text:'수정본 전달',evidence:newer,details:[newer],nextAction:newer,workflowStatus:'in_progress',workRef:ref,needsConfirmation:false},'03');
assert.equal(view().nextAction,newer);assert.ok(!view().summary.includes(pending));assert.ok(view().summary.includes(newer));
entries[cid]=entry(cid,'해당 업무는 취소했습니다.',{kind:'task',text:'검수표 전달 취소',evidence:'해당 업무는 취소했습니다.',workflowStatus:'cancelled',stateDeclared:true,workRef:ref,needsConfirmation:false},'03');
assert.equal(view().status,'cancelled');assert.equal(view().nextAction,null);assert.ok(!view().summary.includes(pending));
entries[cid]=finished;
console.log('PASS shared OneNote summary clean; references preserve ongoing action; replacement actions supersede only exact old action; cancellation clears action without erasing history');

});}

{const {test}=await import('node:test');test('manual step evidence IDs preserve exact source and bounded repair semantics',async()=>{

const {analyzeTargetedManual}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const done='모의검수표 작성과 전달 모두 완료되어 남은 할 일은 없습니다.',text='가상X15 모의검수표 작성 및 전달 건입니다. 남아 있던 검토자에게 전달까지 완료했습니다. '+done;
const entry={entryId:'x15-contract',text,focusEvidence:text,referenceDate:'2026-11-04',submittedAt:'2026-11-04T04:00:00Z'},target={workId:'ac000000-0000-4000-8000-000000000001:manual:item-001',title:'검수표 작성 및 전달',kind:'task',status:'in_progress'},ai={aiKey:'MOCK',aiProvider:'openai',aiModel:'gpt-6-luna'};
const output=x=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(x)}]}]});
async function run(mode){let calls=0;const value=await analyzeTargetedManual({entry,target,ai,isolatedVerification:true,fetcher:async(_,o)=>{calls++;const prompt=JSON.parse(o.body).input[0].content[0].text,p=JSON.parse(prompt.split('\n').find(l=>l.startsWith('{"selectedTarget"')));const id=(p.stepEvidence??[{id:0,text:done}]).find(x=>x.text===done).id;const bad=['원문과 다른 완료 요약'];return output({matchesTarget:true,action:'complete',text:target.title,evidence:text,details:[],completionEvidence:mode==='changed_evidence'&&calls===2?'전달까지 완료했습니다.':done,serviceOriginal:null,dueOriginal:null,nextActionEvidence:null,completedSteps:mode==='direct'?[id]:mode==='legacy'?[done]:calls===1?bad:mode==='persistent'?bad:[id],remainingSteps:mode==='drop_remaining'&&calls===1?bad:[]});}});return{value,calls};}
for(const mode of ['repair','direct','legacy']){const r=await run(mode);assert.equal(r.calls,mode==='repair'?2:1);assert.equal(r.value.reply.items[0].workflowStatus,'complete');assert.equal(r.value.reply.items[0].completedSteps[0].text,done);assert.equal(r.value.reply.items[0].workRef,target.workId);if(mode==='repair')assert.equal(r.value.response.evidenceRepairResponses.length,1);}
for(const mode of ['changed_evidence','drop_remaining','persistent'])await assert.rejects(()=>run(mode),e=>e.message==='MANUAL_EVIDENCE'&&e.targetField==='completedSteps');
for(const invalid of [-1,999,0.5,null,true])await assert.rejects(()=>analyzeTargetedManual({entry,target,ai,isolatedVerification:true,fetcher:async()=>output({matchesTarget:true,action:'complete',text:target.title,evidence:text,details:[],completionEvidence:done,serviceOriginal:null,dueOriginal:null,nextActionEvidence:null,completedSteps:[invalid],remainingSteps:[]})}));
for(const source of ['가'.repeat(499)+'😀'+'. '+done,Array.from({length:130},(_,i)=>'문장'+i+'.').join('\n')+'\n'+done+' 아직 전달 검토가 남았습니다.']){
 await analyzeTargetedManual({entry:{...entry,text:source,focusEvidence:undefined},target,ai,fetcher:async(_,o)=>{const p=JSON.parse(JSON.parse(o.body).input[0].content[0].text.split('\n').find(l=>l.startsWith('{"selectedTarget"')));assert.ok(p.stepEvidence.every(x=>x.text.length<=500&&x.text.isWellFormed()&&source.includes(x.text)));assert.ok(p.stepEvidence.some(x=>x.text.includes(done)));return output({matchesTarget:true,action:'progress',text:target.title,evidence:done,details:[],completionEvidence:null,serviceOriginal:null,dueOriginal:null,nextActionEvidence:null,completedSteps:[],remainingSteps:[]});}});
}
const mixed='모의검수표 작성은 완료했고 전달은 아직 미완료입니다.';
const mixedResult=await analyzeTargetedManual({entry:{...entry,text:mixed,focusEvidence:mixed},target,ai,isolatedVerification:true,fetcher:async()=>output({matchesTarget:true,action:'complete',text:target.title,evidence:mixed,details:[],completionEvidence:mixed,serviceOriginal:null,dueOriginal:null,nextActionEvidence:null,completedSteps:[0],remainingSteps:[0]})});assert.notEqual(mixedResult.reply.items[0].workflowStatus,'complete');assert.equal(mixedResult.reply.items[0].needsConfirmation,true);assert.equal(mixedResult.reply.items[0].remainingSteps[0].text,mixed);
assert.equal(entry.text,text);console.log('PASS source IDs restore exact text; strict legacy quotes; one bounded frozen-decision repair; no pending-step deletion; invalid IDs reject; surrogate-safe full-source chunk fallback; source unchanged. MOCK MODEL ONLY');

});}

{const {test}=await import('node:test');test('manual social filtering preserves mixed and uncertain work without report pollution',async()=>{

const {handleManualMessage,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const {dailyWorkItems,renderBriefingWorkNote}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',box='39045005-313e-42e1-b50c-2394b3b6ff26',id='ad000000-0000-4000-8000-000000000001',day='2026-11-04';
const output=x=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(x)}]}]});
async function run(text,inputKind,items=[],signals=['non_work'],failJev=false,targeted=false){const priorId='ad000000-0000-4000-8000-000000000002',targetWorkId=priorId+':manual:item-001';const priorItems=(await import('../supabase/functions/onedrive-auth/private-mail-manual.js')).normalizeManualItems({items:[{kind:'task',text:'검수표 작성',evidence:'검수표 작성 요청',needsConfirmation:false}]},{text:'검수표 작성 요청',entryId:priorId,submittedAt:day+'T01:00:00Z',referenceDate:day});const prior={entryId:priorId,text:'검수표 작성 요청',status:'ready',submittedAt:day+'T01:00:00Z',referenceDate:day,items:priorItems};let saved,queued=0,calls=0;const ctx={json:Response.json,fail:m=>Error(m),verifiedUpdatesEnabled:true,aiKey:'MOCK',aiProvider:'openai',aiModel:'gpt-6-luna',enqueueManualReport:async()=>{queued++;return true;},resolveJevConfiguration:async()=>({enabled:true,approvedSourceIds:[id],key:'MOCK',fetcher:async(_,o)=>{if(failJev)return Response.json({}, {status:503});const p=JSON.parse(o.body);return Response.json({model:'jev-1.14.0',answers:Object.fromEntries(Object.keys(p.questions).map(k=>[k,{type:'noul',noul:signals.includes(['new','update','completion','reference','cancel','mixed','context','waiting','non_work'][Number(k.slice(1))])?.95:.05}]))});}}),fetcher:async(_,o)=>{calls++;assert.ok(o.body.includes('inputKind'));return output({items,authoredDate:null,...(inputKind!==undefined?{inputKind}:{})});},db:async(path,o)=>{if(path.startsWith('private_mailboxes?'))return[{id:box,owner_id:owner,enabled:true,manual_entries:targeted?{[priorId]:prior}:{}}];if(path.startsWith('private_mail_messages?'))return[];if(path.endsWith('_claim'))return{claimed:true,entry:{entryId:id,...(targeted?{targetWorkId}:{}),text,status:'processing',textHash:o.body.p_hash,submittedAt:day+'T03:00:00Z',referenceDate:day}};if(path.endsWith('_finish'))return saved={entryId:id,text,status:'ready',submittedAt:day+'T03:00:00Z',referenceDate:day,items:o.body.p_items};if(path.endsWith('_fail'))return saved={entryId:id,text,status:'failed',errorCode:o.body.p_code,submittedAt:day+'T03:00:00Z',referenceDate:day,items:[]};if(path.endsWith('_jev_review'))return null;throw Error(path+' '+JSON.stringify(o?.body));}};const result=await(await handleManualMessage('private-mail-manual-add',{clientRequestId:id,text,...(targeted?{targetWorkId}:{} )},{id:owner},ctx)).json();if(inputKind===undefined){assert.equal(result.status,'failed');assert.equal(saved.text,text);assert.equal(saved.status,'failed');assert.equal(saved.items.length,0);assert.equal(queued,0);return{saved,result};}assert.equal(result.status,'ready');assert.equal(saved.text,text);const work=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView({[id]:saved},day));return{saved,result,queued,calls,work};}
for(const text of ['안녕하세요! 😊','감사합니다. 수고하세요.','ㅋㅋㅋ']){const r=await run(text,'business',[],['new','context']);assert.equal(r.calls,0);assert.equal(r.saved.items.length,0);assert.equal(r.queued,0);assert.equal(r.result.reportQueued,false);assert.equal(r.work.length,0);assert.equal(renderBriefingWorkNote(r.work).includes(text),false);}
const selectedGreeting=await run('안녕하세요!','business',[],['new'],false,true);assert.equal(selectedGreeting.calls,0);assert.equal(selectedGreeting.queued,0);assert.equal(selectedGreeting.work.length,0);
const chat=await run('오늘 점심은 뭐 먹을까?','non_work');assert.equal(chat.calls,1);assert.equal(chat.queued,0);assert.equal(chat.work.length,0);
const request='검수표를 작성해 주세요.',mixed='안녕하세요! '+request+' 감사합니다.';
const item={kind:'task',text:'검수표 작성',evidence:request,assignee:null,serviceOriginal:null,dueOriginal:null,needsConfirmation:false};
const business=await run(mixed,'mixed',[item],['new','non_work']);assert.equal(business.saved.items.length,1);assert.equal(business.saved.items[0].evidence,request);assert.equal(business.work.length,1);assert.equal(business.queued,1);assert.equal(business.work[0].summary.some(x=>x.includes('안녕하세요')),false);
for(const [kind,signals,fail] of [['uncertain',['context'],false],[null,[],true],['non_work',['update'],false]]){const r=await run('그 건은 어떻게 됐죠?',kind,[],signals,fail);assert.equal(r.saved.items.length,1);assert.equal(r.saved.items[0].needsConfirmation,true);assert.equal(r.saved.items[0].kind,'reference');}
await run('그 건은 어떻게 됐죠?',undefined,[],[],true);
const contradiction=await run(mixed,'non_work',[item],['non_work']);assert.equal(contradiction.saved.items.length,1);assert.equal(contradiction.saved.items[0].needsConfirmation,true);
console.log('PASS greetings/pure chat original retained but work/notes/report queue empty; mixed business preserved despite Jev contradiction; uncertain/unknown-kind/Jev failure preserved for confirmation; nonempty work never discarded. MOCK SERVICES ONLY');

});}

{const {test}=await import('node:test');test('manual processing status is read-only and never infers report completion',async()=>{
const {handleManualMessage,normalizeManualItems}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',box='39045005-313e-42e1-b50c-2394b3b6ff26',id='ae000000-0000-4000-8000-000000000001',day='2026-11-04';
const entry={entryId:id,text:'검수표 작성 요청',submittedAt:day+'T03:00:00Z',status:'ready',items:normalizeManualItems({items:[{kind:'task',text:'검수표 작성',evidence:'검수표 작성 요청',needsConfirmation:false}]},{text:'검수표 작성 요청',entryId:id,submittedAt:day+'T03:00:00Z',referenceDate:day})};
let writes=0;const ctx=(current)=>({json:Response.json,fail:(code)=>Error(code),db:async(path,options)=>{assert.ok(path.includes('briefing_pages'));if(options?.method){writes++;throw Error('WRITE_FORBIDDEN');}return[current];}});
for(const [status,report,expected] of [['pending',{},'waiting'],['processing',{},'waiting'],['failed',{},'waiting'],['ready',{},'pending'],['ready',{pageId:'page',dirty:true},'pending'],['ready',{pageId:'page',dirty:false,error:'PAGE_WRITE_UNCERTAIN'},'failed'],['ready',{pageId:'page',dirty:false,pendingWrite:{}},'pending'],['ready',{pageId:'page',dirty:false,mailRolloverPending:true},'pending'],['ready',{pageId:'page',dirty:false},'complete'],['ready',{pageId:'page',dirty:true,error:'ONEDRIVE_CONNECTION_BUSY'},'retrying'],['ready',{pageId:'page',dirty:true,error:'ONEDRIVE_CONNECTION_BUSY',hold:true},'failed'],['ready',{pageId:'page',dirty:true,error:'ONEDRIVE_CONNECTION_BUSY',ownerPreviewHold:true},'failed'],['ready',{pageId:'page',dirty:true,error:'PAGE_WRITE_UNCERTAIN'},'failed']]){
const current={id:box,owner_id:owner,enabled:true,manual_entries:{[id]:{...entry,status}},briefing_pages:{[day]:report}};
const result=await(await handleManualMessage('private-mail-manual-status',{entryId:id},{id:owner},ctx(current))).json();assert.equal(result.report.status,expected);assert.equal(result.entry.status,status);assert.equal(result.stagesAvailable,false);
}
for(const [attempts,nextAt,expected]of [[1,day+'T03:01:00Z',true],[2,day+'T03:02:00Z',true],[3,day+'T03:02:00Z',false],[1,null,false],[1,'invalid',false]]){
 const retryBox={id:box,owner_id:owner,enabled:true,manual_entries:{[id]:{...entry,status:'failed',attempts,nextAt,error:'MODEL_FAILED'}},briefing_pages:{}};
 const state=await(await handleManualMessage('private-mail-manual-status',{entryId:id},{id:owner},ctx(retryBox))).json();assert.equal(state.retryScheduled,expected);
}
const current={id:box,owner_id:owner,enabled:true,manual_entries:{[id]:{...entry,items:[]}},briefing_pages:{}};
assert.equal((await(await handleManualMessage('private-mail-manual-status',{entryId:id},{id:owner},ctx(current))).json()).report.status,'not_needed');
for(const args of [[{entryId:'not-a-uuid'},{id:owner}],[{entryId:crypto.randomUUID()},{id:owner}],[{entryId:id},{id:crypto.randomUUID()}]])await assert.rejects(()=>handleManualMessage('private-mail-manual-status',...args,ctx(current)));
assert.equal(writes,0);console.log('PASS read-only owner-scoped status: pending/processing/failed, report missing/dirty/uncertain/pending-write/rollover never complete, clean page complete, empty result not-needed, invalid/missing/other-owner denied. MOCK DB');

});}

{const {test}=await import('node:test');test('manual actual call progress is bounded metadata and never repeats model requests',async()=>{
const {callLuna}=await import('../supabase/functions/_shared/luna.js');
const {verifyMailExtraction}=await import('../supabase/functions/onedrive-auth/private-mail-jev-verifier.js');
const {createManualCallProgress}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const snapshots=[];const tracker=createManualCallProgress(async x=>{snapshots.push(structuredClone(x));return true;});await tracker.flush();
let release;const fetcher=Object.assign(()=>new Promise(resolve=>release=resolve),{manualCallProgress:tracker.observe});
const pending=callLuna({key:'PRIVATE_KEY',provider:'openai',model:'gpt-6-luna',prompt:'PRIVATE_SOURCE',fetcher});await tracker.flush();assert.equal(snapshots.at(-1).calls[0].status,'started');
release(Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'PRIVATE_OUTPUT'}]}]}));await pending;await tracker.flush();assert.equal(snapshots.at(-1).calls[0].status,'completed');
for(const mode of ['http','invalid','timeout']){const f=Object.assign(async()=>{if(mode==='timeout')throw new DOMException('SECRET_FAILURE','TimeoutError');return mode==='http'?Response.json({secret:'PRIVATE_HTTP'},{status:429}):Response.json({secret:'PRIVATE_JSON'});},{manualCallProgress:tracker.observe});await assert.rejects(()=>callLuna({key:'PRIVATE_KEY',provider:'openai',model:'gpt-6-luna',prompt:'PRIVATE_SOURCE',fetcher:f}));await tracker.flush();assert.equal(snapshots.at(-1).calls.at(-1).status,'failed');if(mode==='timeout')assert.equal(snapshots.at(-1).calls.at(-1).code,'TIMEOUT');}
await assert.rejects(()=>callLuna({key:null,provider:'openai',model:'gpt-6-luna',prompt:'PRIVATE_SOURCE',fetcher}));await tracker.flush();assert.equal(snapshots.at(-1).calls.at(-1).status,'skipped');assert.equal(snapshots.at(-1).calls.at(-1).startedAt,null);
for(const mode of ['ready','timeout','auth']){const f=Object.assign(mode==='timeout'?()=>new Promise(()=>{}):async()=>mode==='auth'?Response.json({},{status:401}):Response.json({model:'jev-1.14.0',answers:{q0:{type:'noul',noul:.1}}}),{manualCallProgress:tracker.observe});const result=await verifyMailExtraction({source:'PRIVATE_SOURCE',items:[{id:'q',text:'PRIVATE_TEXT'}],key:'PRIVATE_KEY',timeoutMs:10,fetcher:f});await tracker.flush();assert.equal(snapshots.at(-1).calls.at(-1).status,mode==='ready'?'completed':'failed');if(mode==='timeout')assert.equal(result.code,'TIMEOUT');}
const count=snapshots.at(-1).calls.length;await tracker.finish();assert.equal(snapshots.at(-1).finished,true);tracker.observe({kind:'api',status:'started'});await tracker.flush();assert.equal(snapshots.at(-1).calls.length,count);assert.ok(!JSON.stringify(snapshots).includes('PRIVATE_'));assert.ok(!JSON.stringify(snapshots).includes('SECRET_FAILURE'));
let last;const bounded=createManualCallProgress(async x=>{last=x;return true;});for(let i=0;i<30;i++){const id=bounded.observe({kind:'api',status:'started'});bounded.observe({id,kind:'api',status:'completed'});}await bounded.finish();assert.equal(last.calls.length,24);assert.equal(last.calls[0].id,7);assert.equal(last.calls.at(-1).id,30);
const broken=createManualCallProgress(async()=>{throw Error('DB_DOWN');});await broken.flush();let paid=0;await callLuna({key:'MOCK',provider:'openai',model:'gpt-6-luna',prompt:'x',fetcher:Object.assign(async()=>{paid++;return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{}'}]}]});},{manualCallProgress:broken.observe})});await broken.finish();assert.equal(paid,1);
console.log('PASS actual adapter start/validated-response/failure/timeout/skipped; JEV timeout/auth/fallback; no secrets/source/output; latest24; frozen final; telemetry DB failure does not repeat paid call. MOCK NETWORK');

});}

{const {test}=await import('node:test');test('duplicate receipts and untimed dispatch replies preserve provenance and scope',async()=>{
const {resolveDispatchAssignment,linkExistingManualItems,normalizeManualItems,manualDailyView,handleManualMessage}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const day='2026-11-04',id='af000000-0000-4000-8000-000000000001',ref=id+':manual:item-001',next='af000000-0000-4000-8000-000000000002',vehicle='부산91바9999 홍길동 010-0000-1234',text='11월04일\n합성창고A~합성센터B 5톤\n'+vehicle;
const packet=resolveDispatchAssignment(text,{},day);assert.equal(packet.resolution,'dispatch_assignment_review_v1');assert.equal(packet.items[0].needsConfirmation,true);assert.equal(packet.items[0].workRef,null);assert.ok(packet.details.includes(vehicle));
const request='상차지 : 합성창고A\n하차지 : 합성센터B\n상차일 : 11/4\n제품 : 합성제품\n수량 : 10P\n톤급 : 5톤';
const target={workId:ref,title:'합성창고A에서 합성센터B로 합성제품 배차',kind:'dispatch',status:'pending',serviceDate:day,originalScopeComplete:true,verificationScope:{title:'합성제품 배차',evidence:request,summary:[]}};
const raw={kind:'dispatch',text:'합성 배차 회신',evidence:text,serviceOriginal:'11월04일',needsConfirmation:false};
const output=x=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(x)}]}]});
async function run(mode){let calls=0;const r=await linkExistingManualItems({value:{items:[raw]},entry:{entryId:next,text,referenceDate:day,submittedAt:day+'T03:00:00Z'},work:[mode==='wrong-destination'?{...target,verificationScope:{...target.verificationScope,evidence:request.replace('합성센터B','다른센터')}}:mode==='wrong-tonnage'?{...target,verificationScope:{...target.verificationScope,evidence:request.replace('5톤','12톤')}}:mode==='wrong-origin'?{...target,verificationScope:{...target.verificationScope,evidence:request.replace('합성창고A','다른창고')}}:mode==='wrong-day'?{...target,serviceDate:'2026-11-05'}:target],ai:{aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK'},isolatedVerification:true,fetcher:async()=>output(++calls===1?{matches:[{itemIndex:0,relation:mode==='new'?'new':'followup',actor:'not_needed',workId:mode==='new'?null:ref,linkageEvidence:text,actorEvidence:null,promiseEvidence:null}]}:{matchesTarget:mode!=='reject',action:'complete',text:target.title,evidence:text,details:[],completionEvidence:vehicle,serviceOriginal:'11월04일',dueOriginal:null,nextActionEvidence:null,completedSteps:[],remainingSteps:[]})});return{item:r.reply.items[0],calls};}
const linked=await run('ok');assert.equal(linked.calls,2);assert.equal(linked.item.workRef,ref);assert.equal(linked.item.workflowStatus,'complete');
for(const mode of ['wrong-origin','wrong-day','wrong-destination','wrong-tonnage','new','reject']){const r=await run(mode);assert.equal(r.item.needsConfirmation,true);assert.ok(!r.item.workRef);assert.notEqual(r.item.workflowStatus,'complete');}
const normalized=normalizeManualItems({items:[linked.item]},{text,entryId:next,submittedAt:day+'T03:00:00Z',referenceDate:day,allowLinks:true,verifiedDispatchReply:true,verifiedReplyRef:ref,replyDetailsByItem:[[]]});assert.ok(normalized[0].details.includes(vehicle));
const foreign='서울12가8888 김철수 010-0000-5678';const mixed=text+'\n참고 다른 차량\n11월05일\n다른창고~다른센터 5톤\n'+foreign;const scoped=normalizeManualItems({items:[raw]},{text:mixed,entryId:next,submittedAt:day+'T03:00:00Z',referenceDate:day,verifiedDispatchReply:true});assert.ok(scoped[0].details.includes(vehicle));assert.ok(!scoped[0].details.includes(foreign));
const old={entryId:id,text,status:'ready',submittedAt:day+'T01:00:00Z',referenceDate:day,items:[{...normalized[0],ref,workRef:undefined,details:[],workflowStatus:'pending',done:false}]};assert.ok(!manualDailyView({[id]:old},day).entries[0].items[0].details.includes(vehicle),'no implicit backfill of legacy output');
const owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',box='39045005-313e-42e1-b50c-2394b3b6ff26';let paid=0;
const result=await(await handleManualMessage('private-mail-manual-enqueue',{text,clientRequestId:crypto.randomUUID()},{id:owner},{json:Response.json,fail:x=>Error(x),aiKey:'MOCK',fetcher:async()=>{paid++;throw Error('NO_NEW_ANALYSIS');},db:async(path)=>{if(path.startsWith('private_mailboxes?'))return[{id:box,owner_id:owner,enabled:true,manual_entries:{[id]:old}}];if(path==='rpc/private_mail_manual_enqueue')return{entry:old,queued:false};throw Error(path);}})).json();assert.equal(result.reusedReady,true);assert.equal(paid,0);assert.equal(result.items[0].done,false);
console.log('PASS duplicate ready explicitly reused/no paid calls; untimed packet review-only; independent matched scope completes; wrong origin/day/new/rejected never completes; exact scoped vehicle preserved/no foreign driver; legacy projection unchanged. MOCK MODEL ONLY');

});}

{const {test}=await import('node:test');test('dispatch context survives candidate cap and linked reference retains vehicle details',async()=>{
const {buildManualWorkCandidates}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const owner='2a828c2d-9a6f-40d4-8e13-336b591811cc',box='39045005-313e-42e1-b50c-2394b3b6ff26',day='2026-11-04';
const entry=(i,text,time)=>{const id='bb000000-0000-4000-8000-'+String(i).padStart(12,'0');return {entryId:id,text,status:'ready',submittedAt:time,items:[{itemId:'item-001',ref:id+':manual:item-001',kind:'dispatch',text:'합성 배차 '+i,evidence:text,visibleFrom:time.slice(0,10),submittedAt:time,receivedAt:time,serviceDate:day,workflowStatus:'pending',done:false,completionEvents:[],details:[]}]};};
const target=entry(1,'상차지 : 합성창고A\n하차지 : 합성센터B\n상차일 : 11/4\n톤급 : 5톤','2026-11-03T01:00:00Z');
const others=Array.from({length:45},(_,i)=>entry(i+2,'상차지 : 다른창고'+i+'\n하차지 : 다른센터\n톤급 : 5톤',day+'T01:00:00Z'));
const current={id:box,owner_id:owner,enabled:true,manual_entries:Object.fromEntries([target,...others].map(e=>[e.entryId,e])),briefing_overrides:{}};
const text='11월04일\n합성창고A~합성센터B 5톤\n서울12가0000 합성기사 010-0000-0000';
const result=await buildManualWorkCandidates({current,ownerId:owner,day,entry:{text,referenceDate:day,submittedAt:day+'T02:00:00Z'},db:async()=>[]});
assert.ok(result.some(c=>c.workId===target.items[0].ref),'older exact route/date dispatch must survive the 40 candidate cap');
assert.ok(result.length<=40);console.log('PASS older exact dispatch is presented before unrelated newer tasks; bounded40');
const ordinary=await buildManualWorkCandidates({current,ownerId:owner,day,db:async()=>[]});assert.ok(!ordinary.some(c=>c.workId===target.items[0].ref),'baseline ordering unchanged without structured reply');
const many={...current,manual_entries:Object.fromEntries(Array.from({length:45},(_,i)=>entry(i+1,target.text,day+'T01:00:00Z')).map(e=>[e.entryId,e]))};
const crowded=await buildManualWorkCandidates({current:many,ownerId:owner,day,entry:{text,referenceDate:day,submittedAt:day+'T02:00:00Z'},db:async()=>[]});assert.equal(crowded.length,40);assert.ok(crowded.every(c=>c.matchingPoolTruncated));
const {handleManualMessage,linkExistingManualItems,manualDailyView}=await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
const {dailyWorkItems}=await import('../supabase/functions/onedrive-auth/private-mail-work.js');
const output=value=>Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
let calls=0;const blocked=await linkExistingManualItems({value:{items:[{kind:'dispatch',text:'합성 회신',evidence:text,serviceOriginal:'11월04일'}]},entry:{text,referenceDate:day,submittedAt:day+'T02:00:00Z'},work:crowded,ai:{aiKey:'MOCK',aiProvider:'openai',aiModel:'gpt-6-luna'},fetcher:async()=>{calls++;return output({matches:[{itemIndex:0,workId:crowded[0].workId,relation:'followup',actor:'not_needed',linkageEvidence:text,actorEvidence:null,promiseEvidence:null}]});}});assert.equal(calls,1);assert.equal(blocked.reply.items[0].needsConfirmation,true);assert.ok(!blocked.reply.items[0].workRef);console.log('PASS overflowing same-route competitors cannot be falsely unique after truncation');
for(const mode of ['complete','reference','reject']){
 const id='bb000000-0000-4000-8000-000000000099',order=[],progress=[];let saved;
 const ctx={json:Response.json,fail:x=>Error(x),verifiedUpdatesEnabled:true,resolveAiConfiguration:async()=>({aiKey:'MOCK',aiProvider:'openai',aiModel:'gpt-6-luna'}),resolveJevConfiguration:async()=>({enabled:true,approvedSourceIds:[id],key:'MOCK',fetcher:async(_,o)=>{order.push('jev');const p=JSON.parse(o.body);return Response.json({model:'jev-1.14.0',answers:Object.fromEntries(Object.keys(p.questions).map(k=>[k,{type:'noul',noul:.8}]))});}}),fetcher:async(_,o)=>{
  const p=JSON.parse(o.body),prompt=p.input[0].content[0].text, name=prompt.startsWith('카톡')?'private_manual_message':prompt.startsWith('새 입력')?'private_existing_work_match':'verify';
  if(name==='private_manual_message'){order.push('extract');assert.ok(o.body.includes(target.items[0].ref));assert.ok(o.body.includes('jevIntent'));return output({inputKind:'business',authoredDate:null,items:[{kind:'dispatch',text:'합성 회신',evidence:text,serviceOriginal:'11월04일',assignee:null,dueOriginal:null,needsConfirmation:false,requestEvidence:null,resultEvidence:null}]});}
  if(name==='private_existing_work_match'){order.push('match');assert.ok(o.body.includes(target.items[0].ref));return output({matches:[{itemIndex:0,workId:target.items[0].ref,relation:mode==='reference'?'reference':'followup',actor:'not_needed',linkageEvidence:text,actorEvidence:null,promiseEvidence:null}]});}
  order.push('verify');return output({matchesTarget:mode!=='reject',action:mode==='reference'?'update':'complete',text:target.items[0].text,evidence:text,completionEvidence:mode==='reference'?null:text,details:[],serviceOriginal:'11월04일',dueOriginal:null,nextActionEvidence:null,completedSteps:[],remainingSteps:[]});
 },db:async(path,o)=>{
  if(path.startsWith('private_mailboxes?'))return[current];if(path.startsWith('private_mail_messages?'))return[];
  if(path.endsWith('_claim'))return{claimed:true,entry:{entryId:id,text,textHash:o.body.p_hash,status:'processing',submittedAt:day+'T02:00:00Z',referenceDate:day}};
  if(path.endsWith('_call_progress')){progress.push(o.body);return true;}
  if(path.endsWith('_finish'))return saved={entryId:id,text,status:'ready',submittedAt:day+'T02:00:00Z',referenceDate:day,items:o.body.p_items};
  if(path.endsWith('_jev_review'))return null;
  if(path.endsWith('_fail'))throw Error('Failure '+o.body.p_code+' ORDER '+order.join(','));
  throw Error('Unexpected '+path);
 }};
 const response=await(await handleManualMessage('private-mail-manual-add',{text,clientRequestId:id},{id:owner},ctx)).json();assert.equal(response.status,'ready');assert.equal(order[0],'jev');assert.deepEqual(order.filter(x=>x!=='jev'),['extract','match','verify']);assert.ok(progress.at(-1).p_finished);assert.ok(progress.some(x=>x.p_calls.some(c=>c.kind==='jev'&&c.status==='completed')));assert.ok(progress.some(x=>x.p_calls.some(c=>c.kind==='api'&&c.status==='completed')));
 if(mode==='reject'){assert.ok(!saved.items[0].workRef);assert.equal(saved.items[0].needsConfirmation,true);}else{
 assert.equal(saved.items[0].workRef,target.items[0].ref);assert.ok(saved.items[0].details.includes('서울12가0000 합성기사 010-0000-0000'));
 const work=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView({...current.manual_entries,[id]:saved},day));const linked=work.find(w=>w.workId===target.items[0].ref);assert.equal(linked.status,mode==='complete'?'complete':'pending');assert.equal(work.some(w=>w.workId===id+':manual:item-001'),false);
 }console.log('PASS full handler JEV→extraction→match→independent verifier→storage/projection/call progress '+mode+' (MOCK NETWORK)');
}

});}
