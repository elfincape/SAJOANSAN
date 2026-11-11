import { supabase } from './supabase';
import { catalogList, useErpCatalog, useErpReferenceCatalog, type CatalogEntity } from './erp-course-catalog';
import { oneDriveCall } from './onedrive';
import { fetchAllRows } from './pagination';
import type { CompanyOption } from './vehicles';
export interface Driver { id: string; name: string; phone: string | null; company_id: string | null; memo: string | null; health_certificate_expires_on?: string | null; updated_at: string | null }
interface RouteReference { id: string; primary_driver_id: string | null; secondary_driver_id: string | null }
export interface DocumentCheckRow { id?: string; driver_id?: string; document_type: string }
export async function loadDrivers(center: string) {
  if (useErpReferenceCatalog) {
    const [drivers, companyRows, routeRows, summary] = await Promise.all([
      catalogList<CatalogEntity<Omit<Driver,'id'>>>('driver', { center }),
      catalogList<CatalogEntity<Omit<CompanyOption,'id'>>>('company', { center }),
      catalogList<CatalogEntity<Omit<RouteReference,'id'>>>('route', { center }),
      oneDriveCall<{documents: DocumentCheckRow[]}>('document-summary', { center }).catch(() => null),
    ]);
    const rows = drivers.map(({fields,id}) => ({ ...fields,id }));
    return {
      rows,
      companies: companyRows.map(({fields,id}) => ({ ...fields,id })),
      routes: routeRows.map(({fields,id}) => ({ ...fields,id })),
      documents: new Map(rows.map(({id}) => [id, summary?.documents.filter(row => row.driver_id === id) ?? null])),
      healthSchemaReady: true,
    };
  }
  const [rows, companies, routes, health] = await Promise.all([
    fetchAllRows<Driver>(() => supabase.from('drivers').select('*').order('id').eq('center_code', center)),
    supabase.from('companies').select('id, name').order('name').eq('center_code', center).returns<CompanyOption[]>(),
    useErpCatalog ? catalogList<CatalogEntity<RouteReference>>('route', { center }).then(items => ({ data: items.filter(item=>!item.deletedAt).map(item=>({...item.fields,id:item.id})) })) : supabase.from('routes').select('id, primary_driver_id, secondary_driver_id').eq('center_code', center).returns<RouteReference[]>(),
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
