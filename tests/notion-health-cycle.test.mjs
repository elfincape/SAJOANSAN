import test from 'node:test';
import assert from 'node:assert/strict';
import { syncManagementTargets, cycleRequest } from '../scripts/notion-health-cycle.mjs';
const result=(center,fields={})=>({center,processed:6,created:0,updated:6,closed:0,conflicts:0,hasMore:false,...fields});
test('scheduled sync accumulates all cursor batches and respects selected center',async()=>{
  const calls=[];
  const summary=await syncManagementTargets(async(action,body)=>{
    calls.push({action,body});
    return calls.length===1?result('002',{created:2,updated:4,hasMore:true,nextCursor:'driver-6'}):result('002',{processed:1,updated:1});
  },'002');
  assert.deepEqual(calls,[{action:'sync',body:{center:'002',cursor:null}},{action:'sync',body:{center:'002',cursor:'driver-6'}}]);
  assert.equal(summary.processed,7);assert.equal(summary.created,2);assert.equal(summary.updated,5);
});
test('malformed result, wrong center and cursor that does not advance fail instead of declaring success',async()=>{
  for(const data of [result('001'),result('002',{processed:-1}),result('002',{hasMore:true,nextCursor:null})])
    await assert.rejects(()=>syncManagementTargets(async()=>data,'002'));
  let calls=0;
  await assert.rejects(()=>syncManagementTargets(async()=>{calls++;return result('002',{hasMore:true,nextCursor:'same'});},'002'));
  assert.equal(calls,2);
});
test('busy lock retries use identical request without sending duplicate mutation on uncertain failures',async()=>{
  const calls=[],delays=[];
  const output=await cycleRequest(async(url,init)=>{
    calls.push({url,body:JSON.parse(init.body)});
    return new Response(JSON.stringify(calls.length<3?{code:'sync_busy'}:{center:'002'}),{status:calls.length<3?409:200});
  },'https://test/functions/v1/notion-health',{apikey:'server'},'sync',{center:'002',cursor:null},async ms=>delays.push(ms));
  assert.equal(output.center,'002');assert.equal(calls.length,3);assert.deepEqual(delays,[3000,6000]);
  assert.ok(calls.every(c=>c.url.endsWith('/sync')&&c.body.center==='002'&&c.body.cursor===null));
  let attempts=0;
  await assert.rejects(()=>cycleRequest(async()=>{attempts++;return new Response(JSON.stringify({code:'notion_unreachable',uncertainWrite:true}),{status:504});},
    'https://test',{},'sync',{center:'002'},async()=>{}));
  assert.equal(attempts,1);
});
test('busy retry is bounded and unauthorized responses are never retried',async()=>{
  for(const [status,code,expected] of [[409,'sync_busy',5],[401,'unauthorized',1]]) {
    let attempts=0;
    await assert.rejects(()=>cycleRequest(async()=>{attempts++;return new Response(JSON.stringify({code}),{status});},
      'https://test',{},'sync',{center:'002'},async()=>{}));
    assert.equal(attempts,expected);
  }
});
