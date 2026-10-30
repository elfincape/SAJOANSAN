import { BRIEFING_TARGET } from './private-mail-briefing-model.js';
export const NOTES_SCOPES = 'offline_access Notes.ReadWrite';
export function notesGranted(scope) {
  return (
    typeof scope === 'string' &&
    scope
      .split(/\s+/)
      .some(
        (value) =>
          value.toLowerCase().replace('https://graph.microsoft.com/', '') ===
          'notes.readwrite',
      )
  );
}
export async function startNotesAuth(
  user,
  { db, seal, hash, json, clientId, redirect, base64url },
) {
  const state = base64url(crypto.getRandomValues(new Uint8Array(32))),
    proof = base64url(crypto.getRandomValues(new Uint8Array(32))),
    verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await db('onedrive_oauth', {
    method: 'POST',
    body: {
      state_hash: await hash(state),
      proof_hash: await hash(proof),
      user_id: user.id,
      purpose: 'mail-briefing',
      stage: 'started',
      encrypted_data: await seal({
        verifier,
        purpose: 'mail-briefing',
        returnPath: '/portal/?view=mail',
      }),
      expires_at: new Date(Date.now() + 600000).toISOString(),
    },
  });
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirect,
    response_mode: 'query',
    scope: NOTES_SCOPES,
    state,
    code_challenge: await hash(verifier),
    code_challenge_method: 'S256',
    prompt: 'consent',
  });
  return json({
    state,
    proof,
    authorizationUrl:
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?' +
      query,
  });
}
export async function completeNotesAuth(
  tokens,
  stateHash,
  { graph, db, seal, fail },
) {
  if (!notesGranted(tokens.scope) || !tokens.refresh_token)
    throw fail('OneNote 읽기·쓰기와 연결 유지 동의가 필요합니다.', 409);
  const notebook = await (
    await graph(
      '/me/onenote/notebooks/' +
        encodeURIComponent(BRIEFING_TARGET.notebookId) +
        '?$select=id,isShared,userRole',
      tokens.access_token,
    )
  ).json();
  if (
    notebook.id !== BRIEFING_TARGET.notebookId ||
    notebook.isShared !== false ||
    String(notebook.userRole).toLowerCase() !== 'owner'
  )
    throw fail('선택한 비공개 노트북의 소유자 계정으로 연결해 주세요.', 403);
  const section = await (
    await graph(
      '/me/onenote/sections/' +
        encodeURIComponent(BRIEFING_TARGET.sectionId) +
        '?$select=id&$expand=parentNotebook($select=id)',
      tokens.access_token,
    )
  ).json();
  if (
    section.id !== BRIEFING_TARGET.sectionId ||
    section.parentNotebook?.id !== BRIEFING_TARGET.notebookId
  )
    throw fail('일일정리 섹션을 확인할 수 없습니다.', 403);
  const payload = {
    purpose: 'mail-briefing',
    notesGranted: true,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  await db('onedrive_oauth?state_hash=eq.' + encodeURIComponent(stateHash), {
    method: 'PATCH',
    body: { encrypted_data: await seal(payload), stage: 'ready' },
  });
}
