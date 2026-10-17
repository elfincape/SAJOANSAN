import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createHash } from 'node:crypto';
import { handlePrivateMail } from '../supabase/functions/onedrive-auth/private-mail.js';
import { APPROVED_MAIL_TARGET } from '../supabase/functions/onedrive-auth/private-mail-policy.js';
const owner = APPROVED_MAIL_TARGET.owner_id,
  id = APPROVED_MAIL_TARGET.mailbox_id;
// Synthetic digest fixture exercises the production pin branch without storing
// actual drive/folder identifiers in tests. All other SHA operations are real.
const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
mock.method(crypto.subtle, 'digest', async (algorithm, data) =>
  new TextDecoder().decode(data) === 'fixture-drive|fixture-folder'
    ? Uint8Array.from(
        APPROVED_MAIL_TARGET.destination_sha256.match(/../g),
        (x) => parseInt(x, 16),
      ).buffer
    : originalDigest(algorithm, data),
);
let box,
  aclCalls = 0,
  ownerFacetCalls = 0,
  graphCalls = 0,
  activationWrites = 0,
  folderDenied = false,
  contentDenied = false,
  remoteFile = false,
  remoteFolder = false,
  revoke = false,
  putCalls = 0;
const bytes = Buffer.from('fixture EML');
const file = {
  item_id: 'fixture-file',
  kind: 'eml',
  file_name: 'fixture.bin',
  original_name: 'fixture.eml',
  byte_size: bytes.length,
  content_hash: createHash('sha256').update(bytes).digest('base64url'),
};
const row = {
  id: '00000000-0000-4000-8000-000000000006',
  owner_id: owner,
  mailbox_id: id,
  files: [file],
};
const reset = () => {
  box = {
    id,
    owner_id: owner,
    account: 'jhs96@eangroup.kr',
    drive_id: 'fixture-drive',
    folder_id: 'fixture-folder',
    enabled: false,
    initial_days: 60,
    cutoff_at: null,
    lease_until: null,
  };
  aclCalls = 0;
  ownerFacetCalls = 0;
  graphCalls = 0;
  activationWrites = 0;
  folderDenied = false;
  contentDenied = false;
  remoteFile = false;
  remoteFolder = false;
  revoke = false;
  putCalls = 0;
};
reset();
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });
const ctx = {
  ownerSync: true,
  collectorMailboxId: id,
  fail,
  json: Response.json,
  withLock: async (fn) => fn('fixture-lock'),
  settings: async () => ({ expected_drive_id: 'fixture-drive' }),
  connected: async () => ({ accessToken: 'fixture-server-only' }),
  hash: async (b) => createHash('sha256').update(b).digest('base64url'),
  fetcher: async () => {
    throw Error('NO_NETWORK');
  },
  db: async (path, opts = {}) => {
    if (path.startsWith('onedrive_connection'))
      return [{ connected_by: owner }];
    if (path.startsWith('onedrive_locks')) return [{ holder: 'fixture-lock' }];
    if (path.startsWith('private_mailboxes')) {
      if (opts.method === 'PATCH') {
        activationWrites++;
        Object.assign(box, opts.body);
      }
      return [{ ...box }];
    }
    if (path.startsWith('private_mail_messages?select=id&'))
      return revoke ? [] : [{ id: row.id }];
    if (path.startsWith('private_mail_messages')) return [{ ...row }];
    throw Error('UNEXPECTED_DB');
  },
  graph: async (path, access, opts = {}) => {
    graphCalls++;
    assert.equal(access, 'fixture-server-only');
    if (path === '/me/drive?$select=id')
      return Response.json({ id: 'fixture-drive' });
    if (path.startsWith('/me/drive')) {
      ownerFacetCalls++;
      throw Error('OWNER_FACET_PREFLIGHT_MUST_NOT_RUN');
    }
    if (path.endsWith('/permissions')) {
      aclCalls++;
      throw Error('ACL_PREFLIGHT_MUST_NOT_RUN');
    }
    if (path.includes('/items/fixture-folder?')) {
      if (folderDenied) throw fail('GRAPH_FORBIDDEN', 403);
      return Response.json({
        id: 'fixture-folder',
        folder: {},
        parentReference: { driveId: 'fixture-drive' },
        ...(remoteFolder ? { remoteItem: {} } : {}),
      });
    }
    if (opts.method === 'PUT') {
      putCalls++;
      throw fail('GRAPH_FORBIDDEN', 403);
    }
    if (path.includes('fixture-folder:/')) return null;
    if (path.endsWith('/content')) {
      if (contentDenied) throw fail('GRAPH_FORBIDDEN', 403);
      return new Response(bytes);
    }
    if (path.endsWith('/items/fixture-file'))
      return Response.json({
        id: 'fixture-file',
        file: {},
        name: file.file_name,
        size: bytes.length,
        parentReference: { driveId: 'fixture-drive', id: 'fixture-folder' },
        ...(remoteFile ? { remoteItem: {} } : {}),
      });
    throw Error('UNEXPECTED_GRAPH');
  },
};
const begin = () =>
  handlePrivateMail(
    'private-mail-sync',
    new Request('https://fixture.test/begin', {
      method: 'POST',
      body: '{"operation":"begin"}',
    }),
    { id: owner },
    ctx,
  );
