import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import '../styles/driver-documents.css';
import '../styles/dashboard.css';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { Modal } from '../components/Modal';
import { DashboardDetail } from '../components/DashboardDetail';
import { OperationsAssistant } from '../components/OperationsAssistant';
import { SavedViews } from '../components/SavedViews';
import { useWorkspaceActions } from '../lib/workspace-actions';
import { useFeedback } from '../components/useFeedback';
import { loadDashboard, dashboardHealth } from '../lib/dashboard';
import {
  COLUMNS,
  ALL_KEYS,
  COL_MAP,
  DEFAULT_SORT,
  initialFilters,
  filterDashboard,
  orderedDashboardColumns,
  deliveryPointMemo,
} from '../domain/dashboard';
import type {
  DashboardRow,
  DashboardFilters,
  Sorter,
  DashboardColumn,
} from '../domain/dashboard';
import {
  healthStatus,
  rowHealthDate,
  validDate,
  watchHealthDate,
} from '../domain/driver-health';
import { bizMinToStandard } from '../domain/time';
import { formatPhone } from '../domain/phone';
const multiLabels: Record<string, string> = {
  company_name: '운수사',
  route_name: '코스',
  car_number: '호차',
  dp_region: '지역',
  security_key_location: '열쇠보관장소',
  security_password: '비밀번호',
  driver_name: '기사',
};
const entries = [
  ['allow_under_1ton', '1t'],
  ['allow_under_3_5ton', '3.5t'],
  ['allow_over_5ton', '5t+'],
  ['allow_unmanned_yard', '야적'],
] as const;
function loadJSON<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
function initial() {
  const params = new URLSearchParams(location.search),
    filters = initialFilters();
  for (const key of Object.keys(filters)) {
    const raw = params.get(key);
    if (!raw) continue;
    if (filters[key] instanceof Set)
      filters[key] = new Set(raw.split('|').filter(Boolean));
    else filters[key] = raw;
  }
  const sortRaw = params.get('sort'),
    sort: Sorter[] = sortRaw
      ? (sortRaw
          .split(',')
          .map((value) => {
            const [key, dir] = value.split(':');
            return { key, dir: dir === 'desc' ? 'desc' : 'asc' };
          })
          .filter((s) => s.key) as Sorter[])
      : structuredClone(DEFAULT_SORT),
    view = params.get('view') === 'group' ? 'group' : 'flat';
  return { filters, sort, view };
}
interface DashboardView {
  filters: Record<string, string | (string | number)[]>;
  sort: Sorter[];
  view: string;
  order: string[];
  visible: Record<string, boolean>;
  widths: Record<string, number>;
}
function viewFilters(filters: DashboardFilters): DashboardView['filters'] {
  return Object.fromEntries(
    Object.entries(filters).map(([key, value]) => [
      key,
      value instanceof Set
        ? [...value].filter(
            (item): item is string | number =>
              typeof item === 'string' ||
              (typeof item === 'number' && Number.isFinite(item)),
          )
        : value,
    ]),
  );
}
function dashboardColumns(saved: {
  order?: unknown;
  visible?: unknown;
  widths?: unknown;
}) {
  const storedVisible =
    saved.visible && typeof saved.visible === 'object'
      ? (saved.visible as Record<string, unknown>)
      : {};
  const storedWidths =
    saved.widths && typeof saved.widths === 'object'
      ? (saved.widths as Record<string, unknown>)
      : {};
  const order = orderedDashboardColumns([
    ...new Set(
      Array.isArray(saved.order)
        ? saved.order.filter(
            (key): key is string =>
              typeof key === 'string' && ALL_KEYS.includes(key),
          )
        : ALL_KEYS,
    ),
  ]).map((column) => column.key);
  let visible = Object.fromEntries(
    ALL_KEYS.map((key) => [key, storedVisible[key] !== false]),
  );
  if (!Object.values(visible).some(Boolean))
    visible = Object.fromEntries(ALL_KEYS.map((key) => [key, true]));
  const widths = Object.fromEntries(
    ALL_KEYS.flatMap((key) => {
      const width = storedWidths[key];
      return typeof width === 'number' && Number.isFinite(width) && width >= 40
        ? [[key, Math.min(width, 1200)]]
        : [];
    }),
  );
  return { order, visible, widths };
}
function MultiFilter({
  field,
  options,
  selected,
  open,
  onOpen,
  onChange,
}: {
  field: string;
  options: unknown[];
  selected: Set<unknown>;
  open: boolean;
  onOpen: (value: boolean) => void;
  onChange: (value: Set<unknown>) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    menu = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    search = useRef<HTMLInputElement>(null),
    [query, setQuery] = useState(''),
    [left, setLeft] = useState<number | undefined>();
  useEffect(() => {
    if (!open) return;
    setLeft(undefined);
    const frame = requestAnimationFrame(() => {
      const bounds = menu.current?.getBoundingClientRect();
      if (bounds && bounds.right > innerWidth - 16)
        setLeft(innerWidth - 16 - bounds.right);
      search.current?.focus();
    });
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        onOpen(false);
    };
    document.addEventListener('click', outside);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('click', outside);
    };
  }, [open]);
  const label = multiLabels[field] || field;
  return (
    <div
      ref={root}
      data-multi={field}
      className={`${field === 'route_name' ? 'min-w-[120px]' : field === 'car_number' ? 'min-w-[90px]' : field === 'security_key_location' ? 'min-w-[120px]' : field === 'company_name' ? 'min-w-[110px]' : 'min-w-[100px]'} relative`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          onOpen(false);
          button.current?.focus();
          event.stopPropagation();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={'filter-menu-' + field}
        className={
          'ms-button app-input text-left flex items-center justify-between gap-2' +
          (selected.size ? ' border-emerald-500' : '')
        }
        onClick={() => onOpen(!open)}
      >
        <span className="ms-label truncate">
          {label}
          {selected.size ? ' · ' + selected.size + '개' : ''}
        </span>
        <span className="text-zinc-500 text-xs">▾</span>
      </button>
      <div
        ref={menu}
        id={'filter-menu-' + field}
        className={`ms-menu ${open ? '' : 'hidden '}absolute mt-1 z-40 w-72 max-h-72 overflow-auto bg-zinc-800 border border-zinc-700 rounded-md shadow-xl p-2 space-y-1`}
        style={{ left }}
      >
        <input
          ref={search}
          type="text"
          aria-label={label + ' 필터 검색'}
          placeholder="검색"
          className="ms-search app-input mb-1 text-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="ms-options space-y-0.5">
          {options
            .filter(
              (v) =>
                !query || String(v).toLowerCase().includes(query.toLowerCase()),
            )
            .map((v, i) => (
              <label
                key={i}
                className="flex items-center gap-2 text-xs px-1 py-1 rounded hover:bg-zinc-700/60 cursor-pointer"
              >
                <input
                  type="checkbox"
                  id={`${field}__${v}`.replace(/\s+/g, '_')}
                  checked={selected.has(v)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(v);
                    else next.delete(v);
                    onChange(next);
                  }}
                />
                <span className="truncate">{String(v)}</span>
              </label>
            ))}
        </div>
      </div>
    </div>
  );
}
function Work({
  showMe,
  onCloseMe,
}: {
  showMe: boolean;
  onCloseMe: () => void;
}) {
  const { center, profile } = useAdminPage(),
    { toast, feedback } = useFeedback(),
    [rows, setRows] = useState<DashboardRow[]>([]),
    [healthAvailable, setHealthAvailable] = useState(false),
    [loading, setLoading] = useState(true),
    [day, setDay] = useState(0),
    [urlInitial] = useState(initial),
    [filters, setFilters] = useState(urlInitial.filters),
    [applied, setApplied] = useState(urlInitial.filters),
    [sort, setSort] = useState<Sorter[]>(urlInitial.sort),
    [view, setView] = useState(urlInitial.view),
    [search, setSearch] = useState(urlInitial.filters.search),
    [openFilter, setOpenFilter] = useState<string | null>(null),
    [detail, setDetail] = useState<DashboardRow | null>(null);
  const [storedColumns] = useState(() =>
    dashboardColumns({
      order: loadJSON<unknown>('dash.colOrder', ALL_KEYS),
      visible: loadJSON<unknown>('dash.colVisible', {}),
      widths: loadJSON<unknown>('dash.colWidth', {}),
    }),
  );
  const [order, setOrder] = useState(storedColumns.order),
    [visible, setVisible] = useState(storedColumns.visible),
    [widths, setWidths] = useState(storedColumns.widths),
    [columnConfig, setColumnConfig] = useState<{
      order: string[];
      visible: Record<string, boolean>;
    } | null>(null),
    [dragging, setDragging] = useState<string | null>(null),
    [drop, setDrop] = useState<{ key: string; left: boolean } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const interacted = useRef(false),
    prefs = useRef({ order, visible, widths }),
    resizeCleanup = useRef<(() => void) | undefined>(undefined);
  prefs.current = { order, visible, widths };
  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadDashboard(center)
      .then(async (data) => {
        if (!active) return;
        try {
          const health = await dashboardHealth(center);
          if (!active) return;
          const byDriver = new Map(
            health.map((d) => [String(d.id), d.health_certificate_expires_on]),
          );
          setHealthAvailable(true);
          setRows(
            data.map((row) => ({
              ...row,
              primary_driver_health_expires_on:
                byDriver.get(String(row.primary_driver_id)) || null,
              secondary_driver_health_expires_on:
                byDriver.get(String(row.secondary_driver_id)) || null,
            })),
          );
        } catch {
          if (!active) return;
          setHealthAvailable(false);
          setRows(data);
          toast(
            '보건증 만료일을 불러오지 못했습니다. 만료 경고를 확인할 수 없습니다.',
            'warn',
          );
        }
      })
      .catch((error) => {
        if (active) {
          console.error(error);
          toast('데이터를 불러오지 못했습니다.', 'error');
          setRows([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [center.code]);
  useEffect(() => watchHealthDate(() => setDay((value) => value + 1)), []);
  useEffect(() => {
    const timer = setTimeout(() => setApplied(filters), 200);
    return () => clearTimeout(timer);
  }, [filters]);
  useEffect(() => {
    if (!interacted.current) return;
    const params = new URLSearchParams();
    params.set('center', center.slug);
    for (const [key, value] of Object.entries(applied)) {
      if (value instanceof Set && value.size)
        params.set(key, [...value].join('|'));
      else if (typeof value === 'string' && value) params.set(key, value);
    }
    if (sort.length)
      params.set('sort', sort.map((s) => s.key + ':' + s.dir).join(','));
    if (view !== 'flat') params.set('view', view);
    history.replaceState(null, '', location.pathname + '?' + params);
  }, [applied, sort, view, center.slug]);
  useEffect(() => () => resizeCleanup.current?.(), []);
  const result = filterDashboard(rows, applied, sort, healthAvailable),
    filtered = result.rows,
    promoted = result.promoted;
  void day;
  const cols = orderedDashboardColumns(order).filter(
      (c) => visible[c.key] !== false,
    ),
    activeCount = Object.values(applied).filter((v) =>
      v instanceof Set ? v.size : typeof v === 'string' && v,
    ).length;
  function preference(next: {
    order: string[];
    visible: Record<string, boolean>;
    widths: Record<string, number>;
  }) {
    localStorage.setItem('dash.colOrder', JSON.stringify(next.order));
    localStorage.setItem('dash.colVisible', JSON.stringify(next.visible));
    localStorage.setItem('dash.colWidth', JSON.stringify(next.widths));
  }
  function resetFilters() {
    interacted.current = true;
    const next = initialFilters();
    setFilters(next);
    setApplied(next);
    setSearch('');
  }
  function changeView(next: string) {
    interacted.current = true;
    setView(next === 'group' ? 'group' : 'flat');
  }
  function openColumns() {
    setColumnConfig({
      order: orderedDashboardColumns(order).map((column) => column.key),
      visible: { ...visible },
    });
  }
  function applyView(saved: DashboardView) {
    const next = initialFilters();
    for (const key of Object.keys(next)) {
      const value = saved.filters?.[key];
      if (next[key] instanceof Set) {
        next[key] = new Set(
          Array.isArray(value)
            ? value
                .slice(0, 200)
                .filter(
                  (item) =>
                    ((typeof item === 'string' && item.length <= 2000) ||
                      (typeof item === 'number' && Number.isFinite(item))) &&
                    (key !== 'entry_cond' ||
                      entries.some(([entry]) => entry === item)),
                )
            : [],
        );
      } else next[key] = typeof value === 'string' ? value.slice(0, 2000) : '';
    }
    const sortKeys = new Set(
      COLUMNS.map((column) => column.sortKey || column.key),
    );
    const nextSort = Array.isArray(saved.sort)
      ? saved.sort
          .slice(0, COLUMNS.length)
          .filter(
            (item, index, all) =>
              item &&
              sortKeys.has(item.key) &&
              ['asc', 'desc'].includes(item.dir) &&
              all.findIndex((other) => other?.key === item.key) === index,
          )
          .map(({ key, dir }) => ({ key, dir }))
      : structuredClone(DEFAULT_SORT);
    const {
      order: nextOrder,
      visible: nextVisible,
      widths: nextWidths,
    } = dashboardColumns(saved);
    interacted.current = true;
    setFilters(next);
    setApplied(next);
    setSearch(next.search);
    setSort(nextSort);
    setView(saved.view === 'group' ? 'group' : 'flat');
    setOrder(nextOrder);
    setVisible(nextVisible);
    setWidths(nextWidths);
    setOpenFilter(null);
    try {
      preference({
        order: nextOrder,
        visible: nextVisible,
        widths: nextWidths,
      });
    } catch {
      toast(
        '보기는 적용했습니다. 컬럼 설정을 브라우저에 저장하지 못했습니다.',
        'warn',
      );
    }
  }
  const modalOpen = !!detail || !!columnConfig || showMe;
  useWorkspaceActions([
    {
      id: 'dashboard-search',
      title: '코스표 검색',
      description: '대시보드의 검색 입력으로 이동합니다.',
      run: () => searchInput.current?.focus(),
      disabled: modalOpen,
    },
    {
      id: 'dashboard-reset',
      title: '코스표 필터 초기화',
      description: '검색어와 상세 필터를 모두 해제합니다.',
      run: resetFilters,
      disabled: modalOpen || !activeCount,
    },
    {
      id: 'dashboard-view',
      title: view === 'flat' ? '코스별 보기로 전환' : '목록 보기로 전환',
      run: () => changeView(view === 'flat' ? 'group' : 'flat'),
      disabled: modalOpen,
    },
    {
      id: 'dashboard-columns',
      title: '코스표 컬럼 설정',
      description: '표시할 컬럼과 순서를 설정합니다.',
      run: openColumns,
      disabled: modalOpen,
    },
  ]);
  function changeFilter(key: string, value: Set<unknown>) {
    interacted.current = true;
    setFilters((old) => ({ ...old, [key]: value }));
  }
  function sortHeader(key: string, shift: boolean) {
    interacted.current = true;
    setSort((old) => {
      const index = old.findIndex((s) => s.key === key);
      if (!shift)
        return [
          {
            key,
            dir:
              index >= 0 && old.length === 1 && old[0].dir === 'asc'
                ? 'desc'
                : 'asc',
          },
        ];
      const next = old.map((s) => ({ ...s }));
      if (index >= 0) {
        if (next[index].dir === 'asc') next[index].dir = 'desc';
        else next.splice(index, 1);
      } else next.push({ key, dir: 'asc' });
      return next;
    });
  }
  function startResize(key: string, event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    resizeCleanup.current?.();
    const th = event.currentTarget.closest('th')!,
      startX = event.clientX,
      startWidth = th.getBoundingClientRect().width;
    const move = (e: MouseEvent) => {
      const next = {
        ...prefs.current.widths,
        [key]: Math.max(40, startWidth + (e.clientX - startX)),
      };
      prefs.current = { ...prefs.current, widths: next };
      setWidths(next);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      preference(prefs.current);
      resizeCleanup.current = undefined;
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    resizeCleanup.current = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }
  async function copyHealth(expiry: string | null | undefined) {
    if (!validDate(expiry)) {
      toast('복사할 보건증 만료일이 없습니다.', 'warn');
      return;
    }
    const date = expiry.replaceAll('-', '.');
    try {
      await navigator.clipboard.writeText(date);
      toast('만료일 복사: ' + date, 'success');
    } catch {
      toast(
        '복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.',
        'error',
      );
    }
  }
  function health(row: DashboardRow) {
    if (!healthAvailable && (row.primary_driver_id || row.secondary_driver_id))
      return '보건증 확인 불가';
    return (['primary', 'secondary'] as const)
      .filter((role) => row[role + '_driver_id'])
      .map((role, i) => {
        const expiry = row[`${role}_driver_health_expires_on`],
          s = healthStatus(expiry),
          badge = (
            <span
              className={
                'health-badge ' + (promoted.has(row) ? s.className : '')
              }
            >
              {s.label}
              {s.expiry ? ' · ' + s.expiry : ''}
            </span>
          );
        return (
          <span key={role}>
            {i ? <br /> : null}
            {role === 'primary' ? '주: ' : '보조: '}
            {validDate(expiry) ? (
              <button
                type="button"
                data-health-date={expiry.replaceAll('-', '.')}
                title={'클릭하여 ' + expiry.replaceAll('-', '.') + ' 복사'}
                style={{ font: 'inherit', color: 'inherit', cursor: 'copy' }}
                onClick={(e) => {
                  e.stopPropagation();
                  void copyHealth(expiry);
                }}
              >
                {badge}
              </button>
            ) : (
              badge
            )}
          </span>
        );
      });
  }
  function driver(row: DashboardRow) {
    return (
      <>
        {row.primary_driver_name || ''}
        {row.secondary_driver_name ? (
          <span className="text-[11px] text-zinc-500">
            {' '}
            / {row.secondary_driver_name}
          </span>
        ) : null}
      </>
    );
  }
  function contact(row: DashboardRow) {
    return (
      <>
        {formatPhone(row.primary_driver_phone) || '-'}
        {row.secondary_driver_name || row.secondary_driver_phone ? (
          <span className="text-[11px] text-zinc-500">
            {' '}
            / 보조: {formatPhone(row.secondary_driver_phone) || '-'}
          </span>
        ) : null}
      </>
    );
  }
  function overridable(value: unknown, override: unknown) {
    if (!value && !override) return '';
    return override != null ? (
      <span className="text-amber-300">★ {String(value || '')}</span>
    ) : (
      String(value || '')
    );
  }
  function cell(row: DashboardRow, key: string): ReactNode {
    switch (key) {
      case 'primary_driver_name':
        return driver(row);
      case 'primary_driver_phone':
        return contact(row);
      case 'driver_health':
        return health(row);
      case 'entry_cond':
        return (
          <span className="inline-flex gap-1">
            {entries.map(([key, label]) => (
              <span
                key={key}
                className={
                  'px-1.5 py-0.5 rounded text-[10px] border ' +
                  (row[key]
                    ? 'bg-emerald-600/20 border-emerald-600/40 text-emerald-300'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-600 line-through')
                }
              >
                {label}
              </span>
            ))}
          </span>
        );
      case 'delivery_method':
      case 'access_method':
      case 'delivery_location':
        return overridable(row[key], row['override_' + key]);
      case 'dp_address':
        return row.dp_address ? (
          <span title={row.dp_address}>{row.dp_address}</span>
        ) : (
          ''
        );
      case 'dp_contact_name':
        return '';
      case 'dp_contact':
        return formatPhone(row.dp_contact);
      case 'stop_memo':
        return deliveryPointMemo(row);
      default:
        return [
          'arrival_business_min',
          'unloading_start_business_min',
          'unloading_end_business_min',
          'effective_deadline_business_min',
        ].includes(key)
          ? bizMinToStandard(row[key] as number | null)
          : row[key] != null
            ? String(row[key])
            : '';
    }
  }
  function title(row: DashboardRow, column: DashboardColumn) {
    if (column.key === 'driver_health')
      return !healthAvailable
        ? '보건증 확인 불가'
        : (['primary', 'secondary'] as const)
            .filter((role) => row[`${role}_driver_id`])
            .map((role) => {
              const status = healthStatus(
                row[`${role}_driver_health_expires_on`],
              );
              return (
                (role === 'primary' ? '주: ' : '보조: ') +
                status.label +
                (status.expiry ? ' · ' + status.expiry : '')
              );
            })
            .join('');
    if (column.key === 'stop_memo') return deliveryPointMemo(row);
    if (column.key === 'dp_contact') return formatPhone(row.dp_contact);
    return typeof cell(row, column.key) === 'string'
      ? String(cell(row, column.key))
      : String(row[column.key] ?? '');
  }
  const empty = (
      <div className="dashboard-empty">
        <strong>조건에 맞는 코스가 없습니다</strong>
        <p>검색어를 줄이거나 상세 필터를 초기화해 보세요.</p>
        <button
          type="button"
          className="btn btn-ghost"
          data-empty-reset
          onClick={resetFilters}
        >
          필터 초기화
        </button>
      </div>
    ),
    groups = new Map<string, DashboardRow[]>();
  for (const row of filtered) {
    const key = row.route_id || '_unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  function saveDetail(id: string, payload: Record<string, unknown>) {
    setRows((old) =>
      old.map((row) => {
        if (String(row.delivery_point_id) !== String(id)) return row;
        const next = { ...row };
        for (const [key, value] of Object.entries({
          dp_code: payload.code,
          dp_name: payload.name,
          dp_region: payload.region,
          dp_address: payload.address,
          dp_contact: payload.contact,
          base_delivery_method: payload.delivery_method,
          base_access_method: payload.access_method,
          base_delivery_location: payload.delivery_location,
          delivery_method:
            row.override_delivery_method ?? payload.delivery_method,
          access_method: row.override_access_method ?? payload.access_method,
          delivery_location:
            row.override_delivery_location ?? payload.delivery_location,
          security_key_location: payload.security_key_location,
          security_password: payload.security_password,
          dp_memo: payload.memo,
        }))
          next[key] = value;
        return next;
      }),
    );
  }
  const groupKeys = [
    'stop_order',
    'arrival_business_min',
    'unloading_start_business_min',
    'unloading_end_business_min',
    'effective_deadline_business_min',
    'dp_code',
    'dp_name',
    'dp_region',
    'delivery_method',
    'access_method',
    'delivery_location',
    'security_key_location',
    'security_password',
    'dp_address',
    'stop_memo',
  ];
  return (
    <>
      <div id="app" className="app-main" tabIndex={-1}>
        <div id="filter-bar">
          <div className="dashboard-query">
            <input
              id="search-input"
              ref={searchInput}
              type="search"
              aria-label="코스표 검색"
              placeholder="전체 컬럼 검색 (기사명·전화번호 포함)"
              className="app-input w-64 text-xs"
              autoComplete="off"
              value={search}
              onChange={(e) => {
                interacted.current = true;
                setSearch(e.target.value);
                setFilters((old) => ({
                  ...old,
                  search: e.target.value.trim(),
                }));
              }}
            />
            <div
              className="flex rounded overflow-hidden border border-zinc-700 text-xs shrink-0"
              role="group"
              aria-label="코스표 보기 방식"
            >
              {[
                ['flat', '목록'],
                ['group', '코스별'],
              ].map(([key, text]) => (
                <button
                  key={key}
                  className={
                    'view-toggle px-2.5 py-1.5 ' +
                    (view === key
                      ? 'bg-emerald-600 text-white'
                      : 'text-zinc-400 hover:text-zinc-100')
                  }
                  data-view={key}
                  aria-pressed={view === key}
                  onClick={() => changeView(key)}
                >
                  {text}
                </button>
              ))}
            </div>
            <span id="result-count" role="status" aria-live="polite">
              {!rows.length
                ? '데이터 없음'
                : filtered.length === rows.length
                  ? `총 ${rows.length}건`
                  : `총 ${filtered.length}건 (전체 ${rows.length}건 중)`}
            </span>
          </div>
          <SavedViews<DashboardView>
            scope="dashboard"
            value={{
              filters: viewFilters(filters),
              sort,
              view,
              order: orderedDashboardColumns(order).map((column) => column.key),
              visible: Object.fromEntries(
                ALL_KEYS.map((key) => [key, visible[key] !== false]),
              ),
              widths,
            }}
            defaultValue={{
              filters: viewFilters(initialFilters()),
              sort: structuredClone(DEFAULT_SORT),
              view: 'flat',
              order: [...ALL_KEYS],
              visible: Object.fromEntries(ALL_KEYS.map((key) => [key, true])),
              widths: {},
            }}
            onApply={applyView}
            disabled={loading || modalOpen}
          />
          <details className="dashboard-filter-details">
            <summary>
              상세 필터{' '}
              <span id="active-filter-count">
                {activeCount ? '필터 ' + activeCount + '개 적용 중' : ''}
              </span>
            </summary>
            <div className="dashboard-filter-controls">
              {Object.keys(multiLabels).map((key) => {
                const options =
                  key === 'driver_name'
                    ? [
                        ...new Set(
                          rows
                            .flatMap((r) => [
                              r.primary_driver_name,
                              r.secondary_driver_name,
                            ])
                            .filter(Boolean),
                        ),
                      ].sort()
                    : [
                        ...new Set(
                          rows
                            .map((r) => r[key])
                            .filter((v) => v != null && v !== ''),
                        ),
                      ].sort((a, b) =>
                        String(a).localeCompare(String(b), 'ko'),
                      );
                return (
                  <MultiFilter
                    key={key}
                    field={key}
                    options={options}
                    selected={filters[key] as Set<unknown>}
                    open={openFilter === key}
                    onOpen={(value) =>
                      setOpenFilter((old) =>
                        value ? key : old === key ? null : old,
                      )
                    }
                    onChange={(value) => changeFilter(key, value)}
                  />
                );
              })}
              <span className="text-xs text-zinc-500">진입 조건</span>
              {entries.map(([key, text]) => (
                <label key={key} className="cb text-xs">
                  <input
                    type="checkbox"
                    data-cb="entry_cond"
                    value={key}
                    checked={(filters.entry_cond as Set<unknown>).has(key)}
                    onChange={(e) => {
                      const next = new Set(filters.entry_cond as Set<unknown>);
                      if (e.target.checked) next.add(key);
                      else next.delete(key);
                      changeFilter('entry_cond', next);
                    }}
                  />{' '}
                  {text}
                </label>
              ))}
              <button
                id="reset-filters"
                className="btn btn-ghost"
                onClick={resetFilters}
              >
                필터 초기화
              </button>
              <button
                id="reset-sort"
                className="btn btn-ghost"
                onClick={() => {
                  interacted.current = true;
                  setSort(structuredClone(DEFAULT_SORT));
                }}
              >
                정렬 초기화
              </button>
              <button
                id="btn-col-config"
                type="button"
                className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-100"
                onClick={openColumns}
              >
                ⚙️ 컬럼 설정
              </button>
            </div>
          </details>
        </div>
        <div
          id="loading-indicator"
          className={`${loading ? '' : 'hidden '}shrink-0 text-center py-3 text-sm text-zinc-400`}
        >
          데이터를 불러오는 중…
        </div>
        <div id="table-area" className="px-2 py-1">
          <div id="flat-view" className={view === 'flat' ? '' : 'hidden'}>
            {!filtered.length ? (
              empty
            ) : (
              <table className="data-table">
                <colgroup>
                  {cols.map((c) => (
                    <col
                      key={c.key}
                      style={{ width: widths[c.key] || c.defaultWidth || 120 }}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {cols.map((c, index) => {
                      const sortKey = c.sortKey || c.key,
                        sortIndex = sort.findIndex((s) => s.key === sortKey);
                      return (
                        <th
                          key={c.key}
                          draggable
                          data-sortkey={sortKey}
                          data-idx={index}
                          data-key={c.key}
                          className={`th-draggable ${c.sortable !== false ? 'cursor-pointer hover:text-zinc-200' : ''} ${c.align === 'right' ? 'text-right' : ''} ${dragging === c.key ? 'opacity-40' : ''} ${drop?.key === c.key ? (drop.left ? 'drop-left' : 'drop-right') : ''}`}
                          onClick={(e) => {
                            if (
                              e.target instanceof Element &&
                              e.target.classList.contains('col-resizer')
                            )
                              return;
                            if (c.sortable !== false)
                              sortHeader(sortKey, e.shiftKey);
                          }}
                          onDragStart={(e) => {
                            if (
                              e.target instanceof Element &&
                              e.target.classList.contains('col-resizer')
                            ) {
                              e.preventDefault();
                              return;
                            }
                            setDragging(c.key);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', c.key);
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                            setDrop(null);
                          }}
                          onDragOver={(e) => {
                            if (!dragging || dragging === c.key) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            const rect =
                              e.currentTarget.getBoundingClientRect();
                            setDrop({
                              key: c.key,
                              left: e.clientX - rect.left < rect.width / 2,
                            });
                          }}
                          onDragLeave={() => setDrop(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (!dragging || dragging === c.key) return;
                            const rect =
                                e.currentTarget.getBoundingClientRect(),
                              before = e.clientX - rect.left < rect.width / 2,
                              next = orderedDashboardColumns(order).map(
                                (c) => c.key,
                              ),
                              from = next.indexOf(dragging);
                            if (from < 0) return;
                            next.splice(from, 1);
                            const to = next.indexOf(c.key);
                            if (to < 0) return;
                            next.splice(before ? to : to + 1, 0, dragging);
                            setOrder(next);
                            preference({ ...prefs.current, order: next });
                            setDragging(null);
                            setDrop(null);
                          }}
                        >
                          <span className="th-inner">
                            <span
                              className="th-grip"
                              title="드래그해서 순서 변경"
                            >
                              ⋮⋮
                            </span>
                            <span>{c.label}</span>
                            {sortIndex >= 0 ? (
                              <span className="text-[10px] text-emerald-400 ml-1">
                                {sortIndex + 1}
                                {sort[sortIndex].dir === 'asc' ? '↑' : '↓'}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className="col-resizer"
                            data-resize={c.key}
                            onMouseDown={(e) => startResize(c.key, e)}
                          />
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, index) => (
                    <tr
                      key={String(row.stop_id ?? index)}
                      className={
                        healthAvailable && promoted.has(row)
                          ? healthStatus(rowHealthDate(row)).className
                          : ''
                      }
                      data-stop-id={row.stop_id ?? ''}
                      onClick={() => setDetail(row)}
                    >
                      {cols.map((c) => (
                        <td
                          key={c.key}
                          className={`${c.cls || ''} ${c.align === 'right' ? 'text-right' : ''}`}
                          data-health-copy={
                            c.key === 'driver_health' ? '' : undefined
                          }
                          style={
                            c.key === 'driver_health'
                              ? { cursor: 'copy' }
                              : undefined
                          }
                          title={title(row, c)}
                          onClick={
                            c.key === 'driver_health'
                              ? (e) => {
                                  e.stopPropagation();
                                  const expiry = (
                                    ['primary', 'secondary'] as const
                                  )
                                    .filter((role) => row[role + '_driver_id'])
                                    .map(
                                      (role) =>
                                        row[`${role}_driver_health_expires_on`],
                                    )
                                    .find(validDate);
                                  void copyHealth(expiry);
                                }
                              : undefined
                          }
                        >
                          {cell(row, c.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div
            id="group-view"
            className={`${view === 'group' ? '' : 'hidden '}space-y-3 py-1`}
          >
            {!filtered.length
              ? empty
              : [...groups].map(([key, stops]) => {
                  const sorted = [...stops].sort(
                      (a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0),
                    ),
                    head = sorted[0];
                  return (
                    <section
                      key={key}
                      className="border border-zinc-700 rounded-lg overflow-hidden bg-zinc-900/40"
                    >
                      <header className="px-3 py-2 bg-zinc-800/60 border-b border-zinc-700 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className="font-semibold">
                          {head.route_name || '(코스명 없음)'}
                        </span>
                        <span className="text-zinc-400">
                          {head.car_number || ''}
                        </span>
                        <span className="text-zinc-400">
                          {head.company_name || ''}
                        </span>
                        <span className="text-zinc-400">{driver(head)}</span>
                        <span
                          data-health-copy
                          onClick={() => {
                            const expiry = (['primary', 'secondary'] as const)
                              .map(
                                (role) =>
                                  head[`${role}_driver_health_expires_on`],
                              )
                              .find(validDate);
                            void copyHealth(expiry);
                          }}
                        >
                          {health(head)}
                        </span>
                        <span className="text-zinc-400">
                          연락처: {contact(head)}
                        </span>
                        <span className="text-zinc-500 text-xs">
                          {head.primary_vehicle_plate || ''}
                        </span>
                        <span className="ml-auto text-xs text-zinc-500">
                          납품처 {stops.length}개
                        </span>
                      </header>
                      <div className="overflow-auto">
                        <table className="data-table">
                          <thead>
                            <tr>
                              {[
                                '순서',
                                '입차',
                                '하차시작',
                                '하차종료',
                                '마감',
                                '코드',
                                '납품처',
                                '지역',
                                '납품방식',
                                '진입방식',
                                '납품장소',
                                '열쇠보관장소',
                                '비밀번호',
                                '주소',
                                '비고',
                              ].map((h) => (
                                <th key={h}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sorted.map((row, i) => (
                              <tr
                                key={row.stop_id ?? i}
                                className={
                                  healthAvailable && promoted.has(row)
                                    ? healthStatus(rowHealthDate(row)).className
                                    : ''
                                }
                                data-stop-id={row.stop_id ?? ''}
                                onClick={() => setDetail(row)}
                              >
                                {groupKeys.map((key) => (
                                  <td
                                    key={key}
                                    className={
                                      key === 'stop_order'
                                        ? 'text-right'
                                        : key.endsWith('_min')
                                          ? 'biz-time'
                                          : undefined
                                    }
                                  >
                                    {cell(row, key)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
          </div>
        </div>
      </div>
      {detail ? (
        <DashboardDetail
          key={detail.stop_id}
          row={detail}
          onClose={() => setDetail(null)}
          onSaved={saveDetail}
          toast={toast}
        />
      ) : null}
      {showMe ? (
        <Modal width="sm" onClose={onCloseMe}>
          <div className="p-5">
            <h2 className="text-base font-semibold mb-3">내 정보</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="muted">이름</dt>
              <dd>{profile.display_name || '-'}</dd>
              <dt className="muted">이메일</dt>
              <dd>{profile.email || '-'}</dd>
              <dt className="muted">권한</dt>
              <dd>{profile.role}</dd>
              <dt className="muted">상태</dt>
              <dd>{profile.active ? '활성' : '비활성'}</dd>
            </dl>
            <div className="mt-4 text-right">
              <button id="me-close" className="btn" onClick={onCloseMe}>
                닫기
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
      {columnConfig ? (
        <Modal onClose={() => setColumnConfig(null)}>
          <div className="p-5 w-[420px] max-w-full">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold">컬럼 설정</h2>
              <button
                id="cc-close"
                className="btn btn-ghost text-xs"
                onClick={() => setColumnConfig(null)}
              >
                ×
              </button>
            </div>
            <p className="text-xs text-zinc-400 mb-2">
              표시할 컬럼을 선택하세요. 순서는 헤더를 직접 드래그하거나 ↑↓ 으로
              조정 가능합니다.
            </p>
            <div id="cc-list" className="space-y-1 max-h-[55vh] overflow-auto">
              {columnConfig.order.map((key, index) => {
                const c = COL_MAP[key];
                if (!c) return null;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700 rounded px-2 py-1.5"
                    data-key={key}
                    data-idx={index}
                  >
                    <input
                      type="checkbox"
                      aria-label={c.label + ' 표시'}
                      data-action="toggle"
                      checked={columnConfig.visible[key] !== false}
                      className="accent-emerald-500"
                      onChange={(e) =>
                        setColumnConfig((old) =>
                          old
                            ? {
                                ...old,
                                visible: {
                                  ...old.visible,
                                  [key]: e.target.checked,
                                },
                              }
                            : old,
                        )
                      }
                    />
                    <span className="flex-1 text-sm">{c.label}</span>
                    {([-1, 1] as const).map((delta) => (
                      <button
                        key={delta}
                        data-action={delta < 0 ? 'up' : 'down'}
                        aria-label={
                          c.label + (delta < 0 ? ' 위로 이동' : ' 아래로 이동')
                        }
                        title={delta < 0 ? '위로 이동' : '아래로 이동'}
                        className="px-2 py-0.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded"
                        disabled={
                          delta < 0
                            ? index === 0
                            : index === columnConfig.order.length - 1
                        }
                        onClick={() =>
                          setColumnConfig((old) => {
                            if (!old) return old;
                            const order = [...old.order];
                            [order[index], order[index + delta]] = [
                              order[index + delta],
                              order[index],
                            ];
                            return { ...old, order };
                          })
                        }
                      >
                        {delta < 0 ? '↑' : '↓'}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between pt-3 mt-3 border-t border-zinc-700">
              <button
                id="cc-reset"
                className="px-3 py-1.5 text-sm bg-red-700/70 hover:bg-red-600 rounded"
                onClick={() => {
                  const visible = Object.fromEntries(
                    ALL_KEYS.map((k) => [k, true]),
                  );
                  setOrder([...ALL_KEYS]);
                  setVisible(visible);
                  setWidths({});
                  preference({ order: [...ALL_KEYS], visible, widths: {} });
                  setColumnConfig(null);
                }}
              >
                기본값
              </button>
              <div className="flex gap-2">
                <button
                  id="cc-cancel"
                  className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 rounded"
                  onClick={() => setColumnConfig(null)}
                >
                  취소
                </button>
                <button
                  id="cc-apply"
                  className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 rounded"
                  onClick={() => {
                    setOrder(columnConfig.order);
                    setVisible(columnConfig.visible);
                    preference({
                      ...prefs.current,
                      order: columnConfig.order,
                      visible: columnConfig.visible,
                    });
                    setColumnConfig(null);
                  }}
                >
                  적용
                </button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}
      <OperationsAssistant />
      {feedback}
    </>
  );
}
export default function Dashboard() {
  const [showMe, setShowMe] = useState(false);
  return (
    <AdminPage
      title="대시보드"
      area="dashboard"
      mainId="app"
      bodyClass="bg-zinc-950 text-zinc-100"
      accountActions={
        <button
          id="me-btn"
          className="btn btn-ghost text-xs"
          onClick={() => setShowMe(true)}
        >
          내 정보
        </button>
      }
    >
      <Work showMe={showMe} onCloseMe={() => setShowMe(false)} />
    </AdminPage>
  );
}
