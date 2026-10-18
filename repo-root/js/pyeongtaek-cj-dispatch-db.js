import { supabase } from './supabase.js';
import { routeKey } from './pyeongtaek-cj-dispatch-import.js';
async function all(makeQuery) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await makeQuery().range(offset, offset + 499);
    if (error) throw Error(error.message);
    if (!Array.isArray(data)) throw Error('DB 응답을 확인해 주세요.');
    rows.push(...data);
    if (data.length < 500) break;
    if (rows.length > 100000) throw Error('조회 범위가 너무 큽니다.');
  }
  return rows;
}
export async function loadDispatchResources(date) {
  const [points, routes, vehicles, drivers, addresses, legs, historyRows] =
    await Promise.all([
      all(() =>
        supabase
          .from('delivery_points')
          .select(
            'id,code,name,address,region,deadline_business_min,dispatch_profile',
          )
          .eq('center_code', '002')
          .order('id'),
      ),
      all(() =>
        supabase
          .from('routes')
          .select(
            'id,name,car_number,primary_driver_id,primary_vehicle_id,active,closed_days',
          )
          .eq('center_code', '002')
          .order('id'),
      ),
      all(() =>
        supabase
          .from('vehicles')
          .select('id,plate_number,tonnage')
          .eq('center_code', '002')
          .order('id'),
      ),
      all(() =>
        supabase
          .from('drivers')
          .select('id,name')
          .eq('center_code', '002')
          .order('id'),
      ),
      all(() =>
        supabase
          .from('naver_api_addresses')
          .select('id,address,address_key,standard_address,x,y,status')
          .eq('center_code', '002')
          .order('id'),
      ),
      all(() =>
        supabase
          .from('naver_api_legs')
          .select(
            'from_id,to_id,priority,coords_key,distance_meters,duration_seconds,measured_at',
          )
          .eq('center_code', '002')
          .order('from_id')
          .order('to_id')
          .order('priority'),
      ),
      all(() =>
        supabase
          .from('charter_trips')
          .select('id,business_date,payload')
          .eq('center_code', '002')
          .lt('business_date', date)
          .order('id'),
      ),
    ]);
  const stops = routes.length
    ? await all(() =>
        supabase
          .from('route_stops')
          .select('route_id,delivery_point_id,stop_order,deadline_business_min')
          .in(
            'route_id',
            routes.map((r) => r.id),
          )
          .order('id'),
      )
    : [];
  for (const r of routes) {
    r.vehicle = vehicles.find((v) => v.id === r.primary_vehicle_id) || null;
    r.driver_name =
      drivers.find((d) => d.id === r.primary_driver_id)?.name || '';
    r.stops = stops.filter((s) => s.route_id === r.id);
    r.dispatchKey = routeKey(r.name || r.car_number);
  }
  return {
    points,
    routes,
    addresses,
    legs,
    history: historyRows.map((r) => ({ ...r.payload, date: r.business_date })),
    beforeDate: date,
  };
}
export async function saveDispatchDraft(state, reference) {
  const { data, error } = await supabase.rpc('save_pyeongtaek_dispatch_draft', {
    p_id: reference?.id || null,
    p_date: state.plan.date,
    p_payload: state,
    p_revision: reference?.revision || 0,
  });
  if (error)
    throw Error(
      error.code === 'PT409'
        ? '다른 곳에서 수정된 가배차입니다. 다시 불러온 뒤 저장해 주세요.'
        : error.message,
    );
  if (!data?.id || !Number.isInteger(data.revision))
    throw Error('가배차 저장 응답을 확인해 주세요.');
  return data;
}
export async function listDispatchDrafts() {
  const { data, error } = await supabase
    .from('pyeongtaek_dispatch_drafts')
    .select('id,business_date,revision,updated_at')
    .eq('center_code', '002')
    .order('updated_at', { ascending: false })
    .limit(30);
  if (error) throw Error(error.message);
  return data || [];
}
export async function readDispatchDraft(id) {
  const { data, error } = await supabase
    .from('pyeongtaek_dispatch_drafts')
    .select('*')
    .eq('center_code', '002')
    .eq('id', id)
    .single();
  if (error) throw Error(error.message);
  return data;
}
