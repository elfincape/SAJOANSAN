export interface RequestRow {
  id: string;
  region: string;
  temperature: string;
  tons: number | null;
  count: number;
  carrier: string;
}
export interface TruckRow {
  id: string;
  requestId: string;
  region: string;
  dock: string;
  driver: string;
  vehicle: string;
  phone: string;
  arrival: string;
  loadText: string;
  actualTons: number | null;
  dockManual?: boolean;
  fixedDriverId?: string;
  fixedConfirmed?: boolean;
}
export interface FixedDriver {
  id: string;
  enabled: boolean;
  region: string;
  carrier: string;
  dock: string;
  driver: string;
  vehicle: string;
  phone: string;
  arrival: string;
}
export interface VolumeRow {
  region: string;
  frozen: number | null;
  chilled: number | null;
}
export interface DispatchDraft {
  schemaVersion: 1;
  recordKind: 'draft' | 'fixed-defaults';
  requestPending: boolean;
  replyPending: boolean;
  fixedDrivers: FixedDriver[];
  date: string;
  volumes: VolumeRow[];
  requests: RequestRow[];
  trucks: TruckRow[];
  replyText: string;
  image: string;
  imageName: string;
  instructions: string;
}
export interface AnalysisResult {
  date?: string;
  volumes?: Partial<VolumeRow>[];
  requests?: Partial<RequestRow>[];
  trucks?: Partial<TruckRow>[];
}
export const REGIONS = ['광주', '전주', '하양'];
export const DOCKS: Record<string, string[]> = {
  광주: ['4', '5'],
  전주: ['6'],
  하양: ['2', '3'],
};
export const INSTRUCTIONS =
  '상차 후 사무실 방문\n온도기록지 제출\n(3줄이상, 냉동/냉장 온도 준수)\n서약서 서명 必\n하차후 온도기록지 제출';
export const text = (value: unknown) =>
  value == null ? '' : String(value).trim();
