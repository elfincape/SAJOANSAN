import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledTick} from '../supabase/functions/notion-health/scheduled.js';
import {makeHandler} from '../supabase/functions/notion-health/handler.js';
const json=x=>new Response(JSON.stringify(x),{status:200});
function harness(initial={phase:'sync',center_code:'001',cursor:null},hooks={}) {
  let state=initial,claimed=false;const calls=[],runs=[];
  const db=async(path,body)=>{
    calls.push([path,body]);
    if(path.endsWith('claim')){claimed=Boolean(state);return state;}
    if(path.endsWith('checkpoint')){
      state={...state,phase:body.p_phase,center_code:body.p_center,cursor:body.p_cursor};
      if(state.phase==='idle')state.last_finished_at='2026-10-09T00:00:00Z';
      return state;
    }
    return null;
  };
  const batch=async(e,k,f,b)=>{runs.push(b);return {hasMore:false,nextCursor:null};};
  return {calls,runs,options:{db,sync:hooks.sync||batch,complete:hooks.complete||batch,...hooks}};
}
test('not due or already leased jobs make no external writes',async()=>{
  const h=harness(null);assert.deepEqual(await scheduledTick({},'',null,h.options),{scheduled:true,running:false});
  assert.equal(h.runs.length,0);assert.equal(h.calls.length,1);
});
test('durable cycle synchronizes then completes each center and marks final completion',async()=>{
  const h=harness();const result=await scheduledTick({},'',null,h.options);
  assert.equal(result.completed,true);assert.equal(result.batches,4);
  assert.deepEqual(h.runs.map(b=>b.center),['001','001','002','002']);
  assert.deepEqual(h.calls.filter(c=>c[0].endsWith('checkpoint')).map(c=>c[1].p_phase),['complete','sync','complete','idle']);
  assert.equal(h.calls.at(-1)[1].p_retry,0);
});
test('batch cursor resumes before advancing center or phase',async()=>{
  let n=0;const h=harness(undefined,{sync:async()=>{
    n++;return n===1?{hasMore:true,nextCursor:'driver-two'}:{hasMore:false,nextCursor:null};
  }});
  await scheduledTick({},'',null,h.options);
  assert.equal(h.calls.filter(c=>c[0].endsWith('checkpoint'))[0][1].p_cursor,'driver-two');
  assert.equal(h.calls.filter(c=>c[0].endsWith('checkpoint'))[0][1].p_phase,'sync');
});
test('time budget leaves durable progress for next cron without falsely completing',async()=>{
  const h=harness({phase:'complete',center_code:'001',cursor:'page-token'},{budgetMs:0});
  const result=await scheduledTick({},'',null,h.options);
  assert.equal(result.running,true);assert.equal(result.completed,undefined);assert.equal(h.runs.length,0);
  assert.equal(h.calls.at(-1)[1].p_retry,0);
});
test('uncertain writes preserve successful cursor and wait before retry',async()=>{
  const h=harness(undefined,{sync:async()=>{throw Object.assign(new Error('do not expose secrets'),{
    code:'notion_unreachable',extra:{uncertainWrite:true,summary:{nextCursor:'saved-driver'}}
  });}});
  await assert.rejects(()=>scheduledTick({},'',null,h.options));
  assert.equal(h.calls.find(c=>c[0].endsWith('checkpoint'))[1].p_cursor,'saved-driver');
  assert.equal(h.calls.find(c=>c[0].endsWith('error'))[1].p_error,'notion_unreachable');
  assert.equal(h.calls.at(-1)[1].p_retry,180);
});
test('stuck cursors fail without falsely advancing progress',async()=>{
  const h=harness({phase:'complete',center_code:'001',cursor:'same'},{
    complete:async()=>({hasMore:true,nextCursor:'same'})});
  await assert.rejects(()=>scheduledTick({},'',null,h.options),e=>e.code==='scheduled_cursor');
  assert.equal(h.calls.some(c=>c[0].endsWith('checkpoint')),false);
  assert.equal(h.calls.at(-1)[1].p_retry,60);
});
test('browser admin cannot invoke internal scheduled worker',async()=>{
  let calls=0;
  const handler=makeHandler({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server'},async()=>{calls++;return json({});});
  const response=await handler(new Request('https://test.supabase.co/functions/v1/notion-health/scheduled',{
    method:'POST',headers:{Authorization:'Bearer user',Origin:'https://sajoansan.vercel.app'},body:'{}'}));
  assert.equal(response.status,403);assert.equal(calls,0);
});
