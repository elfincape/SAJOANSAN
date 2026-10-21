import { supabase } from './supabase';
export interface Company { id: string; name: string; memo: string | null; updated_at: string | null }
interface Reference { id: string; company_id: string | null }
export async function loadCompanies(center: string) {
  const [companies, drivers, vehicles, routes] = await Promise.all([
    supabase.from('companies').select('*').eq('center_code', center).returns<Company[]>(),
    supabase.from('drivers').select('id, company_id').eq('center_code', center).returns<Reference[]>(),
    supabase.from('vehicles').select('id, company_id').eq('center_code', center).returns<Reference[]>(),
    supabase.from('routes').select('id, company_id').eq('center_code', center).returns<Reference[]>(),
  ]);
  if (companies.error) throw companies.error;
  return { rows: companies.data || [], drivers: drivers.data || [], vehicles: vehicles.data || [], routes: routes.data || [] };
}
export function saveCompany(payload: { id?: string; center_code: string; name: string; memo: string | null }) { return supabase.from('companies').upsert(payload, { onConflict: 'id' }).select().single<Company>(); }
export function deleteCompany(center: string, id: string) { return supabase.from('companies').delete().eq('center_code', center).eq('id', id); }
