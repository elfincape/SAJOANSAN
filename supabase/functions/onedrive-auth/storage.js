const enc=encodeURIComponent;
export function createOneDriveStorage({settings,connected,graph,fetcher,hash,fail}){
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
  if(!item.folder||!item.id||String(item.parentReference?.driveId).toLowerCase()!==String(drive).toLowerCase())throw fail('보관 폴더 이름이 기존 파일과 충돌합니다.',409);
  return item.id;
 }
 async function verify(file,item,access){
  if(!item?.id||!item.file||item.size!==file.byte_size||item.name!==file.file_name||String(item.parentReference?.driveId).toLowerCase()!==String(file.drive_id).toLowerCase()||item.parentReference?.id!==file.folder_id)throw fail('OneDrive 저장 결과가 원본 보관 요청과 다릅니다.',409);
  const response=await graph('/drives/'+enc(file.drive_id)+'/items/'+enc(item.id)+'/content',access);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==file.byte_size||await hash(bytes)!==file.content_hash)throw fail('보관 파일 내용 검증에 실패했습니다. 원본은 유지됩니다.',409);
  return bytes;
 }
 async function save(file,bytes,marker,access,persistItem){
  const path='/drives/'+enc(file.drive_id)+'/items/'+enc(file.folder_id)+':/'+enc(file.file_name);
  let existing;try{existing=await graph(path,access,{allowMissing:true});}
  catch(error){throw fail('보관 파일 경로 조회: '+error.message,error.status??502);}let item;
  if(existing){
   item=await existing.json();
   if(item.id!==file.item_id&&item.description!==marker){
    if(file.recover_empty_once&&file.period==='baseline'&&item.size===0&&item.eTag&&Date.parse(item.createdDateTime)>=Date.parse(file.captured_at)){
     const recoveryName=file.file_name.replace(/\.xlsx$/,'_미완료업로드.xlsx');
     await graph('/drives/'+enc(file.drive_id)+'/items/'+enc(item.id),access,{method:'PATCH',headers:{'Content-Type':'application/json','If-Match':item.eTag},body:JSON.stringify({name:recoveryName,'@microsoft.graph.conflictBehavior':'fail'})});
     item=null;
    }else throw fail('같은 이름의 기존 파일이 있습니다 ('+(Number.isFinite(item.size)?item.size+'바이트':'크기 확인 필요')+'). 덮어쓰지 않습니다.',409);
   }
  }
  if(item?.size===0){
   if(!item.eTag||item.name!==file.file_name)throw fail('예약된 빈 파일의 변경 여부를 확인하지 못했습니다.',409);
   item=await(await graph('/drives/'+enc(file.drive_id)+'/items/'+enc(item.id)+'/content',access,{method:'PUT',headers:{'Content-Type':'application/octet-stream','If-Match':item.eTag},body:bytes})).json();
  }
  if(!item){
   let session;
   // Graph defaults to conflictBehavior=fail; omit optional metadata for consumer account compatibility.
   try{session=await(await graph(path+':/createUploadSession',access,{method:'POST'})).json();}
   catch(error){throw fail('원본 업로드 세션 생성: '+error.message,error.status??502);}
   if(!item){const reserved=await graph(path,access,{allowMissing:true});if(reserved){const candidate=await reserved.json();if(candidate.file&&candidate.size===0){await persistItem(candidate.id);item=candidate;}}}
   const url=new URL(session.uploadUrl);if(url.protocol!=='https:'||!['.1drv.com','.onedrive.com','.sharepoint.com','.microsoftpersonalcontent.com'].some(s=>url.hostname.endsWith(s)))throw fail('OneDrive 업로드 호스트 확인 필요: '+url.hostname,502);
   const fragment=10*320*1024;
   for(let start=0;start<bytes.length;start+=fragment){
    const end=Math.min(start+fragment,bytes.length),response=await fetcher(url.href,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(end-start),'Content-Range':`bytes ${start}-${end-1}/${bytes.length}`},body:bytes.slice(start,end),signal:AbortSignal.timeout(45000)});
    if(end===bytes.length){if(![200,201].includes(response.status))throw fail('원본 파일 업로드를 완료하지 못했습니다.',502);item=await response.json();}
    else if(response.status!==202)throw fail('원본 파일 업로드를 완료하지 못했습니다.',502);
   }
  }
  if(!item?.id)throw fail('저장 파일을 확인하지 못했습니다.',502);
  await persistItem(item.id);
  const current=await(await graph('/drives/'+enc(file.drive_id)+'/items/'+enc(item.id)+'?$select=id,name,size,file,parentReference',access)).json();
  await verify(file,current,access);return item.id;
 }
 return {environment,folder,verify,save};
}
