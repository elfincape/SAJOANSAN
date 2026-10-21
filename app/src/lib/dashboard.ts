import { supabase } from './supabase';
import { fetchAllRows } from './pagination';
import { loadUnassignedDeliveryPoints } from './course-export';
import type { Center } from './center';
import type { DashboardRow } from '../domain/dashboard';
import type { DeliveryPoint } from './delivery-points';
function filterRowsByCenter(rows: DashboardRow[], center: Center) {
  return rows.filter((row) => {
    const codes = [
      row.center_code,
      row.route_center_code,
      row.company_center_code,
      row.dp_center_code,
    ]
      .filter(Boolean)
      .map((v) => String(v).trim());
    if (codes.length) return codes.includes(center.code);
    const names = [
      row.center,
      row.center_name,
      row.route_center_name,
      row.center_slug,
    ]
      .filter(Boolean)
      .map((v) => String(v).trim().toLowerCase());
    return names.some((v) =>
      [center.name, center.shortName, center.slug]
        .map((v) => v.toLowerCase())
        .includes(v),
    );
  });
}
async function enrichDeliveryPointMemos(rows: DashboardRow[], center: Center) {
  if (!rows.length || rows.every((row) => Object.hasOwn(row, 'dp_memo')))
    return rows;

  const { data, error } = await supabase
    .from('delivery_points')
    .select('id,memo')
    .eq('center_code', center.code);
  if (error) {
    console.warn(
      '[dashboard] 납품처 비고를 별도로 불러오지 못했습니다:',
      error,
    );
    return rows;
  }

  const memoById = new Map(
    (data || []).map((point) => [String(point.id), point.memo]),
  );
  return rows.map((row) => ({
    ...row,
    dp_memo: row.dp_memo ?? memoById.get(String(row.delivery_point_id)) ?? null,
  }));
}

async function loadCourseRowsForCenter(
  center: Center,
): Promise<DashboardRow[]> {
  // 1차: course_view 자체가 center_code를 제공하는 경우 서버에서 바로 센터 필터링
  const scoped: { data?: DashboardRow[]; error?: unknown } =
    await fetchAllRows<DashboardRow>(() =>
      supabase
        .from('course_view')
        .select('*')
        .eq('center_code', center.code)
        .order('stop_id')
        .returns<DashboardRow[]>(),
    ).then(
      (data) => ({ data }),
      (error) => ({ error }),
    );

  if (!scoped.error) return scoped.data || [];

  console.warn(
    '[dashboard] course_view.center_code 조회 실패, 관계 테이블 기준으로 센터 범위를 보정합니다:',
    scoped.error,
  );

  // 2차: course_view에 센터 컬럼명이 다르거나 없는 경우 전체 조회 후 보정
  const retry = await supabase
    .from('course_view')
    .select('*')
    .returns<DashboardRow[]>();
  if (retry.error) throw retry.error;

  const rows = retry.data || [];
  const markerFiltered = filterRowsByCenter(rows, center);
  if (
    markerFiltered.length ||
    rows.some(
      (row) =>
        row?.center_code ||
        row?.route_center_code ||
        row?.center ||
        row?.center_name ||
        row?.center_slug,
    )
  ) {
    return markerFiltered;
  }

  // 3차: course_view에 센터 컬럼이 아예 없으면 routes에서 선택 센터의 route_id를 구해 강제 분리
  const routeIds = await loadRouteIdsForCenter(center);
  if (!routeIds.size) return [];

  return rows.filter((row) => routeIds.has(row.route_id || row.route?.id));
}

