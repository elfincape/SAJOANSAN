import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  APPROVED_MAIL_TARGET,
  createAnonymousDestinationCheck,
  isMailDestinationItem,
  validateMailPermissions,
} from '../supabase/functions/onedrive-auth/private-mail-policy.js';
const box = {
  id: APPROVED_MAIL_TARGET.mailbox_id,
  owner_id: APPROVED_MAIL_TARGET.owner_id,
  drive_id: 'fixture-drive',
  folder_id: 'fixture-folder',
};
const fingerprint = createHash('sha256')
  .update('fixture-drive|fixture-folder')
  .digest('hex');
const approval = { ...APPROVED_MAIL_TARGET, destination_sha256: fingerprint };
const check = createAnonymousDestinationCheck(approval);
approval.destination_sha256 = 'changed'; // Later mutation cannot broaden the pin.
assert.equal(await check(box.owner_id, box), true);
assert.equal(
  await check(box.owner_id, { ...box, drive_id: 'FIXTURE-DRIVE' }),
  true,
);
for (const change of [
  { id: 'other' },
  { owner_id: 'other' },
  { drive_id: 'other' },
  { folder_id: 'other' },
  { folder_id: 'FIXTURE-FOLDER' },
  { drive_id: 'fixture|drive' },
  { folder_id: '../folder' },
])
  assert.equal(await check(box.owner_id, { ...box, ...change }), false);
assert.equal(await check('other', box), false);
assert.equal(await check(undefined, box), false);
assert.equal(
  await createAnonymousDestinationCheck(APPROVED_MAIL_TARGET)(
    box.owner_id,
    box,
  ),
  false,
);
const folder = {
  id: box.folder_id,
  folder: {},
  parentReference: { driveId: box.drive_id },
};
const file = {
  id: 'fixture-file',
  file: {},
  parentReference: { driveId: box.drive_id, id: box.folder_id },
};
assert.equal(isMailDestinationItem(box, folder.id, folder), true);
assert.equal(isMailDestinationItem(box, file.id, file), true);
for (const bad of [
  { ...file, remoteItem: {} },
  { ...file, parentReference: { driveId: 'other', id: box.folder_id } },
  { ...file, parentReference: { driveId: box.drive_id, id: 'sibling' } },
  { ...file, folder: {}, file: undefined },
  { ...file, id: 'other' },
])
  assert.equal(isMailDestinationItem(box, file.id, bad), false);
assert.equal(
  isMailDestinationItem(box, folder.id, { ...folder, remoteItem: {} }),
  false,
);
const fail = (s, status = 400) => Object.assign(Error(s), { status });
const anonymous = { link: { scope: 'anonymous' }, roles: ['read'] };
assert.doesNotThrow(() =>
  validateMailPermissions({ value: [anonymous] }, undefined, true, fail),
);
// Graph grantedToIdentitiesV2 is a link-type facet, not a second direct grant.
for (const metadata of [
  { grantedToIdentitiesV2: [{ user: { displayName: 'Fixture' } }] },
  { grantedToIdentities: [{ user: { id: 'fixture-link-recipient' } }] },
])
  assert.doesNotThrow(() =>
    validateMailPermissions(
      { value: [{ ...anonymous, ...metadata }] },
      undefined,
      true,
      fail,
    ),
  );
for (const identity of [
  { grantedTo: { user: { id: 'drive-owner' } } },
  { grantedToV2: { user: { id: 'drive-owner' } } },
])
  assert.doesNotThrow(() =>
    validateMailPermissions({ value: [identity] }, 'drive-owner', false, fail),
  );
assert.throws(
  () =>
    validateMailPermissions(
      { value: [{ grantedTo: { user: {} } }] },
      'drive-owner',
      true,
      fail,
    ),
  /PERMISSION_IDENTITY_UNAVAILABLE/,
);
assert.throws(
  () =>
    validateMailPermissions(
      { value: [{ grantedToV2: { user: {} } }] },
      'drive-owner',
      true,
      fail,
    ),
  (e) => e.mailDiagnostic === 'DIRECT_IDENTITY_UNAVAILABLE',
);
assert.throws(
  () =>
    validateMailPermissions(
      { value: [{ ...anonymous, grantedToIdentitiesV2: 'malformed' }] },
      undefined,
      true,
      fail,
    ),
  (e) => e.mailDiagnostic === 'LINK_IDENTITIES_MALFORMED',
);
assert.throws(
  () =>
    validateMailPermissions(
      { value: [{ ...anonymous, grantedTo: { user: { id: 'other' } } }] },
      undefined,
      true,
      fail,
    ),
  (e) => e.mailDiagnostic === 'LINK_HAS_DIRECT_GRANT',
);
assert.throws(
  () => validateMailPermissions({ value: [anonymous] }, undefined, false, fail),
  /ANONYMOUS_LINK_PRESENT/,
);
for (const [permissions, reason] of [
  [
    { value: [anonymous], '@odata.nextLink': 'https://fixture.test/next' },
    'PERMISSIONS_INCOMPLETE',
  ],
  [{}, 'PERMISSIONS_INCOMPLETE'],
  [{ value: [anonymous, {}] }, 'DRIVE_OWNER_UNAVAILABLE'],
  [
    { value: [anonymous, { grantedTo: { user: { id: 'other' } } }] },
    'OTHER_PRINCIPAL_PRESENT',
  ],
  [{ value: [{ ...anonymous, invitation: {} }] }, 'INVITATION_PRESENT'],
  [
    { value: [{ ...anonymous, grantedTo: { user: { id: 'other' } } }] },
    'PERMISSION_IDENTITY_UNAVAILABLE',
  ],
  [
    { value: [{ ...anonymous, roles: ['unknown'] }] },
    'PERMISSION_IDENTITY_UNAVAILABLE',
  ],
  [
    { value: [{ link: { scope: 'organization' } }] },
    'ORGANIZATION_LINK_PRESENT',
  ],
  [{ value: [{ link: { scope: 'users' } }] }, 'SHARING_LINK_PRESENT'],
])
  assert.throws(
    () =>
      validateMailPermissions(
        permissions,
        reason === 'DRIVE_OWNER_UNAVAILABLE' ? undefined : 'drive-owner',
        true,
        fail,
      ),
    new RegExp(reason),
  );
console.log(
  'PASS exact anonymous destination exception: immutable owner/mailbox/hash pin, local folder/direct file only, changed target and mixed/unknown/shared grants still denied; no network or permission changes',
);
