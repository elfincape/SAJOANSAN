import assert from 'node:assert/strict';
import {charterStatistics,filterCharterStatisticsTrips,isCombinedCharterTrip,rankCharterStatistics} from '../repo-root/js/pyeongtaek-charter-stats.js';
const delivery=(code,name,quantity,extra={})=>({code,name,quantity,customer:'고객A',...extra});
const trip=(id,date,vehicleNumber,driver,deliveries)=>({id,date,vehicleNumber,driver,deliveries});
const trips=[
 trip('one','2026-10-01','12 가 3456','김기사',[delivery('C1','사과',10),delivery('C1','사과',5),delivery('C2','배',5)]),
 trip('two','2026-10-01','12가3456','박기사',[delivery('C1','사과',20)]),
 trip('three','2026-10-03','34나7890','이기사',[delivery('C1','사과 새이름',15),delivery('C3','미확인',null,{frozen:3,chilled:null})]),
 trip('four','2026-10-03',null,'미정',[delivery('C2','배',0)])
];
const before=JSON.stringify(trips),stats=charterStatistics([...trips,trips[0]],{from:'2026-10-01',to:'2026-10-05'});
assert.equal(stats.tripCount,4);assert.equal(stats.missingVehicle,1);assert.equal(stats.period.days,5);assert.equal(stats.drivers.length,2);
assert.equal(stats.drivers[0].name,'12가3456');assert.equal(stats.drivers[0].tripCount,2);assert.equal(stats.drivers[0].dayCount,1);assert.deepEqual(new Set(stats.drivers[0].names),new Set(['김기사','박기사']));
assert.equal(stats.drivers[0].destinations[0].code,'C1');assert.equal(stats.drivers[0].destinations[0].tripCount,2);assert.equal(stats.drivers[0].destinations[0].totalQuantity,35);
const c=stats.customers.find(c=>c.code==='C1');assert.equal(stats.customers[0].code,'C1');assert.equal(c.name,'사과');assert.equal(c.tripCount,3);assert.equal(c.dayCount,2);assert.equal(c.totalQuantity,50);assert.equal(c.averageDeliveryDay,25);assert.equal(c.averagePeriodDay,10);
const zero=stats.customers.find(c=>c.code==='C2');assert.equal(zero.totalQuantity,5);assert.equal(zero.averageDeliveryDay,2.5);assert.equal(zero.averagePeriodDay,1);
const missing=stats.customers.find(c=>c.code==='C3');assert.equal(missing.missingQuantity,1);assert.equal(missing.averageDeliveryDay,null);
const fallback=charterStatistics([trip('five','2026-10-02','12가3456','김기사',[delivery('', '같은이름',null,{frozen:6,chilled:4}),delivery('','같은이름',10,{customer:'고객B'})])]);assert.equal(fallback.customers.length,2);assert.equal(fallback.customers[0].totalQuantity,10);
const undated=charterStatistics([trip('six',null,'12가3456','김기사',[delivery('C1','사과',10)])]);assert.equal(undated.customers[0].averageDeliveryDay,null);assert.equal(undated.customers[0].missingDate,1);assert.equal(undated.period.days,0);
assert.equal(charterStatistics(trips).period.days,3);assert.deepEqual(charterStatistics([]).customers,[]);assert.equal(JSON.stringify(trips),before);
console.log('PASS: vehicle-based trip ranking, driver destinations, unique trip/day counts, customer aliases, zero quantities, missing data and both daily averages');

const merged=charterStatistics([trip('merged','2026-10-01','12가3456','김기사',[delivery('M','병합',20,{sourceCells:{quantity:'J4'}}),delivery('M','병합',20,{sourceCells:{quantity:'J4'}})])]);assert.equal(merged.customers[0].tripCount,1);assert.equal(merged.customers[0].totalQuantity,20);
console.log('PASS: a merged quantity cell is counted once per customer and trip');

const combinedFixtures=[{...trips[0],type:'용차'},{...trips[1],type:'합 배송'},{...trips[2],type:'용차'},{...trips[3],type:'용차'}];
assert.equal(isCombinedCharterTrip(combinedFixtures[0],'marked'),false);assert.equal(isCombinedCharterTrip(combinedFixtures[0],'multiple'),true);
assert.equal(isCombinedCharterTrip({...trips[0],deliveries:[trips[0].deliveries[0],trips[0].deliveries[1]]},'multiple'),false);
assert.deepEqual(filterCharterStatisticsTrips(combinedFixtures,{excludeCombined:true}).map(t=>t.id),['one','three','four']);
assert.deepEqual(filterCharterStatisticsTrips(combinedFixtures,{excludeCombined:true,combinedMode:'multiple'}).map(t=>t.id),['two','four']);
assert.deepEqual(filterCharterStatisticsTrips(combinedFixtures,{excludeCombined:true,combinedMode:'either'}).map(t=>t.id),['four']);
const scoped=filterCharterStatisticsTrips(combinedFixtures,{customer:'사과',excludeCombined:true,combinedMode:'multiple'});assert.deepEqual(scoped.map(t=>t.id),['two']);
assert.deepEqual(filterCharterStatisticsTrips(combinedFixtures,{vehicle:'박기사'}).map(t=>t.id),['two']);
assert.deepEqual(filterCharterStatisticsTrips(combinedFixtures,{vehicle:'12 가 3456'}).map(t=>t.id),['one','two']);
assert.deepEqual(filterCharterStatisticsTrips(combinedFixtures,{weekday:'6'}).map(t=>t.id),['three','four']);
assert.deepEqual(filterCharterStatisticsTrips(combinedFixtures,{from:'2026-10-02',to:'2026-10-01'}),[]);
const oneClient=filterCharterStatisticsTrips([{...trips[0],tons:2.5,deliveries:[delivery('X','선택',10),delivery('Y','다른 고객',20,{customer:'고객B'})]}],{client:'고객A',tons:'2.5'});assert.equal(oneClient[0].deliveries.length,1);assert.equal(oneClient[0].deliveries[0].code,'X');
assert.equal(rankCharterStatistics(stats.customers,{minTrips:2,limit:1})[0].code,'C1');assert.equal(rankCharterStatistics(stats.customers,{minTrips:2,limit:0}).length,2);
assert.equal(rankCharterStatistics(stats.customers,{sort:'averageDeliveryDay',limit:0}).at(-1).code,'C3');
assert.equal(JSON.stringify(trips),before);
console.log('PASS: independent conditions, original-route combined classification before customer filtering, selectable exclusion modes, sorting, minimum frequency and limits');
