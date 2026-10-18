import { addressKey } from './pyeongtaek-cj-dispatch-import.js';
export function drivingGraph(addresses, legs) {
  const byId = new Map(addresses.map((a) => [a.id, a])),
    byAddress = new Map(),
    roadAliases = new Map(),
    edges = new Map(),
    cache = new Map();
  let stale = 0,
    invalid = 0,
    valid = 0;
  for (const a of addresses)
    for (const text of [a.address, a.address_key, a.standard_address])
      if (text) {
        const key = addressKey(text);
        if (!byAddress.has(key)) byAddress.set(key, new Set());
        byAddress.get(key).add(a.id);
      }
  for (const a of addresses)
    for (const text of [a.standard_address, a.address]) {
      const match = String(text || '').match(
        /([가-힣A-Za-z0-9·]+(?:대로|로|길))\s*(\d+(?:-\d+)?)/,
      );
      if (!match) continue;
      const key = match[1] + match[2];
      if (!roadAliases.has(key)) roadAliases.set(key, new Set());
      roadAliases.get(key).add(a.id);
    }
  for (const leg of legs) {
    const a = byId.get(leg.from_id),
      b = byId.get(leg.to_id),
      coords = String(leg.coords_key || '')
        .split('|')[0]
        .replace('>', ',')
        .split(',')
        .map(Number),
      actual = [a?.x, a?.y, b?.x, b?.y];
    if (
      coords.length !== 4 ||
      coords.some(
        (x, i) =>
          !Number.isFinite(x) ||
          actual[i] == null ||
          Math.abs(x - Number(actual[i])) > 1e-6,
      )
    ) {
      stale++;
      continue;
    }
    if (
      !Number.isFinite(leg.distance_meters) ||
      !Number.isFinite(leg.duration_seconds) ||
      leg.distance_meters < 0 ||
      leg.duration_seconds < 0
    ) {
      invalid++;
      continue;
    }
    if (!edges.has(a.id)) edges.set(a.id, new Map());
    const old = edges.get(a.id).get(b.id);
    if (!old || old.seconds > leg.duration_seconds)
      edges
        .get(a.id)
        .set(b.id, {
          meters: leg.distance_meters,
          seconds: leg.duration_seconds,
          priority: leg.priority,
        });
    valid++;
  }
  function oneLocation(values) {
    if (values.length === 1) return values[0];
    if (values.length > 1) {
      const points = values.map((id) => byId.get(id));
      if (
        points[0].x != null &&
        points.every((p) => p.x === points[0].x && p.y === points[0].y)
      )
        return values[0];
    }
    return null;
  }
  function admin(address) {
    let rest = String(address || '').replace(/\s/g, '');
    const aliases = {
      서울특별시: '서울',
      서울시: '서울',
      서울: '서울',
      부산광역시: '부산',
      부산시: '부산',
      부산: '부산',
      대구광역시: '대구',
      대구: '대구',
      인천광역시: '인천',
      인천: '인천',
      광주광역시: '광주',
      대전광역시: '대전',
      울산광역시: '울산',
      세종특별자치시: '세종',
      경기도: '경기',
      경기: '경기',
      강원특별자치도: '강원',
      강원도: '강원',
      충청북도: '충북',
      충북: '충북',
      충청남도: '충남',
      충남: '충남',
      전북특별자치도: '전북',
      전라북도: '전북',
      전북: '전북',
      전라남도: '전남',
      전남: '전남',
      경상북도: '경북',
      경북: '경북',
      경상남도: '경남',
      경남: '경남',
      제주특별자치도: '제주',
      제주도: '제주',
    };
    let province = null;
    for (const key of Object.keys(aliases).sort((a, b) => b.length - a.length))
      if (rest.startsWith(key)) {
        province = aliases[key];
        rest = rest.slice(key.length);
        break;
      }
    const areas = [];
    for (let i = 0; i < 3; i++) {
      const m = rest.match(/^([가-힣]+?(?:시|군|구))/);
      if (!m) break;
      areas.push(m[1]);
      rest = rest.slice(m[1].length);
    }
    return { province, areas };
  }
  function compatible(a, b) {
    const x = admin(a),
      y = admin(b);
    if (!x.province || !y.province) return false;
    if (x.province && y.province && x.province !== y.province) return false;
    if (
      x.areas.length &&
      y.areas.length &&
      !x.areas.every((v) => y.areas.includes(v))
    )
      return false;
    return !!(x.province || x.areas.length);
  }
  function resolve(address) {
    const key = addressKey(address),
      exact = oneLocation([...(byAddress.get(key) || [])]);
    if (exact) return exact;
    if (!key) return null;
    const candidates = new Set();
    for (const [road, ids] of roadAliases) {
      const i = key.indexOf(road);
      if (i >= 0 && !/[0-9-]/.test(key[i + road.length] || ' '))
        for (const id of ids) {
          const a = byId.get(id);
          if (compatible(address, a.standard_address || a.address))
            candidates.add(id);
        }
    }
    return oneLocation([...candidates]);
  }
  function sameLocation(a, b) {
    const x = resolve(a),
      y = resolve(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const p = byId.get(x),
      q = byId.get(y);
    return p.x != null && p.y != null && p.x === q.x && p.y === q.y;
  }

  function path(from, to) {
    if (!from || !to)
      return { status: 'missing', meters: null, seconds: null, hops: [] };
    if (from === to)
      return { status: 'same_address', meters: 0, seconds: 0, hops: [from] };
    const key = from + '|' + to;
    if (cache.has(key)) return cache.get(key);
    const direct = edges.get(from)?.get(to);
    if (direct) {
      const value = { status: 'direct', ...direct, hops: [from, to] };
      cache.set(key, value);
      return value;
    }
    const dist = new Map([[from, 0]]),
      meters = new Map([[from, 0]]),
      previous = new Map(),
      done = new Set();
    for (;;) {
      let node = null,
        best = Infinity;
      for (const [id, cost] of dist)
        if (!done.has(id) && cost < best) {
          node = id;
          best = cost;
        }
      if (node === null) break;
      if (node === to) break;
      done.add(node);
      for (const [next, leg] of edges.get(node) || []) {
        const value = best + leg.seconds;
        if (value < (dist.get(next) ?? Infinity)) {
          dist.set(next, value);
          meters.set(next, meters.get(node) + leg.meters);
          previous.set(next, node);
        }
      }
    }
    let value = { status: 'missing', meters: null, seconds: null, hops: [] };
    if (dist.has(to)) {
      const hops = [to];
      while (hops[0] !== from) hops.unshift(previous.get(hops[0]));
      value = {
        status: 'composed',
        meters: meters.get(to),
        seconds: dist.get(to),
        hops,
      };
    }
    cache.set(key, value);
    return value;
  }
  function route(
    jobs,
    { origin = '경기도 평택시 산단로 263', departureMinutes = null } = {},
  ) {
    const ordered = [...jobs],
      sections = [];
    let from = resolve(origin),
      minutes = departureMinutes,
      meters = 0,
      seconds = 0,
      complete = true;
    const issues = [],
      deadlineViolations = [];
    let serviceTotal = 0,
      serviceKnown = true;
    for (const j of ordered) {
      const to = resolve(j.address),
        leg = path(from, to);
      sections.push({ jobId: j.id, ...leg });
      if (leg.status === 'missing') {
        complete = false;
        minutes = null;
        issues.push(j.name + ': 주행 연결 확인 필요');
      } else {
        meters += leg.meters;
        seconds += leg.seconds;
        if (minutes !== null) minutes += leg.seconds / 60;
      }
      if (j.deadline != null && minutes !== null && minutes > j.deadline) {
        issues.push(j.name + ': 납품 마감 초과');
        deadlineViolations.push(j.id);
      }
      const service = j.profile?.unloadMinutes,
        inspection = j.profile?.inspectionMinutes,
        margin = j.profile?.marginMinutes;
      if ([service, inspection, margin].every(Number.isFinite)) {
        serviceTotal += service + inspection + margin;
        if (minutes !== null) minutes += service + inspection + margin;
      } else {
        serviceKnown = false;
        minutes = null;
        issues.push(j.name + ': 하차·검수·여유시간 확인 필요');
      }
      from = to;
    }
    return {
      sections,
      complete,
      meters: complete ? meters : null,
      seconds: complete ? seconds : null,
      knownMeters: meters,
      knownSeconds: seconds,
      finishMinutes: minutes,
      elapsedMinutes:
        complete && serviceKnown ? seconds / 60 + serviceTotal : null,
      serviceMinutes: serviceKnown ? serviceTotal : null,
      issues,
      deadlineViolations,
      deadlineVerified:
        !deadlineViolations.length &&
        complete &&
        departureMinutes !== null &&
        minutes !== null &&
        ordered.every((j) => j.deadline != null && !j.conditionReview),
    };
  }
  return {
    resolve,
    path,
    route,
    sameLocation,
    audit: {
      addresses: addresses.length,
      readLegs: legs.length,
      validLegs: valid,
      staleLegs: stale,
      invalidLegs: invalid,
      directedPairs: [...edges.values()].reduce((n, m) => n + m.size, 0),
    },
  };
}
