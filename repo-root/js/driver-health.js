// Date-only certificate expiry. Business timezone: Asia/Seoul.
export function koreaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function nextMonth(today) {
  const [year, month, day] = today.split('-').map(Number);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0, 10);
}
export function healthStatus(expiry, today = koreaToday()) {
  if (!validDate(expiry)) return { rank: 2, urgent: false, className: '', label: '미등록', expiry: '' };
  if (expiry < today) return { rank: 0, urgent: true, className: 'health-expired', label: '보건증 만료', expiry };
  if (expiry < nextMonth(today)) return { rank: 1, urgent: true, className: 'health-soon', label: expiry === today ? '보건증 오늘 만료' : '보건증 만료 임박', expiry };
  return { rank: 2, urgent: false, className: '', label: '유효', expiry };
}
export function compareHealthDates(a, b, today = koreaToday()) {
  const left = healthStatus(a, today), right = healthStatus(b, today);
  return left.rank - right.rank || (left.urgent && right.urgent ? left.expiry.localeCompare(right.expiry) : 0);
}
export function rowHealthDate(row, today = koreaToday()) {
  return [row.primary_driver_health_expires_on, row.secondary_driver_health_expires_on]
    .filter(Boolean).sort((a,b) => compareHealthDates(a,b,today))[0] || null;
}
export function compareHealthRows(a, b, today = koreaToday()) {
  return compareHealthDates(rowHealthDate(a,today), rowHealthDate(b,today), today);
}
export function healthBadge(expiry, today = koreaToday()) {
  const s = healthStatus(expiry,today);
  return `<span class="health-badge ${s.className}">${s.label}${s.expiry ? ' · ' + s.expiry : ''}</span>`;
}
export function watchHealthDate(onChange) {
  let day = koreaToday();
  const check = () => { const next = koreaToday(); if (next !== day) { day = next; onChange(); } };
  const timer = setInterval(check, 60000);
  document.addEventListener('visibilitychange', check);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); };
}
