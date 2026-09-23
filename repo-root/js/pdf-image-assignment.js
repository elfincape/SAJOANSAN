import { validDate } from './driver-health.js';

export function validateAssignments(cards, shared, drivers, companies) {
  const selected = cards.filter(card => card.selected && card.kind && card.kind !== 'skip');
  if (!selected.length) throw new Error('서류 종류가 지정된 등록 대상 페이지가 없습니다.');
  if (!shared.driverId && !shared.companyId) throw new Error('기사 또는 운수사를 선택해 주세요.');
  if (shared.driverId) {
    const driver = drivers.find(row => row.id === shared.driverId);
    if (!driver || driver.center_code !== shared.center) throw new Error('기사 정보의 기사와 센터가 일치하지 않습니다.');
  }
  if (shared.companyId && !companies.some(row => row.id === shared.companyId && row.center_code === shared.center))
    throw new Error('기사 정보의 운수사가 센터와 일치하지 않습니다.');
  const keys = new Set();
  for (const card of selected) {
    if (!shared.driverId && !['food_transport','food_transport_back','livestock_transport','livestock_transport_back'].includes(card.kind))
      throw new Error('운수사에는 식품/축산물운반업 앞·뒤 서류만 등록할 수 있습니다. 다른 서류는 기사를 선택해 주세요.');
    if (card.kind === 'health_certificate' && !validDate(shared.expiry)) throw new Error('기사 정보에서 보건증 만료일을 입력해 주세요.');
    const key = card.kind;
    if (keys.has(key) && !['food_transport_back','livestock_transport_back'].includes(key)) throw new Error('같은 대상의 앞면 및 단일 서류는 한 장만 선택해 주세요. 뒷면은 여러 장 등록할 수 있습니다.');
    keys.add(key);
  }
  return selected.map(card => ({ ...card, ...shared }));
}
