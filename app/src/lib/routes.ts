import { fetchAllRows } from './pagination';
import { catalogFilter, activeCatalog, softDeleteCatalog, insertCatalog, updateCatalog } from './catalog-scope';
import { useLegacyCommonCatalog } from './erp-course-catalog';
import { supabase } from './supabase';
import type { CompanyOption, Vehicle } from './vehicles';
import type { Driver } from './drivers';
export interface Route { id: string; center_code?: string | null; updated_at?: string | null; name: string; car_number: string | null; company_id: string | null; primary_driver_id: string | null; secondary_driver_id: string | null; primary_vehicle_id: string | null; secondary_vehicle_id: string | null; active: boolean; closed_days: number[] | null }
export interface RouteMasters { companies: CompanyOption[]; drivers: Pick<Driver, 'id' | 'name' | 'phone' | 'company_id'>[]; vehicles: Pick<Vehicle, 'id' | 'plate_number' | 'tonnage' | 'company_id'>[] }
export async function loadRouteMasters(center: string): Promise<RouteMasters> {
  const [companies, drivers, vehicles] = await Promise.all([
    catalogFilter(activeCatalog(supabase.from('companies').select('id, name').order('name')), useLegacyCommonCatalog ? '' : center).returns<RouteMasters['companies']>(),
    catalogFilter(activeCatalog(supabase.from('drivers').select('id, name, phone, company_id').order('name')), useLegacyCommonCatalog ? '' : center).returns<RouteMasters['drivers']>(),
    catalogFilter(activeCatalog(supabase.from('vehicles').select('id, plate_number, tonnage, company_id').order('plate_number')), useLegacyCommonCatalog ? '' : center).returns<RouteMasters['vehicles']>(),
  ]);
  if (companies.error || drivers.error || vehicles.error) throw companies.error || drivers.error || vehicles.error;
  return { companies: companies.data || [], drivers: drivers.data || [], vehicles: vehicles.data || [] };
}
export async function loadRoutes(center: string) {
  const routes = await fetchAllRows<Route>(()=>activeCatalog(catalogFilter(supabase.from('routes').select('*').order('id'), center)).returns<Route[]>());
  const ids = routes.map(row => row.id);
  const counts = ids.length ? await fetchAllRows<{route_id:string}>(()=>supabase.from('route_stops').select('id,route_id').in('route_id', ids).order('id').returns<{ route_id: string }[]>()).then(data=>({data,error:null})) : { data: [], error: null };
  if (counts.error) throw counts.error;
  const stopCounts = new Map<string, number>(); for (const row of counts.data || []) stopCounts.set(row.route_id, (stopCounts.get(row.route_id) || 0) + 1);
  return { routes, stopCounts };
}
export async function saveRoute(payload: Partial<Route> & { id?: string }, expected?: string | null, createId?:string) {
  if (payload.id) return updateCatalog<Route>('routes', payload.id, payload, expected);
  return insertCatalog('routes',payload,createId ?? crypto.randomUUID());
}
export function deleteRoute(center: string, id: string) { if (useLegacyCommonCatalog) return softDeleteCatalog('routes',id); return supabase.from('routes').delete().eq('center_code', center).eq('id', id); }
