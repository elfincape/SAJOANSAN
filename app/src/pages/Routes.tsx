import { SavedViews } from '../components/SavedViews';
import { SelectionActions, useSelectionExport } from '../components/Workbench';
import { useWorkspaceActions } from '../lib/workspace-actions';
import { permissionAllowed } from '../lib/permissions';
import '../styles/routes.css';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { AllCommunityModule, ModuleRegistry, createGrid, themeQuartz } from 'ag-grid-community';
import type { GridApi, ICellRendererParams } from 'ag-grid-community';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { Modal } from '../components/Modal';
import { RouteForm } from '../components/RouteForm';
import { useFeedback } from '../components/useFeedback';
import { deleteRoute, loadRouteMasters, loadRoutes } from '../lib/routes';
import type { Route, RouteMasters } from '../lib/routes';
import { withCenterParam } from '../lib/center';

ModuleRegistry.registerModules([AllCommunityModule]);
const defaultView = { search: '', company: '', columnFilters: false, gridFilters: '{}' };
interface GridRow { id: string; route: Route; company: string; carNumber: string; routeName: string; primaryDriver: string; secondaryDriver: string; primaryVehicle: string; stopCount: number; closedDays: number[]; closedDaysText: string; activeLabel: string }
function RoutesContent() {
  const { center, editable, permissions } = useAdminPage();
  const { toast, confirm, feedback } = useFeedback();
  const [masters, setMasters] = useState<RouteMasters>({ companies: [], drivers: [], vehicles: [] });
  const [data, setData] = useState<Awaited<ReturnType<typeof loadRoutes>>>({ routes: [], stopCounts: new Map() });
  const [loading, setLoading] = useState(true), [search, setSearch] = useState(''), [debouncedSearch, setDebouncedSearch] = useState(''), [company, setCompany] = useState(''), [columnFilters, setColumnFilters] = useState(false);
  const [selectedRows, setSelectedRows] = useState<GridRow[]>([]);
  const [gridFilters, setGridFilters] = useState('{}');
  const [stats, setStats] = useState({ filters: 0, shown: 0 });
  const [editing, setEditing] = useState<Route | null | undefined>(undefined), [stops, setStops] = useState<Route | null>(null);
  const grid = useRef<HTMLDivElement>(null), api = useRef<GridApi<GridRow> | null>(null);
  const live = useRef({ editable, remove: (_id: string) => {}, setEditing, setStops });
  live.current = { editable, remove: id => { void remove(id); }, setEditing, setStops };
  const initial = useRef<{ masters: ReturnType<typeof loadRouteMasters>; routes: ReturnType<typeof loadRoutes> } | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const requests = initial.current ??= { masters: loadRouteMasters(center.code), routes: loadRoutes(center.code) };
    void requests.masters.then(value => { if (active) setMasters(value); }).catch(() => { if (active) toast('마스터 데이터를 불러오지 못했습니다.', 'error'); });
    void requests.routes.then(value => { if (active) setData(value); }).catch(() => { if (active) toast('코스 목록을 불러오지 못했습니다.', 'error'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [center.code, toast]);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 200); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    if (!grid.current) return;
    const compact = matchMedia('(max-width: 760px)'), collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });
    function cells(kind: 'days' | 'status' | 'actions') {
      return class {
        private host = document.createElement('div');
        private root: Root | undefined;
        getGui() { return this.host; }
        init(params: ICellRendererParams<GridRow>) { this.host.style.height = '100%'; this.root = createRoot(this.host); this.refresh(params); }
        refresh(params: ICellRendererParams<GridRow>) {
          const row = params.data;
          if (!row) return true;
          this.root?.render(kind === 'days' ? <div className="route-grid-days" style={row.closedDays.length ? undefined : { color: 'var(--theme-muted, #52525b)' }}>{row.closedDays.length ? row.closedDays.map(day => <span key={day} className="route-grid-day">{['일', '월', '화', '수', '목', '금', '토'][day] ?? day}</span>) : '-'}</div> : kind === 'status' ? <span className="text-xs" style={{ color: params.value === '비활성' ? 'var(--theme-danger, #a51e36)' : 'var(--theme-success, #08634f)' }}>{params.value}</span> : <div className="route-grid-actions">{[
            { label: '납품처 ' + row.stopCount, action: () => live.current.setStops(row.route), extra: ' route-action-stops', disabled: false },
            { label: '편집', action: () => live.current.setEditing(row.route), extra: '', disabled: !live.current.editable },
            { label: '삭제', action: () => live.current.remove(row.id), extra: ' route-action-delete', disabled: !live.current.editable },
          ].map(action => <button key={action.label} type="button" className={'btn btn-ghost text-xs' + action.extra} disabled={action.disabled} aria-label={`${row.routeName || row.carNumber || '코스'} ${action.label}`} onClick={event => { event.stopPropagation(); action.action(); }}>{action.label}</button>)}</div>);
          return true;
        }
        destroy() { const root = this.root; if (root) queueMicrotask(() => root.unmount()); }
      };
    }
    function updateGrid(gridApi: GridApi<GridRow>) {
      const visible = new Set<string>();
      gridApi.forEachNodeAfterFilter(node => { if (node.id) visible.add(node.id); });
      for (const node of gridApi.getSelectedNodes()) if (node.id && !visible.has(node.id)) node.setSelected(false);
      setSelectedRows(gridApi.getSelectedRows());
      const model = gridApi.getFilterModel();
      setGridFilters(JSON.stringify(model));
      setStats({ filters: Object.keys(model).length, shown: gridApi.getDisplayedRowCount() });
    }
    const gridApi = createGrid<GridRow>(grid.current, {
      theme: themeQuartz.withParams({ accentColor: '#087f5b', backgroundColor: '#ffffff', borderColor: '#d7dde2', foregroundColor: '#20252b', headerBackgroundColor: '#f1f3f5', rowHoverColor: '#f0f7f3' }),
      columnDefs: [
        { field: 'company', headerName: '운수사', width: 160, minWidth: 140, sort: 'asc', sortIndex: 0 },
        { field: 'carNumber', headerName: '호차', width: 125, minWidth: 100, sort: 'asc', sortIndex: 1 },
        { field: 'routeName', headerName: '코스명', width: 170, minWidth: 145, sort: 'asc', sortIndex: 2 },
        { field: 'primaryDriver', headerName: '주기사', width: 110, minWidth: 100 },
        { field: 'secondaryDriver', headerName: '보조기사', width: 110, minWidth: 100, cellStyle: { color: 'var(--theme-muted)' } },
        { field: 'primaryVehicle', headerName: '주차량', width: 160, minWidth: 155 },
        { field: 'stopCount', headerName: '납품처', width: 95, filter: 'agNumberColumnFilter', cellStyle: { textAlign: 'right' } },
        { field: 'closedDaysText', headerName: '휴무일', minWidth: 135, cellRenderer: cells('days') },
        { field: 'activeLabel', headerName: '상태', width: 95, cellRenderer: cells('status') },
        { headerName: '작업', colId: 'actions', width: 216, minWidth: 216, pinned: compact.matches ? null : 'right', cellClass: 'route-grid-action-cell', sortable: false, filter: false, resizable: false, cellRenderer: cells('actions') },
      ],
      defaultColDef: { cellDataType: false, sortable: true, filter: 'agTextColumnFilter', floatingFilter: false, suppressHeaderFilterButton: true, resizable: true, comparator: (left, right) => collator.compare(String(left ?? ''), String(right ?? '')) },
      rowData: [], getRowId: params => params.data.id, rowHeight: compact.matches ? 52 : 46, headerHeight: 44,
      rowSelection: { mode: 'multiRow', selectAll: 'filtered', enableClickSelection: false },
      selectionColumnDef: { width: 48, minWidth: 48, maxWidth: 48, pinned: 'left', resizable: false },
      onSelectionChanged: event => setSelectedRows(event.api.getSelectedRows()),
      onFilterChanged: event => updateGrid(event.api),
      onModelUpdated: event => updateGrid(event.api),
      floatingFiltersHeight: 38, animateRows: false, suppressCellFocus: false, overlayNoRowsTemplate: '<span class="text-sm text-zinc-500">조건에 맞는 코스가 없습니다.</span>',
    });
    api.current = gridApi;
    const resize = (event: MediaQueryListEvent) => { gridApi.setColumnsPinned(['actions'], event.matches ? null : 'right'); gridApi.setGridOption('rowHeight', event.matches ? 52 : 46); gridApi.resetRowHeights(); };
    compact.addEventListener('change', resize);
    return () => { compact.removeEventListener('change', resize); gridApi.destroy(); api.current = null; };
  }, []);
  useEffect(() => {
    const drivers = new Map(masters.drivers.map(row => [row.id, row])), vehicles = new Map(masters.vehicles.map(row => [row.id, row])), companies = new Map(masters.companies.map(row => [row.id, row]));
    const term = debouncedSearch.toLowerCase();
    const rows = data.routes.filter(row => (!company || row.company_id === company) && (!term || [row.name, row.car_number, drivers.get(row.primary_driver_id || '')?.name, drivers.get(row.secondary_driver_id || '')?.name, vehicles.get(row.primary_vehicle_id || '')?.plate_number, vehicles.get(row.secondary_vehicle_id || '')?.plate_number].filter(Boolean).join(' ').toLowerCase().includes(term))).map(route => ({
      id: route.id, route, company: companies.get(route.company_id || '')?.name || '', carNumber: route.car_number || '', routeName: route.name || '', primaryDriver: drivers.get(route.primary_driver_id || '')?.name || '', secondaryDriver: drivers.get(route.secondary_driver_id || '')?.name || '', primaryVehicle: vehicles.get(route.primary_vehicle_id || '')?.plate_number || '', stopCount: data.stopCounts.get(route.id) || 0, closedDays: [...(route.closed_days || [])].sort((a, b) => a - b), closedDaysText: [...(route.closed_days || [])].sort((a, b) => a - b).join(','), activeLabel: route.active === false ? '비활성' : '활성',
    }));
    api.current?.setGridOption('rowData', rows); if (rows.length) api.current?.hideOverlay(); else api.current?.showNoRowsOverlay();
  }, [data, masters, company, debouncedSearch]);
  useEffect(() => { const gridApi = api.current; if (gridApi) gridApi.setGridOption('defaultColDef', { ...gridApi.getGridOption('defaultColDef'), floatingFilter: columnFilters, suppressHeaderFilterButton: !columnFilters }); }, [columnFilters]);
  async function reload() { setLoading(true); try { setData(await loadRoutes(center.code)); } catch { toast('코스 목록을 불러오지 못했습니다.', 'error'); setData({ routes: [], stopCounts: new Map() }); } finally { setLoading(false); } }
  async function remove(id: string) {
    if (!editable) return; const route = data.routes.find(row => row.id === id); if (!route) return;
    const count = data.stopCounts.get(id) || 0;
    let message = `"${route.name}" 코스를 삭제할까요?`; if (count) message += `\n\n⚠ 이 코스에는 납품처 ${count}개가 등록되어 있습니다.\n코스를 삭제하면 납품처도 함께 삭제됩니다 (되돌릴 수 없음).`;
    if (!await confirm(message, { okText: '삭제', cancelText: '취소', danger: true })) return;
    try { const { error } = await deleteRoute(center.code, id); if (error) { toast(`삭제 실패: ${error.message}`, 'error'); return; } toast('삭제되었습니다.', 'success'); await reload(); } catch { toast('삭제 중 오류가 발생했습니다.', 'error'); }
  }
  function resetFilters() { setSearch(''); setDebouncedSearch(''); setCompany(''); api.current?.setFilterModel(null); }
  function applyView(next: typeof defaultView) {
    let model: unknown;
    try { model = JSON.parse(next.gridFilters); } catch { return; }
    if (!model || typeof model !== 'object' || Array.isArray(model)) return;
    setSearch(next.search); setDebouncedSearch(next.search.trim()); setCompany(next.company); setColumnFilters(next.columnFilters);
    api.current?.setFilterModel(model);
  }
  const canExport = permissionAllowed(permissions, 'export', 'read', center.code);
  const { exportRows, downloadLink } = useSelectionExport('코스_선택목록', ['운수사', '호차', '코스명', '주기사', '보조기사', '주차량', '납품처', '휴무일', '상태'], selectedRows.map(row => [row.company, row.carNumber, row.routeName, row.primaryDriver, row.secondaryDriver, row.primaryVehicle, row.stopCount, row.closedDays.map(day => ['일', '월', '화', '수', '목', '금', '토'][day] ?? day).join('·'), row.activeLabel]));
  useWorkspaceActions([
    { id: 'routes-search', title: '코스 검색창으로 이동', run: () => document.getElementById('search-input')?.focus() },
    { id: 'routes-reset', title: '코스 필터 초기화', run: resetFilters },
    ...editable ? [{ id: 'routes-new', title: '새 코스 등록', disabled: loading, run: () => setEditing(null) }] : [],
    ...canExport && selectedRows.length ? [{ id: 'routes-export', title: '선택한 코스 내보내기', disabled: loading, run: exportRows }] : [],
  ]);
  const filterCount = stats.filters + Number(!!debouncedSearch) + Number(!!company);
  return <>
    <main id="work-main" tabIndex={-1} className="app-main flex-1 max-w-[1400px] w-full mx-auto px-4 py-3">
      {!editable ? <p id="read-only-notice" className="text-sm text-amber-300 p-3">열람 전용 · 선택한 센터에서 이 업무를 수정할 권한이 없습니다.</p> : null}
      <SavedViews scope="routes" value={{ search, company, columnFilters, gridFilters }} defaultValue={defaultView} onApply={applyView} disabled={loading} />
      <div className="route-toolbar" role="search" aria-label="코스 검색 및 필터"><input id="search-input" type="search" aria-label="코스명, 호차, 기사, 차량번호 검색" placeholder="코스명/호차/기사/차량번호 검색" className="app-input flex-1 min-w-[220px]" value={search} onChange={event => setSearch(event.target.value)} /><select id="filter-company" aria-label="운수사 선택" className="app-select w-44" value={company} onChange={event => setCompany(event.target.value)}><option value="">운수사(전체)</option>{masters.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select><button id="column-filters-btn" type="button" className="btn btn-ghost" aria-pressed={columnFilters} aria-controls="route-grid" onClick={() => setColumnFilters(value => !value)}>상세 필터</button><button id="reset-filters-btn" type="button" className={`btn btn-ghost${filterCount ? '' : ' hidden'}`} onClick={resetFilters}>필터 초기화</button><button id="new-btn" data-permission-action="edit" className="btn btn-primary" disabled={!editable} onClick={() => setEditing(null)}>+ 새 코스</button></div>
      <div className="route-filter-summary"><span id="filter-summary" role="status" aria-live="polite">{filterCount ? `필터 ${filterCount}개 적용 중` : '전체 코스'}</span></div>
      <SelectionActions count={selectedRows.length} clear={() => api.current?.deselectAll()}>{canExport ? <button type="button" disabled={loading} onClick={exportRows}>선택 목록 CSV 내보내기</button> : <span>선택 목록 내보내기 권한이 없습니다.</span>}</SelectionActions>
      {downloadLink}
      <p id="route-grid-help" className="table-interaction-help">열 제목으로 정렬 · 상세 필터로 조건 검색 · 표 안에서 방향키로 셀 이동 · 체크박스로 여러 코스 선택</p>
      <div ref={grid} id="route-grid" aria-label="코스 목록" aria-describedby="route-grid-help" />
      <div className="px-1 py-2 text-xs text-zinc-400 flex items-center justify-between"><span id="result-count" role="status" aria-live="polite">{!data.routes.length ? '코스 없음' : stats.shown === data.routes.length ? `총 ${stats.shown}건` : `${stats.shown}건 표시 · 전체 ${data.routes.length}건`}</span><span id="loading-indicator" role="status" className={loading ? '' : 'hidden'}>불러오는 중...</span></div>
    </main>
    {editing !== undefined ? <RouteForm route={editing} masters={masters} toast={toast} close={() => setEditing(undefined)} saved={reload} /> : null}
    {stops ? <Modal width="5xl" dismissable={false} label="납품처 편집" onClose={() => {}}><div className="p-4"><div className="flex items-center justify-between gap-3 mb-3"><div><h2 className="app-function-title text-base font-semibold">납품처 편집</h2><p className="text-xs text-zinc-400 mt-1">{stops.name || ''} · {stops.car_number || ''} · 납품처 {data.stopCounts.get(stops.id) || 0}개</p></div><button data-x className="btn btn-ghost text-xs" onClick={() => { setStops(null); void reload(); }}>닫기</button></div><iframe src={withCenterParam(`/admin/route-edit.html?id=${encodeURIComponent(stops.id)}`, center)} title={`${stops.name || '코스'} 납품처 편집`} className="w-full h-[78vh] rounded-lg border border-zinc-700 bg-zinc-950" /></div></Modal> : null}
    {feedback}
  </>;
}
export default function Routes() { return <AdminPage title="코스 관리" bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><RoutesContent /></AdminPage>; }
