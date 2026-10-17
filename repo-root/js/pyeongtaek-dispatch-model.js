import solver from 'javascript-lp-solver';

export const DEFAULT_SETTINGS = Object.freeze({
  origin: '\uacbd\uae30\ub3c4 \ud3c9\ud0dd\uc2dc \uc0b0\ub2e8\ub85c 263',
  originAddress: '\uacbd\uae30\ub3c4 \ud3c9\ud0dd\uc2dc \uc0b0\ub2e8\ub85c 263',
  prepareMinutes: 60, yardMinutes: 20, attendedMinutes: 30,
  inspectionMinutes: 30, marginMinutes: 30, maxStops: 5,
  capacities: Object.freeze({ '1': 100, '2.5': 250, '3.5': 350 }),
  freshnessMinutes: 30,
  // Structural limits also bound work when no clock is supplied to this pure API.
  maxPlanningStops: 600, partitionSize: 10, maxCandidates: 80,
  maxSolverCalls: 80, solverTimeoutMs: 25, solverBudgetMs: 1500,
});

const MINUTE = 60000;
const DAY = 1440 * MINUTE;
const text = value => String(value ?? '').trim();
const normalize = value => text(value).normalize('NFKC').replace(/\s+/g, ' ');
const plate = value => normalize(value).replace(/\s+/g, '').toUpperCase();
const clone = value => structuredClone(value);
const unique = values => [...new Set(values.filter(value => value !== '' && value != null))];
const numeric = value => value !== '' && value != null && Number.isFinite(Number(value));
const nonnegative = value => numeric(value) && Number(value) >= 0;
const issue = (code, message, extra = {}, severity = 'warning') => ({ code, message, severity, ...extra });
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;

function sourceVersion(row) {
  const raw = clone(row.source?.raw ?? null);
  if (Array.isArray(raw)) while (raw.length && (raw.at(-1) == null || raw.at(-1) === '')) raw.pop();
  return JSON.stringify([raw, ...['date', 'course', 'customer', 'code', 'name', 'address', 'boxes', 'otd', 'mode', 'notes'].map(key => row[key] ?? null)]);
}

function vehicleKeys(records) {
  const parent = new Map();
  const root = key => {
    if (!parent.has(key)) parent.set(key, key);
    while (parent.get(key) !== key) key = parent.get(key);
    return key;
  };
  for (const r of records) if (text(r.vehicleId) && plate(r.vehicleNumber)) parent.set(root(`plate:${plate(r.vehicleNumber)}`), root(`id:${r.vehicleId}`));
  return r => text(r.vehicleId) ? root(`id:${r.vehicleId}`) : plate(r.vehicleNumber) ? root(`plate:${plate(r.vehicleNumber)}`) : '';
}

function settingsFor(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input, capacities: { ...DEFAULT_SETTINGS.capacities, ...input.capacities } };
  for (const key of ['prepareMinutes', 'yardMinutes', 'attendedMinutes', 'inspectionMinutes', 'marginMinutes', 'freshnessMinutes']) {
    if (!nonnegative(s[key])) s[key] = DEFAULT_SETTINGS[key];
    s[key] = Number(s[key]);
  }
  for (const key of ['maxStops', 'maxPlanningStops', 'partitionSize', 'maxCandidates', 'maxSolverCalls', 'solverTimeoutMs', 'solverBudgetMs']) {
    s[key] = Math.max(1, Math.min(DEFAULT_SETTINGS[key], Math.floor(Number(s[key]) || DEFAULT_SETTINGS[key])));
  }
  s.origin = normalize(input.origin ?? input.originAddress) || DEFAULT_SETTINGS.origin;
  s.originAddress = s.origin;
  return s;
}

function midnight(date) {
  const d = text(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return NaN;
  const n = Date.parse(`${d}T00:00:00+09:00`);
  return Number.isFinite(n) && new Date(n + 9 * 60 * MINUTE).toISOString().slice(0, 10) === d ? n : NaN;
}

function instant(value, date) {
  if (typeof value === 'number') return value >= 0 && value < 1440 ? midnight(date) + value * MINUTE : NaN;
  const v = text(value);
  const m = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(v);
  if (m) return +m[1] < 24 ? midnight(date) + (+m[1] * 60 + +m[2]) * MINUTE + +(m[3] || 0) * 1000 : NaN;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/.test(v)) {
    const explicitDate = v.slice(0, 10);
    if (!Number.isFinite(midnight(explicitDate))) return NaN;
    if (Number(v.slice(11, 13)) > 23 || Number(v.slice(14, 16)) > 59 || (v[16] === ':' && Number(v.slice(17, 19)) > 59)) return NaN;
    return Date.parse(v.replace(' ', 'T') + (/(Z|[+-]\d{2}:\d{2})$/.test(v) ? '' : '+09:00'));
  }
  return NaN;
}

