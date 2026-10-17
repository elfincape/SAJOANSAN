import { runMailCollection } from './private-mail-diagnostic-api.js';
export { MAIL_DIAGNOSTIC_OWNER_ID } from './private-mail-diagnostic-api.js';

export function mountMailReceipt({ host, node, button, isActive }) {
  const status = node('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const receive = button(
    '메일 가져오기',
    async () => {
      if (receive.disabled) return;
      receive.disabled = true;
      status.textContent = '메일을 가져오는 중…';
      try {
        const result = await runMailCollection();
        if (isActive() && status.isConnected)
          status.textContent =
            Number(result.counts?.saved || 0) +
            '건 저장' +
            (result.counts?.deferred
              ? ' · 대기 ' + Number(result.counts.deferred) + '건'
              : '');
      } catch {
        if (isActive() && status.isConnected)
          status.textContent = '메일을 가져오지 못했습니다.';
      } finally {
        receive.disabled = false;
      }
    },
    host,
  );
  host.append(status);
}
