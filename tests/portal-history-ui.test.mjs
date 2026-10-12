import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createPortalHistory} from '../repo-root/js/portal-history.js';
import {koreaDate} from '../repo-root/js/operations-view.js';
const require=createRequire(process.env.PORTAL_TEST_MODULE_ROOT?process.env.PORTAL_TEST_MODULE_ROOT+'/package.json':import.meta.url);
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="items"></div><div id="detail"></div><div id="quick-actions"></div><h2 id="list-title"></h2><span id="count"></span>',{url:'https://sajoansan.vercel.app/portal/'});
globalThis.document=dom.window.document;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,click,parent,cls)=>{const e=node('button',text,cls);e.onclick=click;parent.append(e);return e;};
const field=(form,title,name,value,type)=>{const label=node('label',title),input=node('input');input.type=type;input.name=name;input.value=value;label.append(input);form.append(label);return input;};
const day=koreaDate(),base={center_code:'001',work_date:day,created_at:day+'T00:00:00Z',title:'쿠팡 배차'};
const api={
 historyRecords:async()=>({tasks:[{...base,id:'a',status:'in_progress'},{...base,id:'b',status:'completed'},{...base,id:'old',status:'pending',work_date:'2020-01-01'},{...base,id:'private',center_code:'002',status:'pending'}],incidents:[],events:[
 {id:1,task_id:'a',action:'created',occurred_at:day+'T00:00:00Z',report_date:day},
 {id:2,task_id:'a',action:'completed',occurred_at:day+'T01:00:00Z',report_date:day}
 ]}),
 events:async()=>[{id:1,action:'created',occurred_at:day+'T00:00:00Z'},{id:2,action:'file_uploaded',occurred_at:day+'T00:30:00Z'},{id:3,action:'updated',occurred_at:day+'T01:00:00Z',request_body:{data:{note:'물량 수정'}}}]
};
const render=createPortalHistory({api,node,button,field,centerName:c=>c,stamp:x=>x,message:m=>{throw new Error(m);},allowed:(r,a,c)=>c==='001',openRecord:()=>{}});
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
render([{code:'001'},{code:'002'}]);await tick();
assert.equal(document.querySelectorAll('.history-task').length,3);
assert.equal(document.querySelectorAll('.history-record>.badge')[0].textContent,'처리중');
assert(!document.querySelector('#items').textContent.includes('첨부 파일 저장'));
const item=document.querySelector('.history-task');item.open=true;await tick();
assert(item.textContent.includes('업무 등록'));assert(item.textContent.includes('업무 수정'));assert(item.textContent.includes('물량 수정'));
assert(!item.textContent.includes('첨부 파일 저장'));assert.equal(document.querySelector('#detail dd:nth-of-type(2)').textContent,'처리중');
const filter=document.querySelector('[aria-label="처리 기록 상태"]');filter.value='delayed';filter.dispatchEvent(new dom.window.Event('change'));assert.equal(document.querySelectorAll('.history-task').length,1);assert.equal(document.querySelector('.history-record>.badge').textContent,'지연');
filter.value='completed';filter.dispatchEvent(new dom.window.Event('change'));assert.equal(document.querySelectorAll('.history-task').length,1);assert.equal(document.querySelector('.history-record>.badge').textContent,'완료');
let resolveEvents;api.events=()=>new Promise(r=>{resolveEvents=r;});
filter.value='active';filter.dispatchEvent(new dom.window.Event('change'));const stale=document.querySelector('.history-task');stale.open=true;await tick();
render([{code:'001'}]);await tick();resolveEvents([{id:9,action:'updated',occurred_at:day+'T05:00:00Z',request_body:{data:{note:'STALE_RESPONSE'}}}]);await tick();
assert(!document.body.textContent.includes('STALE_RESPONSE'));
console.log('History accordion, current status, filters, file event hiding, center permissions and stale response guards passed');
