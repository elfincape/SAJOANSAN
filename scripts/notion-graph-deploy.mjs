import fs from 'node:fs';
const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Deployment secrets missing');
const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({query:fs.readFileSync(new URL('../repo-root/sql/notion-graph-sync.sql',import.meta.url),'utf8')}),signal:AbortSignal.timeout(60000)});
if(!r.ok){const detail=await r.json().catch(()=>({}));throw new Error('Graph migration failed: '+JSON.stringify(detail));}
console.log('Private graph state and scoped relation updates installed');
