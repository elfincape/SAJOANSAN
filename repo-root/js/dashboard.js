// 대시보드 - 코스표 조회 화면
// =============================================================================
// 데이터: Supabase course_view (한 번에 fetch, 클라이언트에서 필터/정렬)
// 상태: state 객체 1개. 변경 시 syncUrl() + render()
// =============================================================================

import { supabase }              from './supabase.js';
import { requireAuth, getCurrentProfile, signOut } from './auth.js';
import { bizMinToDisplay, bizMinToStandard }       from './time.js';
import { toast, openModal, closeModal, formatPhone } from './ui.js';

// -----------------------------------------------------------------------------
// 컬럼 정의
// -----------------------------------------------------------------------------
const COLUMNS = [
  { key: 'company_name',           label: '운수사',     sortKey: 'company_name',           defaultWidth: 130 },
  { key: 'car_number',             label: '호차',       sortKey: 'car_number',             defaultWidth: 90  },
  { key: 'route_name',             label: '코스',       sortKey: 'route_name',             defaultWidth: 160 },
  { key: 'primary_vehicle_tonnage',label: '톤수',       sortKey: 'primary_vehicle_tonnage', align: 'right', defaultWidth: 70 },
  { key: 'primary_vehicle_plate',  label: '차량번호',   sortKey: 'primary_vehicle_plate',  defaultWidth: 110 },
  { key: 'primary_driver_name',    label: '주기사',     sortKey: 'primary_driver_name',    render: renderDriver, defaultWidth: 110 },
  { key: 'stop_order',             label: '순서',       sortKey: 'stop_order', align: 'right', defaultWidth: 60 },
  { key: 'arrival_business_min',            label: '입차',     sortKey: 'arrival_business_min',            render: r => bizMinToStandard(r.arrival_business_min),            cls: 'biz-time', defaultWidth: 70 },
  { key: 'unloading_start_business_min',    label: '하차시작', sortKey: 'unloading_start_business_min',    render: r => bizMinToStandard(r.unloading_start_business_min),    cls: 'biz-time', defaultWidth: 80 },
  { key: 'unloading_end_business_min',      label: '하차종료', sortKey: 'unloading_end_business_min',      render: r => bizMinToStandard(r.unloading_end_business_min),      cls: 'biz-time', defaultWidth: 80 },
  { key: 'effective_deadline_business_min', label: '마감',     sortKey: 'effective_deadline_business_min', render: r => bizMinToStandard(r.effective_deadline_business_min), cls: 'biz-time', defaultWidth: 70 },
  { key: 'dp_code',                label: '코드',       sortKey: 'dp_code',                defaultWidth: 90  },
  { key: 'dp_name',                label: '납품처',     sortKey: 'dp_name',                defaultWidth: 180 },
  { key: 'dp_region',              label: '지역',       sortKey: 'dp_region',              defaultWidth: 100 },
  { key: 'entry_cond',             label: '진입조건',   sortable: false, render: renderEntryCond,          defaultWidth: 140 },
  { key: 'delivery_method',        label: '납품방식',   sortKey: 'delivery_method',        render: r => renderOverridable(r.delivery_method,   r.override_delivery_method),   defaultWidth: 90 },
  { key: 'access_method',          label: '진입방식',   sortKey: 'access_method',          render: r => renderOverridable(r.access_method,     r.override_access_method),     defaultWidth: 90 },
  { key: 'delivery_location',      label: '납품장소',   sortKey: 'delivery_location',      render: r => renderOverridable(r.delivery_location, r.override_delivery_location), defaultWidth: 90 },
  { key: 'dp_address',             label: '주소',       sortKey: 'dp_address',             render: renderAddress, defaultWidth: 240 },
  { key: 'dp_contact_name',        label: '담당자',     sortable: false, render: () => '',                  defaultWidth: 90  },
  { key: 'dp_contact',             label: '휴대전화',   sortable: false, render: r => formatPhone(r.dp_contact), defaultWidth: 130 },
  { key: 'stop_memo',              label: '비고',       sortable: false, render: r => escapeHtml(r.stop_memo || ''), defaultWidth: 200 }
];
const COL_MAP = Object.fromEntries(COLUMNS.map(c => [c.key, c]));
const ALL_KEYS = COLUMNS.map(c => c.key);

