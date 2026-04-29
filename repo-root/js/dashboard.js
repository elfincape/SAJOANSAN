// 대시보드 - 코스표 조회 화면
// =============================================================================
// 데이터: Supabase course_view (한 번에 fetch, 클라이언트에서 필터/정렬)
// 상태: state 객체 1개. 변경 시 syncUrl() + render()
// =============================================================================

import { supabase }              from './supabase.js';
import { requireAuth, getCurrentProfile, signOut } from './auth.js';
import { bizMinToDisplay, formatSlack }            from './time.js';
import { toast, openModal, closeModal, formatPhone } from './ui.js';

// -----------------------------------------------------------------------------
// 컬럼 정의 (헤더 / 정렬키 / 셀 렌더러)
// -----------------------------------------------------------------------------
const COLUMNS = [
  { key: 'company_name',           label: '운수사',     sortKey: 'company_name' },
  { key: 'car_number',             label: '호차',       sortKey: 'car_number'   },
  { key: 'route_name',             label: '코스',       sortKey: 'route_name'   },
  { key: 'primary_vehicle_tonnage',label: '톤수',       sortKey: 'primary_vehicle_tonnage', align: 'right' },
  { key: 'primary_vehicle_plate',  label: '차량번호',   sortKey: 'primary_vehicle_plate' },
  { key: 'primary_driver_name',    label: '주기사',     sortKey: 'primary_driver_name', render: renderDriver },
  { key: 'stop_order',             label: '순서',       sortKey: 'stop_order', align: 'right' },
  { key: 'arrival_business_min',   label: '입차',       sortKey: 'arrival_business_min', render: r => bizMinToDisplay(r.arrival_business_min), cls: 'biz-time' },
  { key: 'unloading_start_business_min', label: '하차시작', sortKey: 'unloading_start_business_min', render: r => bizMinToDisplay(r.unloading_start_business_min), cls: 'biz-time' },
  { key: 'unloading_end_business_min',   label: '하차종료', sortKey: 'unloading_end_business_min',   render: r => bizMinToDisplay(r.unloading_end_business_min),   cls: 'biz-time' },
  { key: 'effective_deadline_business_min', label: '마감', sortKey: 'effective_deadline_business_min', render: r => bizMinToDisplay(r.effective_deadline_business_min), cls: 'biz-time' },
  { key: 'slack_minutes',          label: '여유',       sortKey: 'slack_minutes', render: renderSlack, cls: 'biz-time' },
  { key: 'dp_code',                label: '코드',       sortKey: 'dp_code' },
  { key: 'dp_name',                label: '납품처',     sortKey: 'dp_name' },
  { key: 'dp_region',              label: '지역',       sortKey: 'dp_region' },
  { key: 'entry_cond',             label: '진입조건',   sortable: false, render: renderEntryCond },
  { key: 'delivery_method',        label: '납품방식',   sortKey: 'delivery_method',   render: r => renderOverridable(r.delivery_method,   r.override_delivery_method) },
  { key: 'access_method',          label: '진입방식',   sortKey: 'access_method',     render: r => renderOverridable(r.access_method,     r.override_access_method) },
  { key: 'delivery_location',      label: '납품장소',   sortKey: 'delivery_location', render: r => renderOverridable(r.delivery_location, r.override_delivery_location) },
  { key: 'dp_address',             label: '주소',       sortKey: 'dp_address', render: renderAddress },
  { key: 'dp_contact_name',        label: '담당자',     sortable: false, render: r => '' /* 컨택 분리 안 했으면 비움 */ },
  { key: 'dp_contact',             label: '휴대전화',   sortable: false, render: r => formatPhone(r.dp_contact) },
  { key: 'stop_memo',              label: '비고',       sortable: false, render: r => r.stop_memo || '' }
];

// -----------------------------------------------------------------------------
// 상태
// -----------------------------------------------------------------------------
const state = {
  rows: [],                  // course_view 전체
  filtered: [],              // 필터/정렬 후
  filters: {
    company_name: new Set(),
    route_name:   new Set(),
    car_number:   new Set(),
    driver_name:  new Set(), // 주기사+보조기사 모두 매치
    dp_region:    new Set(),
    delivery_method:   new Set(),
    access_method:     new Set(),
    delivery_location: new Set(),
    entry_cond:        new Set(),
    search: ''
  },
  sort: [
    // 기본 정렬: 주기사 → 입차시간
    { key: 'primary_driver_name',  dir: 'asc' },
    { key: 'arrival_business_min', dir: 'asc' }
  ],
  view: 'flat'   // 'flat' | 'group'
};

