import { displayToBizMin } from './time';
import type { DeliveryPoint } from '../lib/delivery-points';
export type CsvRow = Record<string,string>;
export interface ImportCompany {name:string}
export interface ImportDriver {name:string;phone:string|null;contact:string|null;company_name:string}
export interface ImportVehicle {key:string;plate_number:string;tonnage:number|null;company_name:string}
export type ImportPoint = Omit<DeliveryPoint,'id'> & {code:string};
export interface ImportRoute {key:string;name:string;car_number:string;company_name:string;driver_name:string|null;vehicle_no:string|null;vehicle_key:string|null}
export interface ImportStop {route_key:string;point_code:string;stop_order:number;arrival_text:string|null;arrival_business_min:number|null;unloading_start_text:string|null;unloading_start_business_min:number|null;unloading_end_text:string|null;unloading_end_business_min:number|null;deadline_text:string|null;deadline_business_min:number|null;memo:string|null}
export type NormalizedImport = ReturnType<typeof normalizeImport>;
export const FIELDS: [string,string,string[]][] = [
    ['company',     '운수사',        ['운수사','회사','업체','company']],
    ['car_number',  '호차',          ['호차','car','carno','carnumber']],
    ['route_name',  '코스명',        ['코스명','코스','노선','route','routename']],
    ['tonnage',     '톤수',          ['톤수','ton','tonnage']],
    ['vehicle_no',  '차량번호',      ['차량번호','차량','plate','vehicleno','vehicle','platenumber']],
    ['driver_name', '운전자명',      ['운전자명','운전자','기사','기사명','driver','drivername']],
    ['driver_phone','연락처',        ['연락처','전화','phone','contact']],
    ['entry_time',  '입차시간',      ['입차시간','입차','arrival','entrytime']],
    ['unload_start','하차시작',      ['하차시작','하차시작시간','unloadstart']],
    ['unload_end',  '하차종료',      ['하차종료','하차종료시간','unloadend']],
    ['deadline',    '납품마감',      ['납품마감','마감','deadline']],
    ['point_code',  '납품처코드',    ['코드','납품처코드','code','pointcode']],
    ['point_name',  '납품처명',      ['납품처명','납품처','거래처','pointname']],
    ['cond_1t',     '1톤이하',       ['1톤이하','1톤','1t']],
    ['cond_3_5t',   '3.5톤이하',     ['3.5톤이하','3.5톤','3.5t']],
    ['cond_5t',     '5톤이상',       ['5톤이상','5톤','5t']],
    ['cond_yard',   '무인야적납',    ['무인야적납','야적납','yard']],
    ['dm_face',     '대면',          ['대면']],
    ['dm_inspect',  '검수',          ['검수']],
    ['dm_unmanned', '무인',          ['무인']],
    ['am_seckey',   '보안키',        ['보안키']],
    ['am_key',      '열쇠',          ['열쇠']],
    ['am_none',     '없음',          ['없음']],
    ['dl_warehouse','창고',          ['창고']],
    ['dl_box',      '탑차',          ['탑차']],
    ['dl_yard',     '야적',          ['야적']],
    ['address',     '주소',          ['주소','address','실제납품지']],
    ['security_key_location', '열쇠보관장소', ['열쇠보관장소','열쇠보관','키보관장소','키보관','keylocation','securitykeylocation']],
    ['security_password',     '비밀번호',     ['비밀번호','패스워드','보안비밀번호','출입비밀번호','password','securitypassword']],
    ['notes',       '비고',          ['비고','메모','note','notes','memo']],
  ];

  function isCheck(v: unknown) {
    if (!v) return false;
    const s = String(v).trim().toUpperCase();
    return s === 'O' || s === '1' || s === 'TRUE' || s === 'Y' || s === '✓';
  }
  function parseTimeToBizMin(raw: string | null) {
    if (!raw) return null;
    let s = String(raw).trim();
    if (!s || /^(x|미운행|없음)$/i.test(s)) return null;
    const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m) s = `${m[1].padStart(2,'0')}:${m[2]}`;
    const m2 = s.match(/^(\d{1,2}):(\d{2})/);
    if (!m2) return null;
    try { return displayToBizMin(`${m2[1].padStart(2,'0')}:${m2[2]}`); } catch { return null; }
  }
  function parseTonnageNumeric(raw: string | null) {
    if (!raw) return null;
    const m = String(raw).match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }
  function extractRegion(addr: string | null) {
    if (!addr) return null;
    const m = String(addr).match(/(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충[북남]|전[북남]|경[북남]|제주)[^\s]*\s*([가-힣]+(시|군|구))?/);
    if (!m) return null;
    return [m[1], m[2]].filter(Boolean).join(' ').trim();
  }

