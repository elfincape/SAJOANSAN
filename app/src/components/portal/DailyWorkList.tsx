import { useEffect, useRef, useState } from 'react';
import { privateMail } from '../../lib/portal-mail';
import type { DailyWork, DailyMailOverview } from '../../lib/portal-mail';
import { formatBriefingTimestamp } from './MailBriefingManualEntries';

export function DailyWorkList({
  items,
  sections,
  labels,
  day,
  busy,
  onComplete,
  onCorrectIntent,
}: {
  items: DailyWork[];
  sections: NonNullable<DailyMailOverview['workSections']>;
  labels: Record<string, string>;
  day: string;
  busy: boolean;
  onComplete: (item: DailyWork, done: boolean) => void;
  onCorrectIntent: (id: string, corrected: boolean) => void;
}) {
  const [source, setSource] = useState<{
    text: string;
    submittedAt: string;
    referenceDate: string | null;
    authoredDate: string | null;
  } | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false),
    [sourceError, setSourceError] = useState('');
  const mounted = useRef(false),
    generation = useRef(0);
  async function openSource(id: string) {
    const request = ++generation.current;
    setSource(null);
    setSourceLoading(true);
    setSourceError('');
    try {
      const result = await privateMail.manualSource(id);
      if (mounted.current && request === generation.current) setSource(result);
    } catch {
      if (mounted.current && request === generation.current)
        setSourceError('입력 원문을 불러오지 못했습니다. 다시 확인해 주세요.');
    } finally {
      if (mounted.current && request === generation.current)
        setSourceLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const entry = new URLSearchParams(location.search).get('entry');
    if (entry && /^[0-9a-f-]{36}$/i.test(entry)) void openSource(entry);
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  return (
    <>
      {sections.map((section) => {
        const rows = items.filter((item) => item.section === section.id);
        if (!rows.length) return null;
        return (
          <section
            key={section.id}
            className="daily-section"
            aria-label={section.title}
          >
            <h2>
              {section.title} <span className="daily-count">{rows.length}</span>
            </h2>
            <ul className="daily-items">
              {rows.map((item) => (
                <li key={item.workId}>
                  <div className="daily-item-heading">
                    {item.controlRef && item.status !== 'cancelled' ? (
                      <label className="daily-task-check">
                        <input
                          type="checkbox"
                          aria-label={`${item.title} 완료 확인`}
                          checked={item.status === 'complete'}
                          disabled={busy}
                          onChange={(event) =>
                            onComplete(item, event.target.checked)
                          }
                        />
                        <span>{item.title}</span>
                      </label>
                    ) : (
                      <strong>
                        {item.category === 'reference'
                          ? item.summary[0] || item.title
                          : item.title}
                      </strong>
                    )}
                    {item.category !== 'reference' &&
                    item.status !== 'pending' ? (
                      <span className="daily-item-status">
                        {labels[item.status] || '확인 필요'}
                      </span>
                    ) : null}
                  </div>
                  {item.status === 'cancelled' && item.controlRef ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => onComplete(item, false)}
                    >
                      다시 진행
                    </button>
                  ) : null}
                  {(item.category === 'reference'
                    ? item.summary.slice(1)
                    : item.summary
                  ).map((text, index) => (
                    <p key={index}>{text}</p>
                  ))}
                  {[
                    item.center && `센터: ${item.center}`,
                    item.customer && `거래처: ${item.customer}`,
                    item.requester && `요청: ${item.requester}`,
                    item.assignee && `담당: ${item.assignee}`,
                    (item.dueAt || item.dueDate) &&
                      `처리기한: ${item.dueAt ? formatBriefingTimestamp(item.dueAt) : item.dueDate}`,
                    item.serviceDate && `운행·납품 대상일: ${item.serviceDate}`,
                    item.closedAt &&
                      `처리 확인: ${formatBriefingTimestamp(item.closedAt)}`,
                  ].filter(Boolean).length ? (
                    <p className="daily-task-meta">
                      {[
                        item.center && `센터: ${item.center}`,
                        item.customer && `거래처: ${item.customer}`,
                        item.requester && `요청: ${item.requester}`,
                        item.assignee && `담당: ${item.assignee}`,
                        (item.dueAt || item.dueDate) &&
                          `처리기한: ${item.dueAt ? formatBriefingTimestamp(item.dueAt) : item.dueDate}`,
                        item.serviceDate &&
                          `운행·납품 대상일: ${item.serviceDate}`,
                        item.closedAt &&
                          `처리 확인: ${formatBriefingTimestamp(item.closedAt)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}
                  {item.nextAction && item.nextAction !== item.title ? (
                    <p>다음 조치: {item.nextAction}</p>
                  ) : null}
                  {item.progress && item.progress !== item.title ? (
                    <p>진행: {item.progress}</p>
                  ) : null}
                  {item.waitingFor ? <p>회신 대기: {item.waitingFor}</p> : null}
                  {item.needsConfirmation ? (
                    <p className="daily-task-meta">
                      원문의 날짜·담당·내용을 확인해 주세요.
                    </p>
                  ) : null}
                  <details className="daily-evidence">
                    <summary>출처·근거</summary>
                    {item.sourceRefs
                      .filter((ref) => ref.kind !== 'linked')
                      .map((ref, index) => (
                        <div key={`${ref.kind}:${ref.ref}:${index}`}>
                          {ref.kind === 'mail' ? (
                            <>
                              <a
                                href={
                                  '/portal/?view=mail&message=' +
                                  encodeURIComponent(ref.id)
                                }
                              >
                                {ref.title || '원본 메일'}
                              </a>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                disabled={busy}
                                onClick={() =>
                                  onCorrectIntent(
                                    ref.id,
                                    ref.intentCorrected === true,
                                  )
                                }
                              >
                                {ref.intentCorrected
                                  ? '참고 정정 해제'
                                  : '참고 자료로 정정'}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={sourceLoading}
                              onClick={() => void openSource(ref.id)}
                            >
                              입력 원문 보기
                            </button>
                          )}
                          {ref.receivedAt ? (
                            <span>
                              {' '}
                              · {ref.kind === 'mail' ? '수집' : '입력'}{' '}
                              {formatBriefingTimestamp(ref.receivedAt)}
                            </span>
                          ) : null}
                          {ref.evidence ? (
                            <p>
                              <q>{ref.evidence}</q>
                            </p>
                          ) : null}
                        </div>
                      ))}
                  </details>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!items.length ? (
        <p className="daily-empty">표시할 업무나 참고 자료가 없습니다.</p>
      ) : null}
      <p className="daily-feedback" role="status" aria-live="polite">
        {sourceLoading ? '입력 원문을 불러오는 중…' : sourceError}
      </p>
      {source ? (
        <details className="daily-sources" open>
          <summary>
            입력 원문 · {formatBriefingTimestamp(source.submittedAt)}
          </summary>
          {source.referenceDate ? (
            <p>날짜 기준: {source.referenceDate}</p>
          ) : null}
          {source.authoredDate ? (
            <p>원문 작성일: {source.authoredDate}</p>
          ) : null}
          <pre className="daily-source-text">{source.text}</pre>
          <a
            href={
              '/admin/mail-daily-briefing.html?day=' + encodeURIComponent(day)
            }
          >
            일일정리
          </a>
        </details>
      ) : null}
    </>
  );
}
