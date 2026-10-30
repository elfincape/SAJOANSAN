import assert from 'node:assert/strict';
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
assert.equal((report.html.match(/<h3>/g) || []).length, 1);
assert.ok(!report.html.includes('<img'));
assert.ok(report.html.includes('&lt;img'));
assert.ok(
  report.html.includes('메일 요약') &&
    report.html.includes('이슈') &&
    report.html.includes('할 일'),
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
  '1. 메일 요약',
  '2. 주요 이슈',
  '3. 할 일',
  '4. 회신·확인 대기',
  '5. 직접 메모',
  '최종 업데이트',
  '평택센터',
  '확인 필요',
  '김담당',
  '2026-10-30 15:22',
])
  assert.ok(approvedReport.html.includes(label), label);
assert.ok(
  !approvedReport.managedHtml.includes('5. 직접 메모'),
  'manual area must be outside replaceable managed region',
);
assert.ok(
  approvedReport.html.indexOf('5. 직접 메모') >
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
  await handleMailAutomation(
    'private-mail-background-work',
    { operation: 'report', day: '2026-10-30', mailbox: target.mailbox_id },
    { id: target.owner_id },
    { ...ctx, background: true },
  );
  assert.equal(
    snapshotAfterClaim,
    true,
    'report snapshot is loaded only after revision lease',
  );
  assert.equal(released, true, 'failed report releases its own lease');
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
