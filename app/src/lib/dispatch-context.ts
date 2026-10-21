import { supabase } from './supabase';
import type { ProfileDestination } from '../domain/dispatch-profiles';
import type { ImportIssue } from '../domain/dispatch-import';
export interface DispatchDriver {
  id: string;
  course: string;
  driverId: string | null;
  driverName: string;
  vehicleId: string | null;
  vehicleNumber: string;
  tons: number | null;
  capacity: number | null;
  available: boolean;
  originalVehicleId?: string | null;
  originalVehicleNumber?: string;
  originalDriverId?: string | null;
  originalDriverName?: string;
  driverNameOverridden?: boolean;
}
export interface DispatchDestination extends ProfileDestination {
  region?: string | null;
  allow_under_1ton?: boolean | null;
  allow_under_3_5ton?: boolean | null;
  allow_over_5ton?: boolean | null;
  allow_unmanned_yard?: boolean | null;
  delivery_method?: string | null;
  access_method?: string | null;
  delivery_location?: string | null;
  deadline_text?: string | null;
  deadline_business_min?: number | null;
  memo?: string | null;
  serviceMinutes?: number;
  service_minutes?: number;
  marginMinutes?: number;
  margin_minutes?: number;
}
export interface DispatchAddress {
  id: string;
  address?: string;
  address_key?: string;
  standard_address?: string;
  center_code?: string;
  x?: number | null;
  y?: number | null;
  status?: string;
}
export interface DispatchLeg {
  from_id: string;
  to_id: string;
  priority?: string;
  coords_key?: string;
  distance_meters: number;
  duration_seconds: number;
  measured_at?: string;
  center_code?: string;
}
export interface DispatchContext {
  drivers: DispatchDriver[];
  destinations: DispatchDestination[];
  addresses: DispatchAddress[];
  legs: DispatchLeg[];
  issues: ImportIssue[];
}
interface Query {
  eq: (column: string, value: unknown) => Query;
  is: (column: string, value: unknown) => Query;
  order: (column: string) => Query;
  range: (
    start: number,
    end: number,
  ) => PromiseLike<{
    data: unknown[] | null;
    error: { code?: string; message?: string } | null;
  }>;
}
function fail(error: { code?: string; message?: string }): never {
  throw Object.assign(
    Error(
      error.code === 'PT409'
        ? '초안이 변경되었거나 접근할 수 없습니다. 다시 조회한 뒤 저장해 주세요.'
        : 'DB 요청을 처리하지 못했습니다. 로그인 상태와 권한, DB 연결을 확인해 주세요.',
    ),
    { code: error.code, cause: error },
  );
}
export async function readDispatchRows<T>(
  table: string,
  columns: string,
  order = ['id'],
  filter: (query: Query) => Query = (query) => query,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = filter(
      supabase
        .from(table)
        .select(columns)
        .eq('center_code', '002') as unknown as Query,
    );
    for (const column of order) query = query.order(column);
    const { data, error } = await query.range(offset, offset + 999);
    if (error) fail(error);
    if (!Array.isArray(data))
      throw Error('DB 조회 응답이 올바르지 않습니다. 다시 조회해 주세요.');
    rows.push(...(data as T[]));
    if (data.length < 1000) return rows;
  }
}
export async function loadDispatchContext(): Promise<DispatchContext> {
  const issues: ImportIssue[] = [];
  async function read<T>(
    resource: string,
    table: string,
    columns: string,
    order?: string[],
    filter?: (query: Query) => Query,
  ): Promise<T[]> {
    try {
      const { data, error } = await supabase.rpc(
        'operations_resource_allowed',
        { p_resource: resource, p_action: 'read', p_center: '002' },
      );
      if (error) fail(error);
      if (data !== true)
        throw Object.assign(
          Error('평택센터의 해당 기준정보 열람 권한이 없습니다.'),
          { code: 'PERMISSION_DENIED' },
        );
      return await readDispatchRows<T>(table, columns, order, filter);
    } catch (error) {
      const e = error as { code?: string; message?: string };
      issues.push({
        code: e.code || 'CONTEXT_READ_FAILED',
        message: /[가-힣]/.test(e.message || '')
          ? e.message!
          : '기준정보 조회에 실패했습니다. 로그인 상태와 권한을 확인해 주세요.',
        severity: 'error',
        resource,
        table,
      });
      return [];
    }
  }
  const routes = await read<{
    id: string;
    name: string;
    primary_driver_id: string;
    primary_vehicle_id: string;
    active: boolean;
  }>(
    'routes',
    'routes',
    'id,name,primary_driver_id,primary_vehicle_id,active',
    ['id'],
    (query) => query.eq('active', true),
  );
  const people = await read<{ id: string; name: string }>(
    'drivers',
    'drivers',
    'id,name',
  );
  const vehicles = await read<{
    id: string;
    plate_number: string;
    tonnage: number | string | null;
  }>('vehicles', 'vehicles', 'id,plate_number,tonnage');
  const destinations = await read<DispatchDestination>(
    'delivery_points',
    'delivery_points',
    'id,code,name,address,region,allow_under_1ton,allow_under_3_5ton,allow_over_5ton,allow_unmanned_yard,delivery_method,access_method,delivery_location,deadline_text,deadline_business_min,memo,center_code,dispatch_profile',
  );
  const addresses = await read<DispatchAddress>(
      'delivery_points',
      'naver_api_addresses',
      '*',
    ),
    legs = await read<DispatchLeg>('delivery_points', 'naver_api_legs', '*', [
      'from_id',
      'to_id',
    ]);
  const byDriver = new Map(people.map((row) => [row.id, row])),
    byVehicle = new Map(vehicles.map((row) => [row.id, row]));
  const drivers = routes.map((route) => {
    const person = byDriver.get(route.primary_driver_id),
      vehicle = byVehicle.get(route.primary_vehicle_id),
      tons = vehicle?.tonnage == null ? null : Number(vehicle.tonnage);
    return {
      id: route.id,
      course: route.name,
      driverId: person?.id || null,
      driverName: person?.name || '',
      vehicleId: vehicle?.id || null,
      vehicleNumber: vehicle?.plate_number || '',
      tons,
      capacity:
        person && vehicle
          ? (({ '1': 100, '2.5': 250, '3.5': 350 } as Record<string, number>)[
              String(tons)
            ] ?? null)
          : null,
      available: true,
    };
  });
  return { drivers, destinations, addresses, legs, issues };
}
