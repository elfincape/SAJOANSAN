export const SOURCE = '73aa532a-bc84-4338-8001-897b4e77a1d9';
export const CENTERS = {'001':'안산','002':'평택'};
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FIELDS = {
  name:['납품처명','title'], code:['코드','rich_text'], address:['주소','rich_text'], region:['지역','rich_text'],
  deadline_text:['납품마감','rich_text'], delivery_method:['납품방식','select'],
  delivery_location:['납품장소','select'], access_method:['진입방식','select'],
  security_key_location:['열쇠보관장소','rich_text'], security_password:['비밀번호','rich_text'],
  contact:['담당자 휴대폰','phone_number'], memo:['비고','rich_text'],
  contact_name:['담당자명','rich_text'],contact_office:['담당자 사무실','phone_number'],
  rep_name:['대표자명','rich_text'],rep_phone:['대표번호','phone_number'],
  allow_under_1ton:['1톤 이하 진입','checkbox'], allow_under_3_5ton:['3.5톤 이하 진입','checkbox'],
  allow_over_5ton:['5톤 이상 진입','checkbox'], allow_unmanned_yard:['무인 야적 가능','checkbox']
};
export const fail=(message,status=400,code='invalid_request')=>Object.assign(new Error(message),{status,code});
export const plain=p=>(p?.title || p?.rich_text || []).map(t=>t.plain_text ?? t.text?.content ?? '').join('');
export function normalize(key,value) {
  if(FIELDS[key][1]==='checkbox')return !!value;
  const s=String(value ?? '').trim();
  if(key==='deadline_text' && s) {
    const m=/^(\d{1,2})\s*[:.시]\s*(\d{1,2})\s*분?$/.exec(s);
    if(!m || +m[1]>23 || +m[2]>59)throw fail('납품마감은 00:00~23:59 형식으로 입력해 주세요.',422,'invalid_deadline');
    return m[1].padStart(2,'0')+':'+m[2].padStart(2,'0');
  }
  return s;
}
export function webValues(row) {
  return Object.fromEntries(Object.keys(FIELDS).map(k=>{
    let value=k==='contact'?row.contact_mobile||row.contact:row[k];
    if(k==='deadline_text'&&!value&&row.deadline_business_min!=null) {
      const n=Number(row.deadline_business_min);
      if(!Number.isInteger(n)||n<0||n>=1440)throw fail('납품마감 시간을 확인해 주세요.',422,'invalid_deadline');
      value=String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
    }
    return [k,normalize(k,value)];
  }));
}
export function notionValues(page) {
  return Object.fromEntries(Object.entries(FIELDS).map(([k,[name,type]])=>{
    const p=page.properties?.[name];
    return [k,normalize(k,type==='checkbox'?p?.checkbox:type==='select'?p?.select?.name:type==='phone_number'?p?.phone_number:plain(p))];
  }));
}
// Without a shared baseline only equal values are safe to adopt.
export function merge(base,web,notion) {
  const values={},conflicts=[];
  for(const k of Object.keys(FIELDS)) {
    if(web[k]===notion[k])values[k]=web[k];
    else if(base && web[k]===base[k])values[k]=notion[k];
    else if(base && notion[k]===base[k])values[k]=web[k];
    else conflicts.push(k);
  }
  return {values,conflicts};
}
export function rich(value) {
  const s=String(value ?? '');
  if(s.length>20000)throw fail('텍스트는 20,000자 이내로 입력해 주세요.',422,'text_too_long');
  return Array.from({length:Math.ceil(s.length/2000)},(_,i)=>({type:'text',text:{content:s.slice(i*2000,(i+1)*2000)}}));
}
export function properties(values) {
  const p={};
  for(const [k,[name,type]] of Object.entries(FIELDS)) {
    const value=values[k];
    p[name]=type==='title'||type==='rich_text'?{[type]:rich(value)}:
      type==='select'?{select:value?{name:value}:null}:type==='checkbox'?{checkbox:!!value}:{phone_number:value||null};
  }
  return p;
}
export function webPatch(values) {
  if(!values.name)throw fail('납품처명을 입력해 주세요.',422,'missing_name');
  const result=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,typeof v==='string'?v||null:v]));
  result.contact_mobile=result.contact;
  if(values.deadline_text) {
    const [h,m]=values.deadline_text.split(':').map(Number);result.deadline_business_min=h*60+m;
  }else result.deadline_business_min=null;
  return result;
}
