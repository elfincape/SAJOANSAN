import assert from 'node:assert/strict';
import {handleBackups,bytesToBase64,base64ToBytes} from '../supabase/functions/onedrive-auth/backups.js';
import {fail,hash} from '../supabase/functions/onedrive-auth/handler.js';
import {splitOriginal} from '../supabase/functions/onedrive-auth/backup-workbook.js';
const id='00000000-0000-4000-8000-000000000001',bytes=new TextEncoder().encode('PK\x03\x04 immutable original workbook');
const json=value=>new Response(JSON.stringify(value)),user={role:'admin',token:'hq'};
let backup={id,period:'baseline',captured_at:'2026-10-11T09:00:00Z',original_text:'{}',counts:{},file_name:'20261011_180000_운영마스터_현재원본.xlsx',status:'pending',attempts:0},builds=0,uploads=0,item=null,failCommit=true,corrupt=false,collision=false;
async function db(path,options={}){
 if(path==='rpc/operations_master_payload')return structuredClone(backup);
 if(path.startsWith('operations_master_backups?')){
  if(options.method==='PATCH'){
   if(path.includes('status=neq.saved')&&backup.status==='saved')return null;
   if(options.body.status==='saved'&&failCommit)throw fail('DB 저장 실패',502);
   Object.assign(backup,options.body);return null;
  }
  if(options.token)assert.equal(options.token,'hq');return [structuredClone(backup)];
 }
 throw Error('Unexpected DB request '+path);
}
async function graph(path,access,options={}){
 assert.equal(access,'access');
 if(path.startsWith('/me/drive'))return json({id:'drive'});
 if(path.includes('/root?'))return json({id:'root'});
 if(path.endsWith('/content')){if(options.method==='PUT'){assert.equal(options.headers['If-Match'],'owned-etag');assert.equal(item.size,0);assert.deepEqual(options.body,bytes);item.size=bytes.length;uploads++;return json(item);}return new Response(corrupt?new Uint8Array([1]):bytes);}
 if(path.endsWith('/children'))return json({id:'folder',folder:{},parentReference:{driveId:'drive'}});
 if(path.includes('/createUploadSession')){if(options.body){assert.equal(JSON.parse(options.body).item['@microsoft.graph.conflictBehavior'],'replace');assert.equal(options.headers['If-Match'],'owned-etag');assert.equal(item.size,0);}else assert.equal(options.body,undefined);return json({uploadUrl:'https://up.1drv.com/session'});}
 if(path.includes(encodeURIComponent(backup.file_name))||path.includes('/items/item')){
  if(collision)return json({...item,description:'unrelated file',id:'other'});
  if(item)return json(item);if(options.allowMissing)return null;
 }
 if(options.allowMissing)return null;throw Error('Unexpected Graph request '+path);
}
const helpers={db,graph,json,fail,hash,withLock:fn=>fn(),settings:async()=>({expected_drive_id:'drive'}),connected:async()=>({accessToken:'access'}),
 buildBackup:async()=>{builds++;return bytes;},fetcher:async(url,options)=>{
  assert.equal(url,'https://up.1drv.com/session');assert.equal(options.headers.Authorization,undefined);assert.deepEqual(options.body,bytes);uploads++;
  item={id:'item',name:backup.file_name,size:bytes.length,file:{},parentReference:{driveId:'drive',id:'folder'},description:'SAJOANSAN master backup '+id};return new Response(JSON.stringify(item),{status:201});
 }};
const request=()=>new Request('https://example/backups-retry',{method:'POST',body:JSON.stringify({id})});
await assert.rejects(()=>handleBackups('backups-retry',request(),{role:'editor'},helpers),/HQ/);
await assert.rejects(()=>handleBackups('backups-scheduled',request(),user,helpers),/예약 실행/);
await assert.rejects(()=>handleBackups('backups-retry',request(),user,helpers),/DB 저장 실패/);
assert.equal(backup.status,'failed');assert.equal(builds,1);assert.equal(uploads,1);assert.equal(backup.item_id,'item');
failCommit=false;const result=await handleBackups('backups-retry',request(),user,helpers);assert.equal((await result.json()).saved,true);
assert.equal(builds,1,'retry must reuse the original XLSX bytes');assert.equal(uploads,1,'retry must recover the existing owned file');
assert.deepEqual(base64ToBytes(bytesToBase64(bytes)),bytes);assert.equal(backup.status,'saved');
corrupt=true;await assert.rejects(()=>handleBackups('backups-download',request(),user,helpers),/검증/);assert.equal(backup.status,'saved','download failure must preserve saved history');
corrupt=false;const downloaded=await handleBackups('backups-download',request(),user,helpers);assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),bytes);
backup.status='failed';item.size=0;item.eTag='owned-etag';await handleBackups('backups-retry',request(),user,helpers);assert.equal(uploads,2);assert.equal(builds,1,'owned empty placeholders reuse the prepared original');
backup.status='failed';backup.item_id=null;collision=true;await assert.rejects(()=>handleBackups('backups-retry',request(),user,helpers),/덮어쓰지/);assert.equal(uploads,2);
const original='a'.repeat(29999)+'😀'+'z'.repeat(60000),chunks=splitOriginal(original);assert.equal(chunks.join(''),original);assert.ok(chunks.every(chunk=>chunk.length<=30000&&!/[\uD800-\uDBFF]$/.test(chunk)));
console.log('PASS: HQ-only backups, immutable byte reuse, commit recovery, safe download, corruption detection, no overwrite and Unicode original preservation');
