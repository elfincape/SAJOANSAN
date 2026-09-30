import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validDate,healthBadge,healthStatus,rowHealthDate,prioritizeHealthRows} from '../repo-root/js/driver-health.js';
const source=fs.readFileSync(new URL('../repo-root/js/dashboard.js',import.meta.url),'utf8');
const state={healthAvailable:true,healthPromoted:new Set()};
const context=vm.createContext({state,validDate,healthBadge,healthStatus,rowHealthDate});
for(const name of ['dashboardHealthClass','copyableHealthBadge','renderDriverHealth']){
 const start=source.indexOf('function '+name+'(');
 vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
}
const first={primary_driver_id:'a',primary_driver_health_expires_on:'2020-01-01'};
const other={...first,secondary_driver_id:'b',secondary_driver_health_expires_on:'2020-02-02'};
prioritizeHealthRows([first,{...first}],{},undefined,state.healthPromoted);
assert.equal(context.dashboardHealthClass(first),'health-expired');
assert.equal(context.dashboardHealthClass(other),'');
const html=context.renderDriverHealth(other);
assert.match(html,/2020-01-01/);assert.match(html,/2020-02-02/);
assert(!html.includes('확인 불가'));assert(!html.includes('health-expired'));
assert.match(context.renderDriverHealth(first),/health-expired/);
prioritizeHealthRows([first,other],{search:'기사'},undefined,state.healthPromoted);
assert.equal(context.dashboardHealthClass(first),'');
assert.match(context.renderDriverHealth(first),/2020-01-01/);
assert(!context.renderDriverHealth(first).includes('health-expired'));
state.healthAvailable=false;
assert.equal(context.renderDriverHealth(first),'보건증 확인 불가');
assert.equal(context.renderDriverHealth({}),'');
assert(source.includes('class="${dashboardHealthClass(row)}"'));
assert(source.includes('class="${dashboardHealthClass(s)}"'));
console.log('Dashboard dates preserved; only promoted rows/badges colored in flat and grouped views; filtering and real lookup failure passed');

assert.match(context.copyableHealthBadge('2026-09-30', false),/data-health-date="2026.09.30"/);
assert(!context.copyableHealthBadge(null,false).includes('data-health-date'));
