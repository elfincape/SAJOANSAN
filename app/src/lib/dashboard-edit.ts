import type { DashboardRow } from '../domain/dashboard';
import { displayToMin, minToDisplay } from '../domain/time';
import { permissionAllowed, type PermissionContext } from './permissions';
import { supabase } from './supabase';
import { activeCatalog } from './catalog-scope';
import { fetchAllRows } from './pagination';
import { saveRouteStops, type RouteStop } from './route-stops';

type Table =
  'routes' | 'delivery_points' | 'drivers' | 'vehicles' | 'companies';
type RecordValue = Record<string, unknown>;
export type CellScope = 'value' | 'link' | 'common';
export type CellMode = 'inherit' | 'set' | 'clear';
export interface CellField {
  table: Table;
  field: string;
  idKey: string;
  type?: 'number' | 'time' | 'conditions';
  link?: string;
  condition?:
    'delivery_method' | 'access_method' | 'delivery_location' | 'deadline';
  stop?: boolean;
}
export const cellFields: Record<string, CellField> = {
  company_name: {
    table: 'companies',
    field: 'name',
    idKey: 'company_id',
    link: 'company_id',
  },
  car_number: { table: 'routes', field: 'car_number', idKey: 'route_id' },
  route_name: { table: 'routes', field: 'name', idKey: 'route_id' },
  primary_driver_name: {
    table: 'drivers',
    field: 'name',
    idKey: 'primary_driver_id',
    link: 'primary_driver_id',
  },
  primary_driver_phone: {
    table: 'drivers',
    field: 'phone',
    idKey: 'primary_driver_id',
  },
  primary_vehicle_plate: {
    table: 'vehicles',
    field: 'plate_number',
    idKey: 'primary_vehicle_id',
    link: 'primary_vehicle_id',
  },
  primary_vehicle_tonnage: {
    table: 'vehicles',
    field: 'tonnage',
    idKey: 'primary_vehicle_id',
    type: 'number',
  },
  dp_code: {
    table: 'delivery_points',
    field: 'code',
    idKey: 'delivery_point_id',
  },
  dp_name: {
    table: 'delivery_points',
    field: 'name',
    idKey: 'delivery_point_id',
    link: 'delivery_point_id',
  },
  dp_region: {
    table: 'delivery_points',
    field: 'region',
    idKey: 'delivery_point_id',
  },
  dp_address: {
    table: 'delivery_points',
    field: 'address',
    idKey: 'delivery_point_id',
  },
  dp_contact: {
    table: 'delivery_points',
    field: 'contact',
    idKey: 'delivery_point_id',
  },
  security_key_location: {
    table: 'delivery_points',
    field: 'security_key_location',
    idKey: 'delivery_point_id',
  },
  security_password: {
    table: 'delivery_points',
    field: 'security_password',
    idKey: 'delivery_point_id',
  },
  entry_cond: {
    table: 'delivery_points',
    field: 'entry_cond',
    idKey: 'delivery_point_id',
    type: 'conditions',
  },
  stop_memo: {
    table: 'delivery_points',
    field: 'memo',
    idKey: 'delivery_point_id',
    stop: true,
  },
  stop_order: {
    table: 'routes',
    field: 'stop_order',
    idKey: 'route_id',
    stop: true,
    type: 'number',
  },
  arrival_business_min: {
    table: 'routes',
    field: 'arrival_business_min',
    idKey: 'route_id',
    stop: true,
    type: 'time',
  },
  unloading_start_business_min: {
    table: 'routes',
    field: 'unloading_start_business_min',
    idKey: 'route_id',
    stop: true,
    type: 'time',
  },
  unloading_end_business_min: {
    table: 'routes',
    field: 'unloading_end_business_min',
    idKey: 'route_id',
    stop: true,
    type: 'time',
  },
  effective_deadline_business_min: {
    table: 'delivery_points',
    field: 'deadline_business_min',
    idKey: 'delivery_point_id',
    condition: 'deadline',
    type: 'time',
  },
  delivery_method: {
    table: 'delivery_points',
    field: 'delivery_method',
    idKey: 'delivery_point_id',
    condition: 'delivery_method',
  },
  access_method: {
    table: 'delivery_points',
    field: 'access_method',
    idKey: 'delivery_point_id',
    condition: 'access_method',
  },
  delivery_location: {
    table: 'delivery_points',
    field: 'delivery_location',
    idKey: 'delivery_point_id',
    condition: 'delivery_location',
  },
};
export const entryFields = [
  'allow_under_1ton',
  'allow_under_3_5ton',
  'allow_over_5ton',
  'allow_unmanned_yard',
] as const;
export interface CellSnapshot {
  column: string;
  scope: CellScope;
  table: Table;
  id: string;
  source: RecordValue;
  field: string;
  stops?: RouteStop[];
  stopId?: string;
  candidates: { id: string; label: string }[];
}
export interface CellDraft {
  value: string;
  mode: CellMode;
  conditions: Record<string, boolean | null>;
}

