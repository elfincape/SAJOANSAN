import { useEffect, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import '../styles/operations.css';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { useDownload } from '../components/useDownload';
import {
  operationsContext,
  operationsTasks,
  operationsIncidents,
  operationsDailyLog,
  operationsIncidentAction,
} from '../lib/operations';
import {
  statusLabels,
  actionLabels,
  koreaDate,
  dateRange,
  filterOperations,
  exportRows,
} from '../domain/operations';
import type {
  OperationsRecord,
  OperationsContext,
  OperationsFilters,
} from '../domain/operations';
const titles = {
    tasks: '업무 현황',
    daily: '실제 처리 기록',
    incidents: '특이사항',
  },
  supportLabels: Record<string, string> = {
    none: '없음',
    requested: '요청',
    supporting: '지원중',
    done: '지원완료',
  };
type View = keyof typeof titles;
const time = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '—';
const failure = (error: unknown, fallback = '') =>
  error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : fallback;
function Badge({ status }: { status: string }) {
  return (
    <span
      className={
        'badge ' +
        (['completed', 'resolved'].includes(status)
          ? 'done'
          : ['open', 'in_progress'].includes(status)
            ? 'open'
            : '')
      }
    >
      {statusLabels[status] ?? status}
    </span>
  );
}
function Work() {
  const { profile } = useAdminPage(),
    { download, downloadLink } = useDownload();
  const [context, setContext] = useState<OperationsContext | null>(null),
    [view, setView] = useState<View>('tasks'),
    [rows, setRows] = useState<OperationsRecord[]>([]),
    [selected, setSelected] = useState<OperationsRecord | null>(null),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState({ text: '', error: false }),
    [period, setPeriod] = useState('day'),
    [filters, setFilters] = useState<OperationsFilters>(() => ({
      center: '',
      ...dateRange('day'),
      kind: '',
      settlement: '',
      unfinished: true,
    })),
    [loadedFilters, setLoadedFilters] = useState<{
      center: string;
      from?: string;
      through?: string;
    } | null>(null),
    [supportNote, setSupportNote] = useState(''),
    [supportDone, setSupportDone] = useState(false);
  const state = useRef({ view, filters, selected, busy });
  state.current = { view, filters, selected, busy };
  const sequence = useRef(0),
    pending = useRef<{ key: string; requestId: string } | null>(null);
  const status = (text: string, error = false) => setMessage({ text, error });
  async function load(
    nextView = state.current.view,
    nextFilters = state.current.filters,
  ) {
    const current = ++sequence.current;
    if (
      nextView !== 'incidents' &&
      (!nextFilters.from ||
        !nextFilters.through ||
        nextFilters.from > nextFilters.through)
    ) {
      status('시작일과 종료일을 확인해 주세요.', true);
      return;
    }
    setBusy(true);
    status('기록을 불러오는 중입니다…');
    try {
      const result =
        nextView === 'daily'
          ? await operationsDailyLog(nextFilters)
          : nextView === 'incidents'
            ? await operationsIncidents({
                center: nextFilters.center,
                includeResolved: !nextFilters.unfinished,
              })
            : await operationsTasks({
                center: nextFilters.center,
                from: nextFilters.from,
                through: nextFilters.through,
                includeCompleted: !nextFilters.unfinished,
              });
      if (current !== sequence.current) return;
      const rows =
          nextView === 'incidents'
            ? result
            : filterOperations(result, nextFilters),
        id = state.current.selected?.id;
      setLoadedFilters(
        nextView === 'incidents' ? { center: nextFilters.center } : nextFilters,
      );
      setRows(rows);
      setSelected(rows.find((row) => row.id === id) ?? null);
      setSupportNote('');
      setSupportDone(false);
      status(
        nextView === 'tasks'
          ? '과거 미완료 업무도 함께 표시합니다.'
          : nextView === 'daily'
            ? '업무·특이사항의 실제 처리 시각을 기준으로 조회합니다.'
            : '미완료만을 해제하면 해결된 특이사항도 함께 표시합니다.',
      );
    } catch (error) {
      if (current === sequence.current) {
        setRows([]);
        setSelected(null);
        status(failure(error, '기록을 불러오지 못했습니다.'), true);
      }
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    void operationsContext()
      .then((context) => {
        if (!active) return;
        setContext(context);
        const requested = new URLSearchParams(location.search).get('center'),
          code =
            ({ ansan: '001', pyeongtaek: '002' } as Record<string, string>)[
              requested || ''
            ] ?? requested,
          center = context.centers.some((c) => c.code === code)
            ? code!
            : context.centers[0]?.code || '',
          next = { ...state.current.filters, center };
        setFilters(next);
        void load('tasks', next);
      })
      .catch((error) => {
        if (active) {
          status(failure(error, String(error)), true);
          setBusy(false);
        }
      });
    return () => {
      active = false;
      sequence.current++;
    };
  }, []);
  async function incidentAction(
    row: OperationsRecord,
    action: string,
    data: Record<string, unknown>,
  ) {
    if (state.current.busy) return;
    const key = JSON.stringify([row.id, row.version, action, data]);
    if (pending.current?.key !== key)
      pending.current = { key, requestId: crypto.randomUUID() };
    setBusy(true);
    try {
      await operationsIncidentAction({
        requestId: pending.current.requestId,
        incident: row,
        action,
        data,
      });
      pending.current = null;
      await load();
      status('처리 내용이 저장됐습니다.');
    } catch (error) {
      status(failure(error, '저장하지 못했습니다. 다시 시도해 주세요.'), true);
    } finally {
      setBusy(false);
    }
  }
  async function exportExcel() {
    if (!rows.length) {
      status('다운로드할 기록이 없습니다.');
      return;
    }
    if (!loadedFilters || !context) return;
    setBusy(true);
    try {
      const data = exportRows(rows, view),
        book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet('운영기록');
      sheet.columns = Object.keys(data[0]).map((header) => ({
        header,
        key: header,
        width: header === '업무' || header === '실제 조치' ? 30 : 18,
      }));
      sheet.addRows(data);
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.columnCount },
      };
      sheet.getRow(1).font = { bold: true };
      download(
        new Blob([await book.xlsx.writeBuffer()], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `운영기록_${context.centers.find((c) => c.code === loadedFilters.center)?.name}_${view}_${loadedFilters.from ?? '전체'}_${loadedFilters.through ?? '전체'}.xlsx`,
      );
      status(`현재 조회된 ${data.length}건을 다운로드했습니다.`);
    } catch (error) {
      status(failure(error, String(error)), true);
    } finally {
      setBusy(false);
    }
  }
  const info: [string, unknown][] = selected
    ? [
        [
          '센터',
          context?.centers.find((c) => c.code === selected.center_code)?.name,
        ],
        ['업무일', selected.work_date ?? selected.report_date],
        ['처리 시각', selected.occurred_at ? time(selected.occurred_at) : null],
        ['배송 마감', selected.due_at ? time(selected.due_at) : null],
        [
          'CJ 공유 마감',
          selected.cj_share_due_at ? time(selected.cj_share_due_at) : null,
        ],
        ...[
          '기사명',
          '차량번호',
          '코스·납품처',
          '톤수',
          '사유',
          '대차기사명',
          '대차차량번호',
          '정산방식',
          '발생내용',
        ].map((key) => [key, selected.inputs?.[key]] as [string, unknown]),
        ['실제 조치', selected.action_note],
        ['인계 메모', selected.handoff_memo],
      ]
    : [];
  return (
    <main id="work-main" className="app-main" tabIndex={-1}>
      <div className="heading">
        <div>
          <h1>업무와 특이사항</h1>

        </div>
        <div>
          <button id="refresh" disabled={busy} onClick={() => void load()}>
            새로고침
          </button>
        </div>
      </div>
      <nav aria-label="조회 화면">
        {(['tasks', 'daily', 'incidents'] as const).map((key) => (
          <button
            key={key}
            data-view={key}
            aria-pressed={view === key}
            disabled={busy}
            onClick={() => {
              setView(key);
              setSelected(null);
              state.current = { ...state.current, view: key, selected: null };
              void load(key);
            }}
          >
            {key === 'daily' ? '일일·주간 기록' : titles[key]}
          </button>
        ))}
      </nav>
      <form
        id="filters"
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          센터
          <select
            name="center"
            value={filters.center}
            onChange={(e) =>
              setFilters((s) => ({ ...s, center: e.target.value }))
            }
          >
            {context?.centers.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          기간
          <select
            name="period"
            value={period}
            disabled={view === 'incidents'}
            onChange={(e) => {
              const value = e.target.value;
              setPeriod(value);
              if (value !== 'custom')
                setFilters((s) => ({ ...s, ...dateRange(value, koreaDate()) }));
            }}
          >
            <option value="day">일간</option>
            <option value="week">최근 7일</option>
            <option value="month">월간</option>
            <option value="custom">직접 선택</option>
          </select>
        </label>
        {(['from', 'through'] as const).map((key, index) => (
          <label key={key}>
            {index ? '종료일' : '시작일'}
            <input
              name={key}
              type="date"
              required
              disabled={view === 'incidents'}
              value={filters[key]}
              onChange={(e) => {
                setFilters((s) => ({ ...s, [key]: e.target.value }));
                setPeriod('custom');
              }}
            />
          </label>
        ))}
        <label>
          업무
          <select
            name="kind"
            disabled={view === 'incidents'}
            value={filters.kind}
            onChange={(e) =>
              setFilters((s) => ({ ...s, kind: e.target.value }))
            }
          >
            <option value="">전체</option>
            <option value="replacement">대차 배차 진행</option>
          </select>
        </label>
        <label>
          정산방식
          <select
            name="settlement"
            disabled={view === 'incidents'}
            value={filters.settlement}
            onChange={(e) =>
              setFilters((s) => ({ ...s, settlement: e.target.value }))
            }
          >
            <option value="">전체</option>
            <option>월대공제</option>
            <option>기사직접</option>
          </select>
        </label>
        <label className="check">
          <input
            name="unfinished"
            type="checkbox"
            checked={filters.unfinished}
            disabled={view === 'daily'}
            onChange={(e) =>
              setFilters((s) => ({ ...s, unfinished: e.target.checked }))
            }
          />
          미완료만
        </label>
        <button type="submit" className="primary" disabled={busy}>
          조회
        </button>
        <button
          id="export"
          type="button"
          disabled={busy}
          onClick={() => void exportExcel()}
        >
          엑셀 다운로드
        </button>
      </form>
      <div
        id="message"
        role="status"
        aria-live="polite"
        className={message.error ? 'error' : ''}
      >
        {message.text}
      </div>
      <div className="workspace">
        <section className="list" aria-label="업무 목록">
          <div className="list-heading">
            <strong id="list-title">{titles[view]}</strong>
            <span id="count">{rows.length}건</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead id="head">
                <tr>
                  {(view === 'daily'
                    ? ['처리 시각', '업무', '처리', '정산방식']
                    : view === 'incidents'
                      ? ['발생일', '특이사항', '상태', 'HQ 지원']
                      : ['업무일', '업무', '상태', '정산방식', 'CJ 공유 마감']
                  ).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody id="rows">
                {rows.length ? (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      className={
                        selected?.id === row.id ? 'selected' : undefined
                      }
                    >
                      <td>
                        {view === 'daily'
                          ? time(row.occurred_at)
                          : view === 'incidents'
                            ? time(row.created_at)
                            : (row.work_date ?? '—')}
                      </td>
                      <td className="title">
                        <button
                          className="row-link"
                          onClick={() => {
                            setSelected(row);
                            setSupportNote('');
                            setSupportDone(false);
                          }}
                        >
                          {row.title}
                        </button>
                      </td>
                      {view === 'daily' ? (
                        <>
                          <td>
                            {actionLabels[row.action || ''] ??
                              row.action ??
                              '—'}
                          </td>
                          <td>{String(row.inputs?.['정산방식'] || '—')}</td>
                        </>
                      ) : (
                        <>
                          <td>
                            <Badge status={row.status} />
                          </td>
                          <td>
                            {view === 'incidents'
                              ? (supportLabels[row.support_state || ''] ??
                                row.support_state ??
                                '—')
                              : String(row.inputs?.['정산방식'] || '—')}
                          </td>
                          {view === 'tasks' ? (
                            <td>{time(row.cj_share_due_at)}</td>
                          ) : null}
                        </>
                      )}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="empty" colSpan={view === 'tasks' ? 5 : 4}>
                      조회 조건에 해당하는 기록이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <aside id="detail" aria-label="선택한 항목">
          {selected ? (
            <>
              <h2>{selected.title}</h2>
              <Badge status={selected.status} />
              <dl>
                {info
                  .filter(([, v]) => v !== null && v !== undefined && v !== '')
                  .map(([label, value], i) => (
                    <span key={i} style={{ display: 'contents' }}>
                      <dt>{label}</dt>
                      <dd>{String(value)}</dd>
                    </span>
                  ))}
              </dl>
              {view === 'incidents' ? (
                <>
                  <div className="actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void incidentAction(
                          selected,
                          selected.status === 'open' ? 'resolve' : 'reopen',
                          {},
                        )
                      }
                    >
                      {selected.status === 'open' ? '해결 처리' : '재개'}
                    </button>
                  </div>
                  {profile.role === 'admin' && selected.status === 'open' ? (
                    <>
                      <form
                        id="support-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void incidentAction(selected, 'support', {
                            note: supportNote.trim(),
                            done: supportDone,
                          });
                        }}
                      >
                        <label>
                          실제로 수행한 HQ 조치
                          <textarea
                            required
                            maxLength={5000}
                            value={supportNote}
                            onChange={(e) => setSupportNote(e.target.value)}
                          />
                        </label>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={supportDone}
                            onChange={(e) => setSupportDone(e.target.checked)}
                          />
                          HQ 지원 완료
                        </label>
                        <button className="primary" disabled={busy}>
                          조치 기록
                        </button>
                      </form>
                      <p className="note">
                        지원 완료와 사건 해결은 별도로 기록됩니다.
                      </p>
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <p>목록에서 항목을 선택하면 상세 내용을 볼 수 있습니다.</p>
          )}
        </aside>
      </div>
      {downloadLink}
    </main>
  );
}
export default function Operations() {
  return (
    <AdminPage title="운영 업무" minRole="viewer" bodyClass="">
      <Work />
    </AdminPage>
  );
}