/** OTD bounds are epoch milliseconds, never minutes-of-day; null means unbounded. */
export function parseOTD(value, date) {
  const raw = clone(value ?? '');
  const invalid = () => ({ type: 'invalid', start: null, end: null, raw, valid: false });
  if (value == null || text(value) === '') return { type: 'none', start: null, end: null, raw, valid: true };
  if (typeof value === 'object') {
    const type = value.type;
    if (type === 'none') return { type, start: null, end: null, raw, valid: true };
    if (!['before', 'after', 'window', 'appointment'].includes(type)) return invalid();
    const read = v => typeof v === 'number' && v > 1e11 ? v : instant(v, value.date || date);
    let start = type === 'before' ? null : read(value.start ?? value.time ?? value.value);
    let end = type === 'after' ? null : read(value.end ?? value.time ?? value.value ?? value.start);
    if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))) return invalid();
    if (start !== null && end !== null && start > end) return invalid();
    return { type, start, end, raw, valid: true };
  }
  let s = text(value).replace(/(\d{1,2})\s*\uC2DC(?:\s*(\d{1,2})\s*\uBD84?)?/g, (_, h, m) => `${h}:${(m || '00').padStart(2, '0')}`);
  const matches = [...s.matchAll(/(?:\d{4}-\d{2}-\d{2}[T ])?\d{1,2}:[0-5]\d(?::[0-5]\d)?(?:Z|[+-]\d{2}:\d{2})?/g)];
  if (!matches.length && typeof value === 'number') {
    const n = instant(value, date);
    return Number.isFinite(n) ? { type: 'appointment', start: n, end: n, raw, valid: true } : invalid();
  }
  if (!matches.length || matches.length > 2) return invalid();
  const before = /before|by|\uC774\uC804|\uAE4C\uC9C0/i.test(s);
  const after = /after|\uC774\uD6C4|\uBD80\uD130/i.test(s);
  const rest = s.replace(/(?:\d{4}-\d{2}-\d{2}[T ])?\d{1,2}:[0-5]\d(?::[0-5]\d)?(?:Z|[+-]\d{2}:\d{2})?/g, '')
    .replace(/before|after|appointment|by|\uC774\uC804|\uAE4C\uC9C0|\uC774\uD6C4|\uBD80\uD130|\uC608\uC57D|\uB3C4\uCC29/gi, '').replace(/[\s~\-\u2013\u2014\uFF5E]/g, '');
  if (rest || (before && after && matches.length === 1)) return invalid();
  let a = instant(matches[0][0], date), b = matches[1] ? instant(matches[1][0], date) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return invalid();
  if (matches.length === 2) {
    if (b < a && !/^\d{4}-/.test(matches[1][0])) b += DAY;
    return b < a ? invalid() : { type: 'window', start: a, end: b, raw, valid: true };
  }
  return { type: before ? 'before' : after ? 'after' : 'appointment', start: before ? null : a, end: after ? null : a, raw, valid: true };
}

function bounds(conditions) {
  const parsed = conditions.filter(c => c.valid && c.type !== 'none');
  return { start: Math.max(-Infinity, ...parsed.map(c => c.start ?? -Infinity)), end: Math.min(Infinity, ...parsed.map(c => c.end ?? Infinity)) };
}

