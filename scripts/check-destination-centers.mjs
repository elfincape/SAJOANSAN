const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw Error('Missing Supabase deployment settings');
const query="select center_code,count(*)::int as deliveries,count(*) filter(where nullif(trim(address),'') is not null)::int as addresses from public.delivery_points where center_code in ('001','002') group by center_code order by center_code";
const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!r.ok)throw Error('Delivery-point schema verification failed: '+r.status);
console.log('Center delivery/address counts verified (read-only): '+JSON.stringify(await r.json()));
