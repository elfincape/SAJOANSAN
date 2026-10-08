import { supabase } from './supabase.js';
import { SUPABASE_URL,SUPABASE_ANON_KEY } from './config.js';
async function call(action,body){
 const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('다시 로그인해 주세요.');
 const response=await fetch(SUPABASE_URL+'/functions/v1/onedrive-auth/'+action,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(120000)});
 const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value.error||'OneDrive 요청에 실패했습니다.');return value;
}
export const charterOneDrive={
 status:()=>call('charter-status'),
 configure:(centerCode,url)=>call('charter-config',{centerCode,url}),
 archive:(centerCode,month)=>call('charter-archive',{centerCode,month}),
 read:(centerCode,archiveId)=>call('charter-read',{centerCode,archiveId})
};
