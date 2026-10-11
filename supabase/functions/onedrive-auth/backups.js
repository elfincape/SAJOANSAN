import {createOneDriveStorage} from './storage.js';
const enc=encodeURIComponent,metadata='id,period,captured_at,file_name,counts,status,attempts,last_attempt_at,last_error,verified_at';
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||'');
export function bytesToBase64(bytes){let result='';for(let i=0;i<bytes.length;i+=16384)result+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(result);}
export const base64ToBytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
export async function handleBackups(action,req,user,helpers){
 const {db,graph,withLock,json,fail,hash,buildBackup}=helpers,storage=createOneDriveStorage(helpers);
 if(user.role!=='admin'&&user.role!=='service_role')throw fail('원본 백업은 HQ만 조회·처리할 수 있습니다.',403);
 if(action==='backups-list'){
  const backups=[];for(let offset=0;;offset+=200){const batch=await db('operations_master_backups?select='+metadata+'&order=captured_at.desc,id&offset='+offset+'&limit=200',{token:user.token});backups.push(...batch);if(batch.length<200)break;}return json({backups});
 }
 const body=await req.json();
 if(action!=='backups-scheduled'&&!uuid(body.id))throw fail('보관 원본을 선택해 주세요.');
 if(action==='backups-compare')return json(await db('rpc/operations_master_compare',{method:'POST',token:user.token,body:{p_id:body.id}}));
 if(!['backups-scheduled','backups-retry','backups-download'].includes(action))throw fail('지원하지 않는 원본 보관 작업입니다.',404);
 if(action==='backups-scheduled'&&user.role!=='service_role')throw fail('서버 예약 실행 권한이 필요합니다.',403);
 let selected=body.id;
 if(action==='backups-scheduled')selected=(await db('operations_master_backups?select=id&status=neq.saved&order=captured_at.asc&limit=1'))[0]?.id;
 if(!selected)return json({pending:false});
 if(user.role!=='service_role'){
  const allowed=(await db('operations_master_backups?select=id&id=eq.'+enc(selected),{token:user.token}))[0];if(!allowed)throw fail('보관 원본에 접근할 수 없습니다.',403);
 }
 let backup;
 try{return await withLock(async()=>{
  backup=await db('rpc/operations_master_payload',{method:'POST',body:{p_id:selected}});if(!backup)throw fail('보관 원본이 없습니다.',404);
  if(action!=='backups-download'&&backup.status==='saved')return json({id:selected,saved:true});
  const env=await storage.environment();
  if(action==='backups-download'){
   if(backup.status!=='saved')throw fail('OneDrive 저장이 완료된 원본만 다운로드할 수 있습니다.',409);
   if(backup.drive_id.toLowerCase()!==env.driveId.toLowerCase())throw fail('보관 당시의 OneDrive 연결이 필요합니다.',409);
   const item=await(await graph('/drives/'+enc(backup.drive_id)+'/items/'+enc(backup.item_id)+'?$select=id,name,size,file,parentReference',env.access)).json();
   const bytes=await storage.verify(backup,item,env.access);
   const allowed=(await db('operations_master_backups?select=id&id=eq.'+enc(selected),{token:user.token}))[0];if(!allowed)throw fail('HQ 권한을 다시 확인해 주세요.',403);
   const headers=new Headers(json({}).headers);headers.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');headers.set('Content-Disposition',"attachment; filename*=UTF-8''"+enc(backup.file_name));headers.set('X-Content-Type-Options','nosniff');return new Response(bytes,{headers});
  }
  await db('operations_master_backups?id=eq.'+enc(selected),{method:'PATCH',body:{last_attempt_at:new Date().toISOString(),attempts:backup.attempts+1}});
  if(!backup.workbook_base64){
   if(!buildBackup)throw fail('엑셀 원본 생성 설정이 필요합니다.',503);
   const generated=await buildBackup(backup);if(generated.length>50*1024*1024)throw fail('엑셀 원본이 50MB를 초과했습니다. DB 원본은 보관되어 있습니다.',413);
   const prepared={workbook_base64:bytesToBase64(generated),content_hash:await hash(generated),byte_size:generated.length};
   await db('operations_master_backups?id=eq.'+enc(selected),{method:'PATCH',body:prepared});backup={...backup,...prepared};
  }
  if(!backup.folder_id){
   const root=await(await graph('/drives/'+enc(env.driveId)+'/root?$select=id',env.access)).json();
   const home=await storage.folder(env.driveId,root.id,'SAJOANSAN 업무자료',env.access);
   const folder=await storage.folder(env.driveId,home,'시스템 백업',env.access);
   await db('operations_master_backups?id=eq.'+enc(selected),{method:'PATCH',body:{drive_id:env.driveId,folder_id:folder}});backup={...backup,drive_id:env.driveId,folder_id:folder};
  }
  if(backup.drive_id.toLowerCase()!==env.driveId.toLowerCase())throw fail('보관 예약 당시의 OneDrive 연결이 필요합니다.',409);
  const itemId=await storage.save(backup,base64ToBytes(backup.workbook_base64),'SAJOANSAN master backup '+selected,env.access,
   item_id=>db('operations_master_backups?id=eq.'+enc(selected),{method:'PATCH',body:{item_id}}));
  await db('operations_master_backups?id=eq.'+enc(selected),{method:'PATCH',body:{status:'saved',item_id:itemId,verified_at:new Date().toISOString(),last_error:null,recover_empty_once:false}});
  return json({id:selected,saved:true});
 });}catch(error){
  if(action!=='backups-download')await db('operations_master_backups?id=eq.'+enc(selected)+'&status=neq.saved',{method:'PATCH',body:{status:'failed',last_attempt_at:new Date().toISOString(),last_error:String(error.message||'원본 보관 실패').slice(0,500)}}).catch(()=>{});
  throw error;
 }
}
