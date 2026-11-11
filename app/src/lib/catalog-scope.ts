import { supabase } from './supabase';
import { useLegacyCommonCatalog } from './erp-course-catalog';

// Filters narrow an RLS-authorized result; they never grant access.
export function catalogFilter<T>(query: T, center: string, column = 'center_code'): T {
  const filter = query as {eq: (key: string, value: string) => T; is: (key: string, value: null) => T};
  if (useLegacyCommonCatalog && !center) return query;
  if (useLegacyCommonCatalog && center === 'unclassified') return filter.is(column, null);
  return filter.eq(column, center);
}

export function activeCatalog<T>(query:T):T {
 return useLegacyCommonCatalog ? (query as {is:(key:string,value:null)=>T}).is('deleted_at',null) : query;
}
export async function softDeleteCatalog(table: 'routes'|'delivery_points'|'drivers'|'vehicles'|'companies', id:string) {
 const {data,error} = await supabase.from(table).update({deleted_at:new Date().toISOString()}).eq('id',id).is('deleted_at',null).select('id').maybeSingle();
 return {data,error:error ?? (!data ? {message:'원본을 찾을 수 없거나 삭제 권한이 없습니다.',code:'42501'} : null)};
}

export async function insertCatalog(table:'routes'|'delivery_points', payload:Record<string,unknown>, id:string) {
  const result=await supabase.from(table).insert({...payload,id}).select().single();
  if(result.error?.code!=='23505') return result;
  const existing=await supabase.from(table).select('*').eq('id',id).maybeSingle();
  if(existing.error) return existing;
  if(existing.data && Object.entries(payload).every(([key,value])=>JSON.stringify(existing.data[key])===JSON.stringify(value))) return {data:existing.data,error:null};
  return {data:null,error:result.error};
}
