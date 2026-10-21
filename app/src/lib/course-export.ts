import { supabase } from './supabase';
import { fetchAllRows } from './pagination';
import type { DeliveryPoint } from './delivery-points';
export interface ExportStop {
 id?: string; stop_order?: number | null;
 arrival_business_min?: number | null; arrival_text?: string | null;
 unloading_start_business_min?: number | null; unloading_start_text?: string | null;
 unloading_end_business_min?: number | null; unloading_end_text?: string | null;
 deadline_business_min?: number | null; deadline_text?: string | null;
 override_delivery_method?: string | null; override_access_method?: string | null; override_delivery_location?: string | null; memo?: string | null;
 route: { id?: string; name: string | null; car_number: string | null; active?: boolean; company?: {name:string | null} | null; primary_driver?: {name:string | null;phone:string | null;contact:string | null} | null; primary_vehicle?: {tonnage:number | string | null;plate_number:string | null} | null } | null;
 delivery_point: DeliveryPoint | null;
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
