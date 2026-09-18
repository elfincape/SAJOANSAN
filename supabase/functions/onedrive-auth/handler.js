export const FOLDER_KINDS = ['food_transport','livestock_transport','freight_license','vehicle_registration','identity','health_certificate'];
export const LABELS = {food_transport:'식품운반업_앞',food_transport_back:'식품운반업_뒤',livestock_transport:'축산물운반업_앞',livestock_transport_back:'축산물운반업_뒤',freight_license:'화물운송사자격증',vehicle_registration:'차량등록증',identity:'신분증',health_certificate:'보건증'};
export const KINDS = Object.keys(LABELS);
export const folderKind = kind => kind.endsWith('_back') ? kind.slice(0,-5) : kind;
export function filePart(value,fallback) {
  return Array.from(String(value||fallback).normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'-').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'')).slice(0,45).join('') || fallback;
}
export function documentFilename({center,plates,name,company},kind,extension) {
  center=({'001':'안산','002':'평택','사조안산센터':'안산','사조평택센터':'평택'})[center]||center;
  return [filePart(center,'센터미지정'),filePart(plates,'차량미지정'),filePart(name,'기사미지정'),filePart(company,'운수사미지정'),LABELS[kind]].join('_')+'.'+extension;
}
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
    const row=(await db('drivers?select=id,name,company_id,center_code,health_certificate_expires_on&id=eq.'+enc(id),{token:user.token}))[0];
    if(!row)throw fail('해당 기사에 접근할 수 없습니다.',403);
    return row;
  }
  async function naming(user,d) {
    const centerFilter='&center_code=eq.'+enc(d.center_code);
    const [centers,companies,routes]=await Promise.all([
      db('centers?select=name&code=eq.'+enc(d.center_code),{token:user.token}),
      d.company_id?db('companies?select=name&id=eq.'+enc(d.company_id)+centerFilter,{token:user.token}):[],
      db('routes?select=primary_driver_id,secondary_driver_id,primary_vehicle_id,secondary_vehicle_id&active=eq.true'+centerFilter+'&or=(primary_driver_id.eq.'+enc(d.id)+',secondary_driver_id.eq.'+enc(d.id)+')',{token:user.token})
    ]);
    const ids=[...new Set(routes.flatMap(r=>[r.primary_driver_id===d.id?r.primary_vehicle_id:null,r.secondary_driver_id===d.id?r.secondary_vehicle_id:null]).filter(Boolean))];
    const vehicles=ids.length?await db('vehicles?select=plate_number&id=in.('+ids.map(enc).join(',')+')'+centerFilter,{token:user.token}):[];
    return {center:({'001':'안산','002':'평택'})[d.center_code]||centers[0]?.name||d.center_code,company:companies[0]?.name,name:d.name,plates:[...new Set(vehicles.map(v=>v.plate_number).filter(Boolean))].sort().join('+')};
  }
  async function settings(){const s=(await db('onedrive_settings?select=*&id=eq.true'))[0];if(!s||!FOLDER_KINDS.every(k=>s.folders[k]))throw fail('저장 폴더 설정이 필요합니다.',503);return s;}
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
    await Promise.all(FOLDER_KINDS.map(async kind=>{
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
      const user=await caller(req,['start','finish','archive-config'].includes(action));
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
        const data=await db('driver_documents?select=document_type,file_name,uploaded_at,mime_type,size_bytes,request_id&driver_id=eq.'+enc(b.driverId),{token:user.token});
        return json({documents:data});
      }
      if(action==='archive-config'){
        const b=await req.json();
        if(typeof b.url!=='string'||b.url.length>2048)throw fail('보관 폴더 공유 링크를 입력해 주세요.');
        return await withLock(async()=>{
          const config=await settings(),connection=await connected();
          const folder=await (await graph('/shares/'+enc(shareToken(b.url))+'/driveItem',connection.accessToken)).json();
          const driveId=folder.parentReference?.driveId;
          if(!folder.folder||!driveId||String(driveId).toLowerCase()!==config.expected_drive_id.toLowerCase())throw fail('연결된 OneDrive 계정의 폴더를 선택해 주세요.',409);
          if(Object.values(connection.folders).some(f=>f.folderId===folder.id))throw fail('서류 저장 폴더와 다른 보관 폴더를 선택해 주세요.');
          await db('onedrive_settings?id=eq.true',{method:'PATCH',body:{folders:{...config.folders,delete_archive:{driveId,folderId:folder.id}}}});
          return json({configured:true});
        });
      }
      if(action==='remove'){
        const b=await req.json();await driver(user,b.driverId);
        if(!KINDS.includes(b.kind)||typeof b.version!=='string'||!b.version)throw fail('삭제할 사진을 다시 확인해 주세요.');
        return await withLock(async()=>{
          const item=(await db('driver_documents?select=*&driver_id=eq.'+enc(b.driverId)+'&document_type=eq.'+enc(b.kind),{token:user.token}))[0];
          if(!item)return json({removed:true});
          if((item.request_id||item.uploaded_at)!==b.version)throw fail('사진이 변경되었습니다. 새로고침 후 다시 확인해 주세요.',409);
          const destination=(await settings()).folders.delete_archive;
          if(!destination?.driveId||!destination?.folderId)throw fail('관리자가 삭제 보관 폴더를 먼저 설정해 주세요.',409);
          const ARCHIVE_DRIVE=destination.driveId.toUpperCase(),ARCHIVE_FOLDER=destination.folderId;
          if(item.drive_id.toUpperCase()!==ARCHIVE_DRIVE)throw fail('삭제 보관 폴더와 사진의 계정이 다릅니다.',409);
          const connection=await connected();
          const folder=await (await graph('/drives/'+enc(ARCHIVE_DRIVE)+'/items/'+enc(ARCHIVE_FOLDER),connection.accessToken)).json();
          if(!folder.folder||folder.id!==ARCHIVE_FOLDER||String(folder.parentReference?.driveId).toUpperCase()!==ARCHIVE_DRIVE)throw fail('삭제 보관 폴더를 확인할 수 없습니다.',502);
          const path='/drives/'+enc(item.drive_id)+'/items/'+enc(item.item_id);
          const original=await (await graph(path,connection.accessToken)).json();
          if(original.parentReference?.id!==ARCHIVE_FOLDER){
            const dot=item.file_name.lastIndexOf('.');
            const name=(dot<0?item.file_name:item.file_name.slice(0,dot)).slice(0,160)+'_삭제_'+filePart(item.item_id,'사진')+(dot<0?'':item.file_name.slice(dot));
            const moved=await (await graph(path,connection.accessToken,{method:'PATCH',
              headers:{'Content-Type':'application/json',...(original.eTag?{'If-Match':original.eTag}:{})},
              body:JSON.stringify({parentReference:{id:ARCHIVE_FOLDER},name,'@microsoft.graph.conflictBehavior':'fail'})
            })).json();
            if(moved.id!==item.item_id||moved.parentReference?.id!==ARCHIVE_FOLDER)throw fail('사진 이동 결과를 확인하지 못했습니다.',502);
          }
          await driver(user,b.driverId);
          if(item.request_id)await db('onedrive_uploads?request_id=eq.'+enc(item.request_id),{method:'PATCH',body:{status:'archived'}});
          const removed=await db('driver_documents?driver_id=eq.'+enc(b.driverId)+'&document_type=eq.'+enc(b.kind)+'&item_id=eq.'+enc(item.item_id)+'&uploaded_at=eq.'+enc(item.uploaded_at),{method:'DELETE',prefer:'return=representation'});
          if(!removed?.length)throw fail('사진 기록이 변경되었습니다. 새로고침 후 확인해 주세요.',409);
          return json({removed:true});
        });
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
          const connection=await connected(),folder=connection.folders[folderKind(kind)];
          let journal=(await db('onedrive_uploads?select=*&request_id=eq.'+request))[0];
          const filename=journal?.file_name||documentFilename(await naming(user,d),kind,extension);
          if(journal&&(journal.user_id!==user.id||journal.driver_id!==id||journal.kind!==kind||journal.content_hash!==fingerprint))throw fail('기존 업로드 요청과 다릅니다. 사진을 다시 선택해 주세요.',409);
          if(!journal){
            journal={request_id:request,user_id:user.id,driver_id:id,kind,drive_id:folder.driveId,folder_id:folder.folderId,file_name:filename,content_hash:fingerprint};
            await db('onedrive_uploads',{method:'POST',body:journal});
          }
          if(journal.status==='archived')throw fail('이미 삭제한 업로드입니다. 사진을 새로 선택해 주세요.',409);
          if(journal.status==='committed')return json({saved:true});
          const path='/drives/'+enc(journal.drive_id)+'/items/'+enc(journal.folder_id)+':/'+enc(filename);
          const existingResponse=await graph(path,connection.accessToken,{allowMissing:true});
          const existing=existingResponse?await existingResponse.json():null;
          if(existing){
            const owners=await db('driver_documents?select=driver_id,document_type&drive_id=eq.'+enc(journal.drive_id)+'&item_id=eq.'+enc(existing.id));
            if(owners.some(row=>row.driver_id!==id||row.document_type!==kind)||
               (!owners.length&&journal.item_id!==existing.id)){
              throw fail('대상 폴더에 같은 이름의 다른 파일이 있습니다. 파일명을 확인해 주세요.',409);
            }
          }
          // Replace the current document in its category folder, never reuse bytes by size alone.
          const item=await (await graph(path+':/content',connection.accessToken,{method:'PUT',headers:{'Content-Type':mime},body:bytes})).json();
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
