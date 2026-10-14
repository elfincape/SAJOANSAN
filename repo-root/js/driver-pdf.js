import { DOCUMENT_TYPES } from './driver-documents.js';
export async function photoToJpeg(blob) {
  const bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});
  try {
    const scale=Math.min(1,3508/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('사진 변환을 지원하지 않는 브라우저입니다.');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('사진 변환에 실패했습니다.')),'image/jpeg',0.94));
  } finally {bitmap.close();}
}
export async function prepareCompilation(adapter,driverId,onProgress=()=>{},normalize=photoToJpeg) {
  const records=await adapter.list(driverId);
  if(!records.length)throw Object.assign(new Error('저장된 서류 사진이 없습니다.'),{code:'NO_DOCUMENTS'});
  const kinds=DOCUMENT_TYPES.map(([kind])=>kind);
  const ordered=records.toSorted((a,b)=>kinds.indexOf(a.document_type)-kinds.indexOf(b.document_type)||(a.page_number||0)-(b.page_number||0));
  const versions={},images=[];
  for(const row of ordered){
    const key=row.id||row.document_type,version=row.request_id||row.uploaded_at;
    if(!version||Object.hasOwn(versions,key))throw new Error('서류 목록을 새로고침해 주세요.');
    versions[key]=version;
  }
  for(const row of ordered){
    const key=row.id||row.document_type,label=DOCUMENT_TYPES.find(([k])=>k===row.document_type)?.[1]||row.document_type;
    onProgress('사진 취합 '+(images.length+1)+'/'+ordered.length+' · '+label);
    const blob=await adapter.download(driverId,row.document_type,versions[key],row.id);
    images.push([key,await normalize(blob)]);
  }
  return {versions,images};
}

export async function compileCenterPdfs(adapter,drivers,{includeCompany=true,onProgress=()=>{},shouldStop=()=>false}={}) {
  const results=[];
  // Sequential requests keep each driver's images and PDF out of memory after saving.
  for(const driver of drivers) {
    if(shouldStop())break;
    const index=results.length+1;
    onProgress({index,total:drivers.length,driver,message:'서류 확인 중…',results:[...results]});
    let result;
    try {
      const saved=await adapter.compilePdf(driver.id,message=>onProgress({index,total:drivers.length,driver,message,results:[...results]}),{includeCompany});
      if(saved?.saved!==true)throw new Error('PDF 저장 결과를 확인하지 못했습니다.');
      result={driver,status:'saved',fileName:saved.fileName};
    } catch(error) {
      result={driver,status:error.code==='NO_DOCUMENTS'?'skipped':'failed',message:error.message};
    }
    results.push(result);
    onProgress({index,total:drivers.length,driver,message:result.status==='saved'?'저장 완료':result.message,results:[...results]});
  }
  return {results,total:drivers.length,stopped:results.length<drivers.length};
}
