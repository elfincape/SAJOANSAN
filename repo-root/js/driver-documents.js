export const DOCUMENT_TYPES = [
  ['food_transport', '식품운반업'], ['livestock_transport', '축산물운반업'],
  ['freight_license', '화물운송사자격증'], ['vehicle_registration', '차량등록증'],
  ['identity', '신분증'], ['health_certificate', '보건증']
];
export function validateDocumentFile(file) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('JPG, PNG, WEBP 사진을 선택해 주세요.');
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error('사진은 10MB 이하만 선택할 수 있습니다.');
}
export function mountDriverDocuments(host, { getExpiry, adapter = null, onSaved = () => {} } = {}) {
  let generation=0,busy=false,refreshCurrent=()=>{};
  const urls=new Set();
  const clearUrls=()=>{urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();};
  function reset(driverId) {
    const version=++generation;
    clearUrls(); host.replaceChildren();
    const title=document.createElement('h3'); title.textContent='기사 서류 사진';title.className='font-semibold text-sm';host.append(title);
    const note=document.createElement('p');note.className='text-xs text-zinc-400';
    note.textContent=adapter?'OneDrive 연결 확인 중…':'OneDrive 연결 대기 · 사진은 아직 저장되지 않습니다.';
    host.append(note);
    if(!driverId){const hint=document.createElement('p');hint.textContent='기사 기본 정보를 먼저 저장한 후 사진을 선택하세요.';host.append(hint);return;}
    let connected=false;
    const slots=new Map();
    const refreshButtons=()=>slots.forEach(s=>{s.upload.disabled=!connected||!s.file||busy;s.input.disabled=busy;s.view.disabled=!s.stored||busy;});
    refreshCurrent=refreshButtons;
    for(const [kind,label] of DOCUMENT_TYPES){
      const box=document.createElement('div');box.className='border border-zinc-700 rounded p-2 space-y-2';
      const caption=document.createElement('label');caption.textContent=label;
      const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.className='block w-full text-xs';caption.append(input);
      const preview=document.createElement('img');preview.alt=label+' 사진';preview.hidden=true;preview.className='max-h-60 max-w-full object-contain';
      const status=document.createElement('p');status.className='text-xs text-zinc-400';
      const upload=document.createElement('button');upload.type='button';upload.className='btn btn-primary text-xs';upload.textContent='OneDrive 업로드';upload.disabled=true;
      const view=document.createElement('button');view.type='button';view.className='btn btn-ghost text-xs';view.textContent='저장 사진 보기';view.disabled=true;
      const slot={input,upload,view,status,preview,file:null,url:null,stored:false,requestId:null};
      slots.set(kind,slot);
      const show=blob=>{if(slot.url){URL.revokeObjectURL(slot.url);urls.delete(slot.url);}slot.url=URL.createObjectURL(blob);urls.add(slot.url);preview.src=slot.url;preview.hidden=false;};
      input.addEventListener('change',()=>{
        slot.file=null;slot.requestId=null;preview.hidden=true;
        if(slot.url){URL.revokeObjectURL(slot.url);urls.delete(slot.url);slot.url=null;}preview.removeAttribute('src');
        try{
          if(input.files?.[0]){validateDocumentFile(input.files[0]);slot.file=input.files[0];slot.requestId=crypto.randomUUID();show(slot.file);status.textContent=slot.file.name+' · 선택됨 (미저장)';}
          else status.textContent='';
        }catch(error){input.value='';status.textContent=error.message;}
        refreshButtons();
      });
      view.addEventListener('click',async()=>{
        if(!adapter||busy||!slot.stored)return;
        busy=true;refreshButtons();status.textContent='사진 불러오는 중…';
        try{const blob=await adapter.download(driverId,kind);if(generation===version){show(blob);status.textContent='OneDrive 저장 사진';}}
        catch(error){if(generation===version)status.textContent=error.message;}
        finally{busy=false;refreshCurrent();}
      });
      upload.addEventListener('click',async()=>{
        if(!adapter||!connected||!slot.file||busy)return;
        const expiry=getExpiry?.()||null;
        if(kind==='health_certificate'&&!expiry){status.textContent='보건증 만료일을 먼저 입력하고 저장해 주세요.';return;}
        busy=true;refreshButtons();status.textContent='OneDrive 저장 중…';
        try{
          await adapter.upload({driverId,kind,file:slot.file,expiresOn:kind==='health_certificate'?expiry:null,requestId:slot.requestId});
          onSaved(driverId,kind,expiry);
          if(generation===version){slot.stored=true;slot.file=null;input.value='';status.textContent='OneDrive 저장 완료';}
        }catch(error){if(generation===version)status.textContent='저장 실패: '+error.message+' (같은 사진으로 재시도 가능)';}
        finally{busy=false;refreshCurrent();}
      });
      box.append(caption,preview,status,upload,view);host.append(box);
    }
    if(adapter){
      Promise.all([adapter.status(),adapter.list(driverId)]).then(([connection,records])=>{
        if(generation!==version)return;
        connected=connection.connected;
        note.textContent=connected?'지정된 서류 폴더에 저장합니다. 교체 전 사진은 OneDrive에 보존됩니다.':'관리자가 OneDrive 연결 버튼으로 먼저 연결해 주세요.';
        records.forEach(doc=>{const slot=slots.get(doc.document_type);if(slot){slot.stored=true;if(!slot.file)slot.status.textContent='저장됨 · '+new Date(doc.uploaded_at).toLocaleString('ko-KR');}});
        refreshButtons();
      }).catch(error=>{if(generation===version){note.textContent=error.message;connected=false;refreshButtons();}});
    }
  }
  window.addEventListener('pagehide',clearUrls);
  reset(null);
  return {reset};
}
