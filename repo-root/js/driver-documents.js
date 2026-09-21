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
  let generation=0,queue=Promise.resolve(),pending=0,pdfBusy=false,refreshCurrentPdf=()=>{};
  const urls=new Set();
  const clearUrls=()=>{urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();};
  window.addEventListener('beforeunload',event=>{
    if(pending){event.preventDefault();event.returnValue='';}
  });
  function reset(driverId) {
    const version=++generation;refreshCurrentPdf=()=>{};
    clearUrls(); host.replaceChildren();
    const title=document.createElement('h3');title.textContent='기사 서류 사진';title.className='font-semibold text-sm';host.append(title);
    const note=document.createElement('p');note.className='text-xs text-zinc-400';host.append(note);
    if(!driverId){note.textContent='기사 기본 정보를 먼저 저장한 후 사진을 선택하세요.';return;}
    note.textContent='사진 선택 또는 각 칸에서 Ctrl+V로 붙여넣으면 자동 저장됩니다. 보건증은 만료일을 먼저 입력하세요.';
    let connectionError=null;
    // Resolve connection checks without an unhandled rejection before a file is selected.
    const ready=adapter?adapter.status().then(value=>{
      if(!value.connected)connectionError=new Error('관리자가 OneDrive를 먼저 연결해 주세요.');
    }).catch(error=>{connectionError=error;}):Promise.resolve().then(()=>{connectionError=new Error('OneDrive 연결이 필요합니다.');});
    const slots=new Map();
    const pdfArea=document.createElement('section');pdfArea.className='border-t border-zinc-700 pt-3 space-y-2';
    const pdfButton=document.createElement('button');pdfButton.type='button';pdfButton.className='btn btn-primary';pdfButton.textContent='인허가 PDF 저장';pdfButton.disabled=true;
    const pdfNote=document.createElement('p');pdfNote.className='text-xs text-zinc-300';pdfNote.setAttribute('role','status');
    const refreshPdf=()=>{
      const complete=slots.size===8&&Array.from(slots.values()).every(slot=>slot.stored&&slot.version&&!slot.busy);
      pdfButton.disabled=!complete||pending>0||pdfBusy||!adapter?.compilePdf;
      if(!pdfBusy)pdfNote.textContent=complete?'8장 준비 완료 · 사진 칸 순서대로 PDF를 저장합니다.':'서류 8장을 모두 저장하면 PDF 취합이 가능합니다.';
    };
    refreshCurrentPdf=refreshPdf;
    pdfButton.addEventListener('click',async()=>{
      if(pdfButton.disabled||!current())return;
      pdfBusy=true;pending++;refreshPdf();pdfButton.disabled=true;
      try{
        const result=await adapter.compilePdf(driverId,message=>{if(current())pdfNote.textContent=message;});
        if(current())pdfNote.textContent='OneDrive 저장 완료 · '+result.fileName;
      }catch(error){if(current())pdfNote.textContent='PDF 저장 실패: '+error.message;}
      finally{pdfBusy=false;pending--;if(current())pdfButton.disabled=!Array.from(slots.values()).every(slot=>slot.stored&&slot.version&&!slot.busy);else refreshCurrentPdf();}
    });
    pdfArea.append(pdfButton,pdfNote);
    const current=()=>generation===version;
    for(const [kind,label] of DOCUMENT_TYPES){
      const box=document.createElement('div');box.className='border border-zinc-700 rounded p-2 space-y-2';
      const caption=document.createElement('label');caption.textContent=label;
      const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.className='block w-full text-xs';caption.append(input);
      const preview=document.createElement('img');preview.alt=label+' 사진';preview.hidden=true;preview.className='max-h-60 max-w-full object-contain';
      const detail=document.createElement('p');detail.className='text-xs text-zinc-400';
      const status=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
      const view=document.createElement('button');view.type='button';view.className='btn btn-ghost text-xs';view.textContent='저장 사진 보기';view.disabled=true;
      const remove=document.createElement('button');remove.type='button';remove.className='btn btn-danger text-xs';remove.textContent='사진 삭제';remove.disabled=true;
      const slot={remove,version:null,input,view,status,detail,preview,url:null,stored:false,busy:false,touched:false};
      slots.set(kind,slot);
      const state=value=>{
        status.hidden=false;status.textContent=value;
        status.className='inline-block rounded px-2 py-1 text-xs '+(value==='DB저장됨'?'bg-emerald-900 text-emerald-200':value==='저장실패'?'bg-red-900 text-red-200':'bg-amber-900 text-amber-200');
      };
      const show=blob=>{
        if(slot.url){URL.revokeObjectURL(slot.url);urls.delete(slot.url);}
        slot.url=URL.createObjectURL(blob);urls.add(slot.url);preview.src=slot.url;preview.hidden=false;
      };
      function saveFile(file){
        if(!file||slot.busy||pdfBusy||!current())return;
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
        slot.busy=true;input.disabled=true;view.disabled=true;pending++;refreshPdf();
        // Serialize automatic uploads across all slots, including a driver change.
        const task=queue.then(async()=>{
          await ready;
          if(connectionError)throw connectionError;
          await adapter.upload({driverId,kind,file,expiresOn:expiry,requestId});
          if(current()){slot.stored=true;slot.version=requestId;state('DB저장됨');detail.textContent='';}
          onSaved(driverId,kind,expiry);
        }).catch(error=>{
          if(current()){state('저장실패');detail.textContent=error.message+' 사진을 다시 선택하면 재시도합니다.';}
        }).finally(()=>{
          pending--;slot.busy=false;
          if(current()){input.value='';input.disabled=false;view.disabled=!slot.stored;remove.disabled=!slot.stored;refreshPdf();}else refreshCurrentPdf();
        });
        queue=task;
        return task;
      }
      input.addEventListener('change',()=>saveFile(input.files?.[0]));
      const pasteTarget=document.createElement('button');pasteTarget.type='button';
      pasteTarget.className='block w-full rounded border border-dashed border-zinc-500 p-3 text-xs text-zinc-300 focus:outline-none focus:ring-2 focus:ring-emerald-400';
      pasteTarget.textContent='사진 붙여넣기 · 여기를 클릭한 뒤 Ctrl+V (Mac: ⌘V)';
      pasteTarget.setAttribute('aria-label',label+' 사진 붙여넣기: 클릭 후 Ctrl+V');
      box.addEventListener('paste',event=>{
        const data=event.clipboardData;
        if(!data||!current())return;
        let files=Array.from(data.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
        if(!files.length)files=Array.from(data.files||[]).filter(file=>file.type.startsWith('image/'));
        if(!files.length)return; // Leave ordinary text paste untouched.
        event.preventDefault();
        if(slot.busy)return;
        if(files.length!==1){detail.textContent='사진은 한 번에 한 장씩 붙여넣어 주세요.';return;}
        return saveFile(files[0]);
      });
      view.addEventListener('click',async()=>{
        if(!adapter||slot.busy||pdfBusy||!slot.stored)return;
        slot.busy=true;view.disabled=true;input.disabled=true;refreshPdf();
        try{const blob=await adapter.download(driverId,kind);if(current()){show(blob);detail.textContent='저장된 사진';}}
        catch(error){if(current())detail.textContent=error.message;}
        finally{slot.busy=false;if(current()){view.disabled=false;input.disabled=false;refreshPdf();}}
      });
      remove.addEventListener('click',()=>{
        if(!current()||slot.busy||pdfBusy||!slot.stored||!slot.version||!adapter)return;
        if(!window.confirm(label+' 사진을 삭제 보관 폴더로 이동하시겠습니까?'))return;
        const versionToRemove=slot.version;
        slot.busy=true;slot.touched=true;input.disabled=true;view.disabled=true;remove.disabled=true;pending++;refreshPdf();
        detail.textContent='삭제 보관 폴더로 이동 중…';
        const task=queue.then(()=>adapter.remove(driverId,kind,versionToRemove)).then(()=>{
          if(!current())return;
          slot.stored=false;slot.version=null;status.hidden=true;
          if(slot.url){URL.revokeObjectURL(slot.url);urls.delete(slot.url);slot.url=null;}
          preview.hidden=true;preview.removeAttribute('src');input.value='';
          detail.textContent='사진 삭제 완료 · OneDrive 보관 폴더로 이동했습니다.';
        }).catch(error=>{if(current())detail.textContent='삭제 실패: '+error.message;}).finally(()=>{
          pending--;slot.busy=false;
          if(current()){input.disabled=false;view.disabled=!slot.stored;remove.disabled=!slot.stored;refreshPdf();}else refreshCurrentPdf();
        });
        queue=task;return task;
      });
      box.append(caption,preview,detail,status,view,pasteTarget,remove);host.append(box);
    }
    host.append(pdfArea);refreshPdf();
    if(adapter){
      adapter.list(driverId).then(records=>{
        if(!current())return;
        for(const doc of records){
          const slot=slots.get(doc.document_type);if(!slot)continue;
          if(!slot.touched){
            slot.stored=true;slot.version=doc.request_id||doc.uploaded_at;
            slot.remove.disabled=false;
            slot.status.hidden=false;slot.status.textContent='DB저장됨';slot.status.className='inline-block rounded px-2 py-1 text-xs bg-emerald-900 text-emerald-200';
            slot.detail.textContent=new Date(doc.uploaded_at).toLocaleString('ko-KR');
            slot.view.disabled=false;
          }
        }
        refreshPdf();
      }).catch(error=>{if(current())note.textContent=error.message;});
    }
  }
  window.addEventListener('pagehide',clearUrls);
  reset(null);
  return {reset};
}
