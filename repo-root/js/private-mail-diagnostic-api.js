import { supabase } from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
export const MAIL_DIAGNOSTIC_OWNER_ID = '2a828c2d-9a6f-40d4-8e13-336b591811cc';
export function mailFolderReason(reason) {
  return (
    {
      DRIVE_OWNER_UNAVAILABLE:
        'OneDrive가 드라이브 소유자 ID를 반환하지 않았습니다. 공유 여부와는 별개입니다.',
      PERMISSIONS_INCOMPLETE:
        'OneDrive 권한 목록을 완전히 확인하지 못했습니다. 공유가 확인된 상태는 아닙니다.',
      PERMISSION_IDENTITY_UNAVAILABLE:
        'OneDrive 권한 항목에 사용자 ID가 없어 소유자와 비교하지 못했습니다.',
      ANONYMOUS_LINK_PRESENT:
        'OneDrive 권한에서 링크를 가진 누구나 접근 가능한 권한을 확인했습니다.',
      ORGANIZATION_LINK_PRESENT:
        'OneDrive 권한에서 조직 구성원이 접근 가능한 링크를 확인했습니다.',
      SHARING_LINK_PRESENT:
        'OneDrive 권한에 링크 항목이 있으나 접근 대상을 확정하지 못했습니다. 입력 URL 형식 때문에 거절한 것이 아닙니다.',
      INVITATION_PRESENT: 'OneDrive 권한에 초대 항목이 있습니다.',
      OTHER_PRINCIPAL_PRESENT:
        'OneDrive 권한에서 드라이브 소유자 이외의 사용자 접근을 확인했습니다.',
    }[reason] ||
    'OneDrive 소유권 또는 권한 조회를 완료하지 못했습니다. 추가 권한은 부여하지 않았습니다.'
  );
}
export async function runMailConnectionDiagnostic() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session || session.user?.id !== MAIL_DIAGNOSTIC_OWNER_ID)
    throw new Error('본인 계정으로 다시 로그인해 주세요.');
  const response = await fetch(
    SUPABASE_URL + '/functions/v1/private-mail-diagnostic',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + session.access_token,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.error ||
        '연결 진단을 실행하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
  return response.json();
}

export async function runMailCollection(mode = 'collect') {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session || session.user?.id !== MAIL_DIAGNOSTIC_OWNER_ID)
    throw Error('본인 계정으로 다시 로그인해 주세요.');
  const response = await fetch('/api/private-mail-collect', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode }),
    signal: AbortSignal.timeout(95000),
  });
  if (!response.ok)
    throw Error(
      response.status === 503
        ? '메일 수신 설정 또는 실행 상태를 확인해 주세요.'
        : '메일 수신 권한을 확인해 주세요.',
    );
  return response.json();
}

export async function configurePrivateMailFolder(url, configure = true) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session || session.user?.id !== MAIL_DIAGNOSTIC_OWNER_ID)
    throw Error('본인 계정으로 다시 로그인해 주세요.');
  const response = await fetch(
    SUPABASE_URL + '/functions/v1/onedrive-auth/private-mail-folder',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + session.access_token,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, configure }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw Error(mailFolderReason(failure.error));
  }
  return response.json();
}
