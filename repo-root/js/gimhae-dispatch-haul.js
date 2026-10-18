import {
  calculateHaulCombinations,
  VEHICLES,
  rateFor,
} from './haul-dispatch-calculator.js';

const DESTINATIONS = new Map([
  ['광주', '광주'],
  ['전주', '전주'],
  ['하양', '경산'],
]);
const TYPES_BY_TONS = new Map(
  VEHICLES.map((vehicle) => [
    Number(vehicle.type.replace('톤', '')),
    vehicle.type,
  ]),
);

function regionName(value) {
  if (typeof value !== 'string') return '';
  const region = value.trim().replace(/\s/g, '').replace(/센터$/, '');
  return region === '경산' ? '하양' : region;
}

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function label(counts) {
  return [...VEHICLES]
    .reverse()
    .filter((vehicle) => counts.has(vehicle.type))
    .map((vehicle) => `${vehicle.type} ${counts.get(vehicle.type)}대`)
    .join(' + ');
}

function compareRegion(region, requests, volumes, countExceeded) {
  const destination = DESTINATIONS.get(region) || '';
  const result = {
    region,
    destination,
    status: 'unavailable',
    requestedLabel: '확인 필요',
    bestLabel: '',
    requestedCost: null,
    bestCost: null,
    reason: '',
  };
  if (!destination)
    return { ...result, reason: '비교 가능한 요청 지역이 아닙니다.' };
  if (countExceeded)
    return {
      ...result,
      reason: '요청 차량은 전체 100대까지 비교할 수 있습니다.',
    };

  const requested = new Map();
  let requestedCost = 0;
  for (const request of requests) {
    const tons = numericValue(request?.tons);
    const count = numericValue(request?.count);
    const type = TYPES_BY_TONS.get(tons);
    if (!(tons > 0) || !type)
      return {
        ...result,
        reason: '요청 톤수에 해당하는 차량 단가가 없습니다.',
      };
    if (!Number.isSafeInteger(count) || count < 1 || count > 100)
      return { ...result, reason: '요청 대수는 1~100의 정수여야 합니다.' };
    const rate = rateFor('김해', destination, type);
    if (!Number.isFinite(rate) || rate <= 0)
      return { ...result, reason: '요청 차량의 구간 단가가 없습니다.' };
    requested.set(type, (requested.get(type) || 0) + count);
    requestedCost += rate * count;
  }
  result.requestedLabel = label(requested);
  result.requestedCost = requestedCost;

  if (volumes.length !== 1)
    return {
      ...result,
      reason: volumes.length
        ? '같은 지역의 물량이 중복되어 비교할 수 없습니다.'
        : '해당 지역의 냉동·냉장 물량이 필요합니다.',
    };
  const frozen = numericValue(volumes[0]?.frozen);
  const chilled = numericValue(volumes[0]?.chilled);
  if (
    !Number.isSafeInteger(frozen) ||
    !Number.isSafeInteger(chilled) ||
    frozen < 0 ||
    chilled < 0
  )
    return {
      ...result,
      reason: '냉동·냉장 물량은 각각 0 이상의 정수여야 합니다.',
    };
  if (frozen + chilled === 0)
    return {
      ...result,
      reason: '총 물량이 0팔레트여서 차량을 비교하지 않습니다.',
    };
  if (frozen + chilled > 80)
    return {
      ...result,
      reason: '지역별 총 물량은 80팔레트까지 비교할 수 있습니다.',
    };

  try {
    const [best] = calculateHaulCombinations({
      origin: '김해',
      destination,
      frozen,
      chilled,
      limit: 1,
    });
    if (!best || !Number.isFinite(best.totalCost) || !best.vehicles?.length)
      return { ...result, reason: '비교 가능한 차량 조합을 찾지 못했습니다.' };
    const bestCounts = new Map();
    for (const vehicle of best.vehicles)
      bestCounts.set(vehicle.type, (bestCounts.get(vehicle.type) || 0) + 1);
    const same =
      requested.size === bestCounts.size &&
      [...requested].every(([type, count]) => bestCounts.get(type) === count);
    return {
      ...result,
      status: same ? 'same' : 'different',
      bestLabel: label(bestCounts),
      bestCost: best.totalCost,
    };
  } catch {
    return { ...result, reason: '차량 조합을 계산하지 못했습니다.' };
  }
}

export function compareDispatchHaul(snapshot = {}) {
  const requests = Array.isArray(snapshot?.requests) ? snapshot.requests : [];
  const volumes = Array.isArray(snapshot?.volumes) ? snapshot.volumes : [];
  const groups = new Map();
  let totalCount = 0;
  for (const request of requests) {
    const region = regionName(request?.region);
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push(request);
    const count = numericValue(request?.count);
    if (Number.isSafeInteger(count) && count > 0) totalCount += count;
  }
  return [...groups].map(([region, rows]) =>
    compareRegion(
      region,
      rows,
      volumes.filter((volume) => regionName(volume?.region) === region),
      totalCount > 100,
    ),
  );
}