async function loadRouteIdsForCenter(center: Center) {
  const attempts = [
    { column: 'center_code', value: center.code },
    { column: 'center', value: center.name },
    { column: 'center_name', value: center.name },
    { column: 'center_slug', value: center.slug },
  ];

  const centerIds = await loadPossibleCenterIds(center);
  centerIds.forEach((id) => attempts.push({ column: 'center_id', value: id }));

  let lastError = null;
  for (const attempt of attempts) {
    const { data, error } = await supabase
      .from('routes')
      .select('id')
      .eq(attempt.column, attempt.value);

    if (!error)
      return new Set((data || []).map((row) => row.id).filter(Boolean));
    lastError = error;
  }

  console.error(
    '[dashboard] routes에서 선택 센터의 코스 범위를 확인하지 못했습니다:',
    lastError,
  );
  throw lastError || new Error('센터별 코스 범위를 확인하지 못했습니다.');
}

async function loadPossibleCenterIds(center: Center) {
  const ids = new Set<string>();
  const attempts = [
    { column: 'code', value: center.code },
    { column: 'center_code', value: center.code },
    { column: 'slug', value: center.slug },
    { column: 'name', value: center.name },
  ];

  for (const attempt of attempts) {
    const { data, error } = await supabase
      .from('centers')
      .select('id')
      .eq(attempt.column, attempt.value)
      .limit(1);

    if (!error) (data || []).forEach((row) => row?.id && ids.add(row.id));
  }

  // center_id를 코드값으로 직접 쓰는 설계도 지원한다. 화면에는 노출하지 않는다.
  ids.add(center.code);
  return [...ids];
}

export function unassignedDashboardRow(
  point: DeliveryPoint & { center_code?: string },
): DashboardRow {
  return {
    stop_id: `unassigned:${point.id}`,
    route_id: null,
    route_name: '코스 미지정',
    stop_order: null,
    center_code: point.center_code,
    delivery_point_id: point.id,
    dp_code: point.code,
    dp_name: point.name,
    dp_address: point.address,
    dp_region: point.region,
    dp_contact: point.contact,
    dp_memo: point.memo,
    allow_under_1ton: point.allow_under_1ton,
    allow_under_3_5ton: point.allow_under_3_5ton,
    allow_over_5ton: point.allow_over_5ton,
    allow_unmanned_yard: point.allow_unmanned_yard,
    delivery_method: point.delivery_method,
    base_delivery_method: point.delivery_method,
    access_method: point.access_method,
    base_access_method: point.access_method,
    delivery_location: point.delivery_location,
    base_delivery_location: point.delivery_location,
    security_key_location: point.security_key_location,
    security_password: point.security_password,
    dp_deadline_text: point.deadline_text,
    dp_deadline_business_min: point.deadline_business_min,
    effective_deadline_text: point.deadline_text,
    effective_deadline_business_min: point.deadline_business_min,
    has_override: false,
  };
}

export async function loadDashboard(center: Center) {
  const data = await loadCourseRowsForCenter(center),
    unassigned = await loadUnassignedDeliveryPoints(center.code),
    courseRows = await enrichDeliveryPointMemos(data, center),
    represented = new Set(
      courseRows.map((row) => String(row.delivery_point_id)),
    );
  return [
    ...courseRows,
    ...unassigned
      .filter((point) => !represented.has(String(point.id)))
      .map(unassignedDashboardRow),
  ];
}
export function dashboardHealth(center: Center) {
  return fetchAllRows(() =>
    supabase
      .from('drivers')
      .select('id,health_certificate_expires_on')
      .eq('center_code', center.code)
      .order('id')
      .returns<
        { id: string; health_certificate_expires_on: string | null }[]
      >(),
  );
}
export function dashboardDetail(center: Center, id: string) {
  return supabase
    .from('delivery_points')
    .select(
      'code,name,address,region,contact,delivery_method,access_method,delivery_location,security_key_location,security_password,photos,memo',
    )
    .eq('id', id)
    .eq('center_code', center.code)
    .single<DeliveryPoint>();
}
export function saveDashboardDetail(
  center: Center,
  id: string,
  payload: Record<string, unknown>,
) {
  return supabase
    .from('delivery_points')
    .update(payload)
    .eq('id', id)
    .eq('center_code', center.code);
}
