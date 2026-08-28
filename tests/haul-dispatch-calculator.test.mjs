import assert from 'node:assert/strict';
import {VEHICLES,calculateHaulCombinations,canLoad,rateFor,usedSpace} from '../repo-root/js/haul-dispatch-calculator.js';

assert.deepEqual(VEHICLES.map(vehicle=>[vehicle.type,vehicle.capacity]),[['1톤',2],['2.5톤',4],['3.5톤',6],['5톤',10],['8톤',14],['11톤',16],['18톤',18]]);
assert.equal(usedSpace(0,2),2);
assert.equal(usedSpace(0,7),7);
assert.equal(usedSpace(5,5),12);
assert.equal(canLoad(10,5,5),false);
assert.equal(canLoad(14,5,5),true);
assert.equal(usedSpace(7,8),16);
assert.equal(canLoad(16,7,8),true);
assert.equal(usedSpace(7,9),18);
assert.equal(canLoad(18,7,9),true);
assert.equal(rateFor('김해','안산','5톤'),457000);
assert.equal(rateFor('김해','안산','11톤'),508000);

const cases=[
  [0,2,'1톤'],[0,7,'5톤'],[5,5,'8톤'],[7,8,'11톤'],[7,9,'18톤']
];
for(const [frozen,chilled,expectedType] of cases){
  const result=calculateHaulCombinations({origin:'김해',destination:'안산',frozen,chilled});
  assert.equal(result[0].vehicles[0].type,expectedType);
  validateResults(result,frozen,chilled);
}

for(const [frozen,chilled] of [[7,15],[15,15],[0,40]]){
  const result=calculateHaulCombinations({origin:'김해',destination:'안산',frozen,chilled});
  assert.equal(result.length,10);
  assert.ok(result[0].vehicleCount>=2);
  validateResults(result,frozen,chilled);
}
const forty=calculateHaulCombinations({origin:'김해',destination:'안산',frozen:0,chilled:40});
assert.ok(forty.some(result=>new Set(result.vehicles.map(vehicle=>vehicle.type)).size<result.vehicleCount));

const requested=[['김해','안산'],['김해','평택'],['양산','안성']];
for(const [origin,destination] of requested){
  const results=calculateHaulCombinations({origin,destination,frozen:7,chilled:15});
  assert.equal(results.length,10);
  validateResults(results,7,15);
  console.log(`\n${origin} → ${destination} / 냉동 7P / 냉장 15P`);
  results.forEach(result=>console.log(`${result.rank}위 ${result.totalCost.toLocaleString('ko-KR')}원 | ${result.vehicles.map(vehicle=>`${vehicle.type}(냉동${vehicle.frozen}/냉장${vehicle.chilled}, ${vehicle.usedSpace}/${vehicle.capacity}P)`).join(' + ')}`));
}

function validateResults(results,targetFrozen,targetChilled){
  const signatures=new Set();
  results.forEach((result,index)=>{
    assert.equal(result.rank,index+1);
    if(index)assert.ok(results[index-1].totalCost<=result.totalCost);
    assert.equal(result.vehicles.reduce((sum,vehicle)=>sum+vehicle.frozen,0),targetFrozen);
    assert.equal(result.vehicles.reduce((sum,vehicle)=>sum+vehicle.chilled,0),targetChilled);
    result.vehicles.forEach(vehicle=>assert.ok(canLoad(vehicle.capacity,vehicle.frozen,vehicle.chilled)));
    const signature=result.vehicles.map(vehicle=>vehicle.type).join('+');
    assert.equal(signatures.has(signature),false);
    signatures.add(signature);
  });
}

console.log('\nhaul dispatch calculator checks passed');
