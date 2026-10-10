import {fail} from './model.js';
const LIMIT=1024*1024;
export async function notionPhotoFingerprint(page){
  const files=page.properties?.['사진']?.files;
  if(!Array.isArray(files))return null;
  const value=files.map(f=>{let path=f.file?.url||f.external?.url||'';try{const u=new URL(path);path=u.origin+u.pathname;}catch{}
    return [f.name||'',f.type,path,f.file_upload?.id||''];});
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),n=>n.toString(16).padStart(2,'0')).join('');
}
export function photoBytes(photo) {
  const m=/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(photo?.dataUrl || '');
  if(!m || m[2].length>Math.ceil(LIMIT*4/3)+4)throw fail('사진은 JPG·PNG·WEBP·GIF 형식, 1MB 이하로 등록해 주세요.',422,'invalid_photo');
  const bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));
  if(bytes.length>LIMIT)throw fail('사진 크기는 1MB 이하여야 합니다.',422,'invalid_photo');
  return {bytes,type:m[1]};
}
export async function hashPhotos(photos) {
  if(!Array.isArray(photos)||photos.length>6)throw fail('사진은 최대 6장입니다.',422,'invalid_photos');
  const hashes=[];
  for(const p of photos) {
    const {bytes}=photoBytes(p);
    hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join(''));
  }
  return hashes.join(':');
}
export async function downloadPhotos(page,fetcher=fetch) {
  const files=page.properties?.['사진']?.files || [];
  if(files.length>6)throw fail('노션 사진은 최대 6장까지 웹에 반영할 수 있습니다.',422,'invalid_photos');
  const photos=[];
  for(const file of files) {
    const url=new URL(file.file?.url || file.external?.url || 'https://invalid');
    // Only download Notion-managed attachments. Do not fetch operator-supplied URLs from the server.
    if(url.protocol!=='https:' || !/^(?:prod-files-secure[^.]*\.s3\.[a-z0-9-]+\.amazonaws\.com|s3\.[a-z0-9-]+\.amazonaws\.com|prod-files[^.]*\.s3\.us-west-2\.amazonaws\.com)$/.test(url.hostname))
      throw fail('사진은 노션에 직접 업로드해 주세요. 외부 URL 사진은 자동 반영하지 않습니다.',422,'external_photo');
    const r=await fetcher(url.href,{redirect:'error',signal:AbortSignal.timeout(10000)});
    const type=(r.headers.get('content-type')||'').split(';')[0];
    if(!r.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type) || Number(r.headers.get('content-length'))>LIMIT)
      throw fail('사진은 JPG·PNG·WEBP·GIF 형식, 1MB 이하로 등록해 주세요.',422,'invalid_photo');
    const reader=r.body.getReader();const chunks=[];let size=0;
    try {
      while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT)throw fail('사진 크기는 1MB 이하여야 합니다.',422,'invalid_photo');chunks.push(value);}
    }finally{await reader.cancel();}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    photos.push({name:file.name||'notion-photo',type,size,dataUrl:'data:'+type+';base64,'+btoa(binary)});
  }
  return photos;
}
export async function uploadPhotos(photos,request,env,fetcher=fetch) {
  const files=[];
  for(const p of photos) {
    const {bytes,type}=photoBytes(p),name=String(p.name||'photo.jpg').slice(0,150);
    const upload=await request('file_uploads','POST',{mode:'single_part',filename:name,content_type:type});
    if(!upload.id)throw fail('노션 사진 업로드를 시작하지 못했습니다.',502,'photo_upload');
    const form=new FormData();form.append('file',new Blob([bytes],{type}),name);
    const r=await fetcher('https://api.notion.com/v1/file_uploads/'+upload.id+'/send',{
      method:'POST',headers:{Authorization:'Bearer '+env.NOTION_API_TOKEN.trim(),'Notion-Version':'2026-03-11'},body:form,signal:AbortSignal.timeout(15000)});
    if(!r.ok || (await r.json()).status!=='uploaded')throw fail('노션 사진 업로드에 실패했습니다.',502,'photo_upload');
    files.push({name,type:'file_upload',file_upload:{id:upload.id}});
  }
  return files;
}