export function defaultCellScope(row: DashboardRow, column: string): CellScope {
  const spec = cellFields[column];
  // Editing the displayed value updates its master. Only an absent master
  // starts with explicit linking; never replace a current ID implicitly.
  return spec?.link && row.route_id && !row[spec.idKey] ? 'link' : 'value';
}
export function cellScopes(row: DashboardRow, column: string): CellScope[] {
  const spec = cellFields[column];
  if (spec?.link && row.route_id) return ['value', 'link'];
  if ((spec?.condition || column === 'stop_memo') && row.route_id)
    return ['value', 'common'];
  return ['value'];
}
export function cellResource(
  row: DashboardRow,
  column: string,
  scope: CellScope,
) {
  const spec = cellFields[column];
  if (!spec) return null;
  const isStop =
    !!row.route_id &&
    scope !== 'common' &&
    (!!(spec.stop || spec.condition) ||
      (scope === 'link' && spec.link === 'delivery_point_id'));
  const table = scope === 'link' || isStop ? 'routes' : spec.table;
  const id = table === 'routes' ? row.route_id : row[spec.idKey];
  if (!id || (isStop && !row.stop_id)) return null;
  return { table, id: String(id), isStop };
}
export function canOfferCell(
  permissions: PermissionContext,
  row: DashboardRow,
  column: string,
) {
  return cellScopes(row, column).some((scope) => {
    const target = cellResource(row, column, scope);
    const access = target && permissions.access[target.table];
    return (
      !!access &&
      (access.edit || access.edit_unclassified || !!access.edit_centers?.length)
    );
  });
}
export async function readCell(
  row: DashboardRow,
  column: string,
  scope: CellScope,
  permissions: PermissionContext,
): Promise<CellSnapshot> {
  const spec = cellFields[column],
    target = cellResource(row, column, scope);
  if (!spec || !target) throw Error('연결된 원본이 없습니다.');
  const field = scope === 'link' ? spec.link! : spec.field;
  const fields = ['id', 'center_code', 'updated_at', 'deleted_at'];
  if (!target.isStop) {
    fields.push(...(spec.type === 'conditions' ? entryFields : [field]));
    if (spec.type === 'time')
      fields.push(field.replace('_business_min', '_text'));
  }
  const { data, error } = await supabase
    .from(target.table)
    .select(fields.join(','))
    .eq('id', target.id)
    .single<RecordValue>();
  if (error) throw error;
  if (data.deleted_at)
    throw Error('삭제된 원본입니다. 기존 연결은 유지됩니다.');
  if (
    !permissionAllowed(
      permissions,
      target.table,
      'edit',
      String(data.center_code || 'unclassified'),
    )
  )
    throw Error('이 원본의 수정 권한이 없습니다.');
  const snapshot: CellSnapshot = {
    column,
    scope,
    table: target.table,
    id: target.id,
    source: data,
    field: scope === 'link' ? spec.link! : spec.field,
    candidates: [],
  };
  if (target.isStop) {
    const result = await supabase
      .from('route_stops')
      .select('*')
      .eq('route_id', target.id)
      .order('stop_order')
      .returns<RouteStop[]>();
    if (result.error) throw result.error;
    if (!result.data?.some((stop) => stop.id === row.stop_id))
      throw Error('코스 연결이 변경되었습니다. 목록을 다시 확인하세요.');
    snapshot.stops = result.data;
    snapshot.stopId = String(row.stop_id);
    if (spec.condition && spec.condition !== 'deadline')
      snapshot.field = 'override_' + spec.field;
  }
  if (scope === 'link') {
    const label = spec.table === 'vehicles' ? 'plate_number' : 'name';
    const extra =
      spec.table === 'delivery_points'
        ? ',code,region'
        : spec.table === 'drivers'
          ? ',phone'
          : spec.table === 'vehicles'
            ? ',tonnage'
            : '';
    const candidates = await fetchAllRows<RecordValue>(() =>
      activeCatalog(
        supabase.from(spec.table).select(`id,${label}${extra}`).order('id'),
      ).returns<RecordValue[]>(),
    );
    snapshot.candidates = candidates.map((item) => ({
      id: String(item.id),
      label: [
        item.code,
        item[label],
        item.region,
        item.phone,
        item.tonnage == null ? '' : `${item.tonnage}톤`,
      ]
        .filter(Boolean)
        .join(' · '),
    }));
    const current =
      snapshot.stops?.find((stop) => stop.id === snapshot.stopId)
        ?.delivery_point_id ?? data[spec.link!];
    if (current && !snapshot.candidates.some((item) => item.id === current))
      snapshot.candidates.unshift({
        id: String(current),
        label: `${String(row[column] || '기존 연결')} (삭제 또는 조회 제한)`,
      });
  }
  return snapshot;
}
export function initialCellDraft(snapshot: CellSnapshot): CellDraft {
  const spec = cellFields[snapshot.column];
  const source =
    (snapshot.stops?.find((stop) => stop.id === snapshot.stopId) as unknown as
      RecordValue | undefined) ?? snapshot.source;
  const raw = source[snapshot.field];
  const modes = source.condition_modes as
    Partial<Record<string, CellMode>> | undefined;
  return {
    value:
      spec.type === 'time'
        ? String(
            source[snapshot.field.replace('_business_min', '_text')] ??
              minToDisplay(raw as number),
          )
        : raw == null
          ? ''
          : String(raw),
    mode:
      spec.condition && snapshot.stops
        ? (modes?.[spec.condition] ?? (raw == null ? 'inherit' : 'set'))
        : 'set',
    conditions: Object.fromEntries(
      entryFields.map((key) => [
        key,
        source[key] == null ? null : source[key] === true,
      ]),
    ),
  };
}
export function cellPatch(
  snapshot: CellSnapshot,
  draft: CellDraft,
): RecordValue {
  const spec = cellFields[snapshot.column];
  if (spec.type === 'conditions')
    return Object.fromEntries(
      entryFields.map((key) => [key, draft.conditions[key]]),
    );
  let value: unknown = draft.value;
  if (snapshot.scope === 'link') {
    if (snapshot.field === 'delivery_point_id' && !value)
      throw Error(
        '납품처를 선택하세요. 정차지 제거는 코스 관리에서 할 수 있습니다.',
      );
    if (value && !snapshot.candidates.some((item) => item.id === value))
      throw Error('목록에서 연결할 원본을 선택하세요.');
    return { [snapshot.field]: value || null };
  }
  if (
    (spec.field === 'name' || spec.field === 'plate_number') &&
    !draft.value.trim()
  )
    throw Error('이름 또는 차량번호를 입력하세요.');
  if (spec.type === 'number') {
    value = draft.value === '' ? null : Number(draft.value);
    if (value !== null && (!Number.isFinite(value) || Number(value) < 0))
      throw Error('0 이상의 숫자를 입력하세요.');
  }
  if (
    spec.type === 'time' &&
    !(snapshot.stops && spec.condition && draft.mode !== 'set')
  ) {
    value = draft.value.trim() === '' ? null : displayToMin(draft.value);
    if (draft.value.trim() && value === null)
      throw Error('시간은 00:00~23:59로 입력하세요.');
  }
  const patch: RecordValue = { [snapshot.field]: value };
  if (spec.type === 'time')
    patch[snapshot.field.replace('_business_min', '_text')] =
      value === null ? null : minToDisplay(Number(value));
  if (spec.condition && snapshot.stops) {
    const stop = snapshot.stops.find((item) => item.id === snapshot.stopId)!;
    patch.condition_modes = {
      ...stop.condition_modes,
      [spec.condition]: draft.mode,
    };
    if (draft.mode !== 'set') {
      patch[snapshot.field] = null;
      if (spec.type === 'time')
        patch[snapshot.field.replace('_business_min', '_text')] = null;
    }
  }
  return patch;
}
export function editedStops(
  snapshot: CellSnapshot,
  draft: CellDraft,
): RouteStop[] {
  const patch = cellPatch(snapshot, draft);
  const stops = snapshot.stops!.map((stop) =>
    stop.id === snapshot.stopId ? { ...stop, ...patch } : stop,
  );
  if (snapshot.column !== 'stop_order') return stops;
  const order = Number(draft.value);
  if (!Number.isInteger(order) || order < 1 || order > stops.length)
    throw Error(`순서는 1~${stops.length}로 입력하세요.`);
  const changed = stops.find((stop) => stop.id === snapshot.stopId)!;
  const others = stops.filter((stop) => stop.id !== snapshot.stopId);
  others.splice(order - 1, 0, changed);
  return others.map((stop, index) => ({ ...stop, stop_order: index + 1 }));
}
export async function writeCell(snapshot: CellSnapshot, draft: CellDraft) {
  if (snapshot.stops) {
    const result = await saveRouteStops(
      snapshot.id,
      snapshot.stops,
      editedStops(snapshot, draft),
    );
    if (result.error) throw result.error;
    return;
  }
  const patch = cellPatch(snapshot, draft);
  if (!snapshot.source.updated_at)
    throw Error('수정시각을 확인할 수 없습니다. 입력은 보존됩니다.');
  const result = await supabase
    .from(snapshot.table)
    .update(patch)
    .eq('id', snapshot.id)
    .eq('updated_at', String(snapshot.source.updated_at))
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();
  if (result.error) throw result.error;
  if (result.data) return;
  // A lost response may have already committed this exact edit. Never retry with a fresh revision.
  const current = await supabase
    .from(snapshot.table)
    .select(Object.keys(patch).join(',') + ',deleted_at')
    .eq('id', snapshot.id)
    .single<RecordValue>();
  if (
    !current.error &&
    current.data &&
    !(current.data as RecordValue).deleted_at &&
    Object.entries(patch).every(
      ([key, value]) => (current.data as RecordValue)[key] === value,
    )
  )
    return;
  throw Error(
    '다른 작업에서 수정했거나 권한이 변경되었습니다. 입력을 보존했습니다. 최신값과 비교해 주세요.',
  );
}
