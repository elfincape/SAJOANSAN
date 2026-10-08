import test from 'node:test';
import assert from 'node:assert/strict';
import { completionBatch, completionStatus, completionCandidate, validateCompletionInput } from '../supabase/functions/notion-health/completion.js';
import { webProperties } from '../supabase/functions/notion-health/sync.js';
import { makeHandler } from '../supabase/functions/notion-health/handler.js';
const now=new Date('2026-10-08T16:00:00Z'),today='2026-10-09';
const env={SUPABASE_URL:'https://project.test',SUPABASE_SERVICE_ROLE_KEY:'service',NOTION_API_TOKEN:'private',
  NOTION_DATA_SOURCE_ID:'a5d815cb-929e-4d88-b855-f4f71f073d2b'};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const driver=(n,expiry='2027-10-01',center='002')=>({id:id(n),name:'기사',center_code:center,health_certificate_expires_on:expiry});
const page=(n,expiry='2026-10-01',status='갱신 예정')=>({object:'page',id:id(n+100),properties:{
  ...webProperties(driver(n,expiry),today,now.toISOString()),'처리 상태':{select:{name:status}},
  '담당자':{people:[{id:id(900)}]},'연락일':{date:{start:'2026-10-08'}},'갱신 예정일':{date:{start:'2026-10-12'}},
  '처리 메모':{rich_text:[{text:{content:'10월 8일 연락 완료'}}]}
}});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
function mock(initial,drivers) {
  const pages=new Map(initial.map(p=>[p.id,structuredClone(p)])),calls=[];
  let lease=null,failPatch=0,lostResponse=false,beforeGet=null;
  const fetcher=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;calls.push({url,init,body});
    if(url.endsWith('notion_health_acquire')){if(lease)return json(false);lease=body.p_token;return json(true);}
    if(url.endsWith('notion_health_release')){if(lease===body.p_token)lease=null;return new Response(null,{status:204});}
    if(url.endsWith('notion_health_record_completion'))return json(now.toISOString());
    if(url.includes('/data_sources/')&&url.endsWith('/query')) {
      assert.equal(body.filter.and[0].select.equals,'평택');
      assert.ok(!JSON.stringify(body.filter).includes('처리 상태'));
      const ordered=[...pages.values()].sort((a,b)=>a.id.localeCompare(b.id));
      const start=body.start_cursor?ordered.findIndex(p=>p.id===body.start_cursor):0;
      assert.ok(start>=0);
      const result=ordered.slice(start,start+body.page_size),hasMore=start+body.page_size<ordered.length;
      return json({object:'list',results:result,has_more:hasMore,next_cursor:hasMore?ordered[start+body.page_size].id:null});
    }
    if(url.includes('/rest/v1/drivers?')){
      const params=new URL(url).searchParams,found=drivers.find(d=>d.id===params.get('id').slice(3)&&d.center_code===params.get('center_code').slice(3));
      return json(found?[found]:[]);
    }
    if(url.includes('/pages/')) {
      const p=pages.get(url.split('/').at(-1));assert.ok(p);
      if(init.method==='PATCH') {
        if(failPatch)return json({},failPatch);
        p.properties={...p.properties,...body.properties};
        if(lostResponse)throw new Error('lost response');
      } else if(beforeGet)beforeGet(p);
      return json(p);
    }
    throw new Error('Unexpected request '+url);
  };
  return {pages,calls,fetcher,get lease(){return lease;},expire(){lease=null;},
    set failPatch(x){failPatch=x;},set lostResponse(x){lostResponse=x;},set beforeGet(x){beforeGet=x;}};
}
const options={now,wait:async()=>{}};
test('completion marks renewal done while retaining human notes and old cycle history',async()=>{
  const original=page(1),m=mock([original],[driver(1)]);
  const result=await completionBatch(env,'service',m.fetcher,{center:'002'},options);
  assert.equal(result.completed,1);assert.equal(result.today,today);assert.equal(m.lease,null);
  const final=m.pages.get(original.id).properties;
  assert.equal(final['처리 상태'].select.name,'갱신 완료');
  assert.equal(final['갱신 완료일'].date.start,today);
  assert.equal(final['갱신 후 만료일'].date.start,'2027-10-01');
  for(const name of ['기사명','담당자','연락일','갱신 예정일','처리 메모','보건증 만료일','갱신 건 ID','만료 상태'])
    assert.deepEqual(final[name],original.properties[name]);
  const second=await completionBatch(env,'service',m.fetcher,{center:'002'},options);
  assert.equal(second.completed,0);assert.equal(m.calls.filter(c=>c.init.method==='PATCH').length,1);
});
test('no completion for unchanged, removed, earlier, expired or invalid expiry',()=>{
  const p=page(1);
  for(const expiry of ['2026-10-01','2026-09-30','2026-10-08','2026-10-09',null,'#N/A','2027-02-30'])
    assert.equal(completionCandidate(p,driver(1,expiry),'002',today),false);
  assert.equal(completionCandidate(p,driver(1,'2026-10-10'),'002',today),true);
  assert.equal(completionCandidate(page(1,null),driver(1),'002',today),true);
});
test('wrong center, driver, cycle key, archived or completed records are not modified',()=>{
  const p=page(1);
  for(const change of [
    q=>{q.in_trash=true;},q=>{q.archived=true;},q=>{q.properties['처리 상태'].select.name='갱신 완료';},
    q=>{q.properties['센터'].select.name='안산';},q=>{q.properties['웹 기사 ID'].rich_text[0].text.content=id(2);},
    q=>{q.properties['갱신 건 ID'].rich_text[0].text.content='manual task';},
    q=>{q.properties['보건증 만료일'].date.start='invalid';}
  ]) {const q=structuredClone(p);change(q);assert.equal(completionCandidate(q,driver(1),'002',today),false);}
  assert.equal(completionCandidate(p,null,'002',today),false);
  assert.equal(completionCandidate(p,driver(1,'2027-10-01','001'),'002',today),false);
});
test('latest human completion is preserved before any PATCH',async()=>{
  const p=page(1),m=mock([p],[driver(1)]);
  m.beforeGet=p=>{p.properties['처리 상태'].select.name='갱신 완료';p.properties['갱신 완료일']={date:{start:'2026-10-08'}};};
  assert.equal((await completionBatch(env,'service',m.fetcher,{center:'002'},options)).completed,0);
  assert.ok(!m.calls.some(c=>c.init.method==='PATCH'));
  assert.equal(m.pages.get(p.id).properties['갱신 완료일'].date.start,'2026-10-08');
});
test('stable pagination includes completed and unrenewed pages without skipping renewed pages',async()=>{
  const pages=[page(1),page(2,'2026-10-01','갱신 완료'),page(3),page(4),page(5)];
  const m=mock(pages,[driver(1),driver(2),driver(3,'2026-10-01'),driver(4),driver(5)]);
  let cursor=null,scanned=0,completed=0;
  for(let i=0;i<3;i++){
    const r=await completionBatch(env,'service',m.fetcher,{center:'002',cursor},options);
    scanned+=r.scanned;completed+=r.completed;cursor=r.nextCursor;
    assert.equal(r.hasMore,i<2);
  }
  assert.equal(scanned,5);assert.equal(completed,3);
});
test('dry run verifies matches without changing Notion pages',async()=>{
  const p=page(1),m=mock([p],[driver(1)]);
  const r=await completionBatch(env,'service',m.fetcher,{center:'002',dryRun:true},options);
  assert.equal(r.eligible,1);assert.equal(r.completed,0);
  assert.ok(!m.calls.some(c=>c.init.method==='PATCH'));
  assert.deepEqual(m.pages.get(p.id),p);
});
test('lost update response keeps lease and a later retry preserves committed completion date',async()=>{
  const p=page(1),m=mock([p],[driver(1)]);m.lostResponse=true;
  await assert.rejects(()=>completionBatch(env,'service',m.fetcher,{center:'002'},options),e=>e.extra.retryAfterSeconds===180);
  assert.ok(m.lease);
  await assert.rejects(()=>completionBatch(env,'service',m.fetcher,{center:'002'},options),e=>e.code==='sync_busy');
  m.expire();m.lostResponse=false;
  assert.equal((await completionBatch(env,'service',m.fetcher,{center:'002'},options)).completed,0);
  assert.equal(m.pages.get(p.id).properties['갱신 완료일'].date.start,today);
});
test('write permission failure returns partial counts and releases lease',async()=>{
  const m=mock([page(1)],[driver(1)]);m.failPatch=403;
  await assert.rejects(()=>completionBatch(env,'service',m.fetcher,{center:'002'},options),e=>e.code==='notion_403'&&e.extra.summary.completed===0);
  assert.equal(m.lease,null);
});
test('invalid body and unauthenticated completion calls are rejected before accessing records',async()=>{
  for(const body of [{center:'invalid'},{center:'002',cursor:''},{center:'002',cursor:123},{center:'002',dryRun:'yes'}])
    assert.throws(()=>validateCompletionInput(body));
  validateCompletionInput({center:'002',cursor:'opaque:notion:cursor'});
  let calls=0;const handler=makeHandler(env,async()=>{calls++;throw new Error();});
  const response=await handler(new Request('https://project.test/functions/v1/notion-health/complete',{method:'POST',body:'{"center":"002"}'}));
  assert.equal(response.status,401);assert.equal(calls,0);
});

