import { supabase } from './supabase.js';
export const MAIL_DIAGNOSTIC_OWNER_ID = '2a828c2d-9a6f-40d4-8e13-336b591811cc';
export async function runMailConnectionDiagnostic() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session || session.user?.id !== MAIL_DIAGNOSTIC_OWNER_ID)
    throw new Error('본인 계정으로 다시 로그인해 주세요.');
  const response = await fetch('/api/private-mail-diagnostic', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.error ||
        '연결 진단을 실행하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
  return response.json();
}