// -----------------------------------------------------------------------------
// 상태
// -----------------------------------------------------------------------------
const state = {
  rows: [],
  filtered: [],
  filters: {
    company_name: new Set(),
    route_name:   new Set(),
    car_number:   new Set(),
    driver_name:  new Set(),
    dp_region:    new Set(),
    delivery_method:   new Set(),
    access_method:     new Set(),
    delivery_location: new Set(),
    entry_cond:        new Set(),
    search: ''
  },
  sort: [
    { key: 'primary_driver_name',  dir: 'asc' },
    { key: 'arrival_business_min', dir: 'asc' }
  ],
  view: 'flat',
  // 컬럼 설정 (localStorage 영속)
  colOrder:   loadJSON('dash.colOrder',   ALL_KEYS),
  colVisible: loadJSON('dash.colVisible', Object.fromEntries(ALL_KEYS.map(k => [k, true]))),
  colWidth:   loadJSON('dash.colWidth',   {})
};

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function saveColumnPrefs() {
  localStorage.setItem('dash.colOrder',   JSON.stringify(state.colOrder));
  localStorage.setItem('dash.colVisible', JSON.stringify(state.colVisible));
  localStorage.setItem('dash.colWidth',   JSON.stringify(state.colWidth));
}
function orderedColumns() {
  const known = state.colOrder.filter(k => COL_MAP[k]);
  const extra = ALL_KEYS.filter(k => !known.includes(k));
  return [...known, ...extra].map(k => COL_MAP[k]);
}
function visibleColumns() {
  return orderedColumns().filter(c => state.colVisible[c.key] !== false);
}

// -----------------------------------------------------------------------------
// 부트스트랩
// -----------------------------------------------------------------------------
(async function init() {
  const profile = await requireAuth();
  if (!profile) return;

  document.getElementById('user-badge').textContent =
    `${profile.display_name || profile.email || ''} (${profile.role})`;
  if (profile.role === 'editor' || profile.role === 'admin') {
    document.getElementById('admin-link').classList.remove('hidden');
  }
  document.getElementById('logout-btn').addEventListener('click', signOut);
  document.getElementById('me-btn').addEventListener('click', showMyInfo);

  injectColumnConfigButton();
  bindViewToggle();
  bindFilterEvents();
  bindResetButtons();

  loadStateFromUrl();
  await loadData();

  applyFiltersAndSort();
  render();
})();

// -----------------------------------------------------------------------------
// "⚙️ 컬럼 설정" 버튼 자동 삽입 (정렬 초기화 버튼 옆 또는 상단 어딘가)
// -----------------------------------------------------------------------------
function injectColumnConfigButton() {
  // 이미 있으면 스킵
  if (document.getElementById('btn-col-config')) return;
  const btn = document.createElement('button');
  btn.id = 'btn-col-config';
  btn.type = 'button';
  btn.className = 'px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-100';
  btn.textContent = '⚙️ 컬럼 설정';
  btn.addEventListener('click', openColumnConfig);

  // 정렬 리셋 버튼 옆에 두는 게 자연스러움
  const ref = document.getElementById('reset-sort')
           || document.getElementById('reset-filters')
           || document.getElementById('admin-link');
  if (ref && ref.parentNode) {
    ref.parentNode.insertBefore(btn, ref.nextSibling);
  } else {
    document.body.appendChild(btn);
  }
}