export const uid = () => crypto.randomUUID();
export function validDate(value: unknown): value is string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(value))) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}
export function defaultDate(now = new Date()) {
  const date = new Date(now.getTime() + 9 * 3600000);
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
export function dateLabel(date: string) {
  return validDate(date)
    ? `${date.slice(5).replace('-', '/')} (${'일월화수목금토'[new Date(date + 'T00:00:00Z').getUTCDay()]})`
    : '날짜 미정';
}
export function regionName(value: unknown) {
  const raw = text(value).replace(/센터/g, '').replace(/\s/g, '');
  if (raw === '경산' || raw === '하양' || raw === '0422') return '하양';
  if (raw === '광주' || raw === '0427') return '광주';
  if (raw === '전주' || raw === '1105') return '전주';
  return text(value);
}
export function carrierFor(region: string, date: string) {
  if (['광주', '전주'].includes(regionName(region))) return '광신';
  if (regionName(region) !== '하양' || !validDate(date)) return '';
  return [0, 6].includes(new Date(date + 'T00:00:00Z').getUTCDay())
    ? '해피'
    : '동진';
}
export function numberValue(value: unknown) {
  if (value == null || text(value) === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n! >= 0 && n <= 100000 ? n : null;
}
export function tonnageValue(value: unknown) {
  const match = /^(\d+(?:\.\d+)?)\s*(?:톤|t|tons?)?$/i.exec(text(value));
  return match ? numberValue(match[1]) : null;
}
export function dockNumber(value: unknown) {
  const raw = text(value)
    .replace(/번\s*도크|도크/g, '')
    .trim();
  return /^10[2-6]$/.test(raw) ? raw.slice(2) : raw;
}
export function formatPhone(value: unknown) {
  const raw = text(value);
  const digits = raw.replace(/[\s()-]/g, '');
  return /^01\d{8,9}$/.test(digits)
    ? digits.replace(/^(01\d)(\d{3,4})(\d{4})$/, '$1-$2-$3')
    : raw;
}
export function formatArrival(value: unknown) {
  const raw = text(value).replace(
    /(오전|오후)\s*(1[0-2]|0?[1-9])(?=\s*(?:시|:))/g,
    (_, period: string, hour: string) =>
      String((Number(hour) % 12) + (period === '오후' ? 12 : 0)),
  );
  const match = raw.match(
    /(?<!\d)([01]?\d|2[0-3])\s*(?:시(?:\s*([0-5]?\d)\s*분)?|:([0-5]\d))(?!\d)/,
  );
  return match
    ? `${match[1].padStart(2, '0')}:${(match[2] || match[3] || '0').padStart(2, '0')}`
    : '';
}
function temperatureOf(value: unknown) {
  const raw = text(value);
  const frozen = /냉동/.test(raw);
  const chilled = /냉장/.test(raw);
  return frozen && chilled
    ? '냉동&냉장'
    : frozen
      ? '냉동'
      : chilled
        ? '냉장'
        : '';
}
function requestOrder(a: RequestRow, b: RequestRow) {
  const rank = (r: RequestRow) =>
    temperatureOf(r.temperature) === '냉장' ? 0 : 1;
  return (
    REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region) || rank(a) - rank(b)
  );
}
function orderedTrucks(draft: DispatchDraft) {
  return [...draft.trucks].sort((a, b) => {
    const ra = draft.requests.find((r) => r.id === a.requestId);
    const rb = draft.requests.find((r) => r.id === b.requestId);
    return ra && rb ? requestOrder(ra, rb) : ra ? -1 : rb ? 1 : 0;
  });
}
function replyTons(item: Partial<TruckRow>) {
  return (
    tonnageValue(item.actualTons) ??
    tonnageValue(text(item.loadText).match(/(\d+(?:\.\d+)?)\s*톤/)?.[1])
  );
}
function replyCandidates(
  draft: DispatchDraft,
  item: Partial<TruckRow>,
  rows: TruckRow[],
) {
  const temperature = temperatureOf(item.loadText);
  let candidates = rows.filter((t) => {
    const r = draft.requests.find((r) => r.id === t.requestId);
    return (
      r &&
      r.region === regionName(item.region) &&
      (!temperature || temperatureOf(r.temperature) === temperature)
    );
  });
  const tons = replyTons(item);
  const exact = candidates.filter(
    (t) => draft.requests.find((r) => r.id === t.requestId)?.tons === tons,
  );
  if (tons != null && exact.length) candidates = exact;
  return candidates;
}
function chooseReplySlot(draft: DispatchDraft, candidates: TruckRow[]) {
  const kinds = new Set(
    candidates.map((t) => {
      const r = draft.requests.find((r) => r.id === t.requestId)!;
      return `${temperatureOf(r.temperature)}|${r.tons}|${r.carrier}`;
    }),
  );
  return kinds.size === 1 ? candidates[0] : undefined;
}
export function newRequest(region = '광주'): RequestRow {
  return {
    id: uid(),
    region,
    temperature: '',
    tons: null,
    count: 1,
    carrier: '',
  };
}
export function newTruck(request?: Partial<RequestRow>, index = 0): TruckRow {
  return {
    id: uid(),
    requestId: request?.id || '',
    region: request?.region || '',
    dock: DOCKS[request?.region || '']?.[index] || '',
    driver: '',
    vehicle: '',
    phone: '',
    arrival: '',
    loadText: '',
    actualTons: null,
  };
}
export function newFixedDriver(): FixedDriver {
  return {
    id: uid(),
    enabled: true,
    region: '광주',
    carrier: '',
    dock: '4',
    driver: '',
    vehicle: '',
    phone: '',
    arrival: '',
  };
}
export function normalizeFixedDrivers(rows: Partial<FixedDriver>[] = []) {
  if (!Array.isArray(rows) || rows.length > 100)
    throw Error('고정기사는 최대 100명입니다.');
  const ids = new Set();
  return rows.map((row) => {
    if (!row?.id || ids.has(text(row.id)))
      throw Error('고정기사 ID를 확인해 주세요.');
    ids.add(text(row.id));
    return {
      id: text(row.id),
      enabled: row.enabled !== false,
      region: regionName(row.region),
      carrier: text(row.carrier).slice(0, 40),
      dock: dockNumber(row.dock).slice(0, 20),
      driver: text(row.driver).slice(0, 80),
      vehicle: text(row.vehicle).slice(0, 40),
      phone: formatPhone(row.phone).slice(0, 40),
      arrival: formatArrival(row.arrival).slice(0, 80),
    };
  });
}
export function fixedDriverIssues(rows: FixedDriver[]) {
  const result = [];
  for (const [i, row] of rows.entries()) {
    if (
      !REGIONS.includes(row.region) ||
      !['', '광신', '동진', '해피'].includes(row.carrier) ||
      ![row.dock, row.driver, row.vehicle, row.phone].every(text)
    )
      result.push(
        `고정기사 ${i + 1}: 지역·도크·기사·차량번호·연락처를 확인해 주세요.`,
      );
    if (
      rows
        .slice(0, i)
        .some(
          (r) =>
            r.region === row.region &&
            r.dock === row.dock &&
            (!r.carrier || !row.carrier || r.carrier === row.carrier),
        )
    )
      result.push(`고정기사 ${i + 1}: 같은 지역·도크의 고정기사가 중복됩니다.`);
  }
  return result;
}
export function newDraft(
  date = defaultDate(),
  fixedDrivers: Partial<FixedDriver>[] = [],
): DispatchDraft {
  return {
    schemaVersion: 1,
    recordKind: 'draft',
    requestPending: false,
    replyPending: false,
    fixedDrivers: normalizeFixedDrivers(fixedDrivers).map((r) => ({
      ...r,
      enabled: true,
    })),
    date,
    volumes: REGIONS.map((region) => ({ region, frozen: null, chilled: null })),
    requests: [],
    trucks: [],
    replyText: '',
    image: '',
    imageName: '',
    instructions: INSTRUCTIONS,
  };
}
export function normalizeDraft(
  input: Partial<DispatchDraft> | null | undefined,
): DispatchDraft {
  if (
    !input ||
    input.schemaVersion !== 1 ||
    !validDate(input.date) ||
    !Array.isArray(input.requests) ||
    !Array.isArray(input.trucks) ||
    input.requests.length > 60 ||
    input.trucks.length > 100
  )
    throw Error('저장된 배차 자료 형식을 확인해 주세요.');
  const ids = new Set();
  const requests = input.requests.map((row) => {
    if (!row?.id || ids.has(row.id))
      throw Error('요청 항목 ID를 확인해 주세요.');
    ids.add(row.id);
    return {
      id: text(row.id),
      region: regionName(row.region),
      temperature: text(row.temperature).slice(0, 40),
      tons: tonnageValue(row.tons),
      count:
        Number.isInteger(row.count) && row.count >= 0 && row.count <= 30
          ? row.count
          : 0,
      carrier: text(row.carrier).slice(0, 40),
    };
  });
  const truckIds = new Set();
  const trucks = input.trucks.map((row) => {
    if (!row?.id || truckIds.has(row.id))
      throw Error('차량 항목 ID를 확인해 주세요.');
    truckIds.add(row.id);
    return {
      id: text(row.id),
      requestId: text(row.requestId),
      region: regionName(row.region),
      dock: dockNumber(row.dock).slice(0, 20),
      dockManual: row.dockManual === true,
      driver: text(row.driver).slice(0, 80),
      vehicle: text(row.vehicle).slice(0, 40),
      phone: formatPhone(row.phone).slice(0, 40),
      arrival: formatArrival(row.arrival).slice(0, 80),
      loadText: text(row.loadText).slice(0, 1000),
      actualTons: tonnageValue(row.actualTons),
      fixedDriverId: text(row.fixedDriverId),
      fixedConfirmed: row.fixedConfirmed === true,
    };
  });
  validateVolumes(input.volumes);
  const image = text(input.image);
  return {
    schemaVersion: 1,
    recordKind:
      input.recordKind === 'fixed-defaults' ? 'fixed-defaults' : 'draft',
    requestPending: input.requestPending === true,
    replyPending: input.replyPending === true,
    fixedDrivers: normalizeFixedDrivers(input.fixedDrivers),
    date: input.date,
    requests,
    trucks,
    volumes: REGIONS.map((region) => {
      const row = (input.volumes || []).find(
        (v) => regionName(v.region) === region,
      ) || { frozen: null, chilled: null };
      return {
        region,
        frozen: numberValue(row.frozen),
        chilled: numberValue(row.chilled),
      };
    }),
    image:
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) &&
      image.length <= 2800000
        ? image
        : '',
    imageName: text(input.imageName).slice(0, 200),
    replyText: text(input.replyText).slice(0, 40000),
    instructions: INSTRUCTIONS,
  };
}
function hasVehicleDetails(row: Partial<TruckRow>) {
  return [row.driver, row.vehicle, row.phone].some((value) => text(value));
}
function removeSurplusEmptySlots(draft: DispatchDraft) {
  const remove = new Set<string>();
  for (const request of draft.requests) {
    const rows = draft.trucks.filter((t) => t.requestId === request.id);
    const occupied = rows.filter(
      (t) => hasVehicleDetails(t) || t.fixedDriverId,
    );
    const empty = rows.filter((t) => !hasVehicleDetails(t) && !t.fixedDriverId);
    for (const t of empty.slice(Math.max(0, request.count - occupied.length)))
      remove.add(t.id);
  }
  draft.trucks = draft.trucks.filter((t) => !remove.has(t.id));
}
function loadNote(truck: TruckRow, request: RequestRow) {
  const note = text(truck.loadText);
  const match = note.match(
    /^(?:(냉동\s*[&·/+]?\s*냉장|냉장\s*[&·/+]?\s*냉동|냉동|냉장)\s*)?(?:(\d+(?:\.\d+)?)\s*톤\s*)?(?:상차)?$/,
  );
  if (!match) return note;
  const tons = truck.actualTons ?? request.tons;
  return match[2] && Number(match[2]) !== tons ? note : '';
}
export function filledTruck(row: TruckRow) {
  return [row.driver, row.vehicle, row.phone, row.loadText].some((value) =>
    text(value),
  );
}
export function reconcileDocks(draft: DispatchDraft) {
  for (const truck of draft.trucks) {
    const request = draft.requests.find((r) => r.id === truck.requestId);
    if (request) truck.region = request.region;
    const fixed = (draft.fixedDrivers || []).find(
      (f) => f.id === truck.fixedDriverId,
    );
    if (truck.fixedDriverId) {
      if (
        !fixed?.enabled ||
        !request ||
        fixed.region !== request.region ||
        (fixed.carrier &&
          fixed.carrier !==
            (request.carrier || carrierFor(request.region, draft.date)))
      ) {
        clearFixedAssignment(truck, fixed?.enabled === true);
      } else truck.dock = fixed.dock;
    }
  }
  const used = Object.fromEntries(
    REGIONS.map((region) => [
      region,
      new Set(
        draft.trucks
          .filter(
            (t) => t.region === region && (t.dockManual || t.fixedDriverId),
          )
          .map((t) => t.dock),
      ),
    ]),
  );
  for (const truck of orderedTrucks(draft)) {
    if (truck.dockManual || truck.fixedDriverId) continue;
    if (!truck.requestId) {
      truck.dock = '';
      continue;
    }
    truck.dock =
      DOCKS[truck.region]?.find((dock) => !used[truck.region].has(dock)) || '';
    if (truck.dock) used[truck.region].add(truck.dock);
  }
}
export function syncSlots(draft: DispatchDraft) {
  const next = [...draft.trucks];
  for (const request of draft.requests) {
    let count = next.filter((t) => t.requestId === request.id).length;
    for (let i = next.length - 1; i >= 0 && count > request.count; i--) {
      if (next[i].requestId === request.id) {
        if (
          filledTruck(next[i]) &&
          (!next[i].fixedDriverId || next[i].fixedConfirmed)
        )
          next[i].requestId = '';
        else next.splice(i, 1);
        count--;
      }
    }
    while (count < request.count) {
      const index = lastRequestIndex(next, request.id);
      next.splice(index < 0 ? next.length : index + 1, 0, newTruck(request));
      count++;
    }
  }
  if (next.length > 100)
    throw Error('차량은 최대 100대까지 입력할 수 있습니다.');
  draft.trucks = next;
  reconcileDocks(draft);
  applyFixedDrivers(draft);
}
export function clearFixedAssignment(
  truck: TruckRow,
  preserveConfirmed = false,
) {
  if (preserveConfirmed && truck.fixedConfirmed) {
    truck.fixedDriverId = '';
    truck.fixedConfirmed = false;
    return;
  }
  for (const key of [
    'driver',
    'vehicle',
    'phone',
    'arrival',
    'loadText',
    'fixedDriverId',
  ] as const)
    truck[key] = '';
  truck.actualTons = null;
  truck.fixedConfirmed = false;
}
function fixedMatches(
  draft: DispatchDraft,
  fixed: FixedDriver | undefined,
  truck: TruckRow,
) {
  const request = draft.requests.find((r) => r.id === truck.requestId);
  return (
    fixed?.enabled &&
    request &&
    fixed.region === request.region &&
    fixed.dock === truck.dock &&
    (!fixed.carrier ||
      fixed.carrier ===
        (request.carrier || carrierFor(request.region, draft.date)))
  );
}
export function applyFixedDrivers(draft: DispatchDraft) {
  reconcileDocks(draft);
  const rows = draft.fixedDrivers || [];
  for (const truck of draft.trucks) {
    if (
      truck.fixedDriverId &&
      !fixedMatches(
        draft,
        rows.find((f) => f.id === truck.fixedDriverId),
        truck,
      )
    )
      clearFixedAssignment(truck);
  }
  for (const fixed of rows) {
    if (
      !fixed.enabled ||
      draft.trucks.some((t) => t.fixedDriverId === fixed.id)
    )
      continue;
    const truck = draft.trucks.find(
      (t) =>
        fixedMatches(draft, fixed, t) && !filledTruck(t) && !t.fixedDriverId,
    );
    if (!truck) continue;
    for (const field of ['driver', 'vehicle', 'phone', 'arrival'] as const)
      truck[field] = text(fixed[field]);
    truck.fixedDriverId = fixed.id;
  }
  return draft;
}
function validateVolumes(volumes: Partial<VolumeRow>[] | undefined) {
  if (!Array.isArray(volumes)) throw Error('물량 분석 결과를 확인해 주세요.');
  const unknown = volumes.find((v) => !REGIONS.includes(regionName(v?.region)));
  if (unknown)
    throw Error(
      `물량 지역 '${text(unknown.region) || '미정'}'을 연결하지 못했습니다. 원본을 확인하고 다시 붙여넣어 주세요.`,
    );
  const names = volumes.map((v) => regionName(v.region));
  if (new Set(names).size !== names.length)
    throw Error(
      '같은 지역의 물량이 중복 인식되었습니다. 원본을 확인하고 다시 붙여넣어 주세요.',
    );
}
export function importRequest(draft: DispatchDraft, result: AnalysisResult) {
  if (
    !Array.isArray(result?.requests) ||
    !result.requests.length ||
    result.requests.length > 60
  )
    throw Error(
      '사진에서 차량 요청을 읽지 못했습니다. 요청표가 잘 보이도록 다시 붙여넣어 주세요.',
    );
  validateVolumes(result.volumes);
  const next = {
    ...newDraft(validDate(result.date) ? result.date : draft.date),
    image: draft.image,
    imageName: draft.imageName,
    instructions: INSTRUCTIONS,
    fixedDrivers: normalizeFixedDrivers(draft.fixedDrivers).map((f) => ({
      ...f,
      enabled:
        validDate(result.date) && result.date !== draft.date ? true : f.enabled,
    })),
  };
  next.volumes = REGIONS.map((region) => {
    const row = (result.volumes || []).find(
      (v) => regionName(v.region) === region,
    ) || { frozen: null, chilled: null };
    return {
      region,
      frozen: numberValue(row.frozen),
      chilled: numberValue(row.chilled),
    };
  });
  next.requests = result.requests.map((row) => ({
    ...newRequest(regionName(row.region)),
    temperature: text(row.temperature).slice(0, 40),
    tons: tonnageValue(row.tons),
    count:
      Number.isInteger(row.count) && row.count! > 0 && row.count! <= 30
        ? row.count!
        : 0,
  }));
  if (next.requests.reduce((n, r) => n + r.count, 0) > 100)
    throw Error('요청 대수는 최대 100대입니다.');
  for (const region of REGIONS) {
    const rows = next.requests.filter((r) => r.region === region);
    const chilled = rows.find((r) => temperatureOf(r.temperature) === '냉장');
    const mixed = rows.find(
      (r) => temperatureOf(r.temperature) === '냉동&냉장',
    );
    if (
      rows.length === 2 &&
      chilled &&
      mixed &&
      chilled.tons != null &&
      mixed.tons != null &&
      chilled.tons > mixed.tons
    ) {
      [chilled.temperature, mixed.temperature] = [
        mixed.temperature,
        chilled.temperature,
      ];
    }
  }
  next.requests.sort(requestOrder);
  syncSlots(next);
  return next;
}
const VEHICLE_PATTERN = /(?:[가-힣]{2,3}\s*)?\d{2,3}\s*[가-힣]\s*\d{4}(?!\d)/g;
function sourceReplyVehicles(raw: string) {
  const lines = raw.split(/\r?\n/).map(text);
  const positions = lines.flatMap((line, index) => {
    const plates = [...line.matchAll(VEHICLE_PATTERN)];
    return plates.length ? [{ index, plates }] : [];
  });
  const rows = new Map<string, Partial<TruckRow>>();
  const route = /김해\s*[-ㅡ→~]+\s*(광주|전주|하양|경산)/;
  const timeHeader = (line: string) =>
    route.test(line) && Boolean(formatArrival(line));
  for (const [i, entry] of positions.entries()) {
    const vehicle = entry.plates[0][0].replace(/\s/g, '');
    // Only recover explicit plate/name/phone blocks; leave other layouts to extraction.
    if (
      entry.plates.length !== 1 ||
      lines[entry.index].replace(/\s/g, '') !== vehicle
    )
      continue;
    const end = positions[i + 1]?.index ?? lines.length;
    let body = lines.slice(entry.index + 1, end);
    const nextHeader = body.findIndex(timeHeader);
    if (nextHeader >= 0) body = body.slice(0, nextHeader);
    const previous =
      lines
        .slice((positions[i - 1]?.index ?? -1) + 1, entry.index)
        .filter(Boolean)
        .at(-1) || '';
    const header = timeHeader(previous) ? previous : '';
    const phoneIndex = body.findIndex((line) =>
      /^01\d[\s-]*\d{3,4}[\s-]*\d{4}$/.test(line),
    );
    const driver = body.slice(0, phoneIndex).filter(Boolean).at(-1) || '';
    const region = regionName(
      (body.join('\n').match(route) || header.match(route))?.[1],
    );
    const loading = body
      .filter((line) => /^(?:냉동|냉장)/.test(line))
      .join(' ');
    if (
      phoneIndex < 0 ||
      !/^[가-힣]{2,6}$/.test(driver) ||
      !region ||
      !temperatureOf(loading)
    )
      continue;
    const times = [
      ...new Set([header, ...body].map(formatArrival).filter(Boolean)),
    ];
    if (times.length > 1) continue;
    rows.set(vehicle, {
      region,
      vehicle,
      driver,
      phone: formatPhone(body[phoneIndex]),
      arrival: times[0] || '',
      loadText: loading,
      actualTons: tonnageValue(loading.match(/(\d+(?:\.\d+)?)\s*톤/)?.[1]),
    });
  }
  return rows;
}
export function applyReply(draft: DispatchDraft, result: AnalysisResult) {
  if (
    !Array.isArray(result?.trucks) ||
    !result.trucks.length ||
    !result.trucks.some(hasVehicleDetails) ||
    result.trucks.length > 100
  )
    throw Error(
      '회신에서 차량정보를 읽지 못했습니다. 직접 입력하거나 원문을 확인해 주세요.',
    );
  const recovered = sourceReplyVehicles(draft.replyText);
  const extracted = new Map<string, Partial<TruckRow>>();
  const analyzed = result.trucks.filter(
    (t) => !recovered.has(text(t.vehicle).replace(/\s/g, '')),
  );
  for (const row of analyzed) {
    const key = text(row.vehicle).replace(/\s/g, '') || uid();
    const supplied = Object.fromEntries(
      Object.entries(row).filter(
        ([, value]) => value != null && text(value) !== '',
      ),
    );
    extracted.set(key, { ...extracted.get(key), ...supplied });
  }
  for (const [vehicle, row] of recovered) extracted.set(vehicle, row);
  const sourcePlates = new Set(
    [...draft.replyText.matchAll(VEHICLE_PATTERN)].map((m) =>
      m[0].replace(/\s/g, ''),
    ),
  );
  if ([...sourcePlates].some((vehicle) => !extracted.has(vehicle)))
    throw Error(
      '원문에 있는 차량이 분석 결과에서 누락됐습니다. 원문은 유지됩니다. 다시 분석하거나 차량정보를 확인해 주세요.',
    );
  const trucks = [...extracted.values()];
  removeSurplusEmptySlots(draft);
  const used = new Set<string>();
  const plate = (value: unknown) => text(value).replace(/\s/g, '');
  const incoming = new Set(
    trucks.map((t) => `${regionName(t.region)}|${plate(t.vehicle)}`),
  );
  // Resolve the most specific replies first so an incomplete reply cannot take their slot.
  const replies = trucks
    .filter(hasVehicleDetails)
    .sort(
      (a, b) =>
        Number(Boolean(temperatureOf(b.loadText))) +
        Number(replyTons(b) != null) -
        Number(Boolean(temperatureOf(a.loadText))) -
        Number(replyTons(a) != null),
    );
  for (const item of replies) {
    const region = regionName(item.region),
      vehicle = plate(item.vehicle);
    let target = vehicle
      ? draft.trucks.find(
          (t) => plate(t.vehicle) === vehicle && t.region === region,
        )
      : undefined;
    if (
      target &&
      !replyCandidates(draft, item, draft.trucks).some(
        (t) => t.id === target!.id,
      )
    ) {
      const replacement = chooseReplySlot(
        draft,
        replyCandidates(
          draft,
          item,
          draft.trucks.filter(
            (t) =>
              t !== target &&
              !used.has(t.id) &&
              !t.fixedDriverId &&
              (!hasVehicleDetails(t) ||
                incoming.has(`${t.region}|${plate(t.vehicle)}`)),
          ),
        ),
      );
      if (replacement && !target.fixedDriverId) {
        [target.requestId, replacement.requestId] = [
          replacement.requestId,
          target.requestId,
        ];
        if (!replacement.requestId && !hasVehicleDetails(replacement))
          draft.trucks = draft.trucks.filter((t) => t !== replacement);
      } else if (!target.fixedDriverId) {
        const previous = draft.requests.find((r) => r.id === target!.requestId);
        target.requestId = '';
        if (previous) draft.trucks.push(newTruck(previous));
      }
    }
    target ||= chooseReplySlot(
      draft,
      replyCandidates(
        draft,
        item,
        draft.trucks.filter((t) => !hasVehicleDetails(t) && !used.has(t.id)),
      ),
    );
    if (!target) {
      target = newTruck(
        undefined,
        draft.trucks.filter((t) => t.region === region).length,
      );
      target.region = region;
      draft.trucks.push(target);
    }
    if (
      target.fixedDriverId &&
      text(item.driver) &&
      text(target.driver) &&
      text(item.driver) !== text(target.driver)
    ) {
      target.fixedDriverId = '';
      target.fixedConfirmed = false;
    }
    if (recovered.has(vehicle)) target.arrival = '';
    for (const field of [
      'driver',
      'vehicle',
      'phone',
      'arrival',
      'loadText',
    ] as const)
      if (text(item[field]))
        target[field] = (
          field === 'phone'
            ? formatPhone(item[field])
            : field === 'arrival'
              ? formatArrival(item[field])
              : text(item[field])
        ).slice(0, field === 'loadText' ? 1000 : 80);
    if (replyTons(item) != null) target.actualTons = replyTons(item);
    if (target.fixedDriverId) target.fixedConfirmed = true;
    used.add(target.id);
  }
  removeSurplusEmptySlots(draft);
  if (draft.trucks.length > 100)
    throw Error('차량은 최대 100대까지 입력할 수 있습니다.');
  reconcileDocks(draft);
  return draft;
}
export function issues(draft: DispatchDraft, complete = false) {
  const result = [];
  if (draft.requestPending)
    result.push('현재 사진 분석이 완료되지 않았습니다.');
  if (!validDate(draft.date)) result.push('기준날짜를 확인해 주세요.');
  if (!draft.requests.length) result.push('CJ 요청 사진을 붙여넣어 주세요.');
  result.push(
    ...fixedDriverIssues((draft.fixedDrivers || []).filter((f) => f.enabled)),
  );
  for (const [i, r] of draft.requests.entries()) {
    if (
      !REGIONS.includes(r.region) ||
      !text(r.temperature) ||
      !(r.tons! > 0) ||
      !Number.isInteger(r.count) ||
      r.count < 1 ||
      r.count > 30
    )
      result.push(`요청 ${i + 1}: 지역·온도·톤수·대수를 확인해 주세요.`);
  }
  if (draft.requests.reduce((n, r) => n + r.count, 0) > 100)
    result.push('요청 대수는 최대 100대입니다.');
  for (const region of new Set(draft.requests.map((r) => r.region))) {
    const volume = draft.volumes.find((v) => v.region === region);
    if (
      !volume ||
      ![volume.frozen, volume.chilled].every(
        (n) => Number.isFinite(n) && n! >= 0,
      )
    )
      result.push(
        `${region}: 물량 인식이 불완전합니다. 사진을 다시 분석해 주세요.`,
      );
  }
  if (complete) {
    if (draft.replyPending)
      result.push('현재 운수사 회신 분석이 완료되지 않았습니다.');
    for (const [i, t] of draft.trucks.entries()) {
      const request = draft.requests.find((r) => r.id === t.requestId);
      if (
        request &&
        temperatureOf(t.loadText) &&
        temperatureOf(t.loadText) !== temperatureOf(request.temperature)
      )
        result.push(
          `차량 ${i + 1}: 회신 온도와 연결된 요청이 다릅니다. 연결할 요청을 확인해 주세요.`,
        );
      if (!draft.requests.some((r) => r.id === t.requestId))
        result.push(`차량 ${i + 1}: 연결할 요청을 선택해 주세요.`);
      if (![t.driver, t.vehicle, t.phone, t.dock].every((value) => text(value)))
        result.push(
          `차량 ${i + 1}: 기사·차량번호·연락처·도크를 확인해 주세요.`,
        );
    }
    for (const r of draft.requests)
      if (draft.trucks.filter((t) => t.requestId === r.id).length < r.count)
        result.push(`${r.region}: 요청 차량 칸을 확인해 주세요.`);
  }
  return result;
}
function volumeLines(draft: DispatchDraft, regions: string[]) {
  return [
    '예상출고량',
    ...draft.volumes
      .filter((v) => regions.includes(v.region))
      .map(
        (v) =>
          ` - ${v.region} : 냉동 ${v.frozen ?? '미정'}p, 냉장 ${v.chilled ?? '미정'}p`,
      ),
  ].join('\n');
}
function requestLine(draft: DispatchDraft, request: RequestRow) {
  const trucks = draft.trucks.filter((t) => t.requestId === request.id);
  const docks = [
    ...new Set(
      draft.trucks
        .filter((t) => t.requestId === request.id)
        .map((t) => t.dock)
        .filter(Boolean),
    ),
  ];
  const line = ` - ${request.temperature || '온도 미정'} ${request.tons! > 0 ? request.tons : '미정'}톤 ${request.count}대${docks.length ? ` (${docks.join('·')}번 도크)` : ''}`;
  return [
    line,
    ...trucks
      .filter((t) => t.fixedDriverId)
      .map(
        (t) =>
          `   고정기사 (${t.dock || '미정'}번 도크) ${[t.vehicle, t.driver, formatPhone(t.phone)].filter(Boolean).join(' ')}`,
      ),
  ].join('\n');
}
export function messages(draft: DispatchDraft) {
  const output = [],
    carriers = [
      ...new Set(
        draft.requests
          .map((r) => r.carrier || carrierFor(r.region, draft.date))
          .filter(Boolean),
      ),
    ];
  for (const carrier of carriers) {
    const rows = [...draft.requests]
      .sort(requestOrder)
      .filter(
        (r) =>
          (r.carrier || carrierFor(r.region, draft.date)) === carrier &&
          r.count > 0,
      );
    const regions = [...new Set(rows.map((r) => r.region))];
    let body =
      dateLabel(draft.date) +
      '\n' +
      regions
        .map(
          (region) =>
            `■${region}\n${rows
              .filter((r) => r.region === region)
              .map((r) => requestLine(draft, r))
              .join('\n')}`,
        )
        .join('\n\n');
    body += '\n\n' + INSTRUCTIONS;
    if (carrier === '광신') {
      output.push({
        key: 'carrier-광신',
        title: '광신 · 배차 요청',
        text: body,
      });
      output.push({
        key: 'volume-광신',
        title: '광신 · 예상출고량',
        text: volumeLines(draft, regions),
      });
    } else
      output.push({
        key: 'carrier-' + carrier,
        title: carrier + ' · 배차 요청·물량',
        text: body + '\n\n' + volumeLines(draft, regions),
      });
  }
  const cj = [dateLabel(draft.date)],
    summary = [dateLabel(draft.date), '차량 운영 현황'];
  for (const region of REGIONS) {
    const trucks = orderedTrucks(draft).filter(
      (t) =>
        draft.requests.find((r) => r.id === t.requestId)?.region === region,
    );
    if (!trucks.length) continue;
    cj.push('■' + region);
    for (const t of trucks) {
      const r = draft.requests.find((r) => r.id === t.requestId)!;
      cj.push(
        ` - ${temperatureOf(t.loadText) || r.temperature || '온도 미정'} ${t.actualTons ?? (r.tons! > 0 ? r.tons : '미정')}톤 1대 (${t.dock || '미정'}번 도크) ${[t.vehicle, t.driver, formatPhone(t.phone)].filter(Boolean).join(' ') || '배차 확인 필요'}`,
      );
      const note = loadNote(t, r);
      if (note) cj.push(note);
      summary.push(
        `${region} ${temperatureOf(t.loadText) || r.temperature} ${t.actualTons ?? r.tons ?? '미정'}톤 ${t.vehicle.match(/\d{4}$/)?.[0] || t.vehicle} ${formatArrival(t.arrival)}`.trim(),
      );
    }
    cj.push('');
  }
  output.push(
    { key: 'cj', title: 'CJ · 배차현황', text: cj.join('\n').trim() },
    { key: 'summary', title: '차량 운영 현황', text: summary.join('\n') },
  );
  return output;
}

function lastRequestIndex(rows: TruckRow[], id: string) {
  for (let index = rows.length - 1; index >= 0; index--)
    if (rows[index].requestId === id) return index;
  return -1;
}
