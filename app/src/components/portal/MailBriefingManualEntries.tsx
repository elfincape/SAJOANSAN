import { useCallback, useEffect, useRef, useState } from 'react';
import { privateMail } from '../../lib/portal-mail';
import type {
  MailManualEntry,
  MailManualItem,
  MailManualList,
} from '../../lib/portal-mail';

export function formatBriefingTimestamp(value?: string | null) {
  if (!value) return '확인 필요';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '확인 필요'
    : parsed.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
}
function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function failure(error: unknown) {
  const value =
    error && typeof error === 'object'
      ? (error as { code?: string; message?: string })
      : {};
  return (
    (
      {
        OWNER_REQUIRED: '본인 계정에서만 메시지를 추가할 수 있습니다.',
        MANUAL_SCHEMA_REQUIRED:
          '메시지 저장 준비 중입니다. 잠시 후 다시 시도해 주세요.',
        AI_NOT_CONFIGURED: '메시지 분석 연결이 준비되지 않았습니다.',
        MANUAL_TEXT_INVALID: '메시지는 12,000자 이내로 입력해 주세요.',
        MANUAL_REFERENCE_INVALID: '메시지 기준일을 다시 확인해 주세요.',
        MANUAL_INPUT_INVALID:
          '메시지는 12,000자 이내로 입력하고 기준일을 확인해 주세요.',
        MAIL_PRIVACY_REVIEW:
          '입력 내용 중 보호가 필요한 정보가 있어 분석하지 않았습니다. 내용을 확인해 주세요.',
      } as Record<string, string>
    )[value.code || value.message || ''] ||
    '요청을 완료하지 못했습니다. 입력 내용과 기존 항목을 유지합니다. 다시 시도해 주세요.'
  );
}
export function MailBriefingManualEntries({
  day,
  disabled = false,
  onBusyChange,
  showItems = true,
  onChanged,
}: {
  day: string;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  showItems?: boolean;
  onChanged?: () => void;
}) {
  const [text, setText] = useState('');
  const [referenceDate, setReferenceDate] = useState('');
  const [data, setData] = useState<MailManualList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const mounted = useRef(false);
  const locked = useRef(false);
  const request = useRef(0);
  const draftVersion = useRef(0);
  const submission = useRef<{
    key: string;
    id: string;
    retry?: boolean;
  } | null>(null);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const result = await privateMail.manualList(day);
      if (!mounted.current || id !== request.current) return false;
      setData(result);
      return true;
    } catch (error) {
      if (mounted.current && id === request.current)
        setFeedback(failure(error));
      return false;
    } finally {
      if (mounted.current && id === request.current) setLoading(false);
    }
  }, [day]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [load]);
  async function act(action: () => Promise<void>) {
    if (locked.current || disabled) return;
    locked.current = true;
    setBusy(true);
    onBusyChange(true);
    setFeedback('');
    try {
      await action();
    } catch (error) {
      if (mounted.current) setFeedback(failure(error));
    } finally {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  async function add() {
    const input = text.trim(),
      basis = referenceDate || null;
    if (!input || input.length > 12000 || (basis && !validDay(basis))) return;
    const key = JSON.stringify({ text: input, referenceDate: basis });
    if (submission.current?.key !== key)
      submission.current = { key, id: crypto.randomUUID() };
    const clientRequestId = submission.current.id,
      retry = submission.current.retry === true,
      version = draftVersion.current;
    await act(async () => {
      const result = await privateMail.manualAdd({
        text: input,
        clientRequestId,
        referenceDate: basis,
        retry,
      });
      if (!mounted.current) return;
      if (result.status === 'failed') {
        if (submission.current?.id === clientRequestId)
          submission.current.retry = true;
        setFeedback(
          '메시지를 접수했지만 분석하지 못했습니다. 입력 내용을 유지합니다. 다시 시도해 주세요.',
        );
        await load();
        return;
      }
      const refreshed = await load();
      if (!mounted.current) return;
      if (result.status === 'processing') {
        setFeedback(
          '메시지를 접수했으며 분석 중입니다. 목록 새로고침으로 결과를 확인할 수 있습니다.',
        );
        return;
      }
      if (!result.items.length) {
        setFeedback(
          '메시지를 분석했지만 추가할 업무를 찾지 못했습니다. 입력 내용을 확인해 주세요.',
        );
        return;
      }
      submission.current = null;
      onChanged?.();
      if (draftVersion.current === version) {
        setText('');
        setReferenceDate('');
      }
      setFeedback(
        refreshed
          ? '업무를 추가했습니다. 미완료 업무는 접수일부터 계속 표시됩니다.'
          : '메시지는 추가했지만 목록을 갱신하지 못했습니다. 목록을 새로고침해 주세요.',
      );
    });
  }
  async function complete(entryId: string, itemId: string, done: boolean) {
    await act(async () => {
      await privateMail.manualUpdate({ entryId, itemId, done });
      if (!mounted.current) return;
      const refreshed = await load();
      if (mounted.current)
        setFeedback(
          refreshed
            ? done
              ? '완료를 저장했습니다. 완료 기록에서 확인할 수 있습니다.'
              : '미완료로 되돌렸습니다. 미완료 목록에 계속 표시됩니다.'
            : '완료 상태는 저장했지만 목록을 갱신하지 못했습니다. 목록을 새로고침해 주세요.',
        );
    });
  }
  const entries = data?.day === day ? data.entries : [];
  const items = entries.flatMap((entry) =>
    entry.items.map((item) => ({ entry, item })),
  );
  const open = items.filter(({ item }) => !item.done),
    completed = items.filter(({ item }) => item.done);
  function row(entry: MailManualEntry, item: MailManualItem) {
    return (
      <li key={`${entry.entryId}:${item.itemId}`}>
        <div className="daily-item-heading">
          <label className="daily-task-check">
            <input
              type="checkbox"
              aria-label={`${item.text} 메시지 업무 완료`}
              checked={item.done}
              disabled={busy || disabled || loading}
              onChange={(event) =>
                void complete(entry.entryId, item.itemId, event.target.checked)
              }
            />
            <span>{item.text}</span>
          </label>
          <span className="daily-item-status">
            {item.kind === 'dispatch'
              ? '배차 요청'
              : item.kind === 'issue'
                ? '이슈'
                : '할 일'}
            {item.needsConfirmation ? ' · 확인 필요' : ''}
          </span>
        </div>
        <p className="daily-task-meta">
          담당: {item.assignee || '미지정'} · 처리기한:{' '}
          {item.dueAt
            ? formatBriefingTimestamp(item.dueAt)
            : item.dueDate || item.dueOriginal || '미지정'}
          {!item.dueAt && !item.dueDate && item.dueOriginal
            ? ' (날짜 확인 필요)'
            : ''}{' '}
          · {item.kind === 'dispatch' ? '운행 대상일' : '업무 대상일'}:{' '}
          {item.serviceDate || item.serviceOriginal || '미지정'}
          {!item.serviceDate && item.serviceOriginal ? ' (날짜 확인 필요)' : ''}
        </p>
        <p className="daily-task-meta">
          접수: {formatBriefingTimestamp(item.receivedAt || entry.submittedAt)}
          {!item.done && item.visibleFrom < day ? ' · 미완료 이월' : ''}
          {item.done
            ? ` · 완료: ${formatBriefingTimestamp(item.completedAt)}`
            : ''}
        </p>
        <details className="manual-basis">
          <summary>날짜 해석 기준</summary>
          <p>
            기준일: {entry.referenceDate || '접수 시각의 한국 날짜'} ·{' '}
            {entry.referenceSource === 'owner' ? '직접 지정' : '접수 시각 기준'}
          </p>
          <p>
            원문 작성일: {entry.authoredDate || '확인되지 않음'}
            {entry.needsConfirmation || item.needsConfirmation
              ? ' · 날짜나 내용을 확인해 주세요.'
              : ''}
          </p>
        </details>
      </li>
    );
  }
  return (
    <section className="daily-manual" aria-label="메시지로 추가한 업무">
      <h2>메시지에서 추가</h2>
      <label className="manual-message-label" htmlFor="manual-message">
        카톡 메시지·직접 입력
        <textarea
          id="manual-message"
          aria-label="카톡 메시지·직접 입력"
          className="app-input"
          rows={4}
          maxLength={12000}
          value={text}
          onChange={(event) => {
            draftVersion.current++;
            setText(event.target.value);
          }}
        />
      </label>
      <div className="daily-filter-actions">
        <label className="manual-reference" htmlFor="manual-reference">
          메시지 기준일 (선택)
          <input
            id="manual-reference"
            className="app-input"
            type="date"
            value={referenceDate}
            onChange={(event) => {
              draftVersion.current++;
              setReferenceDate(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={
            busy ||
            disabled ||
            !text.trim() ||
            text.trim().length > 12000 ||
            (Boolean(referenceDate) && !validDay(referenceDate))
          }
          onClick={() => void add()}
        >
          업무 추가
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || loading || disabled}
          onClick={() => {
            setFeedback('');
            void load().then((refreshed) => {
              if (refreshed) onChanged?.();
            });
          }}
        >
          메시지 목록 새로고침
        </button>
      </div>
      <p className="daily-task-meta">
        오래된 메시지의 ‘오늘·내일’은 메시지 기준일을 지정해 주세요. 비워두면
        접수 시각의 한국 날짜를 기준으로 저장합니다.
      </p>
      <p className="daily-feedback" role="status" aria-live="polite">
        {busy
          ? '메시지와 완료 상태를 저장하는 중…'
          : loading
            ? '메시지 업무를 불러오는 중…'
            : feedback}
      </p>
      {showItems ? (
        <div aria-busy={loading}>
          {entries
            .filter((entry) => entry.status !== 'ready')
            .map((entry) => (
              <p className="daily-task-meta" key={entry.entryId}>
                {formatBriefingTimestamp(entry.submittedAt)} 접수 ·{' '}
                {entry.status === 'processing'
                  ? '분석 중'
                  : '분석 실패 · 메시지 내용을 확인해 다시 시도해 주세요.'}
              </p>
            ))}
          <h3>
            미완료 <span className="daily-count">{open.length}</span>
          </h3>
          {open.length ? (
            <ul className="daily-items manual-open">
              {open.map(({ entry, item }) => row(entry, item))}
            </ul>
          ) : !loading ? (
            <p className="daily-empty">미완료 메시지 업무가 없습니다.</p>
          ) : null}
          <details className="manual-completed">
            <summary>완료 기록 {completed.length}건</summary>
            {completed.length ? (
              <ul className="daily-items">
                {completed.map(({ entry, item }) => row(entry, item))}
              </ul>
            ) : (
              <p className="daily-empty">이 날짜의 완료 기록이 없습니다.</p>
            )}
          </details>
        </div>
      ) : null}
    </section>
  );
}
