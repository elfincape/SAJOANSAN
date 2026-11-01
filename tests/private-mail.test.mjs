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
    'pending',
    'inferred assignment must not override an explicit owner reopen',
  );
  assert.equal(ownerWins[0].ownerStateAt, '2026-10-31T07:00:00.000Z');
  assert.equal(ownerWins[0].closedAt, null);
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
                  authoredDate: null,
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
  assert.equal(paidCalls, 1);
  assert.equal(reviewWrites, 1);
  console.log(
    'PASS JEV runtime: server-approved advisory only, one bounded call, reference skip, mail/manual dates and completion unchanged, no images, timeout/429/invalid/missing-key fail open and ready replay does not call again',
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
['explicit owner reopen survives inferred completion',()=>{const entries=seed();entries[base.entryId].items[0].completionEvents=[{done:true,at:'2026-11-01T03:00:00Z'},{done:false,at:'2026-11-02T00:30:00Z'}];entries[base.entryId].items[0].ownerUpdatedAt='2026-11-02T00:30:00Z';const result=resolveExistingManualWork('11월 3일 가상구름센터 12P 차량 배정 완료했습니다.',entries,day,now);save(entries,result,'ffffffff-1111-4111-8111-000000000002');const work=dailyWorkItems({day,groups:[],tasks:[],issues:[],waiting:[]},manualDailyView(entries,day)).find(x=>x.workId===base.ref);assert.equal(work.status,'pending');assert.equal(work.ownerStateAt,'2026-11-02T00:30:00.000Z')}],
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
const recorded=[{"caseId":"mail-cid-evidence-duplicate-signatures","value":{"intent":{"kind":"request","evidence":"테스트담당자님, 가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다."},"group":{"name":"가상구름센터","evidence":"가상구름센터"},"summary":[{"text":"가상구름센터 점검표에는 2026-11-03 서비스, 팔레트 12개, 09:00 하역, 온도 4°C 및 정기 점검 정상으로 기재되어 있습니다.","evidence":"SERVICE 2026-11-03 | PALLETS 12\nUNLOAD 09:00 | TEMP 4 C\nROUTINE CHECK: NORMAL"}],"issues":[{"text":"발신자는 가상구름센터의 온도 이탈을 확인하고 조치 내용을 회신해 달라고 요청했습니다.","evidence":"가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다.","status":"needs_confirmation","impact":"온도 이탈 여부 및 조치 내용 확인이 필요합니다.","latest":"첨부 점검표에는 TEMP 4 C 및 ROUTINE CHECK: NORMAL로 적혀 있어 본문 요청과 차이가 있습니다.","completionEvidence":null}],"tasks":[{"text":"가상구름센터 온도 이탈을 확인하고 조치 내용을 회신합니다.","evidence":"테스트담당자님, 가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다.","status":"pending","assignee":"테스트담당자","due":null,"completionEvidence":null,"serviceOriginal":null,"forOwner":true,"recipientScope":"owner_direct","selfRequestEvidence":"테스트담당자님, 가상구름센터 온도 이탈 확인 후 조치 회신 부탁드립니다."}],"waiting":[],"updates":[],"imageFacts":[{"imageId":"f0000000-0000-4000-8000-000000000003:0","text":"합성 점검표: 서비스 2026-11-03, 팔레트 12개, 하역 09:00, 온도 4°C, 정기 점검 정상.","confidence":"readable"}],"imageDecisions":[{"imageId":"f0000000-0000-4000-8000-000000000003:0","kind":"business_document","include":true}],"imageItems":{"tasks":[],"issues":[],"waiting":[]}}},{"caseId":"mail-old-sent-collected-today","value":{"intent":{"kind":"request","evidence":"테스트담당자님, 내일 가상별창고 6P 배차 준비 부탁드립니다."},"group":{"name":"가상별창고","evidence":"가상별창고"},"summary":[{"text":"가상별창고 6P의 내일 배차 준비 요청이며, 하차 예정 시각은 09:00입니다.","evidence":"내일 가상별창고 6P 배차 준비 부탁드립니다. 하차 예정은 09:00입니다."}],"issues":[],"tasks":[{"text":"가상별창고 6P의 내일 배차를 준비합니다. 하차 예정 시각은 09:00입니다.","evidence":"내일 가상별창고 6P 배차 준비 부탁드립니다. 하차 예정은 09:00입니다.","status":"pending","assignee":"테스트담당자","due":null,"completionEvidence":null,"serviceOriginal":"내일","forOwner":true,"recipientScope":"owner_direct","selfRequestEvidence":"테스트담당자님, 내일 가상별창고 6P 배차 준비 부탁드립니다."}],"waiting":[],"updates":[],"imageFacts":[],"imageDecisions":[],"imageItems":{"tasks":[],"issues":[],"waiting":[]}}},{"caseId":"manual-contextless-deictic-request","value":{"items":[{"kind":"waiting","text":"자료 전달 대기","evidence":"자료는 뒤에 보낼게요.","assignee":null,"serviceOriginal":null,"dueOriginal":null,"needsConfirmation":false}],"authoredDate":null}}];
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
   return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({items:blocks.map((evidence,index)=>({kind:'dispatch',text:index?'가상쿠팡별 6P 배차 준비':'가상쿠팡구름 4P 배차 준비',evidence:evidence.trim(),serviceOriginal:'11/2',dueOriginal:null,assignee:null,needsConfirmation:false})),authoredDate:null})}]}]});
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
contents.set(result.pageId,contents.get(result.pageId).replace('data-id="sajo-mail-manual">','data-id="sajo-mail-manual"><p>OWNER MEMO</p>'));
const repeat=await writeStressNote(body,ctx);assert.equal(repeat.firstStatus,'skipped');assert.equal(repeat.diagnosticStateWritten,false);assert.equal(writes,1);assert.ok(contents.get(result.pageId).includes('OWNER MEMO'));
contents.set(result.pageId,contents.get(result.pageId).replace('가상별창고 6P 배차 준비','OWNER CHANGED TASK'));await assert.rejects(()=>writeStressNote(body,ctx),/PAGE_MANAGED_CONFLICT/);assert.equal(writes,1);
// Separate simulations keep the same signed receipt but reset only local fake state.
markers.clear();pages.length=0;contents.clear();failure='lost-create';await assert.rejects(()=>writeStressNote(body,ctx),/PAGE_CREATE_UNCERTAIN/);const afterLost=writes;assert.equal((await writeStressNote(body,ctx)).status,'passed');assert.equal(writes,afterLost,'accepted-but-lost response must not duplicate a page');
markers.clear();pages.length=0;contents.clear();failure='rejected';await assert.rejects(()=>writeStressNote(body,ctx),/PAGE_CREATE_UNCERTAIN/);assert.equal(markers.size,0,'confirmed rejected create can retry the same proof');assert.equal((await writeStressNote(body,ctx)).status,'passed');
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
test('replacement preserves owner reopen, source refs and receipt-order latest details',()=>{
 const entries={[seed.entryId]:seed,[idA]:old},newText='차량 교체\n11월2일\n가상공장(09:00상)-가상쿠팡구름\n가상34나0002 가상을 01000000002';
 const reply=resolveDispatchAssignment(newText,entries,day,day+'T02:00:00.000Z');const replacement=save(reply,idB,day+'T02:00:00.000Z');
 const reopened=structuredClone(seed);reopened.items[0].completionEvents=[{done:true,at:day+'T00:20:00.000Z'},{done:false,at:day+'T00:30:00.000Z'}];reopened.items[0].ownerUpdatedAt=day+'T00:30:00.000Z';
 const before=JSON.stringify([reopened,old,replacement]),work=view({[idB]:replacement,[idA]:old,[reopened.entryId]:reopened});const target=work.find(w=>w.workId===a);
 assert.equal(target.status,'pending');assert.ok(target.summary.some(t=>t.includes('가상34나0002')));assert.ok(!target.summary.some(t=>t.includes('가상12가0001')));
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
 for(const fixture of STRESS_FIXTURES.slice(26)){
  const original=JSON.stringify(fixture.related);let calls=0;
  const result=await runStressCase(fixture.id,{resolveAiConfiguration:async()=>({aiProvider:'openai',aiModel:'gpt-6-luna',aiKey:'MOCK_ONLY'}),resolveJevConfiguration:async()=>null,fetcher:async()=>{
   calls++;assert.equal(fixture.id,'manual-late-reply-is-historical-reference');
   return Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({items:[{kind:'reference',text:'교체 전 차량 회신 참고',evidence:fixture.text,serviceOriginal:null,dueOriginal:null,assignee:null,needsConfirmation:false}],authoredDate:null})}]}]});
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
