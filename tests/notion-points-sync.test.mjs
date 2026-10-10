import test from 'node:test';
import assert from 'node:assert/strict';
import {batch} from '../supabase/functions/notion-points/sync.js';
import {CENTERS,FIELDS,properties,webValues,plain} from '../supabase/functions/notion-points/model.js';
import {notionPhotoFingerprint} from '../supabase/functions/notion-points/photos.js';
const ID='00000000-0000-4000-8000-000000000001';
const PAGE='00000000-0000-4000-8000-000000000002';
function fixture() {
  const rows=[{id:ID,center_code:'001',name:'A',code:'A1',address:'old',memo:'old',photos:[]}];
  const states=[];let page=null,created=0,lock=false,stamp=0;
  const fetcher=async(url,options={})=>{
    const data=options.body?JSON.parse(options.body):null;
    if(url.startsWith('https://api.notion.com')) {
      const path=new URL(url).pathname;
      if(path.endsWith('/query')) {
        const results=page&&!page.archived&&
          (data.filter.and?plain(page.properties['웹 납품처 ID'])==='':plain(page.properties['웹 납품처 ID'])===data.filter.rich_text.equals)?[page]:[];
        return Response.json({results,has_more:false,next_cursor:null});
      }
      if(path.includes('/data_sources/'))return Response.json({properties:Object.fromEntries([
        ...Object.values(FIELDS),['사진','files'],['센터','select'],['웹 납품처 ID','rich_text'],['동기화 상태','select'],['최근 동기화일','date'],['웹 바로가기','url']
      ].map(([name,type])=>[name,{type}]))});
      if(path.endsWith('/pages')&&options.method==='POST') {created++;page={id:PAGE,properties:data.properties,last_edited_time:String(++stamp)};return Response.json(page);}
      if(path.includes('/pages/')){
        if(options.method==='PATCH'){page.properties={...page.properties,...data.properties};page.last_edited_time=String(++stamp);}
        return Response.json(page);
      }
      throw new Error('Unexpected Notion URL '+path);
    }
    const u=new URL(url),path=u.pathname.split('/rest/v1/')[1];
    if(path==='rpc/notion_points_acquire'){if(lock)return Response.json(false);lock=true;return Response.json(true);}
    if(path==='rpc/notion_points_release'){lock=false;return Response.json(null);}
    if(path==='rpc/notion_points_apply'){
      const row=rows.find(r=>r.id===data.p_id&&r.center_code===data.p_center);
      if(!row||Object.entries(data.p_expected).some(([k,v])=>JSON.stringify(row[k]??null)!==JSON.stringify(v)))return Response.json(null);
      Object.assign(row,data.p_values);return Response.json(row);
    }
    if(path==='notion_points_state') {
      if(options.method==='POST'){let s=states.find(s=>s.web_id===data.web_id&&s.center_code===data.center_code);if(!s){s={};states.push(s);}Object.assign(s,data);return Response.json([s]);}
      return Response.json(states.filter(s=>['center_code','web_id','notion_id'].every(k=>!u.searchParams.has(k)||s[k]===u.searchParams.get(k).slice(3))));
    }
    if(path==='delivery_points'){
      if(options.method==='POST'){rows.push(data);return Response.json([data]);}
      return Response.json(rows.filter(r=>['center_code','id','code'].every(k=>!u.searchParams.has(k)||r[k]===u.searchParams.get(k).slice(3))));
    }
    throw new Error('Unexpected database URL '+path);
  };
  return {rows,states,fetcher,get page(){return page;},set page(v){page=v;},get created(){return created;}};
}
const env={NOTION_API_TOKEN:'token',SUPABASE_URL:'https://project.supabase.co'};
const options={wait:async()=>{}};

test('candidate acknowledgement does not hide a concurrent Notion photo edit returned by a metadata PATCH',async()=>{
  const f=fixture();await batch(env,'service',{center:'001',id:ID},f.fetcher,options);
  const verifiedFingerprint=await notionPhotoFingerprint(f.page);f.rows[0].address='web change';
  const wrapped=async(url,opts={})=>{
    if(url.endsWith('/rpc/notion_points_photo_signature'))return Response.json('verified-web-signature');
    if(url.includes('/pages/')&&opts.method==='PATCH')f.page.properties['사진']={files:[{name:'new photo',type:'file',file:{url:'https://prod-files-secure.s3.us-west-2.amazonaws.com/new-photo'}}]};
    return f.fetcher(url,opts);
  };
  assert.equal((await batch(env,'service',{center:'001',id:ID,scan:true},wrapped,options)).updated,1);
  assert.equal(f.states[0].notion_photo_fingerprint,verifiedFingerprint);
  assert.notEqual(f.states[0].notion_photo_fingerprint,await notionPhotoFingerprint(f.page));
});

