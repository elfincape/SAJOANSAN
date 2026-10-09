import test from 'node:test';
import assert from 'node:assert/strict';
import {summaryBatch,summaryTree,treeHash} from '../supabase/functions/notion-graph/summary.js';
const id='00000000-0000-4000-8000-000000000001',page='00000000-0000-4000-8000-000000000002',block='00000000-0000-4000-8000-000000000003';
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

