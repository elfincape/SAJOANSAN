import { CHARTER_RATES } from './pyeongtaek-charter-rates.js';
import { charterRegion } from './pyeongtaek-charter-rates.js';
export const SCHEMA_VERSION = 2;
export const FIELDS = [
 ['B','date','일자','date','trip'],['C','type','형태','text','trip'],['D','course','코스','text','trip'],
 ['E','vehicleSequence','호차','text','trip'],['F','code','납품처코드','text','delivery'],
 ['G','name','납품처명','text','delivery'],['H','address','주소','text','delivery'],
 ['I','customer','고객사','text','delivery'],['J','quantity','총 수량','number','delivery'],
 ['K','frozen','냉동','number','delivery'],['L','chilled','냉장','number','delivery'],
 ['M','providedStopCount','착수','number','trip'],['N','courseQuantity','총 배송량','number','trip'],
 ['O','arrivalTime','입차시간','time','trip'],['P','departureTime','출차시간(비고)','time','trip'],
 ['Q','tons','톤수','number','trip'],['R','driver','기사명','text','trip'],
 ['S','vehicleNumber','차량번호','text','trip'],['T','phone','연락처','text','trip'],
 ['U','region','권역(구간)','text','delivery']
];
const ERROR = /^#(?:N\/?A|VALUE!?|REF!?|DIV\/0!?|NAME\?|NUM!?|NULL!?|SPILL!?|CALC!?|GETTING_DATA|FIELD!?|BLOCKED!?|UNKNOWN!?|CONNECT!?|BUSY!?|PYTHON!?)$/i;
const empty = value => value == null || String(value).trim() === '';
const numeric = value => typeof value === 'number' ? value : Number(String(value).replace(/,/g,'').trim());
export const clone = value => JSON.parse(JSON.stringify(value));
export function validDate(value) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return false;
 const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
