import { supabase } from './supabase';
import type { TransferRow } from '../domain/transfers';
import { catalogList, useErpCatalog, type CatalogEntity } from './erp-course-catalog';
export interface StoredTransfer extends Omit<TransferRow,'_uid'|'_dirty'|'photos'> {
 photo1_data_url:string|null;photo2_data_url:string|null;photo3_data_url:string|null;photo4_data_url:string|null;
 erp_route_id?:string|null;erp_company_id?:string|null;erp_driver_id?:string|null;erp_vehicle_id?:string|null;
}
export interface TransferMasters {companies:{id:string;name:string}[];routes:{id:string;name:string;car_number:string|null;company_id:string|null;primary_driver_id:string|null;primary_vehicle_id:string|null}[];drivers:{id:string;name:string;phone:string|null;contact:string|null;company_id:string|null}[];vehicles:{id:string;plate_number:string;company_id:string|null}[]}
export async function loadTransferMasters(center:string):Promise<TransferMasters>{
 if(useErpCatalog){
  const [co,ro,dr,ve]=await Promise.all([
   catalogList<CatalogEntity<Omit<TransferMasters['companies'][number],'id'>>>('company'),
   catalogList<CatalogEntity<Omit<TransferMasters['routes'][number],'id'>>>('route',{center}),
   catalogList<CatalogEntity<Omit<TransferMasters['drivers'][number],'id'>>>('driver'),
   catalogList<CatalogEntity<{plate:string;company_id:string|null}>>('vehicle')
  ]);
  const rows=<T,>(items:CatalogEntity<T>[])=>items.filter(item=>!item.deletedAt).map(item=>({...item.fields,id:item.id}));
  return {companies:rows(co).sort((a,b)=>a.name.localeCompare(b.name,'ko')),
   routes:rows(ro).sort((a,b)=>(a.car_number||'').localeCompare(b.car_number||'','ko',{numeric:true})),
   drivers:rows(dr).sort((a,b)=>a.name.localeCompare(b.name,'ko')),
   vehicles:rows(ve).map(({plate,...vehicle})=>({...vehicle,plate_number:plate})).sort((a,b)=>a.plate_number.localeCompare(b.plate_number,'ko'))};
 }
 const [co,ro,dr,ve]=await Promise.all([
 supabase.from('companies').select('id, name').order('name').eq('center_code',center),
 supabase.from('routes').select('id, name, car_number, company_id, primary_driver_id, primary_vehicle_id').order('car_number').eq('center_code',center),
 supabase.from('drivers').select('id, name, phone, contact, company_id').order('name').eq('center_code',center),
 supabase.from('vehicles').select('id, plate_number, company_id').order('plate_number').eq('center_code',center)]);
 if(co.error||ro.error||dr.error||ve.error)throw co.error||ro.error||dr.error||ve.error;
 return {companies:co.data||[],routes:ro.data||[],drivers:dr.data||[],vehicles:ve.data||[]};
}
const fields = `
      id,
      center,
      center_code,
      delivery_date,
      company_id,
      route_id,
      driver_id,
      vehicle_id,
      company_name,
      route_name,
      driver_name,
      driver_phone,
      vehicle_plate,
      photo1_data_url,
      photo2_data_url,
      photo3_data_url,
      photo4_data_url,
      memo,
      created_by,
      created_at,
      updated_at
    ` + (useErpCatalog ? ',erp_route_id,erp_company_id,erp_driver_id,erp_vehicle_id' : '');
export function loadSavedTransfers(center:string){return supabase.from('transfer_deliveries').select(fields).eq('center_code',center).order('delivery_date',{ascending:true}).order('created_at',{ascending:true}).limit(1000).returns<StoredTransfer[]>();}
export function saveTransfer(center:string,id:string|null,payload:Record<string,unknown>){
 const {route_id,company_id,driver_id,vehicle_id,...snapshot}=payload;
 const values=useErpCatalog ? {...snapshot,erp_route_id:route_id,erp_company_id:company_id,erp_driver_id:driver_id,erp_vehicle_id:vehicle_id} : payload;
 const query=id ? supabase.from('transfer_deliveries').update(values).eq('center_code',center).eq('id',id) : supabase.from('transfer_deliveries').insert(values);
 return query.select(fields).single<StoredTransfer>();
}
export function deleteTransfer(center:string,id:string){return supabase.from('transfer_deliveries').delete().eq('center_code',center).eq('id',id);}
export function deleteTransfers(center:string,ids:string[]){return supabase.from('transfer_deliveries').delete().eq('center_code',center).in('id',ids);}
