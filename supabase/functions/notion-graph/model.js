import {CENTERS,UUID,fail,plain,rich} from '../notion-points/model.js';
export {CENTERS,UUID,fail,plain,rich};
export const SOURCES={companies:'839651ae-1f57-4a2f-8353-92694314bc4b',drivers:'dcb7a35b-8937-4f15-ad13-ee214ce957da',routes:'8882bcc6-45ef-435d-87f8-b9ccfdec5c1a'};
export const FIELDS={
  companies:{name:['운수사명','title'],memo:['비고','rich_text']},
  drivers:{name:['기사명','title'],phone:['연락처','phone_number'],memo:['비고','rich_text'],company_id:['운수사','relation','companies']},
  routes:{name:['코스명','title'],car_number:['차량호칭','rich_text'],active:['운행중','checkbox'],closed_days:['휴무일','multi_select'],
    company_id:['운수사','relation','companies'],primary_driver_id:['주기사','relation','drivers'],
    secondary_driver_id:['보조기사','relation','drivers'],stops:['납품처','relation','points','many']}
};
export const DAYS=['일','월','화','수','목','금','토'];
export const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const sorted=a=>[...new Set(a)].sort();
export function webValues(kind,row,stops=[]) {
  return Object.fromEntries(Object.entries(FIELDS[kind]).map(([key,[,type]])=>[key,
    key==='stops'?sorted(stops.map(s=>s.delivery_point_id)):type==='checkbox'?!!row[key]:
    type==='multi_select'?sorted((row[key]||[]).map(Number)):type==='relation'?row[key]||null:String(row[key]??'').trim()]));
}
export function merge(base,web,remote) {
  const values={},conflicts=[];
  for(const key of Object.keys(web)){
    if(equal(web[key],remote[key]))values[key]=web[key];
    else if(base&&equal(web[key],base[key]))values[key]=remote[key];
    else if(base&&equal(remote[key],base[key]))values[key]=web[key];
    else conflicts.push(key);
  }
  return {values,conflicts};
}
export function remoteValues(kind,page,maps) {
  return Object.fromEntries(Object.entries(FIELDS[kind]).map(([key,[name,type,target,many]])=>{
    const p=page.properties?.[name];let value;
    if(type==='relation'){
      if(p?.has_more)throw fail('관계 목록을 모두 확인하지 못했습니다.',422,'relation_incomplete');
      const ids=(p?.relation||[]).map(r=>{
        const id=maps[target].reverse.get(r.id.replaceAll('-','').toLowerCase());
        if(!id)throw fail('다른 센터 또는 아직 연결되지 않은 관계를 확인해 주세요.',422,'relation_scope');
        return id;
      });
      if(!many&&ids.length>1)throw fail('운수사 또는 담당 기사는 한 명씩 선택해 주세요.',422,'relation_cardinality');
      value=many?sorted(ids):ids[0]||null;
    }else if(type==='multi_select'){
      value=sorted((p?.multi_select||[]).map(x=>{const n=DAYS.indexOf(x.name);if(n<0)throw fail('휴무일을 확인해 주세요.',422,'invalid_days');return n;}));
    }else value=type==='checkbox'?!!p?.checkbox:type==='phone_number'?String(p?.phone_number||'').trim():plain(p).trim();
    return [key,value];
  }));
}
export function properties(kind,values,maps) {
  const out={};
  for(const [key,[name,type,target,many]] of Object.entries(FIELDS[kind])){
    const v=values[key];
    if(type==='relation'){
      const ids=many?v:v?[v]:[];
      if(ids.length>100)throw fail('한 코스의 납품처가 100개를 초과합니다.',422,'relation_limit');
      out[name]={relation:ids.map(id=>{const page=maps[target].forward.get(id);if(!page)throw fail('관계 대상의 연결이 필요합니다.',422,'relation_pending');return {id:page};})};
    }else out[name]=type==='title'||type==='rich_text'?{[type]:rich(v)}:
      type==='checkbox'?{checkbox:!!v}:type==='multi_select'?{multi_select:v.map(n=>({name:DAYS[n]}))}:{phone_number:v||null};
  }
  return out;
}
export function webPatch(kind,values){return Object.fromEntries(Object.entries(values).map(([k,v])=>[k,typeof v==='string'?v||null:v]));}
export function metadata(kind,center,id,status='정상') {
  const page=kind==='routes'?'route-edit':'drivers';
  const file=kind==='companies'?'companies':page;
  return {'센터':{select:{name:CENTERS[center]}},'웹 ID':{rich_text:rich(id)},'동기화 상태':{select:{name:status}},
    '최근 동기화일':{date:{start:new Date().toISOString()}},
    '웹 바로가기':{url:'https://sajoansan.vercel.app/admin/'+file+'.html?center='+(center==='001'?'ansan':'pyeongtaek')+'&id='+id}};
}
export function validate(body) {
  if(!body||!Object.hasOwn(CENTERS,body.center)||!Object.hasOwn(SOURCES,body.kind))throw fail('센터와 정보 종류를 확인해 주세요.');
  if(body.id!==undefined&&!UUID.test(body.id))throw fail('식별 정보를 확인해 주세요.');
  if(body.phase!==undefined&&!['web','notion','summary'].includes(body.phase))throw fail('동기화 단계를 확인해 주세요.');
  if(body.cursor!==undefined&&body.cursor!==null&&(typeof body.cursor!=='string'||!body.cursor||body.cursor.length>500||
    ((body.phase||'web')!=='notion'&&!UUID.test(body.cursor))))throw fail('조회 위치를 확인해 주세요.');
}
