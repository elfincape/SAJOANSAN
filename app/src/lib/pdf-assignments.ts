import { supabase } from './supabase';
import { fetchAllRows } from './pagination';
export interface AssignmentDriver {id:string;name:string;center_code:string;company_id:string|null;health_certificate_expires_on?:string|null}
export interface AssignmentCompany {id:string;name:string;center_code:string}
export async function loadAssignmentMasters(){const [drivers,companies]=await Promise.all([fetchAllRows(()=>supabase.from('drivers').select('id,name,center_code,company_id,health_certificate_expires_on').order('name').returns<AssignmentDriver[]>()),fetchAllRows(()=>supabase.from('companies').select('id,name,center_code').order('name').returns<AssignmentCompany[]>())]);return {drivers,companies};}
