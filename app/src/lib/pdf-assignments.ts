import { supabase } from './supabase';
import { fetchAllRows } from './pagination';
import { catalogList, useErpReferenceCatalog, type CatalogEntity } from './erp-course-catalog';
export interface AssignmentDriver {id:string;name:string;center_code:string;company_id:string|null;health_certificate_expires_on?:string|null}
export interface AssignmentCompany {id:string;name:string;center_code:string}
export async function loadAssignmentMasters() {
  if (useErpReferenceCatalog) {
    const centers = await Promise.all(['001','002'].map(async center => {
      const [drivers,companies] = await Promise.all([
        catalogList<CatalogEntity<Omit<AssignmentDriver,'id'|'center_code'>>>('driver',{center}),
        catalogList<CatalogEntity<Omit<AssignmentCompany,'id'|'center_code'>>>('company',{center}),
      ]);
      return {
        drivers: drivers.map(({id,fields}) => ({...fields,id,center_code:center})),
        companies: companies.map(({id,fields}) => ({...fields,id,center_code:center})),
      };
    }));
    return {drivers:centers.flatMap(result=>result.drivers),companies:centers.flatMap(result=>result.companies)};
  }
  const [drivers,companies] = await Promise.all([
    fetchAllRows(()=>supabase.from('drivers').select('id,name,center_code,company_id,health_certificate_expires_on').order('name').returns<AssignmentDriver[]>()),
    fetchAllRows(()=>supabase.from('companies').select('id,name,center_code').order('name').returns<AssignmentCompany[]>()),
  ]);
  return {drivers,companies};
}
