import { bizMinToStandard } from './time';
import type { ExportStop } from '../lib/course-export';
export interface SortEntry { key: string; dir: 'asc' | 'desc' }
export const HEADERS = [
  '호차','운수사','코스명','톤수','차량번호','운전자명','연락처',
  '입차시간','하차시작','하차종료','납품마감',
  '코드','납품처명',
  '1톤이하','3.5톤이하','5톤이상','무인야적납',
  '대면','검수','무인',
  '보안키','열쇠','없음',
  '창고','탑차','야적',
  '주소','열쇠보관장소','비밀번호','비고'
] as const;

export const SORT_KEYS = [
  { key:'driver_name',   label:'운전자명' },
  { key:'company_name',  label:'운수사' },
  { key:'route_name',    label:'코스명' },
  { key:'car_number',    label:'호차' },
  { key:'plate_number',  label:'차량번호' },
  { key:'tonnage',       label:'톤수' },
  { key:'arrival_min',   label:'입차시간' },
  { key:'unload_start',  label:'하차시작' },
  { key:'unload_end',    label:'하차종료' },
  { key:'deadline',      label:'납품마감' },
  { key:'stop_order',    label:'순서' },
  { key:'point_code',    label:'코드' },
  { key:'point_name',    label:'납품처명' },
  { key:'region',        label:'지역' },
];

export const PRESETS: Record<string, SortEntry[]> = {
  default: [
    { key:'driver_name', dir:'asc' },
    { key:'unload_end',  dir:'asc' }
  ],
  route: [
    { key:'company_name', dir:'asc' },
    { key:'car_number',   dir:'asc' },
    { key:'stop_order',   dir:'asc' }
  ],
  time: [
    { key:'arrival_min', dir:'asc' },
    { key:'driver_name', dir:'asc' }
  ]
};

export const FILTER_KEYS = ['company_name','route_name','car_number','driver_name','region','point_name'];

export type ExportColumn = typeof HEADERS[number];
export type ExportFlat = Record<ExportColumn,string> & { _sort: Record<string,string | number | null | undefined> };
function normalizeDeliveryMethod(value: unknown) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const map: Record<string,string> = {
    face_to_face: '대면',
    inspection:   '검수',
    unmanned:     '무인',
    대면:         '대면',
    검수:         '검수',
    무인:         '무인'
  }; return map[v] || v;
}

function normalizeAccessMethod(value: unknown) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const map: Record<string,string> = {
    security_key: '보안키',
    key:          '열쇠',
    none:         '없음',
    보안키:       '보안키',
    열쇠:         '열쇠',
    없음:         '없음'
  }; return map[v] || v;
}

function normalizeDeliveryLocation(value: unknown) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const map: Record<string,string> = {
    warehouse: '창고',
    truck:     '탑차',
    yard:      '야적',
    창고:      '창고',
    탑차:      '탑차',
    야적:      '야적'
  }; return map[v] || v;
}

