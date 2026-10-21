export interface Center { code: string; slug: string; name: string; shortName: string }
export const CENTERS: Center[] = [
  { code: '001', slug: 'ansan', name: '사조안산센터', shortName: '안산' },
  { code: '002', slug: 'pyeongtaek', name: '사조평택센터', shortName: '평택' },
];
const storageKey = 'sajo.selectedCenterCode';

export function normalizeCenterCode(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  return CENTERS.find(c => c.code === raw || c.slug === raw || c.name === value || c.shortName === value)?.code || '';
}
export function getCenterByCode(value: unknown) { return CENTERS.find(c => c.code === normalizeCenterCode(value)) || null; }
export function getSelectedCenter() {
  const params = new URLSearchParams(location.search);
  for (const key of ['center', 'center_code']) {
    const code = normalizeCenterCode(params.get(key));
    if (code) { localStorage.setItem(storageKey, code); return getCenterByCode(code); }
  }
  return getCenterByCode(localStorage.getItem(storageKey));
}
export function clearSelectedCenter() { localStorage.removeItem(storageKey); }
export function setSelectedCenterCode(value: string, updateUrl = true) {
  const center = getCenterByCode(value);
  if (!center) return null;
  localStorage.setItem(storageKey, center.code);
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('center', center.slug);
    url.searchParams.delete('center_code');
    url.searchParams.delete('selectCenter');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  return center;
}
export function withCenterParam(href: string, center: Center) {
  const url = new URL(href, location.origin);
  url.searchParams.set('center', url.pathname.startsWith('/portal/') ? center.code : center.slug);
  url.searchParams.delete('center_code');
  url.searchParams.delete('selectCenter');
  return url.pathname + url.search + url.hash;
}
