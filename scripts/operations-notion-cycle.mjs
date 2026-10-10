import {createTaskSync} from '../supabase/functions/operations-notion/sync.js';
const ref=process.env.SUPABASE_PROJECT_REF,access=process.env.SUPABASE_ACCESS_TOKEN,token=process.env.OPERATIONS_NOTION_TOKEN;
if(ref!=='yvdialfqlbpjbbmcetev'||!access?.startsWith('sbp_fc')||!token)throw Error('Isolated staging credentials required');
export async function management(path,body){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`Staging management HTTP ${r.status}`);return r.json();}
const keys=await management('api-keys?reveal=true');const service=keys.find(k=>k.name==='service_role')?.api_key??keys.find(k=>k.type==='secret')?.api_key;if(!service)throw Error('Staging server credential unavailable');
export async function rest(path,method='GET',body,extra={}){const r=await fetch(`https://${ref}.supabase.co/rest/v1/${path}`,{method,headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(`Server HTTP ${r.status}: ${e.message??e.code??''}`);}return r.status===204||r.headers.get('content-length')==='0'?null:r.json();}
let lastRequest=0;
export async function notion(path,method='GET',body,raw=false){
 for(let attempt=0;attempt<4;attempt++){
  const wait=Math.max(0,350-(Date.now()-lastRequest));if(wait)await new Promise(r=>setTimeout(r,wait));lastRequest=Date.now();
  const r=await fetch('https://api.notion.com/v1/'+path,{method,headers:{Authorization:`Bearer ${token}`,'Notion-Version':'2025-09-03','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  if(raw)return r;
  if(r.status===429||(r.status>=500&&!(method==='POST'&&path==='pages'))){if(attempt<3){await new Promise(resolve=>setTimeout(resolve,Math.min(10000,Number(r.headers.get('retry-after')??2)*1000)));continue;}}
  if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(`Notion HTTP ${r.status}: ${e.message??e.code??''}`);}return r.json();
 }
}
export async function runCycle(){const owner=crypto.randomUUID();async function guard(){if(!await rest('rpc/operations_sync_lock','POST',{p_owner:owner,p_release:false}))throw Error('다른 동기화가 실행 중입니다.');}await guard();try{return await createTaskSync({rest,notion,guard})();}finally{await rest('rpc/operations_sync_lock','POST',{p_owner:owner,p_release:true});}}
if(process.argv[1]?.endsWith('operations-notion-cycle.mjs')){if(process.argv.includes('--schema')){const source=await notion('data_sources/910d7f0f-7ca6-496a-90a0-1ef44b4dc262');console.log(JSON.stringify(Object.fromEntries(Object.entries(source.properties).map(([k,v])=>[k,v.type]))));}else{const result=await runCycle();console.log(JSON.stringify(result));if(result.errors.length||result.conflicts.length)process.exitCode=1;}}
