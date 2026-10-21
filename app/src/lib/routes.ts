import { supabase } from './supabase';
import type { CompanyOption, Vehicle } from './vehicles';
import type { Driver } from './drivers';
export interface Route { id: string; name: string; car_number: string | null; company_id: string | null; primary_driver_id: string | null; secondary_driver_id: string | null; primary_vehicle_id: string | null; secondary_vehicle_id: string | null; active: boolean; closed_days: number[] | null }
export interface RouteMasters { companies: CompanyOption[]; drivers: Pick<Driver, 'id' | 'name' | 'phone' | 'company_id'>[]; vehicles: Pick<Vehicle, 'id' | 'plate_number' | 'tonnage' | 'company_id'>[] }
export async function loadRouteMasters(center: string): Promise<RouteMasters> {
  const [companies, drivers, vehicles] = await Promise.all([
    supabase.from('companies').select('id, name').order('name').eq('center_code', center).returns<RouteMasters['companies']>(),
    supabase.from('drivers').select('id, name, phone, company_id').order('name').eq('center_code', center).returns<RouteMasters['drivers']>(),
    supabase.from('vehicles').select('id, plate_number, tonnage, company_id').order('plate_number').eq('center_code', center).returns<RouteMasters['vehicles']>(),
  ]);
  if (companies.error || drivers.error || vehicles.error) throw companies.error || drivers.error || vehicles.error;
  return { companies: companies.data || [], drivers: drivers.data || [], vehicles: vehicles.data || [] };
}
export async function loadRoutes(center: string) {
  const { data, error } = await supabase.from('routes').select('*').eq('center_code', center).returns<Route[]>();
  if (error) throw error;
  const routes = data || [], ids = routes.map(row => row.id);
  const counts = ids.length ? await supabase.from('route_stops').select('route_id').in('route_id', ids).returns<{ route_id: string }[]>() : { data: [], error: null };
  if (counts.error) throw counts.error;
  const stopCounts = new Map<string, number>(); for (const row of counts.data || []) stopCounts.set(row.route_id, (stopCounts.get(row.route_id) || 0) + 1);
  return { routes, stopCounts };
}
export function saveRoute(payload: Omit<Route, 'id'> & { id?: string; center_code: string }) { return supabase.from('routes').upsert(payload, { onConflict: 'id' }).select('id').single<{ id: string }>(); }
export function deleteRoute(center: string, id: string) { return supabase.from('routes').delete().eq('center_code', center).eq('id', id); }
