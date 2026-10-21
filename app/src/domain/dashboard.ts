import { prioritizeHealthRows } from './driver-health';
import type { HealthRow } from './driver-health';
export interface DashboardRow extends HealthRow {
  stop_id?: string | null;
  route_id?: string | null;
  route?: { id?: string } | null;
  delivery_point_id?: string | null;
  company_name?: string | null;
  route_name?: string | null;
  car_number?: string | null;
  primary_vehicle_tonnage?: number | string | null;
  primary_vehicle_plate?: string | null;
  primary_driver_name?: string | null;
  primary_driver_phone?: string | null;
  secondary_driver_name?: string | null;
  secondary_driver_phone?: string | null;
  stop_order?: number | null;
  arrival_business_min?: number | null;
  unloading_start_business_min?: number | null;
  unloading_end_business_min?: number | null;
  effective_deadline_business_min?: number | null;
  dp_code?: string | null;
  dp_name?: string | null;
  dp_region?: string | null;
  dp_address?: string | null;
  dp_contact?: string | null;
  dp_contact_name?: string | null;
  dp_memo?: string | null;
  stop_memo?: string | null;
  delivery_method?: string | null;
  access_method?: string | null;
  delivery_location?: string | null;
  base_delivery_method?: string | null;
  base_access_method?: string | null;
  base_delivery_location?: string | null;
  override_delivery_method?: string | null;
  override_access_method?: string | null;
  override_delivery_location?: string | null;
  security_key_location?: string | null;
  security_password?: string | null;
  allow_under_1ton?: boolean | null;
  allow_under_3_5ton?: boolean | null;
  allow_over_5ton?: boolean | null;
  allow_unmanned_yard?: boolean | null;
  [key: string]: unknown;
}
export interface DashboardColumn {
  key: string;
  label: string;
  sortKey?: string;
  defaultWidth: number;
  sortable?: boolean;
  align?: string;
  cls?: string;
}
export interface Sorter {
  key: string;
  dir: 'asc' | 'desc';
}
export type DashboardFilters = { search: string } & Record<
  string,
  Set<unknown> | string
>;
export const DEFAULT_SORT: Sorter[] = [
  { key: 'primary_driver_name', dir: 'asc' },
  { key: 'arrival_business_min', dir: 'asc' },
];
export function initialFilters(): DashboardFilters {
  return {
    company_name: new Set(),
    route_name: new Set(),
    car_number: new Set(),
    driver_name: new Set(),
    dp_region: new Set(),
    delivery_method: new Set(),
    access_method: new Set(),
    delivery_location: new Set(),
    security_key_location: new Set(),
    security_password: new Set(),
    entry_cond: new Set(),
    search: '',
  };
}
export const COLUMNS: DashboardColumn[] = [
  {
    key: 'company_name',
    label: '운수사',
    sortKey: 'company_name',
    defaultWidth: 130,
  },
  { key: 'car_number', label: '호차', sortKey: 'car_number', defaultWidth: 90 },
  {
    key: 'route_name',
    label: '코스',
    sortKey: 'route_name',
    defaultWidth: 160,
  },
  {
    key: 'primary_vehicle_tonnage',
    label: '톤수',
    sortKey: 'primary_vehicle_tonnage',
    align: 'right',
    defaultWidth: 70,
  },
  {
    key: 'primary_vehicle_plate',
    label: '차량번호',
    sortKey: 'primary_vehicle_plate',
    defaultWidth: 110,
  },
  {
    key: 'primary_driver_name',
    label: '주기사',
    sortKey: 'primary_driver_name',
    defaultWidth: 120,
  },
  {
    key: 'primary_driver_phone',
    label: '기사 연락처',
    sortKey: 'primary_driver_phone',
    defaultWidth: 180,
  },
  { key: 'driver_health', label: '보건증', sortable: false, defaultWidth: 210 },
  {
    key: 'stop_order',
    label: '순서',
    sortKey: 'stop_order',
    align: 'right',
    defaultWidth: 60,
  },
  {
    key: 'arrival_business_min',
    label: '입차',
    sortKey: 'arrival_business_min',
    cls: 'biz-time',
    defaultWidth: 70,
  },
  {
    key: 'unloading_start_business_min',
    label: '하차시작',
    sortKey: 'unloading_start_business_min',
    cls: 'biz-time',
    defaultWidth: 80,
  },
  {
    key: 'unloading_end_business_min',
    label: '하차종료',
    sortKey: 'unloading_end_business_min',
    cls: 'biz-time',
    defaultWidth: 80,
  },
  {
    key: 'effective_deadline_business_min',
    label: '마감',
    sortKey: 'effective_deadline_business_min',
    cls: 'biz-time',
    defaultWidth: 70,
  },
  { key: 'dp_code', label: '코드', sortKey: 'dp_code', defaultWidth: 90 },
  { key: 'dp_name', label: '납품처', sortKey: 'dp_name', defaultWidth: 180 },
  { key: 'dp_region', label: '지역', sortKey: 'dp_region', defaultWidth: 100 },
  { key: 'entry_cond', label: '진입조건', sortable: false, defaultWidth: 140 },
  {
    key: 'delivery_method',
    label: '납품방식',
    sortKey: 'delivery_method',
    defaultWidth: 90,
  },
  {
    key: 'access_method',
    label: '진입방식',
    sortKey: 'access_method',
    defaultWidth: 90,
  },
  {
    key: 'delivery_location',
    label: '납품장소',
    sortKey: 'delivery_location',
    defaultWidth: 90,
  },
  {
    key: 'security_key_location',
    label: '열쇠보관장소',
    sortKey: 'security_key_location',
    defaultWidth: 140,
  },
  {
    key: 'security_password',
    label: '비밀번호',
    sortKey: 'security_password',
    defaultWidth: 120,
  },
  {
    key: 'dp_address',
    label: '주소',
    sortKey: 'dp_address',
    defaultWidth: 240,
  },
  {
    key: 'dp_contact_name',
    label: '담당자',
    sortable: false,
    defaultWidth: 90,
  },
  { key: 'dp_contact', label: '휴대전화', sortable: false, defaultWidth: 130 },
  { key: 'stop_memo', label: '비고', sortable: false, defaultWidth: 200 },
];

