import type { CoupangPending } from '../domain/portal-coupang';
import type { PortalFile } from './portal-files';
import { createWorkspaceStore } from './workspace-session';

const uuid = (value: unknown) => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const coupangCheckpoints = createWorkspaceStore<CoupangPending>('coupang-run', value =>
  uuid(value.runId) && uuid(value.sourceFileId) &&
  ['resultBefore', 'inputDispatch', 'dispatch', 'captureRange', 'entryDate', 'generatedAt']
    .every(key => typeof value[key as keyof CoupangPending] === 'string') &&
  Number.isInteger(value.taskVersion) && Array.isArray(value.schedule) && value.schedule.length <= 1000 &&
  Array.isArray(value.files) && value.files.length >= 1 && value.files.length <= 2 &&
  new Set(value.files.map(file => file.id)).size === value.files.length &&
  value.files.every(file => uuid(file.id) && file.file === null &&
    typeof file.name === 'string' && file.name.length > 0 && file.name.length <= 255 &&
    typeof file.mime === 'string' && Number.isInteger(file.byteSize) &&
    file.byteSize! > 0 && file.byteSize! <= 10 * 1024 * 1024 &&
    /^[0-9a-f]{64}$/.test(file.sha256 ?? '') && (!file.fileId || uuid(file.fileId)))
);

async function fingerprint(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function restoreCoupangRun(key: string) {
  const stored = coupangCheckpoints.get(key);
  return stored ? {
    ...structuredClone(stored),
    files: stored.files.map(file => ({ ...file, file: null, saved: false })),
  } : null;
}

export async function rememberCoupangRun(key: string, pending: CoupangPending) {
  for (const entry of pending.files) {
    if (!entry.sha256 && entry.file) {
      entry.name = entry.file.name;
      entry.byteSize = entry.file.size;
      entry.mime = entry.file.type;
      entry.sha256 = await fingerprint(entry.file);
    }
  }
  coupangCheckpoints.set(key, {
    ...pending,
    files: pending.files.map(file => ({ ...file, file: null })),
  });
}

export function reconcileCoupangFiles(pending: CoupangPending, rows: PortalFile[], actor: string) {
  for (const entry of pending.files) {
    const row = rows.find(file => file.request_id === entry.id && file.uploaded_by === actor);
    if (entry.fileId && (!row || row.id !== entry.fileId))
      throw Error('이전에 보관한 파일의 현재 상태를 확인하지 못했습니다. 기존 파일 참조를 유지합니다.');
    if (row && (row.original_name !== entry.name || row.byte_size !== entry.byteSize || row.mime_type !== entry.mime))
      throw Error('보관된 파일과 재개 정보가 다릅니다. 원본을 확인해 주세요.');
    entry.saved = row?.status === 'saved';
    if (row) entry.fileId = row.id;
  }
}

export async function reselectCoupangFile(entry: CoupangPending['files'][number], file: File) {
  if (file.name !== entry.name || file.size !== entry.byteSize || await fingerprint(file) !== entry.sha256)
    throw Error('생성 당시 파일과 내용이 다릅니다. 이름·크기·SHA256이 같은 파일을 선택해 주세요.');
  return new File([file], entry.name, { type: entry.mime });
}
