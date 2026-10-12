export function normalizeUsername(value){return String(value??'').trim().toLowerCase();}
export function validUsername(value){return /^[a-z0-9가-힣][a-z0-9가-힣_.-]{2,31}$/.test(normalizeUsername(value));}
export async function accountRequest(supabase,body){
 const {data,error}=await supabase.functions.invoke('username-auth',{body});
 if(error){
  let message;
  try{message=(await error.context.json()).error;}catch{}
  throw new Error(message||'계정 처리에 실패했습니다. 잠시 후 다시 시도하세요.');
 }
 if(data?.error)throw new Error(data.error);
 return data;
}
export async function signInWithUsername(supabase,identifier,password){
 if(identifier.includes('@'))return supabase.auth.signInWithPassword({email:identifier,password});
 if(!validUsername(identifier))return {error:{message:'아이디는 3~32자의 영문, 숫자, 한글, _, ., -를 사용하세요.'}};
 try{
  const data=await accountRequest(supabase,{action:'login',username:normalizeUsername(identifier),password});
  if(!data?.session?.access_token||!data?.session?.refresh_token)throw new Error('로그인 응답을 확인하지 못했습니다.');
  return await supabase.auth.setSession(data.session);
 }catch(error){return {error};}
}