/** Overrides may contain settings and byAddress/byId daily stop overrides. */
export function prepareStops(rows, destinations = [], overrides = {}) {
  const settings = settingsFor(overrides.settings || overrides);
  const groups = new Map(), seen = new Map(), issues = [], conflicts = new Set();
  const destinationsByAddress = new Map();
  for (const d of destinations) {
    if (d.center_code && d.center_code !== '002') continue;
    const key = normalize(d.address);
    if (!key) continue;
    if (!destinationsByAddress.has(key)) destinationsByAddress.set(key, []);
    destinationsByAddress.get(key).push(d);
  }
  for (const [index, original] of (rows || []).entries()) {
    const row = clone(original);
    const source = row.source || {};
    const identity = source.file && source.sheet && source.row != null ? JSON.stringify([source.file, source.sheet, source.row]) : row.id != null ? `id:${row.id}` : null;
    if (identity && seen.has(identity)) {
      const prior = seen.get(identity);
      const same = prior.some(r => sourceVersion(r) === sourceVersion(row));
      issues.push(issue(same ? 'duplicate_source' : 'conflicting_source', same ? '동일 원본 행의 중복 합산을 제외했습니다.' : '동일 원본 행의 값이 충돌합니다. 두 원본을 보존했으므로 확인해 주세요.', { rowId: row.id }, same ? 'warning' : 'error'));
      if (same) continue;
      prior.forEach(r => conflicts.add(r)); conflicts.add(row);
      prior.push(row);
    } else if (identity) seen.set(identity, [row]);
    const address = normalize(row.address), key = address || `missing:${index}`;
    if (!groups.has(key)) groups.set(key, { id: `stop-${groups.size + 1}`, address, sourceRows: [] });
    groups.get(key).sourceRows.push(row);
  }
  const stops = [...groups.values()].map(group => {
    const candidates = destinationsByAddress.get(group.address) || [];
    const matched = group.sourceRows.map(r => {
      const code = text(r.code ?? r.destinationCode);
      const exact = candidates.filter(d => code ? text(d.code) === code : normalize(d.name) === normalize(r.name));
      return exact.length === 1 ? exact[0] : null;
    });
    const ds = matched.every(Boolean) ? [...new Set(matched)] : candidates;
    const adjustment = overrides.byId?.[group.id] || overrides.byAddress?.[group.address] || {};
    const sourceRows = group.sourceRows;
    const stopIssues = [];
    const add = (code, message, severity = 'warning') => stopIssues.push(issue(code, message, { stopId: group.id }, severity));
    const connected = new Set(matched.filter(Boolean));
    const profileFor = d => connected.has(d) && d?.dispatch_profile && typeof d.dispatch_profile === 'object' ? d.dispatch_profile : null;
    if (matched.some((d, i) => !d && (candidates.some(c => c.dispatch_profile) || text(sourceRows[i].code ?? sourceRows[i].destinationCode)))) add('ambiguous_profile', '납품정보의 거래처 코드 또는 이름과 주소가 일치하지 않습니다. 연결을 확인하기 전에는 자동 배정하지 않습니다.', 'error');
    if (matched.some(d => !profileFor(d))) add('missing_dispatch_profile', '납품정보 DB 미등록 거래처가 있습니다. 기존 납품정보를 임시 적용하므로 확인해 주세요.');
    if (sourceRows.some(r => conflicts.has(r))) add('conflicting_source', '동일 원본 행의 값이 충돌하므로 자동 배정하지 않습니다.', 'error');
    if (unique(ds.map(d => normalize(d.delivery_location))).length > 1) add('ambiguous_destination', '같은 주소에 서로 다른 납품장소가 있습니다. 동·창고·출입구를 확인하기 전에는 자동 배정하지 않습니다.', 'error');
    const validBoxes = sourceRows.every(r => nonnegative(typeof r.boxes === 'string' ? r.boxes.replace(/,/g, '') : r.boxes));
    const rawBoxes = sourceRows.reduce((sum, r) => sum + (nonnegative(typeof r.boxes === 'string' ? r.boxes.replace(/,/g, '') : r.boxes) ? Number(String(r.boxes).replace(/,/g, '')) : 0), 0);
    if (!validBoxes) add('invalid_boxes', '물량이 누락되었거나 잘못된 값입니다. 원본 값은 보존됩니다.', 'error');
    if (!group.address) add('missing_address', '배정 전에 주소를 확인해 주세요.', 'error');
    const courses = unique(sourceRows.map(r => text(r.course)));
    if (courses.length > 1) add('multiple_courses', '한 착지에 여러 원래 코스가 있습니다. 담당 고정차를 확인해 주세요.');
    if (sourceRows.some(r => !text(r.course))) add('missing_course', '원래 코스가 누락되었습니다. 배정 전에 확인해 주세요.', 'error');
    const dates = unique(sourceRows.map(r => text(r.date)));
    if (dates.length > 1 || (overrides.date && dates.some(d => d !== overrides.date))) add('date_mismatch', '원본 날짜와 배차 기준일이 다릅니다.', 'error');
    const conditions = sourceRows.filter((r, i) => !profileFor(matched[i])).map(r => parseOTD(r.otd, r.date || overrides.date));
    for (const d of ds) {
      if (profileFor(d)) conditions.push(parseOTD(d.dispatch_profile.otd, overrides.date || dates[0]));
      else if (text(d.deadline_text)) conditions.push(parseOTD(d.deadline_text, overrides.date || dates[0]));
      else if (numeric(d.deadline_business_min)) conditions.push(parseOTD(Number(d.deadline_business_min), overrides.date || dates[0]));
    }
    if (adjustment.otd != null) conditions.push(parseOTD(adjustment.otd, overrides.date || dates[0]));
    if (conditions.some(c => !c.valid)) add('invalid_otd', '해석할 수 없는 OTD가 있습니다. 도착 조건을 확인해 주세요.', 'error');
    if (sourceRows.some((r, i) => !profileFor(matched[i]) && !text(r.otd) && text(r.notes)) || ds.some(d => profileFor(d) ? !text(d.dispatch_profile.otd) && text(d.dispatch_profile.notes) : !text(d.deadline_text) && !numeric(d.deadline_business_min) && text(d.memo))) add('notes_without_otd', 'OTD 없이 메모가 있습니다. 메모의 시간 조건을 확인해 주세요.');
    const window = bounds(conditions);
    if (window.start > window.end) add('otd_conflict', '같은 착지의 도착 조건이 서로 충돌합니다.', 'error');
    const modes = unique([...sourceRows.filter((r, i) => !profileFor(matched[i])).map(r => text(r.mode)), ...ds.map(d => text(profileFor(d)?.mode ?? d.delivery_method)), text(adjustment.mode)]);
    const modeText = modes.join(' ');
    const attended = /\battended\b|\uB300\uBA74|\uC720\uC778/i.test(modeText), inspection = /inspection|\uAC80\uC218/i.test(modeText);
    const yard = /yard|unmanned|unattended|\uC57C\uC801|\uBB34\uC778/i.test(modeText);
    const serviceValues = ds.map(d => {
      const p = profileFor(d);
      if (!p) return d.serviceMinutes ?? d.service_minutes ?? ((attended || !yard ? settings.attendedMinutes : settings.yardMinutes) + (inspection ? settings.inspectionMinutes : 0));
      const unload = nonnegative(p.unloadMinutes) ? Number(p.unloadMinutes) : ['unmanned', 'yard'].includes(p.mode) ? settings.yardMinutes : settings.attendedMinutes;
      return unload + (nonnegative(p.inspectionMinutes) ? Number(p.inspectionMinutes) : 0);
    }).filter(nonnegative).map(Number);
    const marginValues = ds.map(d => profileFor(d) ? nonnegative(d.dispatch_profile.marginMinutes) ? d.dispatch_profile.marginMinutes : settings.marginMinutes : d.marginMinutes ?? d.margin_minutes).filter(nonnegative).map(Number);
    const serviceMinutes = nonnegative(adjustment.serviceMinutes) ? Number(adjustment.serviceMinutes) : serviceValues.length ? Math.max(...serviceValues) : (attended || !yard ? settings.attendedMinutes : settings.yardMinutes) + (inspection ? settings.inspectionMinutes : 0);
    if (!modes.length || (!attended && !inspection && !yard)) add('unknown_service_mode', '납품 방식이 미확인입니다. 대면납 기본 서비스 시간을 적용했으므로 확인해 주세요.');
    const marginMinutes = nonnegative(adjustment.marginMinutes) ? Number(adjustment.marginMinutes) : marginValues.length ? Math.max(...marginValues) : settings.marginMinutes;
    const restrictions = ds.map(d => ({ allow_under_1ton: d.allow_under_1ton, allow_under_3_5ton: d.allow_under_3_5ton, allow_over_5ton: d.allow_over_5ton, access_method: d.access_method }));
    if (!restrictions.length || restrictions.some(r => !r.allow_under_1ton && !r.allow_under_3_5ton && !r.allow_over_5ton)) add('entry_unknown', '차량 진입 허용 여부가 미확인입니다. 미체크는 제한 없음이 아닙니다.');
    const regionValues = unique(ds.map(d => normalize(d.region)));
    if (regionValues.length > 1) add('region_conflict', '납품처 권역 정보가 서로 다릅니다.');
    const region = regionValues.length === 1 ? regionValues[0] : group.address.split(' ').slice(0, 2).join(' ');
    return { ...group, name: unique(sourceRows.map(r => text(r.name))).join(' / '), boxes: Math.round(rawBoxes), rawBoxes, validBoxes,
      courses, customers: unique(sourceRows.map(r => text(r.customer))), otd: conditions, mode: modeText, modes,
      notes: unique([...sourceRows.map(r => text(r.notes)), ...ds.map(d => text(profileFor(d)?.notes ?? d.memo))]).join('\n'), serviceMinutes, marginMinutes,
      deliveryProfiles: ds.map(d => ({ destinationId: d.id, code: d.code, name: d.name, source: profileFor(d) ? 'dispatch_profile' : 'legacy', profile: clone(profileFor(d)) })),
      region, restrictions, destinationIds: ds.map(d => d.id), issues: stopIssues };
  });
  return { stops, issues: [...issues, ...stops.flatMap(s => s.issues)] };
}

