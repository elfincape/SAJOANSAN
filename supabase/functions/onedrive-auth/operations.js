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
 async function environment(){
  const config=await settings(),connection=await connected();
  const drive=await(await graph('/me/drive?$select=id',connection.accessToken)).json();
  if(!drive.id||String(drive.id).toLowerCase()!==String(config.expected_drive_id).toLowerCase())throw fail('지정한 OneDrive 계정 연결을 확인해 주세요.',409);
  return {driveId:drive.id,access:connection.accessToken};
 }
 async function folder(drive,parent,name,access){
  const base='/drives/'+enc(drive)+'/items/'+enc(parent),path=base+':/'+enc(name);
  let response=await graph(path+'?$select=id,folder,parentReference',access,{allowMissing:true});
  if(!response)response=await graph(base+'/children',access,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,folder:{},'@microsoft.graph.conflictBehavior':'fail'})});
  const item=await response.json();
  if(!item.folder||!item.id||String(item.parentReference?.driveId).toLowerCase()!==String(drive).toLowerCase())throw fail('업무자료 폴더 이름이 기존 파일과 충돌합니다.',409);
  return item.id;
 }
 async function verify(file,item,access){
  if(!item?.id||!item.file||item.size!==file.byte_size||item.name!==file.file_name||String(item.parentReference?.driveId).toLowerCase()!==String(file.drive_id).toLowerCase()||item.parentReference?.id!==file.folder_id)throw fail('OneDrive 저장 결과가 첨부 요청과 다릅니다.',409);
  const response=await graph('/drives/'+enc(file.drive_id)+'/items/'+enc(item.id)+'/content',access);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==file.byte_size||await hash(bytes)!==file.content_hash)throw fail('첨부 파일 내용 검증에 실패했습니다. 원본 파일은 유지됩니다.',409);
  return bytes;
 }
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
   const path='/drives/'+enc(file.drive_id)+'/items/'+enc(file.folder_id)+':/'+enc(file.file_name),marker='SAJOANSAN operations file '+file.id;
   const existing=await graph(path+'?$select=id,name,size,file,parentReference,description',env.access,{allowMissing:true});
   let item;
   if(existing){
    item=await existing.json();
    if(item.id!==file.item_id&&item.description!==marker)throw fail('같은 이름의 기존 파일이 있어 저장을 중단했습니다. 기존 파일은 유지됩니다.',409);
   }else{
    const session=await(await graph(path+':/createUploadSession',env.access,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item:{'@microsoft.graph.conflictBehavior':'fail',name:file.file_name,description:marker,fileSize:bytes.length}})})).json();
    const uploadUrl=new URL(session.uploadUrl);
    if(uploadUrl.protocol!=='https:'||!(uploadUrl.hostname.endsWith('.1drv.com')||uploadUrl.hostname.endsWith('.onedrive.com')||uploadUrl.hostname.endsWith('.sharepoint.com')))throw fail('OneDrive 업로드 주소를 확인하지 못했습니다.',502);
    const response=await fetcher(uploadUrl.href,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length),'Content-Range':`bytes 0-${bytes.length-1}/${bytes.length}`},body:bytes,signal:AbortSignal.timeout(45000)});
    if(![200,201].includes(response.status))throw fail('OneDrive 파일 저장을 완료하지 못했습니다. 같은 파일로 다시 시도해 주세요.',response.status===429?429:502);
    item=await response.json();
   }
   if(!item?.id)throw fail('OneDrive 저장 파일을 확인하지 못했습니다.',502);
   await db('operations_files?id=eq.'+enc(file.id),{method:'PATCH',body:{item_id:item.id}});
   const current=await(await graph('/drives/'+enc(file.drive_id)+'/items/'+enc(item.id)+'?$select=id,name,size,file,parentReference',env.access)).json();
   await verify(file,current,env.access);
   await subject(kind,subjectId,true);
   await db('rpc/operations_commit_file',{method:'POST',body:{p_id:file.id,p_actor:user.id,p_drive:file.drive_id,p_item:item.id}});
   return json({id:file.id,saved:true});
  });
 }catch(error){
  await db('operations_files?id=eq.'+enc(file.id)+'&status=neq.saved',{method:'PATCH',body:{status:'failed',last_error:String(error.message||'첨부 저장 실패').slice(0,500)}}).catch(()=>{});
  throw error;
 }
}
