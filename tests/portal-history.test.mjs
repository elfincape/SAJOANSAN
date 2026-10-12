import assert from 'node:assert/strict';
import fs from 'node:fs';
import {groupHistory,visibleHistoryEvents} from '../repo-root/js/portal-history-model.js';
import {createOperationsApi} from '../repo-root/js/operations-api.js';
const now=new Date('2026-10-12T03:00:00Z'),from='2026-10-01',through='2026-10-31';
const task=(id,status,date='2026-10-12')=>({id,status,title:'동일 업무명',center_code:'001',work_date:date,work_end_date:date,created_at:date+'T00:00:00Z'});
const events=[
 {id:1,task_id:'a',action:'created',occurred_at:'2026-10-10T00:00:00Z',report_date:'2026-10-10'},
 {id:2,task_id:'a',action:'completed',occurred_at:'2026-10-11T00:00:00Z',report_date:'2026-10-11',status:'completed'},
 {id:3,task_id:'a',action:'file_uploaded',occurred_at:'2026-10-12T00:00:00Z',report_date:'2026-10-12'},
 {id:4,task_id:'a',action:'task_reopened',occurred_at:'2026-10-12T01:00:00Z',report_date:'2026-10-12'}
];
const input={events,tasks:[task('a','in_progress'),task('b','completed'),task('old','pending','2026-09-01'),task('future','pending','2026-11-01'),{...task('other','pending'),center_code:'002'}],incidents:[{id:'i',title:'특이사항',status:'open',center_code:'001',created_at:'2026-09-01T00:00:00Z'}],center:'001',from,through,now};
let rows=groupHistory(input);
assert.equal(rows.filter(r=>r.id==='a').length,1);assert.equal(rows.find(r=>r.id==='a').state,'active');
assert.equal(rows.find(r=>r.id==='a').events.length,3);assert.equal(rows.find(r=>r.id==='old').state,'delayed');
assert(!rows.some(r=>r.id==='future'||r.id==='other'));assert(rows.some(r=>r.id==='b'&&r.state==='completed'));assert(rows.some(r=>r.id==='i'&&r.state==='active'));
assert.deepEqual(groupHistory({...input,status:'delayed'}).map(r=>r.id),['old']);
assert(groupHistory({...input,status:'active'}).every(r=>r.state==='active'));
assert.equal(groupHistory({...input,tasks:[task('a','completed')]}).find(r=>r.id==='a').state,'completed');
assert.equal(groupHistory({...input,tasks:[task('a','not_applicable')]}).find(r=>r.id==='a').state,'not_applicable');
assert.equal(groupHistory({...input,tasks:[{...task('a','pending'),deleted_at:'2026-10-12'}]}).find(r=>r.id==='a').state,'trashed');
assert.equal(visibleHistoryEvents(events).length,3);
const calls=[],outside=task('outside','completed','2026-09-01');
const fixtures={operations_daily_log:[...events,{id:5,task_id:'outside',action:'updated',occurred_at:'2026-10-12T00:00:00Z',report_date:'2026-10-12'}],operations_tasks:[task('a','in_progress')],operations_incidents:[]};
const client={from(table){
 const call={table};calls.push(call);
 const q={select(){return q;},gte(){return q;},lte(){return q;},order(){return q;},eq(){return q;},is(){return q;},or(v){call.or=v;return q;},in(k,values){call.ids=values;return q;},range(start,end){call.range=[start,end];return Promise.resolve({data:(call.ids?[outside].filter(r=>call.ids.includes(r.id)):fixtures[table]).slice(start,end+1)});}};
 return q;
}};
const data=await createOperationsApi(client).historyRecords({center:'001',from,through});
assert(!data.events.some(e=>e.action==='file_uploaded'));assert(data.tasks.some(r=>r.id==='outside'&&r.status==='completed'));
assert(calls.some(c=>c.table==='operations_incidents'&&c.or.includes('2026-10-01T00:00:00+09:00')&&c.or.includes('2026-10-31T15:00:00.000Z')));
assert(calls.some(c=>c.table==='operations_tasks'&&c.ids?.includes('outside')));
const screen=fs.readFileSync(new URL('../repo-root/js/portal-screen.js',import.meta.url),'utf8');
assert(screen.includes("events.filter(e=>e.action!=='file_uploaded')"));
console.log('One row per ID, current states after reopen, old unfinished tasks, period and center filters, hidden file events, KST bounds and canonical lookup passed');
