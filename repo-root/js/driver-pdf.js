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
  if(!records.length)throw new Error('저장된 서류 사진이 없습니다.');
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
