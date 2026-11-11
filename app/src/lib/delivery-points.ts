import { fetchAllRows } from './pagination';
import { useLegacyCommonCatalog } from './erp-course-catalog';
import { catalogFilter, activeCatalog, softDeleteCatalog, insertCatalog } from './catalog-scope';
import { supabase } from './supabase';

export interface DeliveryPoint {
  id: string; deleted_at?:string|null; center_code?: string | null; code?: string | null; name: string; address?: string | null; region?: string | null;
  deadline_text?: string | null; deadline_business_min?: number | null;
  allow_under_1ton?: boolean | null; allow_under_3_5ton?: boolean | null; allow_over_5ton?: boolean | null; allow_unmanned_yard?: boolean | null;
  delivery_method?: string | null; access_method?: string | null; delivery_location?: string | null;
  security_key_location?: string | null; security_password?: string | null;
  rep_name?: string | null; rep_phone?: string | null; contact_name?: string | null; contact_office?: string | null; contact_mobile?: string | null; contact?: string | null;
  memo?: string | null; photos?: unknown; updated_at?: string | null; route_stops?: { route_id: string }[];
}
export function loadDeliveryPoints(center: string) { return fetchAllRows<DeliveryPoint>(() => activeCatalog(catalogFilter(supabase.from('delivery_points').select('*,route_stops(route_id)').order('id'), center)).returns<DeliveryPoint[]>()).then(data=>({data,error:null}),error=>({data:null,error})); }
export async function saveDeliveryPoint(payload: Record<string, unknown>, expected?: string | null, createId?:string) {
  if (payload.id) {
    if (!expected) return {data:null, error:{message:'원본 수정시각을 다시 확인하세요.',code:undefined},removedColumns:[]};
    const {data,error} = await supabase.from('delivery_points').update(payload).eq('id',String(payload.id)).eq('updated_at',expected).select().maybeSingle<DeliveryPoint>();
    return {data,error:error ?? (!data ? {message:'다른 작업에서 변경되었거나 수정 권한이 없습니다. 입력을 보존했습니다.',code:'40001'} : null),removedColumns:[]};
  }
  const {data,error} = await insertCatalog('delivery_points',payload,createId ?? crypto.randomUUID());
  return {data,error,removedColumns:[]};
}
export function deliveryPointUsage(id: string) { return supabase.from('route_stops').select('id', { count: 'exact', head: true }).eq('delivery_point_id', id); }
export function deleteDeliveryPoint(center: string, id: string) { if (useLegacyCommonCatalog) return softDeleteCatalog('delivery_points',id); return supabase.from('delivery_points').delete().eq('center_code', center).eq('id', id); }
