const ref=process.env.SUPABASE_PROJECT_REF;
const token=process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) throw new Error('Supabase deployment settings are missing.');
const keyResponse=await fetch('https://api.supabase.com/v1/projects/'+ref+'/api-keys?reveal=true',{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)
});
if (!keyResponse.ok) throw new Error('Project API key lookup failed: '+keyResponse.status);
const keys=await keyResponse.json();
const key=(keys.find(k=>k.name==='service_role') || keys.find(k=>k.type==='secret'))?.api_key;
if (!key) throw new Error('Server API key is unavailable.');
const url='https://'+ref+'.supabase.co/functions/v1/notion-health/test';
const blocked=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
if (blocked.status!==401) throw new Error('Unauthenticated access was not rejected.');
const response=await fetch(url,{method:'POST',headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},
  body:'{}',signal:AbortSignal.timeout(55000)});
const result=await response.json().catch(()=>({}));
if (!response.ok || !result.connected || !result.schemaValid || !result.readable) {
  console.error('Notion connection check failed:',result.code || response.status);
  if (result.error) console.error(result.error);
  if (result.issues) console.error(JSON.stringify(result.issues));
  process.exit(1);
}
console.log('Deployed Notion connection verified: schema and read access, '+result.propertyCount+' properties. No records changed.');
