import { catalogFilter } from './catalog-scope';
import { saveDeliveryPoint } from './delivery-points';
import { supabase } from './supabase';
import { fetchAllRows } from './pagination';
import { loadUnassignedDeliveryPoints } from './course-export';
import type { Center } from './center';
import type { DashboardRow } from '../domain/dashboard';
import type { DeliveryPoint } from './delivery-points';
import { catalogDetail, catalogList, useErpCatalog, useErpReferenceCatalog, type CatalogEntity } from './erp-course-catalog';
async function loadCourseRowsForCenter(center: Center): Promise<DashboardRow[]> {
 return fetchAllRows<DashboardRow>(() => catalogFilter(supabase.from('course_view').select('*'),center.code).order('stop_id').returns<DashboardRow[]>());
}

export function unassignedDashboardRow(
  point: DeliveryPoint & { center_code?: string },
): DashboardRow {
  return {
    stop_id: `unassigned:${point.id}`,
    route_id: null,
    route_name: '코스 미지정',
    stop_order: null,
    center_code: point.center_code,
    delivery_point_id: point.id,
    dp_code: point.code,
    dp_name: point.name,
    dp_address: point.address,
    dp_region: point.region,
    dp_contact: point.contact,
    dp_memo: point.memo,
    allow_under_1ton: point.allow_under_1ton,
    allow_under_3_5ton: point.allow_under_3_5ton,
    allow_over_5ton: point.allow_over_5ton,
    allow_unmanned_yard: point.allow_unmanned_yard,
    delivery_method: point.delivery_method,
    base_delivery_method: point.delivery_method,
    access_method: point.access_method,
    base_access_method: point.access_method,
    delivery_location: point.delivery_location,
    base_delivery_location: point.delivery_location,
    security_key_location: point.security_key_location,
    security_password: point.security_password,
    dp_deadline_text: point.deadline_text,
    dp_deadline_business_min: point.deadline_business_min,
    effective_deadline_text: point.deadline_text,
    effective_deadline_business_min: point.deadline_business_min,
    has_override: false,
  };
}

type CatalogStop = {
  id: string;
  delivery_point_id: string;
  stop_order: number;
  arrival_business_min: number | null;
  unloading_start_business_min: number | null;
  unloading_end_business_min: number | null;
  memo: string | null;
};
type CatalogRoute = {
  route: CatalogEntity<{
    name: string;
    car_number: string | null;
    company_id: string | null;
    primary_driver_id: string | null;
    secondary_driver_id: string | null;
    primary_vehicle_id: string | null;
    stops: CatalogStop[];
  }>;
  masters: Record<string, CatalogEntity | { unavailable: true }>;
  effective: Record<string, Record<string, { mode: 'inherit' | 'set' | 'clear'; value: unknown }>>;
};

async function erpDashboard(center: string): Promise<DashboardRow[]> {
  const [workspaces, unlinked] = await Promise.all([
    catalogList<CatalogRoute>('route', { center, workspaces: true }),
    catalogList<CatalogEntity<Omit<DeliveryPoint, 'id'>>>('delivery_point', { center, unlinked: true }),
  ]);
  const rows = workspaces.flatMap(({ route, masters, effective }) => {
    const r = route.fields;
    const master = (id: string | null) => {
      const entry = id ? masters[id] : undefined;
      return entry && 'fields' in entry ? entry.fields : undefined;
    };
    const company = master(r.company_id);
    const driver = master(r.primary_driver_id);
    const secondary = master(r.secondary_driver_id);
    const vehicle = master(r.primary_vehicle_id);
    return r.stops.flatMap((stop): DashboardRow[] => {
      const point = master(stop.delivery_point_id) as Omit<DeliveryPoint, 'id'> | undefined;
      if (!point) return [];
      const conditions = effective[stop.id] ?? {};
      const value = (key: string) =>
        conditions[key]?.mode === 'clear' ? null : conditions[key]?.value;
      const deadline = value('deadline') as { text?: string; minute?: number } | null | undefined;
      return [{
        ...unassignedDashboardRow({ ...point, id: stop.delivery_point_id, center_code: center }),
        stop_id: stop.id,
        stop_order: stop.stop_order,
        route_id: route.id,
        route_name: r.name,
        car_number: r.car_number,
        dp_contact_name: point.contact_name,
        company_name: company?.name as string | undefined,
        primary_vehicle_plate: vehicle?.plate as string | undefined,
        primary_vehicle_tonnage: vehicle?.tonnage as number | undefined,
        primary_driver_id: r.primary_driver_id,
        primary_driver_name: driver?.name as string | undefined,
        primary_driver_phone: driver?.phone as string | undefined,
        secondary_driver_id: r.secondary_driver_id,
        secondary_driver_name: secondary?.name as string | undefined,
        secondary_driver_phone: secondary?.phone as string | undefined,
        arrival_business_min: stop.arrival_business_min,
        unloading_start_business_min: stop.unloading_start_business_min,
        unloading_end_business_min: stop.unloading_end_business_min,
        stop_memo: stop.memo,
        delivery_method: value('delivery_method') as string | null,
        access_method: value('access_method') as string | null,
        delivery_location: value('delivery_location') as string | null,
        effective_deadline_text: deadline?.text ?? null,
        effective_deadline_business_min: deadline?.minute ?? null,
        has_override: Object.values(conditions).some(({ mode }) => mode !== 'inherit'),
      }];
    });
  });
  return rows.concat(unlinked.map(({ id, fields }) =>
    unassignedDashboardRow({ ...fields, id, center_code: center })));
}

export async function loadDashboard(center: Center) {
  if (useErpCatalog) return erpDashboard(center.code);
  const data = await loadCourseRowsForCenter(center),
    unassigned = await loadUnassignedDeliveryPoints(center.code),
    courseRows = data,
    represented = new Set(
      courseRows.map((row) => String(row.delivery_point_id)),
    );
  return [
    ...courseRows,
    ...unassigned
      .filter((point) => !represented.has(String(point.id)))
      .map(unassignedDashboardRow),
  ];
}
export function dashboardHealth(center: Center) {
  if (useErpReferenceCatalog)
    return catalogList<CatalogEntity<{ health_certificate_expires_on: string | null }>>('driver', { center: center.code })
      .then(items => items.filter(item => !item.deletedAt)
        .map(({ id, fields }) => ({ id, health_certificate_expires_on: fields.health_certificate_expires_on })));
  return fetchAllRows(() =>
    supabase
      .from('drivers')
      .select('id,health_certificate_expires_on')
      .eq('center_code', center.code)
      .order('id')
      .returns<
        { id: string; health_certificate_expires_on: string | null }[]
      >(),
  );
}
export function dashboardDetail(center: Center, id: string) {
  if (useErpCatalog)
    return catalogDetail<Omit<DeliveryPoint, 'id'>>('delivery_point', id)
      .then(item => ({ data: { ...item.fields, id: item.id }, error: null }),
        (error: Error) => ({ data: null, error }));
  return supabase
    .from('delivery_points')
    .select(
      'id,center_code,updated_at,code,name,address,region,contact,delivery_method,access_method,delivery_location,security_key_location,security_password,photos,memo',
    )
    .eq('id', id)
    .single<DeliveryPoint>();
}
export function saveDashboardDetail(
  center: Center,
  id: string,
  payload: Record<string, unknown>,
  expected?: string | null,
) {
  if (useErpCatalog)
    return Promise.resolve({ error: Error('납품처 수정은 ERP에서 진행해 주세요.') });
  return saveDeliveryPoint({...payload,id},expected);
}
