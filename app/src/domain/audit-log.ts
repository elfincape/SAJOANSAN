    export const TABLE_LABEL: Record<string, string> = {
      routes:          '코스',
      route_stops:     '납품처',
      delivery_points: '납품처',
      drivers:         '기사',
      vehicles:        '차량',
      companies:       '운수사'
    };
    export const ACTION_LABEL: Record<string, string> = { INSERT: '생성', UPDATE: '수정', DELETE: '삭제' };

    // 컬럼명 → 한글 라벨
    export const FIELD_LABEL: Record<string, string> = {
      // 공통
      id: 'ID', name: '이름', memo: '비고',
      created_at: '생성시각', updated_at: '수정시각',

      // companies
      // (특별한 추가 컬럼 없음)

      // drivers
      phone: '연락처', company_id: '운수사',

      // vehicles
      plate_number: '차량번호', tonnage: '톤수', pallet_capacity: '팔레트적재량',

      // delivery_points
      code: '코드', address: '주소', region: '지역', contact: '연락처',
      contact_name: '담당자명', contact_office: '담당자 사무실', contact_mobile: '담당자 휴대폰',
      rep_name: '대표자명', rep_phone: '대표번호',
      allow_under_1ton: '1톤 이하 진입',
      allow_under_3_5ton: '3.5톤 이하 진입',
      allow_over_5ton: '5톤 이상 진입',
      allow_unmanned_yard: '무인 야적 가능',
      delivery_method: '납품방식', access_method: '진입방식', delivery_location: '납품장소',
      deadline_text: '마감(표시)', deadline_business_min: '마감(분)',

      // routes
      car_number: '호차', active: '활성',
      primary_driver_id: '주기사', primary_vehicle_id: '주차량',
      secondary_driver_id: '보조기사', secondary_vehicle_id: '보조차량',

      // route_stops
      route_id: '코스', delivery_point_id: '납품처', stop_order: '순서',
      arrival_text: '입차(표시)', arrival_business_min: '입차(분)',
      unloading_start_text: '하차시작(표시)', unloading_start_business_min: '하차시작(분)',
      unloading_end_text: '하차종료(표시)',  unloading_end_business_min: '하차종료(분)',
      override_delivery_method:   '납품방식 오버라이드',
      override_access_method:     '진입방식 오버라이드',
      override_delivery_location: '납품장소 오버라이드'
    };

    // 항상 표시 안 할 잡음 컬럼 (수정시각은 자동 갱신이라 의미 적음)
    export const NOISE_FIELDS = new Set(['updated_at']);

export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return String(a) === String(b);
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
export function changedFields(oldData: Record<string, unknown>, newData: Record<string, unknown>) {
  const keys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);
  return [...keys].filter(key => !NOISE_FIELDS.has(key) && !isEqual(oldData?.[key], newData?.[key])).sort((a, b) => (FIELD_LABEL[a] ? 0 : 1) - (FIELD_LABEL[b] ? 0 : 1) || a.localeCompare(b));
}
export function identityOf(table: string, row: Record<string, unknown>) {
  const fields: Record<string, string[]> = { companies: ['name'], drivers: ['name', 'phone'], vehicles: ['plate_number'], delivery_points: ['code', 'name'], routes: ['name', 'car_number'], route_stops: ['stop_order'] };
  const parts = (fields[table] || ['name', 'id']).map(key => row[key]).filter(value => value != null && value !== '');
  return parts.length ? parts.join(' · ') : String(row.id || '');
}
export function formatTs(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR', { hour12: false });
}
export const shortId = (id?: string | null) => !id ? '' : id.length > 13 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
export function safeStringify(value: unknown) { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }

