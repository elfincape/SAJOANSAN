import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadUnassignedDeliveryPoints, unassignedDashboardRow } from '../repo-root/js/unassigned-delivery-points.js';

const points = Array.from({length: 1101}, (_, i) => ({id: String(i), center_code: '002', code: 'P'+i, name: '납품처'+i}));
points.push({id:'foreign',center_code:'001'});
const assignments = [{id: 's1', delivery_point_id: '0'}, {id:'s2', delivery_point_id:'1'}];
const calls = [];
const client = {from(table) {
  const filters = [];
  return {
    select() { return this; }, order() { return this; },
    eq(key, value) { filters.push([key,value]); return this; },
    async range(start, end) {
      calls.push({table, filters, start});
      // Simulate a server row cap lower than the requested page size.
      const rows = table === 'delivery_points' ? points : assignments;
      return {data:rows.slice(start, Math.min(end+1,start+200)),error:null};
    }
  };
}};
const missing = await loadUnassignedDeliveryPoints(client,{code:'002'});
assert.equal(missing.length,1099);
assert.equal(missing.at(-1).id,'1100');
assert(!missing.some(p => ['0','1','foreign'].includes(p.id)));
assert(calls.every(c => c.filters.some(([k,v]) => k === (c.table === 'route_stops' ? 'route.center_code' : 'center_code') && v === '002')));
await assert.rejects(loadUnassignedDeliveryPoints({from(){return {select(){return this;},eq(){return this;},order(){return this;},range(){return {error:new Error('read failed')}}}}},{code:'002'}),/read failed/);
const point={id:'p',center_code:'002',code:'P',name:'미지정',address:'주소',memo:'메모',deadline_business_min:600,allow_under_1ton:true};
const row=unassignedDashboardRow(point);
assert.equal(row.route_id,null);
assert.equal(row.route_name,'코스 미지정');
assert.equal(row.stop_id,'unassigned:p');
assert.equal(row.delivery_point_id,'p');
assert.equal(row.effective_deadline_business_min,600);

const html=readFileSync(new URL('../repo-root/admin/export.html',import.meta.url),'utf8');
const context=vm.createContext({bizMinToStandard: value => String(value)});
for(const name of ['normalizeDeliveryMethod','normalizeAccessMethod','normalizeDeliveryLocation','sanitizeMemoForExport','rowToFlat']){
 const start=html.indexOf('function '+name+'(');
 const end=html.indexOf('\n}',start)+2;
 vm.runInContext(html.slice(start,end),context);
}
const flat=context.rowToFlat({route:null,delivery_point:point});
assert.equal(flat['납품처명'],'미지정');
assert.equal(flat['코드'],'P');
assert.equal(flat['운전자명'],'');
assert.equal(flat['코스명'],'');
assert.equal(flat['주소'],'주소');
assert.equal(flat['비고'],'메모');
assert.equal(flat['납품마감'],'600');
assert.equal(flat['1톤이하'],'O');
console.log('Unassigned points: pagination, center isolation, assignments, errors, dashboard identity and export fields passed');
