// 센터 컨텍스트 공통 유틸
// =============================================================================
// 센터는 완전한 데이터 경계로 취급한다. 모든 조회/저장 화면은 선택된 센터의
// center_code를 기준으로 동작하며, 선택값은 URL과 localStorage에 동기화한다.
// =============================================================================

export const CENTERS = [
  { code: '001', slug: 'ansan', name: '사조안산센터', shortName: '안산' },
  { code: '002', slug: 'pyeongtaek', name: '사조평택센터', shortName: '평택' }
];

const STORAGE_KEY = 'sajo.selectedCenterCode';
const CODE_PARAM_KEYS = ['center', 'center_code'];

export function normalizeCenterCode(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const found = CENTERS.find(c =>
    c.code === raw ||
    c.slug === raw ||
    c.name === value ||
    c.shortName === value
  );
  return found?.code || '';
}

export function getCenterByCode(code) {
  return CENTERS.find(c => c.code === normalizeCenterCode(code)) || null;
}

export function getSelectedCenter() {
  const params = new URLSearchParams(location.search);
  for (const key of CODE_PARAM_KEYS) {
    const code = normalizeCenterCode(params.get(key));
    if (code) {
      setSelectedCenterCode(code, { updateUrl: false });
      return getCenterByCode(code);
    }
  }

  const stored = normalizeCenterCode(localStorage.getItem(STORAGE_KEY));
  return stored ? getCenterByCode(stored) : null;
}

export function getRequiredCenter() {
  return getSelectedCenter() || CENTERS[0];
}

export function setSelectedCenterCode(code, { updateUrl = true } = {}) {
  const normalized = normalizeCenterCode(code);
  if (!normalized) return null;

  localStorage.setItem(STORAGE_KEY, normalized);

  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('center', normalized);
    url.searchParams.delete('center_code');
    url.searchParams.delete('selectCenter');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  return getCenterByCode(normalized);
}

export function clearSelectedCenter() {
  localStorage.removeItem(STORAGE_KEY);
}

export function forceCenterSelectionFromUrl() {
  return new URLSearchParams(location.search).get('selectCenter') === '1';
}

export function withCenterParam(href, center = getRequiredCenter()) {
  const url = new URL(href, location.origin);
  url.searchParams.set('center', center.code);
  url.searchParams.delete('center_code');
  url.searchParams.delete('selectCenter');
  return url.pathname + url.search + url.hash;
}

export function decorateCenterLinks(root = document, center = getRequiredCenter()) {
  root.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return;
    if (href.startsWith('/admin') || href === '/' || href.startsWith('/?')) {
      a.setAttribute('href', withCenterParam(href, center));
    }
  });
}

export function centerPayload(extra = {}, center = getRequiredCenter()) {
  return {
    ...extra,
    center_code: center.code
  };
}

export function scopeByCenter(query, center = getRequiredCenter(), column = 'center_code') {
  return query.eq(column, center.code);
}

export async function requireSelectedCenter({ force = false } = {}) {
  const current = getSelectedCenter();
  if (current && !force) return current;
  return openCenterSelectionModal();
}

export function mountHeaderCenterSwitcher(onChange) {
  let host = document.getElementById('center-switcher');
  if (!host) {
    host = document.createElement('div');
    host.id = 'center-switcher';
    host.className = 'flex items-center gap-1';
    const userBadge = document.getElementById('user-badge');
    if (userBadge?.parentNode) userBadge.parentNode.insertBefore(host, userBadge);
    else document.body.prepend(host);
  }
  renderCenterSwitcher(host, { onChange });
  return host;
}

export function renderCenterSwitcher(host, { onChange } = {}) {
  const selected = getRequiredCenter();
  host.innerHTML = `
    <div class="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/70 p-1" title="센터 전환">
      ${CENTERS.map(c => `
        <button type="button" data-center-code="${c.code}"
                class="px-2.5 py-1 text-xs rounded ${c.code === selected.code ? 'bg-emerald-600 text-white' : 'text-zinc-300 hover:bg-zinc-700'}">
          ${c.shortName}
        </button>
      `).join('')}
    </div>
  `;

  host.querySelectorAll('[data-center-code]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = getCenterByCode(btn.dataset.centerCode);
      if (!next || next.code === getRequiredCenter().code) return;
      setSelectedCenterCode(next.code);
      if (onChange) onChange(next);
      else location.replace(withCenterParam(location.pathname + location.search + location.hash, next));
    });
  });
}

function openCenterSelectionModal() {
  return new Promise(resolve => {
    const existing = document.getElementById('center-selection-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'center-selection-overlay';
    overlay.className = 'fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4';
    overlay.innerHTML = `
      <div class="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl p-6">
        <div class="text-center mb-5">
          <div class="text-lg font-semibold">센터를 선택하세요</div>
          <p class="text-xs text-zinc-400 mt-1">센터는 완전한 데이터 경계로 분리됩니다.</p>
        </div>
        <div class="grid grid-cols-1 gap-3">
          ${CENTERS.map(c => `
            <button type="button" data-center-code="${c.code}"
                    class="rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-emerald-600/20 hover:border-emerald-500 p-4 text-left transition">
              <div class="text-sm font-semibold">${c.name}</div>
              <div class="text-xs text-zinc-500 mt-1">센터 코드 ${c.code}</div>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-center-code]').forEach(btn => {
      btn.addEventListener('click', () => {
        const center = setSelectedCenterCode(btn.dataset.centerCode);
        overlay.remove();
        resolve(center || CENTERS[0]);
      });
    });
  });
}