export function autoMap(headers:string[]){
 const mapping:Record<string,string>={};
 const normalizeName=(value:string)=>String(value||'').toLowerCase().replace(/[\s_\-()]/g,'');
 for(const [key,,aliases] of FIELDS){const found=headers.find(header=>aliases.some(alias=>normalizeName(alias)===normalizeName(header)));if(found)mapping[key]=found;}
 return mapping;
}
  export function normalizeImport(rows: CsvRow[], mapping: Record<string,string>) {
    const state={mapping};
  function pick(row: CsvRow, key: string) {
    const col = state.mapping[key];
    if (!col) return null;
    const v = row[col];
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === '' || s.toLowerCase() === 'nan' ? null : s;
  }
    const warnings: string[] = [];
    const companies = new Map<string,ImportCompany>();
    const drivers   = new Map<string,ImportDriver>();
    const vehicles  = new Map<string,ImportVehicle>();
    const points    = new Map<string,ImportPoint>();
    const routes    = new Map<string,ImportRoute>();
    const stops: ImportStop[] = [];
    const orderMap  = new Map<string,number>();

    rows.forEach((r, idx) => {
      const lineNo = idx + 2;
      const company    = pick(r,'company');
      const carNumber  = pick(r,'car_number');
      const routeName  = pick(r,'route_name');
      const tonnage    = pick(r,'tonnage');
      const vehicleNo  = pick(r,'vehicle_no');
      const driverName = pick(r,'driver_name');
      const driverPhone= pick(r,'driver_phone');
      const pointCode  = pick(r,'point_code');
      const pointName  = pick(r,'point_name');
      const address    = pick(r,'address');

      // 납품처
      if (pointCode && pointName && !points.has(pointCode)) {
        points.set(pointCode, {
          code: pointCode,
          name: pointName,
          address,
          region: extractRegion(address),
          allow_under_1ton:    isCheck(pick(r,'cond_1t')),
          allow_under_3_5ton:  isCheck(pick(r,'cond_3_5t')),
          allow_over_5ton:     isCheck(pick(r,'cond_5t')),
          allow_unmanned_yard: isCheck(pick(r,'cond_yard')),
          delivery_method:
            isCheck(pick(r,'dm_face'))     ? '대면' :
            isCheck(pick(r,'dm_inspect'))  ? '검수' :
            isCheck(pick(r,'dm_unmanned')) ? '무인' : null,
          access_method:
            isCheck(pick(r,'am_seckey')) ? '보안키' :
            isCheck(pick(r,'am_key'))    ? '열쇠' :
            isCheck(pick(r,'am_none'))   ? '없음' : null,
          delivery_location:
            isCheck(pick(r,'dl_warehouse')) ? '창고' :
            isCheck(pick(r,'dl_box'))       ? '탑차' :
            isCheck(pick(r,'dl_yard'))      ? '야적' : null,
          security_key_location: pick(r,'security_key_location'),
          security_password:     pick(r,'security_password'),
          deadline_business_min: parseTimeToBizMin(pick(r,'deadline')),
          deadline_text:         pick(r,'deadline'),
        });
      }

      if (!company || !carNumber || !routeName) {
        if (!pointCode) warnings.push(`행 ${lineNo}: 운수사/호차/코스명 누락으로 스킵`);
        return;
      }

      if (!companies.has(company)) companies.set(company, { name: company });

      if (vehicleNo) {
        const vehicleKey = `${vehicleNo}|${company}`;
        if (!vehicles.has(vehicleKey)) {
          vehicles.set(vehicleKey, {
            key: vehicleKey,
            plate_number: vehicleNo,
            tonnage: parseTonnageNumeric(tonnage),
            company_name: company,
          });
        }
      }

      if (driverName) {
        const dKey = `${driverName}|${company}`;
        if (!drivers.has(dKey)) {
          drivers.set(dKey, {
            name: driverName,
            phone: driverPhone,
            contact: driverPhone, // 두 컬럼 모두 채움
            company_name: company,
          });
        }
      }

      const routeKey = `${company}|${carNumber}|${routeName}`;
      if (!routes.has(routeKey)) {
        routes.set(routeKey, {
        key: routeKey,
        name: routeName,
        car_number: carNumber,
        company_name: company,
        driver_name: driverName,
        vehicle_no: vehicleNo,
        vehicle_key: vehicleNo ? `${vehicleNo}|${company}` : null,
      });
        orderMap.set(routeKey, 0);
      }

      if (pointCode) {
        const order = (orderMap.get(routeKey) || 0) + 1;
        orderMap.set(routeKey, order);
        const arrMin = parseTimeToBizMin(pick(r,'entry_time'));
        const usMin  = parseTimeToBizMin(pick(r,'unload_start'));
        const ueMin  = parseTimeToBizMin(pick(r,'unload_end'));
        const dlMin  = parseTimeToBizMin(pick(r,'deadline'));
        if (arrMin == null && usMin == null && ueMin == null) {
          warnings.push(`행 ${lineNo}: ${pointName} 시간 정보 모두 비어있음`);
        }
        stops.push({
          route_key: routeKey,
          point_code: pointCode,
          stop_order: order,
          arrival_text:                pick(r,'entry_time'),
          arrival_business_min:        arrMin,
          unloading_start_text:        pick(r,'unload_start'),
          unloading_start_business_min:usMin,
          unloading_end_text:          pick(r,'unload_end'),
          unloading_end_business_min:  ueMin,
          deadline_text:               pick(r,'deadline'),
          deadline_business_min:       dlMin,
          memo:                        pick(r,'notes'),
        });
      } else {
        warnings.push(`행 ${lineNo}: 납품처 코드 없음`);
      }
    });

    return {
      companies: [...companies.values()],
      drivers:   [...drivers.values()],
      vehicles:  [...vehicles.values()],
      points:    [...points.values()],
      routes:    [...routes.values()],
      stops, warnings,
    };
  }

