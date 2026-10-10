import {candidateCycle} from './notion-scan-cycle.mjs';
const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Deployment secrets missing');
const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/api-keys?reveal=true',{
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
if(!response.ok)throw new Error('Server credential unavailable');
const keys=await response.json(),key=(keys.find(k=>k.name==='service_role')||keys.find(k=>k.type==='secret'))?.api_key;
if(!key)throw new Error('Server credential unavailable');
const base='https://'+ref+'.supabase.co/functions/v1/notion-points/';
const auth={apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'};
async function call(action,body){
  for(let attempt=0;attempt<31;attempt++){
    const r=await fetch(base+action,{method:'POST',headers:auth,body:JSON.stringify(body),signal:AbortSignal.timeout(160000)});
    const result=await r.json().catch(()=>({}));
    if((result.code==='sync_busy'||/notion_(?:429|500|502|503|504|529|unreachable)$/.test(result.code||''))&&attempt<30){await new Promise(r=>setTimeout(r,10000));continue;}
    if(!r.ok)throw new Error('Delivery '+action+' failed: '+(result.code||r.status));return result;
  }
}
const blocked=await fetch(base+'sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
if(blocked.status!==401)throw new Error('Unauthenticated sync was not rejected');
const check=await fetch(base+'test',{method:'POST',headers:auth,body:'{}',signal:AbortSignal.timeout(40000)});
const checked=await check.json();
if(!check.ok||!checked.connected)throw new Error('Notion delivery connection check failed: '+(checked.code||check.status));
console.log('Notion delivery schema and authentication verified');
for(const center of ['001','002']) {
  if(process.env.NOTION_POINTS_VERIFY==='1') {
    for(let attempt=0;attempt<31;attempt++){
      const proof=await fetch(base+'verify',{method:'POST',headers:auth,body:JSON.stringify({center}),signal:AbortSignal.timeout(160000)});
      const verified=await proof.json().catch(()=>({}));
      if((verified.code==='sync_busy'||verified.code==='notion_429')&&attempt<30){await new Promise(r=>setTimeout(r,10000));continue;}
      if(!proof.ok||!verified.webToNotion||!verified.notionToWeb||!verified.candidateDetection)throw new Error('Bidirectional round-trip verification failed: '+(verified.code||proof.status));
      break;
    }
    console.log('Center '+center+' actual web ↔ Notion round trip verified; temporary fixture removed');
  }
  const summary=await candidateCycle(call,center,'points');
  console.log('Center '+center+' '+JSON.stringify(summary));
}
