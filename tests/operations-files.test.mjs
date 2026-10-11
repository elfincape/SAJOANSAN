import assert from 'node:assert/strict';
import {handleOperations,operationsFileType} from '../supabase/functions/onedrive-auth/operations.js';
import {fail,hash,filePart} from '../supabase/functions/onedrive-auth/handler.js';
const subjectId='00000000-0000-4000-8000-000000000001',user={id:'00000000-0000-4000-8000-000000000002',token:'user'},requestId='00000000-0000-4000-8000-000000000003';
const bytes=new TextEncoder().encode('%PDF-1.7\nexisting real document data');
let journal=null,item=null,canWrite=true,corrupt=false,commitFails=false,uploads=0,commits=0,folderSequence=0;
const folders=new Map(),json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const copy=value=>structuredClone(value);
async function db(path,options={}){
 if(path.startsWith('operations_tasks?')){assert.equal(options.token,user.token);return [{id:subjectId,center_code:'001',title:'배송 배차'}];}
 if(path==='rpc/operations_can_write')return canWrite;
 if(path.startsWith('centers?'))return [{name:'사조안산센터'}];
 if(path==='rpc/operations_reserve_file'){
  const b=options.body;if(!canWrite)throw fail('센터 권한 없음',403);
  if(journal){assert.equal(b.p_request,journal.request_id);if(journal.content_hash!==b.p_hash)throw fail('원본이 다릅니다');return copy(journal);}
  journal={id:'00000000-0000-4000-8000-000000000004',task_id:subjectId,center_code:'001',uploaded_by:user.id,request_id:b.p_request,content_hash:b.p_hash,byte_size:b.p_bytes,mime_type:b.p_mime,original_name:b.p_original,file_name:'20261011_안산_배송배차_001.pdf',status:'reserved'};return copy(journal);
 }
 if(path==='rpc/operations_commit_file'){
  if(!canWrite||commitFails)throw fail('최종 저장 권한 또는 DB 오류',403);
  assert.equal(options.body.p_item,journal.item_id);commits++;journal.status='saved';return journal.id;
 }
 if(path.startsWith('operations_files?')){
  if(options.method==='PATCH'){if(path.includes('status=neq.saved')&&journal.status==='saved')return null;Object.assign(journal,options.body);return null;}
  return journal?[copy(journal)]:[];
 }
 throw Error('Unexpected DB '+path);
}
async function graph(path,access,options={}){
 assert.equal(access,'access');
 if(path.startsWith('/me/drive'))return json({id:'drive'});
 if(path.includes('/root?'))return json({id:'root'});
 if(path.endsWith('/content'))return new Response(corrupt?new Uint8Array([1,2,3]):bytes);
 if(path.includes('/createUploadSession')){assert.equal(options.body,undefined);return json({uploadUrl:'https://sn.up.1drv.com/upload'});}
 if(options.method==='POST'&&path.endsWith('/children')){
  const parent=path.match(/\/items\/([^/]+)/)[1],name=JSON.parse(options.body).name;
  const folder={id:'folder'+(++folderSequence),folder:{},parentReference:{driveId:'drive',id:parent}};
  folders.set('/drives/drive/items/'+parent+':/'+encodeURIComponent(name),folder);return json(folder);
 }
 const clean=path.split('?')[0];
 if(folders.has(clean))return json(folders.get(clean));
 if(clean.includes('/items/item')||clean.includes(encodeURIComponent(journal?.file_name??'never'))){if(item)return json(item);if(options.allowMissing)return null;}
 if(options.allowMissing)return null;
 throw Error('Unexpected Graph '+path);
}
const helpers={db,graph,connected:async()=>({accessToken:'access'}),settings:async()=>({expected_drive_id:'drive'}),withLock:fn=>fn(),json,fail,hash,filePart,
 fetcher:async(url,options)=>{
  assert.equal(url,'https://sn.up.1drv.com/upload');assert.equal(options.headers.Authorization,undefined,'preauthenticated uploads must not expose bearer credentials');
  assert.equal(options.headers['Content-Range'],`bytes 0-${bytes.length-1}/${bytes.length}`);uploads++;
  item={id:'item',name:journal.file_name,size:bytes.length,file:{},parentReference:{id:journal.folder_id,driveId:'drive'},description:'SAJOANSAN operations file '+journal.id};return new Response(JSON.stringify(item),{status:201});
 }};
function request(data=bytes){const form=new FormData();form.set('kind','task');form.set('subjectId',subjectId);form.set('requestId',requestId);form.set('file',new File([data],'원본.pdf'));return new Request('https://server/operations-upload',{method:'POST',body:form});}
async function upload(data){return handleOperations('operations-upload',request(data),user,helpers);}
assert.equal(operationsFileType('원본.pdf',bytes,fail).mime,'application/pdf');
assert.throws(()=>operationsFileType('bad.xlsx',bytes,fail));assert.throws(()=>operationsFileType('run.exe',bytes,fail));
canWrite=false;await assert.rejects(upload(),error=>error.status===403);assert.equal(uploads,0);canWrite=true;
corrupt=true;await assert.rejects(upload(),/검증/);assert.equal(journal.status,'failed');assert.equal(commits,0);assert.equal(uploads,1);
corrupt=false;commitFails=true;await assert.rejects(upload(),/최종/);assert.equal(uploads,1,'DB failure retries reuse existing OneDrive bytes');assert.equal(journal.status,'failed');
commitFails=false;assert.equal((await(await upload()).json()).saved,true);assert.equal(uploads,1);assert.equal(commits,1);
await upload();assert.equal(commits,1,'same request must be idempotent');
await assert.rejects(upload(new TextEncoder().encode('%PDF-changed')),/원본/);
const downloadRequest=()=>new Request('https://server/operations-download',{method:'POST',body:JSON.stringify({fileId:journal.id})});
const downloaded=await handleOperations('operations-download',downloadRequest(),user,helpers);assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),bytes);assert.match(downloaded.headers.get('Content-Disposition'),/^attachment;/);
corrupt=true;await assert.rejects(handleOperations('operations-download',downloadRequest(),user,helpers),/검증/);
journal=null;item=null;corrupt=false;uploads=0;commits=0;await upload();journal.status='failed';journal.item_id=null;item.description='unrelated file';
await assert.rejects(upload(),/기존 파일/);assert.equal(uploads,1,'unrelated files must never be replaced');
console.log('PASS: file validation, center permission, content verification, DB-failure recovery, idempotency, safe download and no-overwrite collisions');

