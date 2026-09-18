export const DOCUMENT_TYPES = [
  ['food_transport', '식품운반업 앞'], ['food_transport_back', '식품운반업 뒤'],
  ['livestock_transport', '축산물운반업 앞'], ['livestock_transport_back', '축산물운반업 뒤'],
  ['freight_license', '화물운송사자격증'], ['vehicle_registration', '차량등록증'],
  ['identity', '신분증'], ['health_certificate', '보건증']
];
export function validateDocumentFile(file) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('JPG, PNG, WEBP 사진을 선택해 주세요.');
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error('사진은 10MB 이하만 선택할 수 있습니다.');
}
export function mountDriverDocuments(host, { getExpiry, adapter = null, onSaved = () => {} } = {}) {
  let generation=0,queue=Promise.resolve(),pending=0;
  const urls=new Set();
  const clearUrls=()=>{urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();};
  window.addEventListener('beforeunload',event=>{
    if(pending){event.preventDefault();event.returnValue='';}
  });
  function reset(driverId) {
    const version=++generation;
    clearUrls(); host.replaceChildren();
    const title=document.createElement('h3');title.textContent='기사 서류 사진';title.className='font-semibold text-sm';host.append(title);
    const note=document.createElement('p');note.className='text-xs text-zinc-400';host.append(note);
    if(!driverId){note.textContent='기사 기본 정보를 먼저 저장한 후 사진을 선택하세요.';return;}
    note.textContent='사진을 선택하면 자동 저장됩니다. 보건증은 만료일을 먼저 입력하세요.';
    let connectionError=null;
    // Resolve connection checks without an unhandled rejection before a file is selected.
    const ready=adapter?adapter.status().then(value=>{
      if(!value.connected)connectionError=new Error('관리자가 OneDrive를 먼저 연결해 주세요.');
    }).catch(error=>{connectionError=error;}):Promise.resolve().then(()=>{connectionError=new Error('OneDrive 연결이 필요합니다.');});
    const slots=new Map();
    const current=()=>generation===version;
    for(const [kind,label] of DOCUMENT_TYPES){
      const box=document.createElement('div');box.className='border border-zinc-700 rounded p-2 space-y-2';
      const caption=document.createElement('label');caption.textContent=label;
      const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.className='block w-full text-xs';caption.append(input);
      const preview=document.createElement('img');preview.alt=label+' 사진';preview.hidden=true;preview.className='max-h-60 max-w-full object-contain';
      const detail=document.createElement('p');detail.className='text-xs text-zinc-400';
      const status=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
      const view=document.createElement('button');view.type='button';view.className='btn btn-ghost text-xs';view.textContent='저장 사진 보기';view.disabled=true;
      const slot={input,view,status,detail,preview,url:null,stored:false,busy:false,touched:false};
      slots.set(kind,slot);
      const state=value=>{
        status.hidden=false;status.textContent=value;
        status.className='inline-block rounded px-2 py-1 text-xs '+(value==='DB저장됨'?'bg-emerald-900 text-emerald-200':value==='저장실패'?'bg-red-900 text-red-200':'bg-amber-900 text-amber-200');
      };
      const show=blob=>{
        if(slot.url){URL.revokeObjectURL(slot.url);urls.delete(slot.url);}
        slot.url=URL.createObjectURL(blob);urls.add(slot.url);preview.src=slot.url;preview.hidden=false;
      };
      input.addEventListener('change',()=>{
        const file=input.files?.[0];
        if(!file||slot.busy)return;
        slot.touched=true;
        if(slot.url){URL.revokeObjectURL(slot.url);urls.delete(slot.url);slot.url=null;}
        preview.hidden=true;preview.removeAttribute('src');
        const expiry=kind==='health_certificate'?(getExpiry?.()||null):null;
        try{
          validateDocumentFile(file);
          if(kind==='health_certificate'&&!expiry)throw new Error('보건증 만료일을 입력한 뒤 사진을 다시 선택해 주세요.');
        }catch(error){state('저장실패');detail.textContent=error.message;input.value='';return;}
        const requestId=crypto.randomUUID();
        show(file);state('저장중');detail.textContent=file.name;
        slot.busy=true;input.disabled=true;view.disabled=true;pending++;
        // Serialize automatic uploads across all slots, including a driver change.
        const task=queue.then(async()=>{
          await ready;
          if(connectionError)throw connectionError;
          await adapter.upload({driverId,kind,file,expiresOn:expiry,requestId});
          if(current()){slot.stored=true;state('DB저장됨');detail.textContent='';}
          onSaved(driverId,kind,expiry);
        }).catch(error=>{
          if(current()){state('저장실패');detail.textContent=error.message+' 사진을 다시 선택하면 재시도합니다.';}
        }).finally(()=>{
          pending--;slot.busy=false;
          if(current()){input.value='';input.disabled=false;view.disabled=!slot.stored;}
        });
        queue=task;
        return task;
      });
      view.addEventListener('click',async()=>{
        if(!adapter||slot.busy||!slot.stored)return;
        view.disabled=true;input.disabled=true;
        try{const blob=await adapter.download(driverId,kind);if(current()){show(blob);detail.textContent='저장된 사진';}}
        catch(error){if(current())detail.textContent=error.message;}
        finally{if(current()){view.disabled=false;input.disabled=false;}}
      });
      box.append(caption,preview,detail,status,view);host.append(box);
    }
    if(adapter){
      adapter.list(driverId).then(records=>{
        if(!current())return;
        for(const doc of records){
          const slot=slots.get(doc.document_type);if(!slot)continue;
          slot.stored=true;
          if(!slot.touched){
            slot.status.hidden=false;slot.status.textContent='DB저장됨';slot.status.className='inline-block rounded px-2 py-1 text-xs bg-emerald-900 text-emerald-200';
            slot.detail.textContent=new Date(doc.uploaded_at).toLocaleString('ko-KR');
            slot.view.disabled=false;
          }
        }
      }).catch(error=>{if(current())note.textContent=error.message;});
    }
  }
  window.addEventListener('pagehide',clearUrls);
  reset(null);
  return {reset};
}
