import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as model from '../repo-root/js/charter-fuel-model.js';
const require=createRequire(process.env.PORTAL_TEST_MODULE_ROOT?process.env.PORTAL_TEST_MODULE_ROOT+'/package.json':import.meta.url),{JSDOM}=require('jsdom');
const html=fs.readFileSync(new URL('../repo-root/admin/charter-fuel-estimator.html',import.meta.url),'utf8'),script=fs.readFileSync(new URL('../repo-root/js/charter-fuel-ui.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const dom=new JSDOM(html,{url:'https://sajoansan.vercel.app/admin/charter-fuel-estimator.html?center=pyeongtaek'});
const document=dom.window.document;
const trips=[
 {id:'a',tons:1,driver:'PRIVATE_DRIVER',vehicleNumber:'PRIVATE_PLATE',deliveries:[{id:'a',stopId:'H4',name:'거래처 A',address:'평택 주소 A'},{id:'b',stopId:'H5',name:'거래처 B',address:'평택 주소 B'}]},
 {id:'b',tons:5,deliveries:[{id:'c',stopId:'H9',name:'거래처 C',address:'평택 주소 C'}]},
 {id:'c',tons:2.5,deliveries:[{id:'d',stopId:'H20',name:'빈 주소 거래처',address:''}]}
];
let calls=[],written,loadCalls=0;
const fakeXlsx={utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:rows=>({rows}),book_append_sheet:(wb,sheet,name)=>wb.sheets.push({name,...sheet})},writeFile:wb=>{written=wb;}};
const context={...model,document,location:dom.window.location,localStorage:dom.window.localStorage,requireRole:async()=>({id:'tester',role:'editor'}),supabase:{auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}})}},SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',koreaDate:()=> '2026-10-13',AbortSignal,URL,console,XLSX:fakeXlsx,
 loadFuelTrips:async(client,bounds)=>{loadCalls++;assert.equal(bounds.from,'2026-10-01');return trips;},
 fetch:async(url,init)=>{const b=JSON.parse(init.body);calls.push(b);return new Response(JSON.stringify({sections:b.stops.length===2?[{distanceMeters:30000},{distanceMeters:53000}]:[{distanceMeters:96000}],calculatedAt:'2026-10-13T00:00:00Z'}));}
};
context.globalThis=context;await vm.runInNewContext(script,context);
assert.equal(document.querySelectorAll('input[type=file]').length,0);assert.equal(document.getElementById('origin-address').value,'경기도 평택시 산단로 263');
assert.equal(document.querySelector('[data-efficiency="1"]').value,'8.3');assert.equal(document.querySelector('[data-efficiency="11"]').value,'4');
await document.getElementById('load-db').onclick();assert.equal(loadCalls,1);assert(!document.getElementById('calculate').disabled);
document.getElementById('fuel-price').value='1650';await document.getElementById('calculate').onclick();
assert.equal(calls.length,2);assert.equal(calls[0].center,'002');assert.equal(calls[0].origin,'경기도 평택시 산단로 263');assert.equal(calls[0].stops.length,2);assert(!JSON.stringify(calls).includes('PRIVATE'));
assert.equal(document.querySelectorAll('#results tbody tr').length,3);assert.equal(document.querySelectorAll('#averages tbody tr').length,2);
assert(!document.querySelector('#results').textContent.includes('PRIVATE'));assert(document.getElementById('metrics').textContent.includes('24,750'));
assert(document.getElementById('issue-list').textContent.includes('빈 주소'));
await document.getElementById('calculate').onclick();assert.equal(calls.length,2);assert.equal(document.querySelectorAll('#results tbody tr').length,3);
await document.getElementById('export').onclick();assert.equal(written.sheets.length,3);assert(!JSON.stringify(written).includes('PRIVATE'));assert.equal(written.sheets[0].rows[1].at(-1),5964);
document.querySelector('[data-efficiency="1"]').value='10';document.querySelector('[data-efficiency="1"]').dispatchEvent(new dom.window.Event('change'));
assert.equal(document.querySelectorAll('#results tbody tr').length,0);await document.getElementById('calculate').onclick();assert(document.getElementById('results').textContent.includes('4,950'));
document.getElementById('origin-address').value='새 출발지';document.getElementById('origin-address').dispatchEvent(new dom.window.Event('change'));assert.equal(document.querySelectorAll('#results tbody tr').length,0);
let finish;context.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return new Promise(resolve=>{finish=()=>resolve(new Response(JSON.stringify({sections:[{distanceMeters:30000},{distanceMeters:53000}]})));});};
const calculating=document.getElementById('calculate').onclick();await new Promise(r=>setTimeout(r,10));document.getElementById('cancel').onclick();finish();await calculating;
assert.equal(document.querySelectorAll('#averages tbody tr').length,1);assert(document.getElementById('status').textContent.includes('미측정 2운행'));
document.getElementById('from-date').value='2026-10-02';document.getElementById('from-date').dispatchEvent(new dom.window.Event('change'));assert(document.getElementById('calculate').disabled);assert(document.getElementById('export').disabled);
console.log('DB-only source, user defaults, editable coefficients, minimal completed results, averages, resume, cancel, invalidation and private-free workbook passed');
