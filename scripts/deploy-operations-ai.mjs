import {readFile} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='vvrppotrnpwrwpwqaiet'||!token)throw Error('운영 AI 배포 인증이 필요합니다.');
const body=new FormData();body.set('metadata',JSON.stringify({name:'operations-assistant',entrypoint_path:'operations-assistant/index.ts',verify_jwt:false}));
for(const name of ['operations-assistant/index.ts','operations-assistant/tools.ts','operations-assistant/result-plan.js','operations-assistant/portal.js','operations-assistant/portal-model.js','_shared/haiku.js'])body.append('file',new Blob([await readFile(new URL('../supabase/functions/'+name,import.meta.url))],{type:'text/plain'}),name);
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=operations-assistant`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body,signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error('운영 AI 배포 실패 HTTP '+response.status+': '+(await response.text()).slice(0,1000));
const result=await response.json();console.log('운영 AI 배포:',result.status,'version',result.version);
