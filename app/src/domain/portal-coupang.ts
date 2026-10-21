import type { PortalTask } from './portal-types';
export function coupangEntryDate(task: PortalTask) {
  const parts = task.created_at
      ? Object.fromEntries(
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          })
            .formatToParts(new Date(task.created_at))
            .map((part) => [part.type, part.value]),
        )
      : null,
    registered = parts
      ? parts.year + '-' + parts.month + '-' + parts.day
      : task.work_date,
    date = new Date(registered + 'T00:00:00Z');
  if (!Number.isFinite(+date)) throw Error('업무 등록일을 확인해 주세요.');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
export interface CoupangGenerated {
  type: string;
  jobId: string;
  taskId: string;
  captureRange: string;
  entryDate: string;
  buffer: ArrayBuffer;
  schedule: unknown[];
  dispatch: string;
  filename: string;
  image: Blob | null;
  imageError?: string;
}
export function validCoupangGenerated(data: CoupangGenerated, date: string) {
  return (
    /^G3:[A-Z]{1,3}[1-9][0-9]{0,3}$/.test(data.captureRange) &&
    data.entryDate === date &&
    data.buffer instanceof ArrayBuffer &&
    !!data.buffer.byteLength &&
    data.buffer.byteLength <= 10 * 1024 * 1024 &&
    Array.isArray(data.schedule) &&
    data.schedule.length <= 1000 &&
    typeof data.dispatch === 'string' &&
    typeof data.filename === 'string' &&
    data.filename.endsWith('.xlsx') &&
    ((data.image === null &&
      typeof data.imageError === 'string' &&
      !!data.imageError.trim() &&
      data.imageError.length <= 2000) ||
      (data.image instanceof Blob &&
        data.image.type === 'image/png' &&
        !!data.image.size &&
        data.image.size <= 10 * 1024 * 1024))
  );
}
export interface CoupangResult {
  files: string[];
  dispatch: string;
  schedule?: unknown[];
  capture_range?: string;
  entry_date?: string;
  generated_at?: string;
  image_error?: string | null;
}
export interface CoupangPending {
  captureRange: string;
  entryDate: string;
  generatedAt: string;
  dispatch: string;
  schedule: unknown[];
  imageError?: string;
  files: { id: string; file: File; saved?: boolean; fileId?: string }[];
}
export interface CoupangSession {
  file: File | null;
  source: { id: string; saved: boolean; fileId?: string } | null;
  fingerprint?: string;
  pending: CoupangPending | null;
}
export const coupangSessions = new Map<string, CoupangSession>();
