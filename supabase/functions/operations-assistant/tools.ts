export const FILTER_OPERATORS=['eq','contains','lt','lte','gt','gte','between','is_empty'] as const;
export type FilterOperator=typeof FILTER_OPERATORS[number];
export type FieldType='text'|'number'|'time'|'boolean';
export type FieldDefinition={label:string;column:string;type:FieldType;filterOperators:readonly FilterOperator[];aliases:string[];additionalColumns?:string[];matchValue?:string};

const textOps=['eq','contains','is_empty'] as const;
const numberOps=['eq','lt','lte','gt','gte','between','is_empty'] as const;
const boolOps=['eq'] as const;

export const OPERATIONS_QUERY_SCHEMA:Record<string,FieldDefinition>={
  '호차':{label:'호차',column:'car_number',type:'text',filterOperators:textOps,aliases:['호차번호','배차호차']},
  '운수사':{label:'운수사',column:'company_name',type:'text',filterOperators:textOps,aliases:['운송사','회사','소속 운수사']},
  '코스명':{label:'코스명',column:'route_name',type:'text',filterOperators:textOps,aliases:['코스','노선','배송코스']},
  '톤수':{label:'톤수',column:'primary_vehicle_tonnage',type:'number',filterOperators:numberOps,aliases:['차량톤수','몇톤']},
  '차량번호':{label:'차량번호',column:'primary_vehicle_plate',type:'text',filterOperators:textOps,aliases:['번호판','차번']},
  '운전자명':{label:'운전자명',column:'primary_driver_name',additionalColumns:['secondary_driver_name'],type:'text',filterOperators:textOps,aliases:['기사','기사명','운전자','주기사','보조기사']},
  '연락처':{label:'연락처',column:'dp_contact',type:'text',filterOperators:textOps,aliases:['전화번호','휴대전화','납품처 연락처']},
  '순서':{label:'순서',column:'stop_order',type:'number',filterOperators:numberOps,aliases:['배송순서','정차순서']},
  '입차시간':{label:'입차시간',column:'arrival_business_min',type:'time',filterOperators:numberOps,aliases:['입차','도착시간']},
  '하차시작':{label:'하차시작',column:'unloading_start_business_min',type:'time',filterOperators:numberOps,aliases:['하차 시작','하차시작시간']},
  '하차종료':{label:'하차종료',column:'unloading_end_business_min',type:'time',filterOperators:numberOps,aliases:['하차 종료','하차종료시간']},
  '납품마감':{label:'납품마감',column:'effective_deadline_business_min',type:'time',filterOperators:numberOps,aliases:['마감','마감시간','납품시간','22시 이전 마감']},
  '코드':{label:'코드',column:'dp_code',type:'text',filterOperators:textOps,aliases:['납품처코드','거래처코드']},
  '납품처명':{label:'납품처명',column:'dp_name',type:'text',filterOperators:textOps,aliases:['납품처','거래처','거래처명']},
  '지역':{label:'지역',column:'dp_region',type:'text',filterOperators:textOps,aliases:['권역','소재지']},
  '1톤이하':{label:'1톤이하',column:'allow_under_1ton',type:'boolean',filterOperators:boolOps,aliases:['1톤','1t','1톤 진입']},
  '3.5톤이하':{label:'3.5톤이하',column:'allow_under_3_5ton',type:'boolean',filterOperators:boolOps,aliases:['3.5톤','3.5t','3.5톤 진입']},
  '5톤이상':{label:'5톤이상',column:'allow_over_5ton',type:'boolean',filterOperators:boolOps,aliases:['5톤','5t','5톤 진입']},
  '무인야적납':{label:'무인야적납',column:'allow_unmanned_yard',type:'boolean',filterOperators:boolOps,aliases:['야적납','무인야적','야적 진입']},
  '납품방식':{label:'납품방식',column:'delivery_method',type:'text',filterOperators:textOps,aliases:['납품 방법','배송방식','납품방식 공란','납품방식 없음']},
  '대면':{label:'대면',column:'delivery_method',matchValue:'대면',type:'boolean',filterOperators:boolOps,aliases:['대면납품','대면 배송']},
  '검수':{label:'검수',column:'delivery_method',matchValue:'검수',type:'boolean',filterOperators:boolOps,aliases:['검수납품']},
  '무인':{label:'무인',column:'delivery_method',matchValue:'무인',type:'boolean',filterOperators:boolOps,aliases:['무인납품','비대면']},
  '진입방식':{label:'진입방식',column:'access_method',type:'text',filterOperators:textOps,aliases:['진입 방법','출입방식','진입방식 공란','진입방식 없음']},
  '보안키':{label:'보안키',column:'access_method',matchValue:'보안키',type:'boolean',filterOperators:boolOps,aliases:['보안키 진입']},
  '열쇠':{label:'열쇠',column:'access_method',matchValue:'열쇠',type:'boolean',filterOperators:boolOps,aliases:['열쇠 진입']},
  '없음':{label:'없음',column:'access_method',matchValue:'없음',type:'boolean',filterOperators:boolOps,aliases:['진입수단 없음']},
  '납품장소':{label:'납품장소',column:'delivery_location',type:'text',filterOperators:textOps,aliases:['하차장소','배송장소','납품장소 공란','납품장소 없음']},
  '창고':{label:'창고',column:'delivery_location',matchValue:'창고',type:'boolean',filterOperators:boolOps,aliases:['창고납품','창고 하차']},
  '탑차':{label:'탑차',column:'delivery_location',matchValue:'탑차',type:'boolean',filterOperators:boolOps,aliases:['탑차납품','탑차 하차']},
  '야적':{label:'야적',column:'delivery_location',matchValue:'야적',type:'boolean',filterOperators:boolOps,aliases:['야적납품','야적 가능']},
  '주소':{label:'주소',column:'dp_address',type:'text',filterOperators:textOps,aliases:['납품처주소','거래처주소']},
  '담당자':{label:'담당자',column:'dp_contact_name',type:'text',filterOperators:textOps,aliases:['연락담당자','담당자명']},
  '열쇠보관장소':{label:'열쇠보관장소',column:'security_key_location',type:'text',filterOperators:textOps,aliases:['열쇠 위치','키 보관장소','보안키 위치']},
  '비밀번호':{label:'비밀번호',column:'security_password',type:'text',filterOperators:textOps,aliases:['출입 비밀번호','보안 비밀번호','패스워드']},
  '비고':{label:'비고',column:'stop_memo',type:'text',filterOperators:textOps,aliases:['메모','특이사항','주의사항']},
  '코스등록':{label:'코스등록',column:'__route_registered',type:'boolean',filterOperators:boolOps,aliases:['코스 등록 여부','코스에 등록','등록된 납품처','미등록 납품처','코스에 등록되지 않은']},
};

