import {readFile} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='yvdialfqlbpjbbmcetev'||!token?.startsWith('sbp_fc'))throw Error('Isolated staging deployment only');
const body=new FormData();body.set('metadata',JSON.stringify({name:'operations-notion',entrypoint_path:'operations-notion/index.ts',verify_jwt:false}));
for(const name of ['operations-notion/index.ts','operations-notion/handler.js','operations-notion/sync.js','operations-notion/model.js','notion-graph/model.js','notion-points/model.js']){
 body.append('file',new Blob([await readFile(new URL('../supabase/functions/'+name,import.meta.url))],{type:'text/plain'}),name);
}
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=operations-notion`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body,signal:AbortSignal.timeout(60000)});
if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(`Staging deployment HTTP ${r.status}: ${e.message??''}`);}const result=await r.json();console.log('Staging operations-notion deployed:',result.status,result.version);
