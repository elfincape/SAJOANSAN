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
  const versions={},images=[];
  for(const [kind] of DOCUMENT_TYPES){
    const row=records.find(r=>r.document_type===kind);
    if(!row||!(row.request_id||row.uploaded_at))throw new Error('서류 8장을 모두 저장한 후 PDF를 만들 수 있습니다.');
    versions[kind]=row.request_id||row.uploaded_at;
  }
  for(const [kind,label] of DOCUMENT_TYPES){
    onProgress('사진 취합 '+(images.length+1)+'/8 · '+label);
    const blob=await adapter.download(driverId,kind,versions[kind]);
    images.push([kind,await normalize(blob)]);
  }
  return {versions,images};
}
