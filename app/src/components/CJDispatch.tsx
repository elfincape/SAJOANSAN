import { useEffect, useRef, useState } from 'react';
import { DispatchBoard } from './DispatchBoard';
import { useWorkspaceActions } from '../lib/workspace-actions';
import '../styles/dispatch-experience.css';
import * as XLSX from 'xlsx';
import { useAdminPage } from './AdminPage';
import { useFeedback } from './useFeedback';
import { useDownload } from './useDownload';
import { FileArea } from './FileArea';
import { displayToMin } from '../domain/time';
import {
  parseCJWorkbook,
  actualWorkbookTrips,
  routeKey,
} from '../domain/cj-import';
import { historicalModel } from '../domain/cj-history';
import { drivingGraph } from '../domain/cj-travel';
import {
  dispatchFleet,
  generateDispatch,
  recomputeDispatch,
  moveWholeDestination,
  newTemporaryGroup,
  compareActual,
  mergeDestinations,
  applyTransferCandidate,
  transferCandidates,
} from '../domain/cj-planner';
import type {
  CJParsed,
  CJResources,
  HistoryModel,
  DrivingGraph,
  CJPlan,
  FleetSettings,
  CJComparison,
  CharterTrip,
  CJFleet,
  CJJob,
  TransferCandidate,
  CJGroup,
} from '../domain/cj-types';
import {
  loadDispatchResources,
  saveDispatchDraft,
  listDispatchDrafts,
  readDispatchDraft,
} from '../lib/cj-dispatch';
import type { CJReference, CJSavedDraft, CJPayload } from '../lib/cj-dispatch';
interface State {
  parsed: CJParsed | null;
  resources: CJResources | null;
  model: HistoryModel | null;
  graph: DrivingGraph | null;
  plan: CJPlan | null;
  settings: FleetSettings;
  comparison: CJComparison | null;
  actualTrips: CharterTrip[] | null;
  reference: CJReference | null;
  dirty: boolean;
  busy: boolean;
  settingsDirty: boolean;
  verificationPending: boolean;
  routePage: number;
  status: string;
  statusError: boolean;
  date: string;
  inputSummary: string;
  dataSummary: string;
  temporaryCapacity: string;
  filter: string;
  kind: string;
  drafts: CJSavedDraft[];
  selectedDraft: string;
  listed: boolean;
}
interface Edit {
  id: string;
  address: string;
  earliest: string;
  initialEarliest: string;
  deadline: string;
  initialDeadline: string;
  unloadMinutes: string;
  inspectionMinutes: string;
  marginMinutes: string;
  target: string;
  merge: string;
  error: string;
}
const fmt = (v: unknown) =>
  v == null
    ? '미확인'
    : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const labels: Record<string, string> = {
  fixed: '고정차',
  external: '외부 지정',
  temporary: '용차 검토',
  review: '소속 확인',
};
const timeInput = (value: number | null | undefined) =>
  value == null
    ? ''
    : String(Math.floor(value / 60)).padStart(2, '0') +
      ':' +
      String(value % 60).padStart(2, '0');
const signature = (r: CJResources) =>
  JSON.stringify([
    r.points
      .map((p) => [
        p.id,
        p.code,
        p.address,
        p.deadline_business_min,
        p.dispatch_profile,
      ])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
    r.routes
      .map((r) => [r.id, r.name, r.active, r.closed_days, r.stops])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  ]);
