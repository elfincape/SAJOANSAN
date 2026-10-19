import {
  routeKey,
  clean,
  normalizeDispatchJobs,
} from './pyeongtaek-cj-dispatch-import.js';
import { relation, deliveryKey } from './pyeongtaek-cj-dispatch-history.js';
export function dispatchFleet(parsed, routes, settings = {}) {
  const map = new Map(
    parsed.fleet.map((f) => [
      f.id,
      {
        ...f,
        available: true,
        capacity: null,
        departureMinutes: null,
        maxExtraMinutes: null,
      },
    ]),
  );
  for (const r of routes) {
    const key = routeKey(r.name || r.car_number),
      old = map.get(key) || {
        id: key,
        route: r.name || r.car_number,
        plate: '',
        driver: '',
        tons: null,
      };
    map.set(key, {
      ...old,
      dbId: r.id,
      plate: r.vehicle?.plate_number || old.plate,
      driver: r.driver_name || r.driver?.name || old.driver,
      tons: r.vehicle?.tonnage ?? old.tons,
      available: r.active !== false,
      closedDays: r.closed_days || [],
      capacity: null,
      departureMinutes: null,
      maxExtraMinutes: null,
    });
  }
  const weekday = new Date(parsed.date + 'T12:00:00Z').getUTCDay();
  return [...map.values()].map((f) => ({
    ...f,
    splitThresholdPercent: 90,
    ...settings[f.id],
    available:
      settings[f.id]?.available ??
      (f.available && !f.closedDays?.includes(weekday)),
  }));
}
export function generateDispatch(
  parsed,
  {
    points = [],
    routes = [],
    model,
    graph,
    settings = {},
    temporaryCapacity = null,
  } = {},
) {
  if (!model || model.beforeDate !== parsed.date)
    throw Error('배차일보다 앞선 이력을 먼저 불러와 주세요.');
  const jobs = normalizeDispatchJobs(parsed, {
      points,
      aliases: model.aliases,
      graph,
    }),
    fleet = dispatchFleet(parsed, routes, settings),
    groups = [],
    remaining = new Map(jobs.map((j) => [j.id, j])),
    notices = [];
  const sourceMemberQuantities = Object.fromEntries(
    jobs.flatMap((j) => j.members.map((m) => [m.id, m.quantity])),
  );
  let serial = 0;
  const add = (kind, label, js, options = {}) => {
    if (!js.length) return;
    const group = {
      id: 'group-' + ++serial,
      kind,
      label,
      jobIds: js.map((j) => j.id),
      capacity: null,
      ...options,
    };
    groups.push(group);
    for (const j of js) remaining.delete(j.id);
    return group;
  };
  for (const f of fleet) {
    const own = jobs.filter(
      (j) => j.kind === 'fixed' && routeKey(j.ownerRoute) === f.id,
    );
    if (!own.length) continue;
    if (!f.available) {
      for (const j of own) {
        j.reason = '고정기사 휴무 · 착지 전체 용차';
        j.forceTemporary = true;
      }
      continue;
    }
    const rank = (j) => {
      const rs = routes.find((r) => routeKey(r.name || r.car_number) === f.id);
      const pointIds = j.members.map((m) => m.pointId);
      return Math.min(
        ...(rs?.stops || [])
          .filter((s) => pointIds.includes(s.delivery_point_id))
          .map((s) => s.stop_order),
        Infinity,
      );
    };
    own.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.sourceRow ?? 0) - (b.sourceRow ?? 0) ||
        a.id.localeCompare(b.id),
    );
    let quantity = 0;
    const chosen = [];
    for (const j of own) {
      if (
        Number.isFinite(f.capacity) &&
        f.capacity > 0 &&
        quantity + j.quantity > f.capacity + 1e-8
      ) {
        j.reason = '본인코스 우선 상차 후 잔여 물량';
        continue;
      }
      chosen.push(j);
      quantity += j.quantity;
    }
    const threshold = f.splitThresholdPercent;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)
      throw Error('분할 검토 기준은 0~100%로 입력해 주세요.');
    if (
      Number.isFinite(f.capacity) &&
      f.capacity > 0 &&
      quantity < (f.capacity * threshold) / 100 - 1e-8
    ) {
      const overflow = own.find(
        (j) => !chosen.includes(j) && j.quantity > f.capacity - quantity,
      );
      if (overflow) {
        const take = f.capacity - quantity;
        const portion = structuredClone(overflow);
        portion.id = overflow.id + ':fixed-part';
        portion.sourceDestinationId = overflow.id;
        overflow.sourceDestinationId = overflow.id;
        portion.quantity = take;
        const ratio = take / overflow.quantity;
        portion.members = overflow.members.map((m) => ({
          ...m,
          quantity: m.quantity * ratio,
          frozen: null,
          chilled: null,
        }));
        overflow.members = overflow.members.map((m, i) => ({
          ...m,
          quantity: m.quantity - portion.members[i].quantity,
          frozen: null,
          chilled: null,
        }));
        overflow.quantity -= take;
        for (const part of [portion, overflow]) {
          part.frozen = null;
          part.chilled = null;
          part.issues = [
            ...(part.issues || []),
            '분할 상차 · 품목별 실제 상차내역 확인 필요',
          ];
          part.reason = '본인차 물량 확보를 위한 분할 상차';
        }
        overflow.forceTemporary = true;
        jobs.push(portion);
        chosen.push(portion);
        quantity += take;
        notices.push({
          jobId: portion.id,
          reason: '분할 상차 ' + take + ' / 임시차 잔여 ' + overflow.quantity,
        });
      }
    }
    add('fixed', f.route, chosen, {
      fleetId: f.id,
      baselineJobIds: chosen.map((j) => j.id),
      capacity:
        Number.isFinite(f.capacity) && f.capacity > 0 ? f.capacity : null,
      reason: '본인코스 우선',
      departureMinutes: f.departureMinutes,
    });
  }
  for (const j of [...remaining.values()])
    if (j.kind === 'external')
      add('external', j.ownerRoute || '외부 지정', [j], {
        reason: 'CJ 외부 지정 배송 유지',
      });
  for (const j of [...remaining.values()])
    if (
      j.kind === 'review' ||
      (j.kind === 'fixed' &&
        !j.forceTemporary &&
        !fleet.some((f) => f.id === routeKey(j.ownerRoute)))
    )
      add('review', '소속 확인', [j], {
        reason: '고정차 연결 또는 원래 호차 확인 필요',
      });
  const pools = [...remaining.values()].map((j) => [j]);
  // Strong historical links propose a core; require every pair to avoid accidental chaining.
  const edges = [];
  for (let i = 0; i < pools.length; i++)
    for (let k = i + 1; k < pools.length; k++) {
      const r = relation(pools[i][0], pools[k][0], model);
      if (r.total >= 6 && r.rate >= 0.95)
        edges.push([r.rate, r.total, pools[i][0].id, pools[k][0].id]);
    }
  const owner = new Map(pools.flatMap((p, i) => p.map((j) => [j.id, i])));
  for (const [, , a, b] of edges.sort(
    (a, b) => b[0] - a[0] || b[1] - a[1] || a[2].localeCompare(b[2]),
  )) {
    const i = owner.get(a),
      k = owner.get(b);
    if (i === k) continue;
    if (
      pools[i].every((x) =>
        pools[k].every((y) => {
          const r = relation(x, y, model);
          return r.total >= 6 && r.rate >= 0.95;
        }),
      )
    ) {
      pools[i].push(...pools[k]);
      for (const j of pools[k]) owner.set(j.id, i);
      pools[k] = [];
    }
  }
  const cap =
    Number.isFinite(temporaryCapacity) && temporaryCapacity > 0
      ? temporaryCapacity
      : null;
  for (const pool of pools.filter((p) => p.length)) {
    let chunk = [],
      quantity = 0;
    const flush = () => {
      if (chunk.length)
        add('temporary', '용차 검토 ' + (serial + 1), chunk, {
          capacity: cap,
          reason:
            chunk.length > 1
              ? '과거 실배차 반복 묶음'
              : '잔여 착지 · 합차 검토',
          historicalEvidence:
            chunk.length > 1 ? relation(chunk[0], chunk[1], model) : null,
        });
      chunk = [];
      quantity = 0;
    };
    for (const j of pool) {
      if (cap && j.quantity > cap) {
        flush();
        add('temporary', '큰 차량 수배 검토', [j], {
          capacity: null,
          reason: '입력한 임시차 상차량보다 큰 단일 착지',
        });
        continue;
      }
      if (cap && quantity + j.quantity > cap) flush();
      chunk.push(j);
      quantity += j.quantity;
    }
    flush();
  }
  const plan = {
    schemaVersion: 1,
    date: parsed.date,
    jobs,
    groups,
    fleet,
    notices,
    sourceMemberQuantities,
    quantityUnit: parsed.quantityUnit,
    sourceQuantity: jobs.reduce((n, j) => n + j.quantity, 0),
    modelSummary: { days: model.days, excludedCourses: model.excludedCourses },
    updatedAt: new Date().toISOString(),
  };
  recomputeDispatch(plan, graph);
  plan.transferCandidates = transferCandidates(plan, model, graph);
  return plan;
}
export function recomputeDispatch(plan, graph) {
  if (plan.resourcesOutdated) graph = null;
  const jobs = new Map(plan.jobs.map((j) => [j.id, j]));
  for (const g of plan.groups) {
    const js = g.jobIds.map((id) => jobs.get(id));
    if (js.some((j) => !j)) throw Error('묶음의 착지를 찾지 못했습니다.');
    g.quantity = js.reduce((n, j) => n + j.quantity, 0);
    g.issues = [];
    if (
      g.kind !== 'external' &&
      !(Number.isFinite(g.capacity) && g.capacity > 0)
    )
      g.issues.push('실제 상차한도 확인 필요');
    if (Number.isFinite(g.capacity) && g.quantity > g.capacity + 1e-8)
      g.issues.push('상차한도 초과');
    for (const j of js) {
      if (!j.address) g.issues.push(j.name + ': 주소 확인 필요');
      if (j.issues?.length) g.issues.push(...j.issues);
      if (j.conditionReview)
        g.issues.push(j.name + ': 합산한 착지의 주소·납품조건 재확인');
    }
    g.travel =
      graph?.route(js, { departureMinutes: g.departureMinutes ?? null }) ||
      null;
    if (g.kind === 'fixed') {
      const baselineJobs = g.baselineJobIds?.map((id) => jobs.get(id));
      const baseline =
        baselineJobs?.length && baselineJobs.every(Boolean)
          ? graph?.route(baselineJobs, {
              departureMinutes: g.departureMinutes ?? null,
            })
          : null;
      g.baselineElapsedMinutes =
        baseline?.complete && Number.isFinite(baseline.elapsedMinutes)
          ? baseline.elapsedMinutes
          : null;
      g.cumulativeExtraMinutes =
        Number.isFinite(g.baselineElapsedMinutes) &&
        Number.isFinite(g.travel?.elapsedMinutes)
          ? g.travel.elapsedMinutes - g.baselineElapsedMinutes
          : null;
      const allowance = plan.fleet.find(
        (f) => f.id === g.fleetId,
      )?.maxExtraMinutes;
      if (Number.isFinite(allowance) && g.cumulativeExtraMinutes > allowance)
        g.issues.push('본인코스 대비 누적 추가시간 초과');
    }
    if (g.kind !== 'external') {
      if (!g.travel?.complete) g.issues.push('주행 구간 확인 필요');
      if (!g.travel?.deadlineVerified)
        g.issues.push('납품시간·하차조건 확인 필요');
      if (g.travel?.issues?.length) g.issues.push(...g.travel.issues);
    }
    g.issues = [...new Set(g.issues)];
    g.status =
      g.kind === 'external'
        ? '외부 지정'
        : g.issues.length
          ? '검토 필요'
          : '가배차';
  }
  if (plan.sourceMemberQuantities) {
    const totals = new Map();
    for (const job of plan.jobs) {
      const total = job.members.reduce((n, m) => n + m.quantity, 0);
      if (
        !Number.isFinite(job.quantity) ||
        job.quantity <= 0 ||
        Math.abs(total - job.quantity) > 1e-6
      )
        throw Error('분할 배정 수량을 확인해 주세요.');
      for (const m of job.members)
        totals.set(m.id, (totals.get(m.id) || 0) + m.quantity);
    }
    for (const [id, quantity] of Object.entries(plan.sourceMemberQuantities))
      if (Math.abs((totals.get(id) || 0) - quantity) > 1e-6)
        throw Error('원본 대비 분할 수량이 일치하지 않습니다.');
    if ([...totals.keys()].some((id) => !(id in plan.sourceMemberQuantities)))
      throw Error('원본에 없는 배정 수량입니다.');
  }
  const assigned = plan.groups.flatMap((g) => g.jobIds);
  if (
    assigned.length !== plan.jobs.length ||
    new Set(assigned).size !== assigned.length ||
    assigned.some((id) => !jobs.has(id))
  )
    throw Error('착지 누락 또는 중복 배정이 있습니다.');
  plan.updatedAt = new Date().toISOString();
  return plan;
}
export function moveWholeDestination(plan, jobId, targetId, graph) {
  const next = JSON.parse(JSON.stringify(plan)),
    job = next.jobs.find((j) => j.id === jobId),
    target = next.groups.find((g) => g.id === targetId),
    current = next.groups.find((g) => g.jobIds.includes(jobId));
  if (!job || !target || !current)
    throw Error('이동할 착지와 코스를 확인해 주세요.');
  if (target === current) return plan;
  if (
    current.kind === 'fixed' &&
    current.jobIds.length === 1 &&
    routeKey(job.ownerRoute) === current.fleetId &&
    !job.forceTemporary &&
    Number.isFinite(current.capacity) &&
    job.quantity <= current.capacity
  ) {
    throw Error(
      '실을 수 있는 본인 착지를 모두 넘겨 고정기사를 비울 수 없습니다. 휴무나 실제 상차한도가 바뀌었다면 차량 조건을 먼저 확인해 주세요.',
    );
  }
  const candidate = target.jobIds.map((id) =>
    next.jobs.find((j) => j.id === id),
  );
  if (
    target.capacity &&
    candidate.reduce((n, j) => n + j.quantity, 0) + job.quantity >
      target.capacity + 1e-8
  )
    throw Error('대상 차량의 실제 상차한도를 넘습니다.');
  if (target.kind === 'fixed' && job.forceTemporary)
    throw Error('휴무 또는 분할 후 잔여 물량은 임시차로 처리해야 합니다.');
  current.jobIds = current.jobIds.filter((id) => id !== jobId);
  target.jobIds.push(jobId);
  next.groups = next.groups.filter((g) => g.jobIds.length);
  next.transferCandidates = [];
  next.notices.push({
    jobId,
    reason:
      target.kind === 'fixed' && target.fleetId !== routeKey(job.ownerRoute)
        ? '담당자 이배송 조정 · 누적 경로 재검토'
        : '담당자 착지 전체 이동',
  });
  return recomputeDispatch(next, graph);
}
export function newTemporaryGroup(plan, jobId, graph) {
  const next = JSON.parse(JSON.stringify(plan)),
    id = 'manual-' + globalThis.crypto.randomUUID();
  next.groups.push({
    id,
    kind: 'temporary',
    label: '추가 용차 검토',
    jobIds: [],
    capacity: null,
    reason: '담당자 묶음 분리',
  });
  return moveWholeDestination(next, jobId, id, graph);
}
export function transferCandidates(plan, model, graph) {
  if (plan.resourcesOutdated) return [];
  if (!graph) return [];
  const byId = new Map(plan.jobs.map((j) => [j.id, j])),
    out = [];
  for (const g of plan.groups.filter((g) => g.kind === 'temporary'))
    for (const id of g.jobIds) {
      const job = byId.get(id);
      if (job.forceTemporary) continue;
      for (const fixed of plan.groups.filter((x) => x.kind === 'fixed')) {
        const f = plan.fleet.find((x) => x.id === fixed.fleetId);
        if (
          !f?.available ||
          !Number.isFinite(fixed.capacity) ||
          fixed.quantity + job.quantity > fixed.capacity ||
          !Number.isFinite(f.maxExtraMinutes)
        )
          continue;
        const base = fixed.travel;
        if (
          !base?.complete ||
          !Number.isFinite(base.elapsedMinutes) ||
          !Number.isFinite(fixed.baselineElapsedMinutes)
        )
          continue;
        const own = fixed.jobIds.map((k) => byId.get(k));
        let best = null;
        for (let i = 0; i <= own.length; i++) {
          const js = [...own.slice(0, i), job, ...own.slice(i)],
            travel = graph.route(js, {
              departureMinutes: fixed.departureMinutes ?? null,
            });
          if (
            !travel.complete ||
            !Number.isFinite(travel.elapsedMinutes) ||
            travel.deadlineViolations?.length
          )
            continue;
          const extra = travel.elapsedMinutes - base.elapsedMinutes;
          const cumulativeExtra =
            travel.elapsedMinutes - fixed.baselineElapsedMinutes;
          if (cumulativeExtra > f.maxExtraMinutes) continue;
          if (!best || extra < best.extraMinutes)
            best = {
              jobId: id,
              targetId: fixed.id,
              insertAt: i,
              extraMinutes: extra,
              cumulativeExtraMinutes: cumulativeExtra,
              travel,
              historyDays: Math.max(
                0,
                ...(job.memberIds || [id]).map(
                  (k) => model.support.get(k)?.get(routeKey(f.plate)) || 0,
                ),
              ),
              status: travel.deadlineVerified
                ? '선택 가능'
                : '납품시간 검토 필요',
            };
        }
        if (best) out.push(best);
      }
    }
  return out
    .sort(
      (a, b) =>
        b.historyDays - a.historyDays || a.extraMinutes - b.extraMinutes,
    )
    .slice(0, 200);
}
export function applyTransferCandidate(plan, candidate, graph) {
  const next = moveWholeDestination(
      plan,
      candidate.jobId,
      candidate.targetId,
      graph,
    ),
    target = next.groups.find((g) => g.id === candidate.targetId);
  target.jobIds = target.jobIds.filter((id) => id !== candidate.jobId);
  target.jobIds.splice(candidate.insertAt, 0, candidate.jobId);
  return recomputeDispatch(next, graph);
}
export function compareActual(plan, trips) {
  const dated = trips.filter((t) => t.date === plan.date);
  if (!dated.length)
    throw Error('가배차와 같은 날짜의 실배차 내역이 없습니다.');
  const actual = new Map();
  for (const t of dated)
    for (const d of t.deliveries || []) {
      if (!clean(d.name) || !clean(t.course) || !clean(t.type)) continue;
      const key = deliveryKey(d, t),
        entry = {
          course: clean(t.course),
          type: clean(t.type),
          quantity: d.quantity,
          originalRoute: clean(t.vehicleSequence),
          stopId: d.stopId,
          sourceRow: d.sourceRow,
        };
      if (!actual.has(key)) actual.set(key, []);
      const anchor = [
        entry.type,
        entry.course,
        d.sourceCells?.quantity || d.id || d.sourceRow,
      ].join('|');
      if (!actual.get(key).some((x) => x.anchor === anchor))
        actual.get(key).push({ ...entry, anchor });
    }
  const predicted = new Map(
      plan.groups.flatMap((g) => g.jobIds.map((id) => [id, g])),
    ),
    rows = [];
  const destinations = new Map();
  for (const job of plan.jobs) {
    const key = job.sourceDestinationId || job.id;
    if (!destinations.has(key))
      destinations.set(key, {
        ...job,
        quantity: 0,
        members: [],
        allocationIds: [],
      });
    const row = destinations.get(key);
    row.quantity += job.quantity;
    row.allocationIds.push(job.id);
    for (const member of job.members) {
      const existing = row.members.find((m) => m.id === member.id);
      if (existing) existing.quantity += member.quantity;
      else row.members.push({ ...member });
    }
  }
  for (const j of destinations.values()) {
    const matchedMembers = j.members.filter((m) => actual.has(m.id)),
      hits = matchedMembers.flatMap((m) => actual.get(m.id) || []),
      recordedSourceQuantity = matchedMembers.length
        ? matchedMembers.reduce((n, m) => n + m.quantity, 0)
        : null,
      courses = [...new Set(hits.map((h) => h.type + '|' + h.course))],
      actualQuantity =
        hits.length && hits.every((h) => Number.isFinite(h.quantity))
          ? hits.reduce((n, h) => n + h.quantity, 0)
          : null;
    rows.push({
      jobId: j.id,
      name: j.name,
      sourceQuantity: j.quantity,
      recordedSourceQuantity,
      unrecordedMemberIds: j.members
        .filter((m) => !actual.has(m.id))
        .map((m) => m.id),
      actualQuantity,
      quantityDifference:
        actualQuantity === null
          ? null
          : actualQuantity - recordedSourceQuantity,
      originalRoute: j.ownerRoute,
      predictedGroup: j.allocationIds
        .map((id) => predicted.get(id)?.label)
        .filter(Boolean)
        .join(' / '),
      actualCourses: courses,
      status: !hits.length
        ? '원래 코스 잔류 여부 확인'
        : courses.length > 1
          ? '실배차 여러 코스 확인'
          : Math.abs(
                (actualQuantity ?? recordedSourceQuantity) -
                  recordedSourceQuantity,
              ) > 1e-6
            ? '기록된 물량 차이 확인'
            : matchedMembers.length < j.members.length
              ? '일부 고객사만 조정 기록 · 잔류 확인'
              : '실배차 조정 기록 확인',
    });
  }
  const known = new Set(plan.jobs.flatMap((j) => j.memberIds)),
    unmatched = [...actual]
      .filter(([key]) => !known.has(key))
      .map(([key, entries]) => ({ key, entries }));
  return {
    date: plan.date,
    rows,
    unmatchedActual: unmatched,
    scope:
      '실배차 파일은 용차·지원배송 조정 이력입니다. 없는 착지를 자동 누락으로 판정하지 않습니다.',
  };
}
export function mergeDestinations(plan, sourceId, targetId, graph) {
  if (sourceId === targetId) throw Error('서로 다른 두 착지를 선택해 주세요.');
  const next = JSON.parse(JSON.stringify(plan)),
    source = next.jobs.find((j) => j.id === sourceId),
    target = next.jobs.find((j) => j.id === targetId),
    group = next.groups.find((g) => g.jobIds.includes(targetId));
  if (!source || !target || !group) throw Error('합칠 착지를 확인해 주세요.');
  if (source.sourceDestinationId || target.sourceDestinationId)
    throw Error(
      '분할 배정된 착지는 합산할 수 없습니다. 차량 조건을 조정한 뒤 재생성해 주세요.',
    );
  if (routeKey(source.ownerRoute) !== routeKey(target.ownerRoute))
    throw Error('원래 호차가 다른 착지는 소속을 확인한 뒤 처리해 주세요.');
  if (
    group.capacity &&
    group.jobIds.reduce(
      (n, id) => n + next.jobs.find((j) => j.id === id).quantity,
      0,
    ) +
      (group.jobIds.includes(sourceId) ? 0 : source.quantity) >
      group.capacity + 1e-8
  )
    throw Error('동일 착지를 합치면 해당 차량의 실제 상차한도를 넘습니다.');
  target.conditionSources = [
    ...(target.conditionSources || []),
    {
      address: target.address,
      deadline: target.deadline,
      profile: target.profile,
    },
    {
      address: source.address,
      deadline: source.deadline,
      profile: source.profile,
    },
  ];
  const serviceKeys = ['unloadMinutes', 'inspectionMinutes', 'marginMinutes'];
  target.conditionReview =
    target.conditionReview ||
    source.conditionReview ||
    target.address !== source.address ||
    target.deadline !== source.deadline ||
    serviceKeys.some(
      (k) => (target.profile?.[k] ?? null) !== (source.profile?.[k] ?? null),
    );
  target.address = source.address || target.address;
  const deadlines = [target.deadline, source.deadline].filter(Number.isFinite);
  target.deadline = deadlines.length ? Math.min(...deadlines) : null;
  const starts = [target.earliestArrival, source.earliestArrival].filter(
    Number.isFinite,
  );
  target.earliestArrival = starts.length ? Math.max(...starts) : null;
  target.otdInvalid = !!(target.otdInvalid || source.otdInvalid);
  target.profile = { ...(target.profile || {}) };
  for (const k of serviceKeys) {
    const a = target.profile[k] ?? null,
      b = source.profile?.[k] ?? null;
    target.profile[k] = a === b ? a : null;
  }
  target.issues = [
    ...new Set([...(target.issues || []), ...(source.issues || [])]),
  ];
  target.members.push(...source.members);
  target.memberIds.push(...source.memberIds);
  target.quantity += source.quantity;
  target.name = [...new Set(target.members.map((m) => m.name))].join(' / ');
  target.forceTemporary ||= source.forceTemporary;
  for (const k of ['frozen', 'chilled'])
    target[k] =
      target[k] === null || source[k] === null ? null : target[k] + source[k];
  next.jobs = next.jobs.filter((j) => j.id !== sourceId);
  for (const g of next.groups)
    g.jobIds = g.jobIds.filter((id) => id !== sourceId);
  next.groups = next.groups.filter((g) => g.jobIds.length);
  next.transferCandidates = [];
  next.notices.push({
    jobId: targetId,
    reason: '담당자가 동일 하차 단위 확인 · 코드 합산',
  });
  return recomputeDispatch(next, graph);
}