export type Condition={field:string;operator:FilterOperator;value?:unknown};
export type SortRule={field:string;direction:'asc'|'desc'};
export type QueryPlan={conditions:Condition[];select:string[];sort:SortRule[];limit:number};

export function validateQueryPlan(value:unknown):QueryPlan{
  if(!value||typeof value!=='object')throw new Error('질문 조건을 구조화하지 못했습니다.');
  const raw=value as Record<string,unknown>,conditionsRaw=Array.isArray(raw.conditions)?raw.conditions:[],selectRaw=Array.isArray(raw.select)?raw.select:[],sortRaw=Array.isArray(raw.sort)?raw.sort:[];
  const conditions=conditionsRaw.map((item):Condition=>{
    if(!item||typeof item!=='object')throw new Error('필터 조건 형식이 올바르지 않습니다.');const c=item as Record<string,unknown>,field=String(c.field||''),operator=String(c.operator||'') as FilterOperator,def=OPERATIONS_QUERY_SCHEMA[field];
    if(!def)throw new Error(`확인할 수 없는 컬럼: ${field||'(없음)'}`);if(!def.filterOperators.includes(operator))throw new Error(`${field}에는 ${operator} 조건을 사용할 수 없습니다.`);
    const value=normalizeConditionValue(def,operator,c.value);return value===undefined?{field,operator}:{field,operator,value};
  });
  const select=[...new Set(selectRaw.map(String))];if(!select.length)throw new Error('표시할 컬럼을 확인하지 못했습니다.');for(const field of select)if(!OPERATIONS_QUERY_SCHEMA[field])throw new Error(`표시할 수 없는 컬럼: ${field}`);
  const sort=sortRaw.map((item):SortRule=>{if(!item||typeof item!=='object')throw new Error('정렬 형식이 올바르지 않습니다.');const s=item as Record<string,unknown>,field=String(s.field||''),direction=s.direction==='desc'?'desc':'asc';if(!OPERATIONS_QUERY_SCHEMA[field])throw new Error(`정렬할 수 없는 컬럼: ${field}`);return{field,direction}});
  const requestedLimit=Number(raw.limit);
  return{conditions,select,sort,limit:Number.isFinite(requestedLimit)&&requestedLimit>0?Math.floor(requestedLimit):Number.MAX_SAFE_INTEGER};
}

