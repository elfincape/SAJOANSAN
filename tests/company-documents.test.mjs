import assert from 'node:assert/strict';
import {makeHandler,base64url,FOLDER_KINDS} from '../supabase/functions/onedrive-auth/handler.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const user=id(1),driver=id(2),company=id(3),root='https://example.supabase.co';
const env={SUPABASE_URL:root,SUPABASE_SERVICE_ROLE_KEY:'test',SUPABASE_ANON_KEY:'anon'};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode('test:onedrive-tokens:v1')),'AES-GCM',false,['encrypt']);
const iv=crypto.getRandomValues(new Uint8Array(12));
const folders=Object.fromEntries(FOLDER_KINDS.map(k=>[k,{driveId:'drive',folderId:k}]));
const token=base64url(iv)+'.'+base64url(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({accessToken:'graph',expiresAt:Date.now()+3600000,folders})))));
const png=new Uint8Array([137,80,78,71,13,10,26,10,1]);
let docs=[],driverDocs=[{id:'old'}],journals=[],role='editor',visible=true,configured=true,copyFailure=false,commits=0,puts=0,configs=0;
let requestedDownload='';
const fetcher=async(input,options={})=>{
 const u=new URL(input),p=u.pathname,method=options.method||'GET',b=typeof options.body==='string'?JSON.parse(options.body):null;
 if(p==='/auth/v1/user')return response({id:user});
 if(p.startsWith('/rest/v1/')){
  const table=p.slice(9);
  if(table==='user_profiles')return response([{active:true,role}]);
  if(table==='drivers')return response([{id:driver,name:'기사',company_id:company,center_code:'001'}]);
  if(table==='companies')return response(visible?[{id:company,name:'운수사',center_code:'001'}]:[]);
  if(table==='centers')return response([{name:'안산'}]);
  if(table==='routes')return response([]);
  if(table==='onedrive_locks')return response(null);
  if(table==='rpc/onedrive_acquire')return response(true);
  if(table==='onedrive_connection')return response([{encrypted_tokens:token}]);
  if(table==='onedrive_settings'){
   if(method==='PATCH'){configs++;return response(null);}
   return response([{expected_drive_id:'drive',folders:{...Object.fromEntries(FOLDER_KINDS.map(k=>[k,'https://1drv.ms/test'])),...(configured?{company_permits:{driveId:'drive',folderId:'company-folder'}}:{})}}]);
  }
  if(table==='onedrive_uploads'){
   const request=u.searchParams.get('request_id')?.slice(3);
   if(method==='POST'){journals.push(b);return response(null);}
   if(method==='PATCH'){Object.assign(journals.find(j=>j.request_id===request),b);return response(null);}
   return response(journals.filter(j=>j.request_id===request));
  }
  if(table==='company_documents'){
   let rows=docs;
   for(const field of ['id','request_id','company_id','drive_id','item_id']){
    const filter=u.searchParams.get(field);if(filter?.startsWith('eq.'))rows=rows.filter(r=>r[field]===filter.slice(3));
   }
   const kind=u.searchParams.get('document_type');
   if(kind?.startsWith('eq.'))rows=rows.filter(r=>r.document_type===kind.slice(3));
   if(kind?.startsWith('in.'))rows=rows.filter(r=>kind.slice(4,-1).split(',').includes(r.document_type));
   return response(rows);
  }
  if(table==='rpc/onedrive_commit_company_document'){
   assert.equal(b.p_company,company);commits++;
   if(!b.p_kind.endsWith('_back'))docs=docs.filter(r=>r.document_type!==b.p_kind);
   docs.push({id:b.p_request,company_id:b.p_company,document_type:b.p_kind,page_number:docs.filter(r=>r.document_type===b.p_kind).length,drive_id:b.p_drive,item_id:b.p_item,file_name:b.p_filename,mime_type:b.p_mime,size_bytes:b.p_size,request_id:b.p_request,uploaded_by:b.p_user,uploaded_at:'2026-09-23'});
   journals.find(j=>j.request_id===b.p_request).status='committed';
   return response(null);
  }
  if(table==='rpc/onedrive_replace_company_documents'){
   assert.equal(b.p_driver,driver);assert.equal(b.p_company,company);
   driverDocs=b.p_pages;return response(null);
  }
  throw Error('Unexpected DB '+table);
 }
 assert.equal(u.hostname,'graph.microsoft.com');
 if(p.includes('/shares/'))return response({id:'company-folder',folder:{},parentReference:{driveId:'drive'}});
 if(method==='PUT'){
  puts++;
  if(copyFailure&&puts%2===0)return response({},500);
  return response({id:'file-'+puts,size:png.length});
 }
 if(p.endsWith('/content')){requestedDownload=p;return new Response(png,{headers:{'Content-Type':'image/png'}});}
 return response({},404);
};
const handler=makeHandler(env,fetcher);
const call=(action,body)=>handler(new Request(root+'/functions/v1/onedrive-auth/'+action,{method:'POST',headers:{Authorization:'Bearer user',...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)}));
const upload=(kind,requestId)=>{
 const form=new FormData();form.set('driverId',company);form.set('kind',kind);form.set('requestId',requestId);form.set('file',new File([png],'photo.png',{type:'image/png'}));return call('company-upload',form);
};
role='viewer';assert.equal((await upload('food_transport',id(10))).status,403);role='editor';
assert.equal((await call('company-config',{url:'https://1drv.ms/test'})).status,403);
role='admin';assert.equal((await call('company-config',{url:'https://1drv.ms/test'})).status,200);assert.equal(configs,1);role='editor';
visible=false;assert.equal((await upload('food_transport',id(10))).status,403);visible=true;
assert.equal((await upload('identity',id(10))).status,400);
configured=false;assert.equal((await upload('food_transport',id(10))).status,409);configured=true;
assert.equal((await upload('food_transport',id(10))).status,200);
for(let n=11;n<23;n++)assert.equal((await upload('food_transport_back',id(n))).status,200);
assert.equal(docs.length,13);assert.equal(new Set(journals.map(j=>j.file_name)).size,13);
assert.equal((await upload('food_transport_back',id(22))).status,200);assert.equal(commits,13,'retry does not append a duplicate');
assert.equal((await call('company-list',{driverId:company})).status,200);
const page=docs[8];
assert.equal((await call('company-download',{driverId:company,kind:page.document_type,documentId:page.id,version:page.request_id})).status,200);
assert(requestedDownload.includes(page.item_id));
assert.equal((await call('company-download',{driverId:company,kind:'food_transport_back'})).status,409,'ambiguous old clients must refresh');
assert.equal((await call('replace-company',{driverId:driver,kind:'identity'})).status,400);
visible=false;assert.equal((await call('replace-company',{driverId:driver,kind:'food_transport'})).status,403);visible=true;
copyFailure=true;assert.equal((await call('replace-company',{driverId:driver,kind:'food_transport'})).status,502);
assert.deepEqual(driverDocs,[{id:'old'}],'copy failures must preserve current driver records');
copyFailure=false;assert.equal((await call('replace-company',{driverId:driver,kind:'food_transport'})).status,200);
assert.equal(driverDocs.length,13);assert.equal(driverDocs.filter(r=>r.document_type.endsWith('_back')).length,12);
assert(driverDocs.every(r=>!docs.some(d=>d.item_id===r.item_id)),'driver copies must remain independent of company originals');
assert.equal((await call('replace-company',{driverId:driver,kind:'livestock_transport'})).status,404);
console.log('Company permits: authorization, folder registration, 12 backs, idempotency, individual download and atomic independent replacement passed');
