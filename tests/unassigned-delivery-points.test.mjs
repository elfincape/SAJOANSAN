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

// Exercise the current React domain rather than treating legacy HTML regexes as runtime proof.
const {createRequire}=await import('node:module');
const require=createRequire(import.meta.url),ts=require('../app/node_modules/typescript');
const domainUrls=new Map();
function domainUrl(url) {
 if(domainUrls.has(url.href)) return domainUrls.get(url.href);
 let code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 code=code.replace(/from ['"](\.[^'"]+)['"]/g,(_,relative)=>'from '+JSON.stringify(domainUrl(new URL(relative+'.ts',url))));
 const result='data:text/javascript;base64,'+Buffer.from(code).toString('base64');domainUrls.set(url.href,result);return result;
}
async function domain(file) {return import(domainUrl(new URL('../app/src/domain/'+file,import.meta.url)));}
const {pointToDraft,pointPayload}=await domain('delivery-points.ts');
const original={id:'p',name:'원본',center_code:'002',contact_mobile:'',contact:'다른 연락처',allow_under_1ton:null,allow_over_5ton:false,deadline_text:'',deadline_business_min:0,delivery_method:'',memo:null};
const changedDraft={...pointToDraft(original),name:'이름만 변경'};
const patch=pointPayload(changedDraft,'002',original);
assert.deepEqual(patch,{id:'p',name:'이름만 변경'},'untouched empty/null/false/0 fields are not rewritten');
const currentExport=await domain('course-export.ts');
const shared={...original,delivery_method:'대면',access_method:'보안키',delivery_location:'창고',deadline_text:'12:00',deadline_business_min:720};
const cleared=currentExport.rowToFlat({route:null,delivery_point:shared,condition_modes:{delivery_method:'clear',access_method:'set',deadline:'clear'},override_access_method:''});
assert.equal(cleared['대면'],'');assert.equal(cleared['보안키'],'');assert.equal(cleared['납품마감'],'');
const inherited=currentExport.rowToFlat({route:null,delivery_point:shared,condition_modes:{delivery_method:'inherit',deadline:'inherit'},override_delivery_method:'무인',deadline_text:'14:00',deadline_business_min:840});
assert.equal(inherited['대면'],'O');assert.equal(inherited['무인'],'');assert.equal(inherited['납품마감'],'12:00');
console.log('React point patch and export: unchanged null/empty/0/false, inherit/set/clear passed');
