import assert from 'node:assert/strict';
import {orderTasks,dispatchWarning,currentTemplates,collectInputs} from '../repo-root/js/portal-model.js';
const now=new Date('2026-10-11T00:00:00Z');
const base={status:'pending',owner_id:'me',work_date:'2026-10-11',created_at:'2026-10-01T00:00:00Z'};
const tasks=[{...base,id:'complete',status:'completed'},{...base,id:'future',work_date:'2026-10-12'},
 {...base,id:'today'},{...base,id:'handoff'},{...base,id:'urgent',due_at:'2026-10-11T00:30:00Z'},
 {...base,id:'shared',work_date:'2026-10-12',cj_share_due_at:'2026-10-10T00:00:00Z',inputs:{cj_shared:true}}];
assert.deepEqual(orderTasks(tasks,{userId:'me',today:'2026-10-11',now,handedOff:new Set(['handoff'])}).map(t=>t.id),['urgent','handoff','today','future','shared','complete']);
assert.equal(dispatchWarning({...base,cj_share_due_at:'2026-10-11T01:00:00Z'},now),'공유 마감 1시간 이내 · 배송팀 지원 필요');
assert.equal(dispatchWarning({...base,cj_share_due_at:'2026-10-11T03:00:00Z'},now),'공유 마감 3시간 이내');
assert.equal(dispatchWarning({...base,cj_share_due_at:'2026-10-10T23:59:00Z'},now),'공유 마감 지연');
assert.equal(dispatchWarning({...base,cj_share_due_at:'2026-10-10T23:59:00Z',inputs:{cj_shared:true}},now),'');
const templates=[{id:'a',family_id:'family',version:1,status:'approved',spec:{effective_from:'2026-10-10'}},{id:'b',family_id:'family',version:2,status:'retired',spec:{effective_from:'2026-10-11'}}];
assert.equal(currentTemplates(templates,'2026-10-10')[0].id,'a');assert.equal(currentTemplates(templates,'2026-10-11').length,0);
const task={inputs:{unknown:'preserve',steps:{check:'completed'},amount:42},template_snapshot:{spec:{fields:[{key:'amount',type:'number',label:'금액'},{key:'confirmed',type:'boolean'}]}}};
const elements={field_amount:{value:'0'},field_confirmed:{checked:false},work_note:{value:'실제 조치'}};
const form={elements:{namedItem:name=>elements[name]}};
assert.deepEqual(collectInputs(task,form),{unknown:'preserve',steps:{check:'completed'},amount:0,confirmed:false,work_note:'실제 조치'});
elements.field_amount.value='';assert.equal('amount' in collectInputs(task,form),false);
elements.field_amount.value='invalid';assert.throws(()=>collectInputs(task,form),/금액/);
console.log('PASS: priority order, sharing deadline boundaries, retired version isolation, typed inputs and hidden value preservation');
