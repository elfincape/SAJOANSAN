import assert from 'node:assert/strict';
import { handlePrivateMail } from '../supabase/functions/onedrive-auth/private-mail.js';
const owner = '2a828c2d-9a6f-40d4-8e13-336b591811cc';
async function inspect({
  drive = { id: 'drive', driveType: 'personal' },
  full = drive,
  folder = { id: 'folder', folder: {}, parentReference: { driveId: 'drive' } },
  permissions = { value: [] },
  caller = owner,
} = {}) {
  let writes = 0,
    aclCalls = 0;
  const ctx = {
    db: async (_path, options) => {
      if (options?.method) writes++;
      return [{ connected_by: owner }];
    },
    settings: async () => ({ expected_drive_id: 'drive' }),
    connected: async () => ({ accessToken: 'fixture-only' }),
    graph: async (path) => {
      if (path.startsWith('/shares/'))
        return Response.json({
          id: 'folder',
          folder: {},
          parentReference: { driveId: 'drive' },
        });
      if (path === '/me/drive?$select=id')
        return Response.json({ id: 'drive' });
      if (path === '/me/drive?$select=id,owner') return Response.json(drive);
      if (path === '/me/drive') return Response.json(full);
      if (path.includes('/items/folder?')) return Response.json(folder);
      if (path.endsWith('/permissions')) {
        aclCalls++;
        return Response.json(permissions);
      }
      throw Error('UNEXPECTED_FIXTURE_PATH');
    },
    withLock: async (fn) => fn(),
    json: Response.json,
    fail: (code, status = 400) => Object.assign(Error(code), { status }),
    hash: async () => '',
    fetcher: async () => {
      throw Error('NETWORK_FORBIDDEN');
    },
  };
  try {
    const response = await handlePrivateMail(
      'private-mail-folder',
      new Request('https://fixture.test/check', {
        method: 'POST',
        body: JSON.stringify({
          url: 'https://1drv.ms/f/fixture',
          configure: false,
        }),
      }),
      { id: caller },
      ctx,
    );
    return { ...(await response.json()), writes, aclCalls };
  } finally {
    assert.equal(writes, 0);
  }
}
let result = await inspect();
assert.equal(result.private, true);
assert.equal(result.aclCalls, 1);
assert.equal(result.drive_owner_id, undefined);
for (const [permissions, reason] of [
  [{}, 'PERMISSIONS_INCOMPLETE'],
  [
    { value: [], '@odata.nextLink': 'https://fixture.test/next' },
    'PERMISSIONS_INCOMPLETE',
  ],
  [{ value: [{}] }, 'DRIVE_OWNER_UNAVAILABLE'],
  [
    { value: [{ grantedTo: { user: { id: 'someone' } } }] },
    'DRIVE_OWNER_UNAVAILABLE',
  ],
  [{ value: [{ link: { scope: 'anonymous' } }] }, 'ANONYMOUS_LINK_PRESENT'],
  [
    { value: [{ link: { scope: 'organization' } }] },
    'ORGANIZATION_LINK_PRESENT',
  ],
  [{ value: [{ invitation: {} }] }, 'INVITATION_PRESENT'],
]) {
  result = await inspect({ permissions });
  assert.equal(result.private, false);
  assert.equal(result.reason, reason);
}
for (const folder of [
  { id: 'folder', folder: {}, parentReference: { driveId: 'other' } },
  { id: 'different', folder: {}, parentReference: { driveId: 'drive' } },
  { id: 'folder', file: {}, parentReference: { driveId: 'drive' } },
  {
    id: 'folder',
    folder: {},
    parentReference: { driveId: 'drive' },
    remoteItem: {},
  },
])
  assert.equal((await inspect({ folder })).private, false);
assert.equal(
  (await inspect({ drive: { id: 'other' }, full: { id: 'drive' } })).private,
  false,
);
assert.equal(
  (await inspect({ drive: { id: 'drive' }, full: { id: 'other' } })).private,
  false,
);
await assert.rejects(
  () => inspect({ caller: 'other' }),
  (e) => e.status === 403,
);
const drive = { id: 'drive', owner: { user: { id: 'known-owner' } } };
assert.equal(
  (
    await inspect({
      drive,
      permissions: {
        value: [{ grantedToV2: { user: { id: 'known-owner' } } }],
      },
    })
  ).private,
  true,
);
assert.equal(
  (
    await inspect({
      drive,
      permissions: { value: [{ grantedTo: { user: { id: 'other' } } }] },
    })
  ).reason,
  'OTHER_PRINCIPAL_PRESENT',
);
assert.equal(
  (await inspect({ drive, permissions: { value: [{}] } })).reason,
  'PERMISSION_IDENTITY_UNAVAILABLE',
);
console.log(
  'PASS optional owner: own drive + local folder + complete empty ACL required; foreign/remote/incomplete/unknown/shared denied, owner-only ACL preserved; zero writes/network',
);
