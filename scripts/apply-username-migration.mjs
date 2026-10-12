import fs from 'node:fs';
const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Deployment secrets missing');
const query=fs.readFileSync(new URL('../repo-root/sql/username-accounts.sql',import.meta.url),'utf8');
const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!r.ok)throw new Error('Username migration failed: HTTP '+r.status);
console.log('Username schema and restricted login RPCs applied');

const verification=`do $$ begin
if has_function_privilege('anon','public.account_login_email(text)','execute')
or has_function_privilege('authenticated','public.account_login_email(text)','execute')
or has_function_privilege('anon','public.account_login_attempt(text[])','execute')
or has_function_privilege('authenticated','public.account_login_attempt(text[])','execute')
then raise exception 'Login RPC must be restricted to server credentials'; end if;
if not exists(select 1 from pg_indexes where schemaname='public' and indexname='user_profiles_username_unique')
then raise exception 'Username uniqueness index missing'; end if;
end $$;`;
const checked=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:verification}),signal:AbortSignal.timeout(60000)});
if(!checked.ok)throw new Error('Username schema verification failed: HTTP '+checked.status);
console.log('Username index and server-only RPC permissions verified');
