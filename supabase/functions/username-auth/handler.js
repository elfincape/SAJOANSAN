const usernamePattern=/^[a-z0-9가-힣][a-z0-9가-힣_.-]{2,31}$/;
export function normalizeUsername(value){return String(value??'').trim().toLowerCase();}
export function makeHandler(env,createClient){
 const url=env.SUPABASE_URL,serviceKey=env.SUPABASE_SERVICE_ROLE_KEY,anonKey=env.SUPABASE_ANON_KEY;
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(url,serviceKey,options);
 return async request=>{
  const origin=request.headers.get('origin')||'';
  const allowed=origin==='https://sajoansan.vercel.app'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
   ...(allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
  const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers});
  if(origin&&!allowed)return reply(403,{error:'허용되지 않은 요청입니다.'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'POST 요청만 가능합니다.'});
  try{
   if(Number(request.headers.get('content-length'))>8192)return reply(413,{error:'요청이 너무 큽니다.'});
   const body=await request.json(),username=normalizeUsername(body.username);
   if(!usernamePattern.test(username))return reply(400,{error:'아이디는 3~32자의 영문, 숫자, 한글, _, ., -를 사용하세요.'});
   if(body.action==='create'){
    const bearer=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
    if(!bearer)return reply(401,{error:'로그인이 필요합니다.'});
    const {data:auth,error:authError}=await admin.auth.getUser(bearer);
    if(authError||!auth?.user)return reply(401,{error:'로그인이 필요합니다.'});
    const {data:actor}=await admin.from('user_profiles').select('role,active').eq('id',auth.user.id).maybeSingle();
    if(!actor?.active||actor.role!=='admin')return reply(403,{error:'관리자만 계정을 생성할 수 있습니다.'});
    if(!['viewer','editor','admin'].includes(body.role)||typeof body.password!=='string'||body.password.length<8||body.password.length>256)
      return reply(400,{error:'역할을 확인하고 비밀번호를 8자 이상 입력하세요.'});
    const {data:existing,error:lookupError}=await admin.from('user_profiles').select('id').eq('username',username).maybeSingle();
    if(lookupError)throw lookupError;
    if(existing)return reply(409,{error:'이미 사용 중인 아이디입니다.'});
    const email=crypto.randomUUID()+'@accounts.sajoansan.vercel.app';
    const {data:created,error:createError}=await admin.auth.admin.createUser({email,password:body.password,email_confirm:true,user_metadata:{display_name:String(body.display_name||'').slice(0,100)}});
    if(createError)return reply(400,{error:'계정 생성에 실패했습니다. 비밀번호 조건을 확인하세요.'});
    const profile={id:created.user.id,email,username,display_name:String(body.display_name||'').slice(0,100)||null,role:body.role,active:body.active!==false};
    const {data:saved,error:saveError}=await admin.from('user_profiles').upsert(profile).select().single();
    if(saveError){await admin.auth.admin.deleteUser(created.user.id);return reply(saveError.code==='23505'?409:500,{error:saveError.code==='23505'?'이미 사용 중인 아이디입니다.':'사용자 등록에 실패했습니다.'});}
    return reply(200,{profile:saved});
   }
   if(body.action!=='login'||typeof body.password!=='string'||!body.password||body.password.length>256)return reply(400,{error:'아이디와 비밀번호를 입력하세요.'});
   const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
   const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const keys=[await hash('ip:'+ip),await hash('username:'+username)].sort();
   const {data:permit,error:limitError}=await admin.rpc('account_login_attempt',{p_keys:keys});
   if(limitError)throw limitError;
   if(!permit)return reply(429,{error:'로그인 시도가 너무 많습니다. 5분 후 다시 시도하세요.'});
   const {data:email,error:lookupError}=await admin.rpc('account_login_email',{p_username:username});
   if(lookupError)throw lookupError;
   // Unknown IDs still perform a password grant, with the same error response.
   const client=createClient(url,anonKey,options);
   const {data,error}=await client.auth.signInWithPassword({email:email||'missing-account@accounts.sajoansan.vercel.app',password:body.password});
   if(error||!email||!data?.session)return reply(401,{error:'아이디 또는 비밀번호가 올바르지 않습니다.'});
   return reply(200,{session:{access_token:data.session.access_token,refresh_token:data.session.refresh_token}});
  }catch{return reply(500,{error:'계정 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.'});}
 };
}