// 납품처 사진 컬럼이 없는 이전 DB에서는 압축 사진을 비고에 숨겨 저장했다.
// 내보내기에서는 내부 사진 데이터와 직접 삽입된 이미지 base64를 제거하고
// 사용자가 입력한 비고만 남긴다.
function sanitizeMemoForExport(value: unknown) {
  let memo = String(value ?? '').replace(/<!--dp-photos:[\s\S]*?-->/gi, ' ');
  memo = memo.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi, ' ');
  memo = memo
    .split(/(\s+)/)
    .filter(part => !(part.length >= 512 && /^[a-z0-9+/=]+$/i.test(part)))
    .join('');
  return memo.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function rowToFlat(stop: ExportStop) {
  const route   = stop.route || { name: null, car_number: null };
  const company = route.company || { name: null };
  const driver  = route.primary_driver || { name: null, phone: null, contact: null };
  const vehicle = route.primary_vehicle || { tonnage: null, plate_number: null };
  const dp      = stop.delivery_point || {id:'',name:''};

  const fmtTime = (min: number | null | undefined, text?: string | null) => {
    if (min == null) return text || '';
    return bizMinToStandard(min); // 24시간제 표준만 사용
  };

  const fmtTon = (t: number | string | null | undefined) => {
    if (t == null || t === '') return '';
    const n = Number(t);
    return Number.isFinite(n) ? `${n}톤` : String(t);
  };

  const ck = (b: unknown) => b ? 'O' : '';
  const eq = (val: string, target: string) => val === target ? 'O' : '';

  const deadlineDisplay =
       stop.deadline_text
    || (stop.deadline_business_min != null ? fmtTime(stop.deadline_business_min) : '')
    || dp.deadline_text
    || (dp.deadline_business_min != null ? fmtTime(dp.deadline_business_min) : '');

  const dm = normalizeDeliveryMethod(
    stop.override_delivery_method || dp.delivery_method || ''
  );
  const am = normalizeAccessMethod(
    stop.override_access_method || dp.access_method || ''
  );
  const dl = normalizeDeliveryLocation(
    stop.override_delivery_location || dp.delivery_location || ''
  );

  const flat = {
    '호차':       route.car_number || '',
    '운수사':     company.name || '',
    '코스명':     route.name || '',
    '톤수':       fmtTon(vehicle.tonnage),
    '차량번호':   vehicle.plate_number || '',
    '운전자명':   driver.name || '',
    '연락처':     driver.phone || driver.contact || '',
    '입차시간':   fmtTime(stop.arrival_business_min, stop.arrival_text),
    '하차시작':   fmtTime(stop.unloading_start_business_min, stop.unloading_start_text),
    '하차종료':   fmtTime(stop.unloading_end_business_min, stop.unloading_end_text),
    '납품마감':   deadlineDisplay,
    '코드':       dp.code || '',
    '납품처명':   dp.name || '',
    '1톤이하':    ck(dp.allow_under_1ton),
    '3.5톤이하':  ck(dp.allow_under_3_5ton),
    '5톤이상':    ck(dp.allow_over_5ton),
    '무인야적납': ck(dp.allow_unmanned_yard),
    '대면':       eq(dm, '대면'),
    '검수':       eq(dm, '검수'),
    '무인':       eq(dm, '무인'),
    '보안키':     eq(am, '보안키'),
    '열쇠':       eq(am, '열쇠'),
    '없음':       eq(am, '없음'),
    '창고':       eq(dl, '창고'),
    '탑차':       eq(dl, '탑차'),
    '야적':       eq(dl, '야적'),
    '주소':       dp.address || '',
    '열쇠보관장소': dp.security_key_location || '',
    '비밀번호':   dp.security_password || '',
    '비고':       sanitizeMemoForExport([dp.memo, stop.memo].filter(Boolean).join('\n')),
    _sort: {
      driver_name:  driver.name || '',
      company_name: company.name || '',
      route_name:   route.name || '',
      car_number:   route.car_number || '',
      plate_number: vehicle.plate_number || '',
      tonnage:      Number(vehicle.tonnage) || 0,
      arrival_min:  stop.arrival_business_min,
      unload_start: stop.unloading_start_business_min,
      unload_end:   stop.unloading_end_business_min,
      deadline:     stop.deadline_business_min ?? dp.deadline_business_min,
      stop_order:   stop.stop_order,
      point_code:   dp.code || '',
      point_name:   dp.name || '',
      region:       dp.region || '',
    }
  };
  return flat as ExportFlat;
}

export function compareVals(a: unknown, b: unknown, dir: string) {
  const nullA = a == null || a === '';
  const nullB = b == null || b === '';
  if (nullA && nullB) return 0;
  if (nullA) return 1;
  if (nullB) return -1;
  let cmp;
  if (typeof a === 'number' && typeof b === 'number') cmp = a - b;
  else cmp = String(a).localeCompare(String(b), 'ko', { numeric: true });
  return dir === 'desc' ? -cmp : cmp;
}