// -----------------------------------------------------------------------------
// 부트스트랩
// -----------------------------------------------------------------------------
(async function init() {
  const profile = await requireAuth();
  if (!profile) return;

  // 헤더 사용자 영역
  document.getElementById('user-badge').textContent =
    `${profile.display_name || profile.email || ''} (${profile.role})`;
  if (profile.role === 'editor' || profile.role === 'admin') {
    document.getElementById('admin-link').classList.remove('hidden');
  }
  document.getElementById('logout-btn').addEventListener('click', signOut);
  document.getElementById('me-btn').addEventListener('click', showMyInfo);

  // 헤더 / 토글 / 이벤트 바인딩
  buildTableHeader();
  bindViewToggle();
  bindFilterEvents();
  bindResetButtons();

  // URL → state 복원
  loadStateFromUrl();

  // 데이터 로드
  await loadData();

  // 첫 렌더
  applyFiltersAndSort();
  render();
})();

// -----------------------------------------------------------------------------
// 데이터 로드
// -----------------------------------------------------------------------------
async function loadData() {
  const ind = document.getElementById('loading-indicator');
  ind.classList.remove('hidden');
  try {
    const { data, error } = await supabase
      .from('course_view')
      .select('*');

    if (error) throw error;
    state.rows = data || [];

    // 필터 옵션 채우기
    populateMultiSelect('company_name', uniqVals('company_name'));
    populateMultiSelect('route_name',   uniqVals('route_name'));
    populateMultiSelect('car_number',   uniqVals('car_number'));
    populateMultiSelect('dp_region',    uniqVals('dp_region'));

    // 기사 옵션은 주/보조 합집합
    const drivers = new Set();
    for (const r of state.rows) {
      if (r.primary_driver_name)   drivers.add(r.primary_driver_name);
      if (r.secondary_driver_name) drivers.add(r.secondary_driver_name);
    }
    populateMultiSelect('driver_name', [...drivers].sort());

  } catch (e) {
    toast('데이터를 불러오지 못했습니다.', 'error');
    state.rows = [];
  } finally {
    ind.classList.add('hidden');
  }
}

function uniqVals(key) {
  const s = new Set();
  for (const r of state.rows) {
    const v = r[key];
    if (v != null && v !== '') s.add(v);
  }
  return [...s].sort((a, b) => String(a).localeCompare(String(b), 'ko'));
}

// -----------------------------------------------------------------------------
// 헤더 (정렬 표시 포함)
// -----------------------------------------------------------------------------
function buildTableHeader() {
  const tr = document.getElementById('course-thead-row');
  tr.innerHTML = '';
  COLUMNS.forEach(col => {
    const th = document.createElement('th');
    th.dataset.key = col.sortKey || col.key;
    if (col.sortable === false) {
      th.textContent = col.label;
      if (col.align === 'right') th.classList.add('text-right');
    } else {
      th.classList.add('cursor-pointer', 'select-none', 'hover:text-zinc-200');
      th.innerHTML = `<span>${col.label}</span><span class="sort-badge ml-1 text-[10px] text-emerald-400"></span>`;
      th.addEventListener('click', (e) => onHeaderClick(col.sortKey || col.key, e.shiftKey));
    }
    tr.appendChild(th);
  });
  updateHeaderSortBadges();
}

function onHeaderClick(key, shift) {
  const idx = state.sort.findIndex(s => s.key === key);
  if (!shift) {
    // 단일 정렬 (토글)
    if (idx >= 0 && state.sort.length === 1) {
      state.sort = [{ key, dir: state.sort[0].dir === 'asc' ? 'desc' : 'asc' }];
    } else {
      state.sort = [{ key, dir: 'asc' }];
    }
  } else {
    // 다중 정렬
    if (idx >= 0) {
      // 이미 들어있으면 dir 토글, 두 번째 토글이면 제거
      const cur = state.sort[idx];
      if (cur.dir === 'asc')      cur.dir = 'desc';
      else                        state.sort.splice(idx, 1);
    } else {
      state.sort.push({ key, dir: 'asc' });
    }
  }
  applyFiltersAndSort();
  render();
  syncUrl();
}

