export async function handleCharter(action,req,user,{db,graph,connected,settings,withLock,json,fail,shareToken,hash}) {
 const enc=encodeURIComponent;
 const body=await req.json();
 const center=body.centerCode;
 if(action!=='charter-status'&&!['001','002'].includes(center))throw fail('센터를 확인해 주세요.');
 if(action==='charter-status'){
  const config=await settings();
  return json({folders:{'001':!!config.folders.charter_001,'002':!!config.folders.charter_002}});
 }
 if(action==='charter-config'){
  if(user.role!=='admin')throw fail('폴더 연결은 관리자만 가능합니다.',403);
  if(typeof body.url!=='string'||body.url.length>2048)throw fail('OneDrive 폴더 공유 링크를 입력해 주세요.');
  return withLock(async()=>{
   const config=await settings(),connection=await connected();
   const folder=await(await graph('/shares/'+enc(shareToken(body.url))+'/driveItem',connection.accessToken)).json();
   const driveId=folder.parentReference?.driveId;
   if(!folder.folder||!driveId||String(driveId).toLowerCase()!==String(config.expected_drive_id).toLowerCase())throw fail('연결된 OneDrive 계정의 폴더를 선택해 주세요.',409);
   const reserved=[...Object.values(connection.folders||{}),...Object.entries(config.folders).filter(([key,value])=>key!=='charter_'+center&&value?.folderId).map(([,value])=>value)];
   if(reserved.some(value=>value.folderId===folder.id))throw fail('다른 문서 저장소와 별도의 용차 폴더를 선택해 주세요.');
   await db('onedrive_settings?id=eq.true',{method:'PATCH',body:{folders:{...config.folders,['charter_'+center]:{driveId,folderId:folder.id}}}});
   return json({configured:true});
  });
 }
 if(action==='charter-archive'){
  if(user.role!=='admin')throw fail('월 보관은 관리자만 가능합니다.',403);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month||''))throw fail('보관할 월을 선택해 주세요.');
  return withLock(async()=>{
   const month=body.month,start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10);
   const rows=[];
   for(let offset=0;;offset+=1000){
    const batch=await db('charter_trips?select=id,payload,version&center_code=eq.'+center+'&business_date=gte.'+start+'&business_date=lt.'+end+'&order=id.asc&offset='+offset+'&limit=1000',{token:user.token});
    rows.push(...batch);if(batch.length<1000)break;if(rows.length>100000)throw fail('월 데이터가 너무 많습니다.');
   }
   if(!rows.length)throw fail('해당 월에 보관할 데이터가 없습니다.');
   const config=await settings(),folder=config.folders['charter_'+center];
   if(!folder?.driveId||!folder?.folderId)throw fail('OneDrive 용차 저장 폴더를 먼저 연결해 주세요.',409);
   const connection=await connected(),id=crypto.randomUUID();
   const archive={schemaVersion:2,centerCode:center,month,exportedAt:new Date().toISOString(),trips:rows.map(r=>r.payload)};
   const bytes=new TextEncoder().encode(JSON.stringify(archive));
   if(bytes.length>20*1024*1024)throw fail('월 JSON이 20MB를 초과합니다. 일별 JSON을 먼저 내려받아 주세요.');
   const fingerprint=await hash(bytes),name='용차_'+center+'_'+month+'_'+id+'.json';
   const item=await(await graph('/drives/'+enc(folder.driveId)+'/items/'+enc(folder.folderId)+':/'+enc(name)+':/content',connection.accessToken,{method:'PUT',headers:{'Content-Type':'application/json'},body:bytes})).json();
   if(!item.id)throw fail('OneDrive 저장 결과를 확인하지 못했습니다.',502);
   const response=await graph('/drives/'+enc(folder.driveId)+'/items/'+enc(item.id)+'/content',connection.accessToken);
   const restored=new Uint8Array(await response.arrayBuffer());
   if(await hash(restored)!==fingerprint)throw fail('보관 파일 검증에 실패했습니다. DB 데이터는 유지됩니다.',502);
   await db('charter_archives',{method:'POST',body:{id,center_code:center,month,drive_id:folder.driveId,item_id:item.id,file_name:name,content_hash:fingerprint,snapshot:{rows},record_count:rows.length,verified_at:new Date().toISOString(),archived_by:user.id}});
   return json({id,month,count:rows.length,verified:true});
  });
 }
 if(action==='charter-read'){
  if(!/^[0-9a-f-]{36}$/i.test(body.archiveId||''))throw fail('보관 파일을 선택해 주세요.');
  const archive=(await db('charter_archives?select=drive_id,item_id,content_hash&center_code=eq.'+center+'&id=eq.'+enc(body.archiveId),{token:user.token}))[0];
  if(!archive)throw fail('보관 파일에 접근할 수 없습니다.',403);
  return withLock(async()=>{
   const connection=await connected();
   const response=await graph('/drives/'+enc(archive.drive_id)+'/items/'+enc(archive.item_id)+'/content',connection.accessToken);
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length>20*1024*1024||await hash(bytes)!==archive.content_hash)throw fail('OneDrive 보관 파일이 변경되었습니다. 원본을 확인해 주세요.',409);
   const parsed=JSON.parse(new TextDecoder().decode(bytes));
   if(parsed.schemaVersion!==2||parsed.centerCode!==center)throw fail('보관 파일 구조가 올바르지 않습니다.');
   return json(parsed);
  });
 }
 throw fail('지원하지 않는 용차 작업입니다.',404);
}
