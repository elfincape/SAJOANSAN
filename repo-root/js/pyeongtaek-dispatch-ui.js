import { requireAuth } from './auth.js';
import { supabase } from './supabase.js';
import { menuPermissions } from './menu-permissions.js';
import { permissionAllowed } from './portal-permissions.js';
import { getSelectedCenter } from './center.js';
import {
  readWorkbook,
  suggestMapping,
  mapRows,
  dispatchRowVersion,
  loadDispatchContext,
  listDrafts,
  loadDraft,
  saveDraft,
} from './pyeongtaek-dispatch-data.js';
import {
  DEFAULT_SETTINGS,
  createDraft,
  prepareStops,
  recalculateDraft,
} from './pyeongtaek-dispatch-model.js';
import './exceljs-global.js';
import { createProfilesUI } from './pyeongtaek-dispatch-profiles-ui.js';
import { createRelationsUI } from './naver-relations-ui.js';

const $ = (id) => document.getElementById('pd-' + id);
const clone = (value) => structuredClone(value);
let relations;
const state = {
  date: new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()),
  stage: 0,
  editable: false,
  ready: false,
  busy: false,
  dirty: false,
  needsRegeneration: false,
  rows: [],
  drivers: [],
  context: { addresses: [], legs: [], destinations: [], issues: [] },
  settings: clone(DEFAULT_SETTINGS),
  draft: null,
  book: null,
  file: null,
  preview: null,
  id: null,
  revision: 0,
  history: [],
  routeId: null,
};
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
const number = (value) =>
  Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const printable = (value) =>
  value == null
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
const otdLabel = (value) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.map((condition) => printable(condition.raw)).filter(Boolean),
        ),
      ].join(' · ') || '시간 제약 없음'
    : printable(value);
