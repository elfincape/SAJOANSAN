import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import {
  MailBriefingManualEntries,
  formatBriefingTimestamp,
} from '../components/portal/MailBriefingManualEntries';
import { MailFilterControls } from '../components/portal/MailFilterControls';
import { MailBriefingConnection } from '../components/portal/MailBriefingConnection';
import { DailyWorkList } from '../components/portal/DailyWorkList';
import { MAIL_DIAGNOSTIC_OWNER_ID } from '../domain/portal-mail';
import { privateMail } from '../lib/portal-mail';
import '../styles/mail-daily-briefing.css';

type Overview = Awaited<ReturnType<typeof privateMail.dailyOverview>>;
type Item = Overview['tasks'][number];
type Source = Overview['sources'][number];
const statusLabels: Record<string, string> = {
  pending: '미완료',
  complete: '완료',
  in_progress: '처리 중',
  needs_confirmation: '확인 필요',
  resolved: '해결됨',
  waiting: '회신 대기',
};
function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function initialDay() {
  const query = new URLSearchParams(location.search).get('day') || '';
  if (validDay(query)) return query;
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join('-');
}
function SourceLink({ source, label }: { source: Source; label?: string }) {
  return (
    <a href={'/portal/?view=mail&message=' + encodeURIComponent(source.id)}>
      {label || source.subject || '(제목 없음)'}
    </a>
  );
}
function ItemEvidence({ item }: { item: Item }) {
  return (
    <details className="daily-evidence">
      <summary>근거·원문</summary>
      <p>
        {item.sourceType === 'image' ? '사진 근거' : '메일 근거'}:{' '}
        <q>{item.evidence}</q>
        {item.confidence === 'uncertain' ? ' · 사진 판독 재확인 필요' : ''}
      </p>
      <p>
        원본: <SourceLink source={item.source} />
        {item.source.sender ? ` · ${item.source.sender}` : ''}
      </p>
      {item.resolution?.manual ? (
        <p>
          본인 {item.resolution.done ? '완료' : '미완료'} 표시 · 메일의 처리
          근거와 별도로 기록했습니다.
        </p>
      ) : item.resolution?.evidence ? (
        <p>
          처리 근거: <q>{item.resolution.evidence}</q>
          {item.resolution.source ? (
            <>
              {' '}
              · <SourceLink source={item.resolution.source} />
            </>
          ) : null}
        </p>
      ) : null}
    </details>
  );
}
function DailyOverview() {
  const [day, setDay] = useState(initialDay);
  const [messageOpen, setMessageOpen] = useState(false);
  const [dateInput, setDateInput] = useState(day);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [filtersBusy, setFiltersBusy] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualRefresh, setManualRefresh] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const saving = useRef(false);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const result = await privateMail.dailyOverview(day);
      if (!mounted.current || id !== request.current) return false;
      setData(result);
      setFeedback('');
      return true;
    } catch (error) {
      if (mounted.current && id === request.current)
        setFeedback(
          error instanceof Error &&
            error.message === 'AUTOMATION_SCHEMA_REQUIRED'
            ? '일일정리를 준비하고 있습니다. 잠시 후 다시 조회해 주세요.'
            : '일일정리를 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 조회해 주세요.',
        );
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
  const overview = data?.day === day ? data : null;
  async function complete(item: Pick<Item, 'ref'>, done: boolean) {
    if (saving.current || loading || !overview) return;
    saving.current = true;
    setPending(item.ref);
    setFeedback('');
    const id = request.current;
    try {
      const result = item.ref.includes(':manual:')
        ? await privateMail
            .manualUpdate({
              entryId: item.ref.slice(0, 36),
              itemId: item.ref.split(':manual:')[1],
              done,
            })
            .then(() => ({ saved: true }))
        : await privateMail.setTaskStatus({
            ref: item.ref,
            done,
            day,
          });
      if (!mounted.current || id !== request.current) return;
      if (!result.saved) throw Error('task status was not saved');
      const refreshed = await load();
      if (mounted.current)
        setFeedback(
          refreshed
            ? '완료 상태를 저장했습니다. 원문과 처리 이력은 유지됩니다.'
            : '완료 확인을 저장했지만 목록을 갱신하지 못했습니다. 다시 조회해 주세요.',
        );
    } catch {
      if (mounted.current && id === request.current)
        setFeedback(
          '완료 확인을 저장하지 못했습니다. 기존 상태를 유지합니다. 다시 시도해 주세요.',
        );
    } finally {
      saving.current = false;
      if (mounted.current) setPending(null);
    }
  }
  async function correctIntent(source: Pick<Source, 'id' | 'intentCorrected'>) {
    if (saving.current || loading) return;
    saving.current = true;
    setPending('intent:' + source.id);
    setFeedback('');
    try {
      const result = await privateMail.correctIntent(
        source.id,
        !source.intentCorrected,
      );
      if (!result.saved) throw Error('CORRECTION_NOT_SAVED');
      const refreshed = await load();
      if (mounted.current)
        setFeedback(
          refreshed
            ? '분류 정정을 저장했습니다.'
            : '정정은 저장됐지만 목록을 새로 불러오지 못했습니다. 다시 조회해 주세요.',
        );
    } catch {
      if (mounted.current)
        setFeedback('분류 정정을 저장하지 못했습니다. 기존 내용을 유지합니다.');
    } finally {
      saving.current = false;
      if (mounted.current) setPending(null);
    }
  }
  function applyDate() {
    if (saving.current || loading || !validDay(dateInput)) return;
    if (dateInput === day) {
      setManualRefresh((value) => value + 1);
      void load();
      return;
    }
    const url = new URL(location.href);
    url.searchParams.set('day', dateInput);
    history.replaceState(history.state, '', url);
    setDay(dateInput);
    setFeedback('');
  }
  function section(title: string, items: Item[], empty: string, tasks = false) {
    return (
      <section className="daily-section" aria-label={title}>
        <h2>
          {title} <span className="daily-count">{items.length}</span>
        </h2>
        {tasks ? (
          <p className="daily-task-meta">
            체크하면 본인의 완료 확인으로 기록합니다. 메일에서 확인된 완료
            근거와 구분됩니다.
          </p>
        ) : null}
        {!items.length ? (
          <p className="daily-empty">{empty}</p>
        ) : (
          <ul className="daily-items">
            {items.map((item) => (
              <li key={item.ref}>
                <div className="daily-item-heading">
                  {tasks ? (
                    <label className="daily-task-check">
                      <input
                        type="checkbox"
                        aria-label={`${item.text} 직접 완료 확인`}
                        checked={item.status === 'complete'}
                        disabled={
                          loading ||
                          pending !== null ||
                          filtersBusy ||
                          manualBusy
                        }
                        onChange={(event) =>
                          void complete(item, event.target.checked)
                        }
                      />
                      <span>{item.text}</span>
                    </label>
                  ) : (
                    <strong>{item.text}</strong>
                  )}
                  <span className="daily-item-status">
                    {statusLabels[item.status] || '확인 필요'}
                  </span>
                </div>
                {tasks &&
                (item.assignee ||
                  item.dueAt ||
                  item.dueDate ||
                  item.due ||
                  item.dueOriginal ||
                  item.serviceDate ||
                  item.serviceOriginal) ? (
                  <p className="daily-task-meta">
                    {item.assignee
                      ? `담당: ${item.assignee}${item.assigneeConfirmed === true ? '' : ' (확인 필요)'}`
                      : '담당 미정'}{' '}
                    · 처리기한:{' '}
                    {item.dueAt
                      ? formatBriefingTimestamp(item.dueAt)
                      : item.dueDate || item.due || item.dueOriginal || '미정'}
                    {!item.dueAt &&
                    !item.dueDate &&
                    !item.due &&
                    item.dueOriginal
                      ? ' (날짜 확인 필요)'
                      : ''}
                    {item.serviceDate || item.serviceOriginal ? (
                      <>
                        {' '}
                        · 운행·납품 대상일:{' '}
                        {item.serviceDate || item.serviceOriginal}
                        {!item.serviceDate && item.serviceOriginal
                          ? ' (날짜 확인 필요)'
                          : ''}
                      </>
                    ) : null}
                  </p>
                ) : null}
                <ItemEvidence item={item} />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  return (
    <main id="work-main" tabIndex={-1} className="app-main mail-daily-briefing">
      <div className="daily-toolbar">
        <label htmlFor="briefing-day">
          날짜 (한국 시간)
          <input
            id="briefing-day"
            className="app-input"
            type="date"
            value={dateInput}
            disabled={pending !== null || filtersBusy || manualBusy}
            onChange={(event) => setDateInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyDate();
            }}
          />
        </label>
        <button
          className="btn btn-primary"
          type="button"
          disabled={
            loading ||
            pending !== null ||
            filtersBusy ||
            manualBusy ||
            !validDay(dateInput)
          }
          onClick={applyDate}
        >
          조회
        </button>
        <a className="btn btn-ghost" href="/portal/?view=mail">
          개인 메일함
        </a>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => setMessageOpen(true)}
        >
          메시지 입력
        </button>
      </div>
      <p className="daily-feedback" role="status" aria-live="polite">
        {pending
          ? '완료 확인을 저장하는 중…'
          : loading
            ? '일일정리를 불러오는 중…'
            : feedback}
      </p>
      <div aria-busy={loading}>
        <h2 className="daily-title">{overview?.title || `${day} 일일정리`}</h2>
        {overview ? (
          <>
            {!overview.sources.length && !overview.workItems ? (
              <p>
                이 날짜에 정리된 메일이 없습니다. 새 메일의 분석이 완료되면
                표시됩니다.
              </p>
            ) : null}
            {overview.workItems &&
            overview.workSections &&
            overview.workStatusLabels ? (
              <DailyWorkList
                items={overview.workItems}
                sections={overview.workSections}
                labels={overview.workStatusLabels}
                day={day}
                busy={loading || pending !== null || filtersBusy || manualBusy}
                onComplete={(item, done) => {
                  if (item.controlRef)
                    void complete({ ref: item.controlRef }, done);
                }}
                onCorrectIntent={(id, corrected) =>
                  void correctIntent({ id, intentCorrected: corrected })
                }
              />
            ) : (
              <>
                {overview.groups.length ? (
                  <section className="daily-section" aria-label="메일 정리">
                    <h2>메일 정리</h2>
                    {overview.groups.map((group, groupIndex) => (
                      <div
                        className="daily-mail-group"
                        key={`${group.name}:${groupIndex}`}
                      >
                        {group.name &&
                        !['분류 미확정', '분류미확정'].includes(group.name) ? (
                          <h3>{group.name}</h3>
                        ) : null}
                        {group.threads.map((thread, threadIndex) => (
                          <div key={`${thread.subject}:${threadIndex}`}>
                            <h4>{thread.subject || '(제목 없음)'}</h4>
                            {thread.mails.map((mail) => (
                              <article
                                className="daily-mail-summary"
                                aria-label={
                                  mail.source.subject || thread.subject
                                }
                                key={mail.source.id}
                              >
                                <p className="daily-mail-summary-meta">
                                  {mail.source.intent === 'reference' ? (
                                    <span className="daily-item-status">
                                      참고
                                    </span>
                                  ) : null}
                                  {mail.source.analysisState === 'failed' ||
                                  mail.source.analysisState === 'blocked' ? (
                                    <span className="daily-item-status">
                                      이전 정리
                                    </span>
                                  ) : null}
                                  <SourceLink
                                    source={mail.source}
                                    label="원문"
                                  />
                                  {mail.source.sender ? (
                                    <span>{mail.source.sender}</span>
                                  ) : null}
                                  <span>
                                    수신{' '}
                                    {formatBriefingTimestamp(
                                      mail.source.receivedAt,
                                    )}
                                  </span>
                                </p>
                                <ul className="daily-mail-summary-points">
                                  {mail.summary.map((summary, index) => (
                                    <li key={index}>{summary.text}</li>
                                  ))}
                                </ul>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-secondary"
                                  disabled={loading || pending !== null}
                                  onClick={() =>
                                    void correctIntent(mail.source)
                                  }
                                >
                                  {pending === 'intent:' + mail.source.id
                                    ? '저장 중…'
                                    : mail.source.intentCorrected
                                      ? '참고 정정 해제'
                                      : '참고 자료로 정정'}
                                </button>
                              </article>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </section>
                ) : null}
                {section('이슈', overview.issues, '정리된 이슈가 없습니다.')}
                {section(
                  '할 일',
                  overview.tasks,
                  '정리된 할 일이 없습니다.',
                  true,
                )}
                {section(
                  '회신 대기',
                  overview.waiting,
                  '대기 중인 회신이 없습니다.',
                )}
                {overview.sources.length ? (
                  <details className="daily-sources">
                    <summary>원본 메일 {overview.sources.length}건</summary>
                    <ul>
                      {overview.sources.map((source) => (
                        <li key={source.id}>
                          <SourceLink source={source} />
                          {source.sender ? ` · ${source.sender}` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            )}
          </>
        ) : !loading ? (
          <p>표시할 일일정리를 확인하지 못했습니다.</p>
        ) : null}
      </div>
      <div id="manual-messages" tabIndex={-1}>
        <MailBriefingManualEntries
          refreshKey={manualRefresh}
          inputOpen={messageOpen}
          onInputClose={() => setMessageOpen(false)}
          day={day}
          disabled={pending !== null || filtersBusy}
          onBusyChange={setManualBusy}
          showItems={overview ? !overview.workItems : false}
          onChanged={() => void load()}
        />
      </div>
      <MailFilterControls
        disabled={pending !== null || manualBusy}
        onBusyChange={setFiltersBusy}
        onChanged={() => void load()}
      />
      <div className="daily-settings">
        <MailBriefingConnection />
      </div>
    </main>
  );
}
function OwnerContent() {
  const { profile } = useAdminPage();
  if (!profile.active || profile.id !== MAIL_DIAGNOSTIC_OWNER_ID)
    return (
      <main id="work-main" tabIndex={-1} className="app-main">
        <p role="alert">본인 계정에서만 일일정리를 사용할 수 있습니다.</p>
      </main>
    );
  return <DailyOverview />;
}
export default function MailDailyBriefing() {
  return (
    <AdminPage
      title="일일정리"
      minRole="viewer"
      bodyClass="min-h-screen flex flex-col"
    >
      <OwnerContent />
    </AdminPage>
  );
}