test('update time is recorded only after successful final batch, including zero changes',async()=>{
  const m=mock([page(1),page(2),page(3)],[driver(1),driver(2),driver(3)]);
  const first=await completionBatch(env,'service',m.fetcher,{center:'002'},options);
  assert.equal(first.hasMore,true);assert.ok(!m.calls.some(c=>c.url.endsWith('notion_health_record_completion')));
  const final=await completionBatch(env,'service',m.fetcher,{center:'002',cursor:first.nextCursor},options);
  assert.equal(final.lastUpdatedAt,now.toISOString());
  assert.equal(m.calls.filter(c=>c.url.endsWith('notion_health_record_completion')).length,1);
  const empty=mock([],[]);
  assert.equal((await completionBatch(env,'service',empty.fetcher,{center:'002'},options)).lastUpdatedAt,now.toISOString());
});
test('dry run and failed completion leave last successful update time unchanged',async()=>{
  const dry=mock([page(1)],[driver(1)]);
  await completionBatch(env,'service',dry.fetcher,{center:'002',dryRun:true},options);
  assert.ok(!dry.calls.some(c=>c.url.endsWith('notion_health_record_completion')));
  const failed=mock([page(1)],[driver(1)]);failed.failPatch=403;
  await assert.rejects(()=>completionBatch(env,'service',failed.fetcher,{center:'002'},options));
  assert.ok(!failed.calls.some(c=>c.url.endsWith('notion_health_record_completion')));
});
test('status reads persisted time for selected center and returns null for no successful run',async()=>{
  for(const stamp of [now.toISOString(),null]){
    const calls=[];
    const fetcher=async(url,init)=>{calls.push({url,init});return json(stamp?[{last_completed_at:stamp}]:[]);};
    const result=await completionStatus(env,'service',fetcher,{center:'002'});
    assert.equal(result.lastUpdatedAt,stamp);assert.equal(result.center,'002');
    assert.match(calls[0].url,/center_code=eq\.002/);assert.equal(calls[0].init.method,'GET');
  }
});
