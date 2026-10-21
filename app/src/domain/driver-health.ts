export interface HealthRow { primary_driver_id?: string | null; secondary_driver_id?: string | null; primary_driver_health_expires_on?: string | null; secondary_driver_health_expires_on?: string | null }
// Date-only certificate expiry. Business timezone: Asia/Seoul.
export function koreaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validDate(value: string | null | undefined): value is string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function nextMonth(today: string) {
  const [year, month, day] = today.split('-').map(Number);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0, 10);
}
export function healthStatus(expiry: string | null | undefined, today = koreaToday()) {
  if (!validDate(expiry)) return { rank: 2, urgent: true, className: 'health-missing', label: '미등록', expiry: '' };
  if (expiry < today) return { rank: 0, urgent: true, className: 'health-expired', label: '보건증 만료', expiry };
  if (expiry < nextMonth(today)) return { rank: 1, urgent: true, className: 'health-soon', label: expiry === today ? '보건증 오늘 만료' : '보건증 만료 임박', expiry };
  return { rank: 3, urgent: false, className: '', label: '유효', expiry };
}
export function compareHealthDates(a: string | null | undefined, b: string | null | undefined, today = koreaToday()) {
  const left = healthStatus(a, today), right = healthStatus(b, today);
  return left.rank - right.rank || (left.urgent && right.urgent ? left.expiry.localeCompare(right.expiry) : 0);
}
export function rowHealthDate(row: HealthRow, today = koreaToday()) {
  return (['primary', 'secondary'] as const)
    .filter(role => row[`${role}_driver_id`] || row[`${role}_driver_health_expires_on`])
    .map(role => row[`${role}_driver_health_expires_on`] || null).sort((a,b) => compareHealthDates(a,b,today))[0] || null;
}
export function compareHealthRows(a: HealthRow, b: HealthRow, today = koreaToday()) {
  return compareHealthDates(rowHealthDate(a,today), rowHealthDate(b,today), today);
}
export function watchHealthDate(onChange: () => void) {
  let day = koreaToday();
  const check = () => { const next = koreaToday(); if (next !== day) { day = next; onChange(); } };
  const timer = setInterval(check, 60000);
  document.addEventListener('visibilitychange', check);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); };
}

export function prioritizeHealthRows<T extends HealthRow>(rows: T[], filters: Record<string, unknown> = {}, today = koreaToday(), promoted = new Set<T>()) {
  promoted.clear();
  const filtering = Object.values(filters).some(value =>
    value instanceof Set ? value.size > 0 : typeof value === 'string' ? value.trim().length > 0 : Boolean(value));
  if (filtering) return rows;
  const seen = new Set<string>(), first: T[] = [], rest: T[] = [];
  for (const row of rows) {
    const drivers = (['primary', 'secondary'] as const).filter(role =>
      row[`${role}_driver_id`] && healthStatus(row[`${role}_driver_health_expires_on`], today).urgent
    ).map(role => String(row[`${role}_driver_id`]));
    if (drivers.some(id => !seen.has(id))) {
      first.push(row);
      promoted.add(row);
      drivers.forEach(id => seen.add(id));
    } else rest.push(row);
  }
  first.sort((a,b) => compareHealthRows(a,b,today));
  return [...first, ...rest];
}
