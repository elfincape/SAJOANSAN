import { supabase } from './supabase';

export interface DeliveryPoint {
  id: string; code?: string | null; name: string; address?: string | null; region?: string | null;
  deadline_text?: string | null; deadline_business_min?: number | null;
  allow_under_1ton?: boolean | null; allow_under_3_5ton?: boolean | null; allow_over_5ton?: boolean | null; allow_unmanned_yard?: boolean | null;
  delivery_method?: string | null; access_method?: string | null; delivery_location?: string | null;
  security_key_location?: string | null; security_password?: string | null;
  rep_name?: string | null; rep_phone?: string | null; contact_name?: string | null; contact_office?: string | null; contact_mobile?: string | null; contact?: string | null;
  memo?: string | null; photos?: unknown; updated_at?: string | null; route_stops?: { route_id: string }[];
}
export function loadDeliveryPoints(center: string) { return supabase.from('delivery_points').select('*,route_stops(route_id)').eq('center_code', center).returns<DeliveryPoint[]>(); }
export async function saveDeliveryPoint(initialPayload: Record<string, unknown>) {
  const payload = { ...initialPayload }, removedColumns: string[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    const { data, error } = await supabase.from('delivery_points').upsert(payload, { onConflict: 'id' }).select().single<DeliveryPoint>();
    if (!error) return { data, error: null, removedColumns };
    const missing = error.message.match(/Could not find the '([^']+)' column/)?.[1] || '';
    if (!missing || !(missing in payload)) return { data: null, error, removedColumns };
    if (missing === 'photos') return { data: null, error: { message: '사진 저장 컬럼이 없습니다. delivery-point-photos.sql을 먼저 실행해 주세요.', code: undefined }, removedColumns };
    delete payload[missing]; removedColumns.push(missing);
  }
  return { data: null, error: { message: '스키마 컬럼 재시도 횟수를 초과했습니다.', code: undefined }, removedColumns };
}
export function deliveryPointUsage(id: string) { return supabase.from('route_stops').select('id', { count: 'exact', head: true }).eq('delivery_point_id', id); }
export function deleteDeliveryPoint(center: string, id: string) { return supabase.from('delivery_points').delete().eq('center_code', center).eq('id', id); }
