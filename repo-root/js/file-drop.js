// File drops reuse the existing input change handlers, including their validation and upload queues.
const FILE_INPUT='input[type="file"]';
const MIME_EXTENSIONS={
 'image/jpeg':['jpg','jpeg','jfif'],'image/png':['png'],'image/webp':['webp'],'image/gif':['gif'],
 'image/bmp':['bmp'],'image/avif':['avif'],'image/heic':['heic'],'image/heif':['heif'],
 'image/tiff':['tif','tiff'],'image/svg+xml':['svg'],'application/pdf':['pdf'],'text/plain':['txt'],'text/csv':['csv']
};
export function validateDroppedFiles(files,input){
  if(!files.length)throw new Error('업로드할 파일을 놓아 주세요. 폴더는 업로드할 수 없습니다.');
  if(!input.multiple&&files.length>1)throw new Error('이 구역에는 파일을 한 개씩 올려 주세요.');
  const accepted=String(input.accept||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
  const matches=file=>{
    const name=file.name.toLowerCase(),mime=String(file.type||'').toLowerCase(),extension=name.split('.').at(-1);
    return !accepted.length||accepted.some(type=>{
      if(type.startsWith('.'))return name.endsWith(type);
      if(type.endsWith('/*')){
        const family=type.slice(0,-1);
        return mime.startsWith(family)||(!mime&&Object.entries(MIME_EXTENSIONS).some(([m,ext])=>m.startsWith(family)&&ext.includes(extension)));
      }
      return mime===type||(!mime&&MIME_EXTENSIONS[type]?.includes(extension));
    });
  };
  if(files.some(file=>!matches(file)))throw new Error('이 구역에서 지원하는 파일 형식을 확인해 주세요. ('+input.accept+')');
  return files;
}
export function uploadCards(input,doc){
  const explicit=input.closest('[data-file-dropzone]');
  if(explicit)return [explicit];
  // Separate the four transfer photos; their shared form is not an upload card.
  if(/^f-photo[1-4]$/.test(input.id))return [input.parentElement];
  if(input.id==='f-photo-input'&&input.closest('#f-photo-dropzone'))
    return [input.closest('#f-photo-dropzone').parentElement];
  // The straightener keeps its hidden input in the empty state while the editor is visible.
  if(input.id==='file-input'&&doc.getElementById('paste-target')&&doc.getElementById('editor'))
    return [doc.getElementById('paste-target'),doc.getElementById('editor')];
  const card=input.closest('.drop-card,.step-card,section,article,aside');
  if(card&&card.querySelectorAll(FILE_INPUT).length===1)return [card];
  // Never widen a drop area to a container shared by two file inputs.
  let root=input.parentElement;
  for(let node=root?.parentElement;node&&node!==doc.body&&node!==doc.documentElement;node=node.parentElement){
    if(node.querySelectorAll(FILE_INPUT).length!==1)break;
    if(node.matches('main,form'))break;
    root=node;
  }
  return root?[root]:[];
}
export function dropTarget(target,doc){
  if(!target?.closest)return null;
  const matches=[];
  for(const input of doc.querySelectorAll(FILE_INPUT)){
    for(const card of uploadCards(input,doc))if(card.contains(target))matches.push({input,card});
  }
  const nearest=matches.filter(a=>!matches.some(b=>a.card!==b.card&&a.card.contains(b.card)));
  return nearest.length===1?nearest[0]:null;
}
export function installFileDrops(doc,win){
  let active=null;
  const fileDrag=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
  const clear=()=>{active?.classList.remove('file-drop-active');active=null;};
  const feedback=(card,message)=>{
    let node=card.querySelector('[data-file-drop-feedback]');
    if(!node){node=doc.createElement('span');node.setAttribute('data-file-drop-feedback','');node.setAttribute('role','status');node.className='file-drop-feedback';card.append(node);}
    node.textContent=message;node.hidden=!message;
  };
  const blocked=input=>input.disabled||input.matches(':disabled');
  const hover=event=>{
    if(!fileDrag(event))return;
    event.preventDefault();event.stopImmediatePropagation();
    const match=dropTarget(event.target,doc);
    const card=match&&!blocked(match.input)?match.card:null;
    if(active!==card){clear();active=card;active?.classList.add('file-drop-active');}
    if(event.dataTransfer)event.dataTransfer.dropEffect=card?'copy':'none';
  };
  win.addEventListener('dragenter',hover,true);
  win.addEventListener('dragover',hover,true);
  win.addEventListener('dragleave',event=>{
    if(active&&(!event.relatedTarget||!active.contains(event.relatedTarget)))clear();
  },true);
  win.addEventListener('dragend',clear,true);
  win.addEventListener('blur',clear);
  win.addEventListener('drop',event=>{
    if(!fileDrag(event))return;
    event.preventDefault();event.stopImmediatePropagation();clear();
    const match=dropTarget(event.target,doc);
    if(!match)return; // Outside cards: prevent browser navigation, never choose an upload target.
    const {input,card}=match;
    if(blocked(input)){feedback(card,'현재 업로드할 수 없습니다. 진행 중인 작업이 끝난 뒤 다시 놓아 주세요.');return;}
    try{
      const files=validateDroppedFiles(Array.from(event.dataTransfer.files||[]),input);
      const transfer=new win.DataTransfer();
      for(const file of files)transfer.items.add(file);
      input.files=transfer.files;
      feedback(card,'');
      input.dispatchEvent(new win.Event('change',{bubbles:true}));
    }catch(error){feedback(card,error.message||'파일을 선택 버튼으로 다시 선택해 주세요.');}
  },true);
}
if(typeof document!=='undefined'&&typeof window!=='undefined')installFileDrops(document,window);
