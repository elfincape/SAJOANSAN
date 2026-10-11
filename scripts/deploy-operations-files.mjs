import {readFile} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='vvrppotrnpwrwpwqaiet'||!token)throw Error('운영 배포 인증이 필요합니다.');
const body=new FormData();body.set('metadata',JSON.stringify({name:'onedrive-auth',entrypoint_path:'onedrive-auth/index.ts',verify_jwt:false}));
for(const name of ['index.ts','handler.js','pdf.js','charter.js','operations.js'])body.append('file',new Blob([await readFile(new URL('../supabase/functions/onedrive-auth/'+name,import.meta.url))],{type:'text/plain'}),'onedrive-auth/'+name);
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=onedrive-auth`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body,signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error('OneDrive 업무 첨부 배포 실패 HTTP '+response.status+': '+(await response.text()).slice(0,1000));
const result=await response.json();console.log('OneDrive 업무 첨부 배포:',result.status,'version',result.version);
