import assert from 'node:assert/strict';
import { handlePrivateMail } from '../supabase/functions/onedrive-auth/private-mail.js';
const owner = '2a828c2d-9a6f-40d4-8e13-336b591811cc',
  // Keep the original private-policy branch covered separately from the pinned
  // existing-storage target exercised in private-mail-standard-storage.test.mjs.
  id = '00000000-0000-4000-8000-000000000003';
let box,
  shared,
  missingOwner,
  unknown,
  foreign,
  remote,
  failWrite,
  lockHeld,
  holdGraph,
  enteredGraph,
  releaseGraph,
  writes,
  graphCalls;
const reset = () => {
  box = {
    id,
    owner_id: owner,
    account: 'jhs96@eangroup.kr',
    enabled: false,
    initial_days: 60,
    drive_id: 'drive',
    folder_id: 'folder',
    lease: null,
    lease_until: null,
    cutoff_at: null,
    scan_cursor: null,
  };
  shared = false;
  missingOwner = false;
  unknown = false;
  foreign = false;
  remote = false;
  failWrite = false;
  lockHeld = false;
  holdGraph = false;
  writes = 0;
  graphCalls = 0;
};
reset();
const fail = (s, status = 400) => Object.assign(Error(s), { status });
const ctx = {
  ownerSync: true,
  collectorMailboxId: id,
  fail,
  json: Response.json,
  withLock: async (fn) => {
    if (lockHeld) throw fail('CONNECTION_BUSY', 409);
    lockHeld = true;
    try {
      return await fn();
    } finally {
      lockHeld = false;
    }
  },
  db: async (path, opts = {}) => {
    if (path.startsWith('onedrive_connection'))
      return [{ connected_by: owner }];
    if (path.startsWith('private_mailboxes')) {
      if (opts.method === 'PATCH') {
        writes++;
        assert.match(path, /enabled=eq.false/);
        assert.match(path, /owner_id=eq\./);
        assert.match(path, /drive_id=eq.drive/);
        assert.match(path, /folder_id=eq.folder/);
        assert.equal(opts.body.enabled, true);
        assert.equal(opts.body.status, 'running');
        assert.ok(opts.body.lease);
        assert.ok(opts.body.cutoff_at);
        assert.equal(opts.prefer, 'return=representation');
        if (failWrite) throw Error('PRIVATE_UPSTREAM_TEXT');
        if (box.enabled) return [];
        Object.assign(box, opts.body);
        return [{ ...box }];
      }
      return [{ ...box }];
    }
    if (path === 'rpc/private_mail_begin') return [];
    throw Error('UNEXPECTED_DB');
  },
  settings: async () => ({ expected_drive_id: 'drive' }),
  connected: async () => ({ accessToken: 'fixture-only' }),
  graph: async (path) => {
    graphCalls++;
    if (holdGraph) {
      holdGraph = false;
      enteredGraph();
      await new Promise((r) => {
        releaseGraph = r;
      });
    }
    if (path.startsWith('/me/drive'))
      return Response.json({
        id: foreign ? 'other' : 'drive',
        ...(!missingOwner ? { owner: { user: { id: 'drive-owner' } } } : {}),
      });
    if (path.includes('/items/folder?'))
      return Response.json({
        id: 'folder',
        folder: {},
        parentReference: { driveId: 'drive' },
        ...(remote ? { remoteItem: {} } : {}),
      });
    if (path.endsWith('/permissions'))
      return Response.json({
        value: shared
          ? [{ link: { scope: 'anonymous' } }]
          : unknown
            ? [{}]
            : [],
      });
    throw Error('UNEXPECTED_GRAPH');
  },
  hash: async () => '',
  fetcher: async () => {
    throw Error('NO_NETWORK');
  },
};
const run = (values = {}, user = owner, context = ctx) =>
  handlePrivateMail(
    'private-mail-sync',
    new Request('https://fixture.test/begin', {
      method: 'POST',
      body: JSON.stringify({ operation: 'begin', ...values }),
    }),
    { id: user },
    context,
  );
const ready = await (await run()).json();
assert.equal(box.enabled, true);
assert.equal(writes, 1);
assert.equal(ready.mailbox, id);
assert.equal(ready.lease, box.lease);
assert.equal(ready.cutoff, box.cutoff_at);
await assert.rejects(() => run());
assert.equal(writes, 1);
for (const kind of ['shared', 'unknown', 'foreign', 'remote']) {
  reset();
  if (kind === 'shared') shared = true;
  if (kind === 'unknown') unknown = true;
  if (kind === 'foreign') foreign = true;
  if (kind === 'remote') remote = true;
  await assert.rejects(() => run());
  assert.equal(box.enabled, false);
  assert.equal(writes, 0);
}
reset();
missingOwner = true;
unknown = true;
await assert.rejects(() => run(), /DRIVE_OWNER_UNAVAILABLE/);
assert.equal(writes, 0);
reset();
missingOwner = true;
await run();
assert.equal(box.enabled, true);
reset();
await assert.rejects(
  () => run({}, 'other'),
  (e) => e.status === 403,
);
assert.equal(graphCalls, 0);
assert.equal(writes, 0);
reset();
await assert.rejects(
  () => run({ mailbox: '00000000-0000-4000-8000-000000000009' }),
  (e) => e.status === 403,
);
assert.equal(graphCalls, 0);
reset();
box.account = 'other@example.test';
await assert.rejects(() => run(), /MAILBOX_TARGET_REJECTED/);
assert.equal(writes, 0);
reset();
failWrite = true;
await assert.rejects(() => run(), /BEGIN_FAILED/);
assert.equal(box.enabled, false);
failWrite = false;
await run();
assert.equal(writes, 2);
reset();
holdGraph = true;
const waiting = new Promise((r) => {
  enteredGraph = r;
});
const first = run();
await waiting;
await assert.rejects(() => run(), /CONNECTION_BUSY/);
releaseGraph();
await first;
assert.equal(writes, 1);
console.log(
  'PASS fixed owner manual begin: verify before atomic activation+lease, shared/unknown/foreign/remote denied, one winner, failed write retry safe, no POP/network',
);