function normalizeConditionValue(def:FieldDefinition,operator:FilterOperator,value:unknown){
  if(operator==='is_empty')return undefined;
  if(operator==='between'){if(!Array.isArray(value)||value.length!==2)throw new Error(`${def.label} between 값은 2개여야 합니다.`);return value.map(v=>normalizeScalar(def,v));}
  return normalizeScalar(def,value);
}
function normalizeScalar(def:FieldDefinition,value:unknown){
  if(def.type==='boolean'){if(value===true||value==='true'||value==='O'||value==='가능')return true;if(value===false||value==='false'||value==='X'||value==='불가')return false;throw new Error(`${def.label} 값은 true/false여야 합니다.`)}
  if(def.type==='time'){const minutes=timeToMinutes(value);if(minutes==null)throw new Error(`${def.label} 시간값을 확인할 수 없습니다: ${String(value)}`);return minutes}
  if(def.type==='number'){const number=Number(value);if(!Number.isFinite(number))throw new Error(`${def.label} 숫자값을 확인할 수 없습니다: ${String(value)}`);return number}
  const text=String(value??'').trim();if(!text)throw new Error(`${def.label} 검색값이 비어 있습니다.`);return text.slice(0,200);
}
export function timeToMinutes(value:unknown){if(typeof value==='number'&&Number.isFinite(value))return value;const m=String(value??'').trim().match(/^(\d{1,2})(?::|시\s*)(\d{1,2})?\s*분?$/);if(!m)return null;const h=Number(m[1]),min=Number(m[2]||0);return h>=0&&h<24&&min>=0&&min<60?h*60+min:null}
export function minutesToTime(value:unknown){const n=Number(value);if(!Number.isFinite(n)||n<0||n>=1440)return'';return`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`}
export function readFieldValue(row:Record<string,unknown>,def:FieldDefinition){if(def.matchValue)return String(row?.[def.column]??'')===def.matchValue;if(def.additionalColumns?.length)return[def.column,...def.additionalColumns].map(column=>row?.[column]).filter(Boolean).join(', ');return row?.[def.column]}
export function matchesCondition(row:Record<string,unknown>,condition:Condition){const def=OPERATIONS_QUERY_SCHEMA[condition.field],actual=readFieldValue(row,def),expected=condition.value;if(condition.operator==='is_empty')return actual==null||String(actual).trim()==='';if(condition.operator==='between'){const [low,high]=expected as unknown[];return Number(actual)>=Number(low)&&Number(actual)<=Number(high)}if(condition.operator==='contains')return String(actual??'').toLocaleLowerCase('ko').includes(String(expected??'').toLocaleLowerCase('ko'));if(condition.operator==='eq')return def.type==='text'?String(actual??'').toLocaleLowerCase('ko')===String(expected??'').toLocaleLowerCase('ko'):actual===expected;const a=Number(actual),b=Number(expected);if(!Number.isFinite(a)||!Number.isFinite(b))return false;return condition.operator==='lt'?a<b:condition.operator==='lte'?a<=b:condition.operator==='gt'?a>b:a>=b}
export function displayFieldValue(row:Record<string,unknown>,def:FieldDefinition){const value=readFieldValue(row,def);if(def.type==='time')return minutesToTime(value);if(def.type==='boolean')return value?'O':'X';return value??''}
export function normalizeCenter(value:unknown){const v=String(value||'').trim().toLowerCase();if(['001','ansan','사조안산센터','안산'].includes(v))return'001';if(['002','pyeongtaek','사조평택센터','평택'].includes(v))return'002';return''}
