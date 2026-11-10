import { supabase } from './supabase';
import { fetchAllRows } from './pagination';
import type { DeliveryPoint } from './delivery-points';
import { catalogList, useErpCatalog, type CatalogEntity } from './erp-course-catalog';
export interface ExportStop {
 id?: string; stop_order?: number | null;
 arrival_business_min?: number | null; arrival_text?: string | null;
 unloading_start_business_min?: number | null; unloading_start_text?: string | null;
 unloading_end_business_min?: number | null; unloading_end_text?: string | null;
 deadline_business_min?: number | null; deadline_text?: string | null;
 override_delivery_method?: string | null; override_access_method?: string | null; override_delivery_location?: string | null; memo?: string | null;
 route: { id?: string; name: string | null; car_number: string | null; active?: boolean; company?: {name:string | null} | null; primary_driver?: {name:string | null;phone:string | null;contact:string | null} | null; primary_vehicle?: {tonnage:number | string | null;plate_number:string | null} | null } | null;
 delivery_point: DeliveryPoint | null;
 resolved?: {
   deadline_text: string | null; deadline_business_min: number | null;
   delivery_method: string | null; access_method: string | null; delivery_location: string | null;
 };
}

type ExportWorkspace = {
 route: CatalogEntity<NonNullable<ExportStop['route']> & {
   company_id: string | null; primary_driver_id: string | null; primary_vehicle_id: string | null;
   stops: (Omit<ExportStop, 'route' | 'delivery_point'> & { id: string; delivery_point_id: string })[];
 }>;
 masters: Record<string, CatalogEntity | { unavailable: true }>;
 effective: Record<string, Record<string, { mode: string; value: unknown }>>;
};

async function erpExportStops(center: string, activeOnly: boolean): Promise<ExportStop[]> {
 const [workspaces, points] = await Promise.all([
   catalogList<ExportWorkspace>('route', { center, workspaces: true }),
   catalogList<CatalogEntity<Omit<DeliveryPoint, 'id'>>>('delivery_point', { center }),
 ]);
 const assigned = new Set(workspaces.flatMap(({ route }) => route.fields.stops.map(s => s.delivery_point_id)));
 const rows = workspaces.flatMap(({ route, masters, effective }) => {
   if (activeOnly && route.fields.active !== true) return [];
   const fields = route.fields;
   const master = (id: string | null) => {
     const record = id ? masters[id] : undefined;
     return record && 'fields' in record ? record.fields : undefined;
   };
   const company = master(fields.company_id);
   const driver = master(fields.primary_driver_id);
   const vehicle = master(fields.primary_vehicle_id);
   return fields.stops.map((stop): ExportStop => {
     const point = master(stop.delivery_point_id) as Omit<DeliveryPoint, 'id'> | undefined;
     const value = (key: string) => effective[stop.id]?.[key]?.mode === 'clear'
       ? null : effective[stop.id]?.[key]?.value;
     const deadline = value('deadline') as { text?: string | null; minute?: number | null } | null;
     return {
       ...stop,
       route: {
         id: route.id, name: fields.name, car_number: fields.car_number, active: fields.active,
         company: company ? { name: company.name as string | null } : null,
         primary_driver: driver ? {
           name: driver.name as string | null, phone: driver.phone as string | null,
           contact: driver.contact as string | null,
         } : null,
         primary_vehicle: vehicle ? {
           tonnage: vehicle.tonnage as number | string | null,
           plate_number: vehicle.plate as string | null,
         } : null,
       },
       delivery_point: point ? { ...point, id: stop.delivery_point_id } : null,
       resolved: {
         deadline_text: deadline?.text ?? null, deadline_business_min: deadline?.minute ?? null,
         delivery_method: (value('delivery_method') as string | null) ?? null,
         access_method: (value('access_method') as string | null) ?? null,
         delivery_location: (value('delivery_location') as string | null) ?? null,
       },
     };
   });
 }).sort((a, b) => (a.stop_order ?? Infinity) - (b.stop_order ?? Infinity)
   || (a.id ?? '').localeCompare(b.id ?? ''));
 return [...rows, ...points.filter(({ id }) => !assigned.has(id))
   .map(({ id, fields }) => ({ route: null, delivery_point: { ...fields, id } }))];
}
export async function loadUnassignedDeliveryPoints(center: string) {
 const points = await fetchAllRows(() => supabase.from('delivery_points')
 .select('id,center_code,code,name,address,region,contact,allow_under_1ton,allow_under_3_5ton,allow_over_5ton,allow_unmanned_yard,delivery_method,access_method,delivery_location,security_key_location,security_password,deadline_text,deadline_business_min,memo')
 .eq('center_code',center).order('id').returns<(DeliveryPoint & {center_code:string})[]>());
 const assignments = await fetchAllRows(() => supabase.from('route_stops').select('id,delivery_point_id,route:routes!inner(id,center_code)').eq('route.center_code',center).order('id'));
 const assigned = new Set(assignments.map(row => String(row.delivery_point_id)));
 return points.filter(point => point.center_code===center && !assigned.has(String(point.id)));
}
export async function loadExportStops(center: string, activeOnly: boolean): Promise<ExportStop[]> {
 if (useErpCatalog) return erpExportStops(center, activeOnly);
 const data = await fetchAllRows(() => {
 let query = supabase.from('route_stops').select(`
      id, stop_order,
      arrival_business_min, arrival_text,
      unloading_start_business_min, unloading_start_text,
      unloading_end_business_min, unloading_end_text,
      deadline_business_min, deadline_text,
      override_delivery_method, override_access_method, override_delivery_location,
      memo,
      route:routes!inner(
        id, name, car_number, active,
        company:companies(id, name),
        primary_driver:drivers!routes_primary_driver_id_fkey(id, name, phone, contact),
        primary_vehicle:vehicles!routes_primary_vehicle_id_fkey(id, plate_number, tonnage)
      ),
      delivery_point:delivery_points(
        id, code, name, address, region, contact,
        allow_under_1ton, allow_under_3_5ton, allow_over_5ton, allow_unmanned_yard,
        delivery_method, access_method, delivery_location,
        security_key_location, security_password,
        deadline_text, deadline_business_min, memo
      )
    `).order('stop_order',{ascending:true}).order('id').eq('route.center_code',center);
 if(activeOnly) query=query.eq('route.active',true);
 return query.returns<ExportStop[]>();
 });
 const unassigned = await loadUnassignedDeliveryPoints(center);
 const rows = data.filter(row=>row.route), represented=new Set(rows.map(row=>String(row.delivery_point?.id)));
 return [...rows,...unassigned.filter(point=>!represented.has(String(point.id))).map(point=>({route:null,delivery_point:point}))];
}
