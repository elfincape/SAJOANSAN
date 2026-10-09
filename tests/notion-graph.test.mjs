import test from 'node:test';
import assert from 'node:assert/strict';
import {webValues,remoteValues,properties,merge} from '../supabase/functions/notion-graph/model.js';
import {summaryTree,normalizedTree,treeHash} from '../supabase/functions/notion-graph/summary.js';
import {makeHandler} from '../supabase/functions/notion-graph/handler.js';
import {expandRelations} from '../supabase/functions/notion-graph/sync.js';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const maps=Object.fromEntries(['companies','drivers','routes','points'].map(k=>[k,{forward:new Map([[a,b]]),reverse:new Map([[b.replaceAll('-',''),a]])}]));
test('independent relation changes merge; divergent assignments conflict',()=>{
  const base=webValues('routes',{name:'A',company_id:a,primary_driver_id:a,closed_days:[6,0]},[{delivery_point_id:a}]);
  const result=merge(base,{...base,name:'B'},{...base,primary_driver_id:null});
  assert.equal(result.values.name,'B');assert.equal(result.values.primary_driver_id,null);assert.deepEqual(result.conflicts,[]);
  assert.deepEqual(merge(base,{...base,company_id:b},{...base,company_id:null}).conflicts,['company_id']);
  assert.deepEqual(base.closed_days,[0,6]);
});
test('relations round trip by stable IDs and reject cross-center or ambiguous assignments',()=>{
  const values=webValues('routes',{name:'A',company_id:a,primary_driver_id:a,closed_days:[0,6]},[{delivery_point_id:a}]);
  const page={properties:Object.fromEntries(Object.entries(properties('routes',values,maps)).map(([k,p])=>[k,{...p,type:Object.keys(p)[0]}]))};
  assert.deepEqual(remoteValues('routes',page,maps),values);
  page.properties['주기사'].relation.push({id:b});assert.throws(()=>remoteValues('routes',page,maps),e=>e.code==='relation_cardinality');
  page.properties['주기사'].relation=[{id:a}];assert.throws(()=>remoteValues('routes',page,maps),e=>e.code==='relation_scope');
  page.properties['주기사'].has_more=true;assert.throws(()=>remoteValues('routes',page,maps),e=>e.code==='relation_incomplete');
});
test('large relation lists fetch every page without double escaping property IDs',async()=>{
  const page={id:a,properties:{'납품처':{id:'x%3Ay',relation:[{id:a}],has_more:true}}};let calls=0;
  await expandRelations(async path=>{calls++;assert.ok(path.includes('/properties/x%3Ay?'));
    return calls===1?{results:[{relation:{id:a}}],has_more:true,next_cursor:'next token'}:{results:[{relation:{id:b}}],has_more:false};},'routes',page);
  assert.equal(calls,2);assert.deepEqual(page.properties['납품처'].relation,[{id:a},{id:b}]);assert.equal(page.properties['납품처'].has_more,false);
});
test('native mention previews retain course → point → company → driver hierarchy',async()=>{
  const row={id:a,name:'코스',center_code:'001',company_id:a,primary_driver_id:a,active:true};
  const context={maps,rows:{routes:new Map([[a,row]]),companies:new Map([[a,{name:'운수사'}]]),drivers:new Map([[a,{name:'기사',phone:'010'}]]),points:new Map([[a,{name:'납품처'}]]),vehicles:new Map()},stops:[{route_id:a,delivery_point_id:a,stop_order:1}]};
  const tree=summaryTree('routes',row,context),branch=tree.callout.children[0];
  assert.equal(branch.bulleted_list_item.rich_text[1].mention.page.id,b);
  assert.equal(branch.bulleted_list_item.children[0].bulleted_list_item.children[0].type,'bulleted_list_item');
  const changed=structuredClone(tree);changed.callout.rich_text.push({type:'text',text:{content:'사용자 메모'}});
  assert.notEqual(await treeHash(changed),await treeHash(tree));
  assert.deepEqual(normalizedTree(tree),normalizedTree(structuredClone(tree)));
});
test('browser cannot invoke fixture verification and inactive editor cannot sync',async()=>{
  const env={SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server'};
  const handler=makeHandler(env,async url=>Response.json(url.includes('/auth/')?{id:a}:[{active:true,role:'editor'}]));
  const req=(action,headers={})=>new Request('https://project.supabase.co/notion-graph/'+action,{method:'POST',headers,body:'{}'});
  assert.equal((await handler(req('sync'))).status,401);
  assert.equal((await handler(req('verify',{Origin:'https://sajoansan.vercel.app',apikey:'server'}))).status,403);
  assert.equal((await handler(req('sync',{Authorization:'Bearer user',Origin:'https://sajoansan.vercel.app'}))).status,403);
});
