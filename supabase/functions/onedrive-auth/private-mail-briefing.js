import { BRIEFING_TARGET } from './private-mail-briefing-model.js';

// Read-only capability check; no consent, token export, page creation or PATCH.
export async function inspectBriefingTarget({ connected, graph }) {
  let connection;
  try {
    connection = await connected();
  } catch {
    return {
      readable: false,
      writeVerified: false,
      reason: 'MICROSOFT_CONNECTION_REQUIRED',
    };
  }
  try {
    const notebook = await (
      await graph(
        '/me/onenote/notebooks/' +
          encodeURIComponent(BRIEFING_TARGET.notebookId) +
          '?$select=id,displayName,isShared,userRole',
        connection.accessToken,
      )
    ).json();
    if (
      notebook.id !== BRIEFING_TARGET.notebookId ||
      String(notebook.userRole).toLowerCase() !== 'owner'
    )
      return {
        readable: false,
        writeVerified: false,
        reason: 'NOTEBOOK_OWNER_UNVERIFIED',
      };
    if (notebook.isShared !== false)
      return {
        readable: false,
        writeVerified: false,
        reason: notebook.isShared
          ? 'NOTEBOOK_SHARED'
          : 'NOTEBOOK_PRIVACY_UNVERIFIED',
      };
    const section = await (
      await graph(
        '/me/onenote/sections/' +
          encodeURIComponent(BRIEFING_TARGET.sectionId) +
          '?$select=id,displayName&$expand=parentNotebook($select=id)',
        connection.accessToken,
      )
    ).json();
    if (
      section.id !== BRIEFING_TARGET.sectionId ||
      section.parentNotebook?.id !== BRIEFING_TARGET.notebookId
    )
      return {
        readable: false,
        writeVerified: false,
        reason: 'NOTES_TARGET_MISMATCH',
      };
    return {
      readable: true,
      writeVerified: false,
      hasWriteScope: connection.notesGranted === true,
      reason: 'NOTES_WRITE_UNVERIFIED',
      notebookName: String(notebook.displayName || '').slice(0, 200),
      sectionName: String(section.displayName || '').slice(0, 200),
      intervalHours: BRIEFING_TARGET.intervalHours,
    };
  } catch (error) {
    const status = error?.providerStatus ?? error?.status;
    return {
      readable: false,
      writeVerified: false,
      reason: [401, 403].includes(status)
        ? 'NOTES_PERMISSION_REQUIRED'
        : status === 404
          ? 'NOTES_TARGET_UNAVAILABLE'
          : status === 429
            ? 'NOTES_RATE_LIMITED'
            : 'NOTES_CHECK_FAILED',
    };
  }
}
