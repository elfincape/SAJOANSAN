import fs from 'node:fs';
const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Deployment secrets missing');
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
const query=fs.readFileSync(new URL('../repo-root/sql/notion-points-sync.sql',import.meta.url),'utf8');
const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{
  method:'POST',headers,body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!r.ok)throw new Error('Delivery sync migration failed (HTTP '+r.status+')');
console.log('Delivery sync state, row concurrency checks and server-only locks installed');
