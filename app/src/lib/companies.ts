import { supabase } from './supabase';
import { catalogList, useErpCatalog, useErpReferenceCatalog, type CatalogEntity } from './erp-course-catalog';
export interface Company { id: string; name: string; memo: string | null; updated_at: string | null }
interface Reference { id: string; company_id: string | null }
export async function loadCompanies(center: string) {
  if (useErpReferenceCatalog) {
    const companyRows = catalogList<CatalogEntity<Omit<Company,'id'>>>('company', { center });
    const references = (kind: 'driver'|'vehicle'|'route') =>
      catalogList<CatalogEntity<Omit<Reference,'id'>>>(kind, { center })
        .then(items => items.map(({fields,id}) => ({ ...fields,id })));
    const [rows, drivers, vehicles, routes] = await Promise.all([
      companyRows, references('driver'), references('vehicle'), references('route'),
    ]);
    return { rows: rows.map(({fields,id}) => ({ ...fields,id })), drivers, vehicles, routes };
  }
  const [companies, drivers, vehicles, routes] = await Promise.all([
    supabase.from('companies').select('*').eq('center_code', center).returns<Company[]>(),
    supabase.from('drivers').select('id, company_id').eq('center_code', center).returns<Reference[]>(),
    supabase.from('vehicles').select('id, company_id').eq('center_code', center).returns<Reference[]>(),
    useErpCatalog ? catalogList<CatalogEntity<Reference>>('route', { center }).then(items => ({ data: items.filter(item=>!item.deletedAt).map(item=>({...item.fields,id:item.id})) })) : supabase.from('routes').select('id, company_id').eq('center_code', center).returns<Reference[]>(),
  ]);
  if (companies.error) throw companies.error;
  return { rows: companies.data || [], drivers: drivers.data || [], vehicles: vehicles.data || [], routes: routes.data || [] };
}
export function saveCompany(payload: { id?: string; center_code: string; name: string; memo: string | null }) { return supabase.from('companies').upsert(payload, { onConflict: 'id' }).select().single<Company>(); }
export function deleteCompany(center: string, id: string) { return supabase.from('companies').delete().eq('center_code', center).eq('id', id); }
