import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../repo-root/admin/haul-dispatch-calculator.html',import.meta.url),'utf8');
const hub=readFileSync(new URL('../repo-root/admin/index.html',import.meta.url),'utf8');
assert.match(hub,/haul-dispatch-calculator\.html/);
assert.match(hub,/title: '하불 배차 계산'/);
for(const id of ['origin','destination','frozen','chilled','calculate','results'])assert.match(page,new RegExp(`id="${id}"`));
assert.match(page,/list="destination-list"/);
assert.match(page,/calculateHaulCombinations\(\{origin,destination,frozen,chilled,limit:10\}\)/);
assert.match(page,/vehicle\.usedSpace/);
assert.match(page,/vehicle\.remainingSpace/);
assert.match(page,/const showPrices=isPrivateFeatureOwner\(profile\)&&loadPrivateFeatures\(profile\)\.haulPrices/);
assert.match(page,/showPrices\?`<div[^`]+formatWon\(result\.totalCost\)/);
assert.match(page,/showPrices&&result\.extraCost\?/);
assert.match(page,/showPrices\?`<span[^`]+formatWon\(vehicle\.rate\)/);
assert.doesNotMatch(page,/Intl\.NumberFormat/);

console.log('haul dispatch calculator UI checks passed');
