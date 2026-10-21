import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAdminPage } from './AdminPage';
import { DispatchProfiles } from './DispatchProfiles';
import { NaverRelations } from './NaverRelations';
import { FileArea } from './FileArea';
import { useFeedback } from './useFeedback';
import { useDownload } from './useDownload';
import { permissionAllowed } from '../lib/permissions';
import { dispatchProfilePermissions } from '../lib/dispatch-profiles';
import { loadDispatchContext } from '../lib/dispatch-context';
import type { DispatchContext, DispatchDriver } from '../lib/dispatch-context';
import {
  readWorkbook,
  suggestMapping,
  mapRows,
  dispatchRowVersion,
} from '../domain/dispatch-import';
import type {
  VolumeRow,
  Mapping,
  DispatchWorkbook,
  ImportIssue,
} from '../domain/dispatch-import';
import {
  DEFAULT_SETTINGS,
  createDraft,
  recalculateDraft,
} from '../domain/dispatch-manual';
import type {
  DispatchDraft,
  DispatchSettings,
  DraftRoute,
  DispatchIssue,
  OTD,
} from '../domain/dispatch-manual';
import {
  listManualDrafts,
  loadManualDraft,
  saveManualDraft,
} from '../lib/dispatch-drafts';
import type { ManualPayload, ManualSnapshot } from '../lib/dispatch-drafts';
import {
  manualTime as time,
  printable,
  manualRouteLabel,
  manualRouteIssues,
  manualDispatchWorkbook,
  restoredProfilesChanged,
} from '../lib/dispatch-workbook';
import { relationCall, cancelRelationJob } from '../lib/naver-relations';
import type { RelationJob } from '../lib/naver-relations';

