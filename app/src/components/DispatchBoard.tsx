import { useState } from 'react';
import { addressKey } from '../domain/cj-import';
import type {
  DispatchAddress,
  CJGroup,
  CJJob,
  CJPlan,
} from '../domain/cj-types';

const number = (value: number) =>
  value.toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const kinds: Record<string, string> = {
  fixed: '고정차',
  temporary: '용차 검토',
  external: '외부 지정',
  review: '소속 확인',
};
export function DispatchBoard({
  plan,
  groups,
  addresses,
  focusedJobId: focus,
  onFocusJob: setFocus,
  disabled,
  editable,
  onEdit,
  onReorder,
  onExport,
}: {
  plan: CJPlan;
  groups: CJGroup[];
  addresses: DispatchAddress[];
  focusedJobId: string;
  onFocusJob: (id: string) => void;
  disabled: boolean;
  editable: boolean;
  onEdit: (job: CJJob) => void;
  onReorder: (groupId: string, index: number, direction: number) => void;
  onExport: (jobs: CJJob[]) => void;
}) {
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [mapOpen, setMapOpen] = useState(false);
  const jobs = new Map(plan.jobs.map((job) => [job.id, job]));
  const selected = plan.jobs.filter((job) => selection.has(job.id));
  const focused = jobs.get(focus);
  const focusedGroup =
    focused && plan.groups.find((group) => group.jobIds.includes(focus));
  const matching = focused?.address.trim()
    ? addresses.filter(
        (item) =>
          item.status === 'ready' &&
          Number.isFinite(item.x) &&
          Number.isFinite(item.y) &&
          Math.abs(item.x!) <= 180 &&
          Math.abs(item.y!) <= 90 &&
          [item.address, item.address_key, item.standard_address].some(
            (text) => text && addressKey(text) === addressKey(focused.address),
          ),
      )
    : [];
  const coordinateKeys = new Set(matching.map((item) => `${item.x},${item.y}`));
  const point = coordinateKeys.size === 1 ? matching[0] : undefined;
  const mapUrl = point
    ? `https://www.openstreetmap.org/export/embed.html?${new URLSearchParams({ bbox: `${Math.max(-180, point.x! - 0.01)},${Math.max(-90, point.y! - 0.008)},${Math.min(180, point.x! + 0.01)},${Math.min(90, point.y! + 0.008)}`, layer: 'mapnik', marker: `${point.y},${point.x}` })}`
    : '';
  return (
    <div className="dispatch-spatial">
      <div className="dispatch-board-hint">
        <p className="muted">
          차량별 착지 순서 · 카드를 선택하면 원본과 주소를 확인합니다. 이동은
          기존 착지 확인 절차를 사용합니다.
        </p>
        {selected.length > 0 ? (
          <div className="toolbar" role="region" aria-label="선택 착지 작업">
            <strong>
              {selected.length}건 ·{' '}
              {number(selected.reduce((sum, job) => sum + job.quantity, 0))}{' '}
              {plan.quantityUnit}
            </strong>
            <button
              className="btn btn-ghost"
              disabled={disabled}
              onClick={() => onExport(selected)}
            >
              선택 내역 다운로드
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setSelection(new Set())}
            >
              선택 해제
            </button>
          </div>
        ) : null}
      </div>
      {focused && focusedGroup ? (
        <aside
          className="dispatch-focus"
          aria-label="선택 착지 상세"
          aria-live="polite"
        >
          <div>
            <span className="muted">
              {focusedGroup.label} · 착지{' '}
              {focusedGroup.jobIds.indexOf(focus) + 1}
            </span>
            <h3>{focused.name}</h3>
            <p>{focused.address || '주소 확인 필요'}</p>
            <p className="muted">
              원본 코드 {focused.memberIds.join(' · ')}
              {focused.sourceDestinationId
                ? ` · 분할 원본 ${focused.sourceDestinationId}`
                : ''}
            </p>
          </div>
          <div className="toolbar">
            {focused.address.trim() ? (
              <a
                className="btn btn-ghost"
                href={`https://map.naver.com/p/search/${encodeURIComponent(focused.address)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                주소 지도에서 확인
              </a>
            ) : null}
            <button
              className="btn btn-ghost"
              disabled={disabled || !editable}
              onClick={() => onEdit(focused)}
            >
              이동·착지 확인
            </button>
            <button
              className="btn btn-ghost"
              disabled={!point}
              aria-expanded={mapOpen && !!point}
              onClick={() => setMapOpen((value) => !value)}
            >
              {mapOpen && point ? '지도 닫기' : '지도 보기'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setFocus('');
                setMapOpen(false);
              }}
            >
              상세 닫기
            </button>
          </div>
          <div className="dispatch-location">
            <p className="muted">
              위치 지도 · 실제 주행경로 아님
              {point
                ? ' · 등록된 주소 좌표 사용'
                : ' · 일치하는 확인 좌표 없음 (주소 검색으로 확인)'}
            </p>
            {mapOpen && point ? (
              <>
                <iframe
                  key={focus}
                  title={`${focused.name} 위치 지도`}
                  src={mapUrl}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  sandbox="allow-scripts allow-same-origin allow-popups"
                />
                <p className="muted">
                  ©{' '}
                  <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    OpenStreetMap contributors
                  </a>{' '}
                  ·{' '}
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${point.y}&mlon=${point.x}#map=16/${point.y}/${point.x}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    큰 지도
                  </a>
                </p>
              </>
            ) : null}
          </div>
        </aside>
      ) : null}
      <div className="dispatch-lanes" aria-label="차량별 배차 보드">
        {groups.map((group) => {
          const quantity =
            group.quantity ??
            group.jobIds.reduce(
              (sum, id) => sum + (jobs.get(id)?.quantity || 0),
              0,
            );
          const capacity =
            group.capacity != null && group.capacity > 0
              ? group.capacity
              : null;
          const fleet = plan.fleet.find((item) => item.id === group.fleetId);
          const ratio = capacity == null ? null : (quantity / capacity) * 100;
          return (
            <section
              key={group.id}
              className="dispatch-lane"
              aria-label={`${group.label} ${kinds[group.kind] || group.kind}`}
            >
              <header className="dispatch-lane-head">
                <span className="dispatch-kind">
                  {kinds[group.kind] || group.kind}
                </span>
                <h3>{group.label}</h3>
                {fleet ? (
                  <p className="muted">
                    {[fleet.plate, fleet.driver].filter(Boolean).join(' · ') ||
                      '차량 정보 확인 필요'}
                  </p>
                ) : null}
                <p>
                  <strong>{number(quantity)}</strong> {plan.quantityUnit} ·{' '}
                  {group.jobIds.length}착지
                </p>
                {capacity != null ? (
                  <>
                    <progress
                      aria-label={`${group.label} 확인된 실제 상차한도 대비 적재량`}
                      value={Math.min(quantity, capacity)}
                      max={capacity}
                    />
                    <p className={ratio! > 100 ? 'issue' : 'muted'}>
                      실제 상차한도 {number(capacity)} · {number(ratio!)}%
                      {ratio! > 100 ? ' · 한도 초과' : ''}
                    </p>
                  </>
                ) : (
                  <p className="dispatch-capacity-unknown">
                    실제 상차한도 미확인
                  </p>
                )}
                <p className="muted">
                  {group.travel?.complete
                    ? `주행 ${number((group.travel.meters || 0) / 1000)}km · ${number((group.travel.seconds || 0) / 60)}분`
                    : '주행 연결 미확인'}
                </p>
                <p className={group.issues?.length ? 'issue' : 'muted'}>
                  {group.status}
                  {group.issues?.length
                    ? ` · 확인 ${group.issues.length}건`
                    : ''}
                </p>
                {group.issues?.length ? (
                  <details>
                    <summary>확인할 항목</summary>
                    <ul>
                      {group.issues.map((issue, index) => (
                        <li key={index}>{issue}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </header>
              <ol
                className="dispatch-stop-cards"
                aria-label={`${group.label} 착지 순서 (지도 아님)`}
              >
                {group.jobIds.map((id, index) => {
                  const job = jobs.get(id);
                  if (!job) return null;
                  const section = group.travel?.sections.find(
                    (item) => item.jobId === id,
                  );
                  return (
                    <li
                      key={id}
                      className={
                        focus === id
                          ? 'dispatch-stop is-focused'
                          : 'dispatch-stop'
                      }
                    >
                      <div className="dispatch-card-top">
                        <label>
                          <input
                            type="checkbox"
                            checked={selection.has(id)}
                            aria-label={`${job.name} 내역 선택`}
                            onChange={(event) =>
                              setSelection((previous) => {
                                const next = new Set(previous);
                                if (event.target.checked) next.add(id);
                                else next.delete(id);
                                return next;
                              })
                            }
                          />
                          <span>착지 {index + 1}</span>
                        </label>
                        <strong>{number(job.quantity)}</strong>
                      </div>
                      <button
                        className="dispatch-card-title"
                        aria-pressed={focus === id}
                        onClick={() => setFocus(id)}
                      >
                        {job.name}
                      </button>
                      <p className="muted">
                        원래 {job.ownerRoute}호차
                        {job.sourceDestinationId ? ' · 분할 배정' : ''}
                      </p>
                      <p className="dispatch-source-ids">
                        {job.memberIds.join(' · ')}
                      </p>
                      <p>{job.address || '주소 확인 필요'}</p>
                      <p className="muted">
                        {section && section.seconds != null
                          ? `앞 구간 ${number(section.seconds / 60)}분 · ${section.status === 'composed' ? '실측구간 연결' : '기록된 방향별 주행'}`
                          : '앞 구간 주행 미확인'}
                      </p>
                      <div className="dispatch-card-actions">
                        <button
                          className="btn btn-ghost"
                          disabled={disabled || !editable}
                          onClick={() => onEdit(job)}
                        >
                          이동·착지 확인
                        </button>
                        <button
                          className="btn btn-ghost"
                          aria-label={`${job.name} 앞 순서로`}
                          disabled={disabled || !editable || index === 0}
                          onClick={() => onReorder(group.id, index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="btn btn-ghost"
                          aria-label={`${job.name} 뒤 순서로`}
                          disabled={
                            disabled ||
                            !editable ||
                            index === group.jobIds.length - 1
                          }
                          onClick={() => onReorder(group.id, index, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {!group.jobIds.length ? (
                <p className="muted">배정된 착지 없음</p>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
