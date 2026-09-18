import assert from 'node:assert/strict';
import { DOCUMENT_TYPES, validateDocumentFile, mountDriverDocuments } from '../repo-root/js/driver-documents.js';
assert.equal(DOCUMENT_TYPES.length,8);
assert.equal(new Set(DOCUMENT_TYPES.map(x=>x[0])).size,8);
for(const type of ['image/jpeg','image/png','image/webp'])validateDocumentFile({type,size:100});
for(const file of [{type:'image/svg+xml',size:100},{type:'image/jpeg',size:10485761},{type:'image/jpeg',size:0}])assert.throws(()=>validateDocumentFile(file));
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.events={};}
 append(...items){this.children.push(...items);}
 replaceChildren(){this.children=[];}
 addEventListener(name,fn){this.events[name]=fn;}
 removeAttribute(name){delete this[name];}
 setAttribute(name,value){this[name]=value;}
}
globalThis.document={createElement:tag=>new Element(tag)};
const windowEvents={};
globalThis.window={addEventListener(name,fn){windowEvents[name]=fn;}};
const revoked=[];
URL.createObjectURL=()=> 'blob:preview';
URL.revokeObjectURL=url=>revoked.push(url);
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const host=new Element('div');
const calls=[],saved=[];
let complete,expiry='2027-01-01',failure=false;
const adapter={
 status:async()=>({connected:true}),
 list:async()=>[{document_type:'food_transport',uploaded_at:'2026-09-18T00:00:00Z'}],
 upload:async data=>{calls.push(data);if(failure)throw Error('DB error');await new Promise(resolve=>{complete=resolve;});},
 download:async()=>new Blob(['image'])
};
const panel=mountDriverDocuments(host,{adapter,getExpiry:()=>expiry,onSaved:(...args)=>saved.push(args)});
panel.reset('driver-a');await flush();
const boxes=()=>host.children.filter(el=>el.tag==='div');
const parts=index=>{const box=boxes()[index];return {input:box.children[0].children[0],preview:box.children[1],detail:box.children[2],status:box.children[3],view:box.children[4]};};
assert.equal(boxes().length,8);
assert.equal(parts(0).status.textContent,'DB저장됨');
assert.equal(parts(0).status.tag,'span','save status must not be an upload button');
assert.equal(parts(0).view.disabled,false);
const select=slot=>{slot.input.files=[{name:'photo.jpg',type:'image/jpeg',size:100}];return slot.input.events.change();};
const first=parts(0),second=parts(1);
const firstTask=select(first);
assert.equal(first.status.textContent,'저장중');
assert.equal(first.input.disabled,true);
const secondTask=select(second);
assert.equal(second.status.textContent,'저장중');
await flush();assert.equal(calls.length,1,'uploads must serialize without another click');
let prevented=false;windowEvents.beforeunload({preventDefault(){prevented=true;}});assert(prevented);
complete();await firstTask;await flush();
assert.equal(first.status.textContent,'DB저장됨');
assert.equal(calls.length,2);
assert.equal(calls[0].kind,'food_transport');assert.equal(calls[1].kind,'food_transport_back');
complete();await secondTask;
assert.equal(second.status.textContent,'DB저장됨');
assert.equal(saved.length,2);
assert.notEqual(calls[0].requestId,calls[1].requestId);
expiry='';const health=parts(7);await select(health);assert.equal(health.status.textContent,'저장실패');assert.equal(calls.length,2);
expiry='2027-03-04';failure=true;
await select(health);assert.equal(health.status.textContent,'저장실패');assert.match(health.detail.textContent,/DB error/);
failure=false;const healthTask=select(health);await flush();assert.equal(calls.at(-1).expiresOn,'2027-03-04');
panel.reset('driver-b');await flush();complete();await healthTask;
assert.equal(saved.at(-1)[0],'driver-a','switching drivers must not change queued upload target');
assert(!parts(7).status.textContent,'old driver completion must not mark new driver saved');
assert(revoked.includes('blob:preview'));
panel.reset(null);assert.equal(boxes().length,0);
const offline=mountDriverDocuments(host);offline.reset('driver-a');
await select(parts(0));assert.equal(parts(0).status.textContent,'저장실패');
console.log('Eight slots, automatic save, serialized front/back uploads, status, expiry, failure and driver-switch tests passed');
