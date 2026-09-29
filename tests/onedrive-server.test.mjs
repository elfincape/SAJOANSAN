import assert from 'node:assert/strict';
import {makeHandler,validDate,imageType,shareToken,hash,documentFilename,folderKind,KINDS} from '../supabase/functions/onedrive-auth/handler.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-anon',ONEDRIVE_CLIENT_ID:'56899a37-25c3-43e2-b006-6e001d538185',ONEDRIVE_CLIENT_SECRET:'test-secret'};
const id='00000000-0000-4000-8000-000000000001',uid='00000000-0000-4000-8000-000000000002';
const kinds=['food_transport','livestock_transport','freight_license','vehicle_registration','identity','health_certificate'];
let role='admin',active=true,visible=true,oauth,connection,journal,document,commits=0,puts=0,locked=false,dbFail=false,graphFail=false;
const graphFiles=new Map(),graphFolders=new Map();
const result=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
async function fake(input,options={}){
 const url=new URL(input),p=url.pathname,b=typeof options.body==='string'?JSON.parse(options.body):null;
 if(p==='/auth/v1/user')return result(options.headers.Authorization==='Bearer user'?{id:uid}:{},options.headers.Authorization==='Bearer user'?200:401);
 if(p.startsWith('/rest/v1/')){
   const table=p.slice('/rest/v1/'.length),method=options.method||'GET';
   if(table==='user_profiles')return result([{id:uid,role,active}]);
   if(table==='drivers')return result(visible?[{id,name:'홍길동',company_id:'company',center_code:'002'}]:[]);
   if(table==='driver_documents'&&options.headers.Authorization==='Bearer user')return result(document?[document]:[]);
   if(['centers','companies','routes','vehicles'].includes(table)){
     assert.equal(options.headers.Authorization,'Bearer user');
     if(table==='centers')return result([{name:'사조평택센터'}]);
     if(table==='companies'){
       const companyId=url.searchParams.get('id');
       if(companyId==='eq.00000000-0000-4000-8000-000000000005')return result([{name:'새운수사'}]);
       if(companyId==='eq.company')return result([{name:'이안물류'}]);
       return result([]);
     }
     if(table==='routes')return result([{primary_driver_id:id,primary_vehicle_id:'vehicle'}]);
     return result([{plate_number:'경기80바1234'}]);
   }
   assert.equal(options.headers.Authorization,'Bearer test-service','private DB reads must use server credential');
   if(table==='onedrive_settings')return result([{expected_drive_id:'drive',folders:Object.fromEntries(kinds.map(k=>[k,'https://1drv.ms/'+k]))}]);
   if(table==='onedrive_oauth'){
     if(method==='POST'){oauth=b;return result(null);}
     if(method==='DELETE')return result(null);
     if(method==='PATCH'){
       if(url.searchParams.has('stage')&&(!oauth||oauth.stage!=='started'||url.searchParams.get('state_hash')!=='eq.'+oauth.state_hash))return result([]);
       oauth={...oauth,...b};return result([oauth]);
     }
   }
   if(table==='onedrive_connection'){if(method==='PATCH'){connection={...connection,...b};return result(null);}return result(connection?[connection]:[]);}
   if(table==='rpc/onedrive_acquire')return result(!locked);
   if(table==='onedrive_locks')return result(null);
   if(table==='rpc/onedrive_finish_oauth'){
     const ok=oauth&&oauth.stage==='ready'&&oauth.state_hash===b.p_state&&oauth.proof_hash===b.p_proof&&oauth.user_id===b.p_user;
     if(ok){connection={encrypted_tokens:oauth.encrypted_data};oauth=null;}
     return result(!!ok);
   }
   if(table==='driver_documents')return result(document&&(!url.searchParams.has('request_id')||url.searchParams.get('request_id')==='eq.'+document.request_id)?[document]:[]);
   if(table==='onedrive_uploads'){
     if(method==='POST'){journal=b;return result(null);}
     if(method==='PATCH'){journal={...journal,...b};return result(null);}
     return result(journal?[journal]:[]);
   }
   if(table==='rpc/onedrive_commit_document'){
     if(dbFail)return result({},500);
     commits++;document={driver_id:b.p_driver,document_type:b.p_kind,uploaded_by:b.p_user,request_id:b.p_request,drive_id:'drive',item_id:'item',mime_type:'image/png'};
     assert.equal(b.p_expiry,'2027-01-01');return result(null);
   }
   throw Error('unexpected DB '+table);
 }
 if(url.hostname==='login.microsoftonline.com')return result({access_token:'access-token',refresh_token:'refresh-token',expires_in:3600});
 if(url.hostname==='graph.microsoft.com'){
   if(graphFail)return result({},429);
   if(p==='/v1.0/me/drive')return result({id:'drive'});
   if(p.startsWith('/v1.0/shares/'))return result({id:'folder',folder:{},parentReference:{driveId:'drive'}});
   if(p==='/v1.0/drives/drive/items/item/content'){
     assert.equal(options.headers.Authorization,'Bearer access-token');
     return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
   }
   if(options.method==='POST'&&p.endsWith('/children')){
     assert.fail('Uploads must not create subfolders');
     const folder={id:'upload-folder',folder:{}};
     graphFolders.set(p.replace(/\/children$/,':/'+encodeURIComponent(b.name)),folder);
     return result(folder);
   }
   if(graphFolders.has(p))return result(graphFolders.get(p));
   if(options.method==='PUT'){puts++;const item={id:'item',size:12};graphFiles.set(p.replace(/:\/content$/,''),item);return result(item);}
   if(graphFiles.has(p))return result(graphFiles.get(p));
   return result({},404);
 }
 throw Error('Unexpected fetch '+url);
}
const handler=makeHandler(env,fake);
const request=(action,body={},headers={})=>new Request(env.SUPABASE_URL+'/functions/v1/onedrive-auth/'+action,{method:'POST',headers:{Authorization:'Bearer user','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
assert.equal((await handler(request('status',{}, {Authorization:''}))).status,401);
role='viewer';assert.equal((await handler(request('status'))).status,403);
role='editor';assert.equal((await handler(request('start'))).status,403);
role='admin';active=false;assert.equal((await handler(request('start'))).status,403);active=true;
assert.equal((await handler(request('status',{}, {Origin:'https://attacker.example'}))).status,403);
const start=await (await handler(request('start'))).json();
assert.equal(new URL(start.authorizationUrl).searchParams.get('code_challenge_method'),'S256');
assert(!oauth.encrypted_data.includes('verifier'));
const callback=new Request(env.SUPABASE_URL+'/functions/v1/onedrive-auth/callback?state='+start.state+'&code=test');
assert.equal((await handler(callback)).status,303);
assert(!oauth.encrypted_data.includes('refresh-token'));
assert.equal((await handler(callback)).status,400,'OAuth state must be consumed once');
assert.equal((await handler(request('finish',{state:start.state,proof:'wrong'}))).status,409);
assert.equal((await handler(request('finish',{state:start.state,proof:start.proof}))).status,200);
assert.equal((await handler(request('finish',{state:start.state,proof:start.proof}))).status,409);
assert.equal((await (await handler(request('status'))).json()).connected,true);
function upload(bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]),type='image/png',expiry='2027-01-01',requestId='00000000-0000-4000-8000-000000000003',companyId){
 const form=new FormData();
 form.set('driverId',id);form.set('kind','health_certificate');form.set('expiresOn',expiry);
 form.set('requestId',requestId);form.set('file',new File([bytes],'private-name.png',{type}));
 if(companyId!==undefined)form.set('companyId',companyId);
 return new Request(env.SUPABASE_URL+'/functions/v1/onedrive-auth/upload',{method:'POST',headers:{Authorization:'Bearer user'},body:form});
}
visible=false;assert.equal((await handler(upload())).status,403);visible=true;
assert.equal((await handler(upload(new Uint8Array([1,2,3])))).status,400);
assert.equal((await handler(upload(undefined,'image/png','2026-02-29'))).status,400);
locked=true;assert.equal((await handler(upload())).status,409);locked=false;
graphFail=true;assert.equal((await handler(upload())).status,429);graphFail=false;
dbFail=true;assert.equal((await handler(upload())).status,502);assert.equal(commits,0);dbFail=false;
assert.equal((await handler(upload())).status,200);
assert.equal(commits,1);
assert.equal(puts,2,'retry must write the supplied bytes, never trust file size alone');
assert.equal((await handler(upload())).status,200);assert.equal(commits,1,'repeated request must not commit twice');
assert(!journal.file_name.includes('private-name'));
assert.equal(journal.file_name,'평택_경기80바1234_홍길동_이안물류_보건증.png');
const downloaded=await handler(request('download',{driverId:id,kind:'health_certificate',version:'00000000-0000-4000-8000-000000000003'}));
assert.equal(downloaded.status,200);
assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),new Uint8Array([137,80,78,71]));
assert.equal((await handler(request('download',{driverId:id,kind:'health_certificate',version:'old'}))).status,409);
assert.equal(graphFolders.size,0);
assert([...graphFiles.keys()].every(p=>p.startsWith('/v1.0/drives/drive/items/folder:/')),'files must be direct children of configured folder');
journal=null;
const changed=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]);
assert.equal((await handler(upload(changed,'image/png','2027-01-01','00000000-0000-4000-8000-000000000004'))).status,200);
assert.equal(puts,3,'same-size replacement must upload the new image');
assert.equal(commits,2);
journal=null;
assert.equal((await handler(upload(changed,'image/png','2027-01-01','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000005'))).status,200);
assert.match(journal.file_name,/_새운수사_보건증\.png$/);
journal=null;
assert.equal((await handler(upload(changed,'image/png','2027-01-01','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008'))).status,400);
assert.equal(documentFilename({center:'001',name:'기사'},'identity','png'),'안산_차량미지정_기사_운수사미지정_신분증.png');
assert.equal(documentFilename({center:'002',name:'기사'},'health_certificate','jpg'),'평택_차량미지정_기사_운수사미지정_보건증.jpg');
assert.equal(KINDS.length,8);
assert.equal(folderKind('food_transport_back'),'food_transport');
assert.equal(folderKind('livestock_transport_back'),'livestock_transport');
assert.equal(documentFilename({center:'안산',plates:'123가4567',name:'김기사',company:'운수사'},'food_transport','jpg'),'안산_123가4567_김기사_운수사_식품운반업_앞.jpg');
assert.equal(documentFilename({center:'평택',plates:'123가4567',name:'김기사',company:'운수사'},'livestock_transport_back','png'),'평택_123가4567_김기사_운수사_축산물운반업_뒤.png');
assert.equal(documentFilename({center:'평택',name:'김기사'},'identity','jpg'),'평택_차량미지정_김기사_운수사미지정_신분증.jpg');
assert(!documentFilename({center:'a/b',name:'../a:b*',company:'c?d'},'identity','jpg').match(/[\\/:*?"<>|]/));
assert(validDate('2028-02-29'));assert(!validDate('2026-02-29'));
assert.throws(()=>imageType(new TextEncoder().encode('<svg>')));
assert.throws(()=>shareToken('https://attacker.example/path'));
assert.equal(await hash('abc'),'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
console.log('OneDrive auth, CSRF/browser proof, roles, encrypted tokens, upload validation, retry and DB failure tests passed');
