// Existing anonymous-link exposure was explicitly accepted for this one target.
// This changes no Graph permission and contains no sharing URL or capability.
export const APPROVED_MAIL_TARGET = Object.freeze({
  owner_id: '2a828c2d-9a6f-40d4-8e13-336b591811cc',
  mailbox_id: '39045005-313e-42e1-b50c-2394b3b6ff26',
  destination_sha256:
    '1fecfaefdbeaaeeef2f2dd58259166ad0aa6f7804bea258a41fb1d0dd2d741a2',
});

export function createAnonymousDestinationCheck(approval) {
  const pin = Object.freeze({ ...approval });
  return async (actorId, box) => {
    if (
      actorId !== pin.owner_id ||
      box.owner_id !== pin.owner_id ||
      box.id !== pin.mailbox_id ||
      !/^[A-Za-z0-9!_-]+$/.test(box.drive_id || '') ||
      !/^[A-Za-z0-9!_-]+$/.test(box.folder_id || '')
    )
      return false;
    const bytes = new TextEncoder().encode(
      box.drive_id.toLowerCase() + '|' + box.folder_id,
    );
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (v) => v.toString(16).padStart(2, '0'),
    ).join('');
    return digest === pin.destination_sha256;
  };
}

export function isMailDestinationItem(box, itemId, item) {
  return (
    item?.id === itemId &&
    !item.remoteItem &&
    String(item.parentReference?.driveId).toLowerCase() ===
      box.drive_id.toLowerCase() &&
    (itemId === box.folder_id
      ? !!item.folder
      : !!item.file && item.parentReference?.id === box.folder_id)
  );
}

export function validateMailPermissions(
  permissions,
  owner,
  anonymousAllowed,
  fail,
) {
  if (!Array.isArray(permissions.value))
    throw fail('PERMISSIONS_INCOMPLETE', 409);
  let missingIdentity = false,
    otherPermissions = 0;
  for (const p of permissions.value) {
    if (p.invitation) throw fail('INVITATION_PRESENT', 409);
    const identities = [
      p.grantedToV2,
      p.grantedTo,
      ...(p.grantedToIdentitiesV2 || []),
      ...(p.grantedToIdentities || []),
    ].filter(Boolean);
    if (p.link) {
      if (anonymousAllowed && p.link.scope === 'anonymous') {
        // A mixed/unknown grant is outside the narrow link-only approval.
        if (
          identities.length ||
          (p.roles &&
            (!Array.isArray(p.roles) ||
              p.roles.some((r) => !['read', 'write'].includes(r))))
        )
          throw fail('PERMISSION_IDENTITY_UNAVAILABLE', 409);
        continue;
      }
      throw fail(
        p.link.scope === 'anonymous'
          ? 'ANONYMOUS_LINK_PRESENT'
          : p.link.scope === 'organization'
            ? 'ORGANIZATION_LINK_PRESENT'
            : 'SHARING_LINK_PRESENT',
        409,
      );
    }
    otherPermissions++;
    if (owner && identities.some((i) => i.user?.id && i.user.id !== owner))
      throw fail('OTHER_PRINCIPAL_PRESENT', 409);
    if (!identities.length || identities.some((i) => !i.user?.id))
      missingIdentity = true;
  }
  if (permissions['@odata.nextLink']) throw fail('PERMISSIONS_INCOMPLETE', 409);
  if (!owner && otherPermissions) throw fail('DRIVE_OWNER_UNAVAILABLE', 409);
  if (missingIdentity) throw fail('PERMISSION_IDENTITY_UNAVAILABLE', 409);
}
