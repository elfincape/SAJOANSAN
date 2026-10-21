import { Fragment, useEffect, useRef, useState } from 'react';
import { usePortal } from './PortalStore';
import { portalRecord } from '../../lib/portal';
import {
  portalSearch,
  portalSearchMaster,
  portalDocumentSearch,
} from '../../lib/portal-search';
import type { DocumentSearchResult } from '../../lib/portal-search';
import { searchTarget, searchLabels } from '../../domain/portal-search';
import type { SearchResult, SearchRow } from '../../domain/portal-search';
import { PortalRecordDetail } from './PortalRecordDetail';
function Documents({
  term,
  center,
  page,
  next,
  open,
}: {
  term: string;
  center: string;
  page: number;
  next: () => void;
  open: (kind: string, row: SearchRow) => void;
}) {
  const [result, setResult] = useState<DocumentSearchResult | null>(null),
    [status, setStatus] = useState('문서 본문을 검색하고 있습니다…');
  useEffect(() => {
    let active = true;
    void portalDocumentSearch(term, center, page)
      .then((data) => {
        if (!active) return;
        setResult(data);
        setStatus(
          !data
            ? '문서 본문 검색 연결을 준비하고 있습니다. 파일명 검색과 원본 기록은 위 결과에서 이용할 수 있습니다.'
            : data.pending
              ? '일부 문서를 준비 중입니다. 다시 검색하면 색인이 이어집니다.'
              : data.total
                ? '원본을 열어 검색 내용을 확인하세요.'
                : '문서 본문 검색 결과가 없습니다.',
        );
      })
      .catch((error) => {
        if (active)
          setStatus(
            (error?.name === 'TimeoutError'
              ? '문서 본문 검색이 지연되고 있습니다.'
              : error?.message || '문서 검색 서버에 연결하지 못했습니다.') +
              ' 기존 검색 결과는 계속 이용할 수 있습니다.',
          );
      });
    return () => {
      active = false;
    };
  }, [term, center, page]);
  return (
    <section
      className="document-search-results"
      aria-label="첨부 문서 본문 검색"
    >
      <h3>첨부 문서 본문{result ? ' · ' + result.total + '건' : ''}</h3>
      <p role="status">{status}</p>
      {result?.items.map((row) => {
        const kind = ['task', 'incident', 'survey'].find(
          (type) => row[type + '_id'],
        );
        return kind ? (
          <div key={row.id} className="history-entry">
            <strong>{row.title}</strong>
            <p>{row.excerpt}</p>
            <button onClick={() => open('file', row)}>
              첨부된 원본 기록 열기
            </button>
          </div>
        ) : null;
      })}
      {result && result.total > (page + 1) * 20 ? (
        <button onClick={next}>문서 본문 다음 20건</button>
      ) : null}
    </section>
  );
}
export function PortalSearch() {
  const { state, centerName, message, choose, update, viewState } = usePortal(),
    saved = viewState.get('search') as
      { term: string; center: string; page: number } | undefined,
    [term, setTerm] = useState(saved?.term ?? ''),
    [center, setCenter] = useState(saved?.center ?? ''),
    [query, setQuery] = useState<{
      term: string;
      center: string;
      page: number;
      serial: number;
    } | null>(null),
    [result, setResult] = useState<SearchResult | null>(null),
    [busy, setBusy] = useState(false),
    [master, setMaster] = useState<{
      kind: string;
      row: SearchRow;
      data: Record<string, unknown>;
      href: string;
    } | null>(null),
    detailGeneration = useRef(0),
    generation = useRef(0);
  async function search(page = 0, termValue = term, centerValue = center) {
    const value = termValue.trim();
    if (value.length < 2 || value.length > 100) {
      message('검색어를 2~100자로 입력하세요.', true);
      return;
    }
    const request = ++generation.current;
    ++detailGeneration.current;
    setBusy(true);
    message('검색 중입니다…');
    try {
      const result = await portalSearch(value, centerValue, page);
      if (request !== generation.current) return;
      viewState.set('search', { term: value, center: centerValue, page });
      setResult(result);
      setQuery({ term: value, center: centerValue, page, serial: request });
      message('');
    } catch (error) {
      if (request === generation.current)
        message(
          error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : '검색하지 못했습니다.',
          true,
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  useEffect(
    () => () => {
      generation.current++;
      detailGeneration.current++;
    },
    [],
  );
  useEffect(() => {
    if (saved?.term) void search(saved.page, saved.term, saved.center);
  }, []);
  const refresh = useRef(state.refreshVersion);
  useEffect(() => {
    if (refresh.current !== state.refreshVersion) {
      refresh.current = state.refreshVersion;
      if (query) void search(query.page, query.term, query.center);
    }
  }, [state.refreshVersion]);
  async function open(kind: string, row: SearchRow) {
    const target = searchTarget(kind, row);
    if (!target) return;
    const request = ++detailGeneration.current;
    try {
      if (target.href) {
        message('원본 정보를 불러오는 중입니다…');
        const data = await portalSearchMaster(kind, row.id);
        if (request !== detailGeneration.current) return;
        update((s) => {
          s.selected = null;
        });
        setMaster({ kind, row, data, href: target.href });
        message('');
      } else if (target.id) {
        if (target.type === 'task')
          choose({ type: 'task', row: await portalRecord('task', target.id) });
        else if (target.type === 'incident')
          choose({
            type: 'incident',
            row: await portalRecord('incident', target.id),
          });
        else if (target.type === 'survey')
          choose({
            type: 'survey',
            row: await portalRecord('survey', target.id),
          });
      }
    } catch (error) {
      if (request === detailGeneration.current)
        message(
          error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : '원본 정보를 불러오지 못했습니다.',
          true,
        );
    }
  }
  return (
    <>
      <section id="quick-actions" className="quick-actions">
        <form
          className="portal-form"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            type="search"
            required
            minLength={2}
            maxLength={100}
            placeholder="업무명·차량번호·기사·회사·납품처"
            aria-label="검색어"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <select
            aria-label="검색 센터"
            value={center}
            onChange={(e) => setCenter(e.target.value)}
          >
            <option value="">모든 센터</option>
            {state.context?.centers.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="primary" disabled={busy}>
            검색
          </button>
        </form>
      </section>
      <div className="workspace">
        <section className="list">
          <div className="list-heading">
            <strong id="list-title">유형별 검색 결과</strong>
            <span id="count">
              {result
                ? result.groups.reduce((sum, g) => sum + g.total, 0) + '건'
                : ''}
            </span>
          </div>
          <div id="items" className="portal-items">
            {result ? (
              result.groups.map((group) => (
                <Fragment key={group.kind}>
                  <h3>
                    {searchLabels[group.kind] ?? group.kind} · {group.total}건
                  </h3>
                  {group.items.map((row) => {
                    const target = searchTarget(group.kind, row);
                    return (
                      <div key={row.id} className="history-entry">
                        <p>{row.title}</p>
                        <small>
                          {[
                            row.center_code
                              ? centerName(row.center_code)
                              : '공통',
                            row.work_date,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                        {target ? (
                          <button onClick={() => void open(group.kind, row)}>
                            {target.href
                              ? '현재 원본 정보 보기'
                              : group.kind === 'file'
                                ? '첨부된 원본 기록 열기'
                                : '원본 기록 열기'}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </Fragment>
              ))
            ) : (
              <p>
                업무명·차량번호·기사·회사·납품처 중 두 글자 이상 입력하세요.
                완료된 기록도 함께 검색합니다.
              </p>
            )}
            {result && !result.groups.reduce((sum, g) => sum + g.total, 0) ? (
              <p>
                검색 결과가 없습니다. 검색어를 줄이거나 센터를 모든 센터로
                변경해 보세요.
              </p>
            ) : null}
            {query ? (
              <>
                <Documents
                  key={query.serial}
                  term={query.term}
                  center={query.center}
                  page={query.page}
                  next={() => void search(query.page + 1)}
                  open={(kind, row) => void open(kind, row)}
                />
                <div>
                  {query.page > 0 ? (
                    <button onClick={() => void search(query.page - 1)}>
                      이전 20건
                    </button>
                  ) : null}
                  {result?.groups.some(
                    (g) => g.total > (query.page + 1) * 20,
                  ) && query.page < 100 ? (
                    <button onClick={() => void search(query.page + 1)}>
                      유형별 다음 20건
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </section>
        <aside id="detail" aria-label="업무 처리">
          {state.selected ? (
            <PortalRecordDetail />
          ) : master ? (
            <>
              <h2>{master.row.title}</h2>
              <p>
                {searchLabels[master.kind]} ·{' '}
                {master.data.center_code
                  ? centerName(String(master.data.center_code))
                  : '공통'}
              </p>
              {Object.entries({
                name: '이름',
                plate_number: '차량번호',
                car_number: '차량번호',
                code: '코드',
                phone: '연락처',
                address: '주소',
                region: '지역',
                tonnage: '톤수',
                memo: '메모',
              })
                .filter(
                  ([key]) =>
                    master.data[key] != null && master.data[key] !== '',
                )
                .map(([key, label]) => (
                  <Fragment key={key}>
                    <h4>{label}</h4>
                    <p>{String(master.data[key])}</p>
                  </Fragment>
                ))}
              <a href={master.href}>관리 화면 열기</a>
              {master.kind === 'vehicles' && master.data.plate_number ? (
                <button
                  onClick={() => {
                    setTerm(String(master.data.plate_number));
                    setCenter('');
                    void search(0, String(master.data.plate_number), '');
                  }}
                >
                  차량번호로 과거 업무·특이사항 찾기
                </button>
              ) : null}
            </>
          ) : (
            <>
              <h2>통합 검색</h2>
              <p>
                완료 업무와 해결된 특이사항도 검색합니다. 차량번호로 과거
                특이사항을 찾을 때는 당시 입력한 번호를 사용하세요.
              </p>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
