import assert from 'node:assert/strict';
import { handleCharter } from '../supabase/functions/onedrive-auth/charter.js';
let storedBytes=null,inserted=null,rows=[{id:'trip1',payload:{id:'trip1',centerCode:'002',date:'2026-10-08',deliveries:[]},version:1}];
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=async bytes=>JSON.stringify([...bytes]);
const connection={accessToken:'test',folders:{}},config={expected_drive_id:'drive',folders:{charter_002:{driveId:'drive',folderId:'folder'}}};
const api={fail,json,hash,shareToken:()=> 'test',settings:async()=>config,connected:async()=>connection,withLock:async fn=>fn(),db:async(path,options={})=>{
 if(path.startsWith('charter_trips'))return rows;
 if(path==='charter_archives'&&options.method==='POST'){inserted=options.body;return null;}
 if(path.startsWith('charter_archives?'))return inserted?[inserted]:[];
 if(path.startsWith('onedrive_settings'))return null;throw Error('Unexpected DB '+path);
},graph:async(path,access,options={})=>{
 if(options.method==='PUT'){storedBytes=options.body;return json({id:'file'});}
 if(path.endsWith('/content'))return new Response(storedBytes);
 if(path.startsWith('/shares/'))return json({id:'folder',folder:{},parentReference:{driveId:'drive'}});
 throw Error('Unexpected Graph '+path);
}};
const request=body=>new Request('https://test/charter',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
const user={id:'user',role:'admin',token:'jwt'};
const response=await handleCharter('charter-archive',request({centerCode:'002',month:'2026-10'}),user,api);
assert.equal((await response.json()).verified,true);assert.equal(inserted.record_count,1);assert.equal(inserted.snapshot.rows[0].version,1);
const restored=await handleCharter('charter-read',request({centerCode:'002',archiveId:inserted.id}),user,api);
assert.equal((await restored.json()).trips[0].id,'trip1');
await assert.rejects(()=>handleCharter('charter-archive',request({centerCode:'002',month:'2026-10'}),{...user,role:'editor'},api),/관리자/);
const corrupt={...api,graph:async(path,token,options={})=>options.method==='PUT'?json({id:'file'}):new Response('corrupted')};
await assert.rejects(()=>handleCharter('charter-archive',request({centerCode:'002',month:'2026-10'}),user,corrupt),/검증/);
storedBytes=new TextEncoder().encode('edited');
await assert.rejects(()=>handleCharter('charter-read',request({centerCode:'002',archiveId:inserted.id}),user,api),/변경/);
await assert.rejects(()=>handleCharter('charter-config',request({centerCode:'002',url:'x'}),{...user,role:'editor'},api),/관리자/);
rows=[];await assert.rejects(()=>handleCharter('charter-archive',request({centerCode:'002',month:'2026-10'}),user,api),/없습니다/);
console.log('PASS: authenticated OneDrive monthly snapshot, read-back verification, archive restoration, corrupted-file rejection, empty-month and admin checks');
