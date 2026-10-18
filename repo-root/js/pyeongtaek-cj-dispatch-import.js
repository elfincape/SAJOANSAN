import { parseOTD } from './pyeongtaek-dispatch-model.js';
import {
  normalizeValue,
  parseNormalizedSheet,
} from './pyeongtaek-charter-model.js';
export const clean = (v) => String(v ?? '').trim();
export const routeKey = (v) => clean(v).replace(/\s+/g, '');
export const nameKey = (v) =>
  clean(v)
    .replace(/주식회사|\(주\)|㈜|（주）/g, '')
    .replace(/[\s.,·]/g, '')
    .toLowerCase();
export const addressKey = (v) => clean(v).replace(/[\s,]/g, '');
const validText = (v) => !!clean(v) && !/^#|^0$|비어\s*있음/.test(clean(v));
const num = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const dateText = (v, XLSX) =>
  normalizeValue(v, 'date', { XLSX, year: new Date().getFullYear() });
export function parseCJWorkbook(workbook, XLSX, { date } = {}) {
  if (!workbook.Sheets['사조'] || !workbook.Sheets['한성'])
    throw Error('CJ 지시서의 사조·한성 시트가 필요합니다.');
  const rows = (n) =>
    XLSX.utils.sheet_to_json(workbook.Sheets[n] || {}, {
      header: 1,
      defval: null,
      range: 0,
    });
  const raw = rows('사조RAW'),
    modes = new Map(),
    dates = new Map();
  for (const r of raw.slice(1)) {
    const d = dateText(r[0], XLSX);
    if (d) dates.set(d, (dates.get(d) || 0) + 1);
    const key = routeKey(r[13]),
      label = clean(r[14]);
    if (!key) continue;
    const kind = /임시/.test(label)
      ? 'temporary'
      : /지입/.test(label)
        ? 'fixed'
        : 'external';
    if (!modes.has(key)) modes.set(key, new Set());
    modes.get(key).add(kind);
  }
  const sourceDates = [...dates.keys()].sort();
  const businessDate = date || sourceDates.at(-1);
  if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate))
    throw Error('배차일자를 확인해 주세요.');
  if (date && sourceDates.length && !sourceDates.includes(date))
    throw Error(
      '선택 일자가 CJ RAW의 출고일자에 없습니다. 파일과 일자를 확인해 주세요.',
    );
  const fleet = [];
  for (const r of rows('DM마스터').slice(2))
    if (validText(r[0]) && validText(r[1]))
      fleet.push({
        id: routeKey(r[0]),
        route: clean(r[0]),
        plate: clean(r[1]),
        driver: clean(r[5]),
        tons: num(r[7]),
        region: clean(r[4]),
        source: 'CJ DM마스터',
      });
  const fleetKeys = new Set(fleet.map((x) => x.id)),
    hansungOwners = new Map();
  for (const r of rows('한성거래처마스터').slice(1))
    if (validText(r[0])) hansungOwners.set(routeKey(r[0]), clean(r[3]));
  const jobs = [],
    issues =
      sourceDates.length > 1
        ? [
            {
              message:
                '화주별 출고일자가 다릅니다: ' +
                sourceDates.join(', ') +
                ' · 선택 배차일 ' +
                businessDate,
            },
          ]
        : [];
  let owner = '';
  for (const [i, r] of rows('사조').entries()) {
    if (i < 3) continue;
    if (validText(r[0])) owner = clean(r[0]);
    if (
      !validText(r[4]) ||
      !validText(r[5]) ||
      /요약|총합계/.test(owner) ||
      /납품처코드/.test(clean(r[4]))
    )
      continue;
    const quantity = num(r[10]);
    if (quantity === null) {
      issues.push({ source: '사조', row: i + 1, message: '물량 확인 필요' });
      continue;
    }
    if (quantity === 0) continue;
    const key = routeKey(owner),
      kinds = modes.get(key),
      kind =
        kinds?.size === 1
          ? [...kinds][0]
          : fleetKeys.has(key)
            ? 'fixed'
            : kinds?.has('temporary')
              ? 'review'
              : 'external';
    jobs.push({
      id: 'sajo:' + clean(r[4]),
      source: 'sajo',
      code: clean(r[4]),
      name: clean(r[5]),
      address: validText(r[7]) ? clean(r[7]) : '',
      ownerRoute: owner,
      kind,
      tons: num(r[3]),
      quantity,
      frozen: num(r[8]),
      chilled: num(r[9]),
      customer: clean(r[6]),
      sourceRow: i + 1,
      sourceSheet: '사조',
    });
  }
  for (const [i, r] of rows('한성').entries()) {
    if (
      i < 3 ||
      !validText(r[0]) ||
      !validText(r[1]) ||
      /총합계|요약/.test(clean(r[0]))
    )
      continue;
    const quantity = num(r[6]);
    if (quantity === null || quantity === 0) continue;
    const mapped = hansungOwners.get(routeKey(r[0])),
      route = validText(r[3]) ? clean(r[3]) : mapped || '';
    jobs.push({
      id: 'hansung:' + routeKey(r[0]),
      source: 'hansung',
      code: '',
      name: clean(r[0]),
      deliveryName: clean(r[1]),
      address: validText(r[2]) ? clean(r[2]) : '',
      ownerRoute: route,
      kind: fleetKeys.has(routeKey(route))
        ? 'fixed'
        : route
          ? 'external'
          : 'review',
      quantity,
      frozen: num(r[4]),
      chilled: num(r[5]),
      customer: '한성',
      sourceRow: i + 1,
      sourceSheet: '한성',
    });
  }
  if (!jobs.length) throw Error('CJ 지시서에서 상세 물량을 찾지 못했습니다.');
  const consolidated = new Map();
  for (const job of jobs) {
    const prior = consolidated.get(job.id);
    if (!prior) {
      consolidated.set(job.id, { ...job, sourceRows: [job.sourceRow] });
      continue;
    }
    if (routeKey(prior.ownerRoute) !== routeKey(job.ownerRoute)) {
      prior.kind = 'review';
      issues.push({
        id: job.id,
        message: '같은 착지에 원래 호차가 여러 개입니다.',
      });
    }
    prior.quantity += job.quantity;
    prior.frozen =
      prior.frozen === null || job.frozen === null
        ? null
        : prior.frozen + job.frozen;
    prior.chilled =
      prior.chilled === null || job.chilled === null
        ? null
        : prior.chilled + job.chilled;
    prior.sourceRows.push(job.sourceRow);
  }
  return {
    schemaVersion: 1,
    date: businessDate,
    jobs: [...consolidated.values()],
    fleet,
    issues,
    sourceDates,
    quantityUnit: '박스환산',
    sourceCount: jobs.length,
  };
}
export function actualWorkbookTrips(workbook, XLSX) {
  const sheet = workbook.SheetNames.find(
    (n) =>
      workbook.Sheets[n]?.['B3'] &&
      /사용일자|일자/.test(clean(workbook.Sheets[n]['B3'].v)),
  );
  if (!sheet) throw Error('실배차 내역의 B~U열 상세 시트를 찾지 못했습니다.');
  return parseNormalizedSheet(workbook.Sheets[sheet], XLSX, {
    sheetName: sheet,
    centerCode: '002',
  })
    .filter((t) => clean(t.course) && clean(t.type))
    .map((t) => ({
      ...t,
      deliveries: t.deliveries.filter(
        (d) => validText(d.name) && typeof d.quantity === 'number',
      ),
    }))
    .filter((t) => t.deliveries.length);
}
function pointIndex(points) {
  const index = new Map();
  for (const p of points) {
    const code = clean(p.code);
    if (!code) continue;
    if (!index.has(code)) index.set(code, []);
    index.get(code).push(p);
  }
  return index;
}
export function normalizeDispatchJobs(
  parsed,
  { points = [], aliases = [], graph = null } = {},
) {
  const index = pointIndex(points),
    enriched = parsed.jobs.map((j) => {
      const ps = index.get(j.code) || [],
        point = ps.length === 1 ? ps[0] : null,
        profile = point?.dispatch_profile || null,
        otd = parseOTD(
          profile
            ? profile.otd
            : point?.deadline_business_min == null
              ? null
              : { type: 'before', time: point.deadline_business_min },
          parsed.date,
        ),
        midnight = Date.parse(parsed.date + 'T00:00:00+09:00'),
        minute = (v) => (v == null ? null : (v - midnight) / 60000);
      return {
        ...j,
        address: j.address || point?.address || '',
        pointId: point?.id || null,
        profile,
        earliestArrival: minute(otd.start),
        deadline: minute(otd.end),
        otdInvalid: !otd.valid,
        conditionReview: !otd.valid,
        issues: [
          ...(ps.length > 1 ? ['납품처 마스터 코드 중복'] : []),
          ...(!otd.valid ? ['납품정보 OTD 해석 확인 필요'] : []),
        ],
      };
    });
  const byId = new Map(enriched.map((j) => [j.id, j])),
    parent = new Map(enriched.map((j) => [j.id, j.id]));
  const find = (k) => {
    while (parent.get(k) !== k) k = parent.get(k);
    return k;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent.set(b, a);
  };
  const sameLocation = (a, b) =>
    !!a.address &&
    !!b.address &&
    (addressKey(a.address) === addressKey(b.address) ||
      graph?.sameLocation(a.address, b.address));
  for (const [a, b] of aliases) {
    if (!byId.has(a) || !byId.has(b)) continue;
    const x = byId.get(a),
      y = byId.get(b);
    if (sameLocation(x, y)) union(a, b);
    else {
      const warning =
        '과거 동일 착지 이력과 현재 주소가 다르거나 미확인입니다. 하차 단위 확인 필요';
      x.issues.push(warning);
      y.issues.push(warning);
    }
  }
  const samePlace = new Map();
  for (const j of enriched) {
    if (!j.address) continue;
    const key = [
      nameKey(j.deliveryName || j.name),
      addressKey(j.address),
      routeKey(j.ownerRoute),
    ].join('|');
    if (samePlace.has(key)) union(samePlace.get(key), j.id);
    else samePlace.set(key, j.id);
  }
  const grouped = new Map();
  for (const j of enriched) {
    const k = find(j.id);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(j);
  }
  return [...grouped.values()].map((members) => {
    const first = members[0],
      owners = new Set(members.map((j) => routeKey(j.ownerRoute))),
      kinds = new Set(members.map((j) => j.kind)),
      deadlines = members.map((j) => j.deadline).filter(Number.isFinite),
      profile = { ...(first.profile || {}) };
    let conditionReview = members.some((j) => j.conditionReview);
    for (const k of ['unloadMinutes', 'inspectionMinutes', 'marginMinutes']) {
      const values = members.map((j) => j.profile?.[k] ?? null);
      if (values.some((v) => v !== values[0])) conditionReview = true;
      profile[k] = values.every((v) => v === values[0]) ? values[0] : null;
    }
    if (members.some((j) => j.deadline !== first.deadline))
      conditionReview = true;
    return {
      ...first,
      id: members
        .map((j) => j.id)
        .sort()
        .join('+'),
      memberIds: members.map((j) => j.id),
      members,
      profile,
      deadline: deadlines.length ? Math.min(...deadlines) : null,
      conditionReview,
      earliestArrival: members.some((j) => Number.isFinite(j.earliestArrival))
        ? Math.max(
            ...members.map((j) => j.earliestArrival).filter(Number.isFinite),
          )
        : null,
      otdInvalid: members.some((j) => j.otdInvalid),
      quantity: members.reduce((n, j) => n + j.quantity, 0),
      frozen: members.every((j) => j.frozen !== null)
        ? members.reduce((n, j) => n + j.frozen, 0)
        : null,
      chilled: members.every((j) => j.chilled !== null)
        ? members.reduce((n, j) => n + j.chilled, 0)
        : null,
      name: [...new Set(members.map((j) => j.name))].join(' / '),
      kind: owners.size > 1 || kinds.size > 1 ? 'review' : first.kind,
      issues: [
        ...new Set(members.flatMap((j) => j.issues)),
        ...(owners.size > 1 ? ['원래 호차 충돌'] : []),
      ],
    };
  });
}
