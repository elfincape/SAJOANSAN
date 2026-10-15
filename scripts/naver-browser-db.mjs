export const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export async function query(sql){
 const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
 if(!/^[a-z]{20}$/.test(ref||'')||!token)throw Error('Supabase server settings missing');
 const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error('Server queue query failed: HTTP '+r.status);return r.json();
}
