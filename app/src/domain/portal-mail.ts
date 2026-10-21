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
  last_counts?: { oversized?: number; undated?: number; deferred?: number };
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
