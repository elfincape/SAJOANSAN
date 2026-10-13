import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createRegistrationView} from '../repo-root/js/portal-registration.js';
import {renderSurveyFields} from '../repo-root/js/portal-survey-fields.js';
const require=createRequire(process.env.PORTAL_TEST_MODULE_ROOT?process.env.PORTAL_TEST_MODULE_ROOT+'/package.json':import.meta.url);
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="items"></div><div id="actions"></div><form id="survey-form"></form>');
globalThis.document=dom.window.document;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,click,parent,cls)=>{const e=node('button',text,cls);e.type='button';e.onclick=click;parent.append(e);return e;};
const field=(form,title,name,value='',type='text')=>{const wrap=node('label',title),input=node(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=name;input.value=value;wrap.append(input);form.append(wrap);return input;};
let tab='templates',editable=true,created,selected,retired,deleted;
const items=document.getElementById('items'),actions=document.getElementById('actions');
let center='001';
const render=createRegistrationView({node,button,canWrite:(code,resource)=>code===center&&resource==='forms'&&editable,centerName:c=>c,
 addRow:(survey,type,parent)=>button(survey.title,()=>{selected=survey.id;},parent),
 customizeTask:t=>{created=t?.id??'template';},surveyForm:()=>{created='survey';},retire:t=>{retired=t.id;},deleteSurvey:s=>{deleted=s.id;},
 onTabChange:value=>{tab=value;draw();}
});
const draw=()=>{
 items.replaceChildren();actions.replaceChildren();
 return render({tab,center,templates:[
 {id:'current',family_id:'f',version:2,status:'approved',created_at:'2020-01-01T00:00:00Z',title:'등록 업무',spec:{ui_cadence:'daily',fields:[]}},
 {id:'old',family_id:'f',version:1,status:'approved',created_at:'2020-01-01T00:00:00Z',title:'과거 업무',spec:{fields:[]}}
 ],surveys:[{id:'survey',title:'조사 내용',center_code:center,stage:'submitted'}],items,actions});
};
for(center of ['001','002','gimhae','yangsan']){
 tab='templates';let meta=draw();assert.equal(meta.count,1);assert(items.textContent.includes('등록 업무'));assert(!items.textContent.includes('조사 내용'));assert(!items.textContent.includes('과거 업무'));
 assert(actions.textContent.includes('센터 업무등록'));assert(!actions.textContent.includes('업무조사 등록'));
 [...actions.querySelectorAll('button')].find(e=>e.textContent==='센터 업무등록').click();assert.equal(created,'template');
 [...items.querySelectorAll('button')].find(e=>e.textContent==='수정').click();assert.equal(created,'current');
 [...items.querySelectorAll('button')].find(e=>e.textContent==='삭제').click();assert.equal(retired,'current');
 document.getElementById('registration-tab-surveys').click();
 assert(items.textContent.includes('조사 내용'));assert(!items.textContent.includes('등록 업무'));
 document.querySelector('[aria-label="조사 내용 업무조사 삭제"]').click();assert.equal(deleted,'survey');
 assert(actions.textContent.includes('업무조사 등록'));assert(!actions.textContent.includes('센터 업무등록'));assert.equal(items.getAttribute('aria-labelledby'),'registration-tab-surveys');
 [...actions.querySelectorAll('button')].find(e=>e.textContent==='업무조사 등록').click();assert.equal(created,'survey');
 document.getElementById('registration-tab-surveys').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
 assert.equal(tab,'templates');assert.equal(document.activeElement.id,'registration-tab-templates');
 editable=false;draw();assert(!actions.textContent.includes('센터 업무등록'));assert(!items.querySelector('.registered-task-actions button'));
 tab='surveys';draw();assert(!actions.textContent.includes('업무조사 등록'));assert(!items.querySelector('.registered-task-delete'));editable=true;
 const form=document.getElementById('survey-form');form.replaceChildren();
 const inputs=renderSurveyFields({form,survey:{details:{systems:'삭제 대상',files:'기존.xlsx',sequence:'업무 순서'}},node,field});
 assert.equal(form.querySelectorAll('input[type=file]').length,1);assert.equal(inputs.files.name,'survey_attachments');assert(inputs.files.multiple);assert.equal(inputs.files.closest('label').firstChild.textContent,'사용하는 파일');
 assert(!form.elements.systems);assert(!form.elements.files);assert(!form.textContent.includes('사용하는 시스템'));
 Object.defineProperty(inputs.files,'files',{value:[new dom.window.File(['file'],'운영.xlsx'),new dom.window.File(['photo'],'사진.png',{type:'image/png'})]});
 const details=inputs.details();assert.equal(details.sequence,'업무 순서');assert.equal(details.files,'기존.xlsx\n운영.xlsx\n사진.png');assert(!('systems' in details));assert(!details.files.includes('fakepath'));
}
const screen=fs.readFileSync(new URL('../repo-root/js/portal-screen.js',import.meta.url),'utf8');
assert(screen.includes('details:surveyInputs.details()'));
assert(screen.includes("operationsFiles.upload({kind:'survey',subjectId:savedSurvey.id"));
assert(screen.includes("attachments('survey',survey,filesWrapper,{allowUpload:false})"));
assert(!screen.includes("archive.append(node('summary','업무조사"));
console.log('All four centers: separate lists, matching create/edit/delete actions, keyboard tabs, readonly permissions, actual file input and removed systems field passed');