function allowed(stop, tons) {
  return (stop.restrictions || []).every(r => {
    const access = text(r.access_method).replace(/\s+/g, '');
    const limit = /(\d+(?:\.\d+)?)(?:T|\uD1A4)(\uC774\uC0C1|\uCD08\uACFC|\uC774\uD558|\uBBF8\uB9CC)(?:\uC9C4\uC785)?(\uBD88\uAC00|\uAE08\uC9C0|\uAC00\uB2A5)/i.exec(access);
    if (limit) {
      const threshold = Number(limit[1]);
      const applies = limit[2] === '\uC774\uC0C1' ? tons >= threshold : limit[2] === '\uCD08\uACFC' ? tons > threshold : limit[2] === '\uC774\uD558' ? tons <= threshold : tons < threshold;
      if (limit[3] === '\uAC00\uB2A5' ? !applies : applies) return false;
    } else if (/(?:\d+(?:\.\d+)?(?:T|\uD1A4))|\uC9C4\uC785\uBD88\uAC00/i.test(access)) return false;
    if (!r.allow_under_1ton && !r.allow_under_3_5ton && !r.allow_over_5ton) return true;
    if (tons <= 1) return r.allow_under_1ton === true || r.allow_under_3_5ton === true;
    if (tons <= 3.5) return r.allow_under_3_5ton === true;
    return tons >= 5 && r.allow_over_5ton === true;
  });
}

function cacheFor(addresses = [], legs = []) {
  const byAddress = new Map(), byPair = new Map(), byId = new Map();
  for (const a of addresses) {
    if (a.center_code && a.center_code !== '002') continue;
    if (a.status && a.status !== 'ready') continue;
    byId.set(String(a.id), a);
    const key = normalize(a.address);
    if (!byAddress.has(key)) byAddress.set(key, []);
    byAddress.get(key).push(a.id);
  }
  for (const leg of legs) {
    if (leg.center_code && leg.center_code !== '002') continue;
    if (leg.priority && leg.priority !== 'RECOMMEND') continue;
    const from = byId.get(String(leg.from_id)), to = byId.get(String(leg.to_id));
    if (leg.coords_key) {
      if (!from || !to || ![from.x, from.y, to.x, to.y].every(numeric)) continue;
      const key = `${Number(from.x)},${Number(from.y)}>${Number(to.x)},${Number(to.y)}|diesel|1`;
      if (leg.coords_key !== key) continue;
    }
    const key = JSON.stringify([String(leg.from_id), String(leg.to_id)]);
    const existing = byPair.get(key);
    if (!existing || (Date.parse(leg.measured_at) || 0) > (Date.parse(existing.measured_at) || 0)) byPair.set(key, leg);
  }
  return (from, to) => {
    // Ambiguous addresses/entrances cannot safely be resolved by coordinate equality.
    const a = unique(byAddress.get(normalize(from)) || []), b = unique(byAddress.get(normalize(to)) || []);
    if (a.length !== 1 || b.length !== 1) return null;
    const leg = byPair.get(JSON.stringify([String(a[0]), String(b[0])]));
    return leg && nonnegative(leg.duration_seconds) ? leg : null;
  };
}

