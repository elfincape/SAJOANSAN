import {
  normalizeDraft,
  newDraft,
  fixedDriverIssues,
} from './gimhae-dispatch-model.js';
const TABLE = 'dispatch_message_drafts';
function check(error) {
  if (!error) return;
  throw Error(
    ['PT409', '23505'].includes(error.code)
      ? '다른 창에서 저장된 내용이 있습니다. 사본으로 저장하거나 다시 불러와 주세요.'
      : 'DB 요청에 실패했습니다. 현재 입력은 유지됩니다. 로그인과 연결 상태를 확인해 주세요.',
  );
}
export async function listDrafts(client, center) {
  const { data, error } = await client
    .from(TABLE)
    .select('id,business_date,revision,updated_at')
    .eq('center_code', center)
    .eq('record_kind', 'draft')
    .order('business_date', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(100);
  check(error);
  return data || [];
}
export async function loadDraft(client, center, id) {
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('center_code', center)
    .eq('id', id)
    .eq('record_kind', 'draft')
    .maybeSingle();
  check(error);
  if (!data || data.center_code !== center)
    throw Error('저장 내역이 없거나 열람 권한이 없습니다.');
  return { ...data, payload: normalizeDraft(data.payload) };
}
export async function saveDraft(client, center, draft, id, revision) {
  const payload = normalizeDraft(draft);
  const { data, error } = await client.rpc('save_dispatch_message_draft', {
    p_id: id || null,
    p_center: center,
    p_date: payload.date,
    p_payload: payload,
    p_revision: revision,
  });
  check(error);
  if (
    !data?.id ||
    data.center_code !== center ||
    data.revision !== revision + 1
  )
    throw Error('저장 응답을 확인하지 못했습니다. 저장 내역을 확인해 주세요.');
  return data;
}
export async function loadFixedDefaults(client, center) {
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('center_code', center)
    .eq('record_kind', 'fixed-defaults')
    .maybeSingle();
  check(error);
  return data ? { ...data, payload: normalizeDraft(data.payload) } : null;
}
export async function saveFixedDefaults(client, center, rows, id, revision) {
  const draft = newDraft(undefined, rows);
  draft.recordKind = 'fixed-defaults';
  const errors = fixedDriverIssues(draft.fixedDrivers);
  if (errors.length) throw Error(errors[0]);
  return saveDraft(client, center, draft, id, revision);
}
export async function analyze(client, center, draft, mode) {
  const body = { mode, center, date: draft.date };
  if (mode === 'request') {
    const match = draft.image.match(
      /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/,
    );
    if (!match) throw Error('요청 사진을 먼저 등록해 주세요.');
    body.mediaType = match[1];
    body.imageBase64 = match[2];
  } else {
    if (!draft.replyText.trim())
      throw Error('운수사 회신 원문을 입력해 주세요.');
    body.text = draft.replyText;
  }
  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();
  if (sessionError || !sessionData.session)
    throw Error('로그인이 필요합니다. 입력 내용은 유지됩니다.');
  const { data, error } = await client.functions.invoke(
    'gimhae-dispatch-parse',
    {
      body,
      headers: { Authorization: 'Bearer ' + sessionData.session.access_token },
      signal: AbortSignal.timeout(105000),
    },
  );
  if (error) {
    let detail;
    try {
      detail = await error.context?.json();
    } catch {
      /* Network errors have no response body. */
    }
    throw Error(
      typeof detail?.error === 'string'
        ? detail.error
        : '분석 API 연결에 실패했습니다. 원문은 유지됩니다. 다시 시도해 주세요.',
    );
  }
  if (data?.error || !data?.result)
    throw Error(
      typeof data?.error === 'string'
        ? data.error
        : '분석 응답이 올바르지 않습니다.',
    );
  return data.result;
}
export async function imageData(file) {
  if (
    !file ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 15000000
  )
    throw Error('JPG·PNG·WEBP 사진을 15MB 이하로 붙여넣어 주세요.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 50000000)
      throw Error('이미지 해상도가 너무 큽니다. 요청표 부분만 캡처해 주세요.');
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', 0.9);
    if (result.length > 2800000)
      throw Error('요청표 부분만 캡처하거나 더 작은 사진을 붙여넣어 주세요.');
    return result;
  } finally {
    bitmap.close();
  }
}
