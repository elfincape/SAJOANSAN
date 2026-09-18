import assert from 'node:assert/strict';
import {makeHandler,base64url} from '../supabase/functions/onedrive-auth/handler.js';
const root='https://example.supabase.co',drive='TESTDRIVE',archive='archive-test-folder';
const user='00000000-0000-4000-8000-000000000001',driver='00000000-0000-4000-8000-000000000002';
const env={SUPABASE_URL:root,SUPABASE_SERVICE_ROLE_KEY:'test',SUPABASE_ANON_KEY:'anon'};
const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode('test:onedrive-tokens:v1')),'AES-GCM',false,['encrypt']);
const iv=crypto.getRandomValues(new Uint8Array(12));
const sealed=base64url(iv)+'.'+base64url(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({accessToken:'graph',expiresAt:Date.now()+3600000})))));
let role='editor',visible=true,doc,moved=false,moves=0,dbFailure=false,graphFailure=false;
const original={driver_id:driver,document_type:'health_certificate',drive_id:drive,item_id:'photo',file_name:'평택_차량_기사_회사_보건증.png',request_id:'revision',uploaded_at:'2026-09-18T00:00:00Z'};
const response=(x,status=200)=>new Response(JSON.stringify(x),{status});
const fetcher=async(input,options={})=>{
 const u=new URL(input),p=u.pathname,method=options.method||'GET';
 if(p==='/auth/v1/user')return response({id:user});
 if(p.startsWith('/rest/v1/')){
  const table=p.slice(9);
  if(table==='user_profiles')return response([{id:user,role,active:true}]);
  if(table==='drivers')return response(visible?[{id:driver}]:[]);
  if(table==='driver_documents'){
   if(method==='DELETE'){assert(moved,'DB removal must follow verified move');if(dbFailure)return response({},500);const old=doc;doc=null;return response(old?[old]:[]);}
   return response(doc?[doc]:[]);
  }
  if(table==='onedrive_settings')return response([{expected_drive_id:drive,folders:{...Object.fromEntries(['food_transport','livestock_transport','freight_license','vehicle_registration','identity','health_certificate'].map(k=>[k,'https://1drv.ms/test'])),delete_archive:{driveId:drive,folderId:archive}}}]);
  if(table==='onedrive_connection')return response([{encrypted_tokens:sealed}]);
  if(table==='rpc/onedrive_acquire')return response(true);
  if(table==='onedrive_locks')return response(null);
  if(table==='onedrive_uploads'){assert.equal(JSON.parse(options.body).status,'archived');return response(null);}
  throw Error('Unexpected table '+table);
 }
 assert.equal(u.hostname,'graph.microsoft.com');
 assert.notEqual(method,'DELETE','Graph photos must never be permanently deleted');
 if(p.endsWith(encodeURIComponent(archive)))return response({id:archive,folder:{},parentReference:{driveId:drive}});
 if(method==='PATCH'){
  if(graphFailure)return response({},500);
  const b=JSON.parse(options.body);assert.equal(b.parentReference.id,archive);assert.match(b.name,/_삭제_photo\.png$/);
  moved=true;moves++;return response({id:'photo',parentReference:{id:archive}});
 }
 return response({id:'photo',eTag:'etag',parentReference:{id:moved?archive:'source'}});
};
const handler=makeHandler(env,fetcher);
const remove=(version='revision')=>handler(new Request(root+'/functions/v1/onedrive-auth/remove',{method:'POST',headers:{Authorization:'Bearer user','Content-Type':'application/json'},body:JSON.stringify({driverId:driver,kind:'health_certificate',version})}));
doc={...original};role='viewer';assert.equal((await remove()).status,403);role='editor';
visible=false;assert.equal((await remove()).status,403);visible=true;
assert.equal((await remove('stale')).status,409);assert.equal(moves,0);
graphFailure=true;assert.equal((await remove()).status,502);assert(doc);assert.equal(moves,0);graphFailure=false;
dbFailure=true;assert.equal((await remove()).status,502);assert(doc);assert.equal(moves,1);dbFailure=false;
assert.equal((await remove()).status,200);assert.equal(doc,null);assert.equal(moves,1,'retry after DB failure must not move twice');
assert.equal((await remove()).status,200);assert.equal(moves,1);
console.log('Archive deletion: roles, visibility, stale versions, move failure, DB failure recovery and idempotency passed');
