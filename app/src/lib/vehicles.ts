import { useLegacyCommonCatalog } from './erp-course-catalog';
import { catalogFilter, activeCatalog, softDeleteCatalog } from './catalog-scope';
import { supabase } from './supabase';
import { catalogList, useErpCatalog, type CatalogEntity } from './erp-course-catalog';
export interface CompanyOption { id: string; name: string }
export interface Vehicle { id: string; center_code?: string | null; plate_number: string | null; tonnage: number | null; pallet_capacity: number | null; company_id: string | null; memo: string | null; updated_at: string | null }
export interface VehicleRoute { id: string; primary_vehicle_id: string | null; secondary_vehicle_id: string | null }
export interface VehicleInput { id?: string; center_code: string | null; plate_number: string; tonnage: number | null; pallet_capacity: number | null; company_id: string | null; memo: string | null }
export async function loadVehicles(center: string) {
  const [vehicles, companies, routes] = await Promise.all([
    activeCatalog(catalogFilter(supabase.from('vehicles').select('*'),center)).returns<Vehicle[]>(),
    supabase.from('companies').select('id, name').order('name').returns<CompanyOption[]>(),
    useErpCatalog ? catalogList<CatalogEntity<VehicleRoute>>('route', { center }).then(items => ({ data: items.filter(item=>!item.deletedAt).map(item=>({...item.fields,id:item.id})) })) : supabase.from('routes').select('id, primary_vehicle_id, secondary_vehicle_id').returns<VehicleRoute[]>(),
  ]);
  if (vehicles.error || companies.error || ('error' in routes && routes.error)) throw vehicles.error || companies.error || ('error' in routes && routes.error);
  return { rows: vehicles.data || [], companies: companies.data || [], routes: routes.data || [] };
}
export function saveVehicle(payload: VehicleInput) { return supabase.from('vehicles').upsert(payload, { onConflict: 'id' }).select().single<Vehicle>(); }
export function deleteVehicle(center: string, id: string) { if (useLegacyCommonCatalog) return softDeleteCatalog('vehicles',id); return supabase.from('vehicles').delete().eq('center_code', center).eq('id', id); }
