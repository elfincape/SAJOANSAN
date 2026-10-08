import test from 'node:test';
import assert from 'node:assert/strict';
import { previewTargets, syncBatch, renewalKey, validateSyncInput, webProperties } from '../supabase/functions/notion-health/sync.js';
import { makeHandler } from '../supabase/functions/notion-health/handler.js';
const now=new Date('2026-10-08T00:00:00Z'),today='2026-10-08';
const env={SUPABASE_URL:'https://project.test',SUPABASE_SERVICE_ROLE_KEY:'service',
  NOTION_API_TOKEN:'notion',NOTION_DATA_SOURCE_ID:'a5d815cb-929e-4d88-b855-f4f71f073d2b'};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const driver=(n,expiry=null,center='002')=>({id:id(n),name:'기사 '+n,center_code:center,health_certificate_expires_on:expiry});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
function mock(drivers=[],initial=[]) {
  const pages=new Map(initial.map(p=>[p.id,structuredClone(p)])),calls=[];
  let lease=null,createFailure=0,timeout=false,createWait=null;
  const fetcher=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;
    calls.push({url,init,body});
    if(url.includes('/rpc/notion_health_acquire')){if(lease)return json(false);lease=body.p_token;return json(true);}
    if(url.includes('/rpc/notion_health_release')){if(lease===body.p_token)lease=null;return json(null);}
    if(url.includes('/rest/v1/drivers?')){
      const u=new URL(url),center=u.searchParams.get('center_code').slice(3),cursor=u.searchParams.get('id')?.slice(3);
      const cutoff=u.searchParams.get('or').match(/\.lt\.([^)]*)/)[1];
      return json(drivers.filter(d=>d.center_code===center&&(!d.health_certificate_expires_on||d.health_certificate_expires_on<cutoff)&&(!cursor||d.id>cursor))
        .sort((a,b)=>a.id.localeCompare(b.id)).slice(0,Number(u.searchParams.get('limit'))));
    }
    if(url.includes('/data_sources/')&&url.endsWith('/query')){
      const key=body.filter.rich_text.equals;
      return json({object:'list',results:[...pages.values()].filter(p=>p.properties['갱신 건 ID']?.rich_text?.[0]?.text?.content===key),has_more:false});
    }
    if(url.endsWith('/pages')){
      assert.equal(body.parent.data_source_id,env.NOTION_DATA_SOURCE_ID);
      if(createFailure)return json({},createFailure);
      if(createWait)await createWait;
      const page={object:'page',id:id(1000+pages.size),properties:body.properties};
      pages.set(page.id,page);
      if(timeout)throw new Error('lost response');
      return json(page);
    }
    if(url.includes('/pages/')&&init.method==='PATCH'){
      const page=pages.get(url.split('/').at(-1));assert.ok(page);
      page.properties={...page.properties,...body.properties};return json(page);
    }
    throw new Error('Unexpected request: '+url);
  };
  return {pages,calls,fetcher,get lease(){return lease;},set createFailure(v){createFailure=v;},set timeout(v){timeout=v;},
    expire(){lease=null;},set createWait(v){createWait=v;}};
}
const options={now,wait:async()=>{}};
const page=(d,status='갱신 예정')=>({object:'page',id:id(999),properties:{
  ...webProperties(d,today,now.toISOString()),'처리 상태':{select:{name:status}},
  '담당자':{people:[{id:id(800)}]},'연락일':{date:{start:'2026-10-07'}},
  '갱신 예정일':{date:{start:'2026-10-12'}},'처리 메모':{rich_text:[{text:{content:'연락 완료'}}]}
}});
test('preview matches website date threshold and scopes to selected center',async()=>{
  const m=mock([driver(1),driver(2,'2026-10-07'),driver(3,'2026-10-08'),driver(4,'2026-11-07'),driver(5,'2026-11-08'),driver(6,null,'001')]);
  const result=await previewTargets(env,'service',m.fetcher,{center:'002'},now);
  assert.equal(result.total,4);assert.deepEqual(result.counts,{'미등록':1,'만료':1,'오늘 만료':1,'만료 임박':1});
  assert.ok(m.calls.every(c=>c.init.method==='GET'));
});
test('renewal keys distinguish center, expiry cycle, and missing certificate',()=>{
  const d=driver(1);
  assert.notEqual(renewalKey(d),renewalKey({...d,center_code:'001'}));
  assert.notEqual(renewalKey(d),renewalKey({...d,health_certificate_expires_on:'2026-10-08'}));
  for(const body of [{center:'999'},{center:'002',cursor:'invalid'},{center:'__proto__'}])assert.throws(()=>validateSyncInput(body));
});
test('initial sync creates a missing/expired task and repeating sync updates same page',async()=>{
  const m=mock([driver(1,'2026-10-01')]);
  const first=await syncBatch(env,'service',m.fetcher,{center:'002'},options);
  assert.equal(first.created,1);assert.equal(m.pages.size,1);assert.equal(m.lease,null);
  const p=[...m.pages.values()][0];assert.equal(p.properties['처리 상태'].select.name,'확인 필요');
  assert.equal(p.properties['만료 상태'].select.name,'만료');
  const second=await syncBatch(env,'service',m.fetcher,{center:'002'},options);
  assert.equal(second.updated,1);assert.equal(m.pages.size,1);
});
test('updating preserves human contact, assignee, planned date, status and notes',async()=>{
  const d=driver(1),original=page(d),m=mock([d],[original]);
  await syncBatch(env,'service',m.fetcher,{center:'002'},options);
  const patched=m.calls.find(c=>c.init.method==='PATCH').body.properties;
  for(const field of ['담당자','연락일','갱신 예정일','처리 메모','처리 상태','갱신 완료일','갱신 후 만료일'])assert.ok(!(field in patched));
  assert.deepEqual(m.pages.get(original.id).properties['갱신 예정일'],original.properties['갱신 예정일']);
});
test('completed history and conflicting duplicate tasks are preserved',async()=>{
  const d=driver(1),m=mock([d],[page(d,'갱신 완료')]);
  assert.equal((await syncBatch(env,'service',m.fetcher,{center:'002'},options)).closed,1);
  assert.ok(!m.calls.some(c=>c.init.method==='PATCH'));
  const a=page(d),b={...page(d),id:id(998)},dup=mock([d],[a,b]);
  assert.equal((await syncBatch(env,'service',dup.fetcher,{center:'002'},options)).conflicts,1);
  assert.equal(dup.pages.size,2);assert.ok(!dup.calls.some(c=>c.init.method==='PATCH'));
});
test('cursor batches process every eligible driver without offset skipping',async()=>{
  const m=mock(Array.from({length:14},(_,i)=>driver(i+1)));
  let cursor=null,total=0;
  for(let i=0;i<3;i++){
    const result=await syncBatch(env,'service',m.fetcher,{center:'002',cursor},options);
    total+=result.processed;cursor=result.nextCursor;
    assert.equal(result.hasMore,i<2);
  }
  assert.equal(total,14);assert.equal(m.pages.size,14);
});
test('concurrent requests are serialized before any Notion mutation',async()=>{
  const m=mock([driver(1)]);
  let release; m.createWait=new Promise(r=>{release=r;});
  const first=syncBatch(env,'service',m.fetcher,{center:'002'},options);
  while(!m.calls.some(c=>c.url.endsWith('/pages')))await new Promise(r=>setTimeout(r,0));
  await assert.rejects(()=>syncBatch(env,'service',m.fetcher,{center:'002'},options),e=>e.code==='sync_busy');
  release();await first;assert.equal(m.pages.size,1);
});
test('permission failure returns partial summary and releases lease for retry',async()=>{
  const m=mock([driver(1)]);m.createFailure=403;
  await assert.rejects(()=>syncBatch(env,'service',m.fetcher,{center:'002'},options),e=>e.code==='notion_403'&&e.extra.summary.processed===0);
  assert.equal(m.lease,null);m.createFailure=0;
  assert.equal((await syncBatch(env,'service',m.fetcher,{center:'002'},options)).created,1);
});
test('lost create response holds lease, then retry finds committed page',async()=>{
  const m=mock([driver(1)]);m.timeout=true;
  await assert.rejects(()=>syncBatch(env,'service',m.fetcher,{center:'002'},options),e=>e.extra.retryAfterSeconds===180);
  assert.ok(m.lease);assert.equal(m.pages.size,1);
  await assert.rejects(()=>syncBatch(env,'service',m.fetcher,{center:'002'},options),e=>e.code==='sync_busy');
  m.expire();m.timeout=false;
  assert.equal((await syncBatch(env,'service',m.fetcher,{center:'002'},options)).updated,1);assert.equal(m.pages.size,1);
});
test('sync route rejects unauthenticated callers before accessing driver data',async()=>{
  let calls=0;const handler=makeHandler(env,async()=>{calls++;throw new Error();});
  const response=await handler(new Request('https://project.test/functions/v1/notion-health/sync',{method:'POST',body:'{"center":"002"}'}));
  assert.equal(response.status,401);assert.equal(calls,0);
});

test('successful sync accepts an empty 204 response when releasing the lease',async()=>{
  const m=mock([driver(1)]);
  const fetcher=async(url,init)=>{const response=await m.fetcher(url,init);return url.endsWith('notion_health_release')?new Response(null,{status:204}):response;};
  assert.equal((await syncBatch(env,'service',fetcher,{center:'002'},options)).created,1);assert.equal(m.lease,null);
});
