import { supabase } from './supabase';
export interface CompanyOption { id: string; name: string }
export interface Vehicle { id: string; plate_number: string | null; tonnage: number | null; pallet_capacity: number | null; company_id: string | null; memo: string | null; updated_at: string | null }
export interface VehicleRoute { id: string; primary_vehicle_id: string | null; secondary_vehicle_id: string | null }
export interface VehicleInput { id?: string; center_code: string; plate_number: string; tonnage: number | null; pallet_capacity: number | null; company_id: string | null; memo: string | null }
export async function loadVehicles(center: string) {
  const [vehicles, companies, routes] = await Promise.all([
    supabase.from('vehicles').select('*').eq('center_code', center).returns<Vehicle[]>(),
    supabase.from('companies').select('id, name').order('name').eq('center_code', center).returns<CompanyOption[]>(),
    supabase.from('routes').select('id, primary_vehicle_id, secondary_vehicle_id').eq('center_code', center).returns<VehicleRoute[]>(),
  ]);
  if (vehicles.error) throw vehicles.error;
  return { rows: vehicles.data || [], companies: companies.data || [], routes: routes.data || [] };
}
export function saveVehicle(payload: VehicleInput) { return supabase.from('vehicles').upsert(payload, { onConflict: 'id' }).select().single<Vehicle>(); }
export function deleteVehicle(center: string, id: string) { return supabase.from('vehicles').delete().eq('center_code', center).eq('id', id); }
