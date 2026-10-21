import type {readArchive} from '../domain/charter';
import { supabase } from './supabase';
const SUPABASE_URL=import.meta.env.VITE_SUPABASE_URL,SUPABASE_ANON_KEY=import.meta.env.VITE_SUPABASE_ANON_KEY;
async function call<T>(action:string,body?:Record<string,unknown>):Promise<T>{
 const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('다시 로그인해 주세요.');
 const response=await fetch(SUPABASE_URL+'/functions/v1/onedrive-auth/'+action,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(120000)});
 const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value.error||'OneDrive 요청에 실패했습니다.');return value as T;
}
export const charterOneDrive={
 status:()=>call<{connected?:boolean}>('charter-status'),
 configure:(centerCode:string,url:string)=>call('charter-config',{centerCode,url}),
 archive:(centerCode:string,month:string)=>call<{id:string;count:number}>('charter-archive',{centerCode,month}),
 read:(centerCode:string,archiveId:string)=>call<Parameters<typeof readArchive>[0]>('charter-read',{centerCode,archiveId})
};