export function normalizeValue(value, kind, {XLSX,year,date1904=false}={}) {
 if(empty(value)||ERROR.test(String(value).trim()))return null;
 if(kind==='number'){const n=numeric(value);return Number.isFinite(n)&&n>=0?n:null;}
 if(kind==='date'){
  if(typeof value==='number'&&XLSX){const d=XLSX.SSF.parse_date_code(value,{date1904});if(d){const s=[d.y,String(d.m).padStart(2,'0'),String(d.d).padStart(2,'0')].join('-');return validDate(s)?s:null;}}
  const raw=String(value).trim(), full=raw.match(/^(\d{4})[년./-]\s*(\d{1,2})[월./-]\s*(\d{1,2})(?:일)?(?:\s.*)?$/);
  const short=raw.match(/^(\d{1,2})[월./-]\s*(\d{1,2})(?:일)?$/);
  const parts=full?full.slice(1):short&&year?[String(year),...short.slice(1)]:null;
  if(!parts)return null;const s=parts.map((v,i)=>i?String(Number(v)).padStart(2,'0'):v).join('-');return validDate(s)?s:null;
 }
 if(kind==='time'){
  if(typeof value==='number'){const seconds=Math.round((value%1)*86400)%86400;return [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(v=>String(v).padStart(2,'0')).join(':');}
  // Preserve notes written in the departure-time column.
  return String(value).trim();
 }
 return String(value).trim();
}
export function parseNormalizedSheet(sheet,XLSX,{centerCode='002',sourceName='',sheetName='',year=new Date().getFullYear(),date1904=false}={}) {
 if(!sheet?.['!ref'])throw new Error('선택한 시트가 비어 있습니다.');
 const range=XLSX.utils.decode_range(sheet['!ref']);
 if(range.e.r>100002)throw new Error('데이터 100,000행까지 지원합니다.');
 const merges=new Map(),cache=new Map();
 for(const m of sheet['!merges']||[]){
  if(m.s.r<3)continue;
  for(let c=Math.max(1,m.s.c);c<=Math.min(20,m.e.c);c++)for(let r=m.s.r;r<=Math.min(range.e.r,m.e.r);r++){
   const key=XLSX.utils.encode_cell({r,c});if(merges.has(key))throw new Error(key+' 병합 영역이 겹칩니다.');merges.set(key,m);
  }
 }
 function read(r,col,kind){
  const c=XLSX.utils.decode_col(col),m=merges.get(XLSX.utils.encode_cell({r,c}));
  const key=XLSX.utils.encode_cell({r:m?.s.r??r,c:m?.s.c??c}),cacheKey=key+':'+kind;
  if(cache.has(cacheKey))return cache.get(cacheKey);
  const cell=sheet[key],raw=cell?.v;
  const failed=cell?.t==='e'||ERROR.test(String(raw??'').trim())||(cell?.f&&raw==null);
  const value=failed?null:normalizeValue(kind==='text'&&cell?.t==='n'&&cell?.z?XLSX.format_cell(cell):raw,kind,{XLSX,year,date1904});
  const result={key,value,raw:empty(raw)?null:String(raw),error:failed?(cell?.w||String(raw??'수식 결과 없음')):!empty(raw)&&value===null?'값 형식 확인':null};
  cache.set(cacheKey,result);return result;
 }
 const trips=[],counters=new Map();let previous=null,previousAnchor='';
 for(let r=3;r<=range.e.r;r++){
  const row=Object.fromEntries(FIELDS.map(([col,key,,kind])=>[key,read(r,col,kind)]));
  if(FIELDS.filter(([,,, ,scope])=>scope==='delivery').every(([,key])=>empty(row[key].value)&&!row[key].error)&&['type','course','vehicleSequence','vehicleNumber','tons','driver','courseQuantity'].every(key=>empty(row[key].value)&&!row[key].error))continue;
  const anchor=row.date.key;
  const split=!previous||anchor!==previousAnchor||['course','vehicleSequence','vehicleNumber'].some(key=>!empty(row[key].value)&&!empty(previous[key])&&row[key].value!==previous[key]);
  if(split){
   previous={id:'',centerCode,sourceName,sheetName,sourceRow:r+1,sourceCells:{},issues:[],deliveries:[],createdAt:new Date().toISOString()};
   trips.push(previous);previousAnchor=anchor;
  }
  const trip=previous;
  const delivery={id:'d-'+(r+1),sourceRow:r+1,stopId:row.address.key,sourceCells:{}};
  for(const [col,key,label,kind,scope] of FIELDS){
   const value=row[key],target=scope==='trip'?trip:delivery;
   target.sourceCells[key]=target.sourceCells[key]||value.key;
   const failedBefore=scope==='trip'&&trip.issues.some(i=>i.field===key&&i.deliveryId===null&&i.message.includes('→ 빈칸'));
   if(value.error||scope==='delivery'||(!failedBefore&&(!(key in target)||target[key]===null)))target[key]=value.value;
   else if(!failedBefore&&value.value!==null&&target[key]!==value.value&&!trip.issues.some(i=>i.cell===value.key&&i.field===key))trip.issues.push({cell:value.key,field:key,deliveryId:null,message:label+' 값이 운행 안에서 다릅니다.',resolved:false});
   if(value.error&&!trip.issues.some(i=>i.cell===value.key&&i.field===key&&i.deliveryId===(scope==='delivery'?delivery.id:null)))trip.issues.push({cell:value.key,field:key,deliveryId:scope==='delivery'?delivery.id:null,message:label+': '+value.error+' → 빈칸',resolved:false});
  }
  trip.deliveries.push(delivery);
 }
 for(const trip of trips){
  const identity=[centerCode,trip.date??'미정',trip.type??'',trip.course??'',trip.vehicleSequence??'',trip.vehicleNumber??''];
  if(!trip.date)identity.push(sourceName,sheetName,String(trip.sourceRow));
  const base=identity.map(v=>encodeURIComponent(v)).join('|'),n=(counters.get(base)||0)+1;counters.set(base,n);
  trip.id='charter|'+base+'|'+n;
  if(!trip.date)trip.issues.push({cell:trip.sourceCells.date,field:'date',deliveryId:null,message:'일자가 비어 있습니다. DB 확인에서 수정해 주세요.',resolved:false});
 }
 if(!trips.length)throw new Error('4행 이후에 처리할 데이터가 없습니다.');
 return trips;
}
export function resolveRegion(delivery) {
 const explicit=String(delivery.region||'').trim(),addressRegion=charterRegion(delivery.address||'').name;
 const named=CHARTER_RATES.find(r=>r.name===explicit);
 const name=named?explicit:addressRegion||explicit;
 return {name,rate:CHARTER_RATES.find(r=>r.name===name)?.rates||null};
}
export function orderedStops(trip) {
 const map=new Map();
 for(const d of trip.deliveries){
  const key=d.stopId||d.id;if(!map.has(key))map.set(key,{id:key,deliveries:[],region:resolveRegion(d),hasAddress:!empty(d.address)});
  const stop=map.get(key);stop.deliveries.push(d);stop.hasAddress||=!empty(d.address);
  if(!stop.region.name)stop.region=resolveRegion(d);
 }
 const stops=[...map.values()],ton=String(trip.tons);
 if(CHARTER_RATES.some(r=>r.rates[ton]!=null))stops.sort((a,b)=>(b.region.rate?.[ton]??-1)-(a.region.rate?.[ton]??-1));
 return stops;
}
export function calculatedStops(trip){return orderedStops(trip).filter(s=>s.hasAddress).length;}
export function activeIssues(trip){return trip.issues.filter(i=>!i.resolved);}
export function updateField(trip,deliveryId,field,value) {
 const definition=FIELDS.find(([,key,,,scope])=>key===field&&(deliveryId?scope==='delivery':scope==='trip'));
 if(!definition)throw new Error('수정할 필드가 올바르지 않습니다.');
 const target=deliveryId?trip.deliveries.find(d=>d.id===deliveryId):trip;if(!target)throw new Error('납품처를 찾을 수 없습니다.');
 const normalized=normalizeValue(value,definition[3]);
 if(!empty(value)&&normalized===null)throw new Error(definition[2]+' 값을 확인해 주세요.');
 target[field]=normalized;
 for(const issue of trip.issues)if(issue.field===field&&issue.deliveryId===(deliveryId||null))issue.resolved=true;
 trip.updatedAt=new Date().toISOString();
}
export function makeArchive(trips,centerCode) {
 return {schemaVersion:SCHEMA_VERSION,centerCode,exportedAt:new Date().toISOString(),trips:clone(trips)};
}
export function readArchive(value,centerCode) {
 if(value?.schemaVersion!==SCHEMA_VERSION||value.centerCode!==centerCode||!Array.isArray(value.trips)||value.trips.length>100000)throw new Error('현재 센터의 용차 JSON(v2) 파일을 선택해 주세요.');
 const ids=new Set();
 return value.trips.map(raw=>{
  if(!raw||typeof raw.id!=='string'||!raw.id||raw.centerCode!==centerCode||!Array.isArray(raw.deliveries)||raw.deliveries.length>100000||ids.has(raw.id))throw new Error('JSON 운행ID·센터·납품처 구조를 확인해 주세요.');
  ids.add(raw.id);const trip={id:raw.id,centerCode,sourceName:String(raw.sourceName||''),sheetName:String(raw.sheetName||''),sourceRow:raw.sourceRow??null,sourceCells:{},issues:[],deliveries:[]};
  for(const [,key,,kind,scope] of FIELDS)if(scope==='trip')trip[key]=normalizeValue(raw[key],kind);
  trip.sourceCells=Object.fromEntries(FIELDS.filter(x=>x[4]==='trip').map(([,key])=>[key,String(raw.sourceCells?.[key]||'')]));
  trip.issues=(Array.isArray(raw.issues)?raw.issues:[]).map(i=>({cell:String(i.cell||''),field:String(i.field||''),deliveryId:i.deliveryId==null?null:String(i.deliveryId),message:String(i.message||''),resolved:i.resolved===true}));
  const deliveryIds=new Set();
  for(const [index,d] of raw.deliveries.entries()){
   const id=String(d?.id||'d-'+index);if(deliveryIds.has(id))throw new Error('납품처ID가 중복됩니다.');deliveryIds.add(id);
   const next={id,stopId:String(d?.stopId||id),sourceRow:d?.sourceRow??null,sourceCells:{}};
   for(const [,key,,kind,scope] of FIELDS)if(scope==='delivery'){next[key]=normalizeValue(d?.[key],kind);next.sourceCells[key]=String(d?.sourceCells?.[key]||'');}
   trip.deliveries.push(next);
  }
  if(!trip.date&&!trip.issues.some(i=>i.field==='date'&&!i.resolved))trip.issues.push({cell:'',field:'date',deliveryId:null,message:'일자가 비어 있습니다.',resolved:false});
  return trip;
 });
}
const sum = (trips,key) => {const values=trips.map(d=>d[key]).filter(v=>typeof v==='number');return values.length?values.reduce((s,v)=>s+v,0):null;};
export function horizontalData(trips) {
 const ordered=trips.map(t=>orderedStops(t)),maxDeliveries=ordered.reduce((m,s)=>Math.max(m,s.reduce((n,x)=>n+x.deliveries.length,0)),0);
 if(maxDeliveries>1500)throw new Error('운행당 납품처가 너무 많습니다. 분리해서 내려받아 주세요.');
 const headers=Array(40).fill('');
 Object.assign(headers,{0:'형태',1:'코스',2:'일자',3:'호차',4:'차량번호',5:'톤수',31:'총착지',32:'기사명',33:'연락처',34:'입차시간',35:'출차시간(비고)',36:'원본 착수',37:'코스 총물량',38:'운행ID',39:'확인 필요'});
 for(let i=0;i<13;i++)headers[6+i]='납품처'+(i+1);
 for(let i=0;i<12;i++)headers[19+i]='지역'+(i+1);
 const detail=['납품처코드','납품처명','고객사','총 수량','냉동','냉장','주소','권역','구간단가'];
 for(let i=0;i<maxDeliveries;i++)for(const label of detail)headers.push(label+(i+1));
 const rows=trips.map((t,index)=>{
  const stops=ordered[index];if(stops.filter(s=>s.hasAddress).length>12)throw new Error((t.date||'미정')+' '+(t.course||t.id)+': 지역이 12개를 초과합니다.');
  const row=Array(headers.length).fill(null);
  [t.type,t.course,t.date,t.vehicleSequence,t.vehicleNumber,t.tons].forEach((v,i)=>row[i]=v);
  const deliveries=stops.flatMap(s=>s.deliveries),regions=stops.filter(s=>s.hasAddress);
  deliveries.slice(0,13).forEach((d,i)=>row[6+i]=d.name);
  regions.forEach((s,i)=>row[19+i]=s.region.name||null);
  [calculatedStops(t),t.driver,t.phone,t.arrivalTime,t.departureTime,t.providedStopCount,t.courseQuantity,t.id,activeIssues(t).length].forEach((v,i)=>row[31+i]=v);
  deliveries.forEach((d,i)=>{const reg=resolveRegion(d);[d.code,d.name,d.customer,d.quantity,d.frozen,d.chilled,d.address,reg.name||null,reg.rate?.[String(t.tons)]??null].forEach((v,j)=>row[40+i*9+j]=v);});
  return row;
 });
 return {headers,rows};
}
export function buildNormalizedWorkbook(trips,XLSX) {
 const {headers,rows}=horizontalData(trips),sheet=XLSX.utils.aoa_to_sheet([[],[],headers,...rows]);
 sheet['!cols']=headers.map((_,i)=>({wch:i===38?50:i<6?18:24}));
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'평택 용차내역');
 return wb;
}
export function routingSummary(trips,term='') {
 const query=term.trim().toLowerCase(),items=[],companions=new Map(),weekdays=Array(7).fill(0);
 for(const t of trips){
  const matching=t.deliveries.filter(d=>!query||[d.code,d.name,d.customer].some(v=>String(v||'').toLowerCase().includes(query)));
  if(!matching.length)continue;
  items.push(...matching.map(d=>({trip:t,delivery:d})));
  if(t.date)weekdays[new Date(t.date+'T00:00:00Z').getUTCDay()]++;
  if(query)for(const name of new Set(t.deliveries.filter(d=>!matching.includes(d)).map(d=>d.name).filter(Boolean)))companions.set(name,(companions.get(name)||0)+1);
 }
 const daily=new Map();for(const {trip,delivery} of items){const key=trip.date||'미정';if(!daily.has(key))daily.set(key,[]);daily.get(key).push(delivery);}
 return {count:items.length,frozen:sum(items.map(i=>i.delivery),'frozen'),chilled:sum(items.map(i=>i.delivery),'chilled'),quantity:sum(items.map(i=>i.delivery),'quantity'),daily:[...daily].map(([date,ds])=>({date,frozen:sum(ds,'frozen'),chilled:sum(ds,'chilled'),quantity:sum(ds,'quantity')})),weekdays,companions:[...companions].sort((a,b)=>b[1]-a[1]),average:daily.size&&items.some(i=>i.delivery.quantity!==null)?sum(items.map(i=>i.delivery),'quantity')/daily.size:null};
}
