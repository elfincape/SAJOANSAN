import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateDroppedFiles,uploadCards,dropTarget,installFileDrops} from '../repo-root/js/file-drop.js';
import {mountDriverDocuments} from '../repo-root/js/driver-documents.js';
class Element {
 constructor(tag,attrs={}){this.tagName=tag;this.attrs=attrs;this.children=[];this.parentElement=null;this.events={};this.id=attrs.id||'';this.type=attrs.type||'';this.accept=attrs.accept||'';this.multiple='multiple' in attrs;this.disabled='disabled' in attrs;this.className=attrs.class||'';this.classList={add:x=>{this.className+=' '+x;},remove:x=>{this.className=this.className.split(' ').filter(c=>c!==x).join(' ');}};}
 append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}
 replaceChildren(){this.children=[];}
 setAttribute(k,v){this.attrs[k]=v;}
 addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
 dispatchEvent(e){e.target=this;for(const fn of this.events[e.type]||[])this.lastPromise=fn(e);return true;}
 contains(n){return n===this||this.children.some(c=>c.contains(n));}
 matches(selector){return selector.split(',').some(s=>{
  s=s.trim();
  if(s===':disabled')return this.disabled||(this.parentElement?.tagName==='fieldset'&&this.parentElement.disabled)||!!this.parentElement?.matches(':disabled');
  if(s==='input[type="file"]')return this.tagName==='input'&&this.type==='file';
  if(s.startsWith('#'))return this.id===s.slice(1);
  if(s.startsWith('.'))return this.className.split(' ').includes(s.slice(1));
  if(s.startsWith('['))return s.slice(1,-1) in this.attrs;
  return this.tagName===s;
 });}
 closest(s){return this.matches(s)?this:this.parentElement?.closest(s)||null;}
 querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
}
function documentFor(root){
 return {body:root,documentElement:root,createElement:tag=>new Element(tag),querySelectorAll:s=>root.querySelectorAll(s),getElementById:id=>root.querySelector('#'+id)};
}
function parseHtml(html){
 const root=new Element('body'),stack=[root];
 const clean=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
 for(const token of clean.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)){
  const [,closing,tag0,raw]=token,tag=tag0.toLowerCase();
  if(closing){const i=stack.findLastIndex(n=>n.tagName===tag);if(i>0)stack.length=i;continue;}
  const attrs={};for(const m of raw.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[m[1]]=m[2]??m[3]??m[4]??'';
  const node=new Element(tag,attrs);stack.at(-1).append(node);
  if(!['input','img','meta','link','br','hr','source'].includes(tag)&&!raw.endsWith('/'))stack.push(node);
 }
 return documentFor(root);
}
let inventory=0;
for(const name of fs.readdirSync(new URL('../repo-root/admin/',import.meta.url)).filter(n=>n.endsWith('.html'))){
 const html=fs.readFileSync(new URL('../repo-root/admin/'+name,import.meta.url),'utf8'),doc=parseHtml(html);
 for(const input of doc.querySelectorAll('input[type="file"]')){
  inventory++;
  const cards=uploadCards(input,doc);assert(cards.length,name+': missing upload card');
  for(const card of cards){
   assert.equal(dropTarget(card,doc)?.input,input,name+': card must route only to its own input');
   assert(card!==doc.body&&card.tagName!=='main'&&card.tagName!=='form',name+': upload must not cover page/form');
  }
 }
 assert.equal(dropTarget(doc.body,doc),null,name+': page background must not upload');
}
assert(inventory>=19);
const jpg={name:'a.JPG',type:'image/jpeg'},png={name:'b.png',type:''};
assert.equal(validateDroppedFiles([jpg,png],{accept:'image/*',multiple:true}).length,2);
assert.throws(()=>validateDroppedFiles([jpg,png],{accept:'image/*',multiple:false}),/한 개씩/);
assert.throws(()=>validateDroppedFiles([{name:'x.exe',type:''}],{accept:'.xlsx',multiple:true}),/파일 형식/);
assert.equal(validateDroppedFiles([{name:'A.XLSX',type:''}],{accept:'.xlsx,.xls'}).length,1);
assert.equal(validateDroppedFiles([{name:'whatever.bin',type:''}],{accept:''}).length,1);
assert.throws(()=>validateDroppedFiles([],{multiple:true}),/폴더/);
const body=new Element('body'),left=new Element('article'),right=new Element('article'),gap=new Element('div');
const a=new Element('input',{type:'file',accept:'.xlsx'}),b=new Element('input',{type:'file',accept:'image/*',multiple:''});
body.append(left,right,gap);left.append(a);right.append(b);const doc=documentFor(body),handlers={};
const win={addEventListener:(k,fn)=>(handlers[k]??=[]).push(fn),Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}},DataTransfer:class{constructor(){this.files=[];this.items={add:f=>this.files.push(f)};}}};
installFileDrops(doc,win);
const drop=(target,files,types=['Files'])=>{
 const e={target,dataTransfer:{files,types},preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
 for(const fn of handlers.drop)fn(e);return e;
};
let changesA=0,changesB=0;a.addEventListener('change',()=>changesA++);b.addEventListener('change',()=>changesB++);
const batch=Array.from({length:12},(_,i)=>({...jpg,name:i+'.jpg'}));
const event=drop(right,batch);assert(event.prevented&&event.stopped,'legacy drop listeners must not upload twice');
assert.equal(b.files.length,12);assert.equal(changesB,1);assert.equal(changesA,0);
drop(left,[{name:'book.xlsx',type:''}]);assert.equal(changesA,1);assert.equal(changesB,1);
drop(gap,batch);assert.equal(changesB,1);
drop(left,[{name:'one.xlsx'},{name:'two.xlsx'}]);assert.equal(changesA,1);
b.disabled=true;drop(right,batch);assert.equal(changesB,1);b.disabled=false;
const text=drop(right,[],['text/plain']);assert(!text.stopped&&!text.prevented,'ordinary row/text dragging is unaffected');
const fieldset=new Element('fieldset',{disabled:''}),third=new Element('article'),c=new Element('input',{type:'file'});
fieldset.append(third);third.append(c);body.append(fieldset);drop(third,[jpg]);assert(!c.files,'disabled fieldsets must remain disabled');
// Exercise actual driver/company document multi-upload handlers through the common drop bridge.
globalThis.document=doc;globalThis.window=win;
URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=()=>{};
for(const companyMode of [false,true]){
 const host=new Element('div');body.append(host);const saved=[],rows=[];
 mountDriverDocuments(host,{companyMode,adapter:{
  status:async()=>({connected:true}),list:async()=>rows,
  upload:async data=>{saved.push(data);rows.push({id:data.requestId,document_type:data.kind,request_id:data.requestId,uploaded_at:'2026-09-23'});}
 }}).reset(companyMode?'company':'driver');
 for(let n=0;n<20;n++)await Promise.resolve();
 const inputs=host.querySelectorAll('input[type="file"]');
 for(const index of [1,3]){
  const input=inputs[index],card=uploadCards(input,doc)[0];
  drop(card,batch.map(f=>({...f,size:10})));await input.lastPromise;
  assert.equal(saved.filter(r=>r.kind===(index===1?'food_transport_back':'livestock_transport_back')).length,12);
 }
 assert(saved.every(r=>r.driverId===(companyMode?'company':'driver')));
}
console.log('File drops: '+inventory+' static inputs, card isolation, 12-image food/livestock backs for drivers and companies, formats, disabled states and no duplicate legacy dispatch passed');
