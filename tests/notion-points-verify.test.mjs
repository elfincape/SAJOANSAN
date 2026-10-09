import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRoundTrip} from '../supabase/functions/notion-points/verify.js';
const env={SUPABASE_URL:'https://web.test',NOTION_API_TOKEN:'test'};
test('busy verification creates no temporary records and never touches Notion',async()=>{
  const calls=[];
  const fetcher=async(url)=>{calls.push(url);assert.ok(url.endsWith('/rpc/notion_points_acquire'));return Response.json(false);};
  await assert.rejects(verifyRoundTrip(env,'test','001',fetcher),error=>error.code==='sync_busy');
  assert.equal(calls.length,1);
});
test('verification releases its global lease when fixture recovery read fails',async()=>{
  let released=false;
  const fetcher=async(url)=>{
    if(url.endsWith('/rpc/notion_points_acquire'))return Response.json(true);
    if(url.endsWith('/rpc/notion_points_release')){released=true;return Response.json(null);}
    assert.ok(url.includes('/delivery_points?'));return Response.json({}, {status:503});
  };
  await assert.rejects(verifyRoundTrip(env,'test','001',fetcher),error=>error.code==='database_error');
  assert.equal(released,true);
});

