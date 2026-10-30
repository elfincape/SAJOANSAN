import { supabase } from './supabase';
import { oneDriveCall } from './onedrive';
import { MAIL_DIAGNOSTIC_OWNER_ID } from '../domain/portal-mail';
import type {
  Mailbox,
  MailMessage,
  MailCollectionProgress,
} from '../domain/portal-mail';
export const privateMail = {
  status: () => oneDriveCall<{ mailboxes: Mailbox[] }>('private-mail-status'),
  list: (query = '', offset = 0) =>
    oneDriveCall<{ messages: MailMessage[]; more: boolean }>(
      'private-mail-list',
      { query, offset },
    ),
  detail: (id: string) =>
    oneDriveCall<{ message: MailMessage }>('private-mail-detail', { id }),
  download: (id: string, index: number) =>
    oneDriveCall<Blob>('private-mail-download', { id, index }, true),
};
export async function runMailCollection(
  mode = 'collect',
  continuous = false,
  identity?: { requestId: string; cycleId?: string },
): Promise<{
  counts?: { saved?: number; deferred?: number };
  progress?: MailCollectionProgress;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session || session.user?.id !== MAIL_DIAGNOSTIC_OWNER_ID)
    throw Error('본인 계정으로 다시 로그인해 주세요.');
  let response: Response;
  try {
    response = await fetch('/api/private-mail-collect', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode, continuous, ...identity }),
      signal: AbortSignal.timeout(255000),
    });
  } catch {
    throw Object.assign(
      Error(
        '메일 서버 응답을 기다리지 못했습니다. 저장 위치에서 다시 시도합니다.',
      ),
      { code: 'NETWORK_ERROR' },
    );
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const allowed = new Set([
      'BATCH_TIMEOUT',
      'FILE_UPLOAD_FAILED',
      'COLLECTION_NOT_CONFIGURED',
      'OWNER_SYNC_DISABLED',
      'AUTH_REQUIRED',
      'OWNER_CONNECTION_REQUIRED',
      'MAILBOX_TARGET_REJECTED',
      'OWNER_FOLDER_REQUIRED',
      'DRIVE_OWNER_UNAVAILABLE',
      'PERMISSIONS_INCOMPLETE',
      'ANONYMOUS_LINK_PRESENT',
      'ORGANIZATION_LINK_PRESENT',
      'SHARING_LINK_PRESENT',
      'INVITATION_PRESENT',
      'PERMISSION_IDENTITY_UNAVAILABLE',
      'OTHER_PRINCIPAL_PRESENT',
      'MAILBOX_BUSY',
      'FOLDER_CHECK_FAILED',
      'BEGIN_FAILED',
      'POP_CONNECTION_FAILED',
      'POP_LOGIN_FAILED',
      'POP_USER_REJECTED',
      'POP_PASSWORD_REJECTED',
      'POP_AUTH_TIMEOUT',
      'POP_AUTH_CLOSED',
      'POP_AUTH_PROTOCOL_ERROR',
      'POP_MAILBOX_BUSY',
      'POP_LOGIN_DELAY',
      'POP_AUTH_SERVER_ERROR',
      'COLLECTION_FAILED',
      'FINALIZE_FAILED',
      'COLLECTION_CHANGED',
    ]);
    const code = allowed.has(failure.code) ? failure.code : 'REQUEST_FAILED';
    const stages: Record<string, string> = {
      configuration: '서버 설정',
      begin: '메일함 준비',
      connect: '메일 서버 연결',
      login: '메일 로그인',
      collect: '메일 저장',
      finalize: '수신 상태 기록',
    };
    throw Object.assign(
      Error((stages[failure.stage] || '메일 수신') + ' 실패 · ' + code),
      { code, status: response.status },
    );
  }
  return response.json();
}
