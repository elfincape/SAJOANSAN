import assert from 'node:assert/strict';
import {makeHandler,base64url,KINDS} from '../supabase/functions/onedrive-auth/handler.js';
import {DOCUMENT_TYPES} from '../repo-root/js/driver-documents.js';
import {prepareCompilation} from '../repo-root/js/driver-pdf.js';
import {fitImage} from '../supabase/functions/onedrive-auth/pdf.js';
assert.deepEqual(KINDS,DOCUMENT_TYPES.map(x=>x[0]));
const records=KINDS.map(k=>({document_type:k,request_id:k}));
let read=[];
const prepared=await prepareCompilation({list:async()=>records.toReversed(),download:async(id,k,v)=>{assert.equal(v,k);read.push(k);return new Blob([k]);}},'driver',()=>{},async b=>b);
assert.deepEqual(read,KINDS);assert.deepEqual(prepared.images.map(x=>x[0]),KINDS);
await assert.rejects(prepareCompilation({list:async()=>[]},'driver'),/사진이 없습니다/);
const many=Array.from({length:12},(_,i)=>({id:crypto.randomUUID(),document_type:'food_transport_back',page_number:i,request_id:'v'+i}));
const downloadedPages=[];
const multiple=await prepareCompilation({list:async()=>many.toReversed(),download:async(id,k,v,pageId)=>{downloadedPages.push(pageId);return new Blob([v]);}},'driver',()=>{},async b=>b);
assert.deepEqual(downloadedPages,many.map(r=>r.id));
assert.equal(multiple.images.length,12);
assert.equal(Object.keys(multiple.versions).length,12);
for(const [w,h] of [[200,100],[100,200],[10000,10]]){const f=fitImage(w,h,595,842);assert(f.x>=18&&f.y>=18);assert(f.width<=559&&f.height<=806);assert(Math.abs(f.width/f.height-w/h)<0.001);}
const root='https://example.supabase.co',driver='00000000-0000-4000-8000-000000000001';
const env={SUPABASE_URL:root,SUPABASE_SERVICE_ROLE_KEY:'test',SUPABASE_ANON_KEY:'anon'};
const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode('test:onedrive-tokens:v1')),'AES-GCM',false,['encrypt']);
const iv=crypto.getRandomValues(new Uint8Array(12));
const token=base64url(iv)+'.'+base64url(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({accessToken:'graph',expiresAt:Date.now()+3600000,folders:{}})))));
let role='editor',count=8,stale=false,configured=true,prior=null,existing=null,puts=0,graphFail=false,dbFail=false,serverRecords=records,expectedPages=8;
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
const pdf=new TextEncoder().encode('%PDF-test');
const fetcher=async(input,options={})=>{
 const u=new URL(input),p=u.pathname,method=options.method||'GET',b=typeof options.body==='string'?JSON.parse(options.body):null;
 if(p==='/auth/v1/user')return response({id:'user'});
 if(p.startsWith('/rest/v1/')){
  const table=p.slice(9);
  if(table==='user_profiles')return response([{role,active:true}]);
  if(table==='drivers')return response([{id:driver,name:'기사',center_code:'002'}]);
  if(table==='driver_documents')return response(serverRecords.slice(0,count).map(r=>({...r,request_id:stale?'changed':r.request_id})));
  if(table==='onedrive_settings')return response([{expected_drive_id:'drive',folders:{...Object.fromEntries(['food_transport','livestock_transport','freight_license','vehicle_registration','identity','health_certificate'].map(k=>[k,'https://1drv.ms/test'])),...(configured?{permit_pdf:{driveId:'drive',folderId:'pdf-folder'}}:{})}}]);
  if(table==='onedrive_connection')return response([{encrypted_tokens:token}]);
  if(table==='rpc/onedrive_acquire')return response(true);
  if(table==='onedrive_locks')return response(null);
  if(table==='centers')return response([{name:'사조평택센터'}]);
  if(table==='routes')return response([]);
  if(table==='driver_document_pdfs'){
   if(method==='POST'){prior=b;return response(null);}
   if(method==='PATCH'){if(dbFail)return response({},500);prior={...prior,...b};return response(null);}
   return response(prior?[prior]:[]);
  }
  throw Error('Unexpected DB table '+table);
 }
 if(method==='PUT'){if(graphFail)return response({},500);puts++;existing={id:'pdf-item',size:pdf.length};return response(existing);}
 if(p.endsWith('/items/pdf-folder'))return response({id:'pdf-folder',folder:{}});
 return existing?response(existing):response({},404);
};
const handler=makeHandler(env,fetcher,async images=>{
 assert.equal(images.length,expectedPages);images.forEach((b,i)=>assert.equal(b[3],i));return pdf;
});
const request=()=>{
 const f=new FormData();f.set('driverId',driver);f.set('versions',JSON.stringify(Object.fromEntries(KINDS.map(k=>[k,k]))));
 KINDS.forEach((k,i)=>f.set(k,new File([new Uint8Array([255,216,255,i])],k+'.jpg',{type:'image/jpeg'})));
 return new Request(root+'/functions/v1/onedrive-auth/compile-pdf',{method:'POST',headers:{Authorization:'Bearer user'},body:f});
};
role='viewer';assert.equal((await handler(request())).status,403);role='editor';
count=7;assert.equal((await handler(request())).status,409);assert.equal(puts,0);count=8;
stale=true;assert.equal((await handler(request())).status,409);stale=false;
configured=false;assert.equal((await handler(request())).status,409);configured=true;
graphFail=true;assert.equal((await handler(request())).status,502);assert.equal(puts,0);graphFail=false;
dbFail=true;assert.equal((await handler(request())).status,502);assert.equal(puts,1);dbFail=false;
const saved=await (await handler(request())).json();assert.equal(saved.saved,true);assert.equal(saved.fileName,'평택_차량미지정_기사_운수사미지정_인허가취합.pdf');
assert.equal(prior.status,'saved');assert.equal(puts,2);
prior=null;assert.equal((await handler(request())).status,409);assert.equal(puts,2);
serverRecords=many;count=12;expectedPages=12;existing=null;prior=null;
const pagesRequest=()=>{
 const f=new FormData();f.set('driverId',driver);f.set('versions',JSON.stringify(Object.fromEntries(serverRecords.map(r=>[r.id,r.request_id]))));
 serverRecords.forEach((r,i)=>f.set(r.id,new File([new Uint8Array([255,216,255,i])],r.id+'.jpg',{type:'image/jpeg'})));
 return new Request(root+'/functions/v1/onedrive-auth/compile-pdf',{method:'POST',headers:{Authorization:'Bearer user'},body:f});
};
assert.equal((await handler(pagesRequest())).status,200,'server accepts more than eight pages');
serverRecords=many.slice(0,1);expectedPages=1;
assert.equal((await handler(pagesRequest())).status,200,'server accepts a partial set of document types');
stale=true;assert.equal((await handler(pagesRequest())).status,409);stale=false;
console.log('PDF order, completeness, layout, roles, stale revisions, configuration, collision and save recovery passed');