function evaluate(route, stops, settings, getLeg, date) {
  const warnings = [];
  const add = (code, message, extra = {}, severity = 'warning') => warnings.push(issue(code, message, { routeId: route.id, ...extra }, severity));
  const usedLegs = [], travel = [];
  let from = settings.originAddress;
  for (const stop of stops) {
    if (!nonnegative(stop.serviceMinutes) || !nonnegative(stop.marginMinutes)) add('invalid_service_time', '서비스 시간과 도착 여유는 0 이상의 분 단위 값이어야 합니다.', { stopId: stop.id }, 'error');
    const leg = getLeg(from, stop.address);
    travel.push(leg ? Number(leg.duration_seconds) / 60 : null);
    usedLegs.push(leg ? clone(leg) : { fromAddress: from, toAddress: stop.address, missing: true });
    if (!leg) add('missing_leg', '방향별 도로 구간이 없습니다. 이동시간을 임의로 계산하지 않았습니다.', { stopId: stop.id, fromAddress: from, toAddress: stop.address });
    else {
      const measured = Date.parse(leg.measured_at), reference = Date.parse(settings.evaluatedAt || settings.now || '');
      if (!Number.isFinite(measured) || !Number.isFinite(reference)) add('freshness_unknown', '구간 조회 시각 또는 검증 기준 시각이 없어 신선도를 확인할 수 없습니다.', { stopId: stop.id });
      else if (measured > reference || reference - measured > settings.freshnessMinutes * MINUTE) add('stale_leg', '오래되었거나 미래 시각으로 기록된 구간 추정치입니다.', { stopId: stop.id });
    }
    if (!allowed(stop, Number(route.tons))) add('entry_restricted', '차량 규격과 납품처 진입 조건이 맞지 않습니다.', { stopId: stop.id }, 'error');
    for (const warning of stop.issues || []) if (['entry_unknown', 'notes_without_otd', 'unknown_service_mode', 'invalid_otd', 'otd_conflict'].includes(warning.code)) warnings.push({ ...warning, routeId: route.id });
    from = stop.address;
  }
  const boxes = stops.reduce((sum, s) => sum + s.boxes, 0), rawBoxes = stops.reduce((sum, s) => sum + s.rawBoxes, 0);
  if (!numeric(route.capacity) || Number(route.capacity) <= 0) add('unknown_capacity', '차량의 CJ 기준량이 확인되지 않았습니다.', {}, 'error');
  else if (boxes > Number(route.capacity)) add('capacity_exceeded', '착지 물량 합계가 확인된 CJ 기준량을 초과합니다.', {}, 'error');
  if (route.type === 'temporary' && stops.length > settings.maxStops) add('too_many_stops', '설정한 임시차 최대 착지 수를 초과합니다.', {}, 'error');
  if (route.interdelivery) add('interdelivery_review', '이배송은 담당자 협의와 확인이 필요합니다.');
  const windows = stops.map(s => bounds(Array.isArray(s.otd) ? s.otd : [parseOTD(s.otd, date)]));
  const unknown = travel.some(v => v == null) || warnings.some(w => w.code === 'invalid_service_time') || stops.some(s => s.issues?.some(i => ['invalid_otd', 'notes_without_otd'].includes(i.code)));
  let infeasible = windows.some(w => w.start > w.end), departure = null, schedule = [];
  if (!unknown && stops.length && !infeasible) {
    // Latest feasible arrival at EVERY stop, propagated backwards through service and travel.
    const latest = Array(stops.length).fill(Infinity);
    for (let i = stops.length - 1; i >= 0; i--) {
      latest[i] = Math.min(windows[i].end, i + 1 < stops.length ? latest[i + 1] - (stops[i].serviceMinutes + travel[i + 1] + stops[i + 1].marginMinutes) * MINUTE : Infinity);
      if (latest[i] < windows[i].start) infeasible = true;
    }
    if (!infeasible) {
      if (Number.isFinite(latest[0])) departure = latest[0] - (travel[0] + stops[0].marginMinutes) * MINUTE;
      else {
        // Without an upper deadline there is no unique latest departure. Choose an earliest-day estimate.
        departure = midnight(date);
        if (Number.isFinite(windows[0].start)) departure = Math.max(departure, windows[0].start - (travel[0] + stops[0].marginMinutes) * MINUTE);
      }
      if (!Number.isFinite(departure)) departure = null;
      let previous = departure;
      if (departure !== null) schedule = stops.map((stop, i) => {
        const roadArrival = previous + travel[i] * MINUTE;
        const arrival = Math.max(roadArrival + stop.marginMinutes * MINUTE, windows[i].start);
        if (arrival > windows[i].end) infeasible = true;
        previous = arrival + stop.serviceMinutes * MINUTE;
        return { stopId: stop.id, arrivalTime: iso(arrival), serviceStartTime: iso(arrival), departureTime: iso(previous), waitingMinutes: (arrival - roadArrival) / MINUTE, marginMinutes: stop.marginMinutes, travelMinutes: travel[i], serviceMinutes: stop.serviceMinutes };
      });
    }
  }
  if (infeasible) add('otd_infeasible', '이 배송 순서로는 모든 도착 조건을 만족할 수 없습니다.', {}, 'error');
  if (unknown || infeasible) { departure = null; schedule = []; }
  const unconstrained = windows.every(w => !Number.isFinite(w.start) && !Number.isFinite(w.end));
  return { ...route, boxes, rawBoxes, stopCount: stops.length, usedLegs, warnings, schedule,
    departureTime: iso(departure), centerEntryTime: departure === null ? null : iso(departure - settings.prepareMinutes * MINUTE),
    timeStatus: infeasible ? 'infeasible' : unknown || departure === null ? 'unknown' : unconstrained ? 'unconstrained' : 'estimated',
    otdCompliance: null, travelMinutes: travel.every(v => v != null) ? travel.reduce((a, b) => a + b, 0) : null };
}

function blocked(stop) { return stop.issues.some(i => i.severity === 'error'); }

