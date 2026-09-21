import { prepareCompilation } from './driver-pdf.js';
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
  if(!response.ok){const error=await response.json().catch(()=>({}));throw Object.assign(new Error(error.error||'OneDrive 요청에 실패했습니다.'),{status:response.status});}
  return binary?response.blob():response.json();
}
export const oneDriveDocuments = {
  status:()=>call('status'),
  configureArchive:url=>call('archive-config',{url}),
  configurePdf:url=>call('pdf-config',{url}),
  compilePdf:async(driverId,onProgress)=>{
    const {versions,images}=await prepareCompilation(oneDriveDocuments,driverId,onProgress);
    const form=new FormData();form.set('driverId',driverId);form.set('versions',JSON.stringify(versions));
    for(const [kind,blob] of images)form.set(kind,blob,kind+'.jpg');
    onProgress?.('PDF 생성 및 OneDrive 저장 중…');
    return call('compile-pdf',form);
  },
  remove:(driverId,kind,version)=>call('remove',{driverId,kind,version}),
  list:async driverId=>(await call('list',{driverId})).documents,
  download:(driverId,kind,version)=>call('download',{driverId,kind,version},true),
  upload:async ({driverId,kind,file,expiresOn,requestId})=>{
    const form=new FormData();
    form.set('driverId',driverId);form.set('kind',kind);form.set('file',file);
    form.set('expiresOn',expiresOn||'');form.set('requestId',requestId);
    for(let attempt=0;;attempt++){
      try{return await call('upload',form);}
      catch(error){
        if(attempt>=2||![409,429,502,503].includes(error.status))throw error;
        await new Promise(resolve=>setTimeout(resolve,1500*(attempt+1)));
      }
    }
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
