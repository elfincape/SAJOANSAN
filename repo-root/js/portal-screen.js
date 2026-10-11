import {requireAuth} from './auth.js';
import {supabase} from './supabase.js';
import {createOperationsApi} from './operations-api.js';
import {operationsFiles} from './onedrive-api.js';
import {portalAi} from './portal-ai.js';
import {createPortalSearch} from './portal-search.js';
import {createPortalBackups} from './portal-backups.js';
import {setupPortalSidebar} from './portal-sidebar.js';
import {koreaDate,statusLabels,actionLabels} from './operations-view.js';
import {finished,dispatchWarning,orderTasks,currentTemplates,collectInputs,surveyFields,surveyStages} from './portal-model.js';
const $=id=>document.getElementById(id),api=createOperationsApi(supabase),profile=await requireAuth();
const state={view:'center',incidentScope:'center',context:null,tasks:[],incidents:[],templates:[],surveys:[],notifications:[],parents:[],selected:null,busy:false,retry:null};
const incidentKinds=['차량 대차','차량 섭외 지연','납품처 문제','기사 문제','차량 문제','기타 특이사항'];
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text).replaceAll('HQ','배송팀');if(className)el.className=className;return el;}
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function centerName(code){return state.context.centers.find(c=>c.code===code)?.name??code;}
function canWrite(code){return state.context.writable_centers.includes(code);}
function isHq(){return profile.role==='admin';}
function stamp(value){return value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'';}
function button(text,handler,parent,className){const el=node('button',text,className);el.type='button';el.onclick=handler;parent.append(el);return el;}
const renderBackups=createPortalBackups({node,button,message,stamp});
const renderSearch=createPortalSearch({supabase,node,button,centerName,message,openRecord:async(type,id)=>{
 try{const table={task:'operations_tasks',incident:'operations_incidents',survey:'operations_surveys'}[type];
  const {data,error}=await supabase.from(table).select('*').eq('id',id).single();if(error)throw error;choose(type,data);
 }catch(error){message(error.message||'원본 기록을 불러오지 못했습니다.',true);}
}});
function field(form,label,name,value='',type='text'){const wrap=node('label',label),el=node(type==='textarea'?'textarea':'input');if(type!=='textarea')el.type=type;el.name=name;if(type==='checkbox')el.checked=value===true;else el.value=value??'';wrap.append(el);form.append(wrap);return el;}
function setBusy(value){state.busy=value;document.querySelectorAll('button:not([data-navigation-toggle]),input,select,textarea').forEach(el=>{if(value){el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}else if(el.dataset.wasDisabled!==undefined){el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}});}
async function mutate(key,operation,success){
 if(state.busy)return;
 if(state.retry?.key!==key)state.retry={key,requestId:crypto.randomUUID()};
 setBusy(true);message('저장하는 중입니다…');
 try{const result=await operation(state.retry.requestId);state.retry=null;if(success)success(result);await loadData();render();message('저장했습니다.');}
 catch(error){message(error.message||'저장하지 못했습니다. 입력을 유지했습니다. 다시 시도해 주세요.',true);}
 finally{setBusy(false);}
}
async function loadData(){
 if(['search','backups'].includes(state.view))return;
 const center=$('center').value,day=koreaDate();
 const [tasks,incidents,templates,surveys,notifications,staff,briefing]=await Promise.all([
 api.tasks({center:state.view==='hq'?undefined:center,from:day,through:day,includeCompleted:$('completed').checked}),
 api.incidents({center:['hq','briefing'].includes(state.view)||(state.view==='incidents'&&state.incidentScope==='all')?undefined:center,includeResolved:true}),api.templates(center),api.surveys(state.view==='hq'?undefined:center),api.notifications(),state.view==='access'?api.staffAccess():[],state.view==='briefing'?portalAi.cachedBriefing():null]);
 const parents=await api.parentTasks(incidents.map(i=>i.task_id));
 Object.assign(state,{tasks,incidents,templates,surveys,notifications,staff,briefing,parents});
 $('unread').textContent=notifications.filter(n=>!n.read_at).length||'';
 if(state.selected){const collection=state.selected.type==='task'?tasks:state.selected.type==='incident'?incidents:surveys;const row=collection.find(r=>r.id===state.selected.row.id);state.selected=row?{...state.selected,row}:null;}
}
async function refresh(){if(state.busy)return;setBusy(true);message('업무를 불러오는 중입니다…');try{await loadData();render();message('');}catch(error){message(error.message||'업무를 불러오지 못했습니다.',true);}finally{setBusy(false);}}
function choose(type,row){if($('parent-task-dialog')?.open)$('parent-task-dialog').close();state.selected={type,row};renderDetail();}
function addRow(row,type,parent,extra=''){
 const el=button(row.title,()=>choose(type,row),parent,'task-row');el.replaceChildren();const content=node('span',row.title);content.append(node('small',extra));
 if(type==='task'){const warning=dispatchWarning(row);if(warning)content.append(node('small',warning,'warning'));}
 el.append(content,node('span',type==='survey'?surveyStages[row.stage]:type==='incident'?incidentStatus(row):statusLabels[row.status],'badge'));if(state.selected?.row.id===row.id)el.classList.add('selected');
}
function render(){
 const hq=state.view==='hq',center=$('center').value;
 $('portal-title').textContent=hq?'배송팀 업무':state.view==='briefing'?'배송팀 AI 브리핑':state.view==='access'?'센터 담당자 배정':state.view==='notifications'?'알림함':state.view==='surveys'?centerName(center)+' 업무 등록·조사':state.view==='incidents'?(state.incidentScope==='all'?'전체 센터 특이사항':centerName(center)+' 특이사항'):centerName(center)+' 업무';
 $('portal-description').textContent=hq?'내 업무와 센터 현황, 지원 요청을 함께 확인하세요.':'진행 중 업무는 날짜가 지나도 계속 표시됩니다.';
 document.querySelectorAll('nav button').forEach(el=>{const active=el.dataset.view===state.view&&(el.dataset.allCenters?state.incidentScope==='all':(!el.dataset.center||el.dataset.center===center)&&(state.view!=='incidents'||state.incidentScope!=='all'));el.setAttribute('aria-pressed',String(active));if(active){const group=el.closest('details');if(group)group.open=true;}});
 $('mine').disabled=state.view!=='center';$('completed').disabled=!['center','hq'].includes(state.view);$('center').disabled=['hq','notifications','access','briefing'].includes(state.view);
 const actions=$('quick-actions');actions.replaceChildren();
 if(state.view==='backups'){
  $('portal-title').textContent='운영 원본 보관';$('portal-description').textContent='월말 전체 원본과 OneDrive 저장 상태를 확인하세요.';
  $('center').disabled=true;renderBackups();return;
 }
 if(state.view==='search'){
  $('portal-title').textContent='통합 검색';$('portal-description').textContent='업무와 운영 마스터, 과거 특이사항을 유형별로 찾으세요.';
  $('center').disabled=true;renderSearch(state.context.centers);return;
 }
 if(state.view==='briefing'){renderBriefing(actions);return;}
 if(state.view==='center'&&canWrite(center)){
  const templates=currentTemplates(state.templates);
  for(const t of templates)button(t.title,()=>mutate('template:'+t.id+':'+koreaDate(),id=>api.fromTemplate({requestId:id,templateId:t.id,date:koreaDate(),recurring:(t.spec.repeat?.kind??'none')!=='none',ownerId:t.spec.owner_ids?.[0]??null}),row=>state.selected={type:'task',row}),actions,'primary');
  if(!templates.length)actions.append(node('p','승인된 업무 양식이 없습니다. 실제 업무를 조사해 배송팀 검토 후 업무 버튼으로 연결합니다.'));
  button('일회성 업무 등록',()=>taskCreate(),actions);
 }

 if(state.view==='surveys'&&canWrite(center))button('우리 센터 업무 등록',()=>surveyForm(),actions,'primary');
 const items=$('items');items.replaceChildren();let count=0;
 const handedOff=new Set(state.notifications.filter(n=>n.task_id).map(n=>n.task_id));
 const tasks=orderTasks(state.tasks,{userId:profile.id,handedOff});
 if(hq){
  items.append(node('h3','내 업무'));
  const own=tasks.filter(t=>t.owner_id===profile.id);own.forEach(t=>addRow(t,'task',items,centerName(t.center_code)));count+=own.length;
  if(!own.length)items.append(node('p','현재 맡은 미완료 업무가 없습니다.'));
  items.append(node('h3','센터 현황'));
  for(const c of state.context.centers){const pending=tasks.filter(t=>t.center_code===c.code&&!finished(t)),open=state.incidents.filter(i=>i.center_code===c.code&&i.status==='open');button(`${c.name} · 미완료 ${pending.length} · 미해결 ${open.length}`,()=>{$('center').value=c.code;state.view='center';state.selected=null;refresh();},items,'task-row');}
  items.append(node('h3','배송팀 지원 요청'));
  state.incidents.filter(i=>i.status==='open'&&['requested','supporting'].includes(i.support_state)).forEach(i=>{addRow(i,'incident',items,centerName(i.center_code));count++;});
 }else if(state.view==='center'){
  const visible=tasks.filter(t=>!$('mine').checked||t.owner_id===profile.id);count=visible.length;visible.forEach(t=>{addRow(t,'task',items,`${t.work_date} · ${t.owner_id===profile.id?'내 업무':'센터 업무'}`);const children=state.incidents.filter(i=>i.task_id===t.id);if(children.length){const group=node('div',undefined,'incident-children');children.forEach(i=>addRow(i,'incident',group,'↳ 특이사항 · '+stamp(i.created_at)));items.append(group);}});
 }else if(state.view==='incidents'){
  const linked=state.incidents.filter(i=>i.task_id);count=linked.length;renderIncidentGroups(linked,items);const legacy=state.incidents.filter(i=>!i.task_id);if(legacy.length){const archive=node('details');archive.append(node('summary','기존 업무 미연결 기록 · '+legacy.length+'건'));legacy.forEach(i=>addRow(i,'incident',archive,stamp(i.created_at)));items.append(archive);}
 }else if(state.view==='surveys'){count=state.surveys.length;state.surveys.forEach(s=>addRow(s,'survey',items,centerName(s.center_code)));}
 else if(state.view==='access'){
  count=state.staff.length;
  for(const person of state.staff)button(person.name+' · '+(person.role==='admin'?'배송팀 (모든 센터)':person.centers.map(centerName).join(', ')||'센터 미배정'),()=>membershipForm(person),items,'task-row');
 }
 else{
  count=state.notifications.length;
  for(const n of state.notifications)button(`${n.read_at?'':'● '}${n.title} · ${stamp(n.created_at)}`,()=>openNotification(n),items,'task-row');
 }
 if(!count&&!hq)items.append(node('p','표시할 항목이 없습니다.'));
 $('count').textContent=count+'건';$('list-title').textContent={center:'지금 할 일',hq:'업무와 지원 요청',incidents:'특이사항',surveys:'센터별 업무조사',notifications:'내 알림',access:'활성 직원'}[state.view];
 renderDetail();
}
function renderBriefing(actions){
 button('브리핑 생성·새로고침',async()=>{if(state.busy)return;setBusy(true);message('실제 운영 기록으로 브리핑을 만드는 중입니다…');try{const result=await portalAi.briefing(true);state.briefing=await portalAi.cachedBriefing();await loadData();render();message(result.pending?result.message:result.cached?'저장된 결과를 표시했습니다. 새 생성 요청은 1분 간격으로 처리합니다.':'브리핑을 생성했습니다.');}catch(error){message(error.message,true);}finally{setBusy(false);}},actions,'primary');
 const items=$('items'),panel=$('detail'),entry=state.briefing,body=entry?.body;items.replaceChildren();panel.replaceChildren();$('list-title').textContent='확인할 운영 기록';$('count').textContent='특이사항 '+state.incidents.filter(i=>i.task_id).length+'건 · AI 요약 '+(body?.items?.length??0)+'건';
 panel.append(node('h2','오늘의 운영 브리핑'),node('p','매일 오전 08:00에 생성합니다. 각 항목에서 실제 업무 기록을 확인하세요.'));
 if(entry?.last_error)panel.append(node('p',entry.last_error,'error'));
 if(entry?.dispatch_error)panel.append(node('p',entry.dispatch_error,'error'));
 if(entry?.status==='running')panel.append(node('p','새 브리핑을 생성 중입니다. 잠시 후 새로고침하세요.'));
 items.append(node('h3','센터 업무 특이사항 · 현재 상태'));renderIncidentGroups(state.incidents.filter(i=>i.task_id),items);panel.append(node('p','특이사항 처리중·처리완료는 현재 원본 기준입니다. 아래 AI 요약은 생성 시점 기준입니다.'));
 if(!body){items.append(node('p','오늘 저장된 AI 요약이 없습니다.'));return;}
 panel.append(node('p','기준일 '+body.date+' · 생성 '+stamp(entry.generated_at)));
 for(const [key,label] of Object.entries({pending_tasks:'미완료 업무',open_incidents:'생성 당시 처리중 특이사항',yesterday_events:'전일 처리 기록',master_changes:'전일 차량·기사·코스 변경'}))panel.append(node('p',label+' · '+(body.counts?.[key]??0)+'건'));
 if(body.limited)panel.append(node('p','주요 기록 일부를 요약했습니다. 전체 내용은 센터 업무와 처리 기록에서 확인하세요.'));
 for(const item of body.items??[]){const line=node('div',undefined,'history-entry');const current=item.kind==='incident'?state.incidents.find(i=>i.id===item.id):null;line.append(node('p',item.title+(current?' · '+incidentStatus(current):'')),node('small',(body.centers.find(center=>center.code===item.center)?.name??item.center??'센터 확인 필요')+' · '+(item.reason_label??'운영 기록')+(item.action?' · '+(actionLabels[item.action]??item.action):'')));
  if(item.kind==='task')button('업무 열기',()=>openTask(item.id),line);
  else if(item.kind==='incident')button('특이사항 열기',async()=>{const {data,error}=await supabase.from('operations_incidents').select('*').eq('id',item.id).single();if(error)message(error.message,true);else choose('incident',data);},line);
  else{const pages={drivers:'drivers.html',vehicles:'vehicles.html',routes:'route-edit.html'};const link=node('a','원본 운영정보 열기');link.href='/admin/'+pages[item.kind]+'?id='+encodeURIComponent(item.id)+(item.center?'&center='+encodeURIComponent(item.center):'');line.append(link);}
  items.append(line);
 }
 if(!body.items?.length)items.append(node('p','브리핑에 포함할 업무·특이사항·전일 변경 기록이 없습니다.'));
}
function membershipForm(person){
 const panel=$('detail');panel.replaceChildren(node('h2',person.name));
 if(person.role==='admin'){panel.append(node('p','배송팀은 모든 센터 업무를 처리할 수 있습니다.'));return;}
 panel.append(node('p','실제 소속 센터를 배정하세요. 다른 센터 자료는 조회할 수 있으며, 배정된 센터 업무만 수정할 수 있습니다.'));
 const form=node('div',undefined,'portal-form');
 for(const center of state.context.centers){const assigned=person.centers.includes(center.code);const line=node('div',undefined,'actions');line.append(node('span',center.name+' · '+(assigned?'배정됨':'미배정')));
  button(assigned?'배정 해제':'배정',()=>mutate(JSON.stringify(['membership',person.id,center.code,assigned]),requestId=>api.setMembership({requestId,userId:person.id,center:center.code,expected:assigned,enabled:!assigned})),line);form.append(line);
 }panel.append(form);
}
function renderDetail(){const panel=$('detail');panel.replaceChildren();const selected=state.selected;if(!selected){panel.append(node('p','목록에서 항목을 선택하세요.'));return;}const {row,type}=selected;panel.append(node('h2',row.title));if(type==='task')taskDetail(row,panel);else if(type==='incident')incidentDetail(row,panel);else surveyDetail(row,panel);attachments(type,row,panel);}
function attachments(kind,row,panel){
 const section=node('section',undefined,'attachments'),list=node('div'),form=node('form',undefined,'portal-form'),hint=node('p');
 section.append(node('h3','첨부 파일'),node('p','기존 OneDrive에 저장하며 원본과 일치하는지 확인합니다. 파일당 최대 10MB입니다.'),list);panel.append(section);
 if(isHq())button('OneDrive 연결 확인',async()=>{if(state.busy)return;setBusy(true);try{await operationsFiles.health();message('기존 OneDrive 인증과 저장소 접근이 정상입니다.');}catch(error){message(error.message,true);}finally{setBusy(false);}},section);
 let pending=null;
 const input=field(form,'파일 선택','file','','file');input.required=true;input.accept='.xlsx,.xls,.pdf,.docx,.doc,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp';
 input.onchange=()=>{if(pending?.expectedRow)pending.file=input.files[0];else pending=null;};
 form.append(hint,node('button','첨부 파일 저장','primary'));if(canWrite(row.center_code))section.append(form);
 async function load(){
  try{const files=await operationsFiles.list(kind,row.id);if(!section.isConnected)return;list.replaceChildren();
   if(!files.length)list.append(node('p','첨부된 파일이 없습니다.'));
   for(const file of files){const line=node('div',undefined,'history-entry');line.append(node('p',file.file_name),node('small',file.original_name+' · '+(file.byte_size/1024).toFixed(1)+'KB · '+stamp(file.created_at)));
    if(file.status==='saved')button('다운로드',async()=>{if(state.busy)return;setBusy(true);try{const blob=await operationsFiles.download(file.id),url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=file.file_name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);message('검증한 파일을 다운로드했습니다.');}catch(error){message(error.message,true);}finally{setBusy(false);}},line);
    else {line.append(node('p',file.status==='failed'?'저장 실패 · '+(file.last_error??'다시 시도해 주세요.'):'저장 확인 중'));
     if(file.uploaded_by===profile.id&&canWrite(row.center_code))button('같은 파일로 재시도',()=>{pending={requestId:file.request_id,file:null,expectedRow:file};input.value='';hint.textContent=file.original_name+' 원본을 다시 선택하세요. 같은 저장 요청을 이어서 처리합니다.';input.focus();},line);
    }list.append(line);
   }
  }catch(error){if(section.isConnected)list.replaceChildren(node('p',error.message,'error'));}
 }
 form.onsubmit=async event=>{
  event.preventDefault();if(state.busy)return;const file=input.files[0];if(!file)return;
  if(file.size<1||file.size>10*1024*1024){message('10MB 이하의 파일을 선택해 주세요.',true);return;}
  if(!pending||(!pending.expectedRow&&pending.file!==file))pending={file,requestId:crypto.randomUUID()};
  if(pending.expectedRow&&(file.name!==pending.expectedRow.original_name||file.size!==pending.expectedRow.byte_size)){message('재시도할 원본과 파일명·크기가 다릅니다.',true);return;}
  setBusy(true);message('OneDrive에 저장하고 파일 내용을 확인하는 중입니다…');
  try{await operationsFiles.upload({kind,subjectId:row.id,requestId:pending.requestId,file});pending=null;input.value='';hint.textContent='';await load();message('첨부 파일 저장과 내용 검증을 완료했습니다.');}
  catch(error){await load();message(error.message||'첨부를 저장하지 못했습니다. 선택한 파일을 유지했습니다.',true);}
  finally{setBusy(false);}
 };
 load();
}
function taskCreate(){
 const panel=$('detail');panel.replaceChildren(node('h2','일회성 업무 등록'));const form=node('form',undefined,'portal-form');const title=field(form,'업무명','title');title.required=true;title.maxLength=200;field(form,'업무일','date',koreaDate(),'date').required=true;field(form,'필요한 내용','note','','textarea');const submit=node('button','등록','primary');form.append(submit);panel.append(form);
 form.onsubmit=e=>{e.preventDefault();const data={center:$('center').value,title:title.value,date:form.elements.date.value,inputs:{work_note:form.elements.note.value}};mutate(JSON.stringify(['create',data]),id=>api.save({requestId:id,...data}),row=>state.selected={type:'task',row});};
}
const taskDrafts=new Map();
function taskDetail(task,panel,readOnly=false){
 const draft=taskDrafts.get(task.id);const values=!readOnly&&draft?.version===task.version?draft.inputs:task.inputs;
 const writable=!readOnly&&canWrite(task.center_code),form=node('form',undefined,'portal-form');panel.append(node('p',`${centerName(task.center_code)} · ${task.work_date} · ${statusLabels[task.status]}`));
 if(task.template_snapshot?.spec?.completion_condition)panel.append(node('p','완료 전 확인 · '+task.template_snapshot.spec.completion_condition));
 if(task.due_at)panel.append(node('p','배송 마감 · '+stamp(task.due_at)));
 if(task.cj_share_due_at)panel.append(node('p','CJ 공유 마감 · '+stamp(task.cj_share_due_at)));
 if(task.inputs?.cj_shared===true)panel.append(node('p','CJ 공유 완료 · '+stamp(task.inputs.cj_shared_at)),node('p',task.inputs.cj_share_note??''));
 const fields=task.template_snapshot?.spec?.fields??[];
 for(const f of fields){const el=field(form,f.label,'field_'+f.key,values?.[f.key],f.type==='boolean'?'checkbox':f.type==='number'?'number':'text');if(f.type==='number')el.step='any';}
 field(form,'업무 내용','work_note',values?.work_note??'','textarea');
 const steps=task.template_snapshot?.spec?.steps??[];
 for(const step of steps){const status=task.inputs?.steps?.[step.key];const wrap=node(status==='completed'||status==='not_applicable'?'details':'fieldset');wrap.append(node(wrap.tagName==='DETAILS'?'summary':'legend',step.label+' · '+(statusLabels[status]??'')));
  if(!finished(task)&&writable){button('처리 완료',()=>saveTask(task,form,task.status,{step:step.key,status:'completed'}),wrap);button('해당 없음',()=>saveTask(task,form,task.status,{step:step.key,status:'not_applicable'}),wrap);}form.append(wrap);
 }
 if(!finished(task)&&writable){const actions=node('div',undefined,'actions');button('저장',()=>saveTask(task,form,'in_progress'),actions);button('업무 완료',()=>saveTask(task,form,'completed'),actions,'primary');button('해당 없음',()=>saveTask(task,form,'not_applicable'),actions);form.append(actions);}
 else form.querySelectorAll('input,textarea').forEach(el=>el.disabled=true);
 panel.append(form);form.onsubmit=e=>{e.preventDefault();if(writable&&!finished(task))saveTask(task,form,'in_progress');};
 if(writable){const actions=node('div',undefined,'quick-actions');if(finished(task))button('업무 다시 열기',()=>mutate('reopen:'+task.id+':'+task.version,id=>api.reopen({requestId:id,task})),actions);else{
  button('다른 직원에게 인계',()=>handoff(task,panel),actions);button('마감시간',()=>deadlines(task,panel),actions);
  button(task.inputs?.cj_shared===true?'CJ 공유 기록 정정':'CJ 공유 완료 기록',()=>cjShare(task,panel),actions);
  button('특이사항 발생',()=>{taskDrafts.set(task.id,{version:task.version,inputs:collectInputs(task,form)});incidentCreate(null,task);},actions,'primary');
 }panel.append(actions);}
 const children=state.incidents.filter(i=>i.task_id===task.id);if(children.length){panel.append(node('h3','이 업무의 특이사항'));children.forEach(i=>addRow(i,'incident',panel,stamp(i.created_at)));}
 history(task,panel,'task');
}
function saveTask(task,form,status,step){
 try{const inputs=collectInputs(task,form);if(step){inputs.steps={...inputs.steps,[step.step]:step.status};}const data={task,center:task.center_code,title:task.title,date:task.work_date,inputs,status};mutate(JSON.stringify(['save',data]),id=>api.save({requestId:id,...data}),()=>taskDrafts.delete(task.id));}catch(error){message(error.message,true);}
}
async function handoff(task,panel){
 if(state.busy)return;setBusy(true);
 try{const people=await api.people(task.center_code);const form=node('form',undefined,'portal-form');const label=node('label','다음 담당자'),select=node('select');select.name='owner';select.required=true;for(const p of people.filter(p=>p.id!==task.owner_id)){const option=node('option',p.name);option.value=p.id;select.append(option);}label.append(select);form.append(label);field(form,'인계 메모 (선택)','memo','','textarea');const submit=node('button','인계');submit.disabled=!select.options.length;form.append(submit);panel.append(form);
 form.onsubmit=e=>{e.preventDefault();const data={owner_id:select.value,memo:form.elements.memo.value};mutate(JSON.stringify(['handoff',task.id,task.version,data]),id=>api.taskAction({requestId:id,task,action:'handoff',data}));};
 }catch(error){message(error.message,true);}finally{setBusy(false);}
}
function cjShare(task,panel){
 const shared=task.inputs?.cj_shared!==true,form=node('form',undefined,'portal-form');
 form.append(node('p',shared?'CJ에 실제로 전달한 배차정보의 전달 방법과 내용을 기록하세요.':'기존 공유 완료 기록을 취소할 사유를 입력하세요.'));
 field(form,shared?'실제 공유 내용':'정정 사유','note','','textarea').required=true;
 form.append(node('button',shared?'공유 완료 기록 저장':'공유 기록 취소','primary'));panel.append(form);
 form.onsubmit=e=>{e.preventDefault();const note=form.elements.note.value.trim();mutate(JSON.stringify(['cj-share',task.id,task.version,shared,note]),id=>api.recordCjShare({requestId:id,task,shared,note}));};
}
function localTime(value){if(!value)return '';const date=new Date(new Date(value).valueOf()+9*3600000);return date.toISOString().slice(0,16);}
function deadlines(task,panel){
 const form=node('form',undefined,'portal-form');field(form,'배송 마감 (한국시간)','due',localTime(task.due_at),'datetime-local');field(form,'CJ 배차정보 공유 마감 (한국시간)','cj',localTime(task.cj_share_due_at),'datetime-local');field(form,'기존 마감 변경 사유','reason');form.append(node('button','마감시간 저장'));panel.append(form);
 form.onsubmit=e=>{e.preventDefault();const value=name=>form.elements[name].value?new Date(form.elements[name].value+':00+09:00').toISOString():null;const data={due_at:value('due'),cj_share_due_at:value('cj'),reason:form.elements.reason.value};mutate(JSON.stringify(['deadline',task.id,task.version,data]),id=>api.taskAction({requestId:id,task,action:'deadline',data}));};
}
function incidentStatus(row){return row.status==='resolved'?'처리완료':'처리중';}
function parentTitle(id){return state.parents.find(t=>t.id===id)?.title??state.tasks.find(t=>t.id===id)?.title??'상위 업무 확인';}
function addIncidentRow(row,parent){
 const line=node('div',undefined,'incident-record');addRow(row,'incident',line,row.kind+' · 발생 '+stamp(row.created_at)+(row.resolved_at?' · 처리완료 '+stamp(row.resolved_at):''));
 if(row.task_id)button('↳ 상위 업무 · '+parentTitle(row.task_id),()=>openParentTask(row.task_id),line,'parent-mention');parent.append(line);
}
function renderIncidentGroups(rows,parent){
 for(const status of ['open','resolved']){const group=rows.filter(i=>i.status===status);parent.append(node('h3',(status==='open'?'처리중':'처리완료')+' · '+group.length+'건'));group.forEach(i=>addIncidentRow(i,parent));}
}
function incidentCreate(kind,task){
 if(!task){message('하던 업무의 특이사항 발생 버튼으로 등록해 주세요.',true);return;}
 const panel=$('detail');panel.replaceChildren(node('h2','특이사항 발생'),node('p','상위 업무 · '+task.title));const form=node('form',undefined,'portal-form');const label=node('label','유형'),select=node('select');select.name='kind';for(const item of incidentKinds){const option=node('option',item);option.value=item;select.append(option);}label.append(select);form.append(label);
 field(form,'제목','title',kind??'').required=true;field(form,'발생 내용','note','','textarea').required=true;form.append(node('button','처리중으로 등록','primary'));panel.append(form);
 form.onsubmit=e=>{e.preventDefault();const data={center_code:task.center_code,task_id:task.id,title:form.elements.title.value,kind:select.value,inputs:{발생내용:form.elements.note.value}};mutate(JSON.stringify(['incident',data]),id=>api.incidentAction({requestId:id,action:'create',data}),row=>{state.view='incidents';state.incidentScope='center';$('center').value=task.center_code;state.selected={type:'incident',row};});};
}
function incidentDetail(row,panel){
 panel.append(node('p',centerName(row.center_code)+' · '+row.kind+' · '+incidentStatus(row)),node('p','발생 '+stamp(row.created_at)+(row.resolved_at?' · 처리완료 '+stamp(row.resolved_at):'')));
 if(row.task_id)button('상위 업무 · '+parentTitle(row.task_id),()=>openParentTask(row.task_id),panel,'parent-mention');
 const writable=canWrite(row.center_code);
 if(row.status==='open'&&writable){const form=node('form',undefined,'portal-form');field(form,'특이사항 제목','title',row.title).required=true;field(form,'발생 내용','note',row.inputs?.발생내용??'','textarea').required=true;field(form,'처리 내용','progress',row.inputs?.처리내용??'','textarea');const actions=node('div',undefined,'actions');const inputs=()=>({...row.inputs,발생내용:form.elements.note.value,처리내용:form.elements.progress.value});button('내용 저장',()=>{if(form.reportValidity())incidentAction(row,'edit',{title:form.elements.title.value,inputs:inputs()});},actions);button('처리완료',()=>{if(!form.reportValidity())return;const data={title:form.elements.title.value,inputs:inputs()};incidentAction(row,'resolve',{...data,note:form.elements.progress.value});},actions,'primary');form.append(actions);form.onsubmit=e=>e.preventDefault();panel.append(form);
 }else{panel.append(node('h3','발생 내용'),node('p',row.inputs?.발생내용??''),node('h3','처리 내용'),node('p',row.inputs?.처리내용??'처리 내용 기록 없음'));if(row.status==='resolved')button('다시 처리중으로 열기',()=>incidentAction(row,'reopen'),panel);else{const form=node('form',undefined,'portal-form');field(form,'처리 내용','note',row.inputs?.처리내용??'','textarea');form.append(node('button','처리완료','primary'));form.onsubmit=e=>{e.preventDefault();incidentAction(row,'resolve',{note:form.elements.note.value});};panel.append(form);}}
 if(writable&&row.status==='open')button('배송팀 지원 요청',()=>incidentAction(row,'request_support'),panel);
 if(isHq()&&row.status==='open'){const form=node('form',undefined,'portal-form');field(form,'배송팀 조치 내용','note','','textarea').required=true;form.append(node('button','조치 기록'));form.onsubmit=e=>{e.preventDefault();incidentAction(row,'support',{note:form.elements.note.value.trim(),done:false});};panel.append(form);}
 history(row,panel,'incident');
}
function incidentAction(incident,action,data={}){return mutate(JSON.stringify([incident.id,incident.version,action,data]),id=>api.incidentAction({requestId:id,incident,action,data}));}
async function history(row,panel,type){
 const details=node('details',undefined,'history');details.append(node('summary','처리 기록'));panel.append(details);
 try{const events=await api.events(type==='task'?{taskId:row.id}:{incidentId:row.id});if(!details.isConnected)return;for(const event of events){const entry=node('div',undefined,'history-entry');entry.append(node('small',stamp(event.occurred_at)+' · '+(actionLabels[event.action]??(event.action==='task_reopened'?'업무 재개':event.action))));const data=event.request_body?.data;if(data?.note)entry.append(node('p',data.note));if(data?.memo)entry.append(node('p',data.memo));if(data?.reason)entry.append(node('p',data.reason));details.append(entry);}}
 catch{details.append(node('p','처리 기록을 불러오지 못했습니다.'));}
}
function surveyForm(survey=null){
 const panel=$('detail');panel.replaceChildren(node('h2',survey?'업무조사 수정':'우리 센터 업무 등록'));const form=node('form',undefined,'portal-form');field(form,'업무명','title',survey?.title).required=true;
 for(const [key,label] of surveyFields)field(form,label,key,survey?.details?.[key]??'',key==='sequence'||key==='problems'?'textarea':'text');form.append(node('button','조사 내용 저장','primary'));panel.append(form);
 form.onsubmit=e=>{e.preventDefault();const data={center_code:survey?.center_code??$('center').value,title:form.elements.title.value,details:Object.fromEntries(surveyFields.map(([key])=>[key,form.elements[key].value]))};mutate(JSON.stringify(['survey',survey?.id,survey?.version,data]),id=>api.surveyAction({requestId:id,survey,action:survey?'edit':'submit',data}),row=>state.selected={type:'survey',row});};
}
function surveyDetail(row,panel){
 panel.append(node('p',centerName(row.center_code)+' · '+surveyStages[row.stage]));const dl=node('dl');for(const [key,label] of surveyFields)if(row.details[key])dl.append(node('dt',label),node('dd',row.details[key]));panel.append(dl);
 if(canWrite(row.center_code)&&!row.template_id)button('조사 수정',()=>surveyForm(row),panel);
 if(isHq()){
  button('AI 양식 초안 생성',()=>surveyDraft(row,panel),panel);
  const stages=Object.keys(surveyStages),next=stages[stages.indexOf(row.stage)+1];if(next)button(surveyStages[next]+' 기록',()=>surveyAction(row,'stage',{stage:next}),panel);
  if(row.stage==='designed'&&!row.template_id)templateForm(row,panel);
 }
 if(row.template_id)panel.append(node('p','승인 양식이 연결되었습니다. 구축·운영 검증 단계는 실제 확인 후 기록하세요.'));
}
async function surveyDraft(survey,panel){
 if(state.busy)return;setBusy(true);message('조사 원문으로 배송팀 검토 초안을 만드는 중입니다…');
 try{const draft=await portalAi.draft(survey.id);if(draft.pending){message(draft.message);return;}if(!panel.isConnected)return;
  panel.querySelector('[data-ai-draft]')?.remove();const section=node('section');section.dataset.aiDraft='true';section.append(node('h3','AI 검토 초안'),node('p','조사 원문 근거를 확인하고 수정한 뒤 승인하세요.'));
  if(!draft.fresh||draft.survey_version!==survey.version)section.append(node('p','이전 조사 버전의 초안입니다. 수정된 조사 내용을 먼저 확인하세요.','warning'));
  for(const [key,label] of [['steps','체크리스트'],['fields','입력 항목'],['automation','개선 제안']]){section.append(node('h4',label));for(const item of draft[key])section.append(node('p',item.label??item.text),node('small','근거 · '+item.evidence));}
  for(const [key,label] of [['completion','완료 조건 제안'],['repeat','반복 규칙 제안']])if(draft[key])section.append(node('h4',label),node('p',draft[key].text),node('small','근거 · '+draft[key].evidence));
  if(draft.questions.length){section.append(node('h4','추가 확인할 내용'));draft.questions.forEach(question=>section.append(node('p',question)));}
  if(survey.stage==='designed'&&!survey.template_id&&draft.survey_version===survey.version)button('초안을 배송팀 검토 양식에 옮기기',()=>templateForm(survey,panel,draft),section);
  panel.append(section);message('AI 검토 초안을 표시했습니다. 업무 양식은 아직 변경하지 않았습니다.');
 }catch(error){message(error.message,true);}finally{setBusy(false);}
}
async function templateForm(survey,panel,draft=null){
 panel.querySelector('[data-template-review]')?.remove();
 const form=node('form',undefined,'portal-form');form.append(node('h3','배송팀 양식 검토'));
 form.dataset.templateReview='true';
 field(form,'처리 단계 (한 줄에 하나)','steps',draft?draft.steps.map(item=>item.label).join('\n'):survey.details.sequence??'','textarea');
 field(form,'필요한 입력 항목 (한 줄에 하나)','fields',draft?draft.fields.map(item=>item.label).join('\n'):'','textarea');
 field(form,'완료 조건 (직접 확인)','completion_condition',draft?.completion?.text??survey.details.completion??'','textarea');
 field(form,'모든 입력 항목을 완료 시 필수로 지정','required',false,'checkbox');
 const label=node('label','반복 주기'),repeat=node('select');repeat.name='repeat';
 for(const [value,text] of Object.entries({none:'필요할 때 등록',daily:'매일',weekdays:'지정 요일',monthly:'매월',once:'지정 날짜 1회'})){const option=node('option',text);option.value=value;repeat.append(option);}label.append(repeat);form.append(label);
 const weekdays=node('fieldset');weekdays.append(node('legend','반복 요일'));for(const [index,name] of ['월','화','수','목','금','토','일'].entries())field(weekdays,name,'day_'+(index+1),false,'checkbox');form.append(weekdays);weekdays.hidden=true;
 const month=field(form,'매월 날짜','month_day','','number');month.min=1;month.max=31;month.parentElement.hidden=true;
 const once=field(form,'실행 날짜','once_date',koreaDate(),'date');once.parentElement.hidden=true;
 const ownerLabel=node('label','반복 업무 담당자'),owner=node('select');owner.name='owner';ownerLabel.append(owner);form.append(ownerLabel);ownerLabel.hidden=true;
 repeat.onchange=()=>{weekdays.hidden=repeat.value!=='weekdays';month.parentElement.hidden=repeat.value!=='monthly';once.parentElement.hidden=repeat.value!=='once';ownerLabel.hidden=repeat.value==='none';owner.required=repeat.value!=='none';};
 field(form,'배송 마감 (한국시간, 선택)','due_time','','time');field(form,'CJ 공유 마감 (한국시간, 선택)','cj_share_time','','time');
 field(form,'적용 시작일','effective_from',koreaDate(),'date').required=true;
 form.append(node('p','조사 내용을 확인한 뒤 승인하세요. 양식 승인은 구축 완료 기록과 별개입니다.'),node('button','정식 업무 양식 승인','primary'));
 form.onsubmit=e=>{e.preventDefault();const lines=name=>form.elements[name].value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
  const rule={kind:repeat.value};if(rule.kind==='weekdays')rule.days=[1,2,3,4,5,6,7].filter(day=>form.elements['day_'+day].checked);if(rule.kind==='monthly')rule.day=Number(month.value);if(rule.kind==='once')rule.date=once.value;
  const spec={effective_from:form.elements.effective_from.value,fields:lines('fields').map((label,index)=>({key:'field_'+index,label,type:'string',required_on_complete:form.elements.required.checked})),steps:lines('steps').map((label,index)=>({key:'step_'+index,label})),repeat:rule};
  if(form.elements.completion_condition.value.trim())spec.completion_condition=form.elements.completion_condition.value.trim();
  if(rule.kind!=='none')spec.owner_ids=[owner.value];for(const key of ['due_time','cj_share_time'])if(form.elements[key].value)spec[key]=form.elements[key].value;
  surveyAction(survey,'template',{spec});};panel.append(form);
 try{for(const person of await api.people(survey.center_code)){const option=node('option',person.name);option.value=person.id;owner.append(option);}}catch(error){message(error.message,true);}
}
function surveyAction(survey,action,data){return mutate(JSON.stringify(['survey',survey.id,survey.version,action,data]),id=>api.surveyAction({requestId:id,survey,action,data}));}
let parentRequest=0;
async function openParentTask(id){
 const dialog=$('parent-task-dialog'),request=++parentRequest;dialog.replaceChildren();const header=node('div',undefined,'parent-dialog-heading');header.append(node('strong','상위 업무'));const close=button('닫기',()=>dialog.close(),header);close.dataset.navigationToggle='';dialog.append(header,node('p','원래 업무를 불러오는 중입니다…'));if(!dialog.open)dialog.showModal();
 const {data,error}=await supabase.from('operations_tasks').select('*').eq('id',id).single();if(!dialog.open||request!==parentRequest)return;
 dialog.replaceChildren(header);if(error){dialog.append(node('p','상위 업무를 불러오지 못했습니다. 다시 시도해 주세요.','error'));return;}dialog.append(node('h2',data.title));taskDetail(data,dialog,true);
}
async function openTask(id){const {data,error}=await supabase.from('operations_tasks').select('*').eq('id',id).single();if(error){message(error.message,true);return;}choose('task',data);}
async function openNotification(n){try{await api.readNotification(n.id);if(n.reason_key?.startsWith('backup:')){state.view='backups';state.selected=null;await refresh();}else if(n.task_id)await openTask(n.task_id);else if(n.incident_id){const {data,error}=await supabase.from('operations_incidents').select('*').eq('id',n.incident_id).single();if(error)throw error;choose('incident',data);}n.read_at=new Date().toISOString();$('unread').textContent=state.notifications.filter(n=>!n.read_at).length||'';}catch(error){message(error.message,true);}}
let notificationTimer,checkingNotifications=false;
async function checkNotifications(){
 if(state.busy||checkingNotifications||document.visibilityState==='hidden')return;
 checkingNotifications=true;
 try{
  const unread=await api.unreadCount();
  if(state.busy)return;
  $('unread').textContent=unread||'';
 }catch{/* Keep existing messages and editing inputs during temporary network failures. */}
 finally{checkingNotifications=false;}
}
function buildCenterNavigation(){
 const order=['안산','평택','김해','양산'];
 const centers=[...state.context.centers].sort((a,b)=>{const rank=c=>{const i=order.findIndex(name=>c.name.includes(name));return i<0?99:i;};return rank(a)-rank(b);});
 document.querySelectorAll('[data-center-view]').forEach(nav=>{nav.replaceChildren();if(nav.dataset.centerView==='incidents'){const all=node('button','전체 센터');all.type='button';all.dataset.view='incidents';all.dataset.allCenters='true';nav.append(all);}for(const center of centers){const el=node('button',center.name.replace(/센터$/,'').trim());el.type='button';el.dataset.view=nav.dataset.centerView;el.dataset.center=center.code;nav.append(el);}if(!centers.length)nav.append(node('p','접근 가능한 센터가 없습니다.'));});
}
async function start(){
 setupPortalSidebar();
 $('user').textContent=profile.display_name??profile.email??'';
 try{state.context=await api.context();for(const center of state.context.centers){const option=node('option',center.name);option.value=center.code;$('center').append(option);}const requested=new URLSearchParams(location.search).get('center');$('center').value=state.context.centers.some(c=>c.code===requested)?requested:state.context.writable_centers[0]??state.context.centers[0]?.code;
 document.querySelector('[data-view=hq]').hidden=!isHq();document.querySelector('[data-view=access]').hidden=!isHq();document.querySelector('[data-view=briefing]').hidden=!isHq();if(isHq()&&!requested)state.view='hq';
 document.querySelector('[data-view=backups]').hidden=!isHq();
 $('hq-navigation').hidden=!isHq();$('audit-navigation').hidden=!isHq();
 buildCenterNavigation();
 $('center').onchange=()=>{const url=new URL(location.href);url.searchParams.set('center',$('center').value);historyReplace(url);state.selected=null;refresh();};
 $('refresh').onclick=refresh;$('mine').onchange=render;$('completed').onchange=refresh;
 document.querySelectorAll('nav button').forEach(el=>el.onclick=()=>{if(state.busy)return;state.view=el.dataset.view;state.incidentScope=el.dataset.allCenters?'all':'center';if(el.dataset.center){$('center').value=el.dataset.center;const url=new URL(location.href);url.searchParams.set('center',el.dataset.center);historyReplace(url);}state.selected=null;refresh();});await refresh();
 notificationTimer=setInterval(checkNotifications,30000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkNotifications();});
 addEventListener('pagehide',()=>clearInterval(notificationTimer),{once:true});
 addEventListener('pageshow',event=>{if(event.persisted){clearInterval(notificationTimer);notificationTimer=setInterval(checkNotifications,30000);checkNotifications();}});
 }catch(error){message(['PGRST202','42P01'].includes(error.code)?'업무 포털 서버 구성이 아직 적용되지 않았습니다. 관리자에게 서버 반영을 요청해 주세요.':error.message,true);setBusy(true);}
}
function historyReplace(url){globalThis.history.replaceState(null,'',url.pathname+url.search);}
if(profile)await start();
