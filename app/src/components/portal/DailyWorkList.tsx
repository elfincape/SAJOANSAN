import { workSummaryForDisplay } from '../../../../supabase/functions/onedrive-auth/private-mail-work.js';
import { useEffect, useRef, useState } from 'react';
import { Modal, ModalClose } from '../Modal';
import { privateMail } from '../../lib/portal-mail';
import type {
  DailyWork,
  DailyMailOverview,
  WorkPatch,
  WorkCorrection,
  WorkCategory,
} from '../../lib/portal-mail';
import { formatBriefingTimestamp } from './MailBriefingManualEntries';

const categories: { value: WorkCategory; label: string }[] = [
  { value: 'task', label: '할 일' },
  { value: 'issue', label: '이슈' },
  { value: 'reference', label: '참고' },
  { value: 'routine', label: '정기보고' },
  { value: 'review', label: '확인 필요' },
];
export function DailyWorkList({
  items,
  excludedItems = [],
  sections,
  labels,
  day,
  busy,
  onChangeWork,
}: {
  items: DailyWork[];
  excludedItems?: DailyWork[];
  sections: NonNullable<DailyMailOverview['workSections']>;
  labels: Record<string, string>;
  day: string;
  busy: boolean;
  onChangeWork: (
    item: DailyWork,
    patch: WorkPatch,
  ) => Promise<{
    saved: boolean;
    correction: WorkCorrection;
    refreshed?: boolean;
  }>;
}) {
  const [activeId, setActiveId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('work'),
  );
  const [snapshot, setSnapshot] = useState<DailyWork | null>(null);
  const [saving, setSaving] = useState(false),
    [feedback, setFeedback] = useState('');
  const [undo, setUndo] = useState<WorkPatch | null>(null);
  const [source, setSource] = useState<{
    text: string;
    submittedAt: string;
    referenceDate: string | null;
    authoredDate: string | null;
  } | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false),
    [sourceError, setSourceError] = useState('');
  const locked = useRef(false),
    mounted = useRef(true),
    generation = useRef(0);
  function restoreFocus(id: string | null) {
    const target = [
      ...document.querySelectorAll<HTMLElement>('[data-work-id]'),
    ].find((node) => node.dataset.workId === id);
    (target || document.getElementById('work-main'))?.focus({
      preventScroll: true,
    });
  }
  const focusedWork = useRef<string | null>(null);
  const all = [...items, ...excludedItems];
  const item =
    all.find((row) => row.workId === activeId) ??
    (snapshot?.workId === activeId ? snapshot : null);
  const itemSummary = item ? workSummaryForDisplay(item) : [];
  useEffect(() => {
    mounted.current = true;
    const pop = () => {
      const selected = new URLSearchParams(location.search).get('work');
      setActiveId(selected);
      if (!selected)
        requestAnimationFrame(() => restoreFocus(focusedWork.current));
      setFeedback('');
      setUndo(null);
    };
    pop();
    window.addEventListener('popstate', pop);
    return () => {
      mounted.current = false;
      generation.current++;
      window.removeEventListener('popstate', pop);
    };
  }, []);
  const previousDay = useRef(day);
  useEffect(() => {
    if (previousDay.current === day) return;
    previousDay.current = day;
    setActiveId(null);
    setSource(null);
    setUndo(null);
  }, [day]);
  function open(row: DailyWork) {
    focusedWork.current = row.workId;
    setSnapshot(row);
    setActiveId(row.workId);
    setFeedback('');
    setUndo(null);
    setSource(null);
    setSourceError('');
    setSourceLoading(false);
    generation.current++;
    const url = new URL(location.href);
    url.searchParams.set('work', row.workId);
    history.pushState(
      { ...history.state, dailyWorkPopup: row.workId },
      '',
      url,
    );
  }
  function close() {
    if (locked.current) return;
    generation.current++;
    setActiveId(null);
    setSource(null);
    setSourceLoading(false);
    setFeedback('');
    if (history.state?.dailyWorkPopup === activeId) history.back();
    else {
      const url = new URL(location.href);
      url.searchParams.delete('work');
      history.replaceState(history.state, '', url);
    }
    requestAnimationFrame(() => restoreFocus(activeId));
  }
  async function save(patch: WorkPatch, restoring = false) {
    if (!item || locked.current || busy) return;
    locked.current = true;
    setSaving(true);
    setFeedback('');
    const previous: WorkPatch = {};
    if ('category' in patch)
      previous.category = item.correction?.category ?? null;
    if ('excluded' in patch) previous.excluded = item.excluded === true;
    if ('reason' in patch || 'excluded' in patch)
      previous.reason = item.correction?.reason ?? null;
    if ('done' in patch)
      previous.done =
        item.correction?.currentDone ?? item.correction?.done ?? null;
    try {
      const result = await onChangeWork(item, patch);
      if (!result.saved) throw Error('NOT_SAVED');
      if (!mounted.current) return;
      setSnapshot({
        ...item,
        correction: result.correction,
        excluded: result.correction.excluded === true,
      });
      setUndo(restoring ? null : previous);
      setFeedback(
        result.refreshed === false
          ? '저장했습니다. 목록은 다시 조회해 주세요.'
          : restoring
            ? '되돌렸습니다.'
            : '저장했습니다.',
      );
    } catch (error) {
      if (mounted.current)
        setFeedback(
          String((error as Error).message).includes('CONFLICT')
            ? '다른 변경이 있습니다. 다시 조회한 뒤 저장해 주세요.'
            : '저장하지 못했습니다. 기존 내용은 유지됩니다. 다시 시도해 주세요.',
        );
    } finally {
      locked.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  async function openSource(id: string) {
    const request = ++generation.current;
    setSource(null);
    setSourceLoading(true);
    setSourceError('');
    try {
      const value = await privateMail.manualSource(id);
      if (mounted.current && request === generation.current) setSource(value);
    } catch {
      if (mounted.current && request === generation.current)
        setSourceError('원문을 불러오지 못했습니다. 다시 시도해 주세요.');
    } finally {
      if (mounted.current && request === generation.current)
        setSourceLoading(false);
    }
  }
  function row(value: DailyWork) {
    return (
      <li key={value.workId}>
        <button
          type="button"
          className="daily-work-trigger"
          data-work-id={value.workId}
          onClick={() => open(value)}
          aria-haspopup="dialog"
        >
          <span className="daily-work-title">{value.title}</span>
          <span className="daily-work-trailing">
            {(value.dueAt || value.dueDate) && (
              <span className="daily-work-deadline">
                기한{' '}
                {value.dueAt
                  ? formatBriefingTimestamp(value.dueAt)
                  : value.dueDate}
              </span>
            )}
            <span className="daily-work-state">
              {value.excluded
                ? '제외'
                : value.category === 'reference'
                  ? value.reportKind === 'routine'
                    ? '정기보고'
                    : value.reportKind === 'review'
                      ? '확인 필요'
                      : '참고'
                  : labels[value.status] || '확인 필요'}
            </span>
          </span>
        </button>
      </li>
    );
  }
  const disabled = saving || busy;
  return (
    <>
      {sections.map((section) => {
        const rows = items.filter((value) => value.section === section.id);
        return rows.length ? (
          <section
            key={section.id}
            className="daily-section"
            aria-label={section.title}
          >
            <h2>
              {section.title} <span className="daily-count">{rows.length}</span>
            </h2>
            <ul className="daily-items daily-work-list">{rows.map(row)}</ul>
          </section>
        ) : null;
      })}
      {!items.length && (
        <p className="daily-empty">표시할 업무나 참고 자료가 없습니다.</p>
      )}
      {excludedItems.length > 0 && (
        <details className="daily-excluded">
          <summary>제외한 항목 {excludedItems.length}</summary>
          <ul className="daily-items daily-work-list">
            {excludedItems.map(row)}
          </ul>
        </details>
      )}
      {item && activeId && (
        <Modal
          label={item.title}
          width="xl"
          dismissable={!saving}
          onClose={close}
        >
          <div className="daily-work-detail">
            <div className="daily-detail-top">
              <h2 className="daily-detail-title">{item.title}</h2>
              <ModalClose className="btn btn-ghost" disabled={saving}>
                닫기
              </ModalClose>
            </div>
            <p className="daily-task-meta">
              {item.excluded
                ? item.correction?.reason === 'spam'
                  ? '스팸 평가 · 정리 제외'
                  : '정리 제외'
                : item.category === 'reference'
                  ? '참고 자료'
                  : labels[item.status]}
            </p>
            <div className="daily-detail-summary">
              {itemSummary.map((text, index) => (
                <p key={index}>{text}</p>
              ))}
            </div>
            <dl className="daily-detail-fields">
              {[
                ['센터', item.center],
                ['거래처', item.customer],
                ['요청자', item.requester],
                ['담당', item.assignee],
                [
                  '처리기한',
                  item.dueAt
                    ? formatBriefingTimestamp(item.dueAt)
                    : item.dueDate,
                ],
                ['운행·납품 대상일', itemSummary.some((text,index)=>text!==item.summary[index]) ? null : item.serviceDate],
                ['다음 조치', item.nextAction],
                ['진행', item.progress],
                ['회신 대기', item.waitingFor],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
            {item.needsConfirmation && (
              <p className="daily-task-meta">날짜·담당·내용을 확인해 주세요.</p>
            )}
            <div className="daily-detail-actions">
              {item.category !== 'reference' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={disabled}
                  onClick={() =>
                    void save({ done: item.status !== 'complete' })
                  }
                >
                  {item.status === 'complete' ? '완료 취소' : '완료'}
                </button>
              )}
              <label className="daily-classification">
                분류
                <select
                  className="app-input"
                  disabled={disabled}
                  value={
                    item.correction?.category ??
                    (item.reportKind || item.category)
                  }
                  onChange={(event) =>
                    void save({
                      category:
                        event.target.value === 'inherit'
                          ? null
                          : (event.target.value as WorkCategory),
                    })
                  }
                >
                  {categories.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  <option value="inherit">원래 분류로 복원</option>
                </select>
              </label>
              {undo && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={disabled}
                  onClick={() => void save(undo, true)}
                >
                  되돌리기
                </button>
              )}
            </div>
            <p className="daily-feedback" role="status" aria-live="polite">
              {saving ? '저장 중…' : feedback}
            </p>
            <div className="daily-detail-secondary">
              {item.sourceRefs
                .filter((ref) => ref.kind !== 'linked')
                .map((ref) =>
                  ref.kind === 'mail' ? (
                    <a
                      key={ref.ref}
                      href={
                        '/portal/?view=mail&message=' +
                        encodeURIComponent(ref.id)
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      메일·첨부 보기
                    </a>
                  ) : (
                    <button
                      key={ref.ref}
                      type="button"
                      className="btn btn-ghost"
                      disabled={sourceLoading}
                      onClick={() => void openSource(ref.id)}
                    >
                      입력 원문 보기
                    </button>
                  ),
                )}
              {item.excluded ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={disabled}
                  onClick={() => void save({ excluded: false })}
                >
                  다시 포함
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={disabled}
                    onClick={() =>
                      void save({ excluded: true, reason: 'manual' })
                    }
                  >
                    정리에서 제외
                  </button>
                  {item.sourceRefs.some((ref) => ref.kind === 'mail') && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={disabled}
                      onClick={() =>
                        void save({ excluded: true, reason: 'spam' })
                      }
                    >
                      스팸으로 제외
                    </button>
                  )}
                </>
              )}
            </div>
            {item.excluded && (
              <p className="daily-task-meta">
                일일정리에서만 제외했습니다. 원본 메일은 유지됩니다.
              </p>
            )}
            {sourceLoading && <p role="status">원문을 불러오는 중…</p>}
            {sourceError && <p role="alert">{sourceError}</p>}
            {source && (
              <details className="daily-sources" open>
                <summary>
                  입력 원문 · {formatBriefingTimestamp(source.submittedAt)}
                </summary>
                <pre className="daily-source-text">{source.text}</pre>
              </details>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
