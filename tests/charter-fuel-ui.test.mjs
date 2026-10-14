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
assert.equal(document.querySelectorAll('#results tbody tr.fuel-leg').length,3);assert.equal(document.querySelectorAll('#averages tbody tr').length,2);
assert.equal(document.querySelectorAll('#results tbody tr.fuel-group').length,2);assert.equal(document.querySelectorAll('#results tbody tr.fuel-total').length,2);
assert(document.querySelectorAll('#results tbody tr.fuel-leg')[1].textContent.includes('거래처 A · 평택 주소 A'));
assert(!document.querySelector('#results').textContent.includes('PRIVATE'));assert(document.getElementById('metrics').textContent.includes('24,750'));
assert(document.getElementById('issue-list').textContent.includes('빈 주소'));
await document.getElementById('calculate').onclick();assert.equal(calls.length,2);assert.equal(document.querySelectorAll('#results tbody tr.fuel-leg').length,3);
await document.getElementById('export').onclick();assert.equal(written.sheets.length,4);assert(!JSON.stringify(written).includes('PRIVATE'));assert.equal(written.sheets[0].rows[1].at(-1),5964);
document.querySelector('[data-efficiency="1"]').value='10';document.querySelector('[data-efficiency="1"]').dispatchEvent(new dom.window.Event('change'));
assert.equal(document.querySelectorAll('#results tbody tr.fuel-leg').length,0);await document.getElementById('calculate').onclick();assert(document.getElementById('results').textContent.includes('4,950'));
document.getElementById('origin-address').value='새 출발지';document.getElementById('origin-address').dispatchEvent(new dom.window.Event('change'));assert.equal(document.querySelectorAll('#results tbody tr.fuel-leg').length,0);
let finish;context.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return new Promise(resolve=>{finish=()=>resolve(new Response(JSON.stringify({sections:[{distanceMeters:30000},{distanceMeters:53000}]})));});};
const calculating=document.getElementById('calculate').onclick();await new Promise(r=>setTimeout(r,10));document.getElementById('cancel').onclick();finish();await calculating;
assert.equal(document.querySelectorAll('#averages tbody tr').length,1);assert(document.getElementById('status').textContent.includes('미측정 2운행'));
document.getElementById('from-date').value='2026-10-02';document.getElementById('from-date').dispatchEvent(new dom.window.Event('change'));assert(document.getElementById('calculate').disabled);assert(document.getElementById('export').disabled);
// Same tonnage does not combine distinct DB trips. Every trip uses its full, variable-length route.
context.loadFuelTrips=async()=>[1,3,5].map((count,i)=>({id:'variable-'+i,date:'2026-10-13',tons:1,deliveries:Array.from({length:count},(_,j)=>({id:'d'+j,stopId:'H'+j,name:'묶음'+i+' 착지'+j,address:'주소 '+i+'-'+j}))}));
calls=[];context.fetch=async(url,init)=>{const body=JSON.parse(init.body);calls.push(body);return new Response(JSON.stringify({sections:body.stops.map((_,i)=>({distanceMeters:(i+1)*1000}))}));};
await document.getElementById('load-db').onclick();await document.getElementById('calculate').onclick();
assert.deepEqual(calls.map(c=>c.stops.length),[1,3,5]);assert.equal(calls.length,3);
assert.equal(document.querySelectorAll('#results tbody tr.fuel-group').length,3);assert.equal(document.querySelectorAll('#results tbody tr.fuel-leg').length,9);
assert.deepEqual([...document.querySelectorAll('#results tbody tr.fuel-total')].map(tr=>tr.children[5].textContent),['1','6','15']);
assert(document.querySelectorAll('#results tbody tr.fuel-leg')[3].textContent.includes('묶음1 착지1 · 주소 1-1'));
assert.equal(document.querySelector('#averages tbody tr').children[1].textContent,'3');
await document.getElementById('export').onclick();assert.equal(written.sheets[1].name,'묶음별 합계');assert.deepEqual(Array.from(written.sheets[1].rows.slice(1),r=>r[3]),[1,3,5]);
document.getElementById('route-provider').value='naver';document.getElementById('route-provider').dispatchEvent(new dom.window.Event('change'));
assert.equal(document.querySelectorAll('#results tbody tr.fuel-leg').length,0);assert.equal(document.getElementById('route-priority').value,'RECOMMEND');assert(document.querySelector('#route-priority [value=DISTANCE]').hidden);
context.fetch=async(url,init)=>{assert(url.endsWith('/naver-distance'));const body=JSON.parse(init.body);assert.equal(body.priority,'RECOMMEND');return new Response(JSON.stringify({sections:body.stops.map(()=>({distanceMeters:1000}))}));};
await document.getElementById('calculate').onclick();assert.equal(document.querySelectorAll('#results tbody tr.fuel-group').length,3);
await document.getElementById('export').onclick();assert.equal(written.sheets.at(-1).rows[1].at(-1),'네이버');
assert.equal(JSON.parse(dom.window.localStorage.getItem('sajo.charter.fuel.tester')).provider,'naver');
document.getElementById('route-provider').value='kakao';document.getElementById('route-provider').dispatchEvent(new dom.window.Event('change'));assert(!document.querySelector('#route-priority [value=DISTANCE]').hidden);
console.log('DB-only source, defaults, minimal grouped results, averages, resume, cancel, provider switching, invalidation and private-free workbook passed');