function candidatesFor(stops, template, settings, getLeg, date) {
  const candidates = [], seenSets = new Map();
  const ordered = [...stops].sort((a, b) => bounds(a.otd).end - bounds(b.otd).end || a.address.localeCompare(b.address));
  const add = sequence => {
    if (sequence.reduce((n, s) => n + s.boxes, 0) > template.capacity || sequence.some(s => !allowed(s, template.tons))) return null;
    const route = evaluate({ ...template, stopIds: sequence.map(s => s.id) }, sequence, settings, getLeg, date);
    if (route.timeStatus === 'infeasible') return null;
    // Missing legs cannot establish a multi-stop time-feasible grouping.
    if (sequence.length > 1 && route.warnings.some(w => ['missing_leg', 'invalid_otd', 'notes_without_otd'].includes(w.code))) return null;
    const key = [...route.stopIds].sort().join('|');
    const score = (route.travelMinutes || 0) + route.schedule.reduce((n, s) => n + s.waitingMinutes, 0);
    const previous = seenSets.get(key);
    if (previous && previous.score <= score) return null;
    const candidate = { route, score, sequence };
    if (previous) candidates.splice(candidates.indexOf(previous), 1);
    seenSets.set(key, candidate); candidates.push(candidate);
    return candidate;
  };
  let frontier = ordered.map(s => add([s])).filter(Boolean);
  const stopLimit = template.type === 'fixed' ? settings.partitionSize : settings.maxStops;
  // Seed longer alternatives so the bounded beam cannot spend its whole budget on pairs.
  for (const order of [ordered, [...ordered].reverse()]) {
    for (let offset = 0; offset < order.length; offset += stopLimit) {
      for (let length = 2; length <= Math.min(order.length - offset, stopLimit); length++) add(order.slice(offset, offset + length));
    }
  }
  // Beam enumerates route alternatives only; MILP, not this ordering, decides assignments.
  let attempts = 0;
  for (let size = 2; size <= stopLimit && frontier.length && candidates.length < settings.maxCandidates; size++) {
    const next = [];
    for (const base of frontier) {
      for (const stop of ordered) {
        if (++attempts > settings.maxCandidates * 8 || candidates.length >= settings.maxCandidates) break;
        if (base.route.stopIds.includes(stop.id)) continue;
        if (template.type === 'temporary' && base.sequence.some(s => !s.region || s.region !== stop.region)) continue;
        const candidate = add([...base.sequence, stop]);
        if (candidate) next.push(candidate);
      }
      if (attempts > settings.maxCandidates * 8 || candidates.length >= settings.maxCandidates) break;
    }
    frontier = next.sort((a, b) => a.score - b.score).slice(0, 10);
  }
  return candidates;
}

function solveCandidates(candidates, stops, fixed, budget, settings, issues) {
  if (!candidates.length) return [];
  if (budget.calls >= settings.maxSolverCalls || budget.remaining <= 0) {
    budget.exhausted = true;
    return [];
  }
  const timeout = Math.min(settings.solverTimeoutMs, budget.remaining);
  budget.calls++; budget.remaining -= timeout;
  const model = { optimize: 'cost', opType: 'min', constraints: {}, variables: {}, binaries: {}, options: { timeout, tolerance: 0, exitOnCycles: true } };
  const index = new Map(stops.map((s, i) => [s.id, i]));
  stops.forEach((s, i) => {
    model.constraints[`s${i}`] = { equal: 1 };
    model.variables[`u${i}`] = { cost: fixed ? 100000 + Math.min(s.boxes, 100000) : 100000, [`s${i}`]: 1 };
    model.binaries[`u${i}`] = 1;
  });
  if (fixed) model.constraints.vehicle = { max: 1 };
  candidates.forEach((candidate, i) => {
    const v = { cost: 1000 + Math.min(candidate.score, 10000) / 100 + Number(candidate.route.tons) };
    if (fixed) v.vehicle = 1;
    for (const id of candidate.route.stopIds) v[`s${index.get(id)}`] = 1;
    model.variables[`r${i}`] = v; model.binaries[`r${i}`] = 1;
  });
  try {
    const result = solver.Solve(model);
    if (!result.feasible || result.bounded === false) throw new Error('No feasible bounded result');
    // Independently verify integrality AND every model constraint before accepting an incumbent.
    for (const key of Object.keys(model.variables)) {
      const value = result[key] || 0;
      if (!Number.isFinite(value) || Math.abs(value - Math.round(value)) > 1e-6 || value < -1e-6 || value > 1 + 1e-6) throw new Error('Nonbinary incumbent');
    }
    for (const [key, bound] of Object.entries(model.constraints)) {
      const sum = Object.entries(model.variables).reduce((n, [name, variable]) => n + (variable[key] || 0) * (result[name] || 0), 0);
      if ((bound.equal != null && Math.abs(sum - bound.equal) > 1e-6) || (bound.max != null && sum > bound.max + 1e-6)) throw new Error('Invalid incumbent');
    }
    return candidates.filter((_, i) => result[`r${i}`] > 0.5).map(c => c.route);
  } catch (error) {
    issues.push(issue('optimizer_unavailable', '최적화 결과를 검증하지 못했습니다. 해당 묶음을 미배정으로 남겼습니다.', { detail: error.message }));
    return [];
  }
}

