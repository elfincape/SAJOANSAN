import assert from 'node:assert/strict';
import {compileCenterPdfs} from '../repo-root/js/driver-pdf.js';
const drivers=['one','empty','bad','last'].map(id=>({id,name:id}));
let active=0,highest=0;
const calls=[],updates=[];
const adapter={compilePdf:async(id,progress,options)=>{
  calls.push([id,options]);active++;highest=Math.max(highest,active);
  try {
    progress('사진 취합');await Promise.resolve();
    if(id==='empty')throw Object.assign(new Error('사진 없음'),{code:'NO_DOCUMENTS'});
    if(id==='bad')throw new Error('OneDrive 저장 실패');
    return {saved:true,fileName:id+'.pdf'};
  } finally {active--;}
}};
const report=await compileCenterPdfs(adapter,drivers,{includeCompany:false,onProgress:row=>updates.push(row)});
assert.equal(highest,1);
assert.deepEqual(calls.map(([id])=>id),drivers.map(d=>d.id));
assert(calls.every(([,options])=>options.includeCompany===false));
assert.deepEqual(report.results.map(r=>r.status),['saved','skipped','failed','saved']);
assert.equal(report.stopped,false);assert.equal(report.total,4);
assert.equal(updates.at(-1).results.length,4);
calls.length=0;let stop=false;
const cancelled=await compileCenterPdfs(adapter,drivers,{shouldStop:()=>stop,onProgress:r=>{if(r.results.length===1)stop=true;}});
assert.equal(cancelled.stopped,true);assert.equal(calls.length,1);
assert.equal(calls[0][1].includeCompany,true);
const unverified=await compileCenterPdfs({compilePdf:async()=>({})},[drivers[0]]);
assert.equal(unverified.results[0].status,'failed');
console.log('Center PDF: individual saves, sequential processing, partial failures, empty documents, filename option and stopping passed');
