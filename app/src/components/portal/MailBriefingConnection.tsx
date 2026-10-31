import { useCallback, useEffect, useRef, useState } from 'react';
import { privateMail } from '../../lib/portal-mail';
import { connectOneDrive } from '../../lib/onedrive';

type AutomationStatus = Awaited<
  ReturnType<typeof privateMail.automationStatus>
>;
const reasons: Record<string, string> = {
  AUTH_REQUIRED: '본인 계정으로 다시 로그인해 주세요.',
  OWNER_ONLY: '본인 계정에서만 사용할 수 있습니다.',
  OWNER_REQUIRED: '본인 계정에서만 사용할 수 있습니다.',
  AUTOMATION_SCHEMA_REQUIRED: '서버 자동화를 준비하고 있습니다.',
  AUTOMATION_CONNECTION_REQUIRED:
    '서버 자동화 실행 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.',
  AI_NOT_CONFIGURED: 'AI 분석 연결이 준비되지 않았습니다.',
  MAILBOX_BUSY_OR_AUTOMATION_DISABLED:
    '현재 작업이 진행 중이거나 자동화가 일시정지되어 있습니다.',
  NO_ACTIVE_JOB: '현재 중지할 작업이 없습니다. 상태를 다시 확인해 주세요.',
  OWNER_CONNECTION_REQUIRED: '본인의 Microsoft 계정을 먼저 연결해 주세요.',
  MICROSOFT_CONNECTION_REQUIRED: 'Microsoft 계정을 먼저 연결해 주세요.',
  NOTES_PERMISSION_REQUIRED: 'OneNote 읽기·쓰기 권한을 연결해 주세요.',
  NOTES_TARGET_UNAVAILABLE:
    '할 일 목록 노트북의 일일정리 섹션에 접근할 수 없습니다.',
  NOTEBOOK_SHARED: '대상 노트북의 공유 설정을 확인해 주세요.',
  NOTES_RATE_LIMITED: 'OneNote 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
  ANALYSIS_NOT_CONFIGURED: 'AI 분석 연결이 준비되지 않았습니다.',
  AUTOMATION_NOT_CONFIGURED: '서버 자동화를 준비하고 있습니다.',
  AUTOMATION_SCHEMA_NOT_READY: '서버 자동화를 준비하고 있습니다.',
  AUTOMATION_WORKER_NOT_READY: '서버 작업 실행 준비가 필요합니다.',
  MAILBOX_BUSY: '현재 메일 수집이 진행 중입니다. 완료 후 다시 실행해 주세요.',
};
function readableError(error: unknown, fallback: string) {
  const value =
    error && typeof error === 'object'
      ? (error as { code?: string; message?: string })
      : {};
  return reasons[value.code || ''] || reasons[value.message || ''] || fallback;
}
function stamp(value?: string | null) {
  if (!value) return '없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '확인 필요'
    : date.toLocaleString('ko-KR');
}
const jobLabels: Record<string, string> = {
  queued: '대기 중',
  running: '실행 중',
  complete: '완료',
  stopped: '중지됨',
  failed: '실행 실패',
};
const analysisLabels: Record<string, string> = {
  ready: '분석 완료',
  pending: '분석 대기',
  queued: '분석 대기',
  running: '분석 중',
  processing: '분석 중',
  complete: '분석 완료',
  completed: '분석 완료',
  failed: '분석 실패',
  skipped: '분석 제외',
  saved: '저장 완료',
};

