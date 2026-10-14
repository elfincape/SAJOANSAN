import assert from 'node:assert/strict';
import {makeHandler as health} from '../supabase/functions/notion-health/handler.js';
import {makeHandler as points} from '../supabase/functions/notion-points/handler.js';
import {makeHandler as graph} from '../supabase/functions/notion-graph/handler.js';
for(const [name,make] of [['notion-health',health],['notion-points',points],['notion-graph',graph]]){
 let calls=0;
 const handler=make({NOTION_SYNC_PAUSED:'true'},async()=>{calls++;throw Error('Network must stay idle');});
 for(const action of ['sync','scheduled','complete','scan','test']){
  const r=await handler(new Request('https://example.supabase.co/functions/v1/'+name+'/'+action,{method:'POST',body:'{}'}));
  assert.equal(r.status,503);assert.equal((await r.json()).code,'sync_paused');
 }
 assert.equal(calls,0);
 assert.equal((await handler(new Request('https://example.supabase.co',{method:'OPTIONS'}))).status,204);
}
console.log('Notion pause blocks all server actions without DB or external requests');
