import {requireAuth} from './auth.js';
import {supabase} from './supabase.js';
import {createOperationsApi} from './operations-api.js';
import {koreaDate,statusLabels,actionLabels} from './operations-view.js';
import {finished,dispatchWarning,orderTasks,currentTemplates,collectInputs,surveyFields,surveyStages} from './portal-model.js';
const $=id=>document.getElementById(id),api=createOperationsApi(supabase),profile=await requireAuth();
const state={view:'center',context:null,tasks:[],incidents:[],templates:[],surveys:[],notifications:[],selected:null,busy:false,retry:null};
const incidentKinds=['차량 대차','차량 섭외 지연','납품처 문제','기사 문제','차량 문제','기타 특이사항'];
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function centerName(code){return state.context.centers.find(c=>c.code===code)?.name??code;}
function canWrite(code){return state.context.writable_centers.includes(code);}
function isHq(){return profile.role==='admin';}
function stamp(value){return value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'';}
function button(text,handler,parent,className){const el=node('button',text,className);el.type='button';el.onclick=handler;parent.append(el);return el;}
function field(form,label,name,value='',type='text'){const wrap=node('label',label),el=node(type==='textarea'?'textarea':'input');if(type!=='textarea')el.type=type;el.name=name;if(type==='checkbox')el.checked=value===true;else el.value=value??'';wrap.append(el);form.append(wrap);return el;}
function setBusy(value){state.busy=value;document.querySelectorAll('button,input,select,textarea').forEach(el=>{if(value){el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}else if(el.dataset.wasDisabled!==undefined){el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}});}
async function mutate(key,operation,success){
 if(state.busy)return;
 if(state.retry?.key!==key)state.retry={key,requestId:crypto.randomUUID()};
 setBusy(true);message('저장하는 중입니다…');
 try{const result=await operation(state.retry.requestId);state.retry=null;if(success)success(result);await loadData();render();message('저장했습니다.');}
 catch(error){message(error.message||'저장하지 못했습니다. 입력을 유지했습니다. 다시 시도해 주세요.',true);}
 finally{setBusy(false);}
}
async function loadData(){
 const center=$('center').value,day=koreaDate();
 const [tasks,incidents,templates,surveys,notifications,staff]=await Promise.all([
 api.tasks({center:state.view==='hq'?undefined:center,from:day,through:day,includeCompleted:$('completed').checked}),
 api.incidents({center:state.view==='hq'?undefined:center,includeResolved:true}),api.templates(center),api.surveys(state.view==='hq'?undefined:center),api.notifications(),state.view==='access'?api.staffAccess():[]]);
 Object.assign(state,{tasks,incidents,templates,surveys,notifications,staff});
 $('unread').textContent=notifications.filter(n=>!n.read_at).length||'';
 if(state.selected){const collection=state.selected.type==='task'?tasks:state.selected.type==='incident'?incidents:surveys;const row=collection.find(r=>r.id===state.selected.row.id);state.selected=row?{...state.selected,row}:null;}
}
async function refresh(){if(state.busy)return;setBusy(true);message('업무를 불러오는 중입니다…');try{await loadData();render();message('');}catch(error){message(error.message||'업무를 불러오지 못했습니다.',true);}finally{setBusy(false);}}
function choose(type,row){state.selected={type,row};renderDetail();}
function addRow(row,type,parent,extra=''){
 const el=button(row.title,()=>choose(type,row),parent,'task-row');el.replaceChildren();const content=node('span',row.title);content.append(node('small',extra));
 if(type==='task'){const warning=dispatchWarning(row);if(warning)content.append(node('small',warning,'warning'));}
 el.append(content,node('span',type==='survey'?surveyStages[row.stage]:statusLabels[row.status],'badge'));if(state.selected?.row.id===row.id)el.classList.add('selected');
}
function render(){
 const hq=state.view==='hq',center=$('center').value;
 $('portal-title').textContent=hq?'HQ 업무':state.view==='access'?'센터 담당자 배정':state.view==='notifications'?'알림함':state.view==='surveys'?'우리 센터 업무 등록':centerName(center)+' 업무';
 $('portal-description').textContent=hq?'내 업무와 센터 현황, 지원 요청을 함께 확인하세요.':'진행 중 업무는 날짜가 지나도 계속 표시됩니다.';
 document.querySelectorAll('nav button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.view===state.view)));
 $('mine').disabled=state.view!=='center';$('completed').disabled=!['center','hq'].includes(state.view);$('center').disabled=['hq','notifications','access'].includes(state.view);
 const actions=$('quick-actions');actions.replaceChildren();
 if(state.view==='center'&&canWrite(center)){
  const templates=currentTemplates(state.templates);
  for(const t of templates)button(t.title,()=>mutate('template:'+t.id+':'+koreaDate(),id=>api.fromTemplate({requestId:id,templateId:t.id,date:koreaDate(),recurring:(t.spec.repeat?.kind??'none')!=='none',ownerId:t.spec.owner_ids?.[0]??null}),row=>state.selected={type:'task',row}),actions,'primary');
  if(!templates.length)actions.append(node('p','승인된 업무 양식이 없습니다. 실제 업무를 조사해 HQ 검토 후 업무 버튼으로 연결합니다.'));
  button('일회성 업무 등록',()=>taskCreate(),actions);
 }
 if(['center','incidents'].includes(state.view)&&canWrite(center))for(const kind of incidentKinds)button(kind,()=>incidentCreate(kind),actions);
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
  items.append(node('h3','HQ 지원 요청'));
  state.incidents.filter(i=>i.status==='open'&&['requested','supporting'].includes(i.support_state)).forEach(i=>{addRow(i,'incident',items,centerName(i.center_code));count++;});
 }else if(state.view==='center'){
  const visible=tasks.filter(t=>!$('mine').checked||t.owner_id===profile.id);count=visible.length;visible.forEach(t=>addRow(t,'task',items,`${t.work_date} · ${t.owner_id===profile.id?'내 업무':'센터 업무'}`));
 }else if(state.view==='incidents'){
  const incidents=[...state.incidents].sort((a,b)=>(a.status==='resolved')-(b.status==='resolved'));count=incidents.length;incidents.forEach(i=>addRow(i,'incident',items,`${i.kind} · ${{none:'지원 요청 없음',requested:'HQ 지원 요청',supporting:'HQ 지원 중',done:'HQ 지원 완료'}[i.support_state]}`));
 }else if(state.view==='surveys'){count=state.surveys.length;state.surveys.forEach(s=>addRow(s,'survey',items,centerName(s.center_code)));}
 else if(state.view==='access'){
  count=state.staff.length;
  for(const person of state.staff)button(person.name+' · '+(person.role==='admin'?'HQ (모든 센터)':person.centers.map(centerName).join(', ')||'센터 미배정'),()=>membershipForm(person),items,'task-row');
 }
 else{
  count=state.notifications.length;
  for(const n of state.notifications)button(`${n.read_at?'':'● '}${n.title} · ${stamp(n.created_at)}`,()=>openNotification(n),items,'task-row');
 }
 if(!count&&!hq)items.append(node('p','표시할 항목이 없습니다.'));
 $('count').textContent=count+'건';$('list-title').textContent={center:'지금 할 일',hq:'업무와 지원 요청',incidents:'특이사항',surveys:'센터별 업무조사',notifications:'내 알림',access:'활성 직원'}[state.view];
 renderDetail();
}
function membershipForm(person){
 const panel=$('detail');panel.replaceChildren(node('h2',person.name));
 if(person.role==='admin'){panel.append(node('p','HQ는 모든 센터 업무를 처리할 수 있습니다.'));return;}
 panel.append(node('p','실제 소속 센터를 배정하세요. 다른 센터 자료는 조회할 수 있으며, 배정된 센터 업무만 수정할 수 있습니다.'));
 const form=node('div',undefined,'portal-form');
 for(const center of state.context.centers){const assigned=person.centers.includes(center.code);const line=node('div',undefined,'actions');line.append(node('span',center.name+' · '+(assigned?'배정됨':'미배정')));
  button(assigned?'배정 해제':'배정',()=>mutate(JSON.stringify(['membership',person.id,center.code,assigned]),requestId=>api.setMembership({requestId,userId:person.id,center:center.code,expected:assigned,enabled:!assigned})),line);form.append(line);
 }panel.append(form);
}
function renderDetail(){const panel=$('detail');panel.replaceChildren();const selected=state.selected;if(!selected){panel.append(node('p','목록에서 항목을 선택하세요.'));return;}const {row,type}=selected;panel.append(node('h2',row.title));if(type==='task')taskDetail(row,panel);else if(type==='incident')incidentDetail(row,panel);else surveyDetail(row,panel);}
function taskCreate(){
 const panel=$('detail');panel.replaceChildren(node('h2','일회성 업무 등록'));const form=node('form',undefined,'portal-form');const title=field(form,'업무명','title');title.required=true;title.maxLength=200;field(form,'업무일','date',koreaDate(),'date').required=true;field(form,'필요한 내용','note','','textarea');const submit=node('button','등록','primary');form.append(submit);panel.append(form);
 form.onsubmit=e=>{e.preventDefault();const data={center:$('center').value,title:title.value,date:form.elements.date.value,inputs:{work_note:form.elements.note.value}};mutate(JSON.stringify(['create',data]),id=>api.save({requestId:id,...data}),row=>state.selected={type:'task',row});};
}
function taskDetail(task,panel){
 const writable=canWrite(task.center_code),form=node('form',undefined,'portal-form');panel.append(node('p',`${centerName(task.center_code)} · ${task.work_date} · ${statusLabels[task.status]}`));
 const fields=task.template_snapshot?.spec?.fields??[];
 for(const f of fields){const el=field(form,f.label,'field_'+f.key,task.inputs?.[f.key],f.type==='boolean'?'checkbox':f.type==='number'?'number':'text');if(f.type==='number')el.step='any';}
 field(form,'업무 내용','work_note',task.inputs?.work_note??'','textarea');
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
  for(const kind of incidentKinds)button(kind,()=>incidentCreate(kind,task),actions);
 }panel.append(actions);}
 history(task,panel,'task');
}
function saveTask(task,form,status,step){
 try{const inputs=collectInputs(task,form);if(step){inputs.steps={...inputs.steps,[step.step]:step.status};}const data={task,center:task.center_code,title:task.title,date:task.work_date,inputs,status};mutate(JSON.stringify(['save',data]),id=>api.save({requestId:id,...data}));}catch(error){message(error.message,true);}
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
function incidentCreate(kind,task=null){
 const existing=task&&state.incidents.find(i=>i.task_id===task.id&&i.kind===kind&&i.status==='open');if(existing){choose('incident',existing);message('진행 중인 동일 유형의 특이사항을 열었습니다.');return;}
 const panel=$('detail');panel.replaceChildren(node('h2',kind+' 등록'));const form=node('form',undefined,'portal-form');field(form,'제목','title',kind).required=true;field(form,'발생 내용','note','','textarea').required=true;form.append(node('button','등록','primary'));panel.append(form);
 form.onsubmit=e=>{e.preventDefault();const data={center_code:task?.center_code??$('center').value,task_id:task?.id??null,title:form.elements.title.value,kind,inputs:{발생내용:form.elements.note.value}};mutate(JSON.stringify(['incident',data]),id=>api.incidentAction({requestId:id,action:'create',data}),row=>state.selected={type:'incident',row});};
}
function incidentDetail(row,panel){
 panel.append(node('p',`${centerName(row.center_code)} · ${row.kind} · ${statusLabels[row.status]}`),node('p',row.inputs?.발생내용??''));
 if(row.task_id)button('관련 업무 열기',()=>openTask(row.task_id),panel);
 const actions=node('div',undefined,'quick-actions');button(row.status==='open'?'해결 처리':'다시 열기',()=>incidentAction(row,row.status==='open'?'resolve':'reopen'),actions);
 if(canWrite(row.center_code)&&row.status==='open')button('HQ 지원 요청',()=>incidentAction(row,'request_support'),actions);panel.append(actions);
 if(isHq()&&row.status==='open'){const form=node('form',undefined,'portal-form');field(form,'실제로 수행한 HQ 조치','note','','textarea').required=true;field(form,'HQ 지원 완료','done',false,'checkbox');form.append(node('button','조치 기록','primary'));form.onsubmit=e=>{e.preventDefault();incidentAction(row,'support',{note:form.elements.note.value.trim(),done:form.elements.done.checked});};panel.append(form,node('p','HQ 지원 완료와 사건 해결은 별도로 기록됩니다.'));}
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
  const stages=Object.keys(surveyStages),next=stages[stages.indexOf(row.stage)+1];if(next)button(surveyStages[next]+' 기록',()=>surveyAction(row,'stage',{stage:next}),panel);
  if(row.stage==='designed'&&!row.template_id)templateForm(row,panel);
 }
 if(row.template_id)panel.append(node('p','승인 양식이 연결되었습니다. 구축·운영 검증 단계는 실제 확인 후 기록하세요.'));
}
async function templateForm(survey,panel){
 const form=node('form',undefined,'portal-form');form.append(node('h3','HQ 양식 검토'));
 field(form,'처리 단계 (한 줄에 하나)','steps',survey.details.sequence??'','textarea');
 field(form,'필요한 입력 항목 (한 줄에 하나)','fields','','textarea');
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
  if(rule.kind!=='none')spec.owner_ids=[owner.value];for(const key of ['due_time','cj_share_time'])if(form.elements[key].value)spec[key]=form.elements[key].value;
  surveyAction(survey,'template',{spec});};panel.append(form);
 try{for(const person of await api.people(survey.center_code)){const option=node('option',person.name);option.value=person.id;owner.append(option);}}catch(error){message(error.message,true);}
}
function surveyAction(survey,action,data){return mutate(JSON.stringify(['survey',survey.id,survey.version,action,data]),id=>api.surveyAction({requestId:id,survey,action,data}));}
async function openTask(id){const {data,error}=await supabase.from('operations_tasks').select('*').eq('id',id).single();if(error){message(error.message,true);return;}choose('task',data);}
async function openNotification(n){try{await api.readNotification(n.id);if(n.task_id)await openTask(n.task_id);else{const {data,error}=await supabase.from('operations_incidents').select('*').eq('id',n.incident_id).single();if(error)throw error;choose('incident',data);}n.read_at=new Date().toISOString();$('unread').textContent=state.notifications.filter(n=>!n.read_at).length||'';}catch(error){message(error.message,true);}}
async function start(){
 $('user').textContent=profile.display_name??profile.email??'';
 try{state.context=await api.context();for(const center of state.context.centers){const option=node('option',center.name);option.value=center.code;$('center').append(option);}const requested=new URLSearchParams(location.search).get('center');$('center').value=state.context.centers.some(c=>c.code===requested)?requested:state.context.writable_centers[0]??state.context.centers[0]?.code;
 document.querySelector('[data-view=hq]').hidden=!isHq();document.querySelector('[data-view=access]').hidden=!isHq();if(isHq())state.view='hq';
 $('center').onchange=()=>{const url=new URL(location.href);url.searchParams.set('center',$('center').value);historyReplace(url);state.selected=null;refresh();};
 $('refresh').onclick=refresh;$('mine').onchange=render;$('completed').onchange=refresh;
 document.querySelectorAll('nav button').forEach(el=>el.onclick=()=>{if(state.busy)return;state.view=el.dataset.view;state.selected=null;refresh();});await refresh();
 }catch(error){message(['PGRST202','42P01'].includes(error.code)?'업무 포털 서버 구성이 아직 적용되지 않았습니다. 관리자에게 서버 반영을 요청해 주세요.':error.message,true);setBusy(true);}
}
function historyReplace(url){globalThis.history.replaceState(null,'',url.pathname+url.search);}
if(profile)await start();
