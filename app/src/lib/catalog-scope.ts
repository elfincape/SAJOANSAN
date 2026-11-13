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
  if(existing.data && !existing.data.deleted_at && Object.entries(payload).every(([key,value])=>catalogValueEqual(existing.data[key],value))) return {data:existing.data,error:null};
  return {data:null,error:result.error};
}

export type CatalogTable = 'routes' | 'delivery_points' | 'drivers' | 'vehicles' | 'companies';
export function catalogValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && catalogValueEqual(left[key], right[key]));
}
export async function readCatalog<T>(table: CatalogTable, id: string) {
  return activeCatalog(supabase.from(table).select('*').eq('id', id)).maybeSingle<T>();
}
export async function updateCatalog<T>(table: CatalogTable, id: string, payload: Record<string, unknown>, expected?: string | null) {
  if (!expected) return { data: null, error: { code: '40001', message: '원본 수정시각을 다시 확인하세요. 입력은 보존됩니다.' } };
  const patch = Object.fromEntries(Object.entries(payload).filter(([key]) => !['id', 'updated_at', 'deleted_at'].includes(key)));
  if (Object.keys(patch).length) {
    const result = await activeCatalog(supabase.from(table).update(patch).eq('id', id).eq('updated_at', expected)).select().maybeSingle<T>();
    if (result.error || result.data) return result;
  }
  // Read back an uncertain save; never silently retry against a newer revision.
  const current = await readCatalog<T>(table, id);
  if (current.error) return current;
  if (current.data && Object.entries(patch).every(([key, value]) => catalogValueEqual((current.data as Record<string, unknown>)[key], value))) return current;
  return { data: null, error: { code: '40001', message: '다른 작업에서 변경되었거나 수정 권한이 없습니다. 입력을 보존했습니다. 최신값과 비교해 주세요.' } };
}
