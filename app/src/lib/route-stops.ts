import { supabase } from './supabase';
import type { Route } from './routes';
import type { DeliveryPoint } from './delivery-points';
import type { CompanyOption, Vehicle } from './vehicles';
import type { Driver } from './drivers';
export interface RouteStop {
  id: string; route_id: string; delivery_point_id: string; stop_order: number | null;
  arrival_text: string | null; arrival_business_min: number | null;
  unloading_start_text: string | null; unloading_start_business_min: number | null;
  unloading_end_text: string | null; unloading_end_business_min: number | null;
  deadline_text: string | null; deadline_business_min: number | null;
  override_delivery_method: string | null; override_access_method: string | null; override_delivery_location: string | null; memo: string | null;
}
export interface RouteDetails { route: Route | null; stops: RouteStop[]; points: DeliveryPoint[]; company: CompanyOption | null; drivers: Pick<Driver, 'id' | 'name' | 'phone'>[]; vehicles: Pick<Vehicle, 'id' | 'plate_number' | 'tonnage'>[] }
export async function loadRouteDetails(center: string, id: string): Promise<RouteDetails> {
  const [route, stops, points] = await Promise.all([
    supabase.from('routes').select('*').eq('id', id).eq('center_code', center).maybeSingle<Route>(),
    supabase.from('route_stops').select('*').eq('route_id', id).order('stop_order').returns<RouteStop[]>(),
    supabase.from('delivery_points').select('id, code, name, region, deadline_text, deadline_business_min, delivery_method, access_method, delivery_location, security_key_location, security_password').order('code').eq('center_code', center).returns<DeliveryPoint[]>(),
  ]);
  if (route.error) throw route.error;
  const result: RouteDetails = { route: route.data, stops: stops.data || [], points: points.data || [], company: null, drivers: [], vehicles: [] };
  const item = route.data;
  if (item && [item.company_id, item.primary_driver_id, item.primary_vehicle_id, item.secondary_driver_id, item.secondary_vehicle_id].some(Boolean)) {
    const [company, drivers, vehicles] = await Promise.all([
      item.company_id ? supabase.from('companies').select('id, name').eq('id', item.company_id).eq('center_code', center).maybeSingle<CompanyOption>() : Promise.resolve({ data: null }),
      supabase.from('drivers').select('id, name, phone').eq('center_code', center).in('id', [item.primary_driver_id, item.secondary_driver_id].filter((id): id is string => !!id)).returns<RouteDetails['drivers']>(),
      supabase.from('vehicles').select('id, plate_number, tonnage').eq('center_code', center).in('id', [item.primary_vehicle_id, item.secondary_vehicle_id].filter((id): id is string => !!id)).returns<RouteDetails['vehicles']>(),
    ]);
    result.company = company.data; result.drivers = drivers.data || []; result.vehicles = vehicles.data || [];
  }
  return result;
}
export function upsertRouteStop(payload: Omit<RouteStop, 'id'> & { id?: string }) { return supabase.from('route_stops').upsert(payload, { onConflict: 'id' }).select('*').single<RouteStop>(); }
export function updateStopOrder(stops: Pick<RouteStop, 'id' | 'route_id' | 'delivery_point_id' | 'stop_order'>[]) { return supabase.from('route_stops').upsert(stops, { onConflict: 'id' }); }
export function deleteRouteStop(id: string) { return supabase.from('route_stops').delete().eq('id', id); }
export async function reorderAroundSaved(stops: RouteStop[], saved: RouteStop, desiredOrder: number, routeId: string) {
  if (!saved.id) return;
  const others = stops.filter(stop => stop.id !== saved.id).sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
  const index = Math.max(0, Math.min((desiredOrder || 1) - 1, others.length));
  const ordered = [...others.slice(0, index), saved, ...others.slice(index)].map((stop, index) => ({ ...stop, stop_order: index + 1 }));
  const temporary = ordered.map((stop, index) => ({ id: stop.id, route_id: routeId, delivery_point_id: stop.delivery_point_id, stop_order: -100000 - index }));
  const final = ordered.map(stop => ({ id: stop.id, route_id: routeId, delivery_point_id: stop.delivery_point_id, stop_order: stop.stop_order }));
  const first = await updateStopOrder(temporary); if (first.error) throw first.error;
  const second = await updateStopOrder(final); if (second.error) throw second.error;
}