export function createDraft({ rows = [], drivers = [], destinations = [], addresses = [], legs = [], date, settings: input = {} } = {}) {
  const settings = settingsFor(input), prepared = prepareStops(rows, destinations, { settings, date, byId: input.byId, byAddress: input.byAddress });
  const { stops } = prepared, issues = [...prepared.issues], routes = [];
  const getLeg = cacheFor(addresses, legs), assigned = new Set();
  const budget = { calls: 0, remaining: settings.solverBudgetMs, exhausted: false };
  if (!Number.isFinite(midnight(date))) issues.push(issue('invalid_date', '배차 기준일을 올바른 YYYY-MM-DD 형식으로 지정해 주세요.', {}, 'error'));
  const eligible = Number.isFinite(midnight(date)) ? stops.filter(s => !blocked(s)).slice(0, settings.maxPlanningStops) : [];
  if (stops.length > settings.maxPlanningStops) issues.push(issue('planning_limit', '자동 계산 착지 수 한도를 넘은 착지는 미배정으로 남깁니다.'));
  const physical = new Map(), courseOwners = new Map(), physicalKey = vehicleKeys(drivers), knownCourses = new Map();
  for (const driver of drivers) {
    const course = normalize(driver.course).replace(/\s/g, '').replace(/(?:호차|차)$/, '');
    if (!course) continue;
    if (!knownCourses.has(course)) knownCourses.set(course, []);
    knownCourses.get(course).push(driver);
  }
  for (const d of drivers) {
    const vehicleKey = physicalKey(d);
    if (d.available !== true || !d.driverId || !vehicleKey || !text(d.course)) continue;
    if (!physical.has(vehicleKey)) physical.set(vehicleKey, []);
    physical.get(vehicleKey).push(d);
    if (!courseOwners.has(text(d.course))) courseOwners.set(text(d.course), new Set());
    courseOwners.get(text(d.course)).add(vehicleKey);
  }
  const driverVehicles = new Map();
  for (const [key, ds] of physical) for (const d of ds) {
    if (!driverVehicles.has(d.driverId)) driverVehicles.set(d.driverId, new Set());
    driverVehicles.get(d.driverId).add(key);
  }
  for (const [vehicleKey, ds] of physical) {
    const d = ds[0], courses = unique(ds.map(r => text(r.course)));
    const capacities = ds.map(r => Number(r.capacity ?? settings.capacities[String(Number(r.tons))]));
    if (unique(ds.map(r => r.driverId)).length > 1 || driverVehicles.get(d.driverId).size > 1 || capacities.some(c => !Number.isFinite(c) || c <= 0) || !numeric(d.tons) || Number(d.tons) <= 0 || unique(ds.map(r => Number(r.tons))).length > 1) {
      issues.push(issue('fixed_vehicle_conflict', '고정기사·실제 차량·기준량 연결 정보를 확인해 주세요.', { vehicleId: vehicleKey })); continue;
    }
    const own = eligible.filter(s => !assigned.has(s.id) && s.courses.length === 1 && courses.includes(s.courses[0]) && courseOwners.get(s.courses[0])?.size === 1);
    if (own.length > settings.partitionSize) issues.push(issue('fixed_candidate_limit', '고정차 후보 탐색 범위를 제한했습니다. 나머지 착지는 임시차 후보로 검토합니다.', { vehicleId: vehicleKey }));
    const subset = [...own].sort((a, b) => bounds(a.otd).end - bounds(b.otd).end || a.address.localeCompare(b.address)).slice(0, settings.partitionSize);
    const template = { id: '', type: 'fixed', course: courses.join(' / '), courses, driverId: d.driverId, driverName: d.driverName || '', vehicleId: d.vehicleId || '', vehicleNumber: d.vehicleNumber || '', tons: Number(d.tons), capacity: Math.min(...capacities), interdelivery: false };
    const chosen = solveCandidates(candidatesFor(subset, template, settings, getLeg, date), subset, true, budget, settings, issues);
    for (const route of chosen) { routes.push(route); route.stopIds.forEach(id => assigned.add(id)); }
  }
  const temporaryGroups = new Map();
  for (const stop of eligible.filter(s => !assigned.has(s.id))) {
    if (stop.courses.length === 1 && !courseOwners.has(stop.courses[0])) issues.push(issue('fixed_driver_absent', '원래 코스에 운행 가능한 고정기사·차량 연결이 없습니다.', { stopId: stop.id }));
    for (const course of stop.courses) {
      const normalizedCourse = normalize(course).replace(/\s/g, '').replace(/(?:호차|차)$/, ''), parent = normalizedCourse.replace(/-\d+$/, '');
      if (parent !== normalizedCourse && !knownCourses.has(normalizedCourse) && knownCourses.has(parent)) {
        issues.push(issue('possible_parent_course', `${course} 연결은 없지만 기본 코스 ${parent}가 있습니다. 같은 차량으로 간주하지 않았으므로 담당자를 확인해 주세요.`, {
          stopId: stop.id, originalCourse: course, possibleParentCourse: parent,
          parentDriverIds: unique(knownCourses.get(parent).map(d => d.driverId)),
        }));
      }
    }
    const key = stop.region || stop.id;
    if (!temporaryGroups.has(key)) temporaryGroups.set(key, []);
    temporaryGroups.get(key).push(stop);
  }
  const sizes = [1, 2.5, 3.5, 5].filter(tons => numeric(settings.capacities[String(tons)]) && Number(settings.capacities[String(tons)]) > 0);
  for (const group of temporaryGroups.values()) {
    group.sort((a, b) => bounds(a.otd).end - bounds(b.otd).end || a.address.localeCompare(b.address));
    for (let offset = 0; offset < group.length; offset += settings.partitionSize) {
      if (budget.calls >= settings.maxSolverCalls || budget.remaining <= 0) { budget.exhausted = true; break; }
      const subset = group.slice(offset, offset + settings.partitionSize), candidates = [];
      for (const tons of sizes) {
        const template = { id: '', type: 'temporary', course: '', driverId: null, driverName: '', vehicleId: null, vehicleNumber: '', tons, capacity: Number(settings.capacities[String(tons)]), interdelivery: false };
        candidates.push(...candidatesFor(subset, template, settings, getLeg, date));
      }
      const chosen = solveCandidates(candidates, subset, false, budget, settings, issues);
      for (const route of chosen) { routes.push(route); route.stopIds.forEach(id => assigned.add(id)); }
    }
  }
  if (budget.exhausted) issues.push(issue('optimizer_budget', '전체 최적화 호출·시간 한도에 도달했습니다. 나머지 착지는 미배정으로 남깁니다.'));
  issues.push(issue('bounded_optimization', '제한된 권역별 후보에서 계산한 초안입니다. 전체 최적 경로를 보장하지 않습니다.'));
  const draft = { stops, routes: routes.map((r, i) => ({ ...r, id: `route-${i + 1}` })), unassigned: stops.filter(s => !assigned.has(s.id)).map(s => s.id), issues, settings, date, version: 1,
    optimization: { solver: 'javascript-lp-solver@1.0.3', calls: budget.calls, allocatedMilliseconds: settings.solverBudgetMs - budget.remaining, bounded: true } };
  return recalculateDraft(draft, { addresses, legs });
}

