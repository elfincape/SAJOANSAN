import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import * as model from '../repo-root/js/destination-distance-model.js';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom'),XLSX=require('xlsx'),ExcelJS=require('exceljs');
const dom=new JSDOM(fs.readFileSync(new URL('../repo-root/admin/charter-fuel-estimator.html',import.meta.url),'utf8'),{url:'https://sajoansan.vercel.app/admin/charter-fuel-estimator.html?center=pyeongtaek'}),document=dom.window.document;
const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['고객명','기타','임의 주소명'],['A','무관','주소A'],['B','무관','주소B'],['C','무관','주소A'],['D','무관','#N/A']]),'임의시트');const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
Object.defineProperty(document.getElementById('file'),'files',{value:[{name:'any.xlsx',size:bytes.length,arrayBuffer:async()=>bytes}]});let calls=[],blob;
class TestURL extends URL{static createObjectURL(value){blob=value;return 'blob:test';}static revokeObjectURL(){}}
dom.window.HTMLAnchorElement.prototype.click=function(){};
const context={...model,document,Option:dom.window.Option,URL:TestURL,Blob,AbortSignal,localStorage:dom.window.localStorage,XLSX,ExcelJS,setTimeout:()=>0,requireRole:async()=>({id:'test'}),SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',supabase:{auth:{getSession:async()=>({data:{session:{access_token:'test'}}})}},fetch:async(url,init)=>{const b=JSON.parse(init.body);calls.push(b);assert.equal(b.priority,'MIN_DISTANCE');assert.equal(b.stops.length,1);return new Response(JSON.stringify({sections:[{distanceMeters:b.stops[0].address==='주소A'?10000:20000}],regions:[{region:'수원시',regionKey:'경기|수원'}]}));}};context.globalThis=context;
await vm.runInNewContext(fs.readFileSync(new URL('../repo-root/js/destination-distance-ui.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
assert.equal(document.getElementById('origin').value,'경기도 평택시 산단로 263');assert.equal(document.querySelectorAll('[data-efficiency]').length,5);assert(!document.getElementById('load-db'));
await document.getElementById('file').onchange();document.getElementById('address-column').value='2';document.getElementById('name-column').value='0';document.getElementById('start-row').value='2';await document.getElementById('calculate').onclick();
assert.equal(calls.length,2);assert(calls.every(b=>b.origin==='경기도 평택시 산단로 263'));assert.equal(document.querySelectorAll('#results tbody tr').length,4);assert.equal(document.querySelectorAll('.longest').length,1);assert(document.getElementById('count').textContent.includes('3계산 완료'));assert(document.getElementById('count').textContent.includes('1확인 필요'));
await document.getElementById('download').onclick();assert(blob);const exported=new ExcelJS.Workbook();await exported.xlsx.load(await blob.arrayBuffer());assert.equal(exported.getWorksheet(1).getCell('E3').fill.fgColor.argb,'FFFFEB3B');assert.equal(exported.getWorksheet(1).getCell('C5').value,'');
await document.getElementById('calculate').onclick();assert.equal(calls.length,2);document.getElementById('origin').value='새 출발지';document.getElementById('origin').onchange();assert.equal(document.querySelectorAll('#results tbody tr').length,0);await document.getElementById('calculate').onclick();assert.equal(calls.length,4);
console.log('Upload/sheet/arbitrary address column, independent origin legs, duplicate cache, error blanks, regional yellow distance and all-ton styled download passed');
