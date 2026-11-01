export const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export async function query(sql){
 const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
 if(!/^[a-z]{20}$/.test(ref||'')||!token)throw Error('Supabase server settings missing');
 let r;try{r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(60000)});}catch{throw Object.assign(Error('Server queue connection failed'),{code:'NAVER_QUEUE_NETWORK'});}
 if(!r.ok)throw Object.assign(Error('Server queue query failed: HTTP '+r.status),{code:'NAVER_QUEUE_HTTP',status:r.status,retryAfterSeconds:Number(r.headers.get('retry-after'))||0});
 try{return await r.json();}catch{throw Object.assign(Error('Server queue response could not be confirmed'),{code:'NAVER_QUEUE_NETWORK'});}
}