function updateHeaderSortBadges() {
  document.querySelectorAll('#course-thead-row th').forEach(th => {
    const key = th.dataset.key;
    const badge = th.querySelector('.sort-badge');
    if (!badge) return;
    const idx = state.sort.findIndex(s => s.key === key);
    if (idx < 0) {
      badge.textContent = '';
      th.classList.remove('text-zinc-100');
    } else {
      const dir = state.sort[idx].dir === 'asc' ? '↑' : '↓';
      badge.textContent = `${idx + 1}${dir}`;
      th.classList.add('text-zinc-100');
    }
  });
}

// -----------------------------------------------------------------------------
// 다중선택 드롭다운 (간단 구현)
// -----------------------------------------------------------------------------
function populateMultiSelect(key, options) {
  const root = document.querySelector(`[data-multi="${key}"]`);
  if (!root) return;

  const labelMap = {
    company_name: '운수사',
    route_name:   '코스',
    car_number:   '호차',
    driver_name:  '기사',
    dp_region:    '지역'
  };

  root.innerHTML = `
    <button type="button"
      class="ms-button app-input text-left flex items-center justify-between gap-2">
      <span class="ms-label truncate">${labelMap[key] || key}</span>
      <span class="text-zinc-500 text-xs">▾</span>
    </button>
    <div class="ms-menu hidden absolute mt-1 z-40 w-72 max-h-72 overflow-auto
                bg-zinc-800 border border-zinc-700 rounded-md shadow-xl p-2 space-y-1">
      <input type="text" placeholder="검색"
             class="ms-search app-input mb-1 text-xs">
      <div class="ms-options space-y-0.5"></div>
    </div>
  `;
  root.classList.add('relative');

  const btn   = root.querySelector('.ms-button');
  const menu  = root.querySelector('.ms-menu');
  const opts  = root.querySelector('.ms-options');
  const search = root.querySelector('.ms-search');

  function renderOptions(filterText = '') {
    const ft = filterText.toLowerCase();
    opts.innerHTML = '';
    options
      .filter(v => !ft || String(v).toLowerCase().includes(ft))
      .forEach(v => {
        const id = `${key}__${v}`.replace(/\s+/g, '_');
        const checked = state.filters[key].has(v) ? 'checked' : '';
        const row = document.createElement('label');
        row.className = 'flex items-center gap-2 text-xs px-1 py-1 rounded hover:bg-zinc-700/60 cursor-pointer';
        row.innerHTML = `
          <input type="checkbox" id="${id}" ${checked}>
          <span class="truncate">${escapeHtml(String(v))}</span>
        `;
        row.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) state.filters[key].add(v);
          else                  state.filters[key].delete(v);
          updateMsButtonLabel();
          scheduleApply();
        });
        opts.appendChild(row);
      });
  }
  renderOptions();

  function updateMsButtonLabel() {
    const sel = state.filters[key];
    const lbl = labelMap[key] || key;
    const elLbl = root.querySelector('.ms-label');
    if (sel.size === 0) {
      elLbl.textContent = lbl;
      btn.classList.remove('border-emerald-500');
    } else {
      elLbl.textContent = `${lbl} · ${sel.size}개`;
      btn.classList.add('border-emerald-500');
    }
  }
  updateMsButtonLabel();

  // 외부 노출용 (URL 복원 후 라벨 갱신)
  root._refreshLabel = updateMsButtonLabel;
  root._refreshOptions = () => renderOptions(search.value);

  btn.addEventListener('click', () => {
    document.querySelectorAll('.ms-menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
    menu.classList.toggle('hidden');
  });
  search.addEventListener('input', () => renderOptions(search.value));
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) menu.classList.add('hidden');
  });
}

// -----------------------------------------------------------------------------
// 필터 / 검색 / 보기 토글 이벤트
// -----------------------------------------------------------------------------
function bindFilterEvents() {
  // 검색창
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    state.filters.search = searchInput.value.trim();
    scheduleApply();
  });

  // 체크박스 묶음
  document.querySelectorAll('input[data-cb]').forEach(cb => {
    cb.addEventListener('change', () => {
      const group = cb.dataset.cb; // 'delivery_method' | 'access_method' | ...
      const v = cb.value;
      if (cb.checked) state.filters[group].add(v);
      else            state.filters[group].delete(v);
      scheduleApply();
    });
  });
}

