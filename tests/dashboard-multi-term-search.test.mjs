import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../repo-root/js/dashboard.js', import.meta.url), 'utf8');
const start = source.indexOf('function applyFiltersAndSort()');
const end = source.indexOf('// -----------------------------------------------------------------------------\n// 렌더', start);
const filters = Object.fromEntries(['company_name','route_name','car_number','dp_region','driver_name','delivery_method','access_method','delivery_location','security_key_location','security_password','entry_cond'].map(k => [k,new Set()]));
const row = {dp_name:'동원홈푸드 시화', primary_driver_phone:'010-1234-5678', company_name:'운수사', route_name:'코스 미지정'};
const state = {filters, rows:[row], sort:[]};
const context = vm.createContext({state});
vm.runInContext(source.slice(start,end), context);
function search(query) { filters.search=query; context.applyFiltersAndSort(); return state.filtered.length; }
for (const query of ['동원 시화','시화 동원홈','  시화   동원홈  ','동원홈푸드 시화','동원','시화\t동원','01012345678','동원 010-1234','']) assert.equal(search(query),1,query);
for (const query of ['동원 안산','없는업체 01012345678','없는업체01012345678']) assert.equal(search(query),0,query);
filters.company_name.add('다른운수사');
assert.equal(search('동원 시화'),0);
console.log('Dashboard unordered multi-term search and phone/filter regressions passed');
