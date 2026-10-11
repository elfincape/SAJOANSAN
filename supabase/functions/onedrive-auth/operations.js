import {createOneDriveStorage} from './storage.js';
const LIMIT=10*1024*1024,enc=encodeURIComponent;
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||'');
const metadata='id,task_id,incident_id,survey_id,center_code,uploaded_by,request_id,original_name,file_name,mime_type,byte_size,ordinal,status,last_error,created_at,verified_at';
export function operationsFileType(name,bytes,fail){
 const ext=String(name).split('.').at(-1).toLowerCase(),prefix=new TextDecoder().decode(bytes.slice(0,8));
 const starts=values=>values.every((value,index)=>bytes[index]===value);
 const types={pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',csv:'text/csv',txt:'text/plain',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
 if(!types[ext])throw fail('엑셀·워드·PDF·PPTX·CSV·TXT 또는 JPG·PNG·WEBP 파일을 선택해 주세요.');
 let valid=false;
 if(ext==='pdf')valid=prefix.startsWith('%PDF-');
 else if(['xlsx','docx','pptx'].includes(ext))valid=starts([80,75,3,4]);
 else if(['xls','doc'].includes(ext))valid=starts([208,207,17,224,161,177,26,225]);
 else if(['jpg','jpeg'].includes(ext))valid=starts([255,216,255]);
 else if(ext==='png')valid=starts([137,80,78,71,13,10,26,10]);
 else if(ext==='webp')valid=prefix.startsWith('RIFF')&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
 else {try{valid=!new TextDecoder('utf-8',{fatal:true}).decode(bytes).includes('\0');}catch{}}
 if(!valid)throw fail('파일 확장자와 실제 내용이 일치하지 않습니다. TXT·CSV는 UTF-8로 저장해 주세요.');
 return {extension:ext==='jpeg'?'jpg':ext,mime:types[ext]};
}
export async function handleOperations(action,req,user,{db,graph,connected,settings,withLock,json,fail,hash,filePart,fetcher}){
 async function subject(kind,id,write=false){
  const table={task:'operations_tasks',incident:'operations_incidents',survey:'operations_surveys'}[kind];
  if(!table||!uuid(id))throw fail('첨부 대상 업무를 선택해 주세요.');
  const row=(await db(table+'?select=id,center_code,title&id=eq.'+enc(id),{token:user.token}))[0];
  if(!row)throw fail('첨부 대상에 접근할 수 없습니다.',403);
  if(write&&!await db('rpc/operations_can_write',{method:'POST',token:user.token,body:{p_center:row.center_code}}))throw fail('이 센터에 파일을 첨부할 권한이 없습니다.',403);
  return row;
 }
 const {environment,folder,verify,save}=createOneDriveStorage({settings,connected,graph,fetcher,hash,fail});
 if(action==='operations-health'){
  if(user.role!=='admin')throw fail('OneDrive 운영 연결 점검은 HQ만 가능합니다.',403);
  return withLock(async()=>{const env=await environment();const response=await graph('/drives/'+enc(env.driveId)+'/root?$select=id,folder',env.access);const root=await response.json();if(!root.id||!root.folder)throw fail('OneDrive 업무자료 저장 위치에 접근할 수 없습니다.',409);return json({connected:true,driveMatches:true,rootAccessible:true});});
 }
 if(action==='operations-list'){
  const body=await req.json();await subject(body.kind,body.subjectId);
  const rows=[];
  for(let offset=0;;offset+=200){const batch=await db('operations_files?select='+metadata+'&'+body.kind+'_id=eq.'+enc(body.subjectId)+'&order=ordinal.desc&offset='+offset+'&limit=200',{token:user.token});rows.push(...batch);if(batch.length<200)break;}
  return json({files:rows});
 }
 if(action==='operations-download'){
  const body=await req.json();if(!uuid(body.fileId))throw fail('첨부 파일을 선택해 주세요.');
  const allowed=(await db('operations_files?select=id,status&id=eq.'+enc(body.fileId),{token:user.token}))[0];
  if(!allowed||allowed.status!=='saved')throw fail('저장이 완료된 첨부 파일에만 접근할 수 있습니다.',403);
  return withLock(async()=>{
   const file=(await db('operations_files?select=*&id=eq.'+enc(body.fileId)))[0],env=await environment();
   if(String(file.drive_id).toLowerCase()!==String(env.driveId).toLowerCase())throw fail('기존 첨부의 OneDrive 계정이 현재 연결과 다릅니다.',409);
   const item=await(await graph('/drives/'+enc(file.drive_id)+'/items/'+enc(file.item_id)+'?$select=id,name,size,file,parentReference',env.access)).json();
   const bytes=await verify(file,item,env.access);
   await subject(file.task_id?'task':file.incident_id?'incident':'survey',file.task_id??file.incident_id??file.survey_id);
   const headers=new Headers(json({}).headers);headers.set('Content-Type',file.mime_type);headers.set('Content-Disposition',"attachment; filename*=UTF-8''"+enc(file.file_name));headers.set('X-Content-Type-Options','nosniff');
   return new Response(bytes,{headers});
  });
 }
 if(action!=='operations-upload')throw fail('지원하지 않는 업무 파일 작업입니다.',404);
 const form=await req.formData(),kind=form.get('kind'),subjectId=form.get('subjectId'),requestId=form.get('requestId'),upload=form.get('file');
 if(!uuid(requestId)||!(upload instanceof File)||upload.size<1||upload.size>LIMIT||upload.name.length>255)throw fail('10MB 이하의 첨부 파일을 선택해 주세요.');
 const target=await subject(kind,subjectId,true),bytes=new Uint8Array(await upload.arrayBuffer()),type=operationsFileType(upload.name,bytes,fail),fingerprint=await hash(bytes);
 let file=await db('rpc/operations_reserve_file',{method:'POST',body:{p_request:requestId,p_actor:user.id,p_kind:kind,p_subject:subjectId,p_hash:fingerprint,p_bytes:bytes.length,p_mime:type.mime,p_original:upload.name,p_extension:type.extension}});
 if(file.status==='saved')return json({id:file.id,saved:true});
 try{
  return await withLock(async()=>{
   file=(await db('operations_files?select=*&id=eq.'+enc(file.id)))[0];
   if(file.status==='saved')return json({id:file.id,saved:true});
   await subject(kind,subjectId,true);
   const env=await environment();
   if(!file.folder_id){
    const root=await(await graph('/drives/'+enc(env.driveId)+'/root?$select=id',env.access)).json();
    const center=(await db('centers?select=name&code=eq.'+enc(target.center_code),{token:user.token}))[0];
    const home=await folder(env.driveId,root.id,'SAJOANSAN 업무자료',env.access);
    const centerFolder=await folder(env.driveId,home,filePart(center?.name,target.center_code),env.access);
    const destination=await folder(env.driveId,centerFolder,kind+'_'+subjectId,env.access);
    await db('operations_files?id=eq.'+enc(file.id),{method:'PATCH',body:{drive_id:env.driveId,folder_id:destination}});
    file={...file,drive_id:env.driveId,folder_id:destination};
   }
   if(String(file.drive_id).toLowerCase()!==String(env.driveId).toLowerCase())throw fail('첨부 예약 당시의 OneDrive 계정으로 다시 연결해 주세요.',409);
   const marker='SAJOANSAN operations file '+file.id;
   const savedItem=await save(file,bytes,marker,env.access,item_id=>db('operations_files?id=eq.'+enc(file.id),{method:'PATCH',body:{item_id}}));
   await subject(kind,subjectId,true);
   await db('rpc/operations_commit_file',{method:'POST',body:{p_id:file.id,p_actor:user.id,p_drive:file.drive_id,p_item:savedItem}});
   return json({id:file.id,saved:true});
  });
 }catch(error){
  await db('operations_files?id=eq.'+enc(file.id)+'&status=neq.saved',{method:'PATCH',body:{status:'failed',last_error:String(error.message||'첨부 저장 실패').slice(0,500)}}).catch(()=>{});
  throw error;
 }
}


