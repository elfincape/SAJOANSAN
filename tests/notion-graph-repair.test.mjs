import test from 'node:test';
import assert from 'node:assert/strict';
import {repairPointHome} from '../supabase/functions/notion-graph/repair.js';
const parent='3f4b98bf-5f20-81c2-992e-fecda52668d7',source='73aa532a-bc84-4338-8001-897b4e77a1d9';
const old='7f28822a-7e92-4e20-9035-01d5edeef2e7',dest='00000000-0000-4000-8000-000000000001',temp='00000000-0000-4000-8000-000000000002';
test('relocation preserves original source and never restores old ancestor; retry creates no duplicate',async()=>{
  let created=false,moved=false,trashed=false;const writes=[];
  const container=()=>({id:dest,parent:{page_id:parent},description:[{plain_text:'SAJOANSAN original delivery source relocation 73aa532a'}],data_sources:[{id:source},...(!trashed?[{id:temp}]:[])]});
  const fetcher=async(url,options)=>{
    const path=url.split('/v1/')[1],method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
    if(method!=='GET')writes.push({path,body});let value;
    if(path.startsWith('rpc/'))value=true;
    else if(path==='pages/'+parent)value={properties:{title:{title:[{plain_text:'관리허브 연동 원본'}]}}};
    else if(path==='data_sources/'+source){
      if(method==='PATCH'){assert.equal(body.parent.database_id,dest);assert.equal(body.in_trash,false);moved=true;}
      value={id:source,parent:{database_id:moved?dest:old},in_trash:false};
    }else if(path.startsWith('blocks/'))value={results:created?[{type:'child_database',id:dest}]:[],has_more:false};
    else if(path==='databases'){assert.equal(body.parent.page_id,parent);created=true;value=container();}
    else if(path==='databases/'+dest)value=container();
    else if(path==='data_sources/'+temp){if(method==='PATCH'){assert.deepEqual(body,{in_trash:true});trashed=true;}value={properties:{'이동 준비':{type:'title'}}};}
    else if(path==='data_sources/'+temp+'/query')value={results:[],has_more:false};
    else throw new Error('Unexpected request '+path);
    return Response.json(value);
  };
  const env={SUPABASE_URL:'https://web.test',NOTION_API_TOKEN:'test'};
  assert.equal((await repairPointHome(env,'test',fetcher)).sourceID,source);
  assert.equal((await repairPointHome(env,'test',fetcher)).databaseID,dest);
  assert.equal(writes.filter(x=>x.path==='databases').length,1);
  assert.equal(writes.filter(x=>x.path==='data_sources/'+source).length,1);
  assert.ok(!writes.some(x=>x.path.includes(old)||x.path.startsWith('pages/')));
});