export const ALL_KEYS = COLUMNS.map((c) => c.key);
export const COL_MAP = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
export function filterDashboard(
  rows: DashboardRow[],
  filters: DashboardFilters,
  sort: Sorter[],
  healthAvailable: boolean,
) {
  const f = filters as { search: string } & Record<string, Set<unknown>>;
  const terms = f.search.trim().toLowerCase().split(/\s+/).filter(Boolean);

  let filtered = rows.filter((r) => {
    if (f.company_name.size && !f.company_name.has(r.company_name))
      return false;
    if (f.route_name.size && !f.route_name.has(r.route_name)) return false;
    if (f.car_number.size && !f.car_number.has(r.car_number)) return false;
    if (f.dp_region.size && !f.dp_region.has(r.dp_region)) return false;

    if (f.driver_name.size) {
      const ok =
        f.driver_name.has(r.primary_driver_name) ||
        f.driver_name.has(r.secondary_driver_name);
      if (!ok) return false;
    }

    if (f.delivery_method.size && !f.delivery_method.has(r.delivery_method))
      return false;
    if (f.access_method.size && !f.access_method.has(r.access_method))
      return false;
    if (
      f.delivery_location.size &&
      !f.delivery_location.has(r.delivery_location)
    )
      return false;
    if (
      f.security_key_location.size &&
      !f.security_key_location.has(r.security_key_location)
    )
      return false;
    if (
      f.security_password.size &&
      !f.security_password.has(r.security_password)
    )
      return false;

    if (f.entry_cond.size) {
      for (const cond of f.entry_cond) {
        if (!r[String(cond)]) return false;
      }
    }

    if (terms.length) {
      // 모든 검색어가 행에 포함되면 순서와 관계없이 일치한다.
      const values = Object.values(r).filter((value) =>
        ['string', 'number', 'boolean'].includes(typeof value),
      );
      const hay = values.join(' ').toLowerCase();
      const matches = terms.every((term) => {
        if (hay.includes(term)) return true;
        // 전화번호 형식의 검색어만 숫자로 비교해 문자 조건이 무시되지 않게 한다.
        const digits = term.replace(/\D/g, '');
        return (
          /^[+()\d.-]+$/.test(term) &&
          digits.length >= 3 &&
          values.some((value) =>
            String(value).replace(/\D/g, '').includes(digits),
          )
        );
      });
      if (!matches) return false;
    }

    return true;
  });

  const sorters = sort;
  filtered.sort((a, b) => {
    for (const s of sorters) {
      const r = compareVal(a[s.key], b[s.key]);
      if (r !== 0) return s.dir === 'asc' ? r : -r;
    }
    return 0;
  });
  const promoted = new Set<DashboardRow>();
  if (healthAvailable !== false)
    filtered = prioritizeHealthRows(filtered, f, undefined, promoted);
  return { rows: filtered, promoted };
}

export function compareVal(a: unknown, b: unknown) {
  const aN = a == null || a === '';
  const bN = b == null || b === '';

  if (aN && bN) return 0;
  if (aN) return 1;
  if (bN) return -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ko', { numeric: true });
}

export function deliveryPointMemo(row: DashboardRow) {
  return [
    ...new Set(
      [row.dp_memo, row.stop_memo]
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  ].join('\n');
}
export function orderedDashboardColumns(order: string[]) {
  const known = order.filter((k) => COL_MAP[k]);
  if (
    !known.includes('primary_driver_phone') &&
    known.includes('primary_driver_name')
  )
    known.splice(
      known.indexOf('primary_driver_name') + 1,
      0,
      'primary_driver_phone',
    );
  if (!known.includes('driver_health')) {
    const anchor = known.indexOf('primary_driver_phone');
    known.splice(anchor < 0 ? known.length : anchor + 1, 0, 'driver_health');
  }
  return [...known, ...ALL_KEYS.filter((k) => !known.includes(k))].map(
    (k) => COL_MAP[k],
  );
}
