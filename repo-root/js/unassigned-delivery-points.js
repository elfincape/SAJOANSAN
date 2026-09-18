// Shared by the dashboard and course export. Include only genuinely unassigned
// points; inactive routes still count as assignments.
export async function fetchAllRows(makeQuery) {
  const rows = [];
  for (let offset = 0; ; ) {
    const { data, error } = await makeQuery().range(offset, offset + 499);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
    offset += data.length;
  }
}

export async function loadUnassignedDeliveryPoints(supabase, center) {
  if (!center?.code) throw new Error('센터를 먼저 선택해 주세요.');
  const points = await fetchAllRows(() => supabase.from('delivery_points')
    .select('id,center_code,code,name,address,region,contact,allow_under_1ton,allow_under_3_5ton,allow_over_5ton,allow_unmanned_yard,delivery_method,access_method,delivery_location,security_key_location,security_password,deadline_text,deadline_business_min,memo')
    .eq('center_code', center.code).order('id'));
  const assignments = await fetchAllRows(() => supabase.from('route_stops')
    .select('id,delivery_point_id,route:routes!inner(id,center_code)')
    .eq('route.center_code', center.code).order('id'));
  const assigned = new Set(assignments.map(row => String(row.delivery_point_id)));
  return points.filter(point => point.center_code === center.code && !assigned.has(String(point.id)));
}

export function unassignedDashboardRow(point) {
  return {
    stop_id: `unassigned:${point.id}`,
    route_id: null, route_name: '코스 미지정', stop_order: null,
    center_code: point.center_code, delivery_point_id: point.id,
    dp_code: point.code, dp_name: point.name, dp_address: point.address,
    dp_region: point.region, dp_contact: point.contact, dp_memo: point.memo,
    allow_under_1ton: point.allow_under_1ton,
    allow_under_3_5ton: point.allow_under_3_5ton,
    allow_over_5ton: point.allow_over_5ton,
    allow_unmanned_yard: point.allow_unmanned_yard,
    delivery_method: point.delivery_method, base_delivery_method: point.delivery_method,
    access_method: point.access_method, base_access_method: point.access_method,
    delivery_location: point.delivery_location, base_delivery_location: point.delivery_location,
    security_key_location: point.security_key_location, security_password: point.security_password,
    dp_deadline_text: point.deadline_text, dp_deadline_business_min: point.deadline_business_min,
    effective_deadline_text: point.deadline_text,
    effective_deadline_business_min: point.deadline_business_min,
    has_override: false
  };
}
