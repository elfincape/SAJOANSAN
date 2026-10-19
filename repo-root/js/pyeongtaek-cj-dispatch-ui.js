import {
  parseCJWorkbook,
  actualWorkbookTrips,
  routeKey,
} from './pyeongtaek-cj-dispatch-import.js';
import { historicalModel } from './pyeongtaek-cj-dispatch-history.js';
import { drivingGraph } from './pyeongtaek-cj-dispatch-travel.js';
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
} from './pyeongtaek-cj-dispatch-model.js';
import {
  loadDispatchResources,
  saveDispatchDraft,
  listDispatchDrafts,
  readDispatchDraft,
} from './pyeongtaek-cj-dispatch-db.js';
import { menuPermissions } from './menu-permissions.js';
import { permissionAllowed } from './portal-permissions.js';
import { confirmDialog } from './ui.js';
import { displayToMin } from './time.js';
const $ = (id) => document.getElementById('dispatch-' + id),
  fmt = (v) =>
    v == null
      ? '미확인'
      : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
function cellRow(parent, values, tag = 'td') {
  const row = document.createElement('tr');
  for (const value of values) {
    const c = document.createElement(tag);
    if (value instanceof Node) c.append(value);
    else c.textContent = value ?? '';
    row.append(c);
  }
  parent.append(row);
  return row;
}
function button(text, action) {
  const b = document.createElement('button');
  b.className = 'btn btn-ghost';
  b.type = 'button';
  b.textContent = text;
  b.onclick = action;
  return b;
}
function numberInput(value, label) {
  const e = document.createElement('input');
  e.type = 'number';
  e.min = '0';
  e.step = 'any';
  e.className = 'app-input';
  e.value = value ?? '';
  e.setAttribute('aria-label', label);
  return e;
}
const nullable = (e) => (e.value.trim() === '' ? null : Number(e.value));
function downloadJson(value, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function mountDispatchWorkspace(center) {
  if (center.code !== '002') {
    document.getElementById('dispatch-workspace').hidden = true;
    return;
  }
  const permissions = await menuPermissions(),
    editable = permissionAllowed(permissions, 'charter', 'edit', '002');
  let parsed = null,
    resources = null,
    model = null,
    graph = null,
    plan = null,
    settings = {},
    comparison = null,
    actualTrips = null,
    reference = null,
    dirty = false,
    busy = false,
    editing = null,
    settingsDirty = false,
    verificationPending = false,
    routePage = 0,
    visibleGroupCount = 0;
  const status = (text, error = false) => {
    $('status').textContent = text;
    $('status').className = error ? 'issue' : 'muted';
  };
  const refresh = () => {
    for (const input of document.querySelectorAll(
      '#dispatch-workspace input,#dispatch-workspace select',
    )) {
      const editControl =
        input.closest('#dispatch-fleet,#dispatch-edit-form') ||
        [
          'dispatch-source',
          'dispatch-date',
          'dispatch-temporary-capacity',
        ].includes(input.id);
      input.disabled = busy || (!editable && !!editControl);
    }
    for (const b of document.querySelectorAll('#dispatch-workspace button')) {
      const action = b.dataset.action;
      b.disabled = busy || (!editable && action !== 'read');
    }
    $('generate').disabled =
      busy ||
      !editable ||
      !parsed ||
      !model ||
      !resources ||
      resources.beforeDate !== parsed.date;
    $('save').disabled =
      busy || !editable || !plan || settingsDirty || verificationPending;
    $('export').disabled =
      busy || !plan || settingsDirty || verificationPending;
    $('json').disabled = busy || !plan || settingsDirty || verificationPending;
    $('actual').disabled = busy || !plan;
    $('route-prev').disabled = busy || routePage <= 0;
    $('route-next').disabled =
      busy || !plan || (routePage + 1) * 10 >= visibleGroupCount;
    $('source').disabled = busy || !editable;
  };
  async function task(action) {
    if (busy) return;
    busy = true;
    refresh();
    try {
      await action();
    } catch (e) {
      status(e.message || String(e), true);
    } finally {
      busy = false;
      refresh();
    }
  }
  function invalidateComparison() {
    comparison = null;
    if (actualTrips && plan) comparison = compareActual(plan, actualTrips);
  }
  function mark(next) {
    plan = next;
    dirty = true;
    invalidateComparison();
    render();
  }
  async function discard() {
    return (
      !dirty ||
      (await confirmDialog(
        '현재 가배차에 저장하지 않은 조정이 있습니다. 새 작업으로 바꿀까요?',
      ))
    );
  }
  function fleetTable() {
    const body = $('fleet').querySelector('tbody');
    body.replaceChildren();
    if (!parsed) return;
    for (const f of dispatchFleet(parsed, resources?.routes || [], settings)) {
      const available = document.createElement('input');
      available.type = 'checkbox';
      available.checked = f.available;
      available.disabled = !editable;
      available.setAttribute('aria-label', f.route + ' 운행 여부');
      const splitThreshold = numberInput(
        f.splitThresholdPercent,
        f.route + ' 분할 검토 기준 (%)',
      );
      splitThreshold.max = '100';
      const cap = numberInput(f.capacity, f.route + ' 실제 상차한도'),
        extra = numberInput(
          f.maxExtraMinutes,
          f.route + ' 이배송 허용 추가시간',
        ),
        departure = document.createElement('input');
      departure.type = 'time';
      departure.className = 'app-input';
      departure.setAttribute('aria-label', f.route + ' 출발시간');
      if (f.departureMinutes != null)
        departure.value =
          String(Math.floor(f.departureMinutes / 60)).padStart(2, '0') +
          ':' +
          String(f.departureMinutes % 60).padStart(2, '0');
      for (const e of [cap, extra, departure, splitThreshold])
        e.disabled = !editable;
      const update = () => {
        if (
          splitThreshold.value === '' ||
          !Number.isFinite(Number(splitThreshold.value)) ||
          Number(splitThreshold.value) < 0 ||
          Number(splitThreshold.value) > 100 ||
          (cap.value !== '' &&
            (!Number.isFinite(Number(cap.value)) || Number(cap.value) <= 0)) ||
          (extra.value !== '' &&
            (!Number.isFinite(Number(extra.value)) || Number(extra.value) < 0))
        ) {
          status('차량 조건 숫자를 확인해 주세요.', true);
          return;
        }
        settingsDirty = true;
        settings[f.id] = {
          splitThresholdPercent: Number(splitThreshold.value),
          available: available.checked,
          capacity: nullable(cap),
          maxExtraMinutes: nullable(extra),
          departureMinutes: displayToMin(departure.value),
        };
        dirty = true;
        status(
          '차량 조건을 변경했습니다. 가배차 실행 시 반영됩니다. 기존 수동 조정은 다시 생성하면 교체됩니다.',
        );
        refresh();
      };
      for (const e of [available, cap, extra, departure, splitThreshold])
        e.onchange = update;
      const own = parsed.jobs
        .filter((j) => routeKey(j.ownerRoute) === f.id)
        .reduce((n, j) => n + j.quantity, 0);
      cellRow(body, [
        f.route,
        f.driver,
        f.plate,
        fmt(f.tons),
        fmt(own),
        available,
        cap,
        splitThreshold,
        departure,
        extra,
      ]);
    }
  }
  function render() {
    $('summary').replaceChildren();
    if (!plan) {
      $('board').replaceChildren();
      return;
    }
    const labels = {
      fixed: '고정차',
      external: '외부 지정',
      temporary: '용차 검토',
      review: '소속 확인',
    };
    for (const text of [
      '착지 ' +
        new Set(plan.jobs.map((j) => j.sourceDestinationId || j.id)).size +
        '개',
      ...(plan.jobs.some((j) => j.sourceDestinationId)
        ? ['분할 포함 배정 ' + plan.jobs.length + '건']
        : []),
      '총 ' + fmt(plan.sourceQuantity) + ' 박스환산',
      ...Object.keys(labels).map(
        (k) =>
          labels[k] +
          ' ' +
          plan.groups.filter((g) => g.kind === k).length +
          '묶음',
      ),
    ]) {
      const span = document.createElement('span');
      span.className = 'metric';
      span.textContent = text;
      $('summary').append(span);
    }
    const query = $('filter').value.trim(),
      selected = $('group-kind').value,
      board = $('board');
    board.replaceChildren();
    const jobs = new Map(plan.jobs.map((j) => [j.id, j]));
    const visibleGroups = plan.groups.filter((g) => {
      if (selected && g.kind !== selected) return false;
      const js = g.jobIds.map((id) => jobs.get(id));
      return (
        !query ||
        [
          g.label,
          ...js.flatMap((j) => [j.name, j.ownerRoute, ...j.memberIds]),
        ].some((text) => text.includes(query))
      );
    });
    visibleGroupCount = visibleGroups.length;
    routePage = Math.min(
      routePage,
      Math.max(0, Math.ceil(visibleGroupCount / 10) - 1),
    );
    $('route-page').textContent = visibleGroupCount
      ? `${routePage * 10 + 1}–${Math.min((routePage + 1) * 10, visibleGroupCount)} / ${visibleGroupCount}묶음`
      : '해당 묶음 없음';
    for (const g of visibleGroups.slice(routePage * 10, (routePage + 1) * 10)) {
      const js = g.jobIds.map((id) => jobs.get(id));
      const article = document.createElement('article');
      article.className = 'dispatch-route';
      const title = document.createElement('h3');
      title.textContent =
        g.label +
        ' · ' +
        labels[g.kind] +
        ' · ' +
        fmt(g.quantity) +
        ' 박스환산 / ' +
        js.length +
        '착지';
      title.className = 'font-semibold';
      const evidence = document.createElement('p');
      evidence.className = 'text-xs muted';
      evidence.textContent =
        g.reason +
        (g.historicalEvidence
          ? ' · 함께 ' +
            g.historicalEvidence.same +
            '/' +
            g.historicalEvidence.total +
            '일'
          : '');
      const conditions = document.createElement('p');
      conditions.className = 'text-xs ' + (g.issues.length ? 'issue' : 'muted');
      conditions.textContent = [
        g.status,
        '실제 상차한도 ' + fmt(g.capacity),
        g.travel?.complete
          ? '주행 ' +
            fmt(g.travel.meters / 1000) +
            'km / ' +
            fmt(g.travel.seconds / 60) +
            '분'
          : '주행 연결 미확인',
        g.travel?.sections.some((s) => s.status === 'composed')
          ? '일부 실측구간 연결 경로'
          : '',
        g.issues.length ? '확인할 항목 ' + g.issues.length + '건' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const controls = document.createElement('div');
      controls.className = 'toolbar';
      if (g.kind === 'temporary' || g.kind === 'review')
        controls.append(
          button('코스명·상차한도', () =>
            task(async () => {
              const label = prompt('코스 이름', g.label);
              if (label === null) return;
              const capacity = prompt(
                '확인된 실제 상차한도(박스환산). 미확인은 빈칸',
                g.capacity ?? '',
              );
              if (capacity === null) return;
              const n = capacity.trim() === '' ? null : Number(capacity);
              if (n !== null && (!Number.isFinite(n) || n <= 0))
                throw Error('상차한도를 확인해 주세요.');
              const next = structuredClone(plan),
                target = next.groups.find((x) => x.id === g.id);
              target.label = label.trim() || g.label;
              target.capacity = n;
              mark(recomputeDispatch(next, graph));
            }),
          ),
        );
      const table = document.createElement('table');
      table.className = 'app-table';
      const head = document.createElement('thead'),
        body = document.createElement('tbody');
      cellRow(head, ['착지 · 코드', '원래 호차', '물량', '주소', '조정'], 'th');
      table.append(head, body);
      for (const [i, j] of js.entries()) {
        const name = document.createElement('div'),
          strong = document.createElement('strong'),
          codes = document.createElement('p');
        strong.textContent =
          j.name + (j.sourceDestinationId ? ' · 분할 배정' : '');
        codes.className = 'text-xs muted';
        codes.textContent = j.memberIds
          .map((id) =>
            id.replace(/^sajo:/, '사조 ').replace(/^hansung:/, '한성 '),
          )
          .join(' · ');
        name.append(strong, codes);
        const actions = document.createElement('div');
        actions.append(
          button('이동·착지 확인', () => edit(j.id)),
          button('↑', () => reorder(g.id, i, -1)),
          button('↓', () => reorder(g.id, i, 1)),
        );
        cellRow(body, [
          name,
          j.ownerRoute,
          fmt(j.quantity),
          j.address || '주소 확인 필요',
          actions,
        ]);
      }
      const wrap = document.createElement('div');
      wrap.className = 'scroll';
      wrap.append(table);
      const issues = document.createElement('details');
      issues.hidden = !g.issues.length;
      const issueTitle = document.createElement('summary'),
        issueList = document.createElement('ul');
      issueTitle.textContent = '확인할 항목 ' + g.issues.length + '건';
      for (const text of g.issues) {
        const item = document.createElement('li');
        item.textContent = text;
        issueList.append(item);
      }
      issues.append(issueTitle, issueList);
      article.append(title, evidence, conditions, issues, controls, wrap);
      board.append(article);
    }
    renderTransfers();
    renderComparison();
    refresh();
  }
  function renderTransfers() {
    const host = $('transfers');
    host.replaceChildren();
    const candidates = plan?.transferCandidates || [];
    if (!candidates.length) {
      host.textContent =
        '실제 상차한도·허용 추가시간·주행 연결이 확인되면 이배송 후보를 표시합니다.';
      return;
    }
    for (const c of candidates) {
      const job = plan.jobs.find((j) => j.id === c.jobId),
        group = plan.groups.find((g) => g.id === c.targetId),
        line = document.createElement('div');
      line.className = 'toolbar';
      const text = document.createElement('span');
      text.textContent =
        job.name +
        ' → ' +
        group.label +
        ' · 추가 ' +
        fmt(c.extraMinutes) +
        '분 / 본인코스 대비 누적 ' +
        fmt(c.cumulativeExtraMinutes) +
        '분 · 과거 지원 ' +
        c.historyDays +
        '일 · ' +
        c.status;
      line.append(
        text,
        button('이배송 후보 적용', () =>
          task(async () => {
            const fresh = transferCandidates(plan, model, graph).find(
              (x) => x.jobId === c.jobId && x.targetId === c.targetId,
            );
            if (!fresh) throw Error('다른 조정으로 후보 조건이 바뀌었습니다.');
            if (
              !fresh.travel.deadlineVerified &&
              !(await confirmDialog(
                '납품시간 조건이 미확인입니다. 검토 상태로 이동할까요?',
              ))
            )
              return;
            mark(applyTransferCandidate(plan, fresh, graph));
            plan.transferCandidates = transferCandidates(plan, model, graph);
            render();
          }),
        ),
      );
      host.append(line);
    }
  }
  function reorder(groupId, index, direction) {
    if (!editable) return;
    const next = structuredClone(plan),
      g = next.groups.find((x) => x.id === groupId),
      k = index + direction;
    if (k < 0 || k >= g.jobIds.length) return;
    [g.jobIds[index], g.jobIds[k]] = [g.jobIds[k], g.jobIds[index]];
    next.transferCandidates = [];
    mark(recomputeDispatch(next, graph));
  }
  function edit(id) {
    if (!editable) return;
    editing = id;
    const j = plan.jobs.find((j) => j.id === id);
    $('edit-title').textContent = j.name;
    $('edit-address').value = j.address;
    $('edit-earliest').value =
      j.earliestArrival == null || j.earliestArrival >= 1440
        ? ''
        : String(Math.floor(j.earliestArrival / 60)).padStart(2, '0') +
          ':' +
          String(j.earliestArrival % 60).padStart(2, '0');
    $('edit-deadline').value =
      j.deadline == null
        ? ''
        : String(Math.floor(j.deadline / 60)).padStart(2, '0') +
          ':' +
          String(j.deadline % 60).padStart(2, '0');
    for (const key of ['earliest', 'deadline'])
      $('edit-' + key).dataset.initial = $('edit-' + key).value;
    for (const key of ['unloadMinutes', 'inspectionMinutes', 'marginMinutes'])
      $('edit-' + key).value = j.profile?.[key] ?? '';
    const target = $('edit-target');
    target.replaceChildren();
    for (const g of plan.groups) {
      const o = document.createElement('option');
      o.value = g.id;
      o.textContent = g.label + ' / ' + g.kind;
      o.selected = g.jobIds.includes(id);
      target.append(o);
    }
    const split = document.createElement('option');
    split.value = '__new';
    split.textContent = '새 용차 검토 묶음으로 분리';
    target.append(split);
    const merge = $('edit-merge');
    merge.replaceChildren(new Option('동일 하차 단위 합산 안 함', ''));
    for (const other of plan.jobs)
      if (
        !j.sourceDestinationId &&
        !other.sourceDestinationId &&
        other.id !== id &&
        routeKey(other.ownerRoute) === routeKey(j.ownerRoute)
      )
        merge.add(new Option(other.name + ' · ' + other.address, other.id));
    $('edit-error').textContent = '';
    $('edit-dialog').showModal();
  }
  $('edit-form').onsubmit = (e) => {
    e.preventDefault();
    if (!editable) return;
    try {
      let next = structuredClone(plan),
        j = next.jobs.find((j) => j.id === editing);
      j.address = $('edit-address').value.trim();
      for (const [key, field] of [
        ['deadline', 'deadline'],
        ['earliest', 'earliestArrival'],
      ]) {
        const input = $('edit-' + key);
        if (input.value !== input.dataset.initial) {
          j[field] = displayToMin(input.value);
          j.otdInvalid = false;
        }
      }
      j.profile = { ...(j.profile || {}) };
      for (const key of [
        'unloadMinutes',
        'inspectionMinutes',
        'marginMinutes',
      ]) {
        const v = nullable($('edit-' + key));
        if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1440))
          throw Error('소요시간은 0~1440분으로 입력해 주세요.');
        j.profile[key] = v;
      }
      j.conditionReview = false;
      const merge = $('edit-merge').value;
      if (merge) next = mergeDestinations(next, editing, merge, graph);
      else {
        const target = $('edit-target').value;
        next =
          target === '__new'
            ? newTemporaryGroup(next, editing, graph)
            : moveWholeDestination(next, editing, target, graph);
      }
      next.transferCandidates = [];
      mark(recomputeDispatch(next, graph));
      $('edit-dialog').close();
    } catch (error) {
      $('edit-error').textContent = error.message;
    }
  };
  $('edit-cancel').onclick = () => $('edit-dialog').close();
  function renderComparison() {
    const host = $('comparison');
    host.replaceChildren();
    if (!comparison) return;
    const p = document.createElement('p');
    p.textContent =
      comparison.scope +
      ' · CJ 미일치 실배차 ' +
      comparison.unmatchedActual.length +
      '코드/명';
    host.append(p);
    const table = document.createElement('table');
    table.className = 'app-table';
    const h = document.createElement('thead'),
      b = document.createElement('tbody');
    cellRow(
      h,
      [
        '착지',
        'CJ 전체 물량',
        '조정 기록에 해당하는 CJ 물량',
        '실배차 물량',
        '차이',
        '원래 호차',
        '실배차 코스',
        '확인',
      ],
      'th',
    );
    for (const r of comparison.rows)
      cellRow(b, [
        r.name,
        fmt(r.sourceQuantity),
        fmt(r.recordedSourceQuantity),
        fmt(r.actualQuantity),
        fmt(r.quantityDifference),
        r.originalRoute,
        r.actualCourses.join(', '),
        r.status,
      ]);
    table.append(h, b);
    const wrap = document.createElement('div');
    wrap.className = 'scroll';
    wrap.append(table);
    host.append(wrap);
  }
  $('source').onchange = () =>
    task(async () => {
      const file = $('source').files[0];
      if (!file || !(await discard())) return;
      const w = XLSX.read(await file.arrayBuffer(), { type: 'array' }),
        next = parseCJWorkbook(w, XLSX);
      parsed = next;
      parsed.sourceName = file.name;
      $('date').value = next.date;
      resources = null;
      model = null;
      graph = null;
      plan = null;
      comparison = null;
      actualTrips = null;
      reference = null;
      settings = {};
      settingsDirty = false;
      dirty = true;
      fleetTable();
      render();
      $('input-summary').textContent =
        next.sourceCount +
        ' 상세행 · ' +
        next.jobs.length +
        ' 코드/명 · ' +
        fmt(next.jobs.reduce((n, j) => n + j.quantity, 0)) +
        ' 박스환산 · ' +
        next.issues.map((x) => x.message).join(' / ');
      status('CJ 지시서를 읽었습니다. 기준·주행·이력을 불러오세요.');
    });
  $('date').onchange = () => {
    if (parsed && $('date').value !== parsed.date) {
      $('date').value = parsed.date;
      status(
        '일자는 CJ 원본에서 확인합니다. 다른 날짜 작업은 해당 지시서를 올려 주세요.',
        true,
      );
    }
  };
  const signature = (r) =>
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
  $('load').onclick = () =>
    task(async () => {
      const date = parsed?.date || $('date').value;
      if (!date) throw Error('CJ 파일 또는 배차일자를 먼저 선택해 주세요.');
      status('등록 코스·전체 주행 구간·이력을 불러오는 중…');
      const next = await loadDispatchResources(date),
        nextModel = historicalModel(next.history, date),
        nextGraph = drivingGraph(next.addresses, next.legs);
      resources = next;
      model = nextModel;
      graph = nextGraph;
      fleetTable();
      if (plan) {
        if (plan.resourceSignature !== signature(next)) settingsDirty = true;
        verificationPending = false;
        plan.resourcesOutdated = settingsDirty;
        recomputeDispatch(plan, graph);
        plan.transferCandidates = transferCandidates(plan, model, graph);
        render();
      }
      $('data-summary').textContent =
        '코스 ' +
        next.routes.length +
        ' · 주행 ' +
        graph.audit.readLegs +
        '건(유효 ' +
        graph.audit.validLegs +
        ', 좌표변경 ' +
        graph.audit.staleLegs +
        ', 오류 ' +
        graph.audit.invalidLegs +
        ') · 이전 ' +
        model.days +
        '일 이력 · 충돌 코스 제외 ' +
        model.excludedCourses;
      status(
        settingsDirty
          ? '납품정보 또는 코스 기준이 변경되었습니다. 현재 조정은 유지됩니다. 가배차를 재실행한 뒤 저장하세요.'
          : '기준·주행·이력을 불러왔습니다. 실제 상차한도를 확인한 뒤 가배차를 실행하세요.',
      );
    });
  $('generate').onclick = () =>
    task(async () => {
      if (
        plan &&
        !(await confirmDialog(
          '가배차를 다시 만들면 현재 수동 조정을 교체합니다. 계속할까요?',
        ))
      )
        return;
      const capacity = nullable($('temporary-capacity'));
      if (capacity !== null && (!Number.isFinite(capacity) || capacity <= 0))
        throw Error('임시차 실제 상차한도를 확인해 주세요.');
      const next = generateDispatch(parsed, {
        ...resources,
        model,
        graph,
        settings,
        temporaryCapacity: capacity,
      });
      next.resourceSignature = signature(resources);
      settingsDirty = false;
      verificationPending = false;
      mark(next);
      status('가배차를 만들었습니다. 검토 상태와 착지 묶음을 확인해 주세요.');
    });
  $('actual').onchange = () =>
    task(async () => {
      const file = $('actual').files[0];
      if (!file || !plan) return;
      const trips = actualWorkbookTrips(
          XLSX.read(await file.arrayBuffer(), { type: 'array' }),
          XLSX,
        ),
        next = compareActual(plan, trips);
      actualTrips = trips;
      comparison = next;
      renderComparison();
      status(
        '당일 실배차와 대조했습니다. 이 파일은 가배차 추천 이력에 넣지 않았습니다.',
      );
    });
  const state = () => ({
    schemaVersion: 1,
    type: 'pyeongtaek-dispatch',
    parsed,
    settings,
    plan,
  });
  $('save').onclick = () =>
    task(async () => {
      if (!editable) throw Error('가배차 수정 권한이 없습니다.');
      if (settingsDirty || verificationPending)
        throw Error(
          '변경한 차량 조건으로 가배차를 다시 실행한 뒤 저장해 주세요.',
        );
      const saved = await saveDispatchDraft(state(), reference);
      reference = { id: saved.id, revision: saved.revision };
      dirty = false;
      status('가배차를 저장했습니다. 버전 ' + saved.revision);
      await list();
    });
  async function list() {
    const rows = await listDispatchDrafts();
    $('drafts').replaceChildren(new Option('저장한 가배차 선택', ''));
    for (const row of rows)
      $('drafts').add(
        new Option(
          row.business_date +
            ' · ' +
            row.updated_at.slice(0, 16) +
            ' · v' +
            row.revision,
          row.id,
        ),
      );
  }
  $('list').onclick = () => task(list);
  $('restore').onclick = () =>
    task(async () => {
      if (!$('drafts').value || !(await discard())) return;
      const row = await readDispatchDraft($('drafts').value),
        s = row.payload;
      if (
        s?.schemaVersion !== 1 ||
        s.type !== 'pyeongtaek-dispatch' ||
        !s.parsed?.jobs ||
        !s.plan?.jobs ||
        !s.plan?.groups
      )
        throw Error('지원하지 않는 가배차 저장 형식입니다.');
      const next = structuredClone(s.plan);
      recomputeDispatch(next, null);
      parsed = s.parsed;
      settings = s.settings || {};
      plan = next;
      reference = { id: row.id, revision: row.revision };
      model = null;
      resources = null;
      graph = null;
      comparison = null;
      actualTrips = null;
      dirty = false;
      settingsDirty = false;
      verificationPending = true;
      plan.resourcesOutdated = true;
      $('date').value = plan.date;
      fleetTable();
      render();
      status(
        '저장안을 불러왔습니다. 저장·출력 전 기준·주행·이력을 다시 불러와 현재 납품조건과 경로를 확인해 주세요.',
      );
    });
  $('json').onclick = () =>
    downloadJson(state(), '평택_' + plan.date + '_가배차.json');
  $('export').onclick = () => {
    if (!plan) return;
    const wb = XLSX.utils.book_new(),
      rows = [
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
        const j = plan.jobs.find((j) => j.id === id);
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
            g.issues.join(' / '),
          ]);
      }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '가배차');
    if (comparison)
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          comparison.rows.map((r) => ({
            ...r,
            actualCourses: r.actualCourses.join(', '),
          })),
        ),
        '실배차 대조',
      );
    XLSX.writeFile(wb, '평택_' + plan.date + '_가배차.xlsx', {
      compression: true,
    });
  };
  $('filter').oninput = () => {
    routePage = 0;
    render();
  };
  $('group-kind').onchange = () => {
    routePage = 0;
    render();
  };
  $('route-prev').onclick = () => {
    routePage--;
    render();
  };
  $('route-next').onclick = () => {
    routePage++;
    render();
  };
  window.addEventListener('pyeongtaek-dispatch-resources-changed', () => {
    resources = null;
    model = null;
    graph = null;
    if (plan) {
      settingsDirty = true;
      plan.resourcesOutdated = true;
      recomputeDispatch(plan, null);
      render();
    }
    refresh();
    status(
      '납품정보·주행 DB가 변경되었습니다. 기준·주행·이력을 다시 불러오고 가배차를 재실행해 주세요.',
    );
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  status(
    editable
      ? 'CJ 당일 지시서로 배차 작업을 시작하세요.'
      : '열람 전용: 저장한 가배차 조회와 다운로드를 사용할 수 있습니다.',
  );
  refresh();
}
