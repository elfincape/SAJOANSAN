export const DEFAULT_ORIGIN='경기도 평택시 산단로 263';
export const DEFAULT_EFFICIENCY={'1':8.3,'2.5':6.7,'3.5':6,'5':4.8,'11':4};
export function efficiencyFor(tons,values=DEFAULT_EFFICIENCY){
 const n=Number(tons),key=n>=11?'11':String(n),eff=Number(values[key]);
 return tons!=null&&n>0&&Number.isFinite(eff)&&eff>0?eff:null;
}
export function originalStops(trip){
 const groups=new Map();
 const deliveries=[...(trip.deliveries??[])].sort((a,b)=>Number(a.sourceRow??Infinity)-Number(b.sourceRow??Infinity));
 for(const d of deliveries){
  const key=String(d.stopId||d.id||d.sourceRow),address=String(d.address??'').trim();
  if(!groups.has(key))groups.set(key,{names:[],address:''});
  const stop=groups.get(key);if(d.name&&!stop.names.includes(d.name))stop.names.push(String(d.name));
  if(address){if(stop.address&&stop.address!==address)throw Error('같은 착지의 주소가 서로 다릅니다. DB에서 확인해 주세요.');stop.address=address;}
 }
 return [...groups.values()].map(s=>({name:s.names.join(' / '),address:s.address}));
}
export function fuelResult(trip,route,{efficiencies,price,origin=DEFAULT_ORIGIN}){
 const efficiency=efficiencyFor(trip.tons,efficiencies),rate=Number(price),stops=originalStops(trip);
 if(!efficiency||!Number.isFinite(rate)||rate<=0)throw Error('톤수별 연비와 리터당 유류단가를 확인해 주세요.');
 if(route.sections?.length!==stops.length)throw Error('착지 수와 거리 응답이 다릅니다.');
 const rows=stops.map((s,i)=>{
  const meters=route.sections[i].distanceMeters;
  if(!Number.isFinite(meters)||meters<0)throw Error('주행거리 값이 올바르지 않습니다.');
  const distance=meters/1000,liters=distance/efficiency;
  return {order:i+1,fromName:i?stops[i-1].name:'기준주소',fromAddress:i?stops[i-1].address:origin,tons:trip.tons,stopName:s.name,address:s.address,distanceKm:distance,efficiency,liters,fuelCost:liters*rate};
 });
 return {id:trip.id,date:trip.date??'',origin,tons:trip.tons,rows,distanceKm:rows.reduce((n,r)=>n+r.distanceKm,0),liters:rows.reduce((n,r)=>n+r.liters,0),fuelCost:rows.reduce((n,r)=>n+r.fuelCost,0),calculatedAt:route.calculatedAt};
}
export function fuelSummary(results){
 const groups=new Map();
 for(const r of results){
  const key=Number(r.tons)+'톤';
  if(!groups.has(key))groups.set(key,{label:key,count:0,distanceKm:0,liters:0,fuelCost:0});
  const g=groups.get(key);g.count++;g.distanceKm+=r.distanceKm;g.liters+=r.liters;g.fuelCost+=r.fuelCost;
 }
 return [...groups.values()].sort((a,b)=>parseFloat(a.label)-parseFloat(b.label)).map(g=>({...g,averageDistance:g.distanceKm/g.count,averageLiters:g.liters/g.count,averageFuelCost:g.fuelCost/g.count}));
}
export const RESULT_HEADERS=['톤수','착지명','주소','착지당 주행거리(km)','연비(km/L)','사용량(L)','유류비(원)'];
export function fuelRows(results){return results.flatMap(r=>r.rows.map(s=>[s.tons,s.stopName,s.address,Number(s.distanceKm.toFixed(3)),s.efficiency,Number(s.liters.toFixed(3)),Math.round(s.fuelCost)]));}
export const GROUP_HEADERS=['묶음','일자','착지순서','톤수','구간 출발지 주소','착지명','주소','구간거리(km)','연비(km/L)','사용량(L)','유류비(원)'];
export function groupedFuelRows(results){return results.flatMap((r,index)=>r.rows.map(s=>[index+1,r.date,s.order,s.tons,s.fromAddress,s.stopName,s.address,Number(s.distanceKm.toFixed(3)),s.efficiency,Number(s.liters.toFixed(3)),Math.round(s.fuelCost)]));}
export async function loadFuelTrips(client,{from,through}){
 const rows=[];
 for(let offset=0;;offset+=500){
  let q=client.from('charter_trips').select('id,business_date,tons:payload->tons,deliveries:payload->deliveries').eq('center_code','002').order('business_date').order('id').range(offset,offset+499);
  if(from)q=q.gte('business_date',from);if(through)q=q.lte('business_date',through);
  const {data,error}=await q;if(error)throw Error('평택 DB 조회 실패: '+error.message);
  rows.push(...data.map(r=>({id:r.id,date:r.business_date??'',tons:r.tons,deliveries:(r.deliveries??[]).map(d=>({id:d.id,stopId:d.stopId,sourceRow:d.sourceRow,name:d.name,address:d.address}))})));
  if(data.length<500)return rows;
 }
}
