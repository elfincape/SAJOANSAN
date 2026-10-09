const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Deployment secrets missing');
const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/api-keys?reveal=true',{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
if(!response.ok)throw new Error('Server credential unavailable');
const keys=await response.json(),key=(keys.find(k=>k.name==='service_role')||keys.find(k=>k.type==='secret'))?.api_key;
if(!key)throw new Error('Server credential unavailable');
const base='https://'+ref+'.supabase.co/functions/v1/notion-points/';
const auth={apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'};
const blocked=await fetch(base+'sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
if(blocked.status!==401)throw new Error('Unauthenticated sync was not rejected');
const check=await fetch(base+'test',{method:'POST',headers:auth,body:'{}',signal:AbortSignal.timeout(40000)});
const checked=await check.json();
if(!check.ok||!checked.connected)throw new Error('Notion delivery connection check failed: '+(checked.code||check.status));
console.log('Notion delivery schema and authentication verified');
for(const center of ['001','002']) {
  if(process.env.NOTION_POINTS_VERIFY==='1') {
    const proof=await fetch(base+'verify',{method:'POST',headers:auth,body:JSON.stringify({center}),signal:AbortSignal.timeout(160000)});
    const verified=await proof.json().catch(()=>({}));
    if(!proof.ok||!verified.webToNotion||!verified.notionToWeb)throw new Error('Bidirectional round-trip verification failed: '+(verified.code||proof.status));
    console.log('Center '+center+' actual web ↔ Notion round trip verified; temporary fixture removed');
  }
  let phase='web',cursor=null,finished=false,retries=0;
  const summary={processed:0,created:0,updated:0,unchanged:0,imported:0,conflicts:0};
  for(let i=0;i<10000;i++) {
    const r=await fetch(base+'sync',{method:'POST',headers:auth,body:JSON.stringify({center,phase,cursor}),signal:AbortSignal.timeout(160000)});
    const result=await r.json().catch(()=>({}));
    if(((r.status===409&&result.code==='sync_busy')||result.code==='notion_429')&&retries++<20){await new Promise(r=>setTimeout(r,10000));continue;}
    if(!r.ok)throw new Error('Delivery sync failed: '+(result.code||r.status));
    retries=0;for(const k of Object.keys(summary))summary[k]+=result[k]||0;
    if(!result.hasMore){finished=true;break;}
    phase=result.phase;cursor=result.nextCursor;
  }
  if(!finished)throw new Error('Sync did not finish');
  console.log('Center '+center+' '+JSON.stringify(summary));
}
