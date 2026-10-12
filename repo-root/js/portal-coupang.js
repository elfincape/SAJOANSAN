const sessions=new Map();
export const isCoupangTask=task=>task.template_snapshot?.spec?.integration?.kind==='coupang_entry';
export function coupangFields(task){
 const spec=task.template_snapshot?.spec;
 return (spec?.fields??[]).filter(field=>field.key===spec?.integration?.dispatch_field);
}
export function mountCoupangWorkflow({task,panel,form,node,button,files,collect,persist,refresh,writable}){
 if(!isCoupangTask(task)||task.deleted_at)return;
 const settings=task.template_snapshot.spec.integration;
 const section=node('section',undefined,'coupang-workflow');
 section.append(node('h3','배차표 · 입문확인 자료'));panel.append(section);
 const status=node('p',undefined,'coupang-progress');status.setAttribute('role','status');section.append(status);
 const results=node('div',undefined,'coupang-results');section.append(results);section.insertBefore(form,results);const taskActions=form.querySelector(':scope > .actions');if(taskActions)section.append(taskActions);
 const urls=new Set();let frame=null,busy=false,initReady=false,disposed=false,receive=null;
 const session=sessions.get(task.id)??{file:null,source:null,pending:null};sessions.set(task.id,session);
 const held=new Map();
 function toggleBusy(value){
  busy=value;if(value){for(const el of panel.querySelectorAll('button,input,textarea,select')){if(el.tagName==='BUTTON'&&el.textContent==='닫기')continue;held.set(el,el.disabled);el.disabled=true;}}
  else{for(const [el,disabled] of held)el.disabled=disabled;held.clear();}
 }
 const dispatch=()=>form.elements['field_'+settings.dispatch_field]?.value??'';
 async function store(extra){if(!form.isConnected)throw Error('업무를 다시 열어 저장을 재시도하세요.');await persist({...collect(),...extra});}
 function blobUrl(blob){const url=URL.createObjectURL(blob);urls.add(url);return url;}
 async function download(file){
  try{const blob=await files.download(file.id);if(disposed)return;const link=node('a');link.href=blobUrl(blob);link.download=file.file_name||file.original_name;document.body.append(link);link.click();link.remove();}
  catch(error){if(!disposed)status.textContent='다운로드 실패: '+error.message;}
 }
 async function renderResults(){
  try{
   const ids=task.inputs?.coupang_result?.files??[];results.replaceChildren();
   if(!ids.length){results.append(node('p','생성한 엑셀과 이미지가 여기에 표시됩니다.'));return;}
   const rows=await files.list('task',task.id);if(disposed||!section.isConnected)return;
   if(task.inputs.coupang_result.dispatch!==dispatch())results.append(node('p','배차정보가 변경되었습니다. 현재 입력으로 다시 생성해 주세요.'));
   for(const id of ids){const file=rows.find(f=>f.id===id&&f.status==='saved');if(!file)continue;
    const card=node('div',undefined,'coupang-result');card.append(node('strong',file.original_name||file.file_name));
    button(file.mime_type?.startsWith('image/')?'이미지 다운로드':'엑셀 다운로드',()=>download(file),card);results.append(card);
    if(file.mime_type?.startsWith('image/')){
     try{const blob=await files.download(file.id);if(disposed||!card.isConnected)return;const image=node('img');image.alt='생성한 쿠팡 입문확인표';image.src=blobUrl(blob);card.append(image);}
     catch(error){if(!disposed)card.append(node('p','이미지 미리보기를 불러오지 못했습니다. 다운로드를 다시 시도하세요.'));}
    }
   }
   if(task.inputs.coupang_result.image_error)results.append(node('p','이미지 생성 실패: '+task.inputs.coupang_result.image_error));
  }catch(error){if(!disposed)results.replaceChildren(node('p','생성 자료를 불러오지 못했습니다. '+error.message));}
 }
 const observer=new MutationObserver(()=>{if(section.isConnected)return;disposed=true;if(receive)window.removeEventListener('message',receive);urls.forEach(url=>URL.revokeObjectURL(url));observer.disconnect();});observer.observe(panel,{childList:true});
 renderResults();
 if(!writable){status.textContent='저장된 입문확인 자료를 확인하고 다운로드하세요.';return;}
 const picker=node('div',undefined,'coupang-photo-input');picker.setAttribute('data-file-dropzone','');section.insertBefore(picker,form);picker.append(node('p','배차표 사진'));
 const chooser=node('input');chooser.type='file';chooser.accept='image/png,image/jpeg,image/webp';chooser.setAttribute('aria-label','배차표 사진 등록');picker.append(chooser);
 const preview=node('img');preview.alt='등록한 배차표';preview.className='coupang-source-preview';preview.hidden=true;picker.append(preview);
 function showSource(file){preview.src=blobUrl(file);preview.hidden=false;}
 async function initialize(){
  if(!initReady||!frame?.isConnected)return;
  let file=session.file;
  if(!file&&task.inputs?.coupang_source_id){const blob=await files.download(task.inputs.coupang_source_id);if(disposed)return;file=new File([blob],'배차표.jpg',{type:blob.type});session.file=file;showSource(file);}
  frame.contentWindow.postMessage({type:'portal-coupang-init',taskId:task.id,date:task.work_date,dispatch:dispatch(),schedule:task.inputs?.coupang_schedule??[],file,settings},location.origin);
 }
 function openAnalysis(){
  if(frame){frame.hidden=false;return;}
  frame=node('iframe');frame.title='쿠팡 사진 분석·배차 매칭';frame.src='/admin/coupang-entry.html?center='+encodeURIComponent(task.center_code)+'&portal_task='+encodeURIComponent(task.id);section.insertBefore(frame,results);
 }
 const analysisActions=node('div',undefined,'actions');section.insertBefore(analysisActions,results);
 button('사진 분석·배차 매칭',openAnalysis,analysisActions);
 const retry=button('파일 저장 재시도',()=>finish(),analysisActions);retry.hidden=!session.pending;
 chooser.onchange=async()=>{
  const file=chooser.files?.[0];if(!file||busy)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size<1||file.size>10*1024*1024){status.textContent='사진은 PNG·JPG·WEBP, 10MB 이하로 선택하세요.';return;}
  if(session.pending){status.textContent='생성 파일 저장을 먼저 재시도한 뒤 사진을 변경하세요.';chooser.value='';return;}
  toggleBusy(true);
  try{
   status.textContent='배차표 사진 저장 중…';
   const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
   const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   if(session.fingerprint!==fingerprint){session.fingerprint=fingerprint;session.file=file;session.source={id:crypto.randomUUID(),saved:false};}
   if(!session.source.saved){const result=await files.upload({kind:'task',subjectId:task.id,requestId:session.source.id,file});session.source.fileId=result.file?.id??result.id;if(!session.source.fileId)throw Error('사진 저장에 실패했습니다.');session.source.saved=true;}
   await store({coupang_source_id:session.source.fileId,coupang_schedule:[],coupang_result:null});
   showSource(file);await renderResults();openAnalysis();await initialize();
   status.textContent='사진을 등록했습니다. 사진 분석 후 매칭 결과로 엑셀·이미지를 생성하세요.';
  }catch(error){status.textContent=error.message+' 사진을 다시 선택해 재시도하세요.';}
  finally{toggleBusy(false);}
 };
 async function finish(){
  if(busy||!session.pending)return;toggleBusy(true);
  const pending=session.pending;
  try{
   status.textContent='생성한 엑셀·이미지 저장 중…';
   for(const entry of pending.files){
    if(entry.saved)continue;
    const result=await files.upload({kind:'task',subjectId:task.id,requestId:entry.id,file:entry.file});
    entry.fileId=result.file?.id??result.id;if(!entry.fileId)throw Error('파일 저장 결과를 확인하지 못했습니다.');entry.saved=true;
   }
   const changed=dispatch()!==pending.dispatch;
   await store({coupang_schedule:pending.schedule,coupang_result:{files:pending.files.map(f=>f.fileId),dispatch:pending.dispatch,schedule:pending.schedule,capture_range:settings.capture_range,generated_at:pending.generatedAt,image_error:pending.imageError??null}});
   session.pending=null;retry.hidden=true;
   frame?.contentWindow?.postMessage({type:'portal-coupang-saved',taskId:task.id},location.origin);
   await refresh(changed?'배차정보가 바뀌었습니다. 현재 입력으로 다시 생성해 주세요.':pending.imageError?'엑셀은 저장했습니다. 이미지 생성 실패: '+pending.imageError:'엑셀과 이미지를 저장했습니다.');
  }catch(error){retry.hidden=false;status.textContent='파일 저장 실패: '+error.message+' 저장된 파일은 유지되며 재시도할 수 있습니다.';frame?.contentWindow?.postMessage({type:'portal-coupang-error',taskId:task.id,message:status.textContent},location.origin);}
  finally{toggleBusy(false);}
 }
 receive=async event=>{
  if(disposed||!section.isConnected||event.origin!==location.origin||event.source!==frame?.contentWindow||event.data?.taskId!==task.id)return;
  const data=event.data;
  if(data.type==='portal-coupang-ready'){initReady=true;try{await initialize();}catch(error){status.textContent=error.message;}}
  if(data.type==='portal-coupang-generated'){
   if(busy||session.pending){status.textContent='이전 파일의 저장을 먼저 완료하세요.';return;}
   if(!(data.buffer instanceof ArrayBuffer)||!data.buffer.byteLength||data.buffer.byteLength>10*1024*1024||!Array.isArray(data.schedule)||data.schedule.length>1000||typeof data.dispatch!=='string'||typeof data.filename!=='string'||!data.filename.endsWith('.xlsx')||(data.image!=null&&(!(data.image instanceof Blob)||data.image.type!=='image/png'||data.image.size>10*1024*1024))){status.textContent='생성 결과를 받지 못했습니다. 다시 생성해 주세요.';return;}
   session.pending={generatedAt:new Date().toISOString(),dispatch:data.dispatch,schedule:data.schedule,imageError:data.imageError,files:[{id:crypto.randomUUID(),file:new File([data.buffer],data.filename,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})},...(data.image?[{id:crypto.randomUUID(),file:new File([data.image],data.filename.replace(/\.xlsx$/i,'')+'_'+settings.capture_range.replace(':','-')+'.png',{type:'image/png'})}]:[])]};
   await finish();
  }
 };
 form.addEventListener('input',()=>{if(initReady&&frame?.isConnected)frame.contentWindow.postMessage({type:'portal-coupang-dispatch',taskId:task.id,dispatch:dispatch()},location.origin);});
 window.addEventListener('message',receive);
 if(session.file)showSource(session.file);
}
