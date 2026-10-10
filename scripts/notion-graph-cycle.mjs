import {candidateCycle} from './notion-scan-cycle.mjs';
const {SUPABASE_PROJECT_REF:ref,SUPABASE_ACCESS_TOKEN:token}=process.env;
if(!/^[a-z]{20}$/.test(ref||'')||!token)throw new Error('Deployment secrets missing');
const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/api-keys?reveal=true',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
if(!r.ok)throw new Error('Server credential unavailable');
const keys=await r.json(),key=(keys.find(k=>k.name==='service_role')||keys.find(k=>k.type==='secret'))?.api_key;
if(!key)throw new Error('Server credential unavailable');
const base='https://'+ref+'.supabase.co/functions/v1/notion-graph/';
const headers={apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json'};
async function call(action,body){
  for(let i=0;i<31;i++){
    const r=await fetch(base+action,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(160000)});
    const result=await r.json().catch(()=>({}));
    const transient=/notion_(?:429|500|502|503|504|529|unreachable)$/.test(result.code||'');
    const transientSchema=action==='test'&&Object.values(result.sources||{}).some(code=>/notion_(?:429|500|502|503|504|529|unreachable)$/.test(code));
    if((result.code==='sync_busy'||/notion_429$/.test(result.code||'')||((action!=='verify')&&(transient||transientSchema)))&&i<30){await new Promise(r=>setTimeout(r,10000));continue;}
    if(!r.ok)throw new Error('Graph '+action+' failed: '+(result.code||r.status)+(action==='repair'?' '+JSON.stringify(result.summary||{}):''));return result;
  }
}
const denied=await fetch(base+'sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
if(denied.status!==401)throw new Error('Unauthenticated graph sync was not rejected');
if(process.env.NOTION_GRAPH_VERIFY==='1')console.log('Original delivery source relocation '+JSON.stringify(await call('repair',{})));
const schema=await call('test',{});
if(!schema.connected)throw new Error('Graph schema check failed: '+JSON.stringify(schema));
console.log('Graph schema and authentication verified');
for(const center of ['001','002']){
  if(process.env.NOTION_GRAPH_VERIFY==='1'){
    const result=await call('verify',{center});
    if(!result.webToNotion||!result.notionToWeb||!result.stopDetailsPreserved||!result.nativeMentions||!result.concurrentStopEditsPreserved||!result.candidateDetection)throw new Error('Graph round trip failed');
    console.log('Center '+center+' actual relation round trip, stop restoration and native mentions verified; isolated fixtures removed');
  }
  for(const kind of ['companies','drivers','routes']){
    const totals=await candidateCycle(call,center,kind);
    console.log('Center '+center+' '+kind+' '+JSON.stringify(totals));
  }
}
// Connect both centers before building the larger delivery-point previews.
for(const center of ['001','002']){
  if(process.env.NOTION_GRAPH_SKIP_SUMMARY!=='1')for(const kind of ['companies','drivers','routes','points']){
    let cursor=null,done=false;const totals={processed:0,updated:0,unchanged:0,conflicts:0};
    for(let i=0;i<10000;i++){
      const result=await call('summary',{center,kind,cursor});for(const k of Object.keys(totals))totals[k]+=result[k]||0;
      if(!result.hasMore){done=true;break;}cursor=result.nextCursor;
    }
    if(!done)throw new Error('Graph previews did not finish');console.log('Center '+center+' '+kind+' previews '+JSON.stringify(totals));
  }
}
