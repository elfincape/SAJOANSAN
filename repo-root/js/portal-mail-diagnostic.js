import { runMailConnectionDiagnostic } from './private-mail-diagnostic-api.js';
export { MAIL_DIAGNOSTIC_OWNER_ID } from './private-mail-diagnostic-api.js';

export function mountMailDiagnostic({ host, node, button, isActive }) {
  const section = node('section');
  section.id = 'mail-connection-diagnostic';
  section.append(
    node('h3', '클라우드 메일 연결 진단'),
    node(
      'p',
      '비밀번호 없이 Vercel Node.js에서 DNS·TCP 995·TLS 연결/검증·POP 인사말만 확인합니다. 메일 로그인이나 수신은 시작하지 않습니다.',
    ),
  );
  const status = node(
    'p',
    '클라우드 연결 미검증 · 아래 버튼을 눌러 단발 검사를 실행하세요.',
  );
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const results = node('ul');
  const run = button(
    '클라우드 POP 연결 확인',
    async () => {
      if (run.disabled) return;
      run.disabled = true;
      status.textContent = '클라우드에서 연결을 확인하는 중입니다…';
      results.replaceChildren();
      try {
        const result = await runMailConnectionDiagnostic();
        if (!isActive() || !section.isConnected) return;
        status.textContent = result.ok
          ? 'DNS·TCP·TLS·POP 인사말 확인 완료. 메일 계정 로그인은 하지 않았습니다.'
          : '클라우드 연결 진단에 실패했습니다. 실패한 단계를 확인해 주세요.';
        for (const [key, label] of [
          ['dns', 'DNS 확인'],
          ['tcp', 'TCP 995 연결'],
          ['tls', 'TLS 연결/검증'],
          ['greeting', 'POP 인사말'],
        ])
          results.append(
            node(
              'li',
              label +
                ' · ' +
                ({ ok: '성공', failed: '실패', pending: '미실행' }[
                  result.stages?.[key]
                ] || '확인 불가'),
            ),
          );
        if (result.code)
          results.append(
            node(
              'li',
              '결과 코드 · ' + String(result.code).replace(/[^A-Z_]/g, ''),
            ),
          );
        for (const [key, label] of [
          ['tls_phase', 'TLS 실패 지점'],
          ['tls_error', 'TLS 오류 분류'],
          ['execution_region', '실행 지역'],
        ]) {
          if (result[key])
            results.append(
              node(
                'li',
                label +
                  ' · ' +
                  String(result[key])
                    .replace(/[^A-Za-z0-9_-]/g, '')
                    .slice(0, 40),
              ),
            );
        }
        if (result.checked_at)
          results.append(
            node(
              'li',
              '실행 시각 · ' +
                new Date(result.checked_at).toLocaleString('ko-KR'),
            ),
          );
      } catch (error) {
        if (isActive() && section.isConnected)
          status.textContent = error.message;
      } finally {
        run.disabled = false;
      }
    },
    section,
  );
  section.append(status, results);
  host.append(section);
}