interface State {
  date: string;
  stage: number;
  busy: boolean;
  loaded: boolean;
  dirty: boolean;
  profilesDirty: boolean;
  profileKey: number;
  needsRegeneration: boolean;
  rows: VolumeRow[];
  drivers: DispatchDriver[];
  context: DispatchContext;
  settings: DispatchSettings;
  draft: DispatchDraft | null;
  book: DispatchWorkbook | null;
  file: File | null;
  sheetIndex: number;
  mapping: Mapping;
  preview: {
    rows: VolumeRow[];
    issues: ImportIssue[];
    all: VolumeRow[];
    allIssues: ImportIssue[];
  } | null;
  id: string | null;
  revision: number;
  history: { at: string; reason: string }[];
  routeId: string | null;
  snapshots: ManualSnapshot[];
  reason: string;
  status: string;
  statusError: boolean;
  sourceTab: string;
  pairFrom: string;
  pairTo: string;
  queryJob: string | null;
}
const fields = {
  date: '기준일',
  code: '납품처 코드 (선택)',
  course: '원래 코스',
  customer: '고객사',
  name: '착지명',
  address: '주소',
  boxes: '박스 수',
  notes: '당일 메모 (선택)',
};
const num = (v: unknown) =>
  Number(v || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const otdLabel = (value: OTD[]) =>
  Array.isArray(value)
    ? [...new Set(value.map((c) => printable(c.raw)).filter(Boolean))].join(
        ' · ',
      ) || '시간 제약 없음'
    : printable(value);
function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <>
      <table>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <p className="pd-muted">자료가 없습니다.</p> : null}
    </>
  );
}
function Issues({ items }: { items: (ImportIssue | DispatchIssue)[] }) {
  return items.length ? (
    <ul>
      {items.map((item, i) => (
        <li key={i}>
          {[item.row ? '행 ' + item.row : '', item.message || item.code]
            .filter(Boolean)
            .join(' · ')}
        </li>
      ))}
    </ul>
  ) : null;
}
function FieldInput({
  value,
  onCommit,
  type = 'text',
  label,
  min,
  max,
  step,
  disabled,
}: {
  value: unknown;
  onCommit: (value: string) => void;
  type?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled: boolean;
}) {
  const [input, setInput] = useState(printable(value));
  useEffect(() => setInput(printable(value)), [value]);
  return (
    <input
      type={type}
      value={input}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => setInput(e.target.value)}
      onBlur={() => {
        if (input !== printable(value)) onCommit(input);
      }}
    />
  );
}
function importKeys(row: VolumeRow) {
  const source = row.source,
    version = dispatchRowVersion(row);
  return [
    ['file', source.file],
    ['signature', source.signature],
    ['contentSignature', source.contentSignature],
  ]
    .filter(([, value]) => !!value)
    .map(([kind, value]) =>
      JSON.stringify([kind, value, source.sheet, source.row, version]),
    );
}
function overrideIdentity(
  record: DispatchDriver | DraftRoute,
  key: 'driverName' | 'vehicleNumber',
  value: string,
) {
  if (record[key] === value) return;
  if (key === 'vehicleNumber') {
    record.originalVehicleId ??= record.vehicleId;
    record.originalVehicleNumber ??= record.vehicleNumber;
    record.vehicleId =
      value === record.originalVehicleNumber ? record.originalVehicleId : null;
  }
  if (key === 'driverName') {
    record.originalDriverId ??= record.driverId;
    record.originalDriverName ??= record.driverName;
    record.driverNameOverridden = value !== record.originalDriverName;
  }
  record[key] = value;
}
export function ManualDispatch({
  active,
  initialRoads = false,
  onStateChange,
}: {
  active: boolean;
  initialRoads?: boolean;
  onStateChange?: (state: { busy: boolean; dirty: boolean }) => void;
}) {
  const { editable, center } = useAdminPage(),
    { confirm, feedback } = useFeedback(),
    { download, downloadLink } = useDownload(),
    fileInput = useRef<HTMLInputElement>(null),
    sourceTabs = useRef(new Map<string, HTMLButtonElement>()),
    initialized = useRef(false),
    queryStopped = useRef(false);
  const [view, setView] = useState<State>(() => ({
      date: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      stage: 0,
      busy: false,
      loaded: false,
      dirty: false,
      profilesDirty: false,
      profileKey: 0,
      needsRegeneration: false,
      rows: [],
      drivers: [],
      context: {
        drivers: [],
        destinations: [],
        addresses: [],
        legs: [],
        issues: [],
      },
      settings: structuredClone(DEFAULT_SETTINGS),
      draft: null,
      book: null,
      file: null,
      sheetIndex: 0,
      mapping: { headerRow: 0 },
      preview: null,
      id: null,
      revision: 0,
      history: [],
      routeId: null,
      snapshots: [],
      reason: '',
      status: '',
      statusError: false,
      sourceTab: initialRoads ? 'roads' : 'volume',
      pairFrom: '',
      pairTo: '',
      queryJob: null,
    })),
    current = useRef(view);
  function update(fn: (s: State) => void) {
    const s = {
      ...current.current,
      draft: current.current.draft
        ? structuredClone(current.current.draft)
        : null,
      drivers: structuredClone(current.current.drivers),
      settings: structuredClone(current.current.settings),
      history: [...current.current.history],
    };
    fn(s);
    current.current = s;
    setView(s);
  }
  const message = useCallback(
    (text: string, error = false) =>
      update((s) => {
        s.status = text;
        s.statusError = error;
      }),
    [],
  );
  function touch(s: State, reason?: string) {
    s.dirty = true;
    if (reason) s.history.push({ at: new Date().toISOString(), reason });
  }
  async function run(action: () => void | Promise<void>, edit = false) {
    if (current.current.busy) return;
    try {
      if (edit && (!editable || center.code !== '002'))
        throw Error('평택 가배차 수정 권한이 없습니다.');
      update((s) => {
        s.busy = true;
      });
      message('처리 중');
      await action();
    } catch (error) {
      const e = error as { code?: string; message?: string };
      message(
        ['PT409', 'DISPATCH_CONFLICT'].includes(e.code || '')
          ? '다른 변경사항과 충돌했습니다. 새 스냅샷으로 저장하거나 저장 목록에서 최신 버전을 확인하세요.'
          : e.message || '처리에 실패했습니다.',
        true,
      );
    } finally {
      update((s) => {
        s.busy = false;
      });
    }
  }
  useEffect(() => {
    onStateChange?.({
      busy: view.busy,
      dirty: view.dirty || view.profilesDirty,
    });
  }, [view.busy, view.dirty, view.profilesDirty, onStateChange]);
  const profileDirty = useCallback(
    (dirty: boolean) =>
      update((s) => {
        s.profilesDirty = dirty;
      }),
    [],
  );
  async function context(replaceDrivers = false) {
    const next = await loadDispatchContext();
    update((s) => {
      s.context = next;
      if (replaceDrivers) s.drivers = structuredClone(next.drivers);
    });
    message(
      next.issues.length
        ? '기준자료 권한·조회 확인 필요'
        : '평택 기준자료를 불러왔습니다.',
    );
  }
  async function snapshots() {
    const list = await listManualDrafts(current.current.date);
    update((s) => {
      s.snapshots = list;
    });
    message('저장 목록 ' + list.length + '건');
  }
  useEffect(() => {
    if (!active || initialized.current) return;
    initialized.current = true;
    void run(async () => {
      await context(true);
      await snapshots();
      update((s) => {
        s.loaded = true;
      });
      message('직접 입력 작업 · CJ 원본은 CJ 당일 지시서 배차에서 처리하세요.');
    });
  }, [active]);
  useEffect(() => {
    const stop = () => {
      queryStopped.current = true;
    };
    addEventListener('pagehide', stop);
    return () => {
      queryStopped.current = true;
      removeEventListener('pagehide', stop);
    };
  }, []);
  const disabled = view.busy || !view.loaded,
    editDisabled = disabled || !editable;
  async function discard() {
    const s = current.current;
    return (
      !(s.dirty || s.profilesDirty) ||
      (await confirm('저장하지 않은 변경사항을 버리시겠습니까?'))
    );
  }
  function driverChanged(s: State) {
    s.draft = null;
    touch(s, '당일 기사·배차 조건 변경');
  }
  function recalc(reason: string) {
    update((s) => {
      if (!s.draft) return;
      s.draft.settings.evaluatedAt = new Date().toISOString();
      s.draft = recalculateDraft(s.draft, {
        addresses: s.context.addresses,
        legs: s.context.legs,
      });
      touch(s, reason);
    });
    message('조정 및 시간 재계산 완료');
  }
  async function refreshLegs() {
    const c = await loadDispatchContext();
    update((s) => {
      s.context = {
        ...s.context,
        addresses: c.addresses,
        legs: c.legs,
        issues: c.issues,
      };
    });
    window.dispatchEvent(new Event('pyeongtaek-dispatch-resources-changed'));
    if (current.current.draft) recalc('저장 구간 갱신');
  }
  function resetUpload(s: State) {
    s.book = null;
    s.file = null;
    s.sheetIndex = 0;
    s.mapping = { headerRow: 0 };
    s.preview = null;
    if (fileInput.current) fileInput.current.value = '';
  }
  function setupMapping(book: DispatchWorkbook, index: number) {
    update((s) => {
      s.sheetIndex = index;
      s.mapping = suggestMapping(book.sheets[index]?.rows || []);
      s.preview = null;
    });
  }
  function loadFile(file: File) {
    void run(async () => {
      if (file.size > 30 * 1024 * 1024)
        throw Error('30MB 이하 파일을 선택해 주세요.');
      const book = await readWorkbook(file);
      if (!book.sheets.length) throw Error('시트가 없습니다.');
      update((s) => {
        s.book = book;
        s.file = file;
        touch(s);
      });
      setupMapping(book, 0);
      message('열 매핑과 기준일을 확인해 주세요.');
    }, true);
  }
  function preview() {
    const s = current.current,
      sheet = s.book?.sheets[s.sheetIndex],
      m = s.mapping;
    if (!sheet || !s.file) throw Error('파일을 선택해 주세요.');
    if (
      !Number.isInteger(m.headerRow) ||
      m.headerRow < 0 ||
      m.headerRow >= sheet.rows.length
    )
      throw Error('제목 행을 확인해 주세요.');
    for (const key of ['course', 'customer', 'name', 'address', 'boxes'])
      if (m[key] < 0)
        throw Error(
          fields[key as keyof typeof fields] + ' 열을 선택해 주세요.',
        );
    const used = Object.keys(fields)
      .map((k) => m[k])
      .filter((v) => v >= 0);
    if (new Set(used).size !== used.length)
      throw Error('같은 열을 여러 항목에 연결할 수 없습니다.');
    const result = mapRows(sheet.rows, m, {
        fileName: s.file.name,
        sheetName: sheet.name,
        date: s.date,
      }),
      rows = result.rows.filter((r) => r.date === s.date),
      ids = new Set(rows.map((r) => r.id)),
      rowNumbers = new Set(rows.map((r) => r.source.row)),
      issues = result.issues.filter((i) =>
        i.rowId ? ids.has(i.rowId) : i.row ? rowNumbers.has(i.row) : true,
      );
    update((s) => {
      s.preview = { rows, issues, all: result.rows, allIssues: result.issues };
    });
    message('선택일 미리보기 완료');
  }
  async function importRows() {
    const s = current.current;
    if (!s.preview) throw Error('미리보기를 먼저 확인해 주세요.');
    if (s.preview.issues.some((i) => i.severity === 'error'))
      throw Error('선택일 원본 오류를 수정한 후 다시 가져와 주세요.');
    if (
      s.draft &&
      !(await confirm('기존 초안을 비우고 물량을 추가하시겠습니까?'))
    )
      return;
    const seen = new Set(s.rows.flatMap(importKeys)),
      added = s.preview.rows.filter((row) => {
        const keys = importKeys(row);
        if (keys.some((key) => seen.has(key))) return false;
        keys.forEach((key) => seen.add(key));
        return true;
      });
    update((s) => {
      s.rows = [...s.rows, ...structuredClone(added)];
      s.draft = null;
      touch(s, '원본 ' + added.length + '행 반영');
    });
    message(
      `${added.length}행 반영 · 중복 ${s.preview.rows.length - added.length}행 제외`,
    );
  }
  async function generate() {
    const s = current.current;
    if (s.profilesDirty)
      throw Error(
        '납품정보 수정사항을 먼저 저장하거나 취소해 주세요. 파일 미리보기도 DB 저장 또는 파일 비우기가 필요합니다.',
      );
    if (
      s.context.issues.length &&
      !(await confirm(
        '기준자료에 확인 필요 항목이 있습니다. 표시된 누락·권한 문제를 확인했으며 계속 진행하시겠습니까?',
      ))
    )
      return;
    if (
      s.draft &&
      !(await confirm('현재 조정 내용을 버리고 초안을 다시 생성하시겠습니까?'))
    )
      return;
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    const draft = createDraft({
      ...s.context,
      rows: structuredClone(s.rows),
      drivers: structuredClone(s.drivers),
      date: s.date,
      settings: {
        ...structuredClone(s.settings),
        evaluatedAt: new Date().toISOString(),
      },
    });
    update((s) => {
      s.draft = draft;
      s.routeId = draft.routes[0]?.id || null;
      s.needsRegeneration = false;
      touch(s, '가배차 초안 생성');
      s.stage = 2;
    });
    message('초안 생성됨 · 확인 필요 항목을 검토해 주세요.');
  }
  function payload(): ManualPayload {
    const s = current.current;
    if (!s.draft) throw Error('저장할 초안이 없습니다.');
    const legs = [
        ...new Map(
          s.draft.routes
            .flatMap((r) => r.usedLegs || [])
            .filter((l) => !l.missing)
            .map((l) => [
              JSON.stringify([
                l.from_id,
                l.to_id,
                l.measured_at,
                l.priority,
                l.coords_key,
              ]),
              l as import('../lib/dispatch-context').DispatchLeg,
            ]),
        ).values(),
      ],
      ids = new Set(legs.flatMap((l) => [String(l.from_id), String(l.to_id)])),
      names = new Set(
        [
          s.draft.settings.origin || s.draft.settings.originAddress,
          ...s.draft.stops.flatMap((stop) => stop.addresses || [stop.address]),
        ].map((v) =>
          String(v || '')
            .normalize('NFKC')
            .trim(),
        ),
      ),
      addresses = s.context.addresses.filter(
        (a) =>
          ids.has(String(a.id)) ||
          names.has(
            String(a.address || '')
              .normalize('NFKC')
              .trim(),
          ),
      );
    return {
      version: 1,
      center: '002',
      date: s.date,
      rows: structuredClone(s.rows),
      drivers: structuredClone(s.drivers),
      draft: structuredClone(s.draft),
      settings: structuredClone(s.settings),
      context: {
        addresses: structuredClone(addresses),
        legs: structuredClone(legs),
      },
      history: structuredClone(s.history),
      reason: s.reason,
    };
  }
  async function save(copy = false) {
    const s = current.current;
    if (s.needsRegeneration)
      throw Error('납품정보 DB 변경 후 초안을 다시 생성해 주세요.');
    if (!s.draft) throw Error('저장할 초안이 없습니다.');
    const result = await saveManualDraft({
      id: copy ? null : s.id,
      date: s.date,
      payload: payload(),
      revision: copy ? 0 : s.revision,
    });
    update((s) => {
      s.id = result.id;
      s.revision = result.revision;
      s.dirty = false;
    });
    await snapshots();
    message('초안 저장 완료 · 실제 배차 확정 아님');
  }
  async function restore(id: string) {
    if (!(await discard())) return;
    const value = await loadManualDraft(id),
      s = current.current;
    if (!value?.payload?.draft) throw Error('저장된 초안을 찾을 수 없습니다.');
    if (value.date !== s.date)
      throw Error('현재 기준일과 저장된 초안 날짜가 다릅니다.');
    const p = value.payload;
    if (p.center && p.center !== '002')
      throw Error('평택 초안만 열 수 있습니다.');
    const changed = restoredProfilesChanged(
      p,
      s.context.destinations,
      s.date,
      s.context.addresses,
    );
    update((s) => {
      s.rows = structuredClone(p.rows || []);
      s.profileKey++;
      s.profilesDirty = false;
      s.needsRegeneration = changed;
      s.drivers = structuredClone(p.drivers || []);
      s.draft = structuredClone(p.draft);
      s.settings = structuredClone(p.settings || p.draft.settings);
      if (p.context)
        s.context = {
          ...s.context,
          ...structuredClone(p.context),
          destinations: s.context.destinations,
        };
      s.history = structuredClone(p.history || []);
      s.id = value.id;
      s.revision = value.revision;
      s.dirty = false;
      s.reason = p.reason || '';
      s.stage = 2;
    });
    message(
      changed
        ? '저장 당시 초안을 불러왔습니다. 납품정보 DB가 달라 초안 재생성 후 저장할 수 있습니다.'
        : '저장 당시 초안을 불러왔습니다.',
    );
  }
  async function queryPair() {
    const permissions = await dispatchProfilePermissions();
    if (!permissionAllowed(permissions, 'delivery_points', 'edit', '002'))
      throw Error('도로 구간 조회에는 평택 납품처 수정 권한이 필요합니다.');
    const { pairFrom, pairTo } = current.current,
      from = pairFrom.trim(),
      to = pairTo.trim();
    if (!from || !to || from === to)
      throw Error('서로 다른 출발·도착 주소를 입력해 주세요.');
    if (
      !(await confirm(
        '네이버 도로·주소 API 요청이 발생할 수 있습니다. 계정 무료 잔여량은 확인되지 않았습니다. 이 단일 구간을 조회하시겠습니까?',
      ))
    )
      return;
    queryStopped.current = false;
    update((s) => {
      s.queryJob = '';
    });
    try {
      let job = await relationCall<RelationJob>('create', {
        kind: 'single',
        origin: from,
        rows: [{ address: to, source: 'dispatch-manual', sourceRow: 1 }],
        limit: 1,
        directionsBudget: 3,
      });
      update((s) => {
        s.queryJob = job.id;
      });
      let batches = 0;
      while (
        !queryStopped.current &&
        ['queued', 'running'].includes(job.status)
      ) {
        if (++batches > 120)
          throw Error(
            '구간 조회 대기 시간이 초과되었습니다. 수집기에서 작업을 확인하세요.',
          );
        message('단일 구간 조회 중');
        job = await relationCall<RelationJob>('batch', { jobId: job.id });
        await new Promise<void>((resolve) =>
          setTimeout(resolve, job.busy ? 2000 : 250),
        );
      }
      await refreshLegs();
      const result = job.lastResults?.at(-1);
      message(
        queryStopped.current
          ? '조회 중지됨 · 저장된 구간 반영'
          : result?.error ||
              job.error ||
              '단일 구간 조회 완료 · 현재 초안 재계산',
        !!(result?.error || job.error),
      );
    } finally {
      update((s) => {
        s.queryJob = null;
      });
    }
  }
  const d = view.draft,
    route = d?.routes.find((r) => r.id === view.routeId) || d?.routes[0],
    stop = (id: string) => d?.stops.find((s) => s.id === id),
    routeLabel = (r: DraftRoute) => manualRouteLabel(r, d);
  function moveStop(id: string, target: string) {
    update((s) => {
      if (!s.draft) return;
      for (const r of s.draft.routes)
        r.stopIds = r.stopIds.filter((v) => v !== id);
      s.draft.unassigned = s.draft.unassigned.filter((v) => v !== id);
      if (!target) s.draft.unassigned.push(id);
      else s.draft.routes.find((r) => r.id === target)?.stopIds.push(id);
    });
    recalc('착지 배정 변경: ' + stop(id)?.name);
  }
  function action(
    id: string,
    text: string,
    fn: () => void | Promise<void>,
    options: {
      edit?: boolean;
      disabled?: boolean;
      hidden?: boolean;
      primary?: boolean;
    } = {},
  ) {
    return (
      <button
        id={'pd-' + id}
        type="button"
        className={`btn ${options.primary ? 'btn-primary' : 'btn-ghost'}`}
        disabled={disabled || (options.edit && !editable) || options.disabled}
        hidden={options.hidden}
        onClick={() => void run(fn, options.edit)}
      >
        {text}
      </button>
    );
  }
  function moveSelect(id: string, value: string) {
    return (
      <select
        aria-label={stop(id)?.name + ' 배정 차량'}
        value={value}
        disabled={editDisabled}
        onChange={(e) => void run(() => moveStop(id, e.target.value), true)}
      >
        <option value="">미배정</option>
        {d?.routes.map((r) => (
          <option key={r.id} value={r.id}>
            {routeLabel(r)}
          </option>
        ))}
      </select>
    );
  }
  const ids = d ? [...d.routes.flatMap((r) => r.stopIds), ...d.unassigned] : [],
    valid =
      d &&
      ids.length === d.stops.length &&
      new Set(ids).size === d.stops.length &&
      d.stops.every((s) => ids.includes(s.id)),
    selectedSheet = view.book?.sheets[view.sheetIndex],
    columnCount = Math.max(
      0,
      ...(selectedSheet?.rows || []).slice(0, 30).map((r) => r.length),
    );
  const contextReload = async () => {
    const next = await loadDispatchContext();
    if (next.issues.some((i) => i.table === 'delivery_points'))
      throw Error('납품정보 DB 조회 실패 · 권한과 연결 상태를 확인해 주세요.');
    const signature = (ds: DispatchContext['destinations']) =>
        JSON.stringify(
          ds
            .map((d) => [String(d.id), d.dispatch_profile ?? null])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ),
      changed =
        signature(next.destinations) !==
        signature(current.current.context.destinations);
    update((s) => {
      s.context = { ...s.context, destinations: next.destinations };
      if (s.draft && changed) {
        s.needsRegeneration = true;
        touch(s, '납품정보 DB 다시 읽기 · 초안 재생성 필요');
      }
    });
    if (changed)
      window.dispatchEvent(new Event('pyeongtaek-dispatch-resources-changed'));
  };
  const routeRows = (type: string) =>
    (d?.routes || [])
      .filter((r) => r.type === type)
      .map((r) => [
        routeLabel(r),
        `${r.tons ?? '미확인'}t / ${r.capacity ?? '미확인'}`,
        r.stopIds.length,
        num(
          r.boxes ??
            r.stopIds.reduce(
              (sum, id) => sum + Number(stop(id)?.boxes || 0),
              0,
            ),
        ),
        time(r.centerEntryTime),
        time(r.departureTime),
        (
          {
            estimated: '조회 시점 추정',
            unknown: '미산정',
            infeasible: '조건 충돌',
            unconstrained: '시간 제약 없음',
          } as Record<string, string>
        )[r.timeStatus || ''] || '미산정',
        manualRouteIssues(r),
        <button
          className="btn btn-ghost"
          disabled={disabled}
          onClick={() =>
            update((s) => {
              s.routeId = r.id;
              s.stage = 3;
            })
          }
        >
          상세
        </button>,
      ]);
  return (
    <div id="pd-legacy-workflow" hidden={!active}>
      <div className="pd-toolbar pd-heading">
        <h2>평택 가배차</h2>
        <span id="pd-state" className="pd-badge">
          {view.dirty || view.profilesDirty
            ? '진행 중 · 미저장'
            : view.id
              ? '저장됨'
              : d
                ? d.issues.length
                  ? '확인 필요'
                  : '초안 생성됨'
                : '진행 중'}
        </span>
        <span id="pd-access">{editable ? '' : '열람 전용'}</span>
        <label>
          배차 기준일
          <input
            id="pd-date"
            type="date"
            required
            disabled={disabled}
            value={view.date}
            onChange={(e) => {
              const date = e.target.value;
              void run(async () => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(await discard())) {
                  message('기준일 변경 취소');
                  return;
                }
                update((s) => {
                  s.date = date;
                  s.profileKey++;
                  s.profilesDirty = false;
                  s.needsRegeneration = false;
                  s.rows = [];
                  s.draft = null;
                  s.id = null;
                  s.revision = 0;
                  s.history = [];
                  s.dirty = false;
                  resetUpload(s);
                  s.reason = '';
                  s.stage = 0;
                });
                await context(true);
                await snapshots();
              });
            }}
          />
        </label>
      </div>
      <p
        id="pd-status"
        role="status"
        aria-live="polite"
        data-error={view.statusError}
      >
        {view.status}
      </p>
      <div id="pd-work" hidden={!view.loaded}>
        <nav className="pd-stages" aria-label="가배차 단계">
          {['1 자료', '2 고정차', '3 초안', '4 상세 조정', '5 저장·출력'].map(
            (text, i) => (
              <button
                key={i}
                data-stage={i}
                aria-current={view.stage === i ? 'step' : undefined}
                disabled={disabled}
                onClick={() =>
                  update((s) => {
                    s.stage = i;
                  })
                }
              >
                {text}
              </button>
            ),
          )}
        </nav>
        <p id="pd-totals" className="pd-totals">
          선택일 {view.date} · 원본 {num(view.rows.length)}행 · 원본{' '}
          {num(view.rows.reduce((sum, r) => sum + Number(r.boxes || 0), 0))}박스
          {d
            ? ` · 실제 착지 ${num(d.stops.length)}개 · 반올림 ${num(d.stops.reduce((sum, s) => sum + Number(s.boxes || 0), 0))}박스 · 미배정 ${num(d.unassigned.length)}개 · 착지 대조 ${valid ? '일치' : '불일치'}`
            : ''}
        </p>
        <p
          id="pd-regeneration"
          className="pd-issues"
          role="status"
          hidden={!view.needsRegeneration}
        >
          납품정보 DB 변경됨 · 현재 수동 조정은 유지됩니다. 고정차 단계에서
          초안을 다시 생성한 후 저장하세요.
        </p>
        <section
          data-panel="0"
          hidden={view.stage !== 0}
          aria-labelledby="pd-import-title"
        >
          <h3 id="pd-import-title">배차 자료</h3>
          <div className="pd-source-tabs" role="tablist" aria-label="자료 구분">
            {[
              ['volume', '1 물량파일'],
              ['profiles', '2 납품정보 DB'],
              ['roads', '도로 구간 (API 최적경로)'],
            ].map(([name, text]) => (
              <button
                key={name}
                ref={(node) => {
                  if (node) sourceTabs.current.set(name, node);
                  else sourceTabs.current.delete(name);
                }}
                id={`pd-${name}-tab`}
                role="tab"
                aria-selected={view.sourceTab === name}
                aria-controls={`pd-${name}-panel`}
                tabIndex={view.sourceTab === name ? 0 : -1}
                disabled={disabled}
                onClick={() =>
                  update((s) => {
                    s.sourceTab = name;
                  })
                }
                onKeyDown={(e) => {
                  if (
                    !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  const tabs = ['volume', 'profiles', 'roads'],
                    next =
                      e.key === 'Home'
                        ? 'volume'
                        : e.key === 'End'
                          ? 'roads'
                          : tabs[
                              (tabs.indexOf(name) +
                                (e.key === 'ArrowRight' ? 1 : 2)) %
                                3
                            ];
                  update((s) => {
                    s.sourceTab = next;
                  });
                  sourceTabs.current.get(next)?.focus();
                }}
              >
                {text}
              </button>
            ))}
          </div>
          <div
            id="pd-volume-panel"
            role="tabpanel"
            aria-labelledby="pd-volume-tab"
            hidden={view.sourceTab !== 'volume'}
          >
            <FileArea
              accept=".xlsx,.xls,.csv"
              disabled={editDisabled}
              onFiles={(files) => {
                if (files[0]) loadFile(files[0]);
              }}
            >
              <div className="pd-fields">
                <label>
                  파일
                  <input
                    ref={fileInput}
                    id="pd-file"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    disabled={editDisabled}
                    onChange={(e) => {
                      if (e.target.files?.[0]) loadFile(e.target.files[0]);
                    }}
                  />
                </label>
                <label>
                  시트
                  <select
                    id="pd-sheet"
                    disabled={editDisabled}
                    value={view.sheetIndex}
                    onChange={(e) => {
                      if (view.book)
                        setupMapping(view.book, Number(e.target.value));
                    }}
                  >
                    {view.book?.sheets.map((s, i) => (
                      <option key={i} value={i}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  제목 행
                  <input
                    id="pd-header"
                    type="number"
                    min="1"
                    step="1"
                    disabled={editDisabled}
                    value={view.mapping.headerRow + 1}
                    onChange={(e) =>
                      update((s) => {
                        s.mapping = {
                          ...s.mapping,
                          headerRow: Number(e.target.value) - 1,
                        };
                        s.preview = null;
                      })
                    }
                  />
                </label>
              </div>
              <div id="pd-mapping" className="pd-fields">
                {view.book
                  ? Object.entries(fields).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <select
                          id={'pd-map-' + key}
                          value={view.mapping[key] ?? -1}
                          disabled={editDisabled}
                          onChange={(e) =>
                            update((s) => {
                              s.mapping = {
                                ...s.mapping,
                                [key]: Number(e.target.value),
                              };
                              s.preview = null;
                            })
                          }
                        >
                          {Array.from(
                            { length: columnCount + 1 },
                            (_, i) => i - 1,
                          ).map((i) => (
                            <option key={i} value={i}>
                              {i < 0
                                ? '선택 안 함'
                                : `${i + 1}열 · ${printable(selectedSheet?.rows[view.mapping.headerRow]?.[i]).slice(0, 60)}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))
                  : null}
              </div>
            </FileArea>
            <div className="pd-toolbar">
              {action('preview', '미리보기', preview, {
                edit: true,
                disabled: !view.book,
              })}
              {action('import', '선택일 물량 반영', importRows, {
                edit: true,
                primary: true,
                disabled: !view.preview?.rows.length,
              })}
              {action(
                'clear',
                '물량 비우기',
                async () => {
                  if (
                    !(await confirm('모든 원본 물량과 초안을 비우시겠습니까?'))
                  )
                    return;
                  update((s) => {
                    s.rows = [];
                    s.draft = null;
                    touch(s, '물량 비우기');
                  });
                },
                { edit: true },
              )}
            </div>
            <p id="pd-preview-count">
              {view.preview
                ? `선택일 ${view.preview.rows.length}행 · 다른 날짜/날짜 미확인 제외 ${view.preview.all.length - view.preview.rows.length}행 · ${view.mapping.date < 0 ? '날짜 열 없음: 기준일 적용' : '원본 날짜 기준 필터'} · 미리보기 최대 100행`
                : ''}
            </p>
            <div id="pd-import-issues" className="pd-issues">
              <Issues items={view.preview?.allIssues || []} />
            </div>
            <div id="pd-preview-table" className="pd-scroll">
              {view.preview ? (
                <Table
                  headers={[
                    '반영',
                    '원본행',
                    '날짜',
                    ...Object.values(fields).slice(1),
                  ]}
                  rows={view.preview.all
                    .slice(0, 100)
                    .map((r) => [
                      r.date === view.date ? '반영' : '제외',
                      r.source.row,
                      r.date,
                      ...(
                        Object.keys(fields).slice(1) as (keyof VolumeRow)[]
                      ).map((k) => printable(r[k])),
                    ])}
                />
              ) : null}
            </div>
            <details>
              <summary>반영된 원본</summary>
              <div id="pd-source-table" className="pd-scroll">
                {view.rows.length ? (
                  <Table
                    headers={[
                      '파일',
                      '시트',
                      '행',
                      '날짜',
                      '코스',
                      '고객사',
                      '착지',
                      '주소',
                      '박스',
                    ]}
                    rows={view.rows.map((r) => [
                      r.source.file,
                      r.source.sheet,
                      r.source.row,
                      r.date,
                      r.course,
                      r.customer,
                      r.name,
                      r.address,
                      r.boxes,
                    ])}
                  />
                ) : null}
              </div>
            </details>
          </div>
          <div
            id="pd-profiles-panel"
            role="tabpanel"
            aria-labelledby="pd-profiles-tab"
            hidden={view.sourceTab !== 'profiles'}
          >
            <DispatchProfiles
              key={view.profileKey}
              destinations={view.context.destinations}
              busy={disabled}
              needsRegeneration={view.needsRegeneration}
              onDirty={profileDirty}
              run={(action) => void run(action)}
              message={message}
              onReload={contextReload}
              onSaved={(records) => {
                window.dispatchEvent(
                  new Event('pyeongtaek-dispatch-resources-changed'),
                );
                update((s) => {
                  s.context = {
                    ...s.context,
                    destinations: s.context.destinations.map((d) => ({
                      ...d,
                      ...records.find((r) => String(r.id) === String(d.id)),
                    })),
                  };
                  if (s.draft) {
                    s.needsRegeneration = true;
                    touch(s, '납품정보 DB 변경 · 초안 재생성 필요');
                  }
                });
              }}
            />
          </div>
          <div
            id="pd-roads-panel"
            role="tabpanel"
            aria-labelledby="pd-roads-tab"
            hidden={view.sourceTab !== 'roads'}
          >
            <NaverRelations
              destinations={view.context.destinations}
              blocked={disabled}
              onBusyChange={(value) =>
                update((s) => {
                  s.busy = value;
                })
              }
              onCollected={refreshLegs}
            />
          </div>
        </section>
        <section
          data-panel="1"
          hidden={view.stage !== 1}
          aria-labelledby="pd-drivers-title"
        >
          <div className="pd-toolbar">
            <h3 id="pd-drivers-title">당일 고정기사</h3>
            {action('context', '기준자료 다시 읽기', async () => {
              if (
                current.current.draft &&
                !(await confirm(
                  '당일 기사 조건과 초안을 비우고 기준자료를 다시 읽으시겠습니까?',
                ))
              )
                return;
              await context(editable);
              if (editable) update(driverChanged);
            })}
          </div>
          <div id="pd-context-issues" className="pd-issues">
            <Issues items={view.context.issues} />
          </div>
          <div id="pd-drivers" className="pd-scroll">
            <Table
              headers={[
                '운행 가능',
                '원래 코스',
                '기사',
                '차량번호',
                '톤수',
                'CJ 기준량',
              ]}
              rows={view.drivers.map((driver, i) => [
                <input
                  type="checkbox"
                  checked={driver.available !== false}
                  aria-label={driver.course + ' 운행 가능'}
                  disabled={editDisabled}
                  onChange={(e) =>
                    void run(() => {
                      update((s) => {
                        s.drivers[i].available = e.target.checked;
                        driverChanged(s);
                      });
                      message('당일 조건 변경됨 · 초안을 다시 생성해 주세요.');
                    }, true)
                  }
                />,
                driver.course,
                ...(
                  ['driverName', 'vehicleNumber', 'tons', 'capacity'] as const
                ).map((key) => (
                  <FieldInput
                    value={driver[key]}
                    type={
                      key === 'tons' || key === 'capacity' ? 'number' : 'text'
                    }
                    label={
                      {
                        driverName: '당일 기사',
                        vehicleNumber: '당일 차량번호',
                        tons: '차량 톤수',
                        capacity: '확인된 CJ 기준량',
                      }[key]
                    }
                    min={1}
                    step={key === 'tons' ? 0.5 : 1}
                    disabled={editDisabled}
                    onCommit={(value) =>
                      void run(() => {
                        const number = value === '' ? null : Number(value);
                        if (key === 'capacity' && number != null && number <= 0)
                          throw Error('기준량은 양수여야 합니다.');
                        update((s) => {
                          const row = s.drivers[i];
                          if (key === 'driverName' || key === 'vehicleNumber')
                            overrideIdentity(row, key, value);
                          else row[key] = number;
                          if (key === 'tons')
                            row.capacity =
                              s.settings.capacities[String(number)] ?? null;
                          driverChanged(s);
                        });
                        message(
                          '당일 조건 변경됨 · 초안을 다시 생성해 주세요.',
                        );
                      }, true)
                    }
                  />
                )),
              ])}
            />
          </div>
          <details>
            <summary>당일 배차 설정</summary>
            <div id="pd-settings" className="pd-fields">
              {(
                Object.entries({
                  origin: '센터 출발지',
                  prepareMinutes: '센터 준비(분)',
                  yardMinutes: '야적(분)',
                  attendedMinutes: '대면납(분)',
                  inspectionMinutes: '검수 추가(분)',
                  marginMinutes: '도착 여유(분)',
                  maxStops: '임시차 최대 착지',
                  freshnessMinutes: '구간 신선도(분)',
                }) as [
                  keyof Pick<
                    DispatchSettings,
                    | 'origin'
                    | 'prepareMinutes'
                    | 'yardMinutes'
                    | 'attendedMinutes'
                    | 'inspectionMinutes'
                    | 'marginMinutes'
                    | 'maxStops'
                    | 'freshnessMinutes'
                  >,
                  string,
                ][]
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <FieldInput
                    value={view.settings[key]}
                    type={key === 'origin' ? 'text' : 'number'}
                    min={key === 'maxStops' ? 1 : 0}
                    max={key === 'maxStops' ? 5 : undefined}
                    step={1}
                    disabled={editDisabled}
                    onCommit={(value) =>
                      void run(() => {
                        const number = value === '' ? null : Number(value);
                        if (
                          key === 'maxStops' &&
                          (!Number.isInteger(number) ||
                            number! < 1 ||
                            number! > 5)
                        )
                          throw Error(
                            '임시차 최대 착지는 1~5 사이의 정수로 입력해 주세요.',
                          );
                        if (
                          key !== 'origin' &&
                          (!Number.isFinite(number) || number! < 0)
                        )
                          throw Error('설정값을 확인해 주세요.');
                        update((s) => {
                          if (key === 'origin') s.settings.origin = value;
                          else s.settings[key] = number!;
                          driverChanged(s);
                        });
                        message(
                          '당일 조건 변경됨 · 초안을 다시 생성해 주세요.',
                        );
                      }, true)
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          {action('create', '가배차 초안 생성', generate, {
            edit: true,
            primary: true,
            disabled: !view.rows.length,
          })}
        </section>
        <section
          data-panel="2"
          hidden={view.stage !== 2}
          aria-labelledby="pd-draft-title"
        >
          <div className="pd-toolbar">
            <h3 id="pd-draft-title">배정 초안</h3>
            {action('adjust', '상세 조정', () =>
              update((s) => {
                s.stage = 3;
              }),
            )}
          </div>
          <div id="pd-draft-issues" className="pd-issues">
            <Issues
              items={(d?.issues || []).filter(
                (i) => i.code !== 'bounded_optimization',
              )}
            />
          </div>
          {(['fixed', 'temporary'] as const).map((type) => (
            <div key={type}>
              <h4>{type === 'fixed' ? '고정차' : '임시차'}</h4>
              <div id={'pd-' + type} className="pd-scroll">
                <Table
                  headers={[
                    '코스·차량',
                    '톤수 / 기준량',
                    '착지',
                    '박스',
                    '센터 입차',
                    '권장 출발',
                    '시간 상태',
                    '확인 필요',
                    '상세',
                  ]}
                  rows={routeRows(type)}
                />
              </div>
            </div>
          ))}
          <h4>미배정</h4>
          <div id="pd-unassigned" className="pd-scroll">
            <Table
              headers={[
                '착지',
                '주소',
                '원래 코스',
                '고객사',
                '박스',
                'OTD',
                '확인 필요',
              ]}
              rows={(d?.unassigned || []).map((id) => {
                const s = stop(id);
                return [
                  s?.name,
                  s?.address,
                  printable(s?.courses),
                  printable(s?.customers),
                  s?.boxes,
                  otdLabel(s?.otd || []),
                  (s?.issues || []).map((i) => i.message || i.code).join(' · '),
                ];
              })}
            />
          </div>
        </section>
        <section
          data-panel="3"
          hidden={view.stage !== 3}
          aria-labelledby="pd-detail-title"
        >
          <div className="pd-toolbar">
            <h3 id="pd-detail-title">상세 조정</h3>
            {action(
              'add-route',
              '임시차 추가',
              () => {
                const id = 'manual-' + crypto.randomUUID();
                update((s) => {
                  if (!s.draft) return;
                  s.draft.routes.push({
                    id,
                    type: 'temporary',
                    course: '',
                    driverId: null,
                    driverName: '',
                    vehicleId: null,
                    vehicleNumber: '',
                    tons: 1,
                    capacity: s.draft.settings.capacities['1'] ?? null,
                    stopIds: [],
                    interdelivery: false,
                  });
                  s.routeId = id;
                });
                recalc('임시차 추가');
              },
              { edit: true, disabled: !d },
            )}
            {action(
              'delete-route',
              '선택 임시차 삭제',
              async () => {
                if (!route || route.type !== 'temporary')
                  throw Error('임시차만 삭제할 수 있습니다.');
                if (
                  !(await confirm(
                    `${routeLabel(route)}를 삭제하고 착지 ${route.stopIds.length}개를 모두 미배정으로 옮기시겠습니까?`,
                  ))
                )
                  return;
                update((s) => {
                  if (!s.draft) return;
                  s.draft.unassigned = [
                    ...new Set([...s.draft.unassigned, ...route.stopIds]),
                  ];
                  s.draft.routes = s.draft.routes.filter(
                    (r) => r.id !== route.id,
                  );
                  s.routeId = s.draft.routes[0]?.id || null;
                });
                recalc(
                  `${routeLabel(route)} 삭제 · ${route.stopIds.length}개 착지 미배정 이동`,
                );
              },
              { edit: true, hidden: route?.type !== 'temporary', disabled: !d },
            )}
            {action('recalculate', '시간 재계산', () => recalc('시간 재계산'), {
              edit: true,
              disabled: !d,
            })}
          </div>
          <label>
            차량·코스
            <select
              id="pd-route"
              disabled={disabled}
              value={route?.id || ''}
              onChange={(e) =>
                update((s) => {
                  s.routeId = e.target.value;
                })
              }
            >
              {d?.routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {routeLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <div id="pd-route-fields" className="pd-fields">
            {route
              ? (
                  Object.entries({
                    driverName: '당일 기사',
                    vehicleNumber: '차량번호',
                    tons: '톤수',
                    capacity: '확인된 CJ 기준량',
                  }) as [
                    'driverName' | 'vehicleNumber' | 'tons' | 'capacity',
                    string,
                  ][]
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <FieldInput
                      value={route[key]}
                      type={
                        key === 'tons' || key === 'capacity' ? 'number' : 'text'
                      }
                      min={0.5}
                      step={key === 'tons' ? 0.5 : 1}
                      disabled={editDisabled}
                      onCommit={(value) =>
                        void run(() => {
                          const numeric = value === '' ? null : Number(value);
                          if (
                            (key === 'tons' || key === 'capacity') &&
                            (!Number.isFinite(numeric) || numeric! <= 0)
                          )
                            throw Error('확인된 양수를 입력해 주세요.');
                          update((s) => {
                            const row = s.draft?.routes.find(
                              (r) => r.id === route.id,
                            );
                            if (!row || !s.draft) return;
                            if (key === 'driverName' || key === 'vehicleNumber')
                              overrideIdentity(row, key, value);
                            else if (key === 'tons') row.tons = numeric!;
                            else row.capacity = numeric;
                            if (key === 'tons')
                              row.capacity =
                                s.draft.settings.capacities[String(numeric)] ??
                                null;
                          });
                          recalc('차량 조건 변경');
                        }, true)
                      }
                    />
                  </label>
                ))
              : null}
            {route?.type === 'fixed' ? (
              <label>
                이배송 · 협의 필요
                <input
                  type="checkbox"
                  checked={route.interdelivery}
                  disabled={editDisabled}
                  onChange={(e) =>
                    void run(() => {
                      update((s) => {
                        const row = s.draft?.routes.find(
                          (r) => r.id === route.id,
                        );
                        if (row) row.interdelivery = e.target.checked;
                      });
                      recalc(
                        '이배송 ' +
                          (e.target.checked ? '선택 · 협의 필요' : '해제'),
                      );
                    }, true)
                  }
                />
              </label>
            ) : null}
          </div>
          <div id="pd-stops" className="pd-scroll">
            {route ? (
              <Table
                headers={[
                  '순서',
                  '착지 / 원래 코스',
                  '주소 / 고객사',
                  '박스',
                  'OTD / 납품 방식',
                  '도착 / 대기',
                  '서비스(분)',
                  '여유(분)',
                  '이동',
                ]}
                rows={route.stopIds.map((id, index) => {
                  const s = stop(id);
                  if (!s) return [];
                  const timing = route.schedule?.find((t) => t.stopId === id);
                  return [
                    <div>
                      {index + 1}{' '}
                      {([-1, 1] as const).map((delta) => (
                        <button
                          key={delta}
                          className="pd-icon"
                          title={delta < 0 ? '위로 이동' : '아래로 이동'}
                          aria-label={delta < 0 ? '위로 이동' : '아래로 이동'}
                          disabled={editDisabled}
                          onClick={() =>
                            void run(() => {
                              const other = index + delta;
                              if (other < 0 || other >= route.stopIds.length)
                                return;
                              update((s) => {
                                const row = s.draft?.routes.find(
                                  (r) => r.id === route.id,
                                );
                                if (row)
                                  [row.stopIds[index], row.stopIds[other]] = [
                                    row.stopIds[other],
                                    row.stopIds[index],
                                  ];
                              });
                              recalc('배송 순서 변경');
                            }, true)
                          }
                        >
                          {delta < 0 ? '↑' : '↓'}
                        </button>
                      ))}
                    </div>,
                    `${s.name} / ${s.courses.join(', ')}`,
                    `${s.address} / ${s.customers.join(', ')}`,
                    s.boxes,
                    otdLabel(s.otd) + ' / ' + printable(s.mode),
                    time(timing?.arrivalTime) +
                      ' / ' +
                      num(timing?.waitingMinutes) +
                      '분',
                    ...(['serviceMinutes', 'marginMinutes'] as const).map(
                      (key) => (
                        <FieldInput
                          value={s[key]}
                          type="number"
                          min={0}
                          step={1}
                          disabled={editDisabled}
                          label={
                            s.name +
                            (key === 'serviceMinutes'
                              ? ' 서비스 시간'
                              : ' 도착 여유')
                          }
                          onCommit={(value) =>
                            void run(() => {
                              const number =
                                value === '' ? null : Number(value);
                              if (!Number.isFinite(number) || number! < 0)
                                throw Error(
                                  key === 'serviceMinutes'
                                    ? '서비스 시간을 확인해 주세요.'
                                    : '여유 시간을 확인해 주세요.',
                                );
                              update((s) => {
                                const row = s.draft?.stops.find(
                                  (row) => row.id === id,
                                );
                                if (row) row[key] = number!;
                              });
                              recalc(
                                key === 'serviceMinutes'
                                  ? '서비스 시간 변경'
                                  : '도착 여유 변경',
                              );
                            }, true)
                          }
                        />
                      ),
                    ),
                    moveSelect(id, route.id),
                  ];
                })}
              />
            ) : null}
          </div>
          <h4>미배정 착지 이동</h4>
          <div id="pd-move-unassigned" className="pd-scroll">
            {d ? (
              <Table
                headers={['착지', '주소', '박스', '배정 차량']}
                rows={d.unassigned.map((id) => [
                  stop(id)?.name,
                  stop(id)?.address,
                  stop(id)?.boxes,
                  moveSelect(id, ''),
                ])}
              />
            ) : null}
          </div>
          <details>
            <summary>도로 구간</summary>
            <div className="pd-toolbar">
              {action('refresh', '저장 구간 다시 읽기', refreshLegs, {
                edit: true,
                disabled: !d,
              })}
              {action('open-roads', '배차용 구간 수집', () =>
                update((s) => {
                  s.stage = 0;
                  s.sourceTab = 'roads';
                }),
              )}
            </div>
            <div id="pd-legs" className="pd-scroll">
              {d ? (
                <Table
                  headers={[
                    '코스',
                    '출발',
                    '도착',
                    '이동시간',
                    '측정 시각',
                    '상태',
                    '단일 조회',
                  ]}
                  rows={d.routes.flatMap((route) => {
                    let from = d.settings.origin || d.settings.originAddress;
                    return route.stopIds.map((id, index) => {
                      const origin = from,
                        to = stop(id)?.address || '',
                        leg = route.usedLegs?.[index],
                        measured = leg?.measured_at,
                        old =
                          !measured ||
                          Date.now() - Date.parse(measured) >
                            d.settings.freshnessMinutes * 60000;
                      from = to;
                      return [
                        routeLabel(route),
                        origin,
                        to,
                        leg && !leg.missing
                          ? num(Number(leg.duration_seconds) / 60) + '분'
                          : '미조회',
                        measured ? time(measured) : '미조회',
                        !leg || leg.missing
                          ? '구간 누락'
                          : old
                            ? '오래된 추정'
                            : '조회 시점 추정',
                        <button
                          className="btn btn-ghost"
                          disabled={disabled}
                          onClick={() =>
                            update((s) => {
                              s.pairFrom = origin;
                              s.pairTo = to;
                              s.status = '단일 구간 주소 선택됨';
                              s.statusError = false;
                            })
                          }
                        >
                          주소 선택
                        </button>,
                      ];
                    });
                  })}
                />
              ) : null}
            </div>
            <div className="pd-fields">
              <label>
                출발 주소
                <input
                  id="pd-pair-from"
                  maxLength={300}
                  disabled={editDisabled}
                  value={view.pairFrom}
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
                  id="pd-pair-to"
                  maxLength={300}
                  disabled={editDisabled}
                  value={view.pairTo}
                  onChange={(e) =>
                    update((s) => {
                      s.pairTo = e.target.value;
                    })
                  }
                />
              </label>
            </div>
            <p>
              센터 월 합산 도로 25,000회·주소 2,000회 한도 적용. 네이버 계정
              무료 잔여량 미확인.
            </p>
            {action('pair', '단일 구간 조회·저장', queryPair, { edit: true })}
            <button
              id="pd-stop-query"
              className="btn btn-ghost"
              hidden={view.queryJob === null}
              onClick={() => {
                queryStopped.current = true;
                if (view.queryJob)
                  void cancelRelationJob(view.queryJob).then(({ error }) => {
                    if (error)
                      message(
                        '중지 요청 실패 · 현재 배치 이후 중단합니다.',
                        true,
                      );
                  });
              }}
            >
              조회 중지
            </button>
          </details>
        </section>
        <section
          data-panel="4"
          hidden={view.stage !== 4}
          aria-labelledby="pd-save-title"
        >
          <h3 id="pd-save-title">저장·출력</h3>
          <label>
            변경 이유
            <textarea
              id="pd-reason"
              rows={2}
              maxLength={2000}
              disabled={editDisabled}
              value={view.reason}
              onChange={(e) =>
                update((s) => {
                  s.reason = e.target.value;
                  if (editable) touch(s);
                })
              }
            />
          </label>
          <div className="pd-toolbar">
            {action('save', '현재 버전 저장', () => save(), {
              edit: true,
              primary: true,
              disabled: !d || view.needsRegeneration,
            })}
            {action('save-copy', '새 스냅샷 저장', () => save(true), {
              edit: true,
              disabled: !d || view.needsRegeneration,
            })}
            {action(
              'export',
              '엑셀 다운로드',
              async () => {
                if (!current.current.draft)
                  throw Error('출력할 초안이 없습니다.');
                const s = current.current;
                download(
                  new Blob(
                    [
                      await manualDispatchWorkbook({
                        ...payload(),
                        id: s.id,
                        revision: s.revision,
                        dirty: s.dirty,
                      }),
                    ],
                    {
                      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    },
                  ),
                  `평택_가배차_${s.date}_v${s.revision}.xlsx`,
                );
                message('엑셀 다운로드 완료');
              },
              { disabled: !d },
            )}
            {action('list', '저장 목록 새로고침', snapshots)}
          </div>
          <p id="pd-saved-info">
            {view.id
              ? `${view.date} 저장본 · 버전 ${view.revision}`
              : '저장된 버전 없음'}
          </p>
          <div id="pd-snapshots" className="pd-scroll">
            <Table
              headers={['기준일', '버전', '수정 시각', '불러오기']}
              rows={view.snapshots.map((item) => [
                item.date,
                item.revision,
                time(item.updatedAt),
                <button
                  className="btn btn-ghost"
                  disabled={disabled}
                  onClick={() => void run(() => restore(item.id))}
                >
                  불러오기
                </button>,
              ])}
            />
          </div>
          <details>
            <summary>조정 이력</summary>
            <div id="pd-history">
              {view.history.map((h, i) => (
                <p key={i}>
                  {time(h.at)} · {h.reason}
                </p>
              ))}
            </div>
          </details>
        </section>
        <div className="pd-toolbar pd-footer">
          {action(
            'back',
            '이전',
            () =>
              update((s) => {
                s.stage = Math.max(0, s.stage - 1);
              }),
            { hidden: view.stage === 0 },
          )}
          {action(
            'next',
            '다음',
            () =>
              update((s) => {
                s.stage = Math.min(4, s.stage + 1);
              }),
            { hidden: view.stage === 4 },
          )}
        </div>
      </div>
      {feedback}
      {downloadLink}
    </div>
  );
}