function overrideIdentity(record, key, value) {
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
const time = (value) =>
  value
    ? new Date(value).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '미산정';
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = printable(text);
  if (className) el.className = className;
  return el;
}
function message(text, error = false) {
  $('status').textContent = text;
  $('status').dataset.error = String(error);
}
function issues(host, values = []) {
  host.replaceChildren();
  if (!values.length) return;
  const list = node('ul');
  for (const item of values)
    list.append(
      node(
        'li',
        typeof item === 'string'
          ? item
          : [item.row ? '행 ' + item.row : '', item.message || item.code]
              .filter(Boolean)
              .join(' · '),
      ),
    );
  host.append(list);
}
function table(host, headers, rows) {
  const el = node('table'),
    head = node('thead'),
    tr = node('tr'),
    body = node('tbody');
  for (const h of headers) tr.append(node('th', h));
  head.append(tr);
  el.append(head, body);
  for (const values of rows) {
    const row = node('tr');
    for (const value of values) {
      const cell = node('td');
      cell.append(value instanceof Node ? value : node('span', value));
      row.append(cell);
    }
    body.append(row);
  }
  host.replaceChildren(el);
  if (!rows.length) host.append(node('p', '자료가 없습니다.', 'pd-muted'));
}
function button(text, fn, { edit = false, title } = {}) {
  const el = node('button', text, 'btn btn-ghost');
  el.type = 'button';
  if (edit) el.dataset.edit = '';
  if (title) {
    el.title = title;
    el.setAttribute('aria-label', title);
    el.className = 'pd-icon';
  }
  el.onclick = () => run(fn, { edit });
  return el;
}
function input(
  value,
  onChange,
  { type = 'text', min, max, step, edit = true, label } = {},
) {
  const el = node('input');
  el.type = type;
  if (type === 'checkbox') el.checked = Boolean(value);
  else el.value = value ?? '';
  if (min != null) el.min = min;
  if (max != null) el.max = max;
  if (step != null) el.step = step;
  if (edit) el.dataset.edit = '';
  if (label) el.setAttribute('aria-label', label);
  el.onchange = () =>
    run(
      () =>
        onChange(
          type === 'checkbox'
            ? el.checked
            : type === 'number'
              ? el.value === ''
                ? null
                : Number(el.value)
              : el.value,
        ),
      { edit },
    );
  return el;
}
function select(options, value, onChange, { edit = true, label } = {}) {
  const el = node('select');
  for (const [key, text] of options) {
    const option = node('option', text);
    option.value = key;
    el.append(option);
  }
  el.value = value ?? '';
  if (edit) el.dataset.edit = '';
  if (label) el.setAttribute('aria-label', label);
  el.onchange = () => run(() => onChange(el.value), { edit });
  return el;
}
function field(host, title, control) {
  const label = node('label', title);
  label.append(control);
  host.append(label);
}
function mutable() {
  if (!state.ready || !state.editable || getSelectedCenter()?.code !== '002')
    throw Error('평택 가배차 수정 권한이 없습니다.');
}
function touch(reason) {
  state.dirty = true;
  if (reason) state.history.push({ at: new Date().toISOString(), reason });
  controls();
}
function discard() {
  return (
    !(state.dirty || profiles.isDirty()) ||
    confirm('저장하지 않은 변경사항을 버리시겠습니까?')
  );
}
function controls() {
  for (const el of $('work').querySelectorAll('button,input,select,textarea')) {
    if (el.closest('#pd-profiles-panel,#relations-panel')) continue;
    el.disabled =
      state.busy ||
      !state.ready ||
      (el.hasAttribute('data-edit') && !state.editable);
  }
  profiles.controls();
  relations?.setBlocked(state.busy || !state.ready);
  $('date').disabled = state.busy || !state.ready;
  for (const id of [
    'save',
    'save-copy',
    'export',
    'recalculate',
    'refresh',
    'add-route',
  ])
    $(id).disabled ||= !state.draft;
  $('delete-route').hidden = !state.draft?.routes.some(
    (route) => route.id === state.routeId && route.type === 'temporary',
  );
  $('delete-route').disabled ||= $('delete-route').hidden;
  $('create').disabled ||= !state.rows.length;
  $('import').disabled ||= !state.preview?.rows?.length;
  $('preview').disabled ||= !state.book;
  $('save').disabled ||= state.needsRegeneration;
  $('save-copy').disabled ||= state.needsRegeneration;
  $('regeneration').hidden = !state.needsRegeneration;
  $('stop-query').disabled = false;
  $('state').textContent =
    state.dirty || profiles.isDirty()
      ? '진행 중 · 미저장'
      : state.id
        ? '저장됨'
        : state.draft
          ? state.draft.issues?.length
            ? '확인 필요'
            : '초안 생성됨'
          : '진행 중';
  $('app')?.setAttribute('aria-busy', String(state.busy));
}
async function run(fn, { edit = false } = {}) {
  if (state.busy) return;
  try {
    if (edit) mutable();
    state.busy = true;
    controls();
    message('처리 중');
    await fn();
  } catch (error) {
    message(
      error?.code === 'PT409' || error?.code === 'DISPATCH_CONFLICT'
        ? '다른 변경사항과 충돌했습니다. 새 스냅샷으로 저장하거나 저장 목록에서 최신 버전을 확인하세요.'
        : error.message || '처리에 실패했습니다.',
      true,
    );
  } finally {
    state.busy = false;
    controls();
  }
}
function stage(value) {
  state.stage = Math.max(0, Math.min(4, value));
  document
    .querySelectorAll('[data-panel]')
    .forEach((el) => (el.hidden = Number(el.dataset.panel) !== state.stage));
  document.querySelectorAll('[data-stage]').forEach((el) => {
    if (Number(el.dataset.stage) === state.stage)
      el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
  });
  $('back').hidden = state.stage === 0;
  $('next').hidden = state.stage === 4;
  render();
}
function totals() {
  const d = state.draft;
  const ids = d ? d.routes.flatMap((r) => r.stopIds).concat(d.unassigned) : [];
  const valid =
    d &&
    ids.length === d.stops.length &&
    new Set(ids).size === d.stops.length &&
    d.stops.every((s) => ids.includes(s.id));
  $('totals').textContent =
    `선택일 ${state.date} · 원본 ${number(state.rows.length)}행 · 원본 ${number(state.rows.reduce((sum, r) => sum + Number(r.boxes || 0), 0))}박스` +
    (d
      ? ` · 실제 착지 ${number(d.stops.length)}개 · 반올림 ${number(d.stops.reduce((sum, s) => sum + Number(s.boxes || 0), 0))}박스 · 미배정 ${number(d.unassigned.length)}개 · 착지 대조 ${valid ? '일치' : '불일치'}`
      : '');
}
function render() {
  totals();
  renderDrivers();
  renderDraft();
  renderDetails();
  $('history').replaceChildren(
    ...state.history.map((h) => node('p', time(h.at) + ' · ' + h.reason)),
  );
  $('saved-info').textContent = state.id
    ? `${state.date} 저장본 · 버전 ${state.revision}`
    : '저장된 버전 없음';
  controls();
}
function mapping() {
  const result = { headerRow: Number($('header').value) - 1 };
  for (const key of Object.keys(fields))
    result[key] = Number($('map-' + key).value);
  return result;
}
function sheet() {
  return state.book?.sheets[Number($('sheet').value) || 0];
}
function setupMapping() {
  const s = sheet();
  if (!s) return;
  const guess = suggestMapping(s.rows);
  $('header').value = (guess.headerRow ?? 0) + 1;
  const count = Math.max(0, ...s.rows.slice(0, 30).map((r) => r.length));
  $('mapping').replaceChildren();
  for (const [key, label] of Object.entries(fields)) {
    const options = [
      [-1, '선택 안 함'],
      ...Array.from({ length: count }, (_, i) => [
        i,
        `${i + 1}열 · ${printable(s.rows[guess.headerRow]?.[i]).slice(0, 60)}`,
      ]),
    ];
    const el = select(options, guess[key] ?? -1, () => {
      state.preview = null;
      controls();
    });
    el.id = 'pd-map-' + key;
    field($('mapping'), label, el);
  }
  state.preview = null;
  $('preview-table').replaceChildren();
  $('preview-count').textContent = '';
  controls();
}
function preview() {
  const m = mapping();
  if (
    !Number.isInteger(m.headerRow) ||
    m.headerRow < 0 ||
    m.headerRow >= sheet().rows.length
  )
    throw Error('제목 행을 확인해 주세요.');
  for (const key of ['course', 'customer', 'name', 'address', 'boxes'])
    if (m[key] < 0) throw Error(fields[key] + ' 열을 선택해 주세요.');
  const used = Object.keys(fields)
    .map((k) => m[k])
    .filter((v) => v >= 0);
  if (new Set(used).size !== used.length)
    throw Error('같은 열을 여러 항목에 연결할 수 없습니다.');
  const result = mapRows(sheet().rows, m, {
    fileName: state.file.name,
    sheetName: sheet().name,
    date: state.date,
  });
  const included = result.rows.filter((r) => r.date === state.date);
  const excluded = result.rows.filter((r) => r.date !== state.date);
  const ids = new Set(included.map((r) => r.id));
  const rowNumbers = new Set(included.map((r) => r.source?.row));
  const relevant = (result.issues || []).filter((i) =>
    i.rowId ? ids.has(i.rowId) : i.row ? rowNumbers.has(i.row) : true,
  );
  state.preview = { rows: included, issues: relevant };
  issues($('import-issues'), result.issues);
  $('preview-count').textContent =
    `선택일 ${included.length}행 · 다른 날짜/날짜 미확인 제외 ${excluded.length}행 · ${m.date < 0 ? '날짜 열 없음: 기준일 적용' : '원본 날짜 기준 필터'} · 미리보기 최대 100행`;
  table(
    $('preview-table'),
    ['반영', '원본행', '날짜', ...Object.values(fields).slice(1)],
    result.rows.slice(0, 100).map((r) => [
      r.date === state.date ? '반영' : '제외',
      r.source.row,
      r.date,
      ...Object.keys(fields)
        .slice(1)
        .map((k) => printable(r[k])),
    ]),
  );
  message('선택일 미리보기 완료');
}
function importKeys(row) {
  const source = row.source || {};
  const version = dispatchRowVersion(row);
  return [
    ['file', source.file],
    ['signature', source.signature],
    ['contentSignature', source.contentSignature],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([kind, value]) =>
      JSON.stringify([kind, value, source.sheet, source.row, version]),
    );
}
function importRows() {
  if (!state.preview) throw Error('미리보기를 먼저 확인해 주세요.');
  if (state.preview.issues.some((i) => i.severity === 'error'))
    throw Error('선택일 원본 오류를 수정한 후 다시 가져와 주세요.');
  if (state.draft && !confirm('기존 초안을 비우고 물량을 추가하시겠습니까?'))
    return;
  const seen = new Set(state.rows.flatMap(importKeys));
  const added = state.preview.rows.filter((row) => {
    const keys = importKeys(row);
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
  state.rows.push(...clone(added));
  state.draft = null;
  touch('원본 ' + added.length + '행 반영');
  table(
    $('source-table'),
    ['파일', '시트', '행', '날짜', '코스', '고객사', '착지', '주소', '박스'],
    state.rows.map((r) => [
      r.source.file,
      r.source.sheet,
      r.source.row,
      r.date,
      r.course,
      r.customer,
      r.name,
      r.address,
      r.boxes,
    ]),
  );
  render();
  message(
    `${added.length}행 반영 · 중복 ${state.preview.rows.length - added.length}행 제외`,
  );
}
async function context({ replaceDrivers = false } = {}) {
  const next = await loadDispatchContext(supabase);
  state.context = next;
  profiles.renderList();
  relations?.refreshDestinations();
  if (replaceDrivers) state.drivers = clone(next.drivers);
  issues($('context-issues'), next.issues);
  render();
  message(
    next.issues?.length
      ? '기준자료 권한·조회 확인 필요'
      : '평택 기준자료를 불러왔습니다.',
  );
}
function renderDrivers() {
  table(
    $('drivers'),
    ['운행 가능', '원래 코스', '기사', '차량번호', '톤수', 'CJ 기준량'],
    state.drivers.map((d) => [
      input(
        d.available !== false,
        (v) => {
          d.available = v;
          driverChanged();
        },
        { type: 'checkbox', label: d.course + ' 운행 가능' },
      ),
      d.course,
      input(
        d.driverName,
        (v) => {
          overrideIdentity(d, 'driverName', v);
          driverChanged();
        },
        { label: '당일 기사' },
      ),
      input(
        d.vehicleNumber,
        (v) => {
          overrideIdentity(d, 'vehicleNumber', v);
          driverChanged();
        },
        { label: '당일 차량번호' },
      ),
      input(
        d.tons,
        (v) => {
          d.tons = v;
          d.capacity = state.settings.capacities?.[String(v)] ?? null;
          driverChanged();
        },
        { type: 'number', min: 1, step: 0.5, label: '차량 톤수' },
      ),
      input(
        d.capacity,
        (v) => {
          if (v != null && v <= 0) throw Error('기준량은 양수여야 합니다.');
          d.capacity = v;
          driverChanged();
        },
        { type: 'number', min: 1, step: 1, label: '확인된 CJ 기준량' },
      ),
    ]),
  );
  $('settings').replaceChildren();
  for (const [key, label] of Object.entries({
    origin: '센터 출발지',
    prepareMinutes: '센터 준비(분)',
    yardMinutes: '야적(분)',
    attendedMinutes: '대면납(분)',
    inspectionMinutes: '검수 추가(분)',
    marginMinutes: '도착 여유(분)',
    maxStops: '임시차 최대 착지',
    freshnessMinutes: '구간 신선도(분)',
  })) {
    field(
      $('settings'),
      label,
      input(
        state.settings[key],
        (v) => {
          if (key === 'maxStops' && (!Number.isInteger(v) || v < 1 || v > 5)) {
            renderDrivers();
            throw Error('임시차 최대 착지는 1~5 사이의 정수로 입력해 주세요.');
          }
          if (
            key !== 'origin' &&
            (!Number.isFinite(v) || v < 0 || (key === 'maxStops' && v < 1))
          )
            throw Error('설정값을 확인해 주세요.');
          state.settings[key] = v;
          driverChanged();
        },
        {
          type: key === 'origin' ? 'text' : 'number',
          min: key === 'maxStops' ? 1 : 0,
          max: key === 'maxStops' ? 5 : undefined,
          step: 1,
        },
      ),
    );
  }
}
function driverChanged() {
  state.draft = null;
  touch('당일 기사·배차 조건 변경');
  render();
  message('당일 조건 변경됨 · 초안을 다시 생성해 주세요.');
}
async function generate() {
  if (profiles.isDirty())
    throw Error(
      '납품정보 수정사항을 먼저 저장하거나 취소해 주세요. 파일 미리보기도 DB 저장 또는 파일 비우기가 필요합니다.',
    );
  if (
    state.context.issues?.length &&
    !confirm(
      '기준자료에 확인 필요 항목이 있습니다. 표시된 누락·권한 문제를 확인했으며 계속 진행하시겠습니까?',
    )
  )
    return;
  if (
    state.draft &&
    !confirm('현재 조정 내용을 버리고 초안을 다시 생성하시겠습니까?')
  )
    return;
  await new Promise((resolve) => setTimeout(resolve, 30));
  state.draft = createDraft({
    ...state.context,
    rows: clone(state.rows),
    drivers: clone(state.drivers),
    date: state.date,
    settings: {
      ...clone(state.settings),
      evaluatedAt: new Date().toISOString(),
    },
  });
  state.routeId = state.draft.routes[0]?.id;
  state.needsRegeneration = false;
  touch('가배차 초안 생성');
  stage(2);
  message('초안 생성됨 · 확인 필요 항목을 검토해 주세요.');
}
function routeLabel(r) {
  const ordinal =
    (state.draft?.routes || [])
      .filter((route) => route.type === r.type)
      .findIndex((route) => route.id === r.id) + 1;
  return [
    r.type === 'fixed' ? r.course || '고정차 ' + ordinal : '임시차 ' + ordinal,
    r.driverName,
    r.vehicleNumber,
  ]
    .filter(Boolean)
    .join(' · ');
}
function stop(id) {
  return state.draft?.stops.find((s) => s.id === id);
}
function routeIssues(r) {
  return [...(r.issues || []), ...(r.warnings || [])]
    .map((i) => i.message || i.code || i)
    .join(' · ');
}
function renderDraft() {
  const d = state.draft;
  issues(
    $('draft-issues'),
    (d?.issues || []).filter((issue) => issue.code !== 'bounded_optimization'),
  );
  for (const type of ['fixed', 'temporary'])
    table(
      $(type),
      [
        '코스·차량',
        '톤수 / 기준량',
        '착지',
        '박스',
        '센터 입차',
        '권장 출발',
        '시간 상태',
        '확인 필요',
        '상세',
      ],
      (d?.routes || [])
        .filter((r) => r.type === type)
        .map((r) => [
          routeLabel(r),
          `${r.tons ?? '미확인'}t / ${r.capacity ?? '미확인'}`,
          r.stopIds.length,
          number(
            r.boxes ??
              r.stopIds.reduce(
                (sum, id) => sum + Number(stop(id)?.boxes || 0),
                0,
              ),
          ),
          time(r.centerEntryTime),
          time(r.departureTime),
          {
            estimated: '조회 시점 추정',
            unknown: '미산정',
            infeasible: '조건 충돌',
            unconstrained: '시간 제약 없음',
          }[r.timeStatus] || '미산정',
          routeIssues(r),
          button('상세', () => {
            state.routeId = r.id;
            stage(3);
          }),
        ]),
    );
  table(
    $('unassigned'),
    ['착지', '주소', '원래 코스', '고객사', '박스', 'OTD', '확인 필요'],
    (d?.unassigned || []).map((id) => {
      const s = stop(id);
      return [
        s?.name,
        s?.address,
        printable(s?.courses),
        printable(s?.customers),
        s?.boxes,
        otdLabel(s?.otd),
        (s?.issues || []).map((i) => i.message || i.code).join(' · '),
      ];
    }),
  );
}
function recalc(reason) {
  state.draft.settings.evaluatedAt = new Date().toISOString();
  state.draft = recalculateDraft(state.draft, {
    addresses: state.context.addresses,
    legs: state.context.legs,
  });
  touch(reason);
  render();
  message('조정 및 시간 재계산 완료');
}
function moveStop(id, target) {
  for (const r of state.draft.routes)
    r.stopIds = r.stopIds.filter((v) => v !== id);
  state.draft.unassigned = state.draft.unassigned.filter((v) => v !== id);
  if (target === '') state.draft.unassigned.push(id);
  else state.draft.routes.find((r) => r.id === target).stopIds.push(id);
  recalc('착지 배정 변경: ' + stop(id)?.name);
}
function deleteTemporaryRoute() {
  const route = state.draft?.routes.find((route) => route.id === state.routeId);
  if (!route || route.type !== 'temporary')
    throw Error('임시차만 삭제할 수 있습니다.');
  if (
    !confirm(
      `${routeLabel(route)}를 삭제하고 착지 ${route.stopIds.length}개를 모두 미배정으로 옮기시겠습니까?`,
    )
  )
    return;
  const label = routeLabel(route);
  state.draft.unassigned = [
    ...new Set([...state.draft.unassigned, ...route.stopIds]),
  ];
  state.draft.routes = state.draft.routes.filter(
    (item) => item.id !== route.id,
  );
  state.routeId = state.draft.routes[0]?.id ?? null;
  recalc(`${label} 삭제 · ${route.stopIds.length}개 착지 미배정 이동`);
}
function moveSelect(id, current) {
  return select(
    [['', '미배정'], ...state.draft.routes.map((r) => [r.id, routeLabel(r)])],
    current,
    (target) => moveStop(id, target),
    { label: stop(id)?.name + ' 배정 차량' },
  );
}
function renderDetails() {
  const d = state.draft;
  $('route').replaceChildren();
  $('route-fields').replaceChildren();
  $('stops').replaceChildren();
  $('move-unassigned').replaceChildren();
  $('legs').replaceChildren();
  if (!d) return;
  if (!d.routes.some((r) => r.id === state.routeId))
    state.routeId = d.routes[0]?.id;
  for (const r of d.routes) {
    const option = node('option', routeLabel(r));
    option.value = r.id;
    $('route').append(option);
  }
  $('route').value = state.routeId ?? '';
  const r = d.routes.find((r) => r.id === state.routeId);
  if (r) {
    for (const [key, label] of Object.entries({
      driverName: '당일 기사',
      vehicleNumber: '차량번호',
      tons: '톤수',
      capacity: '확인된 CJ 기준량',
    }))
      field(
        $('route-fields'),
        label,
        input(
          r[key],
          (v) => {
            if (
              ['tons', 'capacity'].includes(key) &&
              (!Number.isFinite(v) || v <= 0)
            )
              throw Error('확인된 양수를 입력해 주세요.');
            overrideIdentity(r, key, v);
            if (key === 'tons')
              r.capacity = d.settings.capacities?.[String(v)] ?? null;
            recalc('차량 조건 변경');
          },
          {
            type: ['tons', 'capacity'].includes(key) ? 'number' : 'text',
            min: 0.5,
            step: key === 'tons' ? 0.5 : 1,
          },
        ),
      );
    if (r.type === 'fixed')
      field(
        $('route-fields'),
        '이배송 · 협의 필요',
        input(
          r.interdelivery,
          (v) => {
            r.interdelivery = v;
            recalc('이배송 ' + (v ? '선택 · 협의 필요' : '해제'));
          },
          { type: 'checkbox' },
        ),
      );
    table(
      $('stops'),
      [
        '순서',
        '착지 / 원래 코스',
        '주소 / 고객사',
        '박스',
        'OTD / 납품 방식',
        '도착 / 대기',
        '서비스(분)',
        '여유(분)',
        '이동',
      ],
      r.stopIds.map((id, index) => {
        const s = stop(id);
        const order = node('div');
        order.append(node('span', String(index + 1) + ' '));
        for (const [delta, symbol, label] of [
          [-1, '↑', '위로 이동'],
          [1, '↓', '아래로 이동'],
        ]) {
          const b = button(
            symbol,
            () => {
              const other = index + delta;
              if (other < 0 || other >= r.stopIds.length) return;
              [r.stopIds[index], r.stopIds[other]] = [
                r.stopIds[other],
                r.stopIds[index],
              ];
              recalc('배송 순서 변경');
            },
            { edit: true, title: label },
          );
          order.append(b);
        }
        const timing = r.schedule?.find((t) => t.stopId === id);
        return [
          order,
          `${s.name} / ${(s.courses || []).join(', ')}`,
          `${s.address} / ${(s.customers || []).join(', ')}`,
          s.boxes,
          otdLabel(s.otd) + ' / ' + printable(s.mode),
          time(timing?.arrivalTime) +
            ' / ' +
            number(timing?.waitingMinutes) +
            '분',
          input(
            s.serviceMinutes,
            (v) => {
              if (!Number.isFinite(v) || v < 0)
                throw Error('서비스 시간을 확인해 주세요.');
              s.serviceMinutes = v;
              recalc('서비스 시간 변경');
            },
            { type: 'number', min: 0, step: 1, label: s.name + ' 서비스 시간' },
          ),
          input(
            s.marginMinutes,
            (v) => {
              if (!Number.isFinite(v) || v < 0)
                throw Error('여유 시간을 확인해 주세요.');
              s.marginMinutes = v;
              recalc('도착 여유 변경');
            },
            { type: 'number', min: 0, step: 1, label: s.name + ' 도착 여유' },
          ),
          moveSelect(id, r.id),
        ];
      }),
    );
  }
  table(
    $('move-unassigned'),
    ['착지', '주소', '박스', '배정 차량'],
    d.unassigned.map((id) => [
      stop(id)?.name,
      stop(id)?.address,
      stop(id)?.boxes,
      moveSelect(id, ''),
    ]),
  );
  const pairs = [];
  for (const route of d.routes) {
    let from = d.settings.origin || d.settings.originAddress;
    for (const [index, id] of route.stopIds.entries()) {
      const origin = from,
        to = stop(id)?.address,
        leg = route.usedLegs?.[index];
      const measured = leg?.measured_at;
      const old =
        !measured ||
        Date.now() - Date.parse(measured) > d.settings.freshnessMinutes * 60000;
      pairs.push([
        routeLabel(route),
        origin,
        to,
        leg && !leg.missing
          ? number(Number(leg.duration_seconds) / 60) + '분'
          : '미조회',
        measured ? time(measured) : '미조회',
        !leg || leg.missing
          ? '구간 누락'
          : old
            ? '오래된 추정'
            : '조회 시점 추정',
        button('주소 선택', () => {
          $('pair-from').value = origin;
          $('pair-to').value = to;
          message('단일 구간 주소 선택됨');
        }),
      ]);
      from = to;
    }
  }
  table(
    $('legs'),
    ['코스', '출발', '도착', '이동시간', '측정 시각', '상태', '단일 조회'],
    pairs,
  );
}
async function refreshLegs() {
  const c = await loadDispatchContext(supabase);
  state.context.addresses = c.addresses;
  state.context.legs = c.legs;
  state.context.issues = c.issues;
  issues($('context-issues'), c.issues);
  if (state.draft) recalc('저장 구간 갱신');
}
let queryStopped = false,
  queryJob = null;
async function relationCall(action, args = {}) {
  const { data, error } = await supabase.functions.invoke('naver-relations', {
    body: { ...args, center: '002', action },
  });
  if (error) {
    let text = error.message;
    try {
      text = (await error.context.json()).error || text;
    } catch {}
    throw Error(text || '구간 조회 실패');
  }
  if (data?.error && !data.id) throw Error(data.error);
  return data;
}
async function queryPair() {
  const permissions = await menuPermissions(true);
  if (!permissionAllowed(permissions, 'delivery_points', 'edit', '002'))
    throw Error('도로 구간 조회에는 평택 납품처 수정 권한이 필요합니다.');
  const from = $('pair-from').value.trim(),
    to = $('pair-to').value.trim();
  if (!from || !to || from === to)
    throw Error('서로 다른 출발·도착 주소를 입력해 주세요.');
  if (
    !confirm(
      '네이버 도로·주소 API 요청이 발생할 수 있습니다. 계정 무료 잔여량은 확인되지 않았습니다. 이 단일 구간을 조회하시겠습니까?',
    )
  )
    return;
  queryStopped = false;
  $('stop-query').hidden = false;
  try {
    let job = await relationCall('create', {
      kind: 'single',
      origin: from,
      rows: [{ address: to, source: 'dispatch-manual', sourceRow: 1 }],
      limit: 1,
      directionsBudget: 3,
    });
    queryJob = job.id;
    let batches = 0;
    while (!queryStopped && ['queued', 'running'].includes(job.status)) {
      if (++batches > 120)
        throw Error(
          '구간 조회 대기 시간이 초과되었습니다. 수집기에서 작업을 확인하세요.',
        );
      message('단일 구간 조회 중');
      job = await relationCall('batch', { jobId: job.id });
      await new Promise((resolve) =>
        setTimeout(resolve, job.busy ? 2000 : 250),
      );
    }
    await refreshLegs();
    const result = job.lastResults?.at(-1);
    message(
      queryStopped
        ? '조회 중지됨 · 저장된 구간 반영'
        : result?.error ||
            job.error ||
            '단일 구간 조회 완료 · 현재 초안 재계산',
      Boolean(result?.error || job.error),
    );
  } finally {
    queryJob = null;
    $('stop-query').hidden = true;
  }
}
function payload() {
  const legs = [
    ...new Map(
      state.draft.routes
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
          l,
        ]),
    ).values(),
  ];
  const ids = new Set(
    legs.flatMap((l) => [String(l.from_id), String(l.to_id)]),
  );
  const names = new Set(
    [
      state.draft.settings.origin || state.draft.settings.originAddress,
      ...state.draft.stops.flatMap((s) => s.addresses || [s.address]),
    ].map((v) =>
      String(v || '')
        .normalize('NFKC')
        .trim(),
    ),
  );
  const addresses = state.context.addresses.filter(
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
    date: state.date,
    rows: clone(state.rows),
    drivers: clone(state.drivers),
    draft: clone(state.draft),
    settings: clone(state.settings),
    context: { addresses: clone(addresses), legs: clone(legs) },
    history: clone(state.history),
    reason: $('reason').value,
  };
}
async function save(copy = false) {
  if (state.needsRegeneration)
    throw Error('납품정보 DB 변경 후 초안을 다시 생성해 주세요.');
  if (!state.draft) throw Error('저장할 초안이 없습니다.');
  const result = await saveDraft(supabase, {
    ...(copy ? {} : state.id ? { id: state.id } : {}),
    date: state.date,
    payload: payload(),
    revision: copy ? 0 : state.revision,
  });
  state.id = result.id;
  state.revision = result.revision;
  state.dirty = false;
  render();
  await snapshots();
  message('초안 저장 완료 · 실제 배차 확정 아님');
}
async function snapshots() {
  const list = await listDrafts(supabase, state.date);
  table(
    $('snapshots'),
    ['기준일', '버전', '수정 시각', '불러오기'],
    list.map((item) => [
      item.date,
      item.revision,
      time(item.updatedAt),
      button('불러오기', () => restore(item.id)),
    ]),
  );
  message('저장 목록 ' + list.length + '건');
}
async function restore(id) {
  if (!discard()) return;
  const value = await loadDraft(supabase, id);
  if (!value?.payload?.draft) throw Error('저장된 초안을 찾을 수 없습니다.');
  if (value.date !== state.date)
    throw Error('현재 기준일과 저장된 초안 날짜가 다릅니다.');
  const p = value.payload;
  if (p.center && p.center !== '002')
    throw Error('평택 초안만 열 수 있습니다.');
  state.rows = clone(p.rows || []);
  profiles.reset();
  state.needsRegeneration = restoredProfilesChanged(p);
  state.drivers = clone(p.drivers || []);
  state.draft = clone(p.draft);
  state.settings = clone(p.settings || p.draft.settings);
  if (p.context)
    state.context = {
      ...state.context,
      ...clone(p.context),
      destinations: state.context.destinations,
    };
  state.history = clone(p.history || []);
  state.id = value.id;
  state.revision = value.revision;
  state.dirty = false;
  $('reason').value = p.reason || '';
  stage(2);
  message(
    state.needsRegeneration
      ? '저장 당시 초안을 불러왔습니다. 납품정보 DB가 달라 초안 재생성 후 저장할 수 있습니다.'
      : '저장 당시 초안을 불러왔습니다.',
  );
}
function restoredProfilesChanged(payload) {
  const signature = (stops) =>
    JSON.stringify(
      stops
        .map((stop) => [
          stop.id,
          (stop.deliveryProfiles || [])
            .filter((entry) => entry.profile)
            .map((entry) => [
              String(entry.destinationId),
              ...[
                'revision',
                'otd',
                'mode',
                'unloadMinutes',
                'inspectionMinutes',
                'marginMinutes',
                'notes',
                'updatedAt',
              ].map((key) => entry.profile[key] ?? null),
            ])
            .sort(([a], [b]) => a.localeCompare(b)),
        ])
        .filter(([, entries]) => entries.length)
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  const current = prepareStops(payload.rows || [], state.context.destinations, {
    date: state.date,
    addresses: state.context.addresses,
  });
  const grouping = (stops) => JSON.stringify(stops.map((stop) =>
    (stop.sourceRows || []).map((row) => JSON.stringify([row.id, row.address, row.source])).sort(),
  ).map((rows) => JSON.stringify(rows)).sort());
  return grouping(payload.draft.stops || []) !== grouping(current.stops) ||
    signature(payload.draft.stops || []) !== signature(current.stops);
}
async function exportExcel() {
  if (!state.draft) throw Error('출력할 초안이 없습니다.');
  const wb = new globalThis.ExcelJS.Workbook();
  const add = (name, headers, rows) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(headers);
    for (const row of rows)
      ws.addRow(
        row.map((v) => (typeof v === 'object' ? printable(v) : (v ?? ''))),
      );
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => (c.width = 24));
  };
  const d = state.draft;
  add(
    '배정 초안',
    [
      '기준일',
      '유형',
      '코스',
      '기사',
      '차량',
      '톤수',
      'CJ 기준량',
      '순서',
      '착지',
      '주소',
      '박스',
      '원래 코스',
      '고객사',
      'OTD',
      '서비스 분',
      '여유 분',
      '도착 추정',
      '센터 입차',
      '센터 출발',
      '이배송',
      '확인 필요',
    ],
    d.routes.flatMap((r) =>
      r.stopIds.map((id, i) => {
        const s = stop(id);
        return [
          state.date,
          r.type === 'fixed' ? '고정' : '임시',
          r.course,
          r.driverName,
          r.vehicleNumber,
          r.tons,
          r.capacity,
          i + 1,
          s.name,
          s.address,
          s.boxes,
          s.courses,
          s.customers,
          s.otd,
          s.serviceMinutes,
          s.marginMinutes,
          time(r.schedule?.find((t) => t.stopId === id)?.arrivalTime),
          time(r.centerEntryTime),
          time(r.departureTime),
          r.interdelivery ? '협의 필요' : '없음',
          routeIssues(r),
        ];
      }),
    ),
  );
  add(
    '미배정',
    ['착지', '주소', '박스', '원래 코스', 'OTD', '확인 필요'],
    d.unassigned.map((id) => {
      const s = stop(id);
      return [s.name, s.address, s.boxes, s.courses, s.otd, s.issues];
    }),
  );
  add(
    '원본',
    [
      '파일',
      '시트',
      '행',
      '기준일',
      '코스',
      '고객사',
      '착지',
      '주소',
      '원본 박스',
      'OTD',
      '방식',
      '메모',
      '원본값',
    ],
    state.rows.map((r) => [
      r.source.file,
      r.source.sheet,
      r.source.row,
      r.date,
      r.course,
      r.customer,
      r.name,
      r.address,
      r.boxes,
      r.otd,
      r.mode,
      r.notes,
      r.source.raw,
    ]),
  );
  add(
    '당일 기사',
    ['코스', '기사', '차량', '톤수', '기준량', '운행 가능'],
    state.drivers.map((r) => [
      r.course,
      r.driverName,
      r.vehicleNumber,
      r.tons,
      r.capacity,
      r.available !== false ? '가능' : '불가',
    ]),
  );
  add(
    '확인 항목',
    ['코드', '내용'],
    (d.issues || []).map((i) => [i.code, i.message]),
  );
  add(
    '조정 이력',
    ['시각', '변경 이유'],
    state.history.map((h) => [h.at, h.reason]),
  );
  add(
    '사용 구간',
    ['코스', '구간 자료'],
    d.routes.flatMap((r) =>
      (r.usedLegs || []).map((leg) => [routeLabel(r), leg]),
    ),
  );
  add(
    '저장 정보',
    ['항목', '값'],
    [
      ['기준일', state.date],
      ['저장 ID', state.id],
      ['버전', state.revision],
      ['미저장 변경', state.dirty ? '있음' : '없음'],
      ['변경 이유', $('reason').value],
      ['설정', d.settings],
      ['상태', '가배차 추정 · 실제 배차 확정 아님'],
    ],
  );
  const bytes = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  const a = node('a');
  a.href = url;
  a.download = `평택_가배차_${state.date}_v${state.revision}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  message('엑셀 다운로드 완료');
}

// Capture before the shared shell updates the URL and selected-center storage.
document.addEventListener(
  'change',
  (event) => {
    if (event.target.id !== 'app-center-select') return;
    if (state.busy || !discard()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.target.value = '002';
      return;
    }
    state.dirty = false;
  },
  true,
);
document.addEventListener(
  'click',
  (event) => {
    const center = event.target.closest('[data-center-code]');
    const link = event.target.closest('a[href]');
    if (!center && !link) return;
    if (
      link &&
      (link.target === '_blank' ||
        event.ctrlKey ||
        event.metaKey ||
        new URL(link.href, location.href).hash)
    )
      return;
    if (state.busy || !discard()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else state.dirty = false;
  },
  true,
);
addEventListener('beforeunload', (event) => {
  if (state.dirty || profiles.isDirty() || state.busy) {
    event.preventDefault();
    event.returnValue = '';
  }
});
addEventListener('pagehide', () => {
  queryStopped = true;
});
$('date').value = state.date;
$('date').onchange = () =>
  run(async () => {
    const next = $('date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || !discard()) {
      $('date').value = state.date;
      message('기준일 변경 취소');
      return;
    }
    state.date = next;
    profiles.reset();
    state.needsRegeneration = false;
    state.rows = [];
    state.draft = null;
    state.preview = null;
    state.id = null;
    state.revision = 0;
    state.history = [];
    state.dirty = false;
    state.book = null;
    $('file').value = '';
    $('sheet').replaceChildren();
    $('mapping').replaceChildren();
    $('preview-table').replaceChildren();
    $('source-table').replaceChildren();
    $('preview-count').textContent = '';
    issues($('import-issues'), []);
    $('reason').value = '';
    await context({ replaceDrivers: true });
    await snapshots();
    stage(0);
  });
document
  .querySelectorAll('[data-stage]')
  .forEach((el) => (el.onclick = () => stage(Number(el.dataset.stage))));
$('back').onclick = () => stage(state.stage - 1);
$('next').onclick = () => stage(state.stage + 1);
$('adjust').onclick = () => stage(3);
$('file').onchange = () =>
  run(
    async () => {
      const file = $('file').files[0];
      if (!file) return;
      if (file.size > 30 * 1024 * 1024)
        throw Error('30MB 이하 파일을 선택해 주세요.');
      const book = await readWorkbook(file);
      if (!book.sheets?.length) throw Error('시트가 없습니다.');
      state.book = book;
      state.file = file;
      $('sheet').replaceChildren(
        ...book.sheets.map((s, i) => {
          const o = node('option', s.name);
          o.value = i;
          return o;
        }),
      );
      setupMapping();
      touch();
      message('열 매핑과 기준일을 확인해 주세요.');
    },
    { edit: true },
  );
$('sheet').onchange = () => run(setupMapping, { edit: true });
$('header').onchange = () => {
  state.preview = null;
  controls();
};
for (const [id, fn, edit] of [
  ['preview', preview, true],
  ['import', importRows, true],
  ['create', generate, true],
  ['save', () => save(), true],
  ['save-copy', () => save(true), true],
  ['export', exportExcel, false],
  ['list', snapshots, false],
  ['refresh', refreshLegs, true],
  ['pair', queryPair, true],
  ['recalculate', () => recalc('시간 재계산'), true],
  ['delete-route', deleteTemporaryRoute, true],
  [
    'context',
    async () => {
      if (
        state.draft &&
        !confirm(
          '당일 기사 조건과 초안을 비우고 기준자료를 다시 읽으시겠습니까?',
        )
      )
        return;
      await context({ replaceDrivers: state.editable });
      if (state.editable) driverChanged();
    },
    false,
  ],
  [
    'clear',
    () => {
      if (!confirm('모든 원본 물량과 초안을 비우시겠습니까?')) return;
      state.rows = [];
      state.draft = null;
      touch('물량 비우기');
      $('source-table').replaceChildren();
      render();
    },
    true,
  ],
  [
    'add-route',
    () => {
      const id = 'manual-' + crypto.randomUUID();
      state.draft.routes.push({
        id,
        type: 'temporary',
        course: '',
        driverId: null,
        driverName: '',
        vehicleId: null,
        vehicleNumber: '',
        tons: 1,
        capacity: state.draft.settings.capacities?.['1'] ?? null,
        stopIds: [],
        interdelivery: false,
      });
      state.routeId = id;
      recalc('임시차 추가');
    },
    true,
  ],
])
  $(id).onclick = () => run(fn, { edit });
$('route').onchange = () => {
  state.routeId = $('route').value;
  renderDetails();
  controls();
};
$('reason').oninput = () => {
  if (state.editable) touch();
};
$('stop-query').onclick = async () => {
  queryStopped = true;
  if (queryJob) {
    const { error } = await supabase.rpc('naver_api_cancel', {
      p_job: queryJob,
    });
    if (error) message('중지 요청 실패 · 현재 배치 이후 중단합니다.', true);
  }
};
async function initialize() {
  if (getSelectedCenter()?.code !== '002') {
    message('평택센터(002)에서만 사용할 수 있습니다.', true);
    $('date').disabled = true;
    return;
  }
  const profile = await requireAuth();
  if (!profile) return;
  const permissions = await menuPermissions();
  if (!permissionAllowed(permissions, 'charter', 'read', '002')) {
    message('평택 가배차 열람 권한이 없습니다.', true);
    return;
  }
  state.editable = permissionAllowed(permissions, 'charter', 'edit', '002');
  profiles.setPermissions(permissions);
  relations = createRelationsUI({
    actor: profile,
    permissions,
    getDestinations: () => state.context.destinations,
    onBusyChange(value) {
      state.busy = value;
      controls();
    },
    onCollected: refreshLegs,
  });
  state.ready = true;
  $('access').textContent = state.editable ? '' : '열람 전용';
  $('work').hidden = false;
  await run(async () => {
    await context({ replaceDrivers: true });
    await snapshots();
    stage(0);
    if (new URL(location.href).searchParams.get('view') === 'roads')
      sourceTab('roads');
    message('기준일 물량표를 선택하거나 저장된 초안을 불러오세요.');
  });
}
const profiles = createProfilesUI({
  host: $('profiles-panel'),
  state,
  supabase,
  run,
  message,
  onDirty: controls,
  async onReload() {
    const next = await loadDispatchContext(supabase);
    if (next.issues?.some((issue) => issue.table === 'delivery_points'))
      throw Error('납품정보 DB 조회 실패 · 권한과 연결 상태를 확인해 주세요.');
    const signature = (destinations) =>
      JSON.stringify(
        destinations
          .map((d) => [String(d.id), d.dispatch_profile ?? null])
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    const changed =
      signature(next.destinations) !== signature(state.context.destinations);
    state.context.destinations = next.destinations;
    relations?.refreshDestinations();
    if (state.draft && changed) {
      state.needsRegeneration = true;
      touch('납품정보 DB 다시 읽기 · 초안 재생성 필요');
    }
    render();
  },
  onSaved(records) {
    for (const record of records) {
      const destination = state.context.destinations.find(
        (d) => String(d.id) === String(record.id),
      );
      if (destination) destination.dispatch_profile = record.dispatch_profile;
    }
    relations?.refreshDestinations();
    if (state.draft) {
      state.needsRegeneration = true;
      touch('납품정보 DB 변경 · 초안 재생성 필요');
    }
    render();
  },
});
function sourceTab(selected) {
  for (const name of ['volume', 'profiles', 'roads']) {
    const active = name === selected;
    $(name + '-tab').setAttribute('aria-selected', String(active));
    $(name + '-tab').tabIndex = active ? 0 : -1;
    $(name + '-panel').hidden = !active;
  }
}
$('open-roads').onclick = () => {
  stage(0);
  sourceTab('roads');
};
const sourceTabs = ['volume', 'profiles', 'roads'];
for (const name of sourceTabs) {
  $(name + '-tab').onclick = () => sourceTab(name);
  $(name + '-tab').onkeydown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 'volume'
        : event.key === 'End'
          ? 'roads'
          : sourceTabs[
              (sourceTabs.indexOf(name) +
                (event.key === 'ArrowRight' ? 1 : sourceTabs.length - 1)) %
                sourceTabs.length
            ];
    sourceTab(next);
    $(next + '-tab').focus();
  };
}
initialize().catch((error) => message(error.message, true));
