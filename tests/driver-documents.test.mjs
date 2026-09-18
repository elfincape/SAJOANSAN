import assert from 'node:assert/strict';
import { DOCUMENT_TYPES, validateDocumentFile, mountDriverDocuments } from '../repo-root/js/driver-documents.js';
assert.equal(DOCUMENT_TYPES.length,6);
assert.equal(new Set(DOCUMENT_TYPES.map(x=>x[0])).size,6);
for(const type of ['image/jpeg','image/png','image/webp']) validateDocumentFile({type,size:100});
assert.throws(()=>validateDocumentFile({type:'image/svg+xml',size:100}));
assert.throws(()=>validateDocumentFile({type:'image/jpeg',size:10485761}));
assert.throws(()=>validateDocumentFile({type:'image/jpeg',size:0}));
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.events={};}
 append(...items){this.children.push(...items);}
 replaceChildren(){this.children=[];}
 addEventListener(name,fn){this.events[name]=fn;}
 removeAttribute(name){delete this[name];}
}
globalThis.document={createElement:tag=>new Element(tag)};
globalThis.window={addEventListener(){}};
const revoked=[];
URL.createObjectURL=()=> 'blob:preview';
URL.revokeObjectURL=url=>revoked.push(url);
const host=new Element('div');
const panel=mountDriverDocuments(host);
panel.reset('driver-a');
const boxes=host.children.filter(el=>el.tag==='div');
assert.equal(boxes.length,6);
const box=boxes[0];
const input=box.children[0].children[0], preview=box.children[1], status=box.children[2], button=box.children[3];
input.files=[{name:'photo.jpg',type:'image/jpeg',size:100}];
input.events.change();
assert.equal(preview.src,'blob:preview');
assert.match(status.textContent,/미저장/);
assert.equal(button.disabled,true);
await button.events.click();
assert.doesNotMatch(status.textContent,/저장 완료/);
panel.reset('driver-b');
assert(revoked.includes('blob:preview'));
panel.reset(null);
assert(!host.children.some(el=>el.tag==='div'));
console.log('Six document types, file validation, preview cleanup and disconnected upload guard passed');
