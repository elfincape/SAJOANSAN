import test from 'node:test';
import assert from 'node:assert/strict';
import {scan} from '../supabase/functions/notion-graph/scan.js';
import {notionPhotoFingerprint} from '../supabase/functions/notion-points/photos.js';
import {webValues,properties} from '../supabase/functions/notion-points/model.js';
import {makeHandler as pointsHandler} from '../supabase/functions/notion-points/handler.js';
import {makeHandler as graphHandler} from '../supabase/functions/notion-graph/handler.js';
import {candidateCycle} from '../scripts/notion-scan-cycle.mjs';
const id='00000000-0000-4000-8000-000000000001',pid='00000000-0000-4000-8000-000000000002';
const env={SUPABASE_URL:'https://web.test',NOTION_API_TOKEN:'test'};
function fixtures(){const row={id,center_code:'001',name:'Example',address:'Before',_photo_sig:'photo-signature',_has_photos:false};
  const baseline=webValues(row),page={id:pid,properties:{...properties(baseline),'웹 납품처 ID':{rich_text:[{text:{content:id}}]},센터:{select:{name:'안산'}},사진:{files:[]}}};
  const state={web_id:id,notion_id:pid,baseline,status:'정상',photo_hash:''};return {row,page,state};}
function fetcherFor(f){return async(url,options={})=>{
  let value;
  if(url.includes('/rest/v1/')){
    if(url.includes('notion_points_state?'))value=[f.state];
    else if(url.endsWith('/rpc/notion_points_scan_web'))value=[f.row];
    else throw new Error('Unexpected database request');
  }else if(url.endsWith('/query')){assert.equal(JSON.parse(options.body).page_size,100);value={results:[f.page],has_more:false};}
  else throw new Error('Unchanged scan must not read individual pages, images, or write');
  return Response.json(value);
};}
test('unchanged snapshots use bulk queries with no individual Notion lookups or image downloads',async()=>{
  const f=fixtures(),fetcher=fetcherFor(f);
  const web=await scan(env,'test',{center:'001',kind:'points'},fetcher,{wait:async()=>{}});
  const remote=await scan(env,'test',{center:'001',kind:'points',phase:'notion'},fetcher,{wait:async()=>{}});
  assert.deepEqual(web.ids,[]);assert.deepEqual(remote.ids,[]);assert.equal(web.linked[0].page,pid.replaceAll('-',''));
});
test('independent web and Notion edits are candidates, including a moved center and changed identity',async()=>{
  for(const change of ['web','notion','center','identity']){
    const f=fixtures();if(change==='web')f.row.address='After';
    if(change==='notion')f.page.properties.주소={rich_text:[{text:{content:'After'}}]};
    if(change==='center')f.page.properties.센터.select.name='평택';
    if(change==='identity')f.page.properties['웹 납품처 ID'].rich_text=[];
    const r=await scan(env,'test',{center:'001',kind:'points',phase:change==='web'?'web':'notion'},fetcherFor(f),{wait:async()=>{}});
    assert.deepEqual(r.ids,[id]);
  }
});
test('photo expiry alone is unchanged; replacements and removals are candidates',async()=>{
  const f=fixtures();f.state.photo_hash='verified-bytes';
  f.page.properties.사진.files=[{name:'photo',type:'file',file:{url:'https://prod-files-secure.s3.us-west-2.amazonaws.com/a?signature=old'}}];
  f.state.notion_photo_fingerprint=await notionPhotoFingerprint(f.page);
  f.page.properties.사진.files[0].file.url='https://prod-files-secure.s3.us-west-2.amazonaws.com/a?signature=new';
  let r=await scan(env,'test',{center:'001',kind:'points',phase:'notion'},fetcherFor(f),{wait:async()=>{}});assert.deepEqual(r.ids,[]);
  f.page.properties.사진.files[0].file.url='https://prod-files-secure.s3.us-west-2.amazonaws.com/replacement';
  r=await scan(env,'test',{center:'001',kind:'points',phase:'notion'},fetcherFor(f),{wait:async()=>{}});assert.deepEqual(r.ids,[id]);
  f.page.properties.사진.files=[];
  r=await scan(env,'test',{center:'001',kind:'points',phase:'notion'},fetcherFor(f),{wait:async()=>{}});assert.deepEqual(r.ids,[id]);
});
test('web photo signature mismatch and uncaptured nonempty photos are not skipped',async()=>{
  for(const stored of [null,'old-signature']){const f=fixtures();f.row._has_photos=true;f.state.web_photo_signature=stored;
    const r=await scan(env,'test',{center:'001',kind:'points'},fetcherFor(f));assert.deepEqual(r.ids,[id]);}
});
test('candidate cycle deduplicates edits, rechecks missing pages and still imports new Notion entries',async()=>{
  const calls=[];const missing='00000000-0000-4000-8000-000000000003';
  const call=async(action,body)=>{calls.push({action,body});if(action==='scan')return body.phase==='web'?
    {ids:[id],linked:[{id,page:'visible'},{id:missing,page:'deleted'}],scanned:2}:{ids:[id],seen:['visible'],scanned:1};
    return {processed:1,unchanged:1};};
  const r=await candidateCycle(call,'001','points');assert.equal(r.candidates,2);
  const sync=calls.filter(x=>x.action==='sync');assert.equal(sync.length,3);assert.equal(sync.at(-1).body.phase,'notion');
  assert.deepEqual(sync.filter(x=>x.body.id).map(x=>x.body.id),[id,missing]);
});
test('unchanged cycle never syncs existing individual rows',async()=>{
  const calls=[];await candidateCycle(async(action,b)=>{calls.push({action,b});return action==='scan'?
    b.phase==='web'?{linked:[{id,page:'visible'}],ids:[]}:{seen:['visible'],ids:[]}:{processed:0};},'001','points');
  assert.equal(calls.filter(x=>x.action==='sync'&&x.b.id).length,0);
});
test('candidate scan endpoints are inaccessible to browser callers',async()=>{
  for(const make of [pointsHandler,graphHandler]){const handler=make({...env,SUPABASE_SERVICE_ROLE_KEY:'private'},async()=>{throw new Error('Browser must not reach the scan');});
    const r=await handler(new Request('https://test/functions/v1/notion/scan',{method:'POST',headers:{origin:'https://sajoansan.vercel.app','content-type':'application/json'},body:'{"center":"001"}'}));assert.equal(r.status,403);}
});
