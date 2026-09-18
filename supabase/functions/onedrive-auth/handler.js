export const KINDS = ['food_transport','livestock_transport','freight_license','vehicle_registration','identity','health_certificate'];
const SITE = 'https://sajoansan.vercel.app';
const CLIENT_ID = '56899a37-25c3-43e2-b006-6e001d538185';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const LIMIT = 10 * 1024 * 1024;
const enc = encodeURIComponent;
export function fail(message,status=400){return Object.assign(new Error(message),{status});}
export function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s||'') && !isNaN(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
export function imageType(bytes) {
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255) return ['image/jpeg','jpg'];
  if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) return ['image/png','png'];
  if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP') return ['image/webp','webp'];
  throw fail('JPG, PNG, WEBP 사진만 업로드할 수 있습니다.');
}
export function base64url(bytes){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export async function hash(value){return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)));}
export function shareToken(url) {
  const u=new URL(url);
  if(u.protocol!=='https:'||!['1drv.ms','onedrive.live.com'].includes(u.hostname)) throw fail('저장 폴더 설정이 올바르지 않습니다.',503);
  return 'u!'+base64url(new TextEncoder().encode(url));
}
export function makeHandler(env, fetcher=fetch) {
  const root=env.SUPABASE_URL, service=env.SUPABASE_SERVICE_ROLE_KEY, anon=env.SUPABASE_ANON_KEY;
  const redirect=root+'/functions/v1/onedrive-auth/callback';
  const cors={'Access-Control-Allow-Origin':SITE,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
  const key=()=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(service+':onedrive-tokens:v1')).then(k=>crypto.subtle.importKey('raw',k,'AES-GCM',false,['encrypt','decrypt']));
  async function seal(value) {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(),new TextEncoder().encode(JSON.stringify(value)));
    return base64url(iv)+'.'+base64url(new Uint8Array(bytes));
  }
  async function open(value) {
    const decode=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
    const [iv,data]=value.split('.');
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv)},await key(),decode(data))));
  }
  async function db(path,{method='GET',body,token=service,prefer}={}) {
    const response=await fetcher(root+'/rest/v1/'+path,{method,headers:{apikey:token===service?service:anon,Authorization:'Bearer '+token,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw fail('데이터베이스 처리에 실패했습니다. 설정 또는 접근 권한을 확인해 주세요.',502);
    const text=await response.text();return text?JSON.parse(text):null;
  }
  async function caller(req,admin=false) {
    const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if(!token) throw fail('로그인이 필요합니다.',401);
    const res=await fetcher(root+'/auth/v1/user',{headers:{apikey:anon,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
    if(!res.ok) throw fail('다시 로그인해 주세요.',401);
    const user=await res.json();
    const p=(await db('user_profiles?select=id,role,active&id=eq.'+enc(user.id),{token}))[0];
    if(!p?.active||!(admin?['admin']:['admin','editor']).includes(p.role)) throw fail('권한이 없습니다.',403);
    return {id:user.id,token,role:p.role};
  }
  async function driver(user,id) {
    if(!/^[0-9a-f-]{36}$/i.test(id||''))throw fail('기사를 선택해 주세요.');
    const row=(await db('drivers?select=id,center_code,health_certificate_expires_on&id=eq.'+enc(id),{token:user.token}))[0];
    if(!row)throw fail('해당 기사에 접근할 수 없습니다.',403);
    return row;
  }
  async function settings(){const s=(await db('onedrive_settings?select=*&id=eq.true'))[0];if(!s||!KINDS.every(k=>s.folders[k]))throw fail('저장 폴더 설정이 필요합니다.',503);return s;}
  async function grant(body) {
    if(env.ONEDRIVE_CLIENT_ID!==CLIENT_ID||!env.ONEDRIVE_CLIENT_SECRET) throw fail('OneDrive 앱 설정을 확인해 주세요.',503);
    const res=await fetcher(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:CLIENT_ID,client_secret:env.ONEDRIVE_CLIENT_SECRET,redirect_uri:redirect,...body}),signal:AbortSignal.timeout(20000)});
    if(!res.ok)throw fail('OneDrive 인증에 실패했습니다. 관리자가 다시 연결해 주세요.',409);
    return await res.json();
  }
  async function graph(path,access,options={}) {
    const res=await fetcher(GRAPH+path,{...options,headers:{Authorization:'Bearer '+access,...options.headers},signal:AbortSignal.timeout(30000)});
    if(!res.ok){
      if(res.status===404&&options.allowMissing)return null;
      if(res.status===429)throw fail('OneDrive 요청이 많습니다. 잠시 후 다시 시도해 주세요.',429);
      throw fail('OneDrive 처리에 실패했습니다. 연결과 폴더 권한을 확인해 주세요.',502);
    }
    return res;
  }
  async function withLock(action) {
    const holder=crypto.randomUUID();
    if(!await db('rpc/onedrive_acquire',{method:'POST',body:{p_holder:holder}})) throw fail('다른 서류를 처리 중입니다. 잠시 후 다시 시도해 주세요.',409);
    try{return await action(holder);}finally{await db('onedrive_locks?name=eq.connection&holder=eq.'+holder,{method:'DELETE'}).catch(()=>{});}
  }
  async function connected() {
    const row=(await db('onedrive_connection?select=*&id=eq.true'))[0];
    if(!row)throw fail('관리자가 OneDrive를 먼저 연결해 주세요.',409);
    const data=await open(row.encrypted_tokens);
    if(data.expiresAt<Date.now()+60000){
      const fresh=await grant({grant_type:'refresh_token',refresh_token:data.refreshToken,scope:'offline_access Files.ReadWrite'});
      data.accessToken=fresh.access_token; data.refreshToken=fresh.refresh_token||data.refreshToken; data.expiresAt=Date.now()+fresh.expires_in*1000;
      await db('onedrive_connection?id=eq.true',{method:'PATCH',body:{encrypted_tokens:await seal(data),updated_at:new Date().toISOString()}});
    }
    return data;
  }
  async function callback(url){
    const state=url.searchParams.get('state');
    if(!state||state.length>128)throw fail('인증 요청이 유효하지 않습니다.');
    const stateHash=await hash(state);
    const pending=(await db('onedrive_oauth?state_hash=eq.'+enc(stateHash)+'&stage=eq.started&expires_at=gt.'+enc(new Date().toISOString()),{method:'PATCH',body:{stage:'exchanging'},prefer:'return=representation'}))[0];
    if(!pending||url.searchParams.has('error'))throw fail('로그인이 취소되었거나 만료되었습니다. 기사관리에서 다시 연결해 주세요.');
    const {verifier}=await open(pending.encrypted_data);
    const code=url.searchParams.get('code');if(!code)throw fail('인증 코드가 없습니다.');
    const tokens=await grant({grant_type:'authorization_code',code,code_verifier:verifier});
    const config=await settings();
    const drive=await (await graph('/me/drive',tokens.access_token)).json();
    if(String(drive.id).toLowerCase()!==config.expected_drive_id.toLowerCase())throw fail('지정한 OneDrive 소유자 계정으로 로그인해 주세요.',403);
    const folders={};
    await Promise.all(KINDS.map(async kind=>{
      const item=await (await graph('/shares/'+enc(shareToken(config.folders[kind]))+'/driveItem',tokens.access_token)).json();
      if(!item.folder||String(item.parentReference?.driveId).toLowerCase()!==String(drive.id).toLowerCase())throw fail('지정 폴더를 확인할 수 없습니다.',403);
      folders[kind]={driveId:item.parentReference.driveId,folderId:item.id};
    }));
    if(!tokens.refresh_token)throw fail('오프라인 접근 동의가 필요합니다.',409);
    const payload={accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expiresAt:Date.now()+tokens.expires_in*1000,folders};
    await db('onedrive_oauth?state_hash=eq.'+enc(stateHash),{method:'PATCH',body:{encrypted_data:await seal(payload),stage:'ready'}});
    // No tokens in URLs. The initiating browser must still prove possession.
    return Response.redirect(SITE+'/admin/drivers.html?onedrive_state='+enc(state),303);
  }
  return async req=>{
    const url=new URL(req.url),action=url.pathname.split('/').filter(Boolean).at(-1);
    const origin=req.headers.get('origin');
    if(origin&&origin!==SITE)return json({error:'허용되지 않은 출처입니다.'},403);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    try {
      if(!root||!service||!anon)throw fail('서버 설정이 필요합니다.',503);
      if(action==='callback'&&req.method==='GET')return await callback(url);
      if(req.method!=='POST')return json({error:'POST 요청이 필요합니다.'},405);
      const user=await caller(req,['start','finish'].includes(action));
      if(action==='start'){
        await settings();
        if(env.ONEDRIVE_CLIENT_ID!==CLIENT_ID||!env.ONEDRIVE_CLIENT_SECRET)throw fail('OneDrive 앱 설정이 필요합니다.',503);
        const state=base64url(crypto.getRandomValues(new Uint8Array(32))),proof=base64url(crypto.getRandomValues(new Uint8Array(32))),verifier=base64url(crypto.getRandomValues(new Uint8Array(32)));
        await db('onedrive_oauth?expires_at=lt.'+enc(new Date().toISOString()),{method:'DELETE'});
        await db('onedrive_oauth',{method:'POST',body:{state_hash:await hash(state),proof_hash:await hash(proof),user_id:user.id,stage:'started',encrypted_data:await seal({verifier}),expires_at:new Date(Date.now()+600000).toISOString()}});
        const query=new URLSearchParams({client_id:CLIENT_ID,response_type:'code',redirect_uri:redirect,response_mode:'query',scope:'offline_access Files.ReadWrite',state,code_challenge:await hash(verifier),code_challenge_method:'S256',prompt:'select_account'});
        return json({state,proof,authorizationUrl:'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?'+query});
      }
      if(action==='status'){
        const row=(await db('onedrive_connection?select=updated_at&id=eq.true'))[0];
        return json({connected:!!row,updatedAt:row?.updated_at||null,canConnect:user.role==='admin'});
      }
      if(action==='finish'){
        const b=await req.json();
        if(typeof b.state!=='string'||typeof b.proof!=='string'||b.state.length>128||b.proof.length>128)throw fail('인증 정보가 없습니다.');
        return await withLock(async()=>{
          const ok=await db('rpc/onedrive_finish_oauth',{method:'POST',body:{p_state:await hash(b.state),p_proof:await hash(b.proof),p_user:user.id}});
          if(!ok)throw fail('연결 요청이 만료되었거나 다른 브라우저입니다. 다시 연결해 주세요.',409);
          return json({connected:true});
        });
      }
      if(action==='list'){
        const b=await req.json();await driver(user,b.driverId);
        const data=await db('driver_documents?select=document_type,file_name,uploaded_at,mime_type,size_bytes&driver_id=eq.'+enc(b.driverId),{token:user.token});
        return json({documents:data});
      }
      if(action==='download'){
        const b=await req.json();await driver(user,b.driverId);
        if(!KINDS.includes(b.kind))throw fail('서류 종류가 올바르지 않습니다.');
        const item=(await db('driver_documents?select=drive_id,item_id,mime_type&driver_id=eq.'+enc(b.driverId)+'&document_type=eq.'+enc(b.kind),{token:user.token}))[0];
        if(!item)throw fail('저장된 사진이 없습니다.',404);
        return await withLock(async()=>{
          const connection=await connected();
          const meta=await (await graph('/drives/'+enc(item.drive_id)+'/items/'+enc(item.item_id),connection.accessToken)).json();
          const target=new URL(meta['@microsoft.graph.downloadUrl']||'https://invalid.invalid');
          if(target.protocol!=='https:'||!/(^|\.)(1drv\.com|onedrive\.live\.com|sharepoint\.com)$/.test(target.hostname))throw fail('사진 주소를 확인할 수 없습니다.',502);
          const res=await fetcher(target,{signal:AbortSignal.timeout(30000)});
          if(!res.ok)throw fail('사진을 불러오지 못했습니다.',502);
          return new Response(res.body,{headers:{...cors,'Content-Type':item.mime_type,'X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
        });
      }
      if(action==='upload'){
        if(Number(req.headers.get('content-length'))>LIMIT+65536)throw fail('사진은 10MB 이하만 가능합니다.',413);
        const form=await req.formData(),id=String(form.get('driverId')||''),kind=String(form.get('kind')||''),request=String(form.get('requestId')||''),expiry=String(form.get('expiresOn')||'');
        const d=await driver(user,id);
        if(!KINDS.includes(kind)||!/^[0-9a-f-]{36}$/i.test(request))throw fail('업로드 정보가 올바르지 않습니다.');
        if(kind==='health_certificate'&&!validDate(expiry))throw fail('보건증 만료일을 입력해 주세요.');
        const file=form.get('file');
        if(!(file instanceof File)||file.size===0||file.size>LIMIT)throw fail('사진은 10MB 이하만 가능합니다.',413);
        const bytes=new Uint8Array(await file.arrayBuffer()),[mime,extension]=imageType(bytes);
        if(file.type!==mime)throw fail('파일 내용과 사진 형식이 일치하지 않습니다.');
        const fingerprint=await hash(bytes);
        return await withLock(async holder=>{
          const completed=(await db('driver_documents?select=driver_id,document_type,uploaded_by&request_id=eq.'+request))[0];
          if(completed){
            if(completed.driver_id!==id||completed.document_type!==kind||completed.uploaded_by!==user.id)throw fail('업로드 요청이 일치하지 않습니다.',409);
            return json({saved:true});
          }
          const connection=await connected(),folder=connection.folders[kind];
          let journal=(await db('onedrive_uploads?select=*&request_id=eq.'+request))[0];
          const filename=d.center_code+'_'+id+'_'+request+'_'+fingerprint+'.'+extension;
          if(journal&&(journal.user_id!==user.id||journal.driver_id!==id||journal.kind!==kind||journal.file_name!==filename))throw fail('기존 업로드 요청과 다릅니다. 사진을 다시 선택해 주세요.',409);
          if(!journal){
            journal={request_id:request,user_id:user.id,driver_id:id,kind,drive_id:folder.driveId,folder_id:folder.folderId,file_name:filename};
            await db('onedrive_uploads',{method:'POST',body:journal});
          }
          const path='/drives/'+enc(journal.drive_id)+'/items/'+enc(journal.folder_id)+':/'+enc(filename);
          const existing=await graph(path,connection.accessToken,{allowMissing:true});
          const item=existing?await existing.json():await (await graph(path+':/content',connection.accessToken,{method:'PUT',headers:{'Content-Type':mime},body:bytes})).json();
          if(item.size!==file.size)throw fail('저장 파일 크기를 확인할 수 없습니다.',502);
          await db('onedrive_uploads?request_id=eq.'+request,{method:'PATCH',body:{item_id:item.id}});
          // Recheck caller visibility after external I/O.
          await driver(user,id);
          await db('rpc/onedrive_commit_document',{method:'POST',body:{p_user:user.id,p_driver:id,p_kind:kind,p_drive:journal.drive_id,p_item:item.id,p_filename:filename,p_mime:mime,p_size:file.size,p_expiry:kind==='health_certificate'?expiry:null,p_request:request,p_holder:holder}});
          return json({saved:true});
        });
      }
      return json({error:'지원하지 않는 요청입니다.'},404);
    } catch(error) {
      // Never serialize upstream errors, OAuth codes, tokens, file names or URLs.
      const message=error.status?error.message:'처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
      if(action==='callback')return new Response(message,{status:error.status||500,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
      return json({error:message},error.status||500);
    }
  };
}
