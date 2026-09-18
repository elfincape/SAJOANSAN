import { supabase } from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
async function call(action,body,binary=false) {
  const {data:{session}}=await supabase.auth.getSession();
  if(!session) throw new Error('다시 로그인해 주세요.');
  const multipart=body instanceof FormData;
  const response=await fetch(SUPABASE_URL+'/functions/v1/onedrive-auth/'+action,{
    method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_ANON_KEY,...(multipart?{}:{'Content-Type':'application/json'})},
    body:multipart?body:JSON.stringify(body||{}),signal:AbortSignal.timeout(110000)
  });
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'OneDrive 요청에 실패했습니다.');}
  return binary?response.blob():response.json();
}
export const oneDriveDocuments = {
  status:()=>call('status'),
  list:async driverId=>(await call('list',{driverId})).documents,
  download:(driverId,kind)=>call('download',{driverId,kind},true),
  upload:async ({driverId,kind,file,expiresOn,requestId})=>{
    const form=new FormData();
    form.set('driverId',driverId);form.set('kind',kind);form.set('file',file);
    form.set('expiresOn',expiresOn||'');form.set('requestId',requestId);
    return call('upload',form);
  }
};
export async function connectOneDrive() {
  const result=await call('start');
  const target=new URL(result.authorizationUrl);
  if(target.origin!=='https://login.microsoftonline.com')throw new Error('로그인 주소가 올바르지 않습니다.');
  sessionStorage.setItem('onedrive-proof',JSON.stringify({state:result.state,proof:result.proof,returnPath:location.pathname+location.search}));
  location.assign(result.authorizationUrl);
}
export async function finishOneDrive() {
  const state=new URLSearchParams(location.search).get('onedrive_state');
  if(!state)return false;
  const saved=JSON.parse(sessionStorage.getItem('onedrive-proof')||'null');
  if(!saved||saved.state!==state)throw new Error('연결을 시작한 브라우저에서 다시 로그인해 주세요.');
  await call('finish',{state,proof:saved.proof});
  sessionStorage.removeItem('onedrive-proof');
  const path=String(saved.returnPath||'/admin/drivers.html');
  history.replaceState(null,'',path.startsWith('/admin/drivers.html')?path:'/admin/drivers.html');
  return true;
}