test('failed web photo compare-and-swap never acknowledges a newer browser photo',async()=>{
  const f=fixture();await batch(env,'service',{center:'001',id:ID},f.fetcher,options);
  f.states[0].web_photo_signature='previous-signature';f.rows[0].address='web change';
  const wrapped=async(url,opts={})=>url.endsWith('/rpc/notion_points_photo_signature')?Response.json(null):f.fetcher(url,opts);
  assert.equal((await batch(env,'service',{center:'001',id:ID,scan:true},wrapped,options)).updated,1);
  assert.equal(f.states[0].web_photo_signature,'previous-signature');
});

test('legacy deadline instructions copy faithfully and unrelated edits preserve the existing numeric index',async()=>{
  const f=fixture();Object.assign(f.rows[0],{deadline_text:'오전 검수 전까지',deadline_business_min:540});
  assert.equal((await batch(env,'service',{center:'001',id:ID},f.fetcher,options)).created,1);
  assert.equal(plain(f.page.properties['납품마감']),'오전 검수 전까지');
  f.page.properties['비고']={rich_text:[{text:{content:'notion memo'}}]};
  assert.equal((await batch(env,'service',{center:'001',id:ID},f.fetcher,options)).updated,1);
  assert.equal(f.rows[0].memo,'notion memo');
  assert.equal(f.rows[0].deadline_text,'오전 검수 전까지');
  assert.equal(f.rows[0].deadline_business_min,540);
});
test('initial copy is idempotent; independent edits merge both ways; same-field conflict preserves both values',async()=>{
  const f=fixture();
  assert.equal((await batch(env,'service',{center:'001',id:ID},f.fetcher,options)).created,1);
  const previousStamp=f.page.last_edited_time;
  assert.equal((await batch(env,'service',{center:'001',id:ID},f.fetcher,options)).unchanged,1);
  assert.equal(f.page.last_edited_time,previousStamp);
  f.rows[0].address='web edit';f.page.properties['비고']={rich_text:[{text:{content:'notion edit'}}]};
  const result=await batch(env,'service',{center:'001',id:ID},f.fetcher,options);
  assert.equal(result.updated,1);assert.equal(f.created,1);
  assert.equal(f.rows[0].memo,'notion edit');assert.equal(plain(f.page.properties['주소']),'web edit');
  f.rows[0].address='web conflict';f.page.properties['주소']={rich_text:[{text:{content:'notion conflict'}}]};
  assert.equal((await batch(env,'service',{center:'001',id:ID},f.fetcher,options)).conflicts,1);
  assert.equal(f.rows[0].address,'web conflict');assert.equal(plain(f.page.properties['주소']),'notion conflict');
  assert.equal(f.states[0].baseline.address,'web edit');
});
test('changed center and removed Notion rows do not cause cross-center writes or resurrection',async()=>{
  const f=fixture();await batch(env,'service',{center:'001',id:ID},f.fetcher,options);
  f.page.is_archived=true;
  assert.equal((await batch(env,'service',{center:'001',id:ID},f.fetcher,options)).conflicts,1);
  delete f.page.is_archived;
  f.page.properties['센터']={select:{name:CENTERS['002']}};
  assert.equal((await batch(env,'service',{center:'001',id:ID},f.fetcher,options)).conflicts,1);
  assert.equal(f.page.properties['센터'].select.name,'평택');
  f.page.archived=true;
  assert.equal((await batch(env,'service',{center:'001',id:ID},f.fetcher,options)).conflicts,1);assert.equal(f.created,1);
});
test('Notion-created records get a stable web UUID and import only the selected center',async()=>{
  const f=fixture();f.rows.length=0;
  f.page={id:PAGE,last_edited_time:'0',properties:{...properties(webValues({name:'노션 신규',code:'N1'})),센터:{select:{name:'안산'}},사진:{files:[]},'웹 납품처 ID':{rich_text:[]}}};
  assert.equal((await batch(env,'service',{center:'001',phase:'notion'},f.fetcher,options)).imported,1);
  assert.equal(f.rows.length,1);assert.equal(f.rows[0].name,'노션 신규');assert.equal(f.rows[0].center_code,'001');
  assert.equal(plain(f.page.properties['웹 납품처 ID']),f.rows[0].id);
  assert.equal((await batch(env,'service',{center:'001',phase:'notion'},f.fetcher,options)).imported,0);
  assert.equal(f.rows.length,1);
});
