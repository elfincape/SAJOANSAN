const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref || '')||!token)throw new Error('Supabase deployment settings are missing.');
const keyResponse=await fetch('https://api.supabase.com/v1/projects/'+ref+'/api-keys?reveal=true',{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
if(!keyResponse.ok)throw new Error('Server credential lookup failed (HTTP '+keyResponse.status+').');
const keys=await keyResponse.json();
const key=(keys.find(k=>k.name==='service_role') || keys.find(k=>k.type==='secret'))?.api_key;
if(!key)throw new Error('Server API key is unavailable.');
const dryRun=process.argv.includes('--dry-run');
for(const center of ['001','002']) {
  let cursor=null,finished=false,scanned=0,completed=0,eligible=0;
  for(let batch=0;batch<6000;batch++) {
    const response=await fetch('https://'+ref+'.supabase.co/functions/v1/notion-health/complete',{
      method:'POST',headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'},
      body:JSON.stringify({center,cursor,dryRun}),signal:AbortSignal.timeout(140000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) {
      console.error('Completion check failed:',data.code || response.status);
      if(data.error)console.error(data.error);
      process.exit(1);
    }
    if(!Number.isInteger(data.scanned)||!Number.isInteger(data.completed)||data.center!==center)
      throw new Error('Completion response was invalid.');
    scanned+=data.scanned;completed+=data.completed;eligible+=data.eligible;
    if(!data.hasMore){finished=true;break;}
    if(typeof data.nextCursor!=='string'||!data.nextCursor||data.nextCursor===cursor)throw new Error('Completion cursor did not advance.');
    cursor=data.nextCursor;
  }
  if(!finished)throw new Error('Completion scan limit reached.');
  console.log('Center '+center+': scanned '+scanned+', eligible '+eligible+', completed '+completed+(dryRun?' (read only)':''));
}
