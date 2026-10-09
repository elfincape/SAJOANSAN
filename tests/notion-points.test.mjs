import test from 'node:test';
import assert from 'node:assert/strict';
import {webValues,notionValues,merge,properties,webPatch} from '../supabase/functions/notion-points/model.js';
import {makeHandler} from '../supabase/functions/notion-points/handler.js';
import {hashPhotos,downloadPhotos} from '../supabase/functions/notion-points/photos.js';
test('different fields edited on each side merge; same field conflicts; initial divergent data never overwrite',()=>{
  const base=webValues({name:'A',address:'old',contact:'123'});
  const web={...base,address:'new'},notion={...base,contact:'456'};
  const result=merge(base,web,notion);
  assert.equal(result.values.address,'new');assert.equal(result.values.contact,'456');assert.deepEqual(result.conflicts,[]);
  assert.deepEqual(merge(base,web,{...notion,address:'different'}).conflicts,['address']);
  assert.deepEqual(merge(null,web,notion).conflicts.sort(),['address','contact']);
});
test('blanking values and checkboxes round-trip; deadlines follow current 00:00~23:59 web time policy',()=>{
  const values=webValues({name:'납품처',deadline_text:'02:30',allow_under_1ton:true,security_password:'door'});
  assert.deepEqual(notionValues({properties:properties(values)}),values);
  assert.equal(webPatch(values).deadline_business_min,150);
  assert.equal(webValues({name:'A',deadline_business_min:0}).deadline_text,'00:00');
  assert.equal(webValues({name:'A',deadline_text:'9시5분'}).deadline_text,'09:05');
  const empty=webValues({name:'A'});assert.equal(webPatch(empty).deadline_business_min,null);assert.equal(webPatch(empty).memo,null);
  assert.throws(()=>webValues({name:'A',deadline_text:'28:00'}));
});
test('unauthenticated and inactive or non-admin browser calls cannot invoke sync',async()=>{
  const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server'};
  let calls=0;
  const fetcher=async url=>{calls++;return Response.json(url.includes('/auth/')?{id:'00000000-0000-4000-8000-000000000001'}:[{active:true,role:'editor'}]);};
  const handler=makeHandler(env,fetcher);
  assert.equal((await handler(new Request('https://project.supabase.co/notion-points/sync',{method:'POST',body:'{}'}))).status,401);
  assert.equal(calls,0);
  assert.equal((await handler(new Request('https://project.supabase.co/notion-points/sync',{method:'POST',headers:{Authorization:'Bearer user',Origin:'https://sajoansan.vercel.app'},body:'{"center":"001"}'}))).status,403);
  assert.equal(calls,2);
});
test('photo comparison uses bytes; refuses remote external URLs without making a request',async()=>{
  const photo={name:'a.png',dataUrl:'data:image/png;base64,YWJj'};
  assert.equal(await hashPhotos([photo]),await hashPhotos([{...photo,name:'b.png'}]));
  await assert.rejects(()=>hashPhotos(Array(7).fill(photo)));
});
test('external photo URLs cannot reach internal services',async()=>{
  let called=false;
  await assert.rejects(()=>downloadPhotos({properties:{사진:{files:[{external:{url:'https://127.0.0.1/x'}}]}}},async()=>{called=true;}));
  assert.equal(called,false);
});
