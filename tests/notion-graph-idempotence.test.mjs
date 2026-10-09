import test from 'node:test';
import assert from 'node:assert/strict';
import {batch} from '../supabase/functions/notion-graph/sync.js';
import {properties,FIELDS,SOURCES} from '../supabase/functions/notion-graph/model.js';
test('persisted jsonb key order does not rewrite an unchanged company or its Notion timestamp',async()=>{
  const id='00000000-0000-4000-8000-000000000001',pageID='00000000-0000-4000-8000-000000000002';
  const row={id,center_code:'001',name:'Example',memo:'Memo'},baseline={memo:'Memo',name:'Example'};
  const props=properties('companies',{name:row.name,memo:row.memo},{});
  const page={id:pageID,properties:{...Object.fromEntries(Object.entries(props).map(([key,p])=>[key,{...p,type:Object.keys(p)[0]}])),센터:{select:{name:'안산'}}}};
  let writes=0;
  const fetcher=async(url,options)=>{
    const method=options.method||'GET';let value;
    if(url.includes('/rest/v1/')){
      const path=url.split('/rest/v1/')[1];
      if(path.startsWith('rpc/'))value=true;
      else if(path.startsWith('companies?'))value=[row];
      else if(path.startsWith('notion_graph_state?select=*'))value=[{web_id:id,notion_id:pageID,status:'정상',baseline}];
      else if(path.startsWith('notion_graph_state?')&&path.includes('kind=eq.companies'))value=[{web_id:id,notion_id:pageID}];
      else if(path.startsWith('notion_graph_state?')||path.startsWith('notion_points_state?'))value=[];
      else throw new Error('Unexpected database request '+path);
      if(method!=='GET'&&!path.startsWith('rpc/'))writes++;
    }else{
      const path=url.split('/v1/')[1];
      if(path==='data_sources/'+SOURCES.companies)value={properties:Object.fromEntries(Object.values(FIELDS.companies).map(([name,type])=>[name,{type}]))};
      else if(path==='data_sources/'+SOURCES.companies+'/query')value={results:[page],has_more:false};
      else{writes++;throw new Error('Unexpected Notion mutation or lookup '+path);}
    }
    return Response.json(value);
  };
  const result=await batch({SUPABASE_URL:'https://web.test',NOTION_API_TOKEN:'test'},'test',{kind:'companies',center:'001',id},fetcher,{wait:async()=>{}});
  assert.equal(result.unchanged,1);assert.equal(result.updated,0);assert.equal(writes,0);
});

