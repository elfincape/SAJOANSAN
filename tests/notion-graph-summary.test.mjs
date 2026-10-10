import test from 'node:test';
import assert from 'node:assert/strict';
import {summaryBatch,summaryTree,treeHash,legacyTreeHash} from '../supabase/functions/notion-graph/summary.js';
const id='00000000-0000-4000-8000-000000000001',page='00000000-0000-4000-8000-000000000002',block='00000000-0000-4000-8000-000000000003';
test('Notion joining adjacent text keeps the same semantic hash; text and formatting edits remain different',async()=>{
  const split={type:'callout',callout:{rich_text:[{type:'text',text:{content:'First '}},{type:'text',text:{content:'second'}}]}};
  const joined={type:'callout',callout:{rich_text:[{type:'text',text:{content:'First second'}}]}};
  assert.notEqual(await legacyTreeHash(split),await legacyTreeHash(joined));
  assert.equal(await treeHash(split),await treeHash(joined));
  joined.callout.rich_text[0].annotations={bold:true};assert.notEqual(await treeHash(split),await treeHash(joined));
  delete joined.callout.rich_text[0].annotations;joined.callout.rich_text[0].text.content+=' user edit';
  assert.notEqual(await treeHash(split),await treeHash(joined));
});

test('recover only the exact old driver baseline after Notion joins text fragments; keep real user edits',async()=>{
  for(const manual of [false,true]){
    const row={id,name:'Example',center_code:'001',phone:'010',company_id:id,memo:''};
    const route={id,name:'Route',center_code:'001',company_id:id,primary_driver_id:id};
    const maps=Object.fromEntries(['companies','drivers','routes','points'].map(k=>[k,{forward:new Map([[id,page]]),reverse:new Map()}]));
    const context={maps,stops:[],rows:{companies:new Map([[id,row]]),drivers:new Map([[id,row]]),routes:new Map([[id,route]]),vehicles:new Map()}};
    const old=summaryTree('drivers',row,context);
    old.callout.rich_text=[{type:'text',text:{content:'연결 정보 · 자동 갱신\nExample · 안산\n'}},{type:'text',text:{content:'연락처 010\n운수사 '}},{type:'mention',mention:{type:'page',page:{id:page}}}];
    old.callout.children[0].bulleted_list_item.rich_text=old.callout.children[0].bulleted_list_item.rich_text.slice(0,2);
    const state={web_id:id,notion_id:page,status:'정상',summary_hash:await legacyTreeHash(old),summary_status:'수동 확인',summary_block_id:block};
    const actual=structuredClone(old);actual.id=block;actual.parent={page_id:page};
    actual.callout.rich_text[0].text.content+=actual.callout.rich_text[1].text.content;actual.callout.rich_text.splice(1,1);
    if(manual)actual.callout.rich_text[0].text.content+='User note';
    actual.callout.children[0].id=block+'-child';let deletes=0,bodyWrites=0,restored=false;
    const fetcher=async(url,options={})=>{
      const u=new URL(url),data=options.body?JSON.parse(options.body):null;
      if(u.hostname==='api.notion.com'){
        if(options.method==='DELETE'){deletes++;return Response.json({});}
        if(u.pathname.endsWith('/pages/'+page)){
          if(options.method==='PATCH'){restored=data.properties['동기화 상태'].select.name==='정상';return Response.json({});}
          return Response.json({properties:{센터:{select:{name:'안산'}},'웹 ID':{rich_text:[{text:{content:id}}]},'동기화 상태':{select:{name:'충돌 확인'}}}});
        }
        if(options.method==='PATCH'){bodyWrites++;return Response.json({results:[]});}
        if(u.pathname.endsWith('/blocks/'+block))return Response.json(actual);
        throw new Error('Unexpected Notion request');
      }
      const path=u.pathname.split('/rest/v1/')[1];
      if(path.startsWith('rpc/'))return Response.json(path.endsWith('acquire')?true:null);
      if(path==='notion_graph_state'){
        if(options.method==='POST'){Object.assign(state,data);return Response.json([state]);}
        return Response.json([state]);
      }
      if(path==='notion_points_state')return Response.json([]);
      if(path==='drivers')return Response.json([row]);
      if(path==='companies')return Response.json([{id,name:'Company',center_code:'001'}]);
      if(path==='routes')return Response.json([route]);
      return Response.json([]);
    };
    const r=await summaryBatch({SUPABASE_URL:'https://web.test',NOTION_API_TOKEN:'test'},'service',{center:'001',kind:'drivers',id},fetcher,{wait:async()=>{}});
    assert.equal(r.updated,manual?0:1);assert.equal(r.conflicts,manual?1:0);
    assert.equal(deletes,manual?0:1);assert.equal(bodyWrites,manual?0:2);assert.equal(restored,!manual);
  }
});
test('one driver can serve courses owned by different companies without changing the registered company',()=>{
  const driver={id,name:'Example',phone:'010',company_id:'registered',center_code:'001'};
  const maps=Object.fromEntries(['companies','drivers','routes','points'].map(k=>[k,{forward:new Map(),reverse:new Map()}]));
  maps.companies.forward=new Map([['registered','registered-page'],['owner-a','owner-a-page'],['owner-b','owner-b-page']]);
  maps.routes.forward=new Map([['route-a','route-a-page'],['route-b','route-b-page']]);
  const context={maps,stops:[],rows:{drivers:new Map([[id,driver]]),companies:new Map(),vehicles:new Map(),routes:new Map([
    ['route-a',{id:'route-a',company_id:'owner-a',primary_driver_id:id,car_number:'12'}],
    ['route-b',{id:'route-b',company_id:'owner-b',primary_driver_id:id,car_number:'27'}]
  ])}};
  const tree=summaryTree('drivers',driver,context);
  assert.equal(tree.callout.children.length,2);
  assert.equal(tree.callout.children[0].bulleted_list_item.rich_text.at(-1).mention.page.id,'owner-a-page');
  assert.equal(tree.callout.children[1].bulleted_list_item.rich_text.at(-1).mention.page.id,'owner-b-page');
  assert.equal(driver.company_id,'registered');
});
test('user edits inside managed preview and unrelated body content are never removed',async()=>{
  const row={id,center_code:'001',name:'운수사',memo:'old'},maps=Object.fromEntries(['companies','drivers','routes','points'].map(k=>[k,{forward:new Map(),reverse:new Map()}]));
  const original=summaryTree('companies',row,{maps,rows:{drivers:new Map()},stops:[]});
  const state={web_id:id,notion_id:page,summary_block_id:block,summary_hash:await treeHash(original),summary_status:'정상'};
  const manual=structuredClone(original);manual.id=block;manual.parent={page_id:page};manual.callout.rich_text.push({type:'text',text:{content:'직접 작성한 설명'}});
  row.memo='web changed';let removed=0,bodyWrites=0;
  const fetcher=async(url,options={})=>{
    const u=new URL(url),body=options.body?JSON.parse(options.body):null;
    if(u.hostname==='api.notion.com'){
      if(options.method==='DELETE')removed++;
      if(u.pathname.includes('/blocks/')&&options.method==='PATCH')bodyWrites++;
      if(u.pathname.endsWith('/pages/'+page))return Response.json({properties:{'센터':{select:{name:'안산'}},'웹 ID':{rich_text:[{text:{content:id}}]}}});
      if(u.pathname.endsWith('/blocks/'+block))return Response.json(manual);
      throw new Error('Unexpected Notion request');
    }
    const path=u.pathname.split('/rest/v1/')[1];
    if(path.startsWith('rpc/'))return Response.json(path.endsWith('acquire')?true:null);
    if(path==='notion_graph_state'){
      if(options.method==='POST'){Object.assign(state,body);return Response.json([state]);}
      return Response.json(u.searchParams.get('select')==='web_id,notion_id'?[]:[state]);
    }
    if(path==='notion_points_state')return Response.json([]);
    if(path==='companies')return Response.json([row]);
    if(['drivers','routes','delivery_points','vehicles','course_view'].includes(path))return Response.json([]);
    throw new Error('Unexpected web request '+path);
  };
  const result=await summaryBatch({SUPABASE_URL:'https://project.supabase.co',NOTION_API_TOKEN:'test'},'service',{kind:'companies',center:'001',id},fetcher,{wait:async()=>{}});
  assert.equal(result.conflicts,1);assert.equal(state.summary_status,'수동 확인');assert.equal(removed,0);assert.equal(bodyWrites,0);
});
