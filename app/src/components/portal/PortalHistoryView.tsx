import { MentionText } from './PortalMentions';
import { useEffect, useRef, useState } from 'react';
import { usePortal } from './PortalStore';
import { PortalRecordDetail } from './PortalRecordDetail';
import { portalApi, portalRecord } from '../../lib/portal';
import { portalHistoryRecords } from '../../lib/portal-history';
import {
  groupHistory,
  visibleHistoryEvents,
  historyStatuses,
} from '../../domain/portal-history';
import type { HistoryData, HistoryRecord } from '../../domain/portal-history';
import type { PortalEvent } from '../../domain/portal-types';
import { portalStamp } from '../../domain/portal-types';
import { periodBounds, taskPeriod } from '../../domain/portal-calendar';
import { koreaDate, actionLabels } from '../../domain/operations';
function HistoryRow({
  row,
  onSelect,
}: {
  row: HistoryRecord;
  onSelect: () => void;
}) {
  const { centerName } = usePortal(),
    [open, setOpen] = useState(false),
    [events, setEvents] = useState<PortalEvent[] | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (!open || events) return;
    let active = true;
    void portalApi
      .events(row.kind === 'task' ? { taskId: row.id } : { incidentId: row.id })
      .then((rows) => {
        if (active) {
          setEvents(
            visibleHistoryEvents(rows).sort(
              (a, b) =>
                a.occurred_at.localeCompare(b.occurred_at) ||
                String(a.id).localeCompare(String(b.id), undefined, {
                  numeric: true,
                }),
            ),
          );
          setError('');
        }
      })
      .catch((error) => {
        if (active)
          setError(error?.message || '처리 기록을 불러오지 못했습니다.');
      });
    return () => {
      active = false;
    };
  }, [open, events, row.id, row.kind]);
  return (
    <details
      className="history-task"
      open={open}
      onToggle={(e) => {
        const expanded = e.currentTarget.open;
        setOpen(expanded);
        if (expanded) onSelect();
      }}
    >
      <summary className="task-row history-record">
        <span className="center-property">
          <MentionText>{centerName(row.center_code)}</MentionText>
        </span>
        <strong>
          <MentionText>{row.title ?? '업무'}</MentionText>
        </strong>
        <small>
          <MentionText>
            {row.kind === 'task'
              ? taskPeriod(
                  row as import('../../domain/portal-types').PortalTask,
                )
              : '특이사항 · ' + portalStamp(row.created_at)}
          </MentionText>
        </small>
        <span className={'badge status-' + row.state}>
          <MentionText>{historyStatuses[row.state]}</MentionText>
        </span>
      </summary>
      <div className="history-task-events">
        {error ? (
          <p className="error">
            <MentionText>{error}</MentionText>
          </p>
        ) : events ? (
          events.length ? (
            events.map((event) => (
              <div key={event.id} className="history-entry">
                <strong>
                  <MentionText>
                    {(actionLabels[event.action] ?? event.action).replaceAll(
                      'HQ',
                      '배송팀',
                    )}
                  </MentionText>
                </strong>
                <small>
                  <MentionText>{portalStamp(event.occurred_at)}</MentionText>
                </small>
                {[
                  event.request_body?.data?.note,
                  event.request_body?.data?.memo,
                  event.request_body?.data?.reason,
                  event.request_body?.memo,
                ]
                  .filter(Boolean)
                  .map((value, i) => (
                    <p key={i}>
                      <MentionText>{String(value)}</MentionText>
                    </p>
                  ))}
              </div>
            ))
          ) : (
            <p>등록된 처리 기록이 없습니다.</p>
          )
        ) : (
          <p>처리 기록을 불러오는 중입니다…</p>
        )}
      </div>
    </details>
  );
}
export function PortalHistoryView() {
  const { state, allowed, centerName, message, choose, update, viewState } =
      usePortal(),
    [filters, setFilters] = useState(
      () =>
        (viewState.get('history') as
          | {
              center: string;
              from: string;
              through: string;
              status: string;
            }
          | undefined) ?? {
          center: '',
          ...periodBounds(koreaDate(), 'month'),
          status: '',
        },
    ),
    [loaded, setLoaded] = useState<HistoryData | null>(null),
    [selected, setSelected] = useState<HistoryRecord | null>(null),
    [guide, setGuide] = useState(false),
    [busy, setBusy] = useState(false),
    generation = useRef(0),
    centers =
      state.context?.centers.filter((c) =>
        allowed('history', 'read', c.code),
      ) ?? [],
    authorized = new Set(centers.map((c) => c.code)),
    rows = loaded
      ? groupHistory({ ...loaded, ...filters }).filter((row) =>
          authorized.has(row.center_code),
        )
      : [];
  useEffect(() => {
    viewState.set('history', filters);
  }, [filters]);
  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    if (!filters.from || !filters.through) return;
    if (filters.from > filters.through) {
      message('조회 시작일과 종료일을 확인해 주세요.', true);
      return;
    }
    setBusy(true);
    void portalHistoryRecords(filters)
      .then((data) => {
        if (!active || request !== generation.current) return;
        setLoaded(data);
        setSelected(null);
      })
      .catch((error) => {
        if (active)
          message(error?.message || '처리 기록을 불러오지 못했습니다.', true);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [filters.center, filters.from, filters.through, state.refreshVersion]);
  async function openRecord(row: HistoryRecord) {
    try {
      if (row.kind === 'task')
        choose({ type: 'task', row: await portalRecord('task', row.id) });
      else
        choose({
          type: 'incident',
          row: await portalRecord('incident', row.id),
        });
    } catch (error) {
      message(
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error),
        true,
      );
    }
  }
  return (
    <>
      <section id="quick-actions" className="quick-actions">
        <form
          className="portal-form history-filters"
          aria-busy={busy}
          onSubmit={(e) => e.preventDefault()}
        >
          <label>
            센터
            <select
              aria-label="처리 기록 센터"
              value={filters.center}
              onChange={(e) =>
                setFilters((s) => ({ ...s, center: e.target.value }))
              }
            >
              <option value="">모든 센터</option>
              {centers.map((c) => (
                <option key={c.code} value={c.code}>
                  {centerName(c.code)}
                </option>
              ))}
            </select>
          </label>
          <label>
            조회 시작일
            <input
              name="from"
              type="date"
              required
              value={filters.from}
              onChange={(e) => {
                if (e.target.value)
                  setFilters((s) => ({ ...s, from: e.target.value }));
              }}
            />
          </label>
          <label>
            조회 종료일
            <input
              name="through"
              type="date"
              required
              value={filters.through}
              onChange={(e) => {
                if (e.target.value)
                  setFilters((s) => ({ ...s, through: e.target.value }));
              }}
            />
          </label>
          <label>
            상태
            <select
              aria-label="처리 기록 상태"
              value={filters.status}
              onChange={(e) => {
                setFilters((s) => ({ ...s, status: e.target.value }));
                setSelected(null);
                update((s) => {
                  s.selected = null;
                });
              }}
            >
              <option value="">전체</option>
              {Object.entries(historyStatuses).map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <div className="view-buttons">
            {[
              ['day', '일'],
              ['week', '주'],
              ['month', '월'],
            ].map(([unit, title]) => {
              const range = periodBounds(koreaDate(), unit);
              return (
                <button
                  key={unit}
                  type="button"
                  data-history-period={unit}
                  aria-pressed={
                    range.from === filters.from &&
                    range.through === filters.through
                  }
                  onClick={() => setFilters((s) => ({ ...s, ...range }))}
                >
                  {title}
                </button>
              );
            })}
          </div>
        </form>
      </section>
      <div className="workspace">
        <section className="list">
          <div className="list-heading">
            <strong id="list-title">업무별 처리 기록</strong>
            <span id="count">
              <MentionText>{loaded ? rows.length + '건' : ''}</MentionText>
            </span>
          </div>
          <div id="items" className="portal-items">
            {rows.map((row) => (
              <HistoryRow
                key={row.key}
                row={row}
                onSelect={() => {
                  setSelected(row);
                  setGuide(false);
                  update((s) => {
                    s.selected = null;
                  });
                }}
              />
            ))}
            {loaded && !rows.length ? (
              <p>조회 조건에 해당하는 업무가 없습니다.</p>
            ) : null}
          </div>
        </section>
        <aside id="detail" aria-label="업무 처리">
          {state.selected ? (
            <PortalRecordDetail />
          ) : selected ? (
            <>
              <h2>
                <MentionText>{selected.title ?? '업무'}</MentionText>
              </h2>
              <dl>
                {[
                  ['센터', centerName(selected.center_code)],
                  ['현재 상태', historyStatuses[selected.state]],
                  ...(selected.kind === 'task'
                    ? [
                        [
                          '업무일',
                          taskPeriod(
                            selected as import('../../domain/portal-types').PortalTask,
                          ),
                        ],
                      ]
                    : []),
                  ...Object.entries(selected.inputs ?? {})
                    .filter(([, value]) => typeof value !== 'object')
                    .map(([key, value]) => [
                      key === 'work_note' ? '업무 내용' : key,
                      String(value),
                    ]),
                ]
                  .filter(([, value]) => value != null && value !== '')
                  .map(([label, value]) => (
                    <span key={label} style={{ display: 'contents' }}>
                      <dt>
                        <MentionText>{label}</MentionText>
                      </dt>
                      <dd>
                        <MentionText>{value}</MentionText>
                      </dd>
                    </span>
                  ))}
              </dl>
              <details
                className="workflow-guide"
                open={guide}
                onToggle={(e) => setGuide(e.currentTarget.open)}
              >
                <summary>업무 처리 흐름 안내</summary>
                {guide ? (
                  <iframe
                    title="일반적인 업무 처리 흐름 안내"
                    src="/assets/task-workflow.html"
                    loading="lazy"
                    sandbox="allow-scripts"
                  />
                ) : null}
              </details>
              <button
                className="primary"
                disabled={state.busy}
                onClick={() => void openRecord(selected)}
              >
                {selected.kind === 'incident' ? '특이사항 열기' : '업무 열기'}
              </button>
            </>
          ) : (
            <>
              <h2>처리 기록</h2>
              <p>업무를 펼치면 등록·수정·완료 이력을 볼 수 있습니다.</p>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
