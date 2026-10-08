import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, REQUIRED_PROPERTIES } from '../supabase/functions/notion-health/handler.js';
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-test',
  NOTION_API_TOKEN:'notion-private-test',NOTION_DATA_SOURCE_ID:'a5d815cb-929e-4d88-b855-f4f71f073d2b'};
const schema={object:'data_source',properties:Object.fromEntries(Object.entries(REQUIRED_PROPERTIES).map(([name,type])=>[name,{type}]))};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const request=(headers={})=>new Request('https://test.supabase.co/functions/v1/notion-health/test',{method:'POST',headers});
function mock(options={}) {
  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push([url,init]);
    if(url.endsWith('/auth/v1/user'))return json(options.user || {id:'00000000-0000-4000-8000-000000000001'},options.authStatus || 200);
    if(url.includes('/rest/v1/'))return json([{role:options.role || 'admin',active:options.active!==false}]);
    if(options.notionStatus)return json({message:env.NOTION_API_TOKEN},options.notionStatus);
    assert.equal(init.headers.Authorization,'Bearer '+env.NOTION_API_TOKEN);
    assert.equal(init.headers['Notion-Version'],'2026-03-11');
    return json(url.endsWith('/query') ? {object:'list',results:[{private:'must never return'}]} : options.schema || schema);
  };
  return {calls,handler:makeHandler(options.env || env,fetcher)};
}
test('verified active admin checks schema and reads without exposing records or tokens',async()=>{
  const m=mock();const r=await m.handler(request({Authorization:'Bearer user-jwt'}));
  assert.equal(r.status,200);assert.equal((await r.json()).propertyCount,14);
  assert.equal(m.calls.length,4);assert.equal(JSON.parse(m.calls.at(-1)[1].body).page_size,1);
  assert.ok(m.calls.every(([u,init])=>!['PATCH','DELETE'].includes(init.method)));
});
test('anonymous and invalid JWT requests never reach Notion',async()=>{
  const a=mock();assert.equal((await a.handler(request())).status,401);assert.equal(a.calls.length,0);
  const b=mock({authStatus:401});assert.equal((await b.handler(request({Authorization:'Bearer fake'}))).status,401);
  assert.equal(b.calls.length,1);
});
test('viewer/editor and inactive admin are rejected',async()=>{
  for(const opts of [{role:'viewer'},{role:'editor'},{active:false}]) {
    const m=mock(opts);assert.equal((await m.handler(request({Authorization:'Bearer user'}))).status,403);
    assert.equal(m.calls.length,2);
  }
});
test('internal check requires exact server key and never accepts publishable key',async()=>{
  const m=mock();assert.equal((await m.handler(request({apikey:'server-test'}))).status,200);assert.equal(m.calls.length,2);
  const a=mock();assert.equal((await a.handler(request({apikey:'publishable'}))).status,401);
  const b=mock();assert.equal((await b.handler(request({apikey:'server-test',Origin:'https://example.com'}))).status,401);
});
test('schema mismatch reports missing fields, without querying records',async()=>{
  const m=mock({schema:{object:'data_source',properties:{}}});
  const r=await m.handler(request({apikey:'server-test'}));assert.equal(r.status,422);
  assert.equal((await r.json()).issues.length,14);assert.equal(m.calls.length,1);
});
test('Notion errors have clear codes and never echo upstream secret messages',async()=>{
  for(const [status,code] of [[401,'notion_unauthorized'],[403,'notion_forbidden'],[404,'notion_not_found'],[429,'notion_rate_limited'],[500,'notion_error']]) {
    const m=mock({notionStatus:status});const r=await m.handler(request({apikey:'server-test'}));
    assert.equal(r.status,502);const text=await r.text();assert.equal(JSON.parse(text).code,code);
    assert.ok(!text.includes(env.NOTION_API_TOKEN));
  }
});
test('missing secrets, malformed source ID and archived sources fail safely',async()=>{
  for(const [opts,code] of [[{env:{...env,NOTION_API_TOKEN:''}},'missing_secrets'],
    [{env:{...env,NOTION_DATA_SOURCE_ID:'../pages'}},'invalid_data_source_id'],
    [{schema:{...schema,archived:true}},'invalid_data_source']]) {
    const m=mock(opts);const r=await m.handler(request({apikey:'server-test'}));assert.equal((await r.json()).code,code);
  }
});
