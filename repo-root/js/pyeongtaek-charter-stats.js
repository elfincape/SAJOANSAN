import {validDate} from './pyeongtaek-charter-model.js';
const text=value=>String(value??'').trim().replace(/\s+/g,' ');
const numeric=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const compare=(a,b)=>b.tripCount-a.tripCount||b.dayCount-a.dayCount||a.name.localeCompare(b.name,'ko-KR');
function quantity(delivery){return numeric(delivery.quantity)?delivery.quantity:numeric(delivery.frozen)&&numeric(delivery.chilled)?delivery.frozen+delivery.chilled:null;}
function addCustomer(map,trip,delivery){
 const code=text(delivery.code),name=text(delivery.name),customer=text(delivery.customer);
 if(!code&&!name)return false;
 const key=customer.replace(/\s/g,'')==='한성'
  ? 'hansung:'+JSON.stringify([name,text(delivery.address).replace(/[\s,]/g,'')])
  : code?'code:'+code:'name:'+JSON.stringify([name,customer]);
 if(!map.has(key))map.set(key,{key,code,names:new Map(),clients:new Set(),trips:new Set(),days:new Set(),quantityKeys:new Set(),totalQuantity:0,missingQuantity:0,missingDate:0});
 const entry=map.get(key);if(name)entry.names.set(name,(entry.names.get(name)||0)+1);if(customer)entry.clients.add(customer);entry.trips.add(trip.id);
 if(validDate(trip.date))entry.days.add(trip.date);else entry.missingDate++;
 const q=quantity(delivery),cells=delivery.sourceCells||{},anchor=numeric(delivery.quantity)?cells.quantity:cells.frozen&&cells.chilled?cells.frozen+'|'+cells.chilled:null;
 const quantityKey=anchor?JSON.stringify([trip.id,anchor]):null;
 if(quantityKey&&entry.quantityKeys.has(quantityKey))return true;
 if(quantityKey)entry.quantityKeys.add(quantityKey);
 if(q===null)entry.missingQuantity++;else entry.totalQuantity+=q;return true;
}
function rankedNames(map){return [...map].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko-KR')).map(([name])=>name);}
function customers(map,periodDays){
 return [...map.values()].map(entry=>{
  const complete=!entry.missingQuantity&&!entry.missingDate,dayCount=entry.days.size;
  return {key:entry.key,code:entry.code,name:rankedNames(entry.names)[0]||'(거래처명 미등록)',clients:[...entry.clients].sort(),tripCount:entry.trips.size,dayCount,totalQuantity:entry.totalQuantity,missingQuantity:entry.missingQuantity,missingDate:entry.missingDate,averageDeliveryDay:complete&&dayCount?entry.totalQuantity/dayCount:null,averagePeriodDay:complete&&periodDays?entry.totalQuantity/periodDays:null};
 }).sort(compare);
}
export function charterStatistics(trips,{from='',to=''}={}){
 const all=new Map(),vehicles=new Map(),dates=[],seen=new Set();let tripCount=0,missingVehicle=0,missingCustomer=0;
 for(const [index,raw] of trips.entries()){
  const id=raw.id??'row-'+index;if(seen.has(id))continue;seen.add(id);const trip={...raw,id};tripCount++;
  if(validDate(trip.date))dates.push(trip.date);
  const vehicle=text(trip.vehicleNumber).replace(/[\s-]/g,'').toUpperCase();let driver;
  if(vehicle){
   if(!vehicles.has(vehicle))vehicles.set(vehicle,{key:vehicle,name:vehicle,names:new Map(),tripCount:0,days:new Set(),lastDate:'',destinations:new Map()});
   driver=vehicles.get(vehicle);driver.tripCount++;const name=text(trip.driver);if(name)driver.names.set(name,(driver.names.get(name)||0)+1);
   if(validDate(trip.date)){driver.days.add(trip.date);if(trip.date>driver.lastDate)driver.lastDate=trip.date;}
  }else missingVehicle++;
  for(const delivery of trip.deliveries||[]){if(!addCustomer(all,trip,delivery))missingCustomer++;if(driver)addCustomer(driver.destinations,trip,delivery);}
 }
 dates.sort();const start=validDate(from)?from:dates[0]||'',end=validDate(to)?to:dates.at(-1)||'';
 const periodDays=start&&end&&end>=start?Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1:0;
 return {tripCount,missingVehicle,missingCustomer,period:{from:start,to:end,days:periodDays},customers:customers(all,periodDays),drivers:[...vehicles.values()].map(v=>({key:v.key,name:v.name,names:rankedNames(v.names),tripCount:v.tripCount,dayCount:v.days.size,lastDate:v.lastDate,destinations:customers(v.destinations,periodDays)})).sort(compare)};
}

export function isCombinedCharterTrip(trip){
 return text(trip.course).includes('합배송');
}
export function filterCharterStatisticsTrips(trips,options={}){
 const {from='',to='',vehicle='',customer='',client='',tons='',weekday='',excludeCombined=false}=options;
 if(validDate(from)&&validDate(to)&&from>to)return [];
 const query=text(customer).toLowerCase(),vehicleQuery=text(vehicle).replace(/\s/g,'').toLowerCase();
 return trips.flatMap(trip=>{
  if((from||to)&&(!validDate(trip.date)||(from&&trip.date<from)||(to&&trip.date>to)))return [];
  if(weekday!==''&&(!validDate(trip.date)||new Date(trip.date+'T00:00:00Z').getUTCDay()!==Number(weekday)))return [];
  if(tons!==''&&String(trip.tons??'')!==tons)return [];
  if(vehicleQuery&&![trip.vehicleNumber,trip.driver].some(v=>text(v).replace(/[\s-]/g,'').toLowerCase().includes(vehicleQuery.replace(/-/g,''))))return [];
  if(excludeCombined&&isCombinedCharterTrip(trip))return [];
  if(!query&&!client)return [trip];
  const deliveries=(trip.deliveries||[]).filter(d=>(!client||text(d.customer)===client)&&(!query||[d.code,d.name].some(v=>text(v).toLowerCase().includes(query))));
  return deliveries.length?[{...trip,deliveries}]:[];
 });
}
export function rankCharterStatistics(rows,{sort='tripCount',minTrips=1,limit=50}={}){
 const minimum=Number.isFinite(Number(minTrips))?Math.max(1,Number(minTrips)):1;
 const result=rows.filter(row=>row.tripCount>=minimum).slice().sort((a,b)=>{
  if(sort==='name')return a.name.localeCompare(b.name,'ko-KR');
  const av=a[sort],bv=b[sort];
  if(av==null&&bv!=null)return 1;if(bv==null&&av!=null)return -1;
  const difference=sort==='lastDate'?String(bv??'').localeCompare(String(av??'')):Number(bv??0)-Number(av??0);
  return difference||compare(a,b);
 });
 const maximum=Number(limit);return maximum>0?result.slice(0,maximum):result;
}