export function MailBriefingConnection() {
  const [data, setData] = useState<AutomationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [loadError, setLoadError] = useState(false);
  const mounted = useRef(false);
  const request = useRef(0);
  const statusPending = useRef<number | null>(null);
  const locked = useRef(false);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    statusPending.current = id;
    try {
      const result = await privateMail.automationStatus();
      if (!mounted.current || id !== request.current) return;
      setData(result);
      setLoadError(false);
    } catch (error) {
      if (mounted.current && id === request.current) {
        setLoadError(true);
        setFeedback(
          readableError(
            error,
            '자동화 상태를 확인하지 못했습니다. 상태를 다시 확인해 주세요.',
          ),
        );
      }
    } finally {
      if (statusPending.current === id) statusPending.current = null;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [refresh]);
  const running =
    data?.job?.status === 'queued' || data?.job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (!locked.current && statusPending.current === null) void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [running, refresh]);
  async function act(
    action: () => Promise<unknown>,
    success: string,
    failure: string,
  ) {
    if (locked.current) return;
    locked.current = true;
    request.current++;
    setBusy(true);
    setFeedback('');
    try {
      await action();
      if (!mounted.current) return;
      setFeedback(success);
      await refresh();
    } catch (error) {
      if (mounted.current) setFeedback(readableError(error, failure));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const ready = Boolean(
    data?.schemaReady && data.workerReady && data.schedulerReady,
  );
  const canRun = Boolean(
    ready && data?.config.enabled && !loadError && !running,
  );
  const notesNeedsReconnect = Boolean(
    data?.reports[0]?.error &&
    ['NOTES_PERMISSION_REQUIRED', 'MICROSOFT_CONNECTION_REQUIRED'].includes(
      data.reports[0].error,
    ),
  );
  const setup = !data
    ? loadError
      ? '상태 확인 필요'
      : '상태 확인 중…'
    : !data.schemaReady
      ? '자동화 준비 중'
      : !data.workerReady
        ? '서버 실행 준비 중'
        : !data.schedulerReady
          ? '예약 실행 준비 중'
          : data.config.enabled
            ? '3시간마다 자동화 실행'
            : '자동화 일시정지';
  return (
    <details style={{ width: '100%', minWidth: 0, color: 'var(--theme-text)' }}>
      <summary style={{ cursor: 'pointer', padding: '8px 0' }}>
        <strong>메일 자동화</strong> ·{' '}
        {data?.notesConnected && !notesNeedsReconnect ? (
          <>
            <span>OneNote 연결됨</span> ·{' '}
          </>
        ) : null}
        <span>{setup}</span>
      </summary>
      <div style={{ display: 'grid', gap: 14, padding: '12px 0', minWidth: 0 }}>
        <div>
          <p>
            OneNote (선택 출력){' '}
            {!data
              ? '확인 중…'
              : notesNeedsReconnect
                ? '다시 연결 필요'
                : data.notesConnected
                  ? '연결됨'
                  : '미연결'}{' '}
            · 할 일 목록 → 일일정리
          </p>
          {data ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => connectOneDrive('mail-briefing'),
                  'Microsoft 연결을 진행합니다.',
                  'OneNote 연결을 시작하지 못했습니다. 다시 시도해 주세요.',
                )
              }
            >
              {data.notesConnected ? 'OneNote 다시 연결' : 'OneNote 연결'}
            </button>
          ) : null}
        </div>
        <div>
          <strong>실행 상태</strong>
          <p style={{ fontVariantNumeric: 'tabular-nums' }}>
            예약:{' '}
            {data?.config.enabled
              ? `다음 실행 ${stamp(data.nextRunAt)}`
              : '꺼짐'}{' '}
            · 현재 작업:{' '}
            {data?.job
              ? data.job.stopRequested && running
                ? '중지 요청됨 · 현재 묶음 처리 후 멈춥니다'
                : jobLabels[data.job.status] || '상태 확인 필요'
              : '없음'}
          </p>
          {data?.progress ? (
            <div style={{ fontVariantNumeric: 'tabular-nums' }}>
              <label>
                수집 {data.progress.phase === 'complete' ? '완료' : '진행'}{' '}
                <progress
                  aria-label="수집 진행"
                  max={Math.max(1, data.progress.total)}
                  value={Math.min(
                    data.progress.processed,
                    Math.max(1, data.progress.total),
                  )}
                  style={{ verticalAlign: 'middle', maxWidth: '100%' }}
                />
              </label>
              <p>
                전체 {data.progress.total.toLocaleString()} · 처리{' '}
                {data.progress.processed.toLocaleString()} · 저장{' '}
                {data.progress.saved.toLocaleString()} · 남음{' '}
                {data.progress.remaining.toLocaleString()}
              </p>
            </div>
          ) : null}
          {data?.job?.error ? (
            <p>
              작업을 완료하지 못했습니다. 연결과 준비 상태를 확인한 뒤 다시
              실행해 주세요.
            </p>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              disabled={
                busy ||
                !data?.schemaReady ||
                loadError ||
                (!data.config.enabled && !ready)
              }
              onClick={() => {
                if (!data) return;
                const enabled = !data.config.enabled;
                void act(
                  () => privateMail.automationConfig({ enabled }),
                  enabled
                    ? '자동화를 재개했습니다.'
                    : '자동화를 일시정지했습니다.',
                  '자동화 상태를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.',
                );
              }}
            >
              {data?.config.enabled ? '자동화 일시정지' : '자동화 재개'}
            </button>
            <button
              type="button"
              disabled={busy || !canRun}
              onClick={() =>
                void act(
                  () => privateMail.runAutomation(),
                  '실행을 요청했습니다. 서버 진행 상황을 확인합니다.',
                  '실행 요청을 처리하지 못했습니다. 잠시 후 상태를 다시 확인해 주세요.',
                )
              }
            >
              지금 실행
            </button>
            <button
              type="button"
              disabled={busy || !running || Boolean(data?.job?.stopRequested)}
              onClick={() =>
                void act(
                  async () => {
                    const result = await privateMail.stopAutomation();
                    if (!result.stopped) throw { code: 'NO_ACTIVE_JOB' };
                  },
                  '중지를 요청했습니다. 현재 묶음이 끝나면 멈춥니다.',
                  '중지를 요청하지 못했습니다. 상태를 다시 확인한 뒤 시도해 주세요.',
                )
              }
            >
              현재 묶음 후 중지
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => refresh(),
                  '',
                  '상태를 다시 확인하지 못했습니다.',
                )
              }
            >
              상태 새로고침
            </button>
          </div>
          <p
            role="status"
            aria-live="polite"
            style={{ minHeight: '1.5em', marginBottom: 0 }}
          >
            {busy ? '요청 처리 중…' : feedback}
          </p>
        </div>
        {data && (data.reports.length > 0 || data.recent.length > 0) ? (
          <div style={{ minWidth: 0 }}>
            <strong>최근 결과</strong>
            {data.reports.length > 0 ? (
              <ul>
                {data.reports.slice(0, 7).map((report) => (
                  <li key={report.day}>
                    {report.day} ·{' '}
                    {report.error
                      ? '기록 실패 · 연결 확인 필요'
                      : report.dirty
                        ? '일일정리 갱신 대기'
                        : report.pageId
                          ? '일일정리 기록 완료'
                          : '일일정리 대기'}
                  </li>
                ))}
              </ul>
            ) : null}
            {data.recent.length > 0 ? (
              <ul style={{ overflowWrap: 'anywhere' }}>
                {data.recent.slice(0, 10).map((mail) => (
                  <li key={mail.id}>
                    <a
                      href={
                        '/portal/?view=mail&message=' +
                        encodeURIComponent(mail.id)
                      }
                    >
                      {mail.subject || '(제목 없음)'}
                    </a>{' '}
                    ·{' '}
                    {mail.analysis_error
                      ? '분석 실패 · 재확인 필요'
                      : analysisLabels[mail.analysis_status || ''] ||
                        '수신 저장됨'}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
