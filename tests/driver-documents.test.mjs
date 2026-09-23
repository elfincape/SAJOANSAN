import assert from 'node:assert/strict';
import { DOCUMENT_TYPES, validateDocumentFile, mountDriverDocuments } from '../repo-root/js/driver-documents.js';
assert.equal(DOCUMENT_TYPES.length,8);
for(const type of ['image/jpeg','image/png','image/webp'])validateDocumentFile({type,size:100});
for(const file of [{type:'image/svg+xml',size:100},{type:'image/jpeg',size:10485761},{type:'image/jpeg',size:0}])assert.throws(()=>validateDocumentFile(file));
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.events={};}
 append(...items){this.children.push(...items);}
 replaceChildren(){this.children=[];}
 addEventListener(name,fn){this.events[name]=fn;}
 setAttribute(name,value){this[name]=value;}
}
globalThis.document={createElement:tag=>new Element(tag)};
const events={};globalThis.window={addEventListener:(name,fn)=>events[name]=fn,confirm:()=>true};
let url=0;const revoked=[];
URL.createObjectURL=()=> 'blob:'+ ++url;URL.revokeObjectURL=value=>revoked.push(value);
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const walk=node=>[node,...node.children.flatMap(walk)];
const host=new Element('main');
let rows=[{id:'front',document_type:'food_transport',request_id:'v1',uploaded_at:'2026-09-23'}],expiry='',failure=false;
const calls=[],removes=[],downloads=[],replaces=[];
const adapter={
 status:async()=>({connected:true}),list:async()=>rows,
 upload:async data=>{
  calls.push(data);if(failure)throw Error('저장 오류');
  rows.push({id:data.requestId,document_type:data.kind,request_id:data.requestId,page_number:rows.length,uploaded_at:'2026-09-23'});
 },
 download:async(...args)=>{downloads.push(args);return new Blob(['photo']);},
 remove:async(...args)=>{removes.push(args);rows=rows.filter(r=>r.id!==args[3]);},
 replaceCompany:async(...args)=>{replaces.push(args);return {count:4};},
 compilePdf:async()=>({fileName:'all.pdf'})
};
const panel=mountDriverDocuments(host,{adapter,getExpiry:()=>expiry});
panel.reset('driver');await flush();
const all=()=>walk(host),input=kind=>all().filter(n=>n.tag==='input')[DOCUMENT_TYPES.findIndex(([k])=>k===kind)];
const buttons=text=>all().filter(n=>n.tag==='button'&&n.textContent===text);
assert.equal(input('food_transport').multiple,false);assert.equal(input('food_transport_back').multiple,true);
assert.equal(buttons('운수사 대체').length,2);
assert.equal(buttons('인허가 PDF 저장')[0].disabled,false,'one saved photo is sufficient');
await buttons('저장 사진 보기')[0].events.click();
const imgs=all().filter(n=>n.tag==='img');assert.equal(imgs.length,2);assert.equal(imgs[0].src,imgs[1].src);assert.match(imgs[1].className,/zoom/);
const back=input('food_transport_back');
back.files=Array.from({length:12},()=>({name:'back.jpg',type:'image/jpeg',size:100}));
await back.events.change();
assert.equal(calls.length,12);assert.equal(new Set(calls.map(c=>c.requestId)).size,12);
assert.equal(buttons('사진 삭제').length,13);
await buttons('사진 삭제')[5].events.click();
assert.equal(removes[0][3],calls[4].requestId,'delete targets an individual back page');
assert.equal(rows.length,12);
const health=input('health_certificate');health.files=[{name:'health.jpg',type:'image/jpeg',size:100}];
await health.events.change();assert.equal(calls.length,12);assert.match(all().find(n=>n.role==='status').textContent,/만료일/);
expiry='2027-01-01';await health.events.change();assert.equal(calls.length,13);
await buttons('운수사 대체')[0].events.click();assert.deepEqual(replaces,[['driver','food_transport']]);
failure=true;back.files=[{name:'bad.jpg',type:'image/jpeg',size:100}];await back.events.change();
assert.match(all().find(n=>n.role==='status').textContent,/저장 실패/);
failure=false;
let release;adapter.upload=async()=>new Promise(resolve=>release=resolve);
back.files=[{name:'slow.jpg',type:'image/jpeg',size:100}];const task=back.events.change();await flush();
let blocked=false;events.beforeunload({preventDefault(){blocked=true;}});assert(blocked);
panel.reset('other-driver');await flush();assert.equal(input('food_transport_back').disabled,true);
release();await task;assert.equal(input('food_transport_back').disabled,false);
assert(revoked.length>0);
const companyHost=new Element('main');
mountDriverDocuments(companyHost,{adapter,companyMode:true}).reset('company');await flush();
const companyNodes=walk(companyHost);
assert.equal(companyNodes.filter(n=>n.tag==='input').length,4);
assert.equal(companyNodes.filter(n=>n.tag==='input'&&n.multiple).length,2);
assert(!companyNodes.some(n=>n.textContent==='운수사 대체'||n.textContent==='인허가 PDF 저장'));
console.log('Document UI: multi-page upload, per-page deletion, hover preview, replacement, partial failure, expiry and owner switching passed');
