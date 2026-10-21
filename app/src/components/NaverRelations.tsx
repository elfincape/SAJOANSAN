import { useEffect, useRef, useState } from 'react';
import { useAdminPage } from './AdminPage';
import { permissionAllowed } from '../lib/permissions';
import { dispatchProfilePermissions } from '../lib/dispatch-profiles';
import {
  relationCall,
  relationJobs,
  latestRelationJob,
  cancelRelationJob,
  relationsWorkbook,
} from '../lib/naver-relations';
import type { RelationJob, RelationPreview } from '../lib/naver-relations';
import { relationFiles } from '../domain/naver-relations';
import type { RelationSource } from '../domain/naver-relations';
import type { ProfileDestination } from '../domain/dispatch-profiles';
import { FileArea } from './FileArea';
import { useDownload } from './useDownload';
interface View {
  busy: boolean;
  stopped: boolean;
  activeJobId: string | null;
  job: RelationJob | null;
  preview: RelationPreview | null;
  sourceRows: RelationSource[] | null;
  sourceLabel: string;
  origin: string;
  limit: number;
  budget: number;
  status: string;
  count: string;
  pairFrom: string;
  pairTo: string;
  pairStatus: string;
}
const n = (v: unknown) => Number(v ?? 0).toLocaleString('ko-KR'),
  normalize = (v: unknown) =>
    String(v ?? '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim();
export function NaverRelations({
  destinations,
  blocked,
  onBusyChange,
  onCollected,
}: {
  destinations: ProfileDestination[];
  blocked: boolean;
  onBusyChange: (value: boolean) => void;
  onCollected: () => Promise<void>;
}) {
  const { profile, permissions } = useAdminPage(),
    [allowed, setAllowed] = useState(() =>
      permissionAllowed(permissions, 'delivery_points', 'edit', '002'),
    );
  const [view, setView] = useState<View>(() => ({
    busy: false,
    stopped: false,
    activeJobId: null,
    job: null,
    preview: null,
    sourceRows: null,
    sourceLabel: '평택 납품처 DB',
    origin: '경기도 평택시 산단로 263',
    limit: 50,
    budget: 25000,
    status: permissionAllowed(permissions, 'delivery_points', 'edit', '002')
      ? ''
      : '도로 구간 수집에는 평택 납품처 수정 권한이 필요합니다.',
    count: '',
    pairFrom: '',
    pairTo: '',
    pairStatus: '',
  }));
  const current = useRef(view),
    file = useRef<HTMLInputElement>(null),
    pairDetails = useRef<HTMLDetailsElement>(null),
    mounted = useRef(true),
    { download, downloadLink } = useDownload();
  const [search, setSearch] = useState(''),
    [destinationId, setDestinationId] = useState('');
  function update(change: (next: View) => void) {
    const next = { ...current.current };
    change(next);
    current.current = next;
    if (mounted.current) setView(next);
  }
  const searchKey = (v: unknown) =>
    normalize(v).toLocaleLowerCase().replace(/\s/g, '');
  const visible = destinations.filter(
      (d) =>
        d.center_code === '002' &&
        searchKey([d.code, d.name, d.address].join(' ')).includes(
          searchKey(search),
        ),
    ),
    selected =
      visible.find((d) => String(d.id) === destinationId) || visible[0];
  useEffect(() => {
    mounted.current = true;
    const stop = () =>
      update((s) => {
        s.stopped = true;
      });
    addEventListener('pagehide', stop);
    return () => {
      mounted.current = false;
      current.current = { ...current.current, stopped: true };
      removeEventListener('pagehide', stop);
    };
  }, []);
  const unavailable = view.busy || blocked || !allowed;
  function render(value: RelationJob) {
    update((s) => {
      s.job = value;
      if (value.origin) s.origin = value.origin;
      if (value.limit) s.limit = value.limit;
      if (value.directionsBudget) s.budget = value.directionsBudget;
      const labels: Record<string, string> = {
        queued: '대기',
        running: '수집 중',
        paused: '중지됨',
        attention: '확인 필요',
        completed: value.deferred
          ? '조회 한도 도달'
          : value.failed
            ? '수집 완료 · 확인 필요 구간 있음'
            : '수집 완료',
      };
      s.status =
        (labels[value.status] ?? value.status) +
        (value.error ? ' · ' + value.error : '');
      s.count = `원본 ${n(value.sourceRows)}행 · 착지 ${n(value.stops)}개 · 주소 ${n(value.geoDone)}/${n(value.geoTotal)} · 후보 ${n(value.candidates)}구간 · 처리 ${n(value.processed)}구간 · 누적 완료 ${n(value.completed)} · 누적 캐시 ${n(value.cached)} · 누적 실패 ${n(value.failed)} · 보류 ${n(value.deferred)} · 도로 요청 ${n(value.directionsAttempts)}/${n(value.directionsBudget)} · 주소 요청 ${n(value.geocodingAttempts)}/${n(value.geocodingBudget)}`;
    });
  }
  function criteria() {
    const s = current.current;
    return {
      center: '002',
      origin: s.origin.trim(),
      limit: Number(s.limit),
      directionsBudget: Number(s.budget),
      ...(s.sourceRows ? { rows: s.sourceRows } : {}),
    };
  }
  async function guarded(action: () => void | Promise<void>, refresh = false) {
    if (current.current.busy || blocked) return;
    update((s) => {
      s.busy = true;
      s.stopped = false;
    });
    onBusyChange(true);
    try {
      const latest = await dispatchProfilePermissions(),
        allowed = permissionAllowed(latest, 'delivery_points', 'edit', '002');
      setAllowed(allowed);
      if (!allowed) throw Error('평택 납품처 수정 권한이 필요합니다.');
      await action();
      if (refresh && mounted.current) await onCollected();
    } catch (error) {
      update((s) => {
        s.status = error instanceof Error ? error.message : String(error);
      });
    } finally {
      update((s) => {
        s.busy = false;
        s.activeJobId = null;
      });
      if (mounted.current) onBusyChange(false);
    }
  }
  const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  async function previewSource() {
    const preview = await relationCall<RelationPreview>('preview', criteria());
    update((s) => {
      s.preview = preview;
      s.count = `원본 ${n(preview.sourceRows)}행 · 조회 주소 ${n(preview.stops)}개 · 주소 누락 ${n(preview.invalidRows)}행 · 예상 최대 ${n(preview.estimatedCandidates)}구간 · 이번 도로 요청 한도 ${n(preview.directionsBudget)}건`;
      s.status = '후보 범위 확인 완료';
    });
    return preview;
  }
  async function collect() {
    update((s) => {
      s.activeJobId = s.job?.id || null;
    });
    while (
      !current.current.stopped &&
      current.current.job &&
      ['queued', 'running'].includes(current.current.job.status)
    ) {
      const value = await relationCall<RelationJob>('batch', {
        jobId: current.current.job.id,
      });
      if (!mounted.current) return;
      render(value);
      await wait(value.busy ? 2000 : 250);
    }
  }
  async function create() {
    render(await relationCall<RelationJob>('create', criteria()));
    await collect();
  }
  async function resume() {
    const s = current.current;
    if (!s.job) return;
    render(
      await relationCall<RelationJob>('resume', {
        jobId: s.job.id,
        directionsBudget: Number(s.budget),
        expectedUpdatedAt: s.job.updatedAt,
      }),
    );
    await collect();
  }
  async function continueDatabase() {
    const { data, error } = await relationJobs(profile.id);
    if (error) throw Error('기존 일괄 조사 작업을 확인하지 못했습니다.');
    const saved = (data || []).find(
      (row) =>
        ['queued', 'running', 'paused', 'attention'].includes(row.status) &&
        row.directions_attempts < 25000 &&
        normalize(row.state?.origin) === normalize(current.current.origin) &&
        Array.isArray(row.state?.groups) &&
        row.state.groups.length &&
        row.state.groups.every(
          (group) =>
            Array.isArray(group.sources) &&
            group.sources.length &&
            group.sources.every(
              (source) => source.source === 'delivery_points',
            ),
        ),
    );
    if (!saved) return false;
    const job = await relationCall<RelationJob>('status', { jobId: saved.id });
    render(job);
    if (job.status === 'completed' && !job.deferred) return false;
    update((s) => {
      s.budget = 25000;
    });
    if (['queued', 'running'].includes(job.status)) await collect();
    else await resume();
    return true;
  }
  async function collectDatabase() {
    update((s) => {
      s.sourceRows = null;
      s.sourceLabel = '평택 납품정보 DB 전체';
      s.budget = 25000;
      s.limit = 50;
      s.preview = null;
    });
    if (file.current) file.current.value = '';
    if (await continueDatabase()) return;
    const preview = await previewSource();
    update((s) => {
      s.limit = Math.max(
        1,
        Math.min(50, Math.floor(25000 / preview.stops) - 1),
      );
      s.status = 'DB 전체 일괄 조사 중';
    });
    await create();
  }
  async function restore() {
    const { data, error } = await latestRelationJob(profile.id);
    if (error) throw Error('최근 수집 작업을 불러오지 못했습니다.');
    if (!data) {
      update((s) => {
        s.status = '저장된 수집 작업이 없습니다.';
      });
      return;
    }
    render(await relationCall<RelationJob>('status', { jobId: data.id }));
  }
  function selectDestination(side: 'from' | 'to') {
    if (!selected?.address?.trim())
      throw Error('주소가 등록된 납품처를 선택해 주세요.');
    update((s) => {
      if (side === 'from') s.pairFrom = selected.address!.trim();
      else s.pairTo = selected.address!.trim();
      s.pairStatus =
        [selected.code, selected.name].filter(Boolean).join(' · ') +
        (side === 'from' ? ' · 출발지 선택됨' : ' · 도착지 선택됨');
    });
    if (pairDetails.current) pairDetails.current.open = true;
  }
  async function singlePair() {
    const s = current.current,
      from = s.pairFrom.trim(),
      to = s.pairTo.trim();
    if (!from || !to) throw Error('출발·도착 주소를 입력해 주세요.');
    if (
      from.normalize('NFKC').replace(/\s/g, '') ===
      to.normalize('NFKC').replace(/\s/g, '')
    ) {
      update((s) => {
        s.pairStatus = '같은 주소 · 이동 거리 0km · 이동시간 0분';
      });
      return;
    }
    let value = await relationCall<RelationJob>('create', {
      kind: 'single',
      origin: from,
      rows: [{ address: to, source: 'manual', sourceRow: 1 }],
      limit: 1,
      directionsBudget: 3,
    });
    update((s) => {
      s.activeJobId = value.id;
    });
    while (
      !current.current.stopped &&
      ['queued', 'running'].includes(value.status)
    ) {
      update((s) => {
        s.pairStatus = '구간 조회 중';
      });
      value = await relationCall<RelationJob>('batch', { jobId: value.id });
      if (!mounted.current) return;
      if (value.busy) await wait(2000);
    }
    const r = value.lastResults?.at(-1);
    update((s) => {
      s.pairStatus = value.sameLocation
        ? '같은 좌표 · 이동 거리 0km · 이동시간 0분'
        : r && !r.error
          ? `${(r.distanceMeters! / 1000).toFixed(2)}km · ${(r.durationSeconds! / 60).toFixed(1)}분 · ${new Date(r.measuredAt!).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · ${r.cached ? '저장값 재사용' : 'DB 저장 완료'}`
          : value.error || r?.error || '구간 조회 중지';
    });
  }
  function upload(files: File[]) {
    void guarded(async () => {
      const rows = await relationFiles(files);
      update((s) => {
        s.sourceRows = rows;
        s.sourceLabel = files.map((f) => f.name).join(', ');
        s.preview = null;
      });
      await previewSource();
    });
  }
  const jobIssues = [
      ...(view.job?.geoIssues ?? []),
      ...(view.job?.routeIssues ?? []),
      ...(view.job?.apiIssue ? [view.job.apiIssue] : []),
    ],
    labels: Record<string, string> = {
      unmanned: '무인',
      attended: '유인',
      yard: '야적',
      unknown: '미확인',
    },
    reasons: Record<string, string> = {
      center: '센터 출발',
      historical: '기존 배송',
      region: '권역',
      nearby: '인접',
    };
  function button(
    id: string,
    text: string,
    action: () => void | Promise<void>,
    options: {
      primary?: boolean;
      disabled?: boolean;
      hidden?: boolean;
      refresh?: boolean;
    } = {},
  ) {
    return (
      <button
        id={id}
        type="button"
        className={`btn ${options.primary ? 'btn-primary' : 'btn-ghost'}`}
        disabled={unavailable || !!options.disabled}
        hidden={options.hidden}
        onClick={() => void guarded(action, options.refresh)}
      >
        {text}
      </button>
    );
  }
  return (
    <div id="relations-panel">
      <div className="pd-toolbar">
        <h4>배차용 도로 구간</h4>
        <span id="relation-source-label" className="pd-muted">
          {view.sourceLabel}
        </span>
      </div>
      <div className="pd-toolbar">
        {button(
          'relation-bulk',
          '납품정보 DB 전체 일괄 조사',
          collectDatabase,
          { primary: true, refresh: true },
        )}
        {button('relation-restore', '최근 작업', restore)}
        {button('relation-resume', '이어서 조사', resume, {
          disabled:
            !view.job ||
            (view.job.status === 'completed' && !view.job.deferred),
          refresh: true,
        })}
        <button
          id="relation-stop"
          className="btn btn-ghost"
          hidden={!view.busy || !view.activeJobId}
          disabled={view.stopped}
          onClick={() => {
            const id = current.current.activeJobId;
            if (!id) return;
            update((s) => {
              s.stopped = true;
            });
            void cancelRelationJob(id).then(({ error }) =>
              update((s) => {
                s.status = error
                  ? '중지 요청 실패 · 현재 배치 종료 후 조회를 멈춥니다.'
                  : '중지 요청됨 · 진행 중인 결과 저장 대기';
              }),
            );
          }}
        >
          중지
        </button>
        {button(
          'relation-download',
          '구간 다운로드',
          async () =>
            download(
              new Blob([await relationsWorkbook()], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              }),
              '평택_도로구간.xlsx',
            ),
          { disabled: !view.job?.completed },
        )}
      </div>
      <details id="relation-settings">
        <summary>조사 범위·파일 선택</summary>
        <div className="pd-fields">
          <label>
            센터 출발지
            <input
              id="relation-origin"
              maxLength={300}
              value={view.origin}
              disabled={unavailable}
              onChange={(e) =>
                update((s) => {
                  s.origin = e.target.value;
                  s.preview = null;
                })
              }
            />
          </label>
          <label>
            착지별 후보 수
            <input
              id="relation-limit"
              type="number"
              min="1"
              max="50"
              step="1"
              value={view.limit}
              disabled={unavailable}
              onChange={(e) =>
                update((s) => {
                  s.limit = Number(e.target.value);
                  s.preview = null;
                })
              }
            />
          </label>
          <label>
            도로 조회 한도
            <select
              id="relation-budget"
              value={view.budget}
              disabled={unavailable}
              onChange={(e) =>
                update((s) => {
                  s.budget = Number(e.target.value);
                  s.preview = null;
                })
              }
            >
              <option value="60">시험 · 60건</option>
              <option value="1000">1,000건</option>
              <option value="25000">25,000건</option>
              {![60, 1000, 25000].includes(view.budget) ? (
                <option value={view.budget}>{n(view.budget)}건</option>
              ) : null}
            </select>
          </label>
          <FileArea
            accept=".xlsx,.xls,.csv"
            multiple
            disabled={unavailable}
            onFiles={upload}
          >
            <label>
              조사 대상 파일
              <input
                ref={file}
                id="relation-files"
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                disabled={unavailable}
                onChange={(e) => {
                  const files = [...(e.target.files || [])];
                  if (files.length) upload(files);
                }}
              />
            </label>
          </FileArea>
        </div>
        <div className="pd-toolbar">
          {button('relation-use-db', '평택 납품처 DB 선택', async () => {
            update((s) => {
              s.sourceRows = null;
              s.sourceLabel = '평택 납품처 DB';
              s.preview = null;
            });
            if (file.current) file.current.value = '';
            await previewSource();
          })}
          {button('relation-preview', '후보 확인', async () => {
            await previewSource();
          })}
          {button('relation-start', '선택 자료 수집', create, {
            primary: true,
            disabled: !view.preview,
            refresh: true,
          })}
        </div>
      </details>
      <p id="relation-status" role="status" aria-live="polite">
        {view.status}
      </p>
      <p id="relation-count" className="pd-muted">
        {view.count}
      </p>
      <p id="relation-allowance" className="pd-muted">
        센터 월 합산 도로 25,000회·주소 2,000회 한도. 네이버 계정 무료 잔여량
        미확인.
      </p>
      <details id="relation-issues" hidden={!jobIssues.length}>
        <summary>주소·구간 확인 필요</summary>
        <ul id="relation-issue-list">
          {jobIssues.map((issue, i) => (
            <li key={i}>
              {(issue.address ||
                [issue.from, issue.to].filter(Boolean).join(' → ')) +
                ' · ' +
                issue.error}
              {issue.providerDetail ? (
                <details>
                  <summary>네이버 응답 상세</summary>
                  <pre
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {issue.providerDetail}
                  </pre>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
      <details id="relation-db-single">
        <summary>단건 납품처 조회</summary>
        <div className="pd-fields">
          <label>
            납품처 검색
            <input
              id="relation-destination-search"
              type="search"
              placeholder="코드·착지명·주소"
              value={search}
              disabled={unavailable}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            납품처
            <select
              id="relation-destination"
              value={selected?.id || ''}
              disabled={unavailable}
              onChange={(e) => setDestinationId(e.target.value)}
            >
              {visible.map((d) => (
                <option key={d.id} value={d.id}>
                  {[d.code, d.name, d.address || '주소 미등록']
                    .filter(Boolean)
                    .join(' · ')}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p id="relation-destination-info" className="pd-muted" role="status">
          {selected
            ? [
                selected.code,
                selected.name,
                selected.address || '주소 미등록',
                selected.dispatch_profile
                  ? `OTD ${selected.dispatch_profile.otd || '미지정'} · ${labels[selected.dispatch_profile.mode] || '미확인'}`
                  : '납품정보 미등록',
              ]
                .filter(Boolean)
                .join(' · ')
            : '검색 결과가 없습니다.'}
        </p>
        <div className="pd-toolbar">
          {button(
            'relation-center-pair',
            '센터 구간 조회',
            async () => {
              const origin = current.current.origin.trim();
              if (!origin) throw Error('센터 출발지 주소를 입력해 주세요.');
              update((s) => {
                s.pairFrom = origin;
              });
              selectDestination('to');
              await singlePair();
            },
            { disabled: !selected?.address?.trim(), refresh: true },
          )}
          {button(
            'relation-select-from',
            '출발지 선택',
            () => selectDestination('from'),
            { disabled: !selected?.address?.trim() },
          )}
          {button(
            'relation-select-to',
            '도착지 선택',
            () => selectDestination('to'),
            { disabled: !selected?.address?.trim() },
          )}
        </div>
      </details>
      <details ref={pairDetails} id="relation-single-pair">
        <summary>단일 구간 추가 조회</summary>
        <div className="pd-fields">
          <label>
            출발 주소
            <input
              id="relation-pair-from"
              maxLength={300}
              value={view.pairFrom}
              disabled={unavailable}
              onChange={(e) =>
                update((s) => {
                  s.pairFrom = e.target.value;
                })
              }
            />
          </label>
          <label>
            도착 주소
            <input
              id="relation-pair-to"
              maxLength={300}
              value={view.pairTo}
              disabled={unavailable}
              onChange={(e) =>
                update((s) => {
                  s.pairTo = e.target.value;
                })
              }
            />
          </label>
        </div>
        {button('relation-pair', '구간 조회·저장', singlePair, {
          refresh: true,
        })}
        <p id="relation-pair-status" role="status" aria-live="polite">
          {view.pairStatus}
        </p>
      </details>
      <div className="pd-scroll">
        <table>
          <thead>
            <tr>
              {[
                '출발',
                '도착',
                '선정 기준',
                '도로 거리(km)',
                '이동시간(분)',
                '측정 시각',
                '상태',
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody id="relation-results">
            {view.job?.lastResults?.map((r, i) => (
              <tr key={i}>
                {[
                  r.from,
                  r.to,
                  reasons[r.reason] ?? r.reason,
                  Number.isFinite(r.distanceMeters)
                    ? (r.distanceMeters! / 1000).toFixed(2)
                    : '',
                  Number.isFinite(r.durationSeconds)
                    ? (r.durationSeconds! / 60).toFixed(1)
                    : '',
                  r.measuredAt
                    ? new Date(r.measuredAt).toLocaleString('ko-KR', {
                        timeZone: 'Asia/Seoul',
                      })
                    : '',
                  r.error ||
                    [
                      r.cached ? '저장값' : '조회값',
                      r.measuredAt &&
                      Date.now() - Date.parse(r.measuredAt) > 1800000
                        ? '오래된 추정'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · '),
                ].map((value, i) => (
                  <td key={i}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {downloadLink}
    </div>
  );
}