function FleetRow({
  fleet: f,
  own,
  disabled,
  onUpdate,
}: {
  fleet: CJFleet;
  own: number;
  disabled: boolean;
  onUpdate: (id: string, value: Partial<CJFleet>) => void;
}) {
  const [fields, setFields] = useState(() => ({
    available: f.available,
    capacity: f.capacity == null ? '' : String(f.capacity),
    extra: f.maxExtraMinutes == null ? '' : String(f.maxExtraMinutes),
    departure: timeInput(f.departureMinutes),
    threshold: String(f.splitThresholdPercent),
  }));
  useEffect(
    () =>
      setFields({
        available: f.available,
        capacity: f.capacity == null ? '' : String(f.capacity),
        extra: f.maxExtraMinutes == null ? '' : String(f.maxExtraMinutes),
        departure: timeInput(f.departureMinutes),
        threshold: String(f.splitThresholdPercent),
      }),
    [
      f.available,
      f.capacity,
      f.maxExtraMinutes,
      f.departureMinutes,
      f.splitThresholdPercent,
    ],
  );
  const current = useRef(fields);
  current.current = fields;
  function commit(values = fields) {
    onUpdate(f.id, {
      splitThresholdPercent:
        values.threshold === '' ? NaN : Number(values.threshold),
      available: values.available,
      capacity: values.capacity === '' ? null : Number(values.capacity),
      maxExtraMinutes: values.extra === '' ? null : Number(values.extra),
      departureMinutes: displayToMin(values.departure),
    });
  }
  const number = (key: 'capacity' | 'extra' | 'threshold', label: string) => (
    <input
      type="number"
      min="0"
      max={key === 'threshold' ? 100 : undefined}
      step="any"
      className="app-input"
      aria-label={label}
      value={fields[key]}
      disabled={disabled}
      onChange={(e) => setFields((s) => ({ ...s, [key]: e.target.value }))}
      onBlur={() => {
        const saved =
          key === 'capacity'
            ? f.capacity
            : key === 'extra'
              ? f.maxExtraMinutes
              : f.splitThresholdPercent;
        if (current.current[key] !== String(saved ?? ''))
          commit(current.current);
      }}
    />
  );
  return (
    <tr>
      <td>{f.route}</td>
      <td>{f.driver}</td>
      <td>{f.plate}</td>
      <td>{fmt(f.tons)}</td>
      <td>{fmt(own)}</td>
      <td>
        <input
          type="checkbox"
          aria-label={f.route + ' 운행 여부'}
          checked={fields.available}
          disabled={disabled}
          onChange={(e) => {
            const next = { ...fields, available: e.target.checked };
            setFields(next);
            commit(next);
          }}
        />
      </td>
      <td>{number('capacity', f.route + ' 실제 상차한도')}</td>
      <td>{number('threshold', f.route + ' 분할 검토 기준 (%)')}</td>
      <td>
        <input
          type="time"
          className="app-input"
          aria-label={f.route + ' 출발시간'}
          value={fields.departure}
          disabled={disabled}
          onChange={(e) => {
            const next = { ...fields, departure: e.target.value };
            setFields(next);
            commit(next);
          }}
        />
      </td>
      <td>{number('extra', f.route + ' 이배송 허용 추가시간')}</td>
    </tr>
  );
}
const comparableProfile = (profile: CJJob['profile']) =>
  Object.fromEntries(
    Object.entries(profile || {})
      .filter(([, value]) => value != null)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
// Compare editable plan content; verification and timestamps are recomputed separately.
const adjustmentKey = (plan: CJPlan) =>
  JSON.stringify({
    jobs: plan.jobs.map(
      ({
        id,
        address,
        earliestArrival,
        deadline,
        profile,
        memberIds,
        quantity,
        conditionReview,
        otdInvalid,
      }) => ({
        id,
        address,
        earliestArrival: earliestArrival ?? null,
        deadline: deadline ?? null,
        profile: comparableProfile(profile),
        memberIds,
        quantity,
        conditionReview: !!conditionReview,
        otdInvalid: !!otdInvalid,
      }),
    ),
    groups: plan.groups.map(
      ({ id, jobIds, capacity, label, departureMinutes }) => ({
        id,
        jobIds,
        capacity,
        label,
        departureMinutes,
      }),
    ),
  });
function planChanges(before: CJPlan | null, after: CJPlan | null): string[] {
  if (!before || !after) return [];
  const changes: string[] = [];
  const originalJobs = new Map(before.jobs.map((job) => [job.id, job]));
  const currentJobs = new Map(after.jobs.map((job) => [job.id, job]));
  const originalGroups = new Map(
    before.groups.map((group) => [group.id, group]),
  );
  const assignment = new Map(
    before.groups.flatMap((group) =>
      group.jobIds.map((id) => [id, group] as const),
    ),
  );
  for (const group of after.groups) {
    const old = originalGroups.get(group.id);
    if (old && (old.label !== group.label || old.capacity !== group.capacity))
      changes.push(
        `${old.label} → ${group.label} · 실제 상차한도 ${fmt(old.capacity)} → ${fmt(group.capacity)}`,
      );
    for (const [index, id] of group.jobIds.entries()) {
      const job = currentJobs.get(id);
      if (!job) continue;
      const previous = assignment.get(id);
      if (!previous) changes.push(`${job.name} · 새 배정 → ${group.label}`);
      else if (previous.id !== group.id)
        changes.push(`${job.name} · ${previous.label} → ${group.label}`);
      else if (previous.jobIds.indexOf(id) !== index)
        changes.push(
          `${job.name} · ${group.label} 순서 ${previous.jobIds.indexOf(id) + 1} → ${index + 1}`,
        );
      const original = originalJobs.get(id);
      if (original) {
        if (original.address !== job.address)
          changes.push(
            `${job.name} · 주소 ${original.address || '미확인'} → ${job.address || '미확인'}`,
          );
        if (
          (original.earliestArrival ?? null) !== (job.earliestArrival ?? null)
        )
          changes.push(
            `${job.name} · 납품 시작 ${timeInput(original.earliestArrival) || '미확인'} → ${timeInput(job.earliestArrival) || '미확인'}`,
          );
        if ((original.deadline ?? null) !== (job.deadline ?? null))
          changes.push(
            `${job.name} · 납품 마감 ${timeInput(original.deadline) || '미확인'} → ${timeInput(job.deadline) || '미확인'}`,
          );
        for (const [key, label] of [
          ['unloadMinutes', '하차'],
          ['inspectionMinutes', '검수'],
          ['marginMinutes', '여유'],
        ] as const)
          if (
            (original.profile?.[key] ?? null) !== (job.profile?.[key] ?? null)
          )
            changes.push(
              `${job.name} · ${label} ${fmt(original.profile?.[key])} → ${fmt(job.profile?.[key])}분`,
            );
        if (
          !!original.conditionReview !== !!job.conditionReview ||
          !!original.otdInvalid !== !!job.otdInvalid
        )
          changes.push(
            `${job.name} · 납품조건 ${original.conditionReview || original.otdInvalid ? '확인 필요' : '확인됨'} → ${job.conditionReview || job.otdInvalid ? '확인 필요' : '확인됨'}`,
          );
      }
      if (
        original &&
        (original.quantity !== job.quantity ||
          JSON.stringify(original.memberIds) !== JSON.stringify(job.memberIds))
      )
        changes.push(
          `${job.name} · 착지 묶음/물량 ${fmt(original.quantity)} → ${fmt(job.quantity)}`,
        );
    }
  }
  for (const job of before.jobs)
    if (!currentJobs.has(job.id))
      changes.push(`${job.name} · 기존 착지 묶음 해제/병합`);
  return changes;
}
export function CJDispatch({
  active,
  onStateChange,
}: {
  active: boolean;
  onStateChange?: (state: { busy: boolean; dirty: boolean }) => void;
}) {
  const { editable } = useAdminPage(),
    { confirm, feedback } = useFeedback(),
    { download, downloadLink } = useDownload();
  const [view, setView] = useState<State>(() => ({
      parsed: null,
      resources: null,
      model: null,
      graph: null,
      plan: null,
      settings: {},
      comparison: null,
      actualTrips: null,
      reference: null,
      dirty: false,
      busy: false,
      settingsDirty: false,
      verificationPending: false,
      routePage: 0,
      status: editable
        ? 'CJ 당일 지시서로 배차 작업을 시작하세요.'
        : '열람 전용: 저장한 가배차 조회와 다운로드를 사용할 수 있습니다.',
      statusError: false,
      date: '',
      inputSummary: '',
      dataSummary: '',
      temporaryCapacity: '',
      filter: '',
      kind: '',
      drafts: [],
      selectedDraft: '',
      listed: false,
    })),
    current = useRef(view),
    dialog = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<Edit | null>(null);
  const [layout, setLayout] = useState<'list' | 'board'>('list');
  const [focusedJobId, setFocusedJobId] = useState('');
  const history = useRef<{ past: CJPlan[]; future: CJPlan[] }>({
    past: [],
    future: [],
  });
  const baseline = useRef<{ plan: CJPlan | null; dirty: boolean }>({
    plan: null,
    dirty: false,
  });
  const [boardEpoch, setBoardEpoch] = useState(0);
  function clearHistory() {
    history.current = { past: [], future: [] };
  }
  function resetBaseline(plan: CJPlan | null, dirty: boolean) {
    clearHistory();
    baseline.current = { plan: plan ? structuredClone(plan) : null, dirty };
    setBoardEpoch((value) => value + 1);
    setFocusedJobId('');
  }
  function historyStep(direction: 'past' | 'future') {
    const s = current.current;
    if (
      !editable ||
      s.busy ||
      !s.plan ||
      s.settingsDirty ||
      s.verificationPending
    )
      return;
    const stack = history.current[direction];
    const snapshot = stack.pop();
    if (!snapshot) return;
    const opposite = direction === 'past' ? 'future' : 'past';
    history.current[opposite].push(structuredClone(s.plan));
    const next = recomputeDispatch(structuredClone(snapshot), s.graph);
    next.transferCandidates = s.model
      ? transferCandidates(next, s.model, s.graph)
      : [];
    mark(next, false);
    status(
      direction === 'past'
        ? '최근 로컬 조정을 되돌렸습니다. 주행과 물량을 다시 확인했습니다.'
        : '로컬 조정을 다시 적용했습니다. 주행과 물량을 다시 확인했습니다.',
    );
  }
  function update(fn: (s: State) => void) {
    const next = { ...current.current };
    fn(next);
    current.current = next;
    setView(next);
  }
  function status(text: string, error = false) {
    update((s) => {
      s.status = text;
      s.statusError = error;
    });
  }
  async function task(action: () => void | Promise<void>) {
    if (current.current.busy) return;
    update((s) => {
      s.busy = true;
    });
    try {
      await action();
    } catch (error) {
      status(error instanceof Error ? error.message : String(error), true);
    } finally {
      update((s) => {
        s.busy = false;
      });
    }
  }
  useEffect(() => {
    onStateChange?.({ busy: view.busy, dirty: view.dirty });
  }, [view.busy, view.dirty, onStateChange]);
  useEffect(() => {
    if (editing && !dialog.current?.open) dialog.current?.showModal();
    if (!editing && dialog.current?.open) dialog.current.close();
  }, [editing]);
  useEffect(() => {
    const changed = () => {
      clearHistory();
      update((s) => {
        s.resources = null;
        s.model = null;
        s.graph = null;
        if (s.plan) {
          s.settingsDirty = true;
          s.plan = structuredClone(s.plan);
          s.plan.resourcesOutdated = true;
          recomputeDispatch(s.plan, null);
        }
      });
      status(
        '납품정보·주행 DB가 변경되었습니다. 기준·주행·이력을 다시 불러오고 가배차를 재실행해 주세요.',
      );
    };
    window.addEventListener('pyeongtaek-dispatch-resources-changed', changed);
    return () =>
      window.removeEventListener(
        'pyeongtaek-dispatch-resources-changed',
        changed,
      );
  }, []);
  function mark(plan: CJPlan, record = true) {
    const s = current.current;
    if (record && s.plan && adjustmentKey(s.plan) !== adjustmentKey(plan)) {
      history.current.past = [
        ...history.current.past.slice(-19),
        structuredClone(s.plan),
      ];
      history.current.future = [];
    }
    const comparison = s.actualTrips
      ? compareActual(plan, s.actualTrips)
      : null;
    update((s) => {
      s.plan = plan;
      s.dirty =
        baseline.current.dirty ||
        !baseline.current.plan ||
        adjustmentKey(plan) !== adjustmentKey(baseline.current.plan);
      s.comparison = comparison;
    });
  }
  async function discard() {
    return (
      !current.current.dirty ||
      (await confirm(
        '현재 가배차에 저장하지 않은 조정이 있습니다. 새 작업으로 바꿀까요?',
      ))
    );
  }
  function source(file: File) {
    void task(async () => {
      if (!(await discard())) return;
      const parsed = parseCJWorkbook(
        XLSX.read(await file.arrayBuffer(), { type: 'array' }),
        XLSX,
      );
      parsed.sourceName = file.name;
      resetBaseline(null, true);
      update((s) => {
        s.parsed = parsed;
        s.date = parsed.date;
        s.resources = null;
        s.model = null;
        s.graph = null;
        s.plan = null;
        s.comparison = null;
        s.actualTrips = null;
        s.reference = null;
        s.settings = {};
        s.settingsDirty = false;
        s.verificationPending = false;
        s.dirty = true;
        s.inputSummary = `${parsed.sourceCount} 상세행 · ${parsed.jobs.length} 코드/명 · ${fmt(parsed.jobs.reduce((n, j) => n + j.quantity, 0))} 박스환산 · ${parsed.issues.map((i) => i.message).join(' / ')}`;
      });
      status('CJ 지시서를 읽었습니다. 기준·주행·이력을 불러오세요.');
    });
  }
  async function load() {
    const date = current.current.parsed?.date || current.current.date;
    if (!date) throw Error('CJ 파일 또는 배차일자를 먼저 선택해 주세요.');
    status('등록 코스·전체 주행 구간·이력을 불러오는 중…');
    const resources = await loadDispatchResources(date),
      model = historicalModel(resources.history, date),
      graph = drivingGraph(resources.addresses, resources.legs);
    clearHistory();
    update((s) => {
      s.resources = resources;
      s.model = model;
      s.graph = graph;
      if (s.plan) {
        s.plan = structuredClone(s.plan);
        if (s.plan.resourceSignature !== signature(resources))
          s.settingsDirty = true;
        s.verificationPending = false;
        s.plan.resourcesOutdated = s.settingsDirty;
        recomputeDispatch(s.plan, graph);
        s.plan.transferCandidates = transferCandidates(s.plan, model, graph);
      }
      s.dataSummary = `코스 ${resources.routes.length} · 주행 ${graph.audit.readLegs}건(유효 ${graph.audit.validLegs}, 좌표변경 ${graph.audit.staleLegs}, 오류 ${graph.audit.invalidLegs}) · 이전 ${model.days}일 이력 · 충돌 코스 제외 ${model.excludedCourses}`;
    });
    status(
      current.current.settingsDirty
        ? '납품정보 또는 코스 기준이 변경되었습니다. 현재 조정은 유지됩니다. 가배차를 재실행한 뒤 저장하세요.'
        : '기준·주행·이력을 불러왔습니다. 실제 상차한도를 확인한 뒤 가배차를 실행하세요.',
    );
  }
  function fleetUpdate(id: string, value: Partial<CJFleet>) {
    const threshold = value.splitThresholdPercent,
      capacity = value.capacity,
      extra = value.maxExtraMinutes;
    if (
      !Number.isFinite(threshold) ||
      threshold! < 0 ||
      threshold! > 100 ||
      (capacity !== null && (!Number.isFinite(capacity) || capacity! <= 0)) ||
      (extra !== null && (!Number.isFinite(extra) || extra! < 0))
    ) {
      status('차량 조건 숫자를 확인해 주세요.', true);
      return;
    }
    clearHistory();
    update((s) => {
      s.settingsDirty = true;
      s.settings = { ...s.settings, [id]: value };
      s.dirty = true;
    });
    status(
      '차량 조건을 변경했습니다. 가배차 실행 시 반영됩니다. 기존 수동 조정은 다시 생성하면 교체됩니다.',
    );
  }
  async function generate() {
    const s = current.current;
    if (!s.parsed || !s.resources || !s.model)
      throw Error('CJ 지시서와 기준·주행·이력을 먼저 불러와 주세요.');
    if (
      s.plan &&
      !(await confirm(
        '가배차를 다시 만들면 현재 수동 조정을 교체합니다. 계속할까요?',
      ))
    )
      return;
    const capacity =
      s.temporaryCapacity.trim() === '' ? null : Number(s.temporaryCapacity);
    if (capacity !== null && (!Number.isFinite(capacity) || capacity <= 0))
      throw Error('임시차 실제 상차한도를 확인해 주세요.');
    const next = generateDispatch(s.parsed, {
      ...s.resources,
      model: s.model,
      graph: s.graph,
      settings: s.settings,
      temporaryCapacity: capacity,
    });
    next.resourceSignature = signature(s.resources);
    update((s) => {
      s.settingsDirty = false;
      s.verificationPending = false;
    });
    resetBaseline(next, true);
    mark(next, false);
    status('가배차를 만들었습니다. 검토 상태와 착지 묶음을 확인해 주세요.');
  }
  async function actual(file: File) {
    const s = current.current;
    if (!s.plan) return;
    const trips = actualWorkbookTrips(
        XLSX.read(await file.arrayBuffer(), { type: 'array' }),
        XLSX,
      ),
      comparison = compareActual(s.plan, trips);
    update((s) => {
      s.actualTrips = trips;
      s.comparison = comparison;
    });
    status(
      '당일 실배차와 대조했습니다. 이 파일은 가배차 추천 이력에 넣지 않았습니다.',
    );
  }
  function payload(): CJPayload {
    const s = current.current;
    if (!s.plan) throw Error('가배차가 없습니다.');
    return {
      schemaVersion: 1,
      type: 'pyeongtaek-dispatch',
      parsed: s.parsed,
      settings: s.settings,
      plan: s.plan,
    };
  }
  async function list() {
    const drafts = await listDispatchDrafts();
    update((s) => {
      s.drafts = drafts;
      s.selectedDraft = '';
      s.listed = true;
    });
  }
  async function save() {
    const s = current.current;
    if (!editable) throw Error('가배차 수정 권한이 없습니다.');
    if (s.settingsDirty || s.verificationPending)
      throw Error(
        '변경한 차량 조건으로 가배차를 다시 실행한 뒤 저장해 주세요.',
      );
    const saved = await saveDispatchDraft(payload(), s.reference);
    resetBaseline(s.plan, false);
    update((s) => {
      s.reference = { id: saved.id, revision: saved.revision };
      s.dirty = false;
    });
    status('가배차를 저장했습니다. 버전 ' + saved.revision);
    await list();
  }
  async function restore() {
    const s = current.current;
    if (!s.selectedDraft || !(await discard())) return;
    const row = await readDispatchDraft(s.selectedDraft),
      p = row.payload;
    if (
      p?.schemaVersion !== 1 ||
      p.type !== 'pyeongtaek-dispatch' ||
      !p.parsed?.jobs ||
      !p.plan?.jobs ||
      !p.plan?.groups
    )
      throw Error('지원하지 않는 가배차 저장 형식입니다.');
    const plan = structuredClone(p.plan);
    recomputeDispatch(plan, null);
    plan.resourcesOutdated = true;
    resetBaseline(plan, false);
    update((s) => {
      s.parsed = p.parsed;
      s.settings = p.settings || {};
      s.plan = plan;
      s.reference = { id: row.id, revision: row.revision };
      s.model = null;
      s.resources = null;
      s.graph = null;
      s.comparison = null;
      s.actualTrips = null;
      s.dirty = false;
      s.settingsDirty = false;
      s.verificationPending = true;
      s.date = plan.date;
    });
    status(
      '저장안을 불러왔습니다. 저장·출력 전 기준·주행·이력을 다시 불러와 현재 납품조건과 경로를 확인해 주세요.',
    );
  }
  function reorder(groupId: string, index: number, direction: number) {
    if (!editable || !current.current.plan) return;
    const next = structuredClone(current.current.plan),
      g = next.groups.find((g) => g.id === groupId);
    if (!g) return;
    const k = index + direction;
    if (k < 0 || k >= g.jobIds.length) return;
    [g.jobIds[index], g.jobIds[k]] = [g.jobIds[k], g.jobIds[index]];
    next.transferCandidates = [];
    mark(recomputeDispatch(next, current.current.graph));
  }
  function edit(job: CJJob) {
    if (!editable || !view.plan) return;
    const earliest =
        job.earliestArrival == null || job.earliestArrival >= 1440
          ? ''
          : timeInput(job.earliestArrival),
      deadline = timeInput(job.deadline);
    setEditing({
      id: job.id,
      address: job.address,
      earliest,
      initialEarliest: earliest,
      deadline,
      initialDeadline: deadline,
      unloadMinutes:
        job.profile?.unloadMinutes == null
          ? ''
          : String(job.profile.unloadMinutes),
      inspectionMinutes:
        job.profile?.inspectionMinutes == null
          ? ''
          : String(job.profile.inspectionMinutes),
      marginMinutes:
        job.profile?.marginMinutes == null
          ? ''
          : String(job.profile.marginMinutes),
      target: view.plan.groups.find((g) => g.jobIds.includes(job.id))?.id || '',
      merge: '',
      error: '',
    });
  }
  function applyEdit() {
    if (!editable || !editing || !current.current.plan) return;
    try {
      let next = structuredClone(current.current.plan);
      const job = next.jobs.find((j) => j.id === editing.id);
      if (!job) throw Error('조정할 착지를 찾지 못했습니다.');
      job.address = editing.address.trim();
      for (const [key, field] of [
        ['deadline', 'deadline'],
        ['earliest', 'earliestArrival'],
      ] as const) {
        const initial =
          key === 'deadline'
            ? editing.initialDeadline
            : editing.initialEarliest;
        if (editing[key] !== initial) {
          job[field] = displayToMin(editing[key]);
          job.otdInvalid = false;
        }
      }
      job.profile = { ...(job.profile || {}) };
      for (const key of [
        'unloadMinutes',
        'inspectionMinutes',
        'marginMinutes',
      ] as const) {
        const v = editing[key].trim() === '' ? null : Number(editing[key]);
        if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1440))
          throw Error('소요시간은 0~1440분으로 입력해 주세요.');
        job.profile[key] = v;
      }
      job.conditionReview = false;
      next = editing.merge
        ? mergeDestinations(
            next,
            editing.id,
            editing.merge,
            current.current.graph,
          )
        : editing.target === '__new'
          ? newTemporaryGroup(next, editing.id, current.current.graph)
          : moveWholeDestination(
              next,
              editing.id,
              editing.target,
              current.current.graph,
            );
      next.transferCandidates = [];
      mark(recomputeDispatch(next, current.current.graph));
      setEditing(null);
    } catch (error) {
      setEditing((e) =>
        e
          ? {
              ...e,
              error: error instanceof Error ? error.message : String(error),
            }
          : e,
      );
    }
  }
  async function transfer(candidate: TransferCandidate) {
    const s = current.current;
    if (!s.plan || !s.model)
      throw Error('기준·주행·이력을 먼저 불러와 주세요.');
    const fresh = transferCandidates(s.plan, s.model, s.graph).find(
      (x) => x.jobId === candidate.jobId && x.targetId === candidate.targetId,
    );
    if (!fresh) throw Error('다른 조정으로 후보 조건이 바뀌었습니다.');
    if (
      !fresh.travel.deadlineVerified &&
      !(await confirm('납품시간 조건이 미확인입니다. 검토 상태로 이동할까요?'))
    )
      return;
    const next = applyTransferCandidate(s.plan, fresh, s.graph);
    mark(next);
    update((s) => {
      if (s.plan)
        s.plan = {
          ...s.plan,
          transferCandidates: transferCandidates(s.plan, s.model!, s.graph),
        };
    });
  }
  function groupEdit(group: CJGroup) {
    void task(() => {
      if (!current.current.plan) return;
      const label = prompt('코스 이름', group.label);
      if (label === null) return;
      const capacity = prompt(
        '확인된 실제 상차한도(박스환산). 미확인은 빈칸',
        group.capacity == null ? '' : String(group.capacity),
      );
      if (capacity === null) return;
      const n = capacity.trim() === '' ? null : Number(capacity);
      if (n !== null && (!Number.isFinite(n) || n <= 0))
        throw Error('상차한도를 확인해 주세요.');
      const next = structuredClone(current.current.plan),
        target = next.groups.find((g) => g.id === group.id)!;
      target.label = label.trim() || group.label;
      target.capacity = n;
      mark(recomputeDispatch(next, current.current.graph));
    });
  }
  function exportExcel() {
    const plan = current.current.plan;
    if (!plan) return;
    const wb = XLSX.utils.book_new(),
      rows: unknown[][] = [
        [
          '배차일',
          '구분',
          '코스',
          '원래 호차',
          '착지코드',
          '착지',
          '주소',
          '박스환산',
          '냉동',
          '냉장',
          '실제 상차한도',
          '근거',
          '확인 필요',
        ],
      ];
    for (const g of plan.groups)
      for (const id of g.jobIds) {
        const j = plan.jobs.find((j) => j.id === id)!;
        for (const m of j.members)
          rows.push([
            plan.date,
            g.kind,
            g.label,
            j.ownerRoute,
            m.code,
            m.name,
            j.address,
            m.quantity,
            m.frozen,
            m.chilled,
            g.capacity,
            g.reason,
            (g.issues || []).join(' / '),
          ]);
      }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '가배차');
    if (current.current.comparison)
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          current.current.comparison.rows.map((r) => ({
            ...r,
            actualCourses: r.actualCourses.join(', '),
          })),
        ),
        '실배차 대조',
      );
    XLSX.writeFile(wb, '평택_' + plan.date + '_가배차.xlsx', {
      compression: true,
    });
  }
  const plan = view.plan,
    visibleGroups = (plan?.groups || []).filter((g) => {
      if (view.kind && g.kind !== view.kind) return false;
      const js = g.jobIds.map((id) => plan!.jobs.find((j) => j.id === id)!);
      const query = view.filter.trim();
      return (
        !query ||
        [
          g.label,
          ...js.flatMap((j) => [j.name, j.ownerRoute, ...j.memberIds]),
        ].some((text) => text.includes(query))
      );
    }),
    page = Math.min(
      view.routePage,
      Math.max(0, Math.ceil(visibleGroups.length / 10) - 1),
    ),
    saveBlocked = !plan || view.settingsDirty || view.verificationPending,
    editingJob = plan?.jobs.find((j) => j.id === editing?.id),
    changes = planChanges(baseline.current.plan, plan);
  useWorkspaceActions(
    active
      ? [
          {
            id: 'cj-show-board',
            title: '배차 · 차량 보드 보기',
            description: '차량별 적재량과 착지 카드',
            disabled: !plan || view.busy,
            run: () => setLayout('board'),
          },
          {
            id: 'cj-show-list',
            title: '배차 · 상세 목록 보기',
            description: '기존 착지 상세 표',
            disabled: !plan || view.busy,
            run: () => setLayout('list'),
          },
          {
            id: 'cj-search',
            title: '배차 · 착지 검색',
            description: '착지·원본 코드·코스 검색으로 이동',
            disabled: view.busy,
            run: () => document.getElementById('dispatch-filter')?.focus(),
          },
          {
            id: 'cj-undo',
            title: '배차 · 로컬 조정 되돌리기',
            disabled:
              view.busy ||
              !editable ||
              saveBlocked ||
              !history.current.past.length,
            run: () => historyStep('past'),
          },
          {
            id: 'cj-redo',
            title: '배차 · 로컬 조정 다시 적용',
            disabled:
              view.busy ||
              !editable ||
              saveBlocked ||
              !history.current.future.length,
            run: () => historyStep('future'),
          },
          {
            id: 'cj-save',
            title: '배차 · 가배차 저장',
            disabled: view.busy || !editable || saveBlocked,
            run: () => document.getElementById('dispatch-save')?.click(),
          },
          {
            id: 'cj-export',
            title: '배차 · 가배차 엑셀 다운로드',
            disabled: view.busy || saveBlocked,
            run: () => document.getElementById('dispatch-export')?.click(),
          },
        ]
      : [],
  );
  function button(
    id: string,
    text: string,
    action: () => void | Promise<void>,
    options: { read?: boolean; primary?: boolean; disabled?: boolean } = {},
  ) {
    return (
      <button
        id={'dispatch-' + id}
        type="button"
        data-action={options.read ? 'read' : undefined}
        className={`btn ${options.primary ? 'btn-primary' : 'btn-ghost'}`}
        disabled={view.busy || (!editable && !options.read) || options.disabled}
        onClick={() => void task(action)}
      >
        {text}
      </button>
    );
  }
  return (
    <section
      id="dispatch-workspace"
      hidden={!active}
      className="panel space-y-4 p-5"
    >
      <h2 className="font-semibold">평택 배차 작업</h2>
      <p className="text-sm muted">
        CJ 당일 지시서에서 본인코스를 먼저 배정하고 잔여 용차·이배송을
        조정합니다. CJ 톤별 참고량과 실제 상차한도는 다릅니다.
      </p>
      <p
        id="dispatch-status"
        role="status"
        aria-live="polite"
        className={view.statusError ? 'issue' : 'muted'}
      >
        {view.status}
      </p>
      <FileArea
        accept=".xlsx"
        disabled={view.busy || !editable}
        onFiles={(files) => {
          if (files[0]) source(files[0]);
        }}
      >
        <div className="toolbar">
          <label>
            <span className="app-label">CJ 당일 배차지시서</span>
            <input
              id="dispatch-source"
              type="file"
              accept=".xlsx"
              className="app-input"
              disabled={view.busy || !editable}
              onChange={(e) => {
                if (e.target.files?.[0]) source(e.target.files[0]);
              }}
            />
          </label>
          <label>
            <span className="app-label">배차일</span>
            <input
              id="dispatch-date"
              type="date"
              className="app-input"
              disabled={view.busy || !editable}
              value={view.date}
              onChange={(e) => {
                if (view.parsed && e.target.value !== view.parsed.date) {
                  status(
                    '일자는 CJ 원본에서 확인합니다. 다른 날짜 작업은 해당 지시서를 올려 주세요.',
                    true,
                  );
                  return;
                }
                update((s) => {
                  clearHistory();
                  s.date = e.target.value;
                });
              }}
            />
          </label>
          {button('load', '기준·주행·이력 불러오기', load, { read: true })}
        </div>
      </FileArea>
      <p id="dispatch-input-summary" className="text-xs muted">
        {view.inputSummary}
      </p>
      <p id="dispatch-data-summary" className="text-xs muted">
        {view.dataSummary}
      </p>
      <details>
        <summary>고정기사 운행 여부 · 실제 상차한도</summary>
        <p className="text-xs muted my-3">
          원래 코스를 먼저 싣습니다. 한도가 비어 있으면 물량을 임의로 넘기지
          않고 본인코스 안을 검토 상태로 유지합니다. 날짜가 바뀌면 조건을 다시
          확인해 주세요. 고정차 조건을 바꾼 뒤에는 가배차를 다시 실행합니다.
          온전한 착지 우선 배정 후 적재율이 분할 검토 기준 미만이면 일부 물량을
          나눠 싣습니다. 기본 90%는 임시 기준입니다. 분할 시 품목별 상차내역은
          별도로 확인하세요.
        </p>
        <div className="scroll">
          <table id="dispatch-fleet" className="app-table">
            <thead>
              <tr>
                {[
                  '코스',
                  '기사',
                  '차량',
                  '톤수',
                  'CJ 본인·지원 물량',
                  '운행',
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
                <th>
                  실제 상차한도
                  <br />
                  (박스환산)
                </th>
                <th>분할 검토 기준 (%)</th>
                <th>출발시간</th>
                <th>
                  본인코스 대비 누적
                  <br />
                  이배송 허용 추가시간 (분)
                </th>
              </tr>
            </thead>
            <tbody>
              {view.parsed
                ? dispatchFleet(
                    view.parsed,
                    view.resources?.routes || [],
                    view.settings,
                  ).map((f) => (
                    <FleetRow
                      key={f.id}
                      fleet={f}
                      own={view
                        .parsed!.jobs.filter(
                          (j) => routeKey(j.ownerRoute) === f.id,
                        )
                        .reduce((n, j) => n + j.quantity, 0)}
                      disabled={view.busy || !editable}
                      onUpdate={fleetUpdate}
                    />
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </details>
      <div className="toolbar">
        <label>
          <span className="app-label">섭외할 임시차 실제 상차한도 (선택)</span>
          <input
            id="dispatch-temporary-capacity"
            type="number"
            min="1"
            step="any"
            className="app-input"
            placeholder="확인된 경우 입력"
            value={view.temporaryCapacity}
            disabled={view.busy || !editable}
            onChange={(e) =>
              update((s) => {
                if (s.temporaryCapacity === e.target.value) return;
                clearHistory();
                s.temporaryCapacity = e.target.value;
                if (s.plan) {
                  s.settingsDirty = true;
                  s.dirty = true;
                }
              })
            }
          />
        </label>
        {button('generate', '가배차 실행', generate, {
          primary: true,
          disabled:
            !view.parsed ||
            !view.model ||
            !view.resources ||
            view.resources.beforeDate !== view.parsed.date,
        })}
      </div>
      <p className="text-xs muted">
        실배차 대조 파일은 당일 추천 이력에 넣지 않습니다. 주행은 방향별 기록을
        사용하며, 여러 구간을 이은 경로와 연결 미확인을 구분합니다. 용차 검토
        묶음 수는 수배 차량 확정 대수가 아닙니다.
      </p>
      <div id="dispatch-summary" className="toolbar text-sm">
        {plan
          ? [
              `착지 ${new Set(plan.jobs.map((j) => j.sourceDestinationId || j.id)).size}개`,
              ...(plan.jobs.some((j) => j.sourceDestinationId)
                ? [`분할 포함 배정 ${plan.jobs.length}건`]
                : []),
              `총 ${fmt(plan.sourceQuantity)} 박스환산`,
              ...Object.keys(labels).map(
                (k) =>
                  labels[k] +
                  ' ' +
                  plan.groups.filter((g) => g.kind === k && g.jobIds.length)
                    .length +
                  '묶음',
              ),
            ].map((text) => (
              <span key={text} className="metric">
                {text}
              </span>
            ))
          : null}
      </div>
      <div className="toolbar">
        <label>
          <span className="app-label">착지 · 코드 · 코스 검색</span>
          <input
            id="dispatch-filter"
            className="app-input"
            disabled={view.busy}
            value={view.filter}
            onChange={(e) =>
              update((s) => {
                s.filter = e.target.value;
                s.routePage = 0;
              })
            }
          />
        </label>
        <label>
          <span className="app-label">배정 종류</span>
          <select
            id="dispatch-group-kind"
            className="app-select"
            disabled={view.busy}
            value={view.kind}
            onChange={(e) =>
              update((s) => {
                s.kind = e.target.value;
                s.routePage = 0;
              })
            }
          >
            <option value="">전체</option>
            {['fixed', 'temporary', 'external', 'review'].map((k) => (
              <option key={k} value={k}>
                {labels[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {plan ? (
        <div
          className="dispatch-view-controls"
          role="group"
          aria-label="배차 보기와 조정 기록"
        >
          <button
            type="button"
            className="btn btn-ghost"
            aria-pressed={layout === 'list'}
            onClick={() => setLayout('list')}
          >
            상세 목록
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-pressed={layout === 'board'}
            onClick={() => setLayout('board')}
          >
            차량 보드
          </button>
          <button
            id="dispatch-undo"
            type="button"
            className="btn btn-ghost"
            disabled={
              view.busy ||
              !editable ||
              view.settingsDirty ||
              view.verificationPending ||
              !history.current.past.length
            }
            onClick={() => historyStep('past')}
          >
            되돌리기
          </button>
          <button
            id="dispatch-redo"
            type="button"
            className="btn btn-ghost"
            disabled={
              view.busy ||
              !editable ||
              view.settingsDirty ||
              view.verificationPending ||
              !history.current.future.length
            }
            onClick={() => historyStep('future')}
          >
            다시 적용
          </button>
          <span className="text-xs muted">
            로컬 조정 최대 20단계 · 저장/기준 변경 시 초기화
          </span>
        </div>
      ) : null}
      {plan ? (
        <details className="dispatch-changes" id="dispatch-changes">
          <summary>
            {baseline.current.dirty ? '생성안' : '마지막 저장안'} 대비 변경{' '}
            {changes.length}건 · {view.dirty ? '저장 전' : '저장됨'}
          </summary>
          {changes.length ? (
            <ul>
              {changes.map((change, index) => (
                <li key={index}>{change}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs muted">착지 배정·순서·납품조건 조정 없음</p>
          )}
          {view.settingsDirty ? (
            <p className="issue">
              차량 또는 기준 조건 변경 · 가배차 재실행 필요
            </p>
          ) : null}
        </details>
      ) : null}
      <div className="toolbar">
        {button(
          'route-prev',
          '이전 묶음',
          () =>
            update((s) => {
              s.routePage = page - 1;
            }),
          { read: true, disabled: page <= 0 },
        )}
        <span id="dispatch-route-page" className="text-xs muted">
          {plan
            ? visibleGroups.length
              ? `${page * 10 + 1}–${Math.min((page + 1) * 10, visibleGroups.length)} / ${visibleGroups.length}묶음`
              : '해당 묶음 없음'
            : ''}
        </span>
        {button(
          'route-next',
          '다음 묶음',
          () =>
            update((s) => {
              s.routePage = page + 1;
            }),
          {
            read: true,
            disabled: !plan || (page + 1) * 10 >= visibleGroups.length,
          },
        )}
      </div>
      {plan && layout === 'board' ? (
        <DispatchBoard
          key={boardEpoch}
          plan={plan}
          focusedJobId={focusedJobId}
          onFocusJob={setFocusedJobId}
          addresses={view.resources?.addresses || []}
          groups={visibleGroups.slice(page * 10, (page + 1) * 10)}
          disabled={view.busy || saveBlocked}
          editable={editable}
          onEdit={edit}
          onReorder={reorder}
          onExport={(jobs) => {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(
              wb,
              XLSX.utils.json_to_sheet(
                jobs.map((job) => ({
                  착지: job.name,
                  원본코드: job.memberIds.join(' · '),
                  분할원본: job.sourceDestinationId || '',
                  코스:
                    plan.groups.find((group) => group.jobIds.includes(job.id))
                      ?.label || '',
                  물량: job.quantity,
                  단위: plan.quantityUnit,
                  주소: job.address,
                })),
              ),
              '선택 착지',
            );
            XLSX.writeFile(wb, `평택_${plan.date}_선택착지.xlsx`, {
              compression: true,
            });
          }}
        />
      ) : null}
      <div
        id="dispatch-board"
        className="dispatch-board"
        hidden={layout !== 'list'}
      >
        {visibleGroups.slice(page * 10, (page + 1) * 10).map((g) => {
          const issues = g.issues || [];
          return (
            <article key={g.id} className="dispatch-route">
              <h3 className="font-semibold">
                {g.label} · {labels[g.kind]} · {fmt(g.quantity)} 박스환산 /{' '}
                {g.jobIds.length}착지
              </h3>
              <p className="text-xs muted">
                {g.reason}
                {g.historicalEvidence
                  ? ` · 함께 ${g.historicalEvidence.same}/${g.historicalEvidence.total}일`
                  : ''}
              </p>
              <p className={'text-xs ' + (issues.length ? 'issue' : 'muted')}>
                {[
                  g.status,
                  '실제 상차한도 ' + fmt(g.capacity),
                  g.travel?.complete
                    ? '주행 ' +
                      fmt(g.travel.meters! / 1000) +
                      'km / ' +
                      fmt(g.travel.seconds! / 60) +
                      '분'
                    : '주행 연결 미확인',
                  g.travel?.sections.some((s) => s.status === 'composed')
                    ? '일부 실측구간 연결 경로'
                    : '',
                  issues.length ? '확인할 항목 ' + issues.length + '건' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <details hidden={!issues.length}>
                <summary>확인할 항목 {issues.length}건</summary>
                <ul>
                  {issues.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              </details>
              <div className="toolbar">
                {g.kind === 'temporary' || g.kind === 'review' ? (
                  <button
                    className="btn btn-ghost"
                    disabled={view.busy || !editable}
                    onClick={() => groupEdit(g)}
                  >
                    코스명·상차한도
                  </button>
                ) : null}
              </div>
              <div className="scroll">
                <table className="app-table">
                  <thead>
                    <tr>
                      {['착지 · 코드', '원래 호차', '물량', '주소', '조정'].map(
                        (h) => (
                          <th key={h}>{h}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {g.jobIds.map((id, i) => {
                      const j = plan!.jobs.find((j) => j.id === id)!;
                      return (
                        <tr
                          key={id}
                          className={
                            focusedJobId === id
                              ? 'dispatch-table-focused'
                              : undefined
                          }
                        >
                          <td>
                            <div>
                              <strong>
                                {j.name}
                                {j.sourceDestinationId ? ' · 분할 배정' : ''}
                              </strong>
                              <p className="text-xs muted">
                                {j.memberIds
                                  .map((id) =>
                                    id
                                      .replace(/^sajo:/, '사조 ')
                                      .replace(/^hansung:/, '한성 '),
                                  )
                                  .join(' · ')}
                              </p>
                            </div>
                          </td>
                          <td>{j.ownerRoute}</td>
                          <td>{fmt(j.quantity)}</td>
                          <td>{j.address || '주소 확인 필요'}</td>
                          <td>
                            <div>
                              <button
                                className="btn btn-ghost"
                                disabled={view.busy || !editable}
                                onClick={() => edit(j)}
                              >
                                이동·착지 확인
                              </button>
                              <button
                                className="btn btn-ghost"
                                disabled={view.busy}
                                onClick={() => {
                                  setFocusedJobId(j.id);
                                  setLayout('board');
                                }}
                              >
                                위치·원본 확인
                              </button>
                              <button
                                className="btn btn-ghost"
                                disabled={view.busy || !editable}
                                aria-label={`${j.name} 앞 순서로`}
                                onClick={() => reorder(g.id, i, -1)}
                              >
                                ↑
                              </button>
                              <button
                                className="btn btn-ghost"
                                disabled={view.busy || !editable}
                                aria-label={`${j.name} 뒤 순서로`}
                                onClick={() => reorder(g.id, i, 1)}
                              >
                                ↓
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          );
        })}
      </div>
      <details>
        <summary>이배송 후보</summary>
        <div id="dispatch-transfers" className="space-y-3 mt-3">
          {plan?.transferCandidates?.length
            ? plan.transferCandidates.map((c, i) => (
                <div key={i} className="toolbar">
                  <span>
                    {plan.jobs.find((j) => j.id === c.jobId)?.name} →{' '}
                    {plan.groups.find((g) => g.id === c.targetId)?.label} · 추가{' '}
                    {fmt(c.extraMinutes)}분 / 본인코스 대비 누적{' '}
                    {fmt(c.cumulativeExtraMinutes)}분 · 과거 지원{' '}
                    {c.historyDays}일 · {c.status}
                  </span>
                  <button
                    className="btn btn-ghost"
                    disabled={view.busy || !editable}
                    onClick={() => void task(() => transfer(c))}
                  >
                    이배송 후보 적용
                  </button>
                </div>
              ))
            : plan
              ? '실제 상차한도·허용 추가시간·주행 연결이 확인되면 이배송 후보를 표시합니다.'
              : null}
        </div>
      </details>
      <details>
        <summary>실배차와 비교 (선택)</summary>
        <FileArea
          accept=".xlsx"
          disabled={view.busy || !plan}
          onFiles={(files) => {
            if (files[0]) void task(() => actual(files[0]));
          }}
        >
          <label>
            <span className="app-label">당일 실배차 내역 대조 (선택)</span>
            <input
              id="dispatch-actual"
              type="file"
              accept=".xlsx"
              className="app-input"
              disabled={view.busy || !plan}
              onChange={(e) => {
                if (e.target.files?.[0])
                  void task(() => actual(e.target.files![0]));
              }}
            />
          </label>
        </FileArea>
        <div id="dispatch-comparison" className="mt-3">
          {view.comparison ? (
            <>
              <p>
                {view.comparison.scope} · CJ 미일치 실배차{' '}
                {view.comparison.unmatchedActual.length}코드/명
              </p>
              <div className="scroll">
                <table className="app-table">
                  <thead>
                    <tr>
                      {[
                        '착지',
                        'CJ 전체 물량',
                        '조정 기록에 해당하는 CJ 물량',
                        '실배차 물량',
                        '차이',
                        '원래 호차',
                        '실배차 코스',
                        '확인',
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.comparison.rows.map((r, i) => (
                      <tr key={i}>
                        {[
                          r.name,
                          fmt(r.sourceQuantity),
                          fmt(r.recordedSourceQuantity),
                          fmt(r.actualQuantity),
                          fmt(r.quantityDifference),
                          r.originalRoute,
                          r.actualCourses.join(', '),
                          r.status,
                        ].map((v, i) => (
                          <td key={i}>{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </details>
      <div className="toolbar">
        {button('save', '가배차 저장', save, {
          primary: true,
          disabled: saveBlocked,
        })}
        {button('export', '가배차 엑셀', exportExcel, {
          read: true,
          disabled: saveBlocked,
        })}
      </div>
      <details>
        <summary>자료 내보내기 · 주행 확인</summary>
        <div className="toolbar">
          {button(
            'json',
            '가배차 JSON',
            () =>
              download(
                new Blob([JSON.stringify(payload(), null, 2)], {
                  type: 'application/json',
                }),
                '평택_' + plan?.date + '_가배차.json',
              ),
            { read: true, disabled: saveBlocked },
          )}
          <a
            href="/admin/naver-shortest-distance.html?center=002"
            className="btn btn-ghost"
          >
            주행 구간 확인
          </a>
        </div>
      </details>
      <div className="toolbar">
        {button('list', '가배차 목록 조회', list, { read: true })}
        <label>
          <span className="app-label">내가 저장한 가배차</span>
          <select
            id="dispatch-drafts"
            className="app-select"
            disabled={view.busy}
            value={view.selectedDraft}
            onChange={(e) =>
              update((s) => {
                s.selectedDraft = e.target.value;
              })
            }
          >
            <option value="">
              {view.listed ? '저장한 가배차 선택' : '저장안 조회를 눌러 주세요'}
            </option>
            {view.drafts.map((row) => (
              <option key={row.id} value={row.id}>
                {row.business_date} · {row.updated_at.slice(0, 16)} · v
                {row.revision}
              </option>
            ))}
          </select>
        </label>
        {button('restore', '선택안 열기', restore, { read: true })}
      </div>
      <dialog
        ref={dialog}
        id="dispatch-edit-dialog"
        onCancel={() => setEditing(null)}
        onClose={() => setEditing(null)}
      >
        <form
          id="dispatch-edit-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            applyEdit();
          }}
        >
          <h3 id="dispatch-edit-title" className="font-semibold">
            {editingJob?.name}
          </h3>
          <p id="dispatch-edit-error" role="alert" className="issue">
            {editing?.error}
          </p>
          <label>
            <span className="app-label">실제 하차 주소</span>
            <input
              id="dispatch-edit-address"
              className="app-input"
              disabled={view.busy || !editable}
              value={editing?.address || ''}
              onChange={(e) =>
                setEditing((s) => (s ? { ...s, address: e.target.value } : s))
              }
            />
          </label>
          <div className="edit-grid">
            {(
              [
                ['earliest', '납품 시작 (당일)'],
                ['deadline', '납품 마감 (당일)'],
                ['unloadMinutes', '하차 소요 (분)'],
                ['inspectionMinutes', '검수 소요 (분)'],
                ['marginMinutes', '여유시간 (분)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <span className="app-label">{label}</span>
                <input
                  id={'dispatch-edit-' + key}
                  type={
                    key === 'earliest' || key === 'deadline' ? 'time' : 'number'
                  }
                  min={
                    key === 'earliest' || key === 'deadline' ? undefined : '0'
                  }
                  max={
                    key === 'earliest' || key === 'deadline'
                      ? undefined
                      : '1440'
                  }
                  step={
                    key === 'earliest' || key === 'deadline' ? undefined : 'any'
                  }
                  className="app-input"
                  disabled={view.busy || !editable}
                  value={editing?.[key] || ''}
                  onChange={(e) =>
                    setEditing((s) => (s ? { ...s, [key]: e.target.value } : s))
                  }
                />
              </label>
            ))}
          </div>
          <label>
            <span className="app-label">착지 전체를 보낼 코스</span>
            <select
              id="dispatch-edit-target"
              className="app-select"
              disabled={view.busy || !editable}
              value={editing?.target || ''}
              onChange={(e) =>
                setEditing((s) => (s ? { ...s, target: e.target.value } : s))
              }
            >
              {plan?.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label} / {g.kind}
                </option>
              ))}
              <option value="__new">새 용차 검토 묶음으로 분리</option>
            </select>
          </label>
          <label>
            <span className="app-label">
              확인한 동일 하차 단위로 합산 (선택)
            </span>
            <select
              id="dispatch-edit-merge"
              className="app-select"
              disabled={view.busy || !editable}
              value={editing?.merge || ''}
              onChange={(e) =>
                setEditing((s) => (s ? { ...s, merge: e.target.value } : s))
              }
            >
              <option value="">동일 하차 단위 합산 안 함</option>
              {plan?.jobs
                .filter(
                  (other) =>
                    editingJob &&
                    !editingJob.sourceDestinationId &&
                    !other.sourceDestinationId &&
                    other.id !== editingJob.id &&
                    routeKey(other.ownerRoute) ===
                      routeKey(editingJob.ownerRoute),
                )
                .map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name} · {other.address}
                  </option>
                ))}
            </select>
          </label>
          <p className="text-xs muted">
            동일 하차 단위로 합산하면 고객사별 코드를 한 차량에 함께 배정합니다.
            주소가 같아도 하차 장소가 다르면 합치지 마세요. 조건은 이 가배차에만
            적용됩니다.
          </p>
          <div className="toolbar">
            <button
              id="dispatch-edit-cancel"
              type="button"
              className="btn btn-ghost"
              disabled={view.busy || !editable}
              onClick={() => setEditing(null)}
            >
              취소
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={view.busy || !editable}
            >
              착지 조정 적용
            </button>
          </div>
        </form>
      </dialog>
      {feedback}
      {downloadLink}
    </section>
  );
}
