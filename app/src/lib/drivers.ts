import { supabase } from './supabase';
import { fetchAllRows } from './pagination';
import type { CompanyOption } from './vehicles';
export interface Driver { id: string; name: string; phone: string | null; company_id: string | null; memo: string | null; health_certificate_expires_on?: string | null; updated_at: string | null }
interface RouteReference { id: string; primary_driver_id: string | null; secondary_driver_id: string | null }
export interface DocumentCheckRow { id?: string; driver_id?: string; document_type: string }
export async function loadDrivers(center: string) {
  const [rows, companies, routes, health] = await Promise.all([
    fetchAllRows<Driver>(() => supabase.from('drivers').select('*').order('id').eq('center_code', center)),
    supabase.from('companies').select('id, name').order('name').eq('center_code', center).returns<CompanyOption[]>(),
    supabase.from('routes').select('id, primary_driver_id, secondary_driver_id').eq('center_code', center).returns<RouteReference[]>(),
    supabase.from('drivers').select('health_certificate_expires_on').limit(1).eq('center_code', center),
  ]);
  const documents = new Map<string, DocumentCheckRow[] | null>();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const ids = rows.slice(offset, offset + 100).map(row => row.id);
    try { const records = await fetchAllRows<DocumentCheckRow>(() => supabase.from('driver_documents').select('id,driver_id,document_type').in('driver_id', ids).order('id')); ids.forEach(id => documents.set(id, records.filter(row => row.driver_id === id))); }
    catch { ids.forEach(id => documents.set(id, null)); }
  }
  return { rows, companies: companies.data || [], routes: routes.data || [], documents, healthSchemaReady: !health.error };
}
export function saveDriver(payload: { id?: string; center_code: string; name: string; phone: string | null; company_id: string | null; memo: string | null; health_certificate_expires_on?: string | null }) { return supabase.from('drivers').upsert(payload, { onConflict: 'id' }).select().single<Driver>(); }
export function deleteDriver(center: string, id: string) { return supabase.from('drivers').delete().eq('center_code', center).eq('id', id); }