function bindViewToggle() {
  document.querySelectorAll('.view-toggle').forEach(b => {
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      render();
      syncUrl();
    });
  });
  refreshViewToggleStyle();
}
function refreshViewToggleStyle() {
  document.querySelectorAll('.view-toggle').forEach(b => {
    if (b.dataset.view === state.view) {
      b.classList.add('bg-emerald-600', 'text-white');
      b.classList.remove('text-zinc-400');
    } else {
      b.classList.remove('bg-emerald-600', 'text-white');
      b.classList.add('text-zinc-400', 'hover:text-zinc-100');
    }
  });
}

function bindResetButtons() {
  document.getElementById('reset-filters').addEventListener('click', () => {
    Object.keys(state.filters).forEach(k => {
      if (state.filters[k] instanceof Set) state.filters[k].clear();
    });
    state.filters.search = '';
    document.getElementById('search-input').value = '';
    document.querySelectorAll('input[data-cb]').forEach(cb => cb.checked = false);
    document.querySelectorAll('[data-multi]').forEach(root => {
      root._refreshLabel?.();
      root._refreshOptions?.();
    });
    applyFiltersAndSort();
    render();
    syncUrl();
  });

  document.getElementById('reset-sort').addEventListener('click', () => {
    state.sort = [
      { key: 'primary_driver_name',  dir: 'asc' },
      { key: 'arrival_business_min', dir: 'asc' }
    ];
    applyFiltersAndSort();
    render();
    syncUrl();
  });
}

// debounce
let applyTimer = null;
function scheduleApply() {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(() => {
    applyFiltersAndSort();
    render();
    syncUrl();
  }, 200);
}