export function recalculateDraft(draft, { addresses = [], legs = [] } = {}) {
  const next = clone(draft), settings = settingsFor(next.settings);
  for (const stop of next.stops) {
    stop.issues = (stop.issues || []).filter(i => !i.evaluation);
    delete stop.suggestedTons;
  }
  const byId = new Map(next.stops.map(s => [s.id, s]));
  const getLeg = cacheFor(addresses, legs), counts = new Map(), physical = new Map(), physicalKey = vehicleKeys(next.routes);
  const issues = (next.issues || []).filter(i => !i.evaluation && !i.routeId);
  const add = (code, message, extra = {}) => issues.push({ ...issue(code, message, extra, 'error'), evaluation: true });
  next.routes = next.routes.map(route => {
    const stops = [];
    for (const id of route.stopIds || []) {
      if (!byId.has(id)) { add('unknown_stop', '경로에 존재하지 않는 착지가 포함되어 있습니다.', { routeId: route.id, stopId: id }); continue; }
      counts.set(id, (counts.get(id) || 0) + 1); stops.push(byId.get(id));
      const stop = byId.get(id);
      if (route.type === 'fixed' && !route.interdelivery && stop.courses.some(c => !(route.courses || [route.course]).includes(c))) add('foreign_course', '이배송 확인 없이 다른 원래 코스의 착지가 포함되어 있습니다.', { routeId: route.id, stopId: id });
    }
    const result = evaluate(route, stops, settings, getLeg, next.date);
    const key = physicalKey(route);
    if (key) {
      if (!physical.has(key)) physical.set(key, []);
      physical.get(key).push(result);
    }
    issues.push(...result.warnings.map(i => ({ ...i, evaluation: true })));
    return result;
  });
  for (const [id, count] of counts) if (count > 1) add('duplicate_assignment', '같은 착지가 경로에 중복 배정되어 있습니다.', { stopId: id });
  for (const [key, routes] of physical) {
    if (routes.length > 1) add('shared_vehicle', '같은 실제 차량이 여러 경로에 있습니다. 기준량과 동시 운행 여부를 확인해 주세요.', { vehicleId: key });
    const capacity = Math.min(...routes.map(r => Number(r.capacity)));
    if (routes.reduce((sum, r) => sum + r.boxes, 0) > capacity) add('shared_vehicle_capacity', '같은 차량의 경로별 합산 물량이 기준량을 초과합니다.', { vehicleId: key });
  }
  next.unassigned = next.stops.filter(s => !counts.has(s.id)).map(s => s.id);
  for (const id of next.unassigned) {
    const stop = byId.get(id);
    if (blocked(stop)) continue;
    const sizes = [1, 2.5, 3.5, 5].filter(tons => Number(settings.capacities[String(tons)]) >= stop.boxes && Number(settings.capacities[String(tons)]) > 0);
    const code = !sizes.length ? 'no_confirmed_capacity' : !sizes.some(tons => allowed(stop, tons)) ? 'entry_restricted' : 'unassigned_stop';
    const fiveTonCandidate = code === 'no_confirmed_capacity' && !(Number(settings.capacities['5']) > 0) && stop.boxes > Math.max(0, ...[1, 2.5, 3.5].map(tons => Number(settings.capacities[String(tons)]) || 0));
    const message = code === 'no_confirmed_capacity' ? fiveTonCandidate ? '5톤 차량 후보: CJ 기준량 확인 필요. 착지 전체 물량의 수용량과 진입 조건 확인 전에는 배정하지 않습니다.' : '착지 전체 물량을 수용할 확정 CJ 기준량이 없습니다. 차량 기준량을 확인해 주세요.' : code === 'entry_restricted' ? '물량과 진입 조건을 함께 만족하는 차량 규격이 없습니다.' : '제한된 후보·시간 조건에서 배정하지 못한 착지입니다. 담당자 확인이 필요합니다.';
    const warning = { ...issue(code, message, { stopId: id, ...(fiveTonCandidate ? { suggestedTons: 5 } : {}) }), evaluation: true };
    if (fiveTonCandidate) stop.suggestedTons = 5;
    stop.issues.push(warning);
    issues.push(warning);
  }
  next.settings = settings;
  next.issues = issues;
  next.totals = { boxes: next.stops.reduce((sum, s) => sum + s.boxes, 0), rawBoxes: next.stops.reduce((sum, s) => sum + s.rawBoxes, 0),
    assignedBoxes: next.stops.filter(s => counts.has(s.id)).reduce((sum, s) => sum + s.boxes, 0),
    unassignedBoxes: next.stops.filter(s => !counts.has(s.id)).reduce((sum, s) => sum + s.boxes, 0), sourceRows: next.stops.reduce((sum, s) => sum + s.sourceRows.length, 0) };
  return next;
}
