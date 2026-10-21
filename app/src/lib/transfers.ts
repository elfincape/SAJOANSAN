import { supabase } from './supabase';
import type { TransferRow } from '../domain/transfers';
export interface StoredTransfer extends Omit<TransferRow,'_uid'|'_dirty'|'photos'> { photo1_data_url:string|null;photo2_data_url:string|null;photo3_data_url:string|null;photo4_data_url:string|null }
export interface TransferMasters {companies:{id:string;name:string}[];routes:{id:string;name:string;car_number:string|null;company_id:string|null;primary_driver_id:string|null;primary_vehicle_id:string|null}[];drivers:{id:string;name:string;phone:string|null;contact:string|null;company_id:string|null}[];vehicles:{id:string;plate_number:string;company_id:string|null}[]}
export async function loadTransferMasters(center:string):Promise<TransferMasters>{
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
    `;
export function loadSavedTransfers(center:string){return supabase.from('transfer_deliveries').select(fields).eq('center_code',center).order('delivery_date',{ascending:true}).order('created_at',{ascending:true}).limit(1000).returns<StoredTransfer[]>();}
export function saveTransfer(center:string,id:string|null,payload:Record<string,unknown>){const query=id ? supabase.from('transfer_deliveries').update(payload).eq('center_code',center).eq('id',id) : supabase.from('transfer_deliveries').insert(payload);return query.select(fields).single<StoredTransfer>();}
export function deleteTransfer(center:string,id:string){return supabase.from('transfer_deliveries').delete().eq('center_code',center).eq('id',id);}
export function deleteTransfers(center:string,ids:string[]){return supabase.from('transfer_deliveries').delete().eq('center_code',center).in('id',ids);}
