import fs from 'node:fs';
const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Supabase deployment secrets are missing');
const query=fs.readFileSync(new URL('../repo-root/sql/onedrive-document-sides.sql',import.meta.url),'utf8');
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{
 method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
 body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)
});
if(!response.ok)throw new Error(`OneDrive schema migration failed (HTTP ${response.status})`);
console.log('OneDrive front/back document schema applied');