// -----------------------------------------------------------------------------
// 데이터 로드
// -----------------------------------------------------------------------------
async function loadData() {
  const ind = document.getElementById('loading-indicator');
  ind?.classList.remove('hidden');
  try {
    const { data, error } = await supabase.from('course_view').select('*');
    if (error) throw error;
    state.rows = data || [];

    populateMultiSelect('company_name', uniqVals('company_name'));
    populateMultiSelect('route_name',   uniqVals('route_name'));
    populateMultiSelect('car_number',   uniqVals('car_number'));
    populateMultiSelect('dp_region',    uniqVals('dp_region'));

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
    ind?.classList.add('hidden');
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
// 다중선택 드롭다운
// -----------------------------------------------------------------------------
function populateMultiSelect(key, options) {
  const root = document.querySelector(`[data-multi="${key}"]`);
  if (!root) return;

  const labelMap = {
    company_name: '운수사', route_name: '코스', car_number: '호차',
    driver_name: '기사', dp_region: '지역'
  };

  root.innerHTML = `
    <button type="button" class="ms-button app-input text-left flex items-center justify-between gap-2">
      <span class="ms-label truncate">${labelMap[key] || key}</span>
      <span class="text-zinc-500 text-xs">▾</span>
    </button>
    <div class="ms-menu hidden absolute mt-1 z-40 w-72 max-h-72 overflow-auto
                bg-zinc-800 border border-zinc-700 rounded-md shadow-xl p-2 space-y-1">
      <input type="text" placeholder="검색" class="ms-search app-input mb-1 text-xs">
      <div class="ms-options space-y-0.5"></div>
    </div>`;
  root.classList.add('relative');

  const btn = root.querySelector('.ms-button');
  const menu = root.querySelector('.ms-menu');
  const opts = root.querySelector('.ms-options');
  const search = root.querySelector('.ms-search');

  function renderOptions(filterText = '') {
    const ft = filterText.toLowerCase();
    opts.innerHTML = '';
    options.filter(v => !ft || String(v).toLowerCase().includes(ft)).forEach(v => {
      const id = `${key}__${v}`.replace(/\s+/g, '_');
      const checked = state.filters[key].has(v) ? 'checked' : '';
      const row = document.createElement('label');
      row.className = 'flex items-center gap-2 text-xs px-1 py-1 rounded hover:bg-zinc-700/60 cursor-pointer';
      row.innerHTML = `<input type="checkbox" id="${id}" ${checked}><span class="truncate">${escapeHtml(String(v))}</span>`;
      row.querySelector('input').addEventListener('change', e => {
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
  root._refreshLabel = updateMsButtonLabel;
  root._refreshOptions = () => renderOptions(search.value);

  btn.addEventListener('click', () => {
    document.querySelectorAll('.ms-menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
    menu.classList.toggle('hidden');
  });
  search.addEventListener('input', () => renderOptions(search.value));
  document.addEventListener('click', e => {
    if (!root.contains(e.target)) menu.classList.add('hidden');
  });
}

// -----------------------------------------------------------------------------
// 필터/검색/뷰 토글
// -----------------------------------------------------------------------------
function bindFilterEvents() {
  const searchInput = document.getElementById('search-input');
  searchInput?.addEventListener('input', () => {
    state.filters.search = searchInput.value.trim();
    scheduleApply();
  });
  document.querySelectorAll('input[data-cb]').forEach(cb => {
    cb.addEventListener('change', () => {
      const group = cb.dataset.cb;
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
  document.getElementById('reset-filters')?.addEventListener('click', () => {
    Object.keys(state.filters).forEach(k => {
      if (state.filters[k] instanceof Set) state.filters[k].clear();
    });
    state.filters.search = '';
    const si = document.getElementById('search-input'); if (si) si.value = '';
    document.querySelectorAll('input[data-cb]').forEach(cb => cb.checked = false);
    document.querySelectorAll('[data-multi]').forEach(root => {
      root._refreshLabel?.(); root._refreshOptions?.();
    });
    applyFiltersAndSort(); render(); syncUrl();
  });

  document.getElementById('reset-sort')?.addEventListener('click', () => {
    state.sort = [
      { key: 'primary_driver_name',  dir: 'asc' },
      { key: 'arrival_business_min', dir: 'asc' }
    ];
    applyFiltersAndSort(); render(); syncUrl();
  });
}

let applyTimer = null;
function scheduleApply() {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(() => { applyFiltersAndSort(); render(); syncUrl(); }, 200);
}

// -----------------------------------------------------------------------------
// 필터링/정렬
// -----------------------------------------------------------------------------
function applyFiltersAndSort() {
  const f = state.filters;
  const q = f.search.toLowerCase();
  state.filtered = state.rows.filter(r => {
    if (f.company_name.size && !f.company_name.has(r.company_name)) return false;
    if (f.route_name.size   && !f.route_name.has(r.route_name))     return false;
    if (f.car_number.size   && !f.car_number.has(r.car_number))     return false;
    if (f.dp_region.size    && !f.dp_region.has(r.dp_region))       return false;
    if (f.driver_name.size) {
      const ok = f.driver_name.has(r.primary_driver_name) || f.driver_name.has(r.secondary_driver_name);
      if (!ok) return false;
    }
    if (f.delivery_method.size   && !f.delivery_method.has(r.delivery_method))     return false;
    if (f.access_method.size     && !f.access_method.has(r.access_method))         return false;
    if (f.delivery_location.size && !f.delivery_location.has(r.delivery_location)) return false;
    if (f.entry_cond.size) {
      for (const cond of f.entry_cond) if (!r[cond]) return false;
    }
    if (q) {
      const hay = [r.dp_name, r.dp_address, r.primary_vehicle_plate, r.secondary_vehicle_plate]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

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
  updateActiveFilterCount();
  updateResultCount();
  if (state.view === 'flat') {
    document.getElementById('flat-view')?.classList.remove('hidden');
    document.getElementById('group-view')?.classList.add('hidden');
    renderFlatTable();
  } else {
    document.getElementById('flat-view')?.classList.add('hidden');
    document.getElementById('group-view')?.classList.remove('hidden');
    renderGroups();
  }
}

function renderFlatTable() {
  const host = document.getElementById('flat-view');
  if (!host) return;
  const cols = visibleColumns();

  if (state.filtered.length === 0) {
    host.innerHTML = `<div class="text-center text-sm text-zinc-500 py-12">조건에 맞는 코스가 없습니다.</div>`;
    return;
  }

  const widths = cols.map(c => state.colWidth[c.key] || c.defaultWidth || 120);
  const colgroup = `<colgroup>${cols.map((_, i) => `<col style="width:${widths[i]}px">`).join('')}</colgroup>`;

  const thead = `<thead><tr>${cols.map((c, i) => {
    const sortKey = c.sortKey || c.key;
    const sortIdx = state.sort.findIndex(s => s.key === sortKey);
    const badge = sortIdx >= 0
      ? `<span class="text-[10px] text-emerald-400 ml-1">${sortIdx + 1}${state.sort[sortIdx].dir === 'asc' ? '↑' : '↓'}</span>`
      : '';
    const sortable = c.sortable !== false;
    const cls = sortable ? 'cursor-pointer hover:text-zinc-200' : '';
    const align = c.align === 'right' ? 'text-right' : '';
return `
  <th draggable="true"
      data-sortkey="${sortKey}" data-idx="${i}" data-key="${c.key}"
      class="th-draggable ${cls} ${align}">
    <span class="th-inner">
      <span class="th-grip" title="드래그해서 순서 변경">⋮⋮</span>
      <span>${escapeHtml(c.label)}</span>${badge}
    </span>
    <span class="col-resizer" data-resize="${c.key}"></span>
  </th>`;

  }).join('')}</tr></thead>`;

  const tbody = `<tbody>${state.filtered.map(row => {
    const tds = cols.map(c => {
      let html;
      if (c.render) html = c.render(row);
      else          html = row[c.key] != null ? escapeHtml(String(row[c.key])) : '';
      const cls   = c.cls   ? c.cls : '';
      const align = c.align === 'right' ? 'text-right' : '';
      const tip   = escapeAttr(stripHtml(html));
      return `<td class="${cls} ${align}" title="${tip}">${html ?? ''}</td>`;
    }).join('');
    return `<tr data-stop-id="${escapeAttr(String(row.stop_id ?? ''))}">${tds}</tr>`;
  }).join('')}</tbody>`;

  host.innerHTML = `<table class="data-table">${colgroup}${thead}${tbody}</table>`;

  // 헤더 클릭 (정렬)
  host.querySelectorAll('thead th').forEach(th => {
    const sortKey = th.dataset.sortkey;
    const colDef = cols[Number(th.dataset.idx)];
    if (!colDef || colDef.sortable === false) return;
    th.addEventListener('click', e => {
      // 리사이저 클릭은 무시
      if (e.target.classList.contains('col-resizer')) return;
      onHeaderClick(sortKey, e.shiftKey);
    });
  });

  // 행 클릭 (모달)
  host.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const id = tr.dataset.stopId;
      const row = state.filtered.find(x => String(x.stop_id) === id);
      if (row) openDetailModal(row);
    });
  });

  // 컬럼 폭 드래그
  bindColumnResizers(host);
}
bindHeaderDragReorder(host);


function bindColumnResizers(host) {
  host.querySelectorAll('.col-resizer').forEach(el => {
    el.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const key = el.dataset.resize;
      const th = el.closest('th');
      const idx = Number(th.dataset.idx);
      const startX = e.clientX;
      const startW = th.getBoundingClientRect().width;
      const colEl = host.querySelector(`colgroup col:nth-child(${idx + 1})`);
      const onMove = ev => {
        const newW = Math.max(40, startW + (ev.clientX - startX));
        state.colWidth[key] = newW;
        if (colEl) colEl.style.width = `${newW}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveColumnPrefs();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function bindHeaderDragReorder(host) {
  let dragKey = null;

  host.querySelectorAll('thead th.th-draggable').forEach(th => {
    th.addEventListener('dragstart', e => {
      // 리사이저 위에서 시작된 드래그는 무시
      if (e.target.classList.contains('col-resizer')) {
        e.preventDefault();
        return;
      }
      dragKey = th.dataset.key;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragKey);
      th.classList.add('opacity-40');
    });

    th.addEventListener('dragend', () => {
      th.classList.remove('opacity-40');
      host.querySelectorAll('thead th').forEach(x => {
        x.classList.remove('drop-left', 'drop-right');
      });
      dragKey = null;
    });

    th.addEventListener('dragover', e => {
      if (!dragKey || dragKey === th.dataset.key) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // 마우스가 셀의 왼/오 어느 쪽에 있는지로 삽입 위치 표시
      const rect = th.getBoundingClientRect();
      const isLeft = (e.clientX - rect.left) < rect.width / 2;
      th.classList.toggle('drop-left',  isLeft);
      th.classList.toggle('drop-right', !isLeft);
    });

    th.addEventListener('dragleave', () => {
      th.classList.remove('drop-left', 'drop-right');
    });

    th.addEventListener('drop', e => {
      e.preventDefault();
      const targetKey = th.dataset.key;
      if (!dragKey || dragKey === targetKey) return;

      const rect = th.getBoundingClientRect();
      const insertBefore = (e.clientX - rect.left) < rect.width / 2;

      // 현재 보이는 컬럼 순서를 가져와서 재배치
      const order = orderedColumns().map(c => c.key);
      const from = order.indexOf(dragKey);
      const to   = order.indexOf(targetKey);
      if (from < 0 || to < 0) return;

      order.splice(from, 1);
      const newTo = order.indexOf(targetKey);
      order.splice(insertBefore ? newTo : newTo + 1, 0, dragKey);

      state.colOrder = order;
      saveColumnPrefs();
      render(); // 새 순서로 다시 그리기
    });
  });
}

function onHeaderClick(key, shift) {
  const idx = state.sort.findIndex(s => s.key === key);
  if (!shift) {
    if (idx >= 0 && state.sort.length === 1) {
      state.sort = [{ key, dir: state.sort[0].dir === 'asc' ? 'desc' : 'asc' }];
    } else {
      state.sort = [{ key, dir: 'asc' }];
    }
  } else {
    if (idx >= 0) {
      const cur = state.sort[idx];
      if (cur.dir === 'asc') cur.dir = 'desc';
      else                   state.sort.splice(idx, 1);
    } else {
      state.sort.push({ key, dir: 'asc' });
    }
  }
  applyFiltersAndSort(); render(); syncUrl();
}

function renderGroups() {
  const root = document.getElementById('group-view');
  if (!root) return;
  root.innerHTML = '';
  if (state.filtered.length === 0) {
    root.innerHTML = `<div class="text-center text-sm text-zinc-500 py-12">조건에 맞는 코스가 없습니다.</div>`;
    return;
  }

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
        <table class="data-table">
          <thead><tr>
            <th>순서</th><th>입차</th><th>하차시작</th><th>하차종료</th>
            <th>마감</th><th>코드</th><th>납품처</th>
            <th>지역</th><th>납품방식</th><th>진입방식</th><th>납품장소</th>
            <th>주소</th><th>비고</th>
          </tr></thead>
          <tbody>
            ${stops.map(s => `
              <tr data-stop-id="${s.stop_id}">
                <td class="text-right">${s.stop_order ?? ''}</td>
                <td class="biz-time">${bizMinToStandard(s.arrival_business_min)}</td>
                <td class="biz-time">${bizMinToStandard(s.unloading_start_business_min)}</td>
                <td class="biz-time">${bizMinToStandard(s.unloading_end_business_min)}</td>
                <td class="biz-time">${bizMinToStandard(s.effective_deadline_business_min)}</td>
                <td>${escapeHtml(s.dp_code || '')}</td>
                <td>${escapeHtml(s.dp_name || '')}</td>
                <td>${escapeHtml(s.dp_region || '')}</td>
                <td>${renderOverridable(s.delivery_method,   s.override_delivery_method)}</td>
                <td>${renderOverridable(s.access_method,     s.override_access_method)}</td>
                <td>${renderOverridable(s.delivery_location, s.override_delivery_location)}</td>
                <td>${renderAddress(s)}</td>
                <td>${escapeHtml(s.stop_memo || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
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
// 셀 렌더러
// -----------------------------------------------------------------------------
function renderDriver(r) {
  const main = escapeHtml(r.primary_driver_name || '');
  if (r.secondary_driver_name) {
    return `${main} <span class="text-[11px] text-zinc-500">/ ${escapeHtml(r.secondary_driver_name)}</span>`;
  }
  return main;
}
function renderEntryCond(r) {
  const items = [
    { ok: r.allow_under_1ton,    label: '1t' },
    { ok: r.allow_under_3_5ton,  label: '3.5t' },
    { ok: r.allow_over_5ton,     label: '5t+' },
    { ok: r.allow_unmanned_yard, label: '야적' }
  ];
  return `<span class="inline-flex gap-1">${items.map(i => `
    <span class="px-1.5 py-0.5 rounded text-[10px] border
      ${i.ok ? 'bg-emerald-600/20 border-emerald-600/40 text-emerald-300'
            : 'bg-zinc-800 border-zinc-700 text-zinc-600 line-through'}">${i.label}</span>
  `).join('')}</span>`;
}
function renderOverridable(value, override) {
  if (!value && !override) return '';
  const text = escapeHtml(String(value || ''));
  if (override != null) return `<span class="text-amber-300">★ ${text}</span>`;
  return text;
}
function renderAddress(r) {
  const a = r.dp_address || '';
  if (!a) return '';
  return `<span title="${escapeAttr(a)}">${escapeHtml(a)}</span>`;
}

// -----------------------------------------------------------------------------
// 카운트
// -----------------------------------------------------------------------------
function updateActiveFilterCount() {
  let n = 0;
  for (const k of Object.keys(state.filters)) {
    const v = state.filters[k];
    if (v instanceof Set && v.size > 0) n++;
    else if (typeof v === 'string' && v) n++;
  }
  const el = document.getElementById('active-filter-count');
  if (el) el.textContent = n > 0 ? `필터 ${n}개 적용 중` : '';
}
function updateResultCount() {
  const el = document.getElementById('result-count');
  if (!el) return;
  const total = state.rows.length;
  const shown = state.filtered.length;
  el.textContent = total === 0 ? '데이터 없음'
    : (shown === total ? `총 ${total}건` : `총 ${shown}건 (전체 ${total}건 중)`);
}

// -----------------------------------------------------------------------------
// 모달
// -----------------------------------------------------------------------------
function openDetailModal(r) {
  const tel = r.dp_contact ? formatPhone(r.dp_contact) : '';
  const telLink = r.dp_contact
    ? `<a href="tel:${escapeAttr(String(r.dp_contact).replace(/\D/g,''))}" class="text-emerald-400 hover:underline">${escapeHtml(tel)}</a>`
    : '';
  const html = `
    <div class="p-5 max-h-[80vh] overflow-auto">
      <div class="flex items-start justify-between mb-3">
        <div>
          <h2 class="text-base font-semibold">${escapeHtml(r.dp_name || '(납품처 미지정)')}</h2>
          <div class="text-xs text-zinc-400 mt-0.5">${escapeHtml(r.dp_code || '')} · ${escapeHtml(r.dp_region || '')}</div>
        </div>
        <button id="detail-close" class="btn btn-ghost text-xs">닫기</button>
      </div>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt class="muted">코스</dt>          <dd>${escapeHtml(r.route_name || '')} <span class="text-zinc-500">${escapeHtml(r.car_number || '')}</span></dd>
        <dt class="muted">운수사</dt>        <dd>${escapeHtml(r.company_name || '')}</dd>
        <dt class="muted">주기사 / 차량</dt> <dd>${escapeHtml(r.primary_driver_name || '')} / ${escapeHtml(r.primary_vehicle_plate || '')} ${r.primary_vehicle_tonnage ? '· ' + r.primary_vehicle_tonnage + 't' : ''}</dd>
        <dt class="muted">보조</dt>          <dd>${escapeHtml(r.secondary_driver_name || '-')} / ${escapeHtml(r.secondary_vehicle_plate || '-')}</dd>
        <dt class="muted">순서</dt>          <dd>${r.stop_order ?? ''}</dd>
        <dt class="muted">입차</dt>          <dd class="biz-time">${bizMinToStandard(r.arrival_business_min)}</dd>
        <dt class="muted">하차 시작 / 종료</dt><dd class="biz-time">${bizMinToStandard(r.unloading_start_business_min)} ~ ${bizMinToStandard(r.unloading_end_business_min)}</dd>
        <dt class="muted">마감</dt>          <dd class="biz-time">${bizMinToStandard(r.effective_deadline_business_min)}</dd>
        <dt class="muted">납품방식</dt>      <dd>${renderOverridable(r.delivery_method,   r.override_delivery_method)}</dd>
        <dt class="muted">진입방식</dt>      <dd>${renderOverridable(r.access_method,     r.override_access_method)}</dd>
        <dt class="muted">납품장소</dt>      <dd>${renderOverridable(r.delivery_location, r.override_delivery_location)}</dd>
        <dt class="muted">진입조건</dt>      <dd>${renderEntryCond(r)}</dd>
        <dt class="muted">주소</dt>          <dd>${escapeHtml(r.dp_address || '')}</dd>
        <dt class="muted">연락처</dt>        <dd>${telLink || '-'}</dd>
        <dt class="muted">비고</dt>          <dd class="whitespace-pre-line">${escapeHtml(r.stop_memo || '')}</dd>
      </dl>
    </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  openModal(wrap, { width: 'xl' });
  wrap.querySelector('#detail-close').addEventListener('click', closeModal);
}

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
      <div class="mt-4 text-right"><button id="me-close" class="btn">닫기</button></div>
    </div>`;
  openModal(wrap, { width: 'sm' });
  wrap.querySelector('#me-close').addEventListener('click', closeModal);
}

// -----------------------------------------------------------------------------
// 컬럼 설정 모달
// -----------------------------------------------------------------------------
function openColumnConfig() {
  const work = {
    order: orderedColumns().map(c => c.key),
    visible: { ...state.colVisible }
  };

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="p-5 w-[420px] max-w-full">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-base font-semibold">컬럼 설정</h2>
        <button id="cc-close" class="btn btn-ghost text-xs">×</button>
      </div>
      <p class="text-xs text-zinc-400 mb-2">표시할 컬럼을 선택하고 ↑↓ 으로 순서를 조정하세요.</p>
      <div id="cc-list" class="space-y-1 max-h-[55vh] overflow-auto"></div>
      <div class="flex justify-between pt-3 mt-3 border-t border-zinc-700">
        <button id="cc-reset"  class="px-3 py-1.5 text-sm bg-red-700/70 hover:bg-red-600 rounded">기본값</button>
        <div class="flex gap-2">
          <button id="cc-cancel" class="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 rounded">취소</button>
          <button id="cc-apply"  class="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 rounded">적용</button>
        </div>
      </div>
    </div>`;
  openModal(wrap, { width: 'md' });

  const list = wrap.querySelector('#cc-list');
  function rerender() {
    list.innerHTML = work.order.map((k, i) => {
      const c = COL_MAP[k]; if (!c) return '';
      const checked = work.visible[k] !== false ? 'checked' : '';
      return `
        <div class="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700 rounded px-2 py-1.5" data-key="${k}" data-idx="${i}">
          <input type="checkbox" data-action="toggle" ${checked} class="accent-emerald-500">
          <span class="flex-1 text-sm">${escapeHtml(c.label)}</span>
          <button data-action="up"   class="px-2 py-0.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded" ${i===0 ? 'disabled' : ''}>↑</button>
          <button data-action="down" class="px-2 py-0.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded" ${i===work.order.length-1 ? 'disabled' : ''}>↓</button>
        </div>`;
    }).join('');
    list.querySelectorAll('[data-key]').forEach(row => {
      const key = row.dataset.key;
      const idx = Number(row.dataset.idx);
      row.querySelector('[data-action="toggle"]').addEventListener('change', e => {
        work.visible[key] = e.target.checked;
      });
      row.querySelector('[data-action="up"]')?.addEventListener('click', () => {
        if (idx === 0) return;
        [work.order[idx-1], work.order[idx]] = [work.order[idx], work.order[idx-1]];
        rerender();
      });
      row.querySelector('[data-action="down"]')?.addEventListener('click', () => {
        if (idx >= work.order.length - 1) return;
        [work.order[idx+1], work.order[idx]] = [work.order[idx], work.order[idx+1]];
        rerender();
      });
    });
  }
  rerender();

  wrap.querySelector('#cc-close').addEventListener('click', closeModal);
  wrap.querySelector('#cc-cancel').addEventListener('click', closeModal);
  wrap.querySelector('#cc-reset').addEventListener('click', () => {
    state.colOrder   = ALL_KEYS.slice();
    state.colVisible = Object.fromEntries(ALL_KEYS.map(k => [k, true]));
    state.colWidth   = {};
    saveColumnPrefs();
    closeModal();
    render();
  });
  wrap.querySelector('#cc-apply').addEventListener('click', () => {
    state.colOrder   = work.order;
    state.colVisible = work.visible;
    saveColumnPrefs();
    closeModal();
    render();
  });
}

// -----------------------------------------------------------------------------
// URL 동기화
// -----------------------------------------------------------------------------
function syncUrl() {
  const params = new URLSearchParams();
  for (const k of Object.keys(state.filters)) {
    const v = state.filters[k];
    if (v instanceof Set && v.size > 0) params.set(k, [...v].join('|'));
    else if (typeof v === 'string' && v) params.set(k, v);
  }
  if (state.sort.length) params.set('sort', state.sort.map(s => `${s.key}:${s.dir}`).join(','));
  if (state.view !== 'flat') params.set('view', state.view);
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}
function loadStateFromUrl() {
  const params = new URLSearchParams(location.search);
  for (const k of Object.keys(state.filters)) {
    const raw = params.get(k);
    if (!raw) continue;
    if (state.filters[k] instanceof Set) raw.split('|').filter(Boolean).forEach(v => state.filters[k].add(v));
    else state.filters[k] = raw;
  }
  const si = document.getElementById('search-input'); if (si) si.value = state.filters.search || '';
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
function stripHtml(s) {
  if (s == null) return '';
  return String(s).replace(/<[^>]*>/g, '').trim();
}
function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
