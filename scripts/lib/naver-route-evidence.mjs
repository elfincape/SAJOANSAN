import {createHash} from 'node:crypto';
// The browser's existing directions response, not an extra route/API request.
// Observed wire contract: pcweb_navermap_v5/261025-5059ff3. Unknown formats fail closed.
const invalid=()=>Error('네이버 동일 경로의 원시 거리 응답을 확인하지 못했습니다.');
function reader(bytes){
 let offset=0;
 const uint=()=>{let value=0n;for(let shift=0n;shift<70n;shift+=7n){if(offset>=bytes.length)throw invalid();const b=bytes[offset++];value|=BigInt(b&127)<<shift;if(b<128)return value;}throw invalid();};
 return {uint,done:()=>offset===bytes.length,skip(n){if(!Number.isSafeInteger(n)||n<0||offset+n>bytes.length)throw invalid();const value=bytes.subarray(offset,offset+n);offset+=n;return value;}};
}
function message(bytes){
 const fields=new Map(),r=reader(bytes);
 while(!r.done()){
  const tag=Number(r.uint()),field=tag>>>3,wire=tag&7;if(!field)throw invalid();
  let value;
  if(wire===0)value=r.uint();else if(wire===2)value=r.skip(Number(r.uint()));else if(wire===1||wire===5){r.skip(wire===1?8:4);continue;}else throw invalid();
  if(!fields.has(field))fields.set(field,[]);fields.get(field).push(value);
 }
 return fields;
}
const values=(m,n)=>m.get(n)??[];
const only=(m,n)=>{const vs=values(m,n);if(vs.length!==1)throw invalid();return vs[0];};
function numbers(vs){return vs.flatMap(value=>{if(typeof value==='bigint')return[value];const r=reader(value),out=[];while(!r.done())out.push(r.uint());return out;});}
const safe=value=>{const number=Number(value);if(!Number.isSafeInteger(number))throw invalid();return number;};
const string=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
export function decodeNaverDirections(bytes){
 try{
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>16*1024*1024)throw invalid();
  const root=message(bytes);if(safe(values(root,1)[0]??0n)!==0)throw invalid();
  const dictionary=message(only(root,23)),keys=values(dictionary,1).map(b=>{const m=message(b);return {name:string(only(m,1)),type:safe(values(m,2)[0]??0n)};}),integers=numbers(values(dictionary,11)).map(n=>(n>>1n)^-(n&1n)),strings=values(dictionary,12).map(string);
  const allowed=new Set(['distance','pointIndex','label','mainOption','subOption']);
  const tags=bytes=>{
   const tags=numbers(values(message(bytes),1)),out={};if(tags.length%2)throw invalid();
   for(let i=0;i<tags.length;i+=2){const key=keys[safe(tags[i])],index=safe(tags[i+1]);if(!key)throw invalid();if(!allowed.has(key.name))continue;
    if(key.type===11){if(typeof strings[index]!=='string')throw invalid();out[key.name]=strings[index];}
    else if(key.type===0){if(typeof integers[index]!=='bigint')throw invalid();out[key.name]=safe(integers[index]);}else throw invalid();
   }return out;
  };
  const routes=values(root,21).map(bytes=>{
   const m=message(bytes),summaryBytes=only(m,1),summary=message(summaryBytes),raw=tags(summaryBytes),waypoints=values(summary,13),goals=values(summary,12),positions=[...waypoints,...goals].map(tags),path=only(m,2);
   if(!Number.isSafeInteger(raw.distance)||raw.distance<0)throw invalid();
   if(!(path instanceof Uint8Array)||!path.length)throw invalid();
   return {distanceMeters:raw.distance,label:raw.label,legDistancesMeters:positions.map(p=>Number.isSafeInteger(p.distance)&&p.distance>=0?p.distance:null),pointIndices:positions.map(p=>p.pointIndex??null),waypointCount:waypoints.length,goalCount:goals.length,pathIdentity:createHash('sha256').update(path).digest('hex')};
  });
  const options=values(root,22).map(bytes=>({ ...tags(bytes),routeIndices:numbers(values(message(bytes),2)).map(safe) }));
  if(!routes.length||routes.length>100||!options.length||options.length>20||options.some(o=>!o.routeIndices.length||o.routeIndices.some(i=>!routes[i])))throw invalid();
  return {routes,options};
 }catch{throw invalid();}
}
function offeredRoutes({routes,options}){
 const primary=options.filter(o=>!(o.subOption&32)),used=new Set(primary.map(o=>o.routeIndices[0])),limit=Math.max(0,6-primary.length),recommended=primary.some(o=>o.mainOption===3&&!(o.subOption&2));
 return options.flatMap(option=>{
  const alternative=!!(option.subOption&32),indices=alternative?option.routeIndices.slice(1).filter(i=>!used.has(i)&&!(recommended&&i===0)).slice(0,limit):option.routeIndices.slice(0,1);
  return indices.map(index=>{const route=routes[index];const label=alternative?(route.label||'')+' 이용':option.mainOption===9?'거리우선':option.mainOption===2?'큰길우선':option.mainOption===3?(option.subOption&2?'무료우선':'실시간 추천'):'';return {route,index,label,option};});
 });
}
export function matchNaverRouteOptions(raw,rendered,stopCount){
 const offered=offeredRoutes(raw),normalize=s=>String(s).replace(/\s/g,'');
 if(offered.length!==rendered.length)throw invalid();
 return offered.map(({route,index,label,option},i)=>{
  const shown=rendered[i],match=shown.distanceText?.trim().match(/^([\d,]+(?:\.(\d+))?)\s*(km|m)$/i);
  if(!match||normalize(label)!==normalize(shown.routeLabel))throw invalid();
  const unit=match[3].toLowerCase()==='km'?1000:1,shownMeters=Number(match[1].replaceAll(',',''))*unit,precision=unit/10**(match[2]?.length??0);
  if(!Number.isFinite(shownMeters)||Math.abs(shownMeters-route.distanceMeters)>precision/2+1)throw invalid();
  const shape=route.waypointCount===stopCount-2&&route.goalCount===1,legs=shape?route.legDistancesMeters:Array(stopCount-1).fill(null),indices=route.pointIndices;
  const legsVerified=shape&&legs.length===stopCount-1&&legs.every(n=>Number.isSafeInteger(n)&&n>=0)&&indices.every((n,j)=>Number.isSafeInteger(n)&&n>=0&&(!j||n>=indices[j-1]))&&legs.reduce((sum,n)=>sum+n,0)===route.distanceMeters;
  return {...shown,distanceMeters:route.distanceMeters,legDistancesMeters:legs,legsVerified,rawRouteIndex:index,pathIdentity:route.pathIdentity,providerOption:{main:option.mainOption,sub:option.subOption},...(!legsVerified?{legIssue:'동일 경로의 경유·도착 구간 수 또는 원시 합계 미확인'}:{})};
 });
}
