import { validDate } from './driver-health.js';

export function validateAssignments(cards, shared, drivers, companies) {
  const selected = cards.filter(card => card.selected);
  if (!selected.length) throw new Error('등록할 페이지를 선택해 주세요.');
  if (!shared.driverId) throw new Error('기사 정보에서 기사를 선택해 주세요.');
  const driver = drivers.find(row => row.id === shared.driverId);
  if (!driver || driver.center_code !== shared.center) throw new Error('기사 정보의 기사와 센터가 일치하지 않습니다.');
  if (shared.companyId && !companies.some(row => row.id === shared.companyId && row.center_code === shared.center))
    throw new Error('기사 정보의 운수사가 센터와 일치하지 않습니다.');
  const keys = new Set();
  for (const card of selected) {
    if (!card.kind) throw new Error(`${card.pageNumber}페이지의 서류 종류를 선택해 주세요.`);
    if (card.kind === 'health_certificate' && !validDate(shared.expiry)) throw new Error('기사 정보에서 보건증 만료일을 입력해 주세요.');
    const key = card.kind;
    if (keys.has(key)) throw new Error('같은 기사의 같은 서류 종류가 여러 페이지에 지정되었습니다. 한 장만 선택해 주세요.');
    keys.add(key);
  }
  return selected.map(card => ({ ...card, ...shared }));
}