const download = (caller = owner) =>
  handlePrivateMail(
    'private-mail-download',
    new Request('https://fixture.test/download', {
      method: 'POST',
      body: JSON.stringify({ id: row.id, index: 0 }),
    }),
    { id: caller, token: 'fixture-owner-jwt' },
    ctx,
  );
try {
  await begin();
  assert.equal(box.enabled, true);
  assert.equal(activationWrites, 1);
  assert.equal(aclCalls, 0);
  assert.equal(ownerFacetCalls, 0);
  assert.deepEqual(Buffer.from(await (await download()).arrayBuffer()), bytes);
  assert.equal(aclCalls, 0);
  contentDenied = true;
  await assert.rejects(download, (e) => e.status === 403);
  contentDenied = false;
  remoteFile = true;
  await assert.rejects(download, /OWNER_FOLDER_REQUIRED/);
  remoteFile = false;
  revoke = true;
  await assert.rejects(download, (e) => e.status === 403);
  revoke = false;
  const oldCalls = graphCalls;
  await assert.rejects(
    () => download('other'),
    (e) => e.status === 403,
  );
  assert.equal(graphCalls, oldCalls);
  const rawHash = createHash('sha256').update(bytes).digest('hex');
  const meta = {
    operation: 'file',
    mailbox: id,
    lease: box.lease,
    uidl: 'a'.repeat(64),
    hash: rawHash,
    index: 0,
    kind: 'eml',
    name: 'fixture.eml',
    byte_size: bytes.length,
    content_hash: rawHash,
  };
  await assert.rejects(
    () =>
      handlePrivateMail(
        'private-mail-sync',
        new Request('https://fixture.test/file', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Mail-Metadata': encodeURIComponent(JSON.stringify(meta)),
          },
          body: bytes,
        }),
        { id: owner },
        ctx,
      ),
    (e) => e.status === 403,
  );
  assert.equal(putCalls, 1);
  assert.equal(aclCalls, 0);
  reset();
  folderDenied = true;
  await assert.rejects(begin);
  assert.equal(box.enabled, false);
  assert.equal(activationWrites, 0);
  reset();
  remoteFolder = true;
  await assert.rejects(begin, /OWNER_FOLDER_REQUIRED/);
  assert.equal(activationWrites, 0);
  reset();
  box.folder_id = 'changed';
  await assert.rejects(begin, /OWNER_FOLDER_REQUIRED/);
  assert.equal(activationWrites, 0);
  assert.equal(aclCalls, 0);
  console.log(
    'PASS exact target uses existing authenticated Graph storage without owner/ACL preflight; JWT, fixed target, remote denial, Graph403, content/hash and RLS revocation remain enforced; mock-only',
  );
} finally {
  mock.restoreAll();
}
