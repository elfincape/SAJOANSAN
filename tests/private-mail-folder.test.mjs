import assert from 'node:assert/strict';
import { handlePrivateMail } from '../supabase/functions/onedrive-auth/private-mail.js';
const owner = '2a828c2d-9a6f-40d4-8e13-336b591811cc';
let shared = false,
  permissionOverride,
  missingOwner = false,
  inserts = 0,
  existing = false,
  wrongDrive = false;
const ctx = {
  db: async (path, options) => {
    if (path.startsWith('onedrive_connection'))
      return [{ connected_by: owner }];
    if (options?.method === 'POST') {
      inserts++;
      assert.equal(options.body.enabled, false);
      assert.equal(options.body.initial_days, 60);
      assert.equal(options.body.owner_id, owner);
      return [{ id: '00000000-0000-4000-8000-000000000001' }];
    }
    if (path.startsWith('private_mailboxes'))
      return existing
        ? [
            {
              id: 'old',
              drive_id: 'drive',
              folder_id: 'different',
              enabled: false,
            },
          ]
        : [];
    throw Error('Unexpected DB');
  },
  settings: async () => ({ expected_drive_id: 'drive' }),
  connected: async () => ({ accessToken: 'mock-server-only' }),
  graph: async (path, token, options) => {
    assert.equal(token, 'mock-server-only');
    assert.equal(options?.method, undefined);
    assert.equal(options?.headers?.Prefer, undefined);
    if (path.startsWith('/shares/'))
      return Response.json({
        id: 'folder',
        name: 'Private mail',
        folder: {},
        parentReference: { driveId: wrongDrive ? 'other' : 'drive' },
      });
    if (path === '/me/drive?$select=id') return Response.json({ id: 'drive' });
    if (path === '/me/drive?$select=id,owner')
      return Response.json({
        id: 'drive',
        owner: missingOwner ? {} : { user: { id: 'drive-owner' } },
      });
    if (path.endsWith('/permissions'))
      return Response.json(
        permissionOverride ?? {
          value: shared
            ? [{ link: { scope: 'anonymous' } }]
            : [{ grantedToV2: { user: { id: 'drive-owner' } } }],
        },
      );
    throw Error('Unexpected Graph');
  },
  withLock: async (fn) => fn(),
  json: Response.json,
  fail: (message, status = 400) => Object.assign(Error(message), { status }),
  hash: async () => '',
  fetcher: async () => {
    throw Error('Unexpected fetch');
  },
};
const req = (configure = false, url = 'https://1drv.ms/f/example') =>
  new Request('https://db.test/private-mail-folder', {
    method: 'POST',
    body: JSON.stringify({ url, configure }),
  });
const run = (configure = false) =>
  handlePrivateMail('private-mail-folder', req(configure), { id: owner }, ctx);
const inspected = await (await run()).json();
assert.equal(inspected.private, true);
assert.equal(inspected.folder_id, 'folder');
assert.equal(inserts, 0);
const configured = await (await run(true)).json();
assert.equal(configured.enabled, false);
assert.equal(inserts, 1);
shared = true;
assert.equal((await (await run()).json()).reason, 'ANONYMOUS_LINK_PRESENT');
await assert.rejects(
  () => run(true),
  (e) => e.status === 409,
);
assert.equal(inserts, 1);
shared = false;
for (const [value, reason] of [
  [
    { value: [{ link: { scope: 'organization' } }] },
    'ORGANIZATION_LINK_PRESENT',
  ],
  [{ value: [{ link: { scope: 'existingAccess' } }] }, 'SHARING_LINK_PRESENT'],
  [{ value: [{ invitation: {} }] }, 'INVITATION_PRESENT'],
  [
    { value: [{ grantedTo: { user: { id: 'other' } } }] },
    'OTHER_PRINCIPAL_PRESENT',
  ],
  [{ value: [{ grantedTo: { user: {} } }] }, 'PERMISSION_IDENTITY_UNAVAILABLE'],
  [
    { value: [], '@odata.nextLink': 'https://example.test/next' },
    'PERMISSIONS_INCOMPLETE',
  ],
  [{}, 'PERMISSIONS_INCOMPLETE'],
]) {
  permissionOverride = value;
  assert.equal((await (await run()).json()).reason, reason);
  await assert.rejects(() => run(true), new RegExp(reason));
}
permissionOverride = {
  value: [{ grantedTo: { user: { id: 'drive-owner' } } }],
};
assert.equal((await (await run()).json()).private, true);
permissionOverride = undefined;
missingOwner = true;
assert.equal((await (await run()).json()).reason, 'DRIVE_OWNER_UNAVAILABLE');
missingOwner = false;
assert.equal(inserts, 1);
existing = true;
await assert.rejects(() => run(true), /CONFLICT/);
existing = false;
wrongDrive = true;
await assert.rejects(() => run(), /OWNER_FOLDER_REQUIRED/);
wrongDrive = false;
await assert.rejects(
  () => handlePrivateMail('private-mail-folder', req(), { id: 'other' }, ctx),
  (e) => e.status === 403,
);
await assert.rejects(
  () =>
    handlePrivateMail(
      'private-mail-folder',
      req(false, 'https://evil.test/folder'),
      { id: owner },
      ctx,
    ),
  /URL_REJECTED/,
);
console.log(
  'PASS authenticated private folder inspection/config: fixed owner, connected account, drive+permissions, no grants/upload, disabled mailbox only, conflicts/shared/foreign denied',
);
