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
export function mountDriverDocuments(host, { getExpiry=()=>'', adapter=null, onSaved=()=>{}, companyMode=false }={}) {
  let generation=0,pending=false,refreshCurrent=()=>{};
  const urls=new Set();
  const clearUrls=()=>{urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();};
  const el=(tag,text='',className='')=>{const node=document.createElement(tag);node.textContent=text;node.className=className;return node;};
  window.addEventListener('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',clearUrls);
  function reset(ownerId){
    const generationId=++generation,current=()=>generationId===generation;
    clearUrls();host.replaceChildren();
    host.append(el('h3',companyMode?'운수사 인허가 사진':'기사 서류 사진','font-semibold text-sm'));
    const notice=el('p','','text-xs text-zinc-300');notice.setAttribute('role','status');host.append(notice);
    if(!ownerId){notice.textContent=(companyMode?'운수사':'기사')+' 기본 정보를 먼저 저장하세요.';return;}
    notice.textContent='사진 선택 또는 Ctrl+V로 자동 저장됩니다. 뒷면은 여러 장 추가할 수 있습니다.';
    let records=[],loaded=false;
    const controls=[],areas=new Map(),types=companyMode?DOCUMENT_TYPES.slice(0,4):DOCUMENT_TYPES;
    const version=row=>row.request_id||row.uploaded_at;
    const addButton=(parent,label,action)=>{
      const b=el('button',label,'btn btn-ghost text-xs');b.type='button';
      b.addEventListener('click',action);parent.append(b);controls.push(b);return b;
    };
    let pdfButton,staticControls=0;
    const refresh=()=>{controls.forEach(b=>b.disabled=pending||!loaded);if(pdfButton)pdfButton.disabled=pending||!loaded||!records.length;};
    refreshCurrent=refresh;
    async function reload(){
      const result=await adapter.list(ownerId);
      if(!current())return;
      records=result;loaded=true;render();refresh();
    }
    async function run(work,{reloadAfter=true}={}){
      if(pending||!current()||!loaded)return;
      pending=true;refresh();
      let resultMessage='';
      try{resultMessage=await work()||'저장 완료';}
      catch(error){resultMessage=error.message;}
      finally{
        if(reloadAfter&&current())try{await reload();}catch(error){loaded=false;resultMessage+=' · 목록 조회 실패: '+error.message;}
        pending=false;refreshCurrent();
        if(current())notice.textContent=resultMessage;
      }
    }
    function preview(parent,row,blob){
      const image=el('img'),zoom=el('img');
      const url=URL.createObjectURL(blob);urls.add(url);
      image.src=url;image.alt=row.file_name||'서류 사진';image.tabIndex=0;
      image.className='driver-document-preview max-h-48 max-w-full object-contain';image.title='마우스를 올리면 확대됩니다.';
      zoom.src=url;zoom.alt='';zoom.className='driver-document-zoom';zoom.setAttribute('aria-hidden','true');
      parent.replaceChildren();parent.append(image,zoom);
    }
    function render(){
      controls.splice(staticControls);
      clearUrls();
      for(const [kind] of types){
        const area=areas.get(kind);area.replaceChildren();
        const pages=records.filter(r=>r.document_type===kind).toSorted((a,b)=>(a.page_number||0)-(b.page_number||0));
        if(!pages.length){area.append(el('p','등록된 사진 없음','text-xs text-zinc-500'));continue;}
        pages.forEach((row,index)=>{
          const card=el('div','','border-t border-zinc-700 pt-2 space-y-2');
          card.append(el('p',(kind.endsWith('_back')?(index+1)+'번째 · ':'')+'DB저장됨 · '+new Date(row.uploaded_at).toLocaleString('ko-KR'),'text-xs text-emerald-300'));
          const imageArea=el('div');card.append(imageArea);
          addButton(card,'저장 사진 보기',()=>run(async()=>{
            notice.textContent='사진 불러오는 중…';
            const blob=await adapter.download(ownerId,kind,version(row),row.id);
            if(current())preview(imageArea,row,blob);
            return '저장된 사진 · 마우스를 올리면 확대됩니다.';
          },{reloadAfter:false}));
          addButton(card,'사진 삭제',()=>{
            if(!window.confirm('선택한 사진을 삭제 보관 폴더로 이동하시겠습니까?'))return;
            return run(async()=>{await adapter.remove(ownerId,kind,version(row),row.id);return '사진 삭제 완료';});
          });
          area.append(card);
        });
      }
    }
    for(const [kind,label] of types){
      const box=el('section','','border border-zinc-700 rounded p-3 space-y-2');
      const caption=el('label',label,'block text-sm font-medium');
      const input=el('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';
      input.multiple=kind.endsWith('_back');input.className='block w-full text-xs mt-2';controls.push(input);caption.append(input);
      box.append(caption);
      if(input.multiple)box.append(el('p','여러 장 선택 가능 · 기존 뒷면에 추가됩니다.','text-xs text-zinc-400'));
      const save=files=>{
        if(!files.length)return;
        const expiry=getExpiry();
        try{
          files.forEach(validateDocumentFile);
          if(!input.multiple&&files.length>1)throw new Error('앞면 및 단일 서류는 한 장만 선택해 주세요.');
          if(kind==='health_certificate'&&!/^\d{4}-\d{2}-\d{2}$/.test(expiry))throw new Error('보건증 만료일을 먼저 선택해 주세요.');
        }catch(error){notice.textContent=error.message;input.value='';return;}
        return run(async()=>{
          let saved=0;
          try{
            for(const file of files){
              if(current())notice.textContent='저장중 · '+(saved+1)+'/'+files.length;
              await adapter.upload({driverId:ownerId,kind,file,expiresOn:expiry,requestId:crypto.randomUUID()});
              saved++;onSaved(ownerId,kind,expiry);
            }
            return saved+'장 저장 완료';
          }catch(error){throw new Error(saved+'장 저장 완료 · 나머지 사진 저장 실패: '+error.message);}
          finally{input.value='';}
        });
      };
      input.addEventListener('change',()=>save(Array.from(input.files||[])));
      const paste=addButton(box,'사진 붙여넣기 · 클릭 후 Ctrl+V',()=>{});
      paste.setAttribute('aria-label',label+' 사진 붙여넣기');
      box.addEventListener('paste',event=>{
        if(pending||!loaded||!current())return;
        const data=event.clipboardData;
        let files=Array.from(data?.items||[]).filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);
        if(!files.length)files=Array.from(data?.files||[]).filter(f=>f.type.startsWith('image/'));
        if(files.length){event.preventDefault();return save(files);}
      });
      if(!companyMode&&['food_transport','livestock_transport'].includes(kind)&&adapter?.replaceCompany){
        addButton(box,'운수사 대체',()=>{
          if(!window.confirm(label.replace(' 앞','')+' 앞면과 모든 뒷면을 기사에 저장된 운수사의 사진으로 대체하시겠습니까?'))return;
          return run(async()=>{
            notice.textContent='운수사 사진 복사 중…';
            const result=await adapter.replaceCompany(ownerId,kind);
            return '운수사 사진 '+result.count+'장으로 대체했습니다.';
          });
        });
      }
      const area=el('div','','space-y-3');areas.set(kind,area);box.append(area);host.append(box);
    }
    if(adapter?.compilePdf&&!companyMode){
      const area=el('section','','border-t border-zinc-700 pt-3 space-y-2');
      pdfButton=addButton(area,'인허가 PDF 저장',()=>run(async()=>{
        const result=await adapter.compilePdf(ownerId,message=>{if(current())notice.textContent=message;});
        return 'OneDrive 저장 완료 · '+result.fileName;
      },{reloadAfter:false}));
      area.append(el('p','등록된 사진 전체를 서류 종류와 뒷면 순서대로 저장합니다.','text-xs text-zinc-400'));host.append(area);
    }
    staticControls=controls.length;refresh();
    Promise.resolve().then(async()=>{
      if(!adapter||(await adapter.status()).connected!==true)throw new Error('관리자가 OneDrive를 먼저 연결해 주세요.');
      await reload();
    }).catch(error=>{if(current())notice.textContent=error.message;});
  }
  reset(null);
  return {reset};
}
