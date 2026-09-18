import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { koreaToday, validDate, nextMonth, healthStatus, compareHealthDates, compareHealthRows, rowHealthDate } from '../repo-root/js/driver-health.js';
assert.equal(koreaToday(new Date('2026-09-17T15:00:00Z')), '2026-09-18');
assert.equal(nextMonth('2026-01-31'), '2026-02-28');
assert.equal(nextMonth('2028-01-31'), '2028-02-29');
assert.equal(nextMonth('2026-12-31'), '2027-01-31');
assert.equal(validDate('2026-02-29'),false);
assert.equal(validDate('2028-02-29'),true);
assert.equal(healthStatus('2026-09-17','2026-09-18').rank,0);
assert.equal(healthStatus('2026-09-18','2026-09-18').label,'보건증 오늘 만료');
assert.equal(healthStatus('2026-10-17','2026-09-18').rank,1);
assert.equal(healthStatus('2026-10-18','2026-09-18').urgent,false);
assert.equal(healthStatus(null,'2026-09-18').urgent,false);
assert.equal(healthStatus('2026-02-29','2026-09-18').urgent,false);
assert.equal(healthStatus('2026-02-28','2026-01-31').urgent,false);
const today='2026-09-18';
const rows=[
 {id:'normal',primary_driver_health_expires_on:'2026-12-31'},
 {id:'soon',primary_driver_health_expires_on:'2026-10-01'},
 {id:'expired-secondary',secondary_driver_health_expires_on:'2026-09-01'},
 {id:'missing'},
 {id:'earlier',primary_driver_health_expires_on:'2026-08-01'}
];
assert.equal(rows.toSorted((a,b)=>compareHealthRows(a,b,today)).map(r=>r.id).join(','),'earlier,expired-secondary,soon,normal,missing');
assert.equal(rowHealthDate({primary_driver_health_expires_on:'2026-12-31',secondary_driver_health_expires_on:'2026-09-01'},today),'2026-09-01');
const dash=fs.readFileSync(new URL('../repo-root/js/dashboard.js',import.meta.url),'utf8');
const filters=Object.fromEntries(['company_name','route_name','car_number','dp_region','driver_name','delivery_method','access_method','delivery_location','security_key_location','security_password','entry_cond'].map(k=>[k,new Set()]));
filters.search='';
const state={filters,rows,sort:[{key:'id',dir:'desc'}]};
const ctx=vm.createContext({state, compareHealthRows:(a,b)=>compareHealthRows(a,b,today)});
const start=dash.indexOf('function applyFiltersAndSort()');
vm.runInContext(dash.slice(start,dash.indexOf('// -----------------------------------------------------------------------------\n// 렌더',start)),ctx);
ctx.applyFiltersAndSort();
assert.equal(state.filtered[0].id,'earlier');
assert.equal(state.filtered[1].id,'expired-secondary');
filters.search='normal'; ctx.applyFiltersAndSort(); assert.equal(state.filtered.length,1);
const admin=fs.readFileSync(new URL('../repo-root/admin/drivers.html',import.meta.url),'utf8');
const adminState={rows:rows.map(r=>({...r,name:r.id,health_certificate_expires_on:r.primary_driver_health_expires_on})),filters:{search:'',companyId:''},sort:'name',companyById:new Map()};
const adminCtx=vm.createContext({state:adminState,renderList:()=>{},compareHealthDates:(a,b)=>compareHealthDates(a,b,today)});
const adminStart=admin.indexOf('    function applyAndRender()');
vm.runInContext(admin.slice(adminStart,admin.indexOf('    function renderList()',adminStart)),adminCtx);
adminCtx.applyAndRender();
assert.equal(adminState.filtered[0].id,'earlier');
assert.equal(adminState.filtered[1].id,'soon');
console.log('Health expiry calendar boundaries, priority, secondary drivers and filtered sorting passed');
