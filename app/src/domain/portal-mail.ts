export function mailHtmlText(source: string) {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  parsed
    .querySelectorAll('script,style,noscript,template')
    .forEach((el) => el.remove());
  parsed.querySelectorAll('br,hr').forEach((el) => el.replaceWith('\n'));
  parsed.querySelectorAll('td,th').forEach((el) => el.append('\t'));
  parsed
    .querySelectorAll('p,div,li,blockquote,pre,tr,h1,h2,h3,h4')
    .forEach((el) => el.append('\n'));
  return (parsed.body.textContent ?? '')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export interface MailFile {
  kind: string;
  index: number;
  name: string;
  size: number;
}
export interface MailMessage {
  id: string;
  subject: string;
  sender: string;
  sent_at: string;
  files: MailFile[];
}
export interface Mailbox {
  enabled: boolean;
  status: string;
  lease_until: string;
  last_success_at: string;
  last_error?: string;
  last_counts?: {
    oversized?: number;
    undated?: number;
    deferred?: number;
    progress?: MailCollectionProgress;
  };
}
export interface MailCollectionProgress {
  cycleId: string;
  total: number;
  processed: number;
  saved: number;
  remaining: number;
  phase: 'collecting' | 'complete';
  skipped?: number;
  undated?: number;
  oversized?: number;
  missing?: number;
}
export async function collectAllMail({
  collect,
  onProgress,
  shouldStop,
  pause = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  collect: () => Promise<{ progress?: MailCollectionProgress }>;
  onProgress: (progress: MailCollectionProgress) => void;
  shouldStop: () => boolean;
  pause?: (ms: number) => Promise<void>;
}): Promise<MailCollectionProgress | null> {
  let latest: MailCollectionProgress | null = null,
    retries = 0,
    stalled = 0;
  while (!shouldStop()) {
    let result;
    try {
      result = await collect();
      retries = 0;
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : '';
      if (shouldStop()) return latest;
      if (
        ![
          'BATCH_TIMEOUT',
          'FILE_UPLOAD_FAILED',
          'COLLECTION_FAILED',
          'FINALIZE_FAILED',
          'MAILBOX_BUSY',
          'POP_MAILBOX_BUSY',
          'NETWORK_ERROR',
        ].includes(code) ||
        retries >= 2
      )
        throw error;
      await pause(1000 * ++retries);
      continue;
    }
    const next = result.progress;
    if (
      !next ||
      typeof next.cycleId !== 'string' ||
      !next.cycleId ||
      ![next.total, next.processed, next.saved, next.remaining].every(
        (value) => Number.isInteger(value) && value >= 0,
      ) ||
      next.total > 50000 ||
      next.processed + next.remaining !== next.total ||
      next.saved > next.processed ||
      next.phase !== (next.remaining ? 'collecting' : 'complete') ||
      (latest &&
        (next.cycleId !== latest.cycleId ||
          next.total !== latest.total ||
          next.processed < latest.processed ||
          next.saved < latest.saved))
    )
      throw Error(
        '수집 진행 정보를 확인하지 못했습니다. 다시 시작하면 저장 위치에서 이어받습니다.',
      );
    stalled = latest && next.processed === latest.processed ? stalled + 1 : 0;
    if (stalled >= 2)
      throw Error(
        '수집 진행이 멈췄습니다. 다시 시작하면 저장 위치에서 이어받습니다.',
      );
    latest = next;
    onProgress(next);
    if (next.phase === 'complete') return next;
  }
  return latest;
}
export const MAIL_DIAGNOSTIC_OWNER_ID = '2a828c2d-9a6f-40d4-8e13-336b591811cc';
export function mailboxState(box: Mailbox, now = Date.now()) {
  const stale = box.status === 'running' && Date.parse(box.lease_until) < now;
  return {
    stale,
    label: !box.enabled
      ? '수집 중지'
      : stale
        ? '수집 중단 · 서버 점검 필요'
        : (
            {
              running: '수집 중',
              error: '수집 실패 · 서버 점검 필요',
              ready: '수집 대기',
              disabled: '수집 중지',
            } as Record<string, string>
          )[box.status] || '상태 확인 필요',
  };
}