// -----------------------------------------------------------------------------
// 필터링 / 정렬
// -----------------------------------------------------------------------------
function applyFiltersAndSort() {
  const f = state.filters;
  const q = f.search.toLowerCase();

  state.filtered = state.rows.filter(r => {
    // set 기반 필터
    if (f.company_name.size && !f.company_name.has(r.company_name)) return false;
    if (f.route_name.size   && !f.route_name.has(r.route_name))     return false;
    if (f.car_number.size   && !f.car_number.has(r.car_number))     return false;
    if (f.dp_region.size    && !f.dp_region.has(r.dp_region))       return false;

    // 기사: 주/보조 둘 중 하나라도 매치
    if (f.driver_name.size) {
      const ok = f.driver_name.has(r.primary_driver_name) ||
                 f.driver_name.has(r.secondary_driver_name);
      if (!ok) return false;
    }

    // 납품/진입/장소: 오버라이드 적용된 최종값(course_view에서 이미 COALESCE 처리됨)
    if (f.delivery_method.size   && !f.delivery_method.has(r.delivery_method))     return false;
    if (f.access_method.size     && !f.access_method.has(r.access_method))         return false;
    if (f.delivery_location.size && !f.delivery_location.has(r.delivery_location)) return false;

    // 진입조건: 체크된 항목들이 모두 true 여야 통과 (AND)
    if (f.entry_cond.size) {
      for (const cond of f.entry_cond) {
        if (!r[cond]) return false;
      }
    }

    // 검색: 납품처명 / 주소 / 차량번호
    if (q) {
      const hay = [
        r.dp_name, r.dp_address,
        r.primary_vehicle_plate, r.secondary_vehicle_plate
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });

  // 정렬
  const sorters = state.sort;
  state.filtered.sort((a, b) => {
    for (const s of sorters) {
      const r = compareVal(a[s.key], b[s.key]);
      if (r !== 0) return s.dir === 'asc' ? r : -r;
    }
    return 0;
  });
}

function compareVal(a, b) {
  // null/undefined는 항상 뒤로
  const aN = a == null || a === '';
  const bN = b == null || b === '';
  if (aN && bN) return 0;
  if (aN) return 1;
  if (bN) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ko', { numeric: true });
}

// -----------------------------------------------------------------------------
// 렌더
// -----------------------------------------------------------------------------
function render() {
  refreshViewToggleStyle();
  updateHeaderSortBadges();
  updateActiveFilterCount();
  updateResultCount();

  if (state.view === 'flat') {
    document.getElementById('flat-view').classList.remove('hidden');
    document.getElementById('group-view').classList.add('hidden');
    renderTable();
  } else {
    document.getElementById('flat-view').classList.add('hidden');
    document.getElementById('group-view').classList.remove('hidden');
    renderGroups();
  }
}

function renderTable() {
  const tbody = document.getElementById('course-tbody');
  const empty = document.getElementById('empty-msg');
  tbody.innerHTML = '';

  if (state.filtered.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // 1000행 정도면 단순 innerHTML로 충분히 빠름
  const frag = document.createDocumentFragment();
  state.filtered.forEach(row => {
    const tr = document.createElement('tr');
    tr.classList.add('cursor-pointer');
    tr.addEventListener('click', () => openDetailModal(row));

    COLUMNS.forEach(col => {
      const td = document.createElement('td');
      let html;
      if (col.render) html = col.render(row);
      else            html = row[col.key] != null ? escapeHtml(String(row[col.key])) : '';
      td.innerHTML = html;
      if (col.cls)   td.classList.add(...col.cls.split(' '));
      if (col.align === 'right') td.classList.add('text-right');
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

function renderGroups() {
  const root = document.getElementById('group-view');
  root.innerHTML = '';

  if (state.filtered.length === 0) {
    root.innerHTML = `<div class="text-center text-sm text-zinc-500 py-12">조건에 맞는 코스가 없습니다.</div>`;
    return;
  }

  // route_id로 그룹핑 (그룹 내 정렬은 stop_order)
  const groups = new Map();
  for (const r of state.filtered) {
    const key = r.route_id || `_no_route_${r.stop_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  for (const [, stops] of groups) {
    stops.sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
    const head = stops[0];

    const card = document.createElement('section');
    card.className = 'border border-zinc-700 rounded-lg overflow-hidden bg-zinc-900/40';

    card.innerHTML = `
      <header class="px-3 py-2 bg-zinc-800/60 border-b border-zinc-700 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span class="font-semibold">${escapeHtml(head.route_name || '(코스명 없음)')}</span>
        <span class="text-zinc-400">${escapeHtml(head.car_number || '')}</span>
        <span class="text-zinc-400">${escapeHtml(head.company_name || '')}</span>
        <span class="text-zinc-400">${escapeHtml(head.primary_driver_name || '')}${head.secondary_driver_name ? ' / ' + escapeHtml(head.secondary_driver_name) : ''}</span>
        <span class="text-zinc-500 text-xs">${escapeHtml(head.primary_vehicle_plate || '')}</span>
        <span class="ml-auto text-xs text-zinc-500">정거장 ${stops.length}개</span>
      </header>
      <div class="overflow-auto">
        <table class="app-table">
          <thead>
            <tr>
              <th>순서</th><th>입차</th><th>하차시작</th><th>하차종료</th>
              <th>마감</th><th>여유</th><th>코드</th><th>납품처</th>
              <th>지역</th><th>납품방식</th><th>진입방식</th><th>납품장소</th>
              <th>주소</th><th>비고</th>
            </tr>
          </thead>
          <tbody>
            ${stops.map(s => `
              <tr data-stop-id="${s.stop_id}" class="cursor-pointer">
                <td class="text-right">${s.stop_order ?? ''}</td>
                <td class="biz-time">${bizMinToDisplay(s.arrival_business_min)}</td>
                <td class="biz-time">${bizMinToDisplay(s.unloading_start_business_min)}</td>
                <td class="biz-time">${bizMinToDisplay(s.unloading_end_business_min)}</td>
                <td class="biz-time">${bizMinToDisplay(s.effective_deadline_business_min)}</td>
                <td class="biz-time">${renderSlack(s)}</td>
                <td>${escapeHtml(s.dp_code || '')}</td>
                <td>${escapeHtml(s.dp_name || '')}</td>
                <td>${escapeHtml(s.dp_region || '')}</td>
                <td>${renderOverridable(s.delivery_method,   s.override_delivery_method)}</td>
                <td>${renderOverridable(s.access_method,     s.override_access_method)}</td>
                <td>${renderOverridable(s.delivery_location, s.override_delivery_location)}</td>
                <td>${renderAddress(s)}</td>
                <td>${escapeHtml(s.stop_memo || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // 행 클릭 → 상세
    card.querySelectorAll('tbody tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = tr.dataset.stopId;
        const stop = stops.find(x => String(x.stop_id) === id);
        if (stop) openDetailModal(stop);
      });
    });

    root.appendChild(card);
  }
}

// -----------------------------------------------------------------------------
// 셀 렌더러들
// -----------------------------------------------------------------------------
function renderDriver(r) {
  const main = escapeHtml(r.primary_driver_name || '');
  if (r.secondary_driver_name) {
    return `${main} <span class="text-[11px] text-zinc-500">/ ${escapeHtml(r.secondary_driver_name)}</span>`;
  }
  return main;
}

function renderSlack(r) {
  const m = r.slack_minutes;
  if (m == null) return '';
  let cls = 'slack-pos';
  if (m < 0)      cls = 'slack-neg';
  else if (m < 30) cls = 'text-amber-400';
  return `<span class="${cls}">${escapeHtml(formatSlack(m))}</span>`;
}

function renderEntryCond(r) {
  // 4개 아이콘. 가능하면 색칠.
  const items = [
    { ok: r.allow_under_1ton,    label: '1t' },
    { ok: r.allow_under_3_5ton,  label: '3.5t' },
    { ok: r.allow_over_5ton,     label: '5t+' },
    { ok: r.allow_unmanned_yard, label: '야적' }
  ];
  return `<span class="inline-flex gap-1">${
    items.map(i => `
      <span class="px-1.5 py-0.5 rounded text-[10px] border
        ${i.ok ? 'bg-emerald-600/20 border-emerald-600/40 text-emerald-300'
              : 'bg-zinc-800 border-zinc-700 text-zinc-600 line-through'}">${i.label}</span>
    `).join('')
  }</span>`;
}

function renderOverridable(value, override) {
  if (!value && !override) return '';
  const text = escapeHtml(String(value || ''));
  if (override != null) {
    return `<span class="text-amber-300">★ ${text}</span>`;
  }
  return text;
}

function renderAddress(r) {
  const a = r.dp_address || '';
  if (!a) return '';
  return `<span class="block max-w-[260px] truncate" title="${escapeHtml(a)}">${escapeHtml(a)}</span>`;
}

// -----------------------------------------------------------------------------
// 결과/필터 카운트
// -----------------------------------------------------------------------------
function updateActiveFilterCount() {
  let n = 0;
  for (const k of Object.keys(state.filters)) {
    const v = state.filters[k];
    if (v instanceof Set && v.size > 0) n++;
    else if (typeof v === 'string' && v) n++;
  }
  const el = document.getElementById('active-filter-count');
  el.textContent = n > 0 ? `필터 ${n}개 적용 중` : '';
}

function updateResultCount() {
  const el = document.getElementById('result-count');
  const total = state.rows.length;
  const shown = state.filtered.length;
  el.textContent = total === 0
    ? '데이터 없음'
    : (shown === total ? `총 ${total}건` : `총 ${shown}건 (전체 ${total}건 중)`);
}

// -----------------------------------------------------------------------------
// 상세 모달
// -----------------------------------------------------------------------------
function openDetailModal(r) {
  const tel = r.dp_contact ? formatPhone(r.dp_contact) : '';
  const telLink = r.dp_contact ? `<a href="tel:${escapeAttr(String(r.dp_contact).replace(/\D/g,''))}" class="text-emerald-400 hover:underline">${escapeHtml(tel)}</a>` : '';

  const html = `
    <div class="p-5 max-h-[80vh] overflow-auto">
      <div class="flex items-start justify-between mb-3">
        <div>
          <h2 class="text-base font-semibold">${escapeHtml(r.dp_name || '(납품처 미지정)')}</h2>
          <div class="text-xs text-zinc-400 mt-0.5">
            ${escapeHtml(r.dp_code || '')} · ${escapeHtml(r.dp_region || '')}
          </div>
        </div>
        <button id="detail-close" class="btn btn-ghost text-xs">닫기</button>
      </div>

      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt class="muted">코스</dt>          <dd>${escapeHtml(r.route_name || '')} <span class="text-zinc-500">${escapeHtml(r.car_number || '')}</span></dd>
        <dt class="muted">운수사</dt>        <dd>${escapeHtml(r.company_name || '')}</dd>
        <dt class="muted">주기사 / 차량</dt> <dd>${escapeHtml(r.primary_driver_name || '')} / ${escapeHtml(r.primary_vehicle_plate || '')} ${r.primary_vehicle_tonnage ? '· ' + r.primary_vehicle_tonnage + 't' : ''}</dd>
        <dt class="muted">보조</dt>          <dd>${escapeHtml(r.secondary_driver_name || '-')} / ${escapeHtml(r.secondary_vehicle_plate || '-')}</dd>

        <dt class="muted">순서</dt>          <dd>${r.stop_order ?? ''}</dd>
        <dt class="muted">입차</dt>          <dd class="biz-time">${bizMinToDisplay(r.arrival_business_min)}</dd>
        <dt class="muted">하차 시작 / 종료</dt><dd class="biz-time">${bizMinToDisplay(r.unloading_start_business_min)} ~ ${bizMinToDisplay(r.unloading_end_business_min)}</dd>
        <dt class="muted">마감 / 여유</dt>   <dd class="biz-time">${bizMinToDisplay(r.effective_deadline_business_min)} · ${renderSlack(r)}</dd>

        <dt class="muted">납품방식</dt>      <dd>${renderOverridable(r.delivery_method,   r.override_delivery_method)}</dd>
        <dt class="muted">진입방식</dt>      <dd>${renderOverridable(r.access_method,     r.override_access_method)}</dd>
        <dt class="muted">납품장소</dt>      <dd>${renderOverridable(r.delivery_location, r.override_delivery_location)}</dd>
        <dt class="muted">진입조건</dt>      <dd>${renderEntryCond(r)}</dd>

        <dt class="muted">주소</dt>          <dd class="col-span-1">${escapeHtml(r.dp_address || '')}</dd>
        <dt class="muted">연락처</dt>        <dd>${telLink || '-'}</dd>

        <dt class="muted">비고</dt>          <dd class="col-span-1 whitespace-pre-line">${escapeHtml(r.stop_memo || '')}</dd>
      </dl>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  openModal(wrap, { width: 'xl' });
  wrap.querySelector('#detail-close').addEventListener('click', closeModal);
}

// -----------------------------------------------------------------------------
// 내 정보 모달
// -----------------------------------------------------------------------------
async function showMyInfo() {
  const p = await getCurrentProfile();
  if (!p) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="p-5">
      <h2 class="text-base font-semibold mb-3">내 정보</h2>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt class="muted">이름</dt>  <dd>${escapeHtml(p.display_name || '-')}</dd>
        <dt class="muted">이메일</dt><dd>${escapeHtml(p.email || '-')}</dd>
        <dt class="muted">권한</dt>  <dd>${escapeHtml(p.role)}</dd>
        <dt class="muted">상태</dt>  <dd>${p.active ? '활성' : '비활성'}</dd>
      </dl>
      <div class="mt-4 text-right">
        <button id="me-close" class="btn">닫기</button>
      </div>
    </div>
  `;
  openModal(wrap, { width: 'sm' });
  wrap.querySelector('#me-close').addEventListener('click', closeModal);
}

// -----------------------------------------------------------------------------
// URL 동기화 (쿼리스트링)
// -----------------------------------------------------------------------------
function syncUrl() {
  const params = new URLSearchParams();
  for (const k of Object.keys(state.filters)) {
    const v = state.filters[k];
    if (v instanceof Set && v.size > 0) {
      params.set(k, [...v].join('|'));
    } else if (typeof v === 'string' && v) {
      params.set(k, v);
    }
  }
  if (state.sort.length) {
    params.set('sort', state.sort.map(s => `${s.key}:${s.dir}`).join(','));
  }
  if (state.view !== 'flat') params.set('view', state.view);

  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function loadStateFromUrl() {
  const params = new URLSearchParams(location.search);
  for (const k of Object.keys(state.filters)) {
    const raw = params.get(k);
    if (!raw) continue;
    if (state.filters[k] instanceof Set) {
      raw.split('|').filter(Boolean).forEach(v => state.filters[k].add(v));
    } else {
      state.filters[k] = raw;
    }
  }
  // 검색창에 반영
  document.getElementById('search-input').value = state.filters.search || '';
  // 체크박스에 반영
  document.querySelectorAll('input[data-cb]').forEach(cb => {
    const group = cb.dataset.cb;
    cb.checked = state.filters[group].has(cb.value);
  });

  const sortRaw = params.get('sort');
  if (sortRaw) {
    state.sort = sortRaw.split(',').map(s => {
      const [key, dir] = s.split(':');
      return { key, dir: dir === 'desc' ? 'desc' : 'asc' };
    }).filter(s => s.key);
  }
  const view = params.get('view');
  if (view === 'group' || view === 'flat') state.view = view;
}

// -----------------------------------------------------------------------------
// 유틸
// -----------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
