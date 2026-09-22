import { validDate } from './driver-health.js';

export function validateAssignments(cards, drivers, companies) {
  const selected = cards.filter(card => card.selected);
  if (!selected.length) throw new Error('등록할 페이지를 선택해 주세요.');
  const keys = new Set();
  for (const card of selected) {
    if (!card.driverId || !card.kind) throw new Error(`${card.pageNumber}페이지의 기사와 서류 종류를 선택해 주세요.`);
    const driver = drivers.find(row => row.id === card.driverId);
    if (!driver || driver.center_code !== card.center) throw new Error(`${card.pageNumber}페이지의 기사와 센터가 일치하지 않습니다.`);
    if (card.companyId && !companies.some(row => row.id === card.companyId && row.center_code === card.center))
      throw new Error(`${card.pageNumber}페이지의 운수사가 센터와 일치하지 않습니다.`);
    if (card.kind === 'health_certificate' && !validDate(card.expiry)) throw new Error(`${card.pageNumber}페이지의 보건증 만료일을 입력해 주세요.`);
    const key = `${card.driverId}:${card.kind}`;
    if (keys.has(key)) throw new Error('같은 기사의 같은 서류 종류가 여러 페이지에 지정되었습니다. 한 장만 선택해 주세요.');
    keys.add(key);
  }
  return selected;
}
