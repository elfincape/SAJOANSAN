import assert from 'node:assert/strict';
import {makeHandler,validDate,imageType,shareToken,hash} from '../supabase/functions/onedrive-auth/handler.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-anon',ONEDRIVE_CLIENT_ID:'56899a37-25c3-43e2-b006-6e001d538185',ONEDRIVE_CLIENT_SECRET:'test-secret'};
const id='00000000-0000-4000-8000-000000000001',uid='00000000-0000-4000-8000-000000000002';
const kinds=['food_transport','livestock_transport','freight_license','vehicle_registration','identity','health_certificate'];
let role='admin',active=true,visible=true,oauth,connection,journal,document,commits=0,puts=0,locked=false,dbFail=false,graphFail=false;
const result=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
async function fake(input,options={}){
 const url=new URL(input),p=url.pathname,b=typeof options.body==='string'?JSON.parse(options.body):null;
 if(p==='/auth/v1/user')return result(options.headers.Authorization==='Bearer user'?{id:uid}:{},options.headers.Authorization==='Bearer user'?200:401);
 if(p.startsWith('/rest/v1/')){
   const table=p.slice('/rest/v1/'.length),method=options.method||'GET';
   if(table==='user_profiles')return result([{id:uid,role,active}]);
   if(table==='drivers')return result(visible?[{id,center_code:'002'}]:[]);
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
   if(table==='driver_documents')return result(document?[document]:[]);
   if(table==='onedrive_uploads'){
     if(method==='POST'){journal=b;return result(null);}
     if(method==='PATCH'){journal={...journal,...b};return result(null);}
     return result(journal?[journal]:[]);
   }
   if(table==='rpc/onedrive_commit_document'){
     if(dbFail)return result({},500);
     commits++;document={driver_id:b.p_driver,document_type:b.p_kind,uploaded_by:b.p_user};
     assert.equal(b.p_expiry,'2027-01-01');return result(null);
   }
   throw Error('unexpected DB '+table);
 }
 if(url.hostname==='login.microsoftonline.com')return result({access_token:'access-token',refresh_token:'refresh-token',expires_in:3600});
 if(url.hostname==='graph.microsoft.com'){
   if(graphFail)return result({},429);
   if(p==='/v1.0/me/drive')return result({id:'drive'});
   if(p.startsWith('/v1.0/shares/'))return result({id:'folder',folder:{},parentReference:{driveId:'drive'}});
   if(options.method==='PUT'){puts++;return result({id:'item',size:12});}
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
function upload(bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]),type='image/png',expiry='2027-01-01'){
 const form=new FormData();
 form.set('driverId',id);form.set('kind','health_certificate');form.set('expiresOn',expiry);
 form.set('requestId','00000000-0000-4000-8000-000000000003');form.set('file',new File([bytes],'private-name.png',{type}));
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
assert.equal((await handler(upload())).status,200);assert.equal(commits,1,'repeated request must not commit twice');
assert(!journal.file_name.includes('private-name'));
assert(validDate('2028-02-29'));assert(!validDate('2026-02-29'));
assert.throws(()=>imageType(new TextEncoder().encode('<svg>')));
assert.throws(()=>shareToken('https://attacker.example/path'));
assert.equal(await hash('abc'),'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
console.log('OneDrive auth, CSRF/browser proof, roles, encrypted tokens, upload validation, retry and DB failure tests passed');
