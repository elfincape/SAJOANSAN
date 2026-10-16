import {mountCoupangWorkflow,isCoupangTask,coupangFields} from './portal-coupang.js';
import {canGenerateSurveyDraft} from './portal-draft-access.js';
import {renderSurveyFields} from './portal-survey-fields.js';
import {createRegistrationView} from './portal-registration.js';
import {createPortalHistory} from './portal-history.js';
import {setupPortalMentions} from './portal-mentions.js';
import {renderPermissions,permissionAllowed} from './portal-permissions.js';
import {renderMembers} from './portal-members.js';
import {renderParticipants,subjectLabel} from './portal-participants.js';
import {requireAuth} from './auth.js';
import {supabase} from './supabase.js';
import {createOperationsApi} from './operations-api.js';
import {operationsFiles,connectOneDrive,finishOneDrive} from './onedrive-api.js';
import {portalAi} from './portal-ai.js';
import {createPortalSearch} from './portal-search.js';
import {createPortalBackups} from './portal-backups.js';
import {openTaskDesigner,cadenceLabels} from './portal-designer.js';
import {periodBounds,shiftPeriod,calendarDates,calendarSegments,taskRunsOnDate,taskScheduleLabel,taskEnd,taskPeriod,overlapsPeriod,taskState,taskStateLabels} from './portal-task-views.js';
import {setupDialogDismiss} from './portal-dialog.js';
import {setupPortalSidebar} from './portal-sidebar.js';
import {koreaDate,statusLabels,actionLabels} from './operations-view.js';
import {finished,dispatchWarning,orderTasks,currentTemplates,collectInputs,surveyFields,surveyStages} from './portal-model.js';
const $=id=>document.getElementById(id),api=createOperationsApi(supabase),profile=await requireAuth();
const state={view:'center',registrationTab:'templates',unit:'week',layout:'calendar',status:'all',context:null,tasks:[],incidents:[],templates:[],surveys:[],notifications:[],parents:[],selected:null,busy:false,retry:null};
const incidentKinds=['차량 대차','차량 섭외 지연','납품처 문제','기사 문제','차량 문제','기타 특이사항'];
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text).replaceAll('HQ','배송팀');if(className)el.className=className;return el;}
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
const centerLabels={'001':'사조안산','002':'사조평택',gimhae:'김해센터',yangsan:'양산공장'};
function centerName(code){return centerLabels[code]??state.context.centers.find(c=>c.code===code)?.name??code;}
const viewResource=view=>({center:'tasks',surveys:'forms',briefing:'briefing',access:'members'})[view]??view;
function allowed(resource,action='read',center){return permissionAllowed(state.permissions,resource,action,center);}
function canWrite(code,resource='tasks'){return state.context.writable_centers.includes(code)&&allowed(resource,'edit',code)&&(!['hq','search','notifications','trash'].includes(state.view)||allowed(viewResource(state.view),'edit',code));}
function updateNavigation(){for(const el of document.querySelectorAll('nav button[data-view]'))el.hidden=!allowed(viewResource(el.dataset.view),'read',el.dataset.center);$('hq-navigation').hidden=!allowed('hq')&&!allowed('briefing');$('audit-navigation').hidden=!allowed('audit');}

function isHq(){return profile.role==='admin';}
function stamp(value){return value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'';}
function button(text,handler,parent,className){const el=node('button',text,className);el.type='button';el.onclick=handler;parent.append(el);return el;}
const renderPortalHistory=createPortalHistory({api,node,button,field,centerName,stamp,message,allowed,openRecord:async(type,id)=>{try{const {data,error}=await supabase.from(type==='task'?'operations_tasks':'operations_incidents').select('*').eq('id',id).single();if(error)throw error;choose(type,data);}catch(error){message(error.message||'원본을 불러올 수 없습니다.',true);}}});
const renderRegistrationView=createRegistrationView({node,button,canWrite,addRow,centerName,customizeTask,surveyForm,deleteSurvey:survey=>{if(confirm('이 업무조사를 삭제할까요?'))mutate('survey-delete:'+survey.id,requestId=>api.deleteSurvey({requestId,survey}),()=>{if(state.selected?.type==='survey'&&state.selected.row.id===survey.id)state.selected=null;});},retire:template=>{if(confirm('등록 업무를 삭제할까요? 이미 발행한 티켓과 기록은 유지됩니다.'))mutate('retire:'+template.id,id=>api.retireCustom({requestId:id,template}));},onTabChange:tab=>{if(state.busy)return;state.registrationTab=tab;state.selected=null;render();}});
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
 try{const result=await operation(state.retry.requestId);state.retry=null;if(success)success(result);else if(result?.id===state.selected?.row.id)state.selected={...state.selected,row:result};let reloadError=null;try{await loadData();}catch(error){reloadError=error;}render();const saved=state.selected?.type==='task'&&finished(state.selected.row)?'완료 처리되었습니다. 완료 시각과 처리 기록을 저장했습니다.':'저장했습니다.';message(saved+(reloadError?' 목록 새로고침에 실패했습니다. 잠시 후 새로고침하세요.':''));}
 catch(error){message(error.message||'저장하지 못했습니다. 입력을 유지했습니다. 다시 시도해 주세요.',true);}
 finally{setBusy(false);}
}
async function loadData(){
 state.permissions=await api.permissions();updateNavigation();
 if(!allowed(viewResource(state.view),'read',['center','surveys'].includes(state.view)?$('center').value:undefined)){Object.assign(state,{tasks:[],incidents:[],templates:[],surveys:[],notifications:[],selected:null});return;}
 if(['search','backups','connections','history'].includes(state.view))return;
 const center=$('center').value,period=periodBounds($('task-date').value||koreaDate(),state.unit);
 const [tasks,incidents,templates,surveys,notifications,staff,briefing,members,participants]=await Promise.all([
 api.tasks({center:['hq','trash'].includes(state.view)?undefined:center,trash:state.view==='trash',from:period.from,through:period.through,includeCompleted:true}),
 api.incidents({center:['hq','briefing','incidents'].includes(state.view)?undefined:center,includeResolved:true}),api.templates(center),api.surveys(state.view==='hq'?undefined:center),api.notifications(),state.view==='access'?api.staffAccess():[],state.view==='briefing'?portalAi.cachedBriefing():null,state.view==='members'?api.members():[],api.participantOptions(center)]);
 const parents=await api.parentTasks(incidents.map(i=>i.task_id));
 Object.assign(state,{tasks,incidents,templates,surveys,notifications,staff,briefing,parents,members,participants});
 $('unread').textContent=notifications.filter(n=>!n.read_at).length||'';
 if(state.selected){const collection=state.selected.type==='task'?tasks:state.selected.type==='incident'?incidents:surveys;const row=collection.find(r=>r.id===state.selected.row.id);if(row)state.selected={...state.selected,row};else if(state.selected.type==='task'){const {data,error}=await supabase.from('operations_tasks').select('*').eq('id',state.selected.row.id).single();if(error)throw error;state.selected={type:'task',row:data};}else state.selected=null;}
}
function renderOneDrive(){
 $('portal-title').textContent='OneDrive 관리';$('portal-description').textContent='업무자료 저장 폴더와 연결 상태를 관리합니다.';document.body.classList.remove('center-workspace','calendar-view');document.querySelector('.filters').hidden=true;$('new-task').hidden=$('issue-task').hidden=true;$('quick-actions').replaceChildren();$('items').replaceChildren();$('count').textContent='';$('list-title').textContent='저장소 관리';const panel=$('detail');panel.replaceChildren(node('h2','업무자료 저장 폴더'));const form=node('form',undefined,'portal-form');const url=field(form,'저장 폴더 공유 링크','url','','url');url.required=true;form.append(node('button','폴더 설정 저장','primary'));panel.append(form);form.onsubmit=async e=>{e.preventDefault();try{await operationsFiles.configure(url.value);message('폴더 접근을 확인하고 저장했습니다.');}catch(error){message(error.message,true);}};button('OneDrive 연결 확인',async()=>{try{const result=await operationsFiles.health();message(result.rootAccessible?'OneDrive 연결과 저장 폴더가 정상입니다.':'연결을 확인해 주세요.');}catch(error){message(error.message,true);}},panel);button('OneDrive 계정 연결',async()=>{try{await connectOneDrive();}catch(error){message(error.message,true);}},panel);operationsFiles.settings().then(result=>{if(form.isConnected){url.value=result.folderUrl??'';panel.append(node('p',result.connected?(result.folderConfigured?'계정 연결됨 · 저장 폴더 설정 완료':'계정 연결됨 · 지정 폴더를 저장해 주세요.'):'계정 연결 필요'));}}).catch(error=>message(error.message,true));
}
async function refresh(){if(state.busy)return;setBusy(true);message('업무를 불러오는 중입니다…');try{await loadData();render();message('');}catch(error){message(error.message||'업무를 불러오지 못했습니다.',true);}finally{setBusy(false);}}
function choose(type,row){if($('parent-task-dialog')?.open)$('parent-task-dialog').close();if((type!=='task'||state.view==='hq')&&$('task-ticket-dialog').open)$('task-ticket-dialog').close();state.selected={type,row};if(state.view!=='hq'&&(type==='task'||state.view==='center')&&!$('task-ticket-dialog').open){$('task-ticket-dialog').showModal();}renderDetail();}
function addRow(row,type,parent,extra=''){
 const el=button(row.title,()=>choose(type,row),parent,'task-row');el.replaceChildren();const content=node('span');if(type==='incident'||state.view==='hq')content.append(node('span',centerName(type==='incident'?incidentCenterCode(row):row.center_code),'center-property'));if(state.view==='hq')content.append(node('span',type==='incident'?'특이사항':'업무','record-property'));content.className='task-row-copy';content.append(node('strong',row.title,'task-row-name'),node('small',extra));
 
 el.append(content,node('span',type==='survey'?surveyStages[row.stage]:type==='incident'?incidentStatus(row):taskStateLabels[taskState(row)],'badge status-'+(type==='task'?taskState(row):type==='incident'?'incident-'+(row.status==='resolved'?'resolved':'open'):'other')));if(state.selected?.row.id===row.id)el.classList.add('selected');
}
function render(){
 $('items').removeAttribute('role');$('items').removeAttribute('aria-labelledby');
 document.body.classList.toggle('registration-workspace',state.view==='surveys'&&state.registrationTab==='templates');
 document.body.classList.toggle('permissions-workspace',state.view==='permissions');const hq=state.view==='hq',center=$('center').value;
 document.querySelectorAll('nav button').forEach(el=>{const active=el.dataset.view===state.view&&(!el.dataset.center||el.dataset.center===center);el.setAttribute('aria-pressed',String(active));if(active){const group=el.closest('details');if(group)group.open=true;}});
 if(!allowed(viewResource(state.view),'read',['center','surveys'].includes(state.view)?center:undefined)){$('portal-title').textContent='열람 권한 없음';$('portal-description').textContent='관리자에게 이 목록의 열람 권한을 요청하세요.';$('items').replaceChildren();$('detail').replaceChildren();$('quick-actions').replaceChildren();$('new-task').hidden=$('issue-task').hidden=true;document.querySelector('.filters').hidden=true;return;}
 if(state.view==='history'){$('portal-title').textContent='처리 기록';$('portal-description').textContent='센터 업무와 특이사항의 실제 처리 내역을 확인하세요.';document.body.classList.remove('center-workspace','calendar-view');document.querySelector('.filters').hidden=true;$('new-task').hidden=$('issue-task').hidden=true;renderPortalHistory(state.context.centers);if(state.selected)renderDetail();return;}
 if(state.view==='connections'){renderOneDrive();return;}
 if(state.view==='permissions'){$('portal-title').textContent='목록별 권한';$('portal-description').textContent='멤버의 역할·센터 속성으로 열람과 수정 조건을 설정하세요.';document.body.classList.remove('center-workspace','calendar-view');document.querySelector('.filters').hidden=true;$('new-task').hidden=$('issue-task').hidden=true;$('quick-actions').replaceChildren();$('count').textContent=state.permissions.rules.length+'개 목록';$('list-title').textContent='운영관리·포털 목록';renderPermissions({context:state.permissions,centers:state.context.centers,node,button,field,items:$('items'),panel:$('detail'),centerName,save:(config,data)=>mutate(JSON.stringify(['permission',config.resource,config.version,data]),requestId=>api.updatePermission({requestId,config,...data}))});return;}

 $('portal-title').textContent=hq?'배송팀 업무':state.view==='briefing'?'배송팀 AI 브리핑':state.view==='access'?'센터 담당자 배정':state.view==='permissions'?'목록별 권한':state.view==='members'?'멤버 목록':state.view==='notifications'?'알림함':state.view==='surveys'?centerName(center)+' 업무 등록·조사':state.view==='incidents'?'특이사항':state.view==='trash'?'휴지통':centerName(center)+' 업무목록';
 $('portal-description').textContent=hq?'확인 필요한 업무와 특이사항을 센터 속성으로 확인하고 여기에서 처리하세요.':state.view==='incidents'?'센터 업무에서 발생한 특이사항을 처리중·처리완료로 확인하세요.':'진행 중 업무는 날짜가 지나도 계속 표시됩니다.';
 document.querySelector('.filters').hidden=!['center','hq'].includes(state.view);$('task-layout').hidden=state.view!=='center';document.querySelector('.toolbar-bottom').hidden=state.view!=='center';document.body.classList.toggle('calendar-view',state.view==='center'&&state.layout==='calendar');document.body.classList.toggle('center-workspace',state.view==='center');$('new-task').hidden=state.view!=='center'||!canWrite(center);document.querySelectorAll('[data-view-control]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.value===state[{ 'task-unit':'unit','task-layout':'layout','task-status':'status'}[el.dataset.viewControl]])));

 $('mine').disabled=state.view!=='center';$('completed').disabled=!['center','hq'].includes(state.view);$('center').disabled=['hq','notifications','access','briefing'].includes(state.view);
 const actions=$('quick-actions');actions.replaceChildren();$('issue-task').hidden=state.view!=='center'||!canWrite(center);
 if(state.view==='backups'){
  $('portal-title').textContent='운영 원본 보관';$('portal-description').textContent='월말 전체 원본과 OneDrive 저장 상태를 확인하세요.';
  $('center').disabled=true;renderBackups();return;
 }
 if(state.view==='search'){
  $('portal-title').textContent='통합 검색';$('portal-description').textContent='업무와 운영 마스터, 과거 특이사항을 유형별로 찾으세요.';
  $('center').disabled=true;renderSearch(state.context.centers);return;
 }
 if(state.view==='members'){renderMembers({members:state.members,centers:state.context.centers,node,button,field,centerName,items:$('items'),panel:$('detail'),save:async(person,data)=>{let saved=false;await mutate(JSON.stringify(['member',person.id,data]),requestId=>api.updateMember({requestId,person,...data}),()=>{saved=true;if(person.id===profile.id){profile.display_name=data.name.trim();$('user').textContent=profile.display_name;}});if(saved&&person.id===profile.id&&data.role!==profile.role)location.reload();}});$('count').textContent=state.members.length+'명';$('list-title').textContent='멤버 목록';return;}
 if(state.view==='briefing'){renderBriefing(actions);return;}
 const items=$('items');items.replaceChildren();let count=0;
 const handedOff=new Set(state.notifications.filter(n=>n.task_id).map(n=>n.task_id));
 const tasks=orderTasks(state.tasks,{userId:profile.id,handedOff});
 if(hq){
  items.append(node('h3','내 업무'));
  const own=tasks.filter(t=>assignedToMe(t)&&!finished(t));own.forEach(t=>addRow(t,'task',items,taskPeriod(t)));
  if(!own.length)items.append(node('p','현재 맡은 미완료 업무가 없습니다.'));
  const pending=tasks.filter(t=>!finished(t)),open=state.incidents.filter(i=>i.status==='open');count=pending.length+open.length;
  const block=node('details',undefined,'hq-review'),summary=node('summary'),list=node('div',undefined,'hq-review-list');summary.append(node('strong','확인 필요'),node('span',count+'건','badge'));block.append(summary,list);block.open=state.hqReviewOpen===true;block.ontoggle=()=>{if(block.isConnected)state.hqReviewOpen=block.open;};items.append(block);
  pending.forEach(t=>addRow(t,'task',list,taskPeriod(t)));
  open.forEach(i=>addRow(i,'incident',list,[stamp(i.created_at),i.support_state==='requested'?'배송팀 지원 요청':i.support_state==='supporting'?'배송팀 지원 중':''].filter(Boolean).join(' · ')));
  if(!count)list.append(node('p','확인 필요한 미완료 항목이 없습니다.'));
 }else if(state.view==='center'){
  const period=periodBounds($('task-date').value,state.unit);
  const candidates=tasks.filter(t=>(!$('mine').checked||assignedToMe(t))&&(overlapsPeriod(t,period.from,period.through)||(taskEnd(t)<period.from&&!finished(t))));
  for(const label of document.querySelectorAll('[data-status-count]')){const value=label.dataset.statusCount;label.textContent=value==='all'?candidates.length:candidates.filter(t=>taskState(t)===value).length;}
  const visible=candidates.filter(t=>state.status==='all'||taskState(t)===state.status);
  const inPeriod=visible.filter(t=>overlapsPeriod(t,period.from,period.through)),overdue=visible.filter(t=>taskEnd(t)<period.from&&!finished(t));count=inPeriod.length+overdue.length;
  if(overdue.length){items.append(node('h3','이전 기간 미완료 · '+overdue.length+'건'));overdue.forEach(t=>addTaskWithChildren(t,items));}
  items.append(node('h3',period.from+(period.from===period.through?'':' ~ '+period.through)));
  if(state.layout==='calendar')renderTaskCalendar(inPeriod,items);else inPeriod.forEach(t=>addTaskWithChildren(t,items));
  }else if(state.view==='trash'){count=tasks.length;tasks.forEach(t=>addRow(t,'task',items,centerName(t.center_code)+' · 휴지통 이동 '+stamp(t.deleted_at)));
 }else if(state.view==='incidents'){
  count=state.incidents.length;renderIncidentList(state.incidents,items);
  }else if(state.view==='surveys'){
  const section=renderRegistrationView({tab:state.registrationTab,center,templates:state.templates,surveys:state.surveys,items,actions});
  count=section.count;$('portal-description').textContent=section.description;
 }
 
 else if(state.view==='access'){
  count=state.staff.length;
  for(const person of state.staff)button(person.name+' · '+(person.role==='admin'?'배송팀 (모든 센터)':person.centers.map(centerName).join(', ')||'센터 미배정'),()=>membershipForm(person),items,'task-row');
 }
 else{
  count=state.notifications.length;
  for(const n of state.notifications)button(`${n.read_at?'':'● '}${n.title} · ${stamp(n.created_at)}`,()=>openNotification(n),items,'task-row');
 }
 if(!count&&!hq&&state.view!=='surveys'){
  const empty=node('div',undefined,'portal-empty');empty.append(node('strong',state.view==='center'?'조회 조건에 맞는 업무가 없습니다.':state.view==='notifications'?'새로운 알림이 없습니다.':'표시할 항목이 없습니다.'),node('p',state.view==='center'?'기간이나 상태를 변경해 확인하세요. 새 업무는 상단에서 등록할 수 있습니다.':state.view==='trash'?'휴지통으로 이동한 업무가 여기에 표시됩니다.':'등록된 항목이 있으면 여기에 표시됩니다.'));items.append(empty);
 }
 $('count').textContent=count+'건';$('list-title').textContent={center:'업무목록',trash:'휴지통의 업무',hq:'업무와 지원 요청',incidents:'특이사항',surveys:state.registrationTab==='surveys'?'업무조사':'등록된 업무',notifications:'내 알림',access:'활성 직원'}[state.view];
 renderDetail();
}
function assignedToMe(task){if(task.owner_id===profile.id)return true;const subject=state.participants?.find(s=>s.id===task.handler_subject_id),person=state.participants?.find(s=>s.user_id===profile.id);return subject?.kind==='role'&&subject.role_key==='delivery_team'&&profile.role==='admin'||subject?.kind==='center'&&(person?.centers??[]).includes(subject.center_code);}
function customizeTask(template){openTaskDesigner({template,center:$('center').value,name:centerName($('center').value),node,button,field,save:async data=>{await api.publishCustom(data);await loadData();render();message('업무 양식을 저장했습니다. 센터 업무에서 버튼을 눌러 티켓을 발행하세요.');}});}
 function addTaskWithChildren(task,parent){addRow(task,'task',parent,taskPeriod(task)+' · '+(cadenceLabels[task.template_snapshot?.spec?.ui_cadence]??'업무'));const children=state.incidents.filter(i=>i.task_id===task.id);if(children.length){const group=node('div',undefined,'incident-children');children.forEach(i=>addRow(i,'incident',group,'↳ 특이사항 · '+stamp(i.created_at)));parent.append(group);}}
 function renderTaskCalendar(tasks,parent){
 const unit=state.unit,daily=unit==='month'?tasks.filter(t=>taskEnd(t)===t.work_date):[],periodTasks=unit==='month'?tasks.filter(t=>taskEnd(t)!==t.work_date):tasks,dates=calendarDates($('task-date').value,unit),grid=node('div',undefined,'task-calendar calendar-spans calendar-'+unit),width=unit==='day'?1:7;
 grid.setAttribute('role','region');grid.setAttribute('aria-label','업무 달력 · 좁은 화면에서는 좌우로 이동해 날짜를 확인하세요.');grid.tabIndex=0;grid.classList.toggle('is-empty',!tasks.length);
 for(let i=0;i<dates.length;i+=width){const days=dates.slice(i,i+width),week=node('div',undefined,'calendar-span-week');week.style.setProperty('--days',days.length);
  for(const date of days){const cell=node('section',undefined,'calendar-cell');cell.style.gridColumn=days.indexOf(date)+1;cell.append(node('h4',date.slice(5)+' · '+['일','월','화','수','목','금','토'][new Date(date+'T00:00:00Z').getUTCDay()]));if(date===koreaDate())cell.classList.add('calendar-today');if(unit==='month'){const entries=daily.filter(t=>t.work_date===date);if(entries.length)calendarDailyDropdown(entries,date,cell);}week.append(cell);}
  const bars=node('div',undefined,'calendar-bars');for(const segment of calendarSegments(periodTasks,days)){const {task,start,end,lane,continuesBefore,continuesAfter}=segment;
   addRow(task,'task',bars,taskPeriod(task).replace(/\d{4}-(\d{2})-(\d{2})/g,'$1.$2').replace(' ~ ','–'));const bar=bars.lastElementChild;bar.classList.add('calendar-task-bar');bar.style.gridColumn=(start+1)+' / '+(end+2);bar.style.gridRow=lane+1;bar.title=task.title+' · '+taskPeriod(task);bar.classList.toggle('continues-before',continuesBefore);bar.classList.toggle('continues-after',continuesAfter);
  }week.append(bars);grid.append(week);
 }parent.append(grid);
}
function calendarDailyDropdown(tasks,date,cell){
 const popup=node('div',undefined,'calendar-daily-dropdown');popup.id='daily-'+crypto.randomUUID();popup.popover='auto';popup.setAttribute('aria-label',date+' 일일 업무');const trigger=button('일일 업무 '+tasks.length+'건',()=>{},cell,'calendar-daily-button');trigger.popoverTargetElement=popup;trigger.setAttribute('aria-label','일일 업무 '+tasks.length+'건');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',popup.id);trigger.title='날짜별 일일 업무 목록 펼치기';
 popup.append(node('strong',date+' · 일일 업무'));for(const task of tasks){const handler=state.participants?.find(s=>s.id===task.handler_subject_id)??state.participants?.find(s=>s.user_id===task.owner_id);const cadence=cadenceLabels[task.template_snapshot?.spec?.ui_cadence]??'일회성 업무';addRow(task,'task',popup,[centerName(task.center_code),cadence,handler?'담당 '+subjectLabel(handler,centerName):'담당 미지정'].join(' · '));}
 popup.addEventListener('beforetoggle',event=>{if(event.newState!=='open')return;const rect=trigger.getBoundingClientRect(),width=Math.min(360,innerWidth-24),height=Math.min(360,innerHeight-24);popup.style.width=width+'px';popup.style.maxHeight=height+'px';popup.style.left=Math.max(12,Math.min(rect.left,innerWidth-width-12))+'px';popup.style.top=Math.max(12,Math.min(rect.bottom+6,innerHeight-height-12))+'px';});popup.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(popup.matches(':popover-open'))));popup.addEventListener('click',event=>{if(event.target.closest('.task-row')&&popup.matches(':popover-open'))popup.hidePopover();});cell.append(popup);
}
 function renderBriefing(actions){
 button('브리핑 생성·새로고침',async()=>{if(state.busy)return;setBusy(true);message('실제 운영 기록으로 브리핑을 만드는 중입니다…');try{const result=await portalAi.briefing(true);state.briefing=await portalAi.cachedBriefing();await loadData();render();message(result.pending?result.message:result.cached?'저장된 결과를 표시했습니다. 새 생성 요청은 1분 간격으로 처리합니다.':'브리핑을 생성했습니다.');}catch(error){message(error.message,true);}finally{setBusy(false);}},actions,'primary');
 const items=$('items'),panel=$('detail'),entry=state.briefing,body=entry?.body;items.replaceChildren();panel.replaceChildren();$('list-title').textContent='확인할 운영 기록';$('count').textContent='특이사항 '+state.incidents.filter(i=>i.task_id).length+'건 · AI 요약 '+(body?.items?.length??0)+'건';
 panel.append(node('h2','오늘의 운영 브리핑'),node('p','매일 오전 08:00에 생성합니다. 각 항목에서 실제 업무 기록을 확인하세요.'));
 if(entry?.last_error)panel.append(node('p',entry.last_error,'error'));
 if(entry?.dispatch_error)panel.append(node('p',entry.dispatch_error,'error'));
 if(entry?.status==='running')panel.append(node('p','새 브리핑을 생성 중입니다. 잠시 후 새로고침하세요.'));
 items.append(node('h3','센터 업무 특이사항 · 현재 상태'));renderIncidentList(state.incidents,items);panel.append(node('p','특이사항 처리중·처리완료는 현재 원본 기준입니다. 아래 AI 요약은 생성 시점 기준입니다.'));
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
function renderDetail(){const selectedTask=state.selected&&(state.selected.type==='task'||state.view==='center');const popup=$('task-ticket-dialog');const panel=selectedTask&&popup.open?popup:$('detail');if(panel===popup){panel.replaceChildren();const header=node('div',undefined,'parent-dialog-heading');header.append(node('strong','업무 티켓'));button('닫기',()=>popup.close(),header);panel.append(header);}else panel.replaceChildren();const selected=state.selected;if(!selected){panel.append(node('p','목록에서 항목을 선택하세요.'));return;}const {row,type}=selected;panel.append(node('h2',row.title));if(type==='task')taskDetail(row,panel);else if(type==='incident')incidentDetail(row,panel);else surveyDetail(row,panel);if(type==='survey'){const filesSection=node('section',undefined,'survey-files');filesSection.append(node('h3','사용하는 파일'));panel.append(filesSection);attachments(type,row,filesSection);}else if(type!=='task'||!isCoupangTask(row))attachments(type,row,panel);if(type==='task')panel.append(panel.querySelector(':scope > .task-participants'));}
function attachments(kind,row,panel,{allowUpload=true}={}){
 const section=node('section',undefined,'attachments'),list=node('div'),form=node('form',undefined,'portal-form'),hint=node('p');
 section.append(list);panel.append(section);
 let pending=null;
 const input=field(form,'파일 선택','file','','file');input.required=true;input.accept='.xlsx,.xls,.pdf,.docx,.doc,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp';
 input.onchange=()=>{if(pending?.expectedRow)pending.file=input.files[0];else pending=null;};
 form.append(hint,node('button','파일 올리기','primary'));if(allowUpload&&canWrite(row.center_code,{task:'tasks',incident:'incidents',survey:'forms'}[kind]))section.append(form);
 async function load(){
  try{const files=await operationsFiles.list(kind,row.id);if(!section.isConnected)return;list.replaceChildren();
   if(!files.length)list.append(node('p','첨부된 파일이 없습니다.'));
   for(const file of files){const line=node('div',undefined,'history-entry');line.append(node('p',file.file_name),node('small',file.original_name+' · '+(file.byte_size/1024).toFixed(1)+'KB · '+stamp(file.created_at)));
    if(file.status==='saved')button('다운로드',async()=>{if(state.busy)return;setBusy(true);try{const blob=await operationsFiles.download(file.id),url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=file.file_name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);message('파일을 다운로드했습니다.');}catch(error){message(error.message,true);}finally{setBusy(false);}},line);
    else {line.append(node('p',file.status==='failed'?'저장 실패 · '+(file.last_error??'다시 시도해 주세요.'):'저장 확인 중'));
     if(allowUpload&&file.uploaded_by===profile.id&&canWrite(row.center_code,{task:'tasks',incident:'incidents',survey:'forms'}[kind]))button('같은 파일로 재시도',()=>{pending={requestId:file.request_id,file:null,expectedRow:file};input.value='';hint.textContent=file.original_name+' 파일을 다시 선택하세요.';input.focus();},line);
    }list.append(line);
   }
  }catch(error){if(section.isConnected)list.replaceChildren(node('p',error.message,'error'));}
 }
 form.onsubmit=async event=>{
  event.preventDefault();if(state.busy)return;const file=input.files[0];if(!file)return;
  if(file.size<1||file.size>10*1024*1024){message('10MB 이하의 파일을 선택해 주세요.',true);return;}
  if(!pending||(!pending.expectedRow&&pending.file!==file))pending={file,requestId:crypto.randomUUID()};
  if(pending.expectedRow&&(file.name!==pending.expectedRow.original_name||file.size!==pending.expectedRow.byte_size)){message('이전에 선택한 파일과 다릅니다. 같은 파일을 선택해 주세요.',true);return;}
  setBusy(true);message('파일을 저장하는 중입니다…');
  try{await operationsFiles.upload({kind,subjectId:row.id,requestId:pending.requestId,file});pending=null;input.value='';hint.textContent='';await load();message('파일을 저장했습니다.');}
  catch(error){await load();message(error.message||'첨부를 저장하지 못했습니다. 선택한 파일을 유지했습니다.',true);}
  finally{setBusy(false);}
 };
 load();
}
function issueTaskPicker(){
 const dialog=$('task-ticket-dialog');dialog.replaceChildren();const header=node('div',undefined,'parent-dialog-heading');header.append(node('h2','업무 발행'));button('닫기',()=>dialog.close(),header);dialog.append(header);
 const periodForm=node('form',undefined,'portal-form');periodFields(periodForm);dialog.append(periodForm);const templates=currentTemplates(state.templates),grid=node('div',undefined,'issue-template-list');dialog.append(grid);
 const issueButtons=[];for(const t of templates){const b=button(t.title+' · '+(cadenceLabels[t.spec.ui_cadence]??'업무')+taskScheduleLabel(t),()=>{if(!periodForm.reportValidity())return;const date=periodForm.elements.date.value;if(!taskRunsOnDate(t,date)){message('이 업무는 선택한 날짜의 요일에 실행하지 않습니다.',true);return;}const endDate=periodForm.elements.endDate.value;mutate(JSON.stringify(['template',t.id,date,endDate]),id=>api.issuePeriod({requestId:id,templateId:t.id,date,endDate}),row=>{state.selected={type:'task',row};});},grid,'primary');issueButtons.push([b,t]);}const updateIssueDays=()=>issueButtons.forEach(([b,t])=>{b.disabled=!taskRunsOnDate(t,periodForm.elements.date.value);b.title=b.disabled?'설정한 실행 요일이 아닙니다. 시작일을 변경하세요.':'';});periodForm.elements.date.addEventListener('change',updateIssueDays);updateIssueDays();
 if(!templates.length)dialog.append(node('p','업무 등록·조사에서 센터 업무 양식을 먼저 등록하세요.'));if(!dialog.open)dialog.showModal();
}
function periodFields(form){
 const start=field(form,'시작일','date',koreaDate(),'date'),end=field(form,'종료일','endDate',koreaDate(),'date');start.required=end.required=true;end.min=start.value;start.onchange=()=>{end.min=start.value;if(end.value<start.value)end.value=start.value;};
}
function taskCreate(){
 const panel=$('task-ticket-dialog');panel.replaceChildren();const header=node('div',undefined,'parent-dialog-heading');header.append(node('h2','일회성 업무등록'));button('닫기',()=>panel.close(),header);panel.append(header);if(!panel.open)panel.showModal();const form=node('form',undefined,'portal-form');const title=field(form,'업무명','title');title.required=true;title.maxLength=200;periodFields(form);field(form,'필요한 내용','note','','textarea');const submit=node('button','등록','primary');form.append(submit);panel.append(form);
 form.onsubmit=e=>{e.preventDefault();const data={center:$('center').value,title:title.value,date:form.elements.date.value,endDate:form.elements.endDate.value,inputs:{work_note:form.elements.note.value}};mutate(JSON.stringify(['create',data]),id=>api.save({requestId:id,...data}),row=>state.selected={type:'task',row});};
}
const taskDrafts=new Map(),workflowSaveRequests=new Map();
function taskDetail(task,panel,readOnly=false){
 const coupang=isCoupangTask(task);
 if(task.deleted_at){panel.append(node('p','휴지통에 보관 중 · '+stamp(task.deleted_at)),node('p',centerName(task.center_code)+' · '+task.work_date),node('p',task.inputs?.work_note??''));const values=node('dl');for(const f of task.template_snapshot?.spec?.fields??[])values.append(node('dt',f.label),node('dd',String(task.inputs?.[f.key]??'')));panel.append(values);if(!readOnly&&canWrite(task.center_code,'trash')&&canWrite(task.center_code))button('업무 복원',()=>moveTaskTrash(task,true),panel,'primary');history(task,panel,'task');renderParticipants({task,panel,options:state.participants??[],node,button,field,centerName,writable:false});return;}
 if(!readOnly&&canWrite(task.center_code,'trash')&&canWrite(task.center_code))button('삭제 · 휴지통으로 이동',()=>moveTaskTrash(task,false),panel,'trash-button');
 const draft=taskDrafts.get(task.id);const values=!readOnly&&draft?.version===task.version?draft.inputs:task.inputs;
 let changeHandler=()=>{};const writable=!readOnly&&canWrite(task.center_code),form=node('form',undefined,'portal-form');const handler=state.participants?.find(s=>s.id===task.handler_subject_id)??state.participants?.find(s=>s.user_id===task.owner_id);panel.append(node('p',`${centerName(task.center_code)} · ${taskPeriod(task)} · ${taskStateLabels[taskState(task)]}`,'task-period-meta'),node('p','담당자 · '+subjectLabel(handler,centerName),'task-handler-meta'));
 if(!coupang&&task.template_snapshot?.spec?.external_process?.length){const process=node('details',undefined,'external-process');process.append(node('summary','외부 업무 프로세스'));const list=node('ol');task.template_snapshot.spec.external_process.forEach(step=>list.append(node('li',step)));process.append(list);panel.append(process);}
 if(!coupang&&task.template_snapshot?.spec?.completion_condition)panel.append(node('p','완료 전 확인 · '+task.template_snapshot.spec.completion_condition));
 if(task.due_at)panel.append(node('p','업무 마감 · '+stamp(task.due_at)));
 const fields=coupang?coupangFields(task):task.template_snapshot?.spec?.fields??[];
 for(const f of fields){let el;if(f.control==='select'){const label=node('label',f.label);el=node('select');el.name='field_'+f.key;const blank=node('option','선택하세요');blank.value='';el.append(blank);for(const value of f.options??[]){const option=node('option',value);option.value=value;el.append(option);}el.value=values?.[f.key]??'';label.append(el);form.append(label);}else el=field(form,f.label,'field_'+f.key,values?.[f.key],f.type==='boolean'?'checkbox':f.type==='number'?'number':f.control==='date'?'date':f.control==='textarea'?'textarea':'text');if(f.type==='number')el.step='any';}
 if(!coupang&&task.template_snapshot?.spec?.description)panel.append(node('p',task.template_snapshot.spec.description));
 if(finished(task))panel.append(node('p','완료 확정 · '+stamp(task.completed_at),'completion-confirmed'));
 if(!coupang)field(form,'업무 내용','work_note',values?.work_note??'','textarea');
 const steps=coupang?[]:task.template_snapshot?.spec?.steps??[];
 for(const step of steps){const status=task.inputs?.steps?.[step.key];const wrap=node(status==='completed'||status==='not_applicable'?'details':'fieldset');wrap.append(node(wrap.tagName==='DETAILS'?'summary':'legend',step.label+' · '+(statusLabels[status]??'')));
  if(!finished(task)&&writable){button('처리 완료',()=>saveTask(task,form,task.status,{step:step.key,status:'completed'}),wrap);button('해당 없음',()=>saveTask(task,form,task.status,{step:step.key,status:'not_applicable'}),wrap);}form.append(wrap);
 }
 if(!finished(task)&&writable){const actions=node('div',undefined,'actions');button('저장',()=>saveTask(task,form,'in_progress'),actions);button('업무 완료',()=>saveTask(task,form,'completed'),actions,'primary');if(!coupang)button('해당 없음',()=>saveTask(task,form,'not_applicable'),actions);button('담당자 변경',()=>changeHandler(),actions);form.append(actions);}
 else form.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=true);
 panel.append(form);form.onsubmit=e=>{e.preventDefault();if(writable&&!finished(task))saveTask(task,form,'in_progress');};
 if(coupang)mountCoupangWorkflow({task,panel,form,node,button,files:operationsFiles,collect:()=>collectInputs(task,form),writable:writable&&!finished(task),persist:async inputs=>{
  if(state.busy)throw Error('저장 중입니다. 잠시 후 다시 시도하세요.');
  const key=JSON.stringify([task.id,task.version,inputs]);let request=workflowSaveRequests.get(task.id);
  if(request?.key!==key){request={key,id:crypto.randomUUID()};workflowSaveRequests.set(task.id,request);}
  setBusy(true);
  try{
   const row=await api.save({requestId:request.id,task,center:task.center_code,title:task.title,date:task.work_date,endDate:taskEnd(task),inputs,status:'in_progress'});
   if(row?.id!==task.id||!Number.isInteger(row.version))throw Error('업무 저장 결과를 확인하지 못했습니다. 다시 시도하세요.');
   Object.assign(task,row);if(state.selected?.row.id===task.id)state.selected={type:'task',row:task};taskDrafts.delete(task.id);workflowSaveRequests.delete(task.id);
  }finally{setBusy(false);}
 },refresh:async text=>{await refresh();message(text);}});
 if(writable){const actions=node('div',undefined,'quick-actions');if(finished(task))button('업무 다시 열기',()=>mutate('reopen:'+task.id+':'+task.version,id=>api.reopen({requestId:id,task})),actions);else{
  button('마감시간',()=>deadlines(task,panel),actions);
  allowed('incidents','edit',task.center_code)&&button('특이사항 발생',()=>{taskDrafts.set(task.id,{version:task.version,inputs:collectInputs(task,form)});if($('task-ticket-dialog').open)$('task-ticket-dialog').close();incidentCreate(null,task);},actions,'primary');
 }panel.append(actions);}
 const children=state.incidents.filter(i=>i.task_id===task.id);if(children.length){panel.append(node('h3','이 업무의 특이사항'));children.forEach(i=>addRow(i,'incident',panel,stamp(i.created_at)));}
 history(task,panel,'task');
 changeHandler=renderParticipants({task,panel,options:state.participants??[],node,button,field,centerName,writable:writable&&!finished(task),loadOptions:code=>api.participantOptions(code),stash:()=>{taskDrafts.set(task.id,{version:task.version,inputs:collectInputs(task,form)});},save:data=>mutate(JSON.stringify(['participants',task.id,task.version,data]),requestId=>api.setParticipants({requestId,task,...data}),row=>{const draft=taskDrafts.get(task.id);if(draft)taskDrafts.set(task.id,{...draft,version:row.version});state.selected={type:'task',row};})});
}
function moveTaskTrash(task,restore){return mutate(JSON.stringify(['trash',task.id,task.version,restore]),requestId=>api.trashTask({requestId,task,restore}),()=>{taskDrafts.delete(task.id);state.selected=null;if($('task-ticket-dialog').open)$('task-ticket-dialog').close();});}
function saveTask(task,form,status,step){
 try{const inputs=collectInputs(task,form);if(step){inputs.steps={...inputs.steps,[step.step]:step.status};}const data={task,center:task.center_code,title:task.title,date:task.work_date,endDate:taskEnd(task),inputs,status};mutate(JSON.stringify(['save',data]),id=>api.save({requestId:id,...data}),row=>{if(row.status!==status||(finished(row)&&(!row.completed_at||!row.completed_by)))throw Error('완료 저장 결과를 확인하지 못했습니다. 새로고침해 주세요.');taskDrafts.delete(task.id);state.selected={type:'task',row};});}catch(error){message(error.message,true);}
}
function localTime(value){if(!value)return '';const date=new Date(new Date(value).valueOf()+9*3600000);return date.toISOString().slice(0,16);}
function deadlines(task,panel){
 const form=node('form',undefined,'portal-form');field(form,'업무 마감 (한국시간)','due',localTime(task.due_at),'datetime-local');field(form,'기존 마감 변경 사유','reason');form.append(node('button','마감시간 저장'));panel.insertBefore(form,panel.querySelector(':scope > .task-participants'));
 form.onsubmit=e=>{e.preventDefault();const value=name=>form.elements[name].value?new Date(form.elements[name].value+':00+09:00').toISOString():null;const data={due_at:value('due'),cj_share_due_at:task.cj_share_due_at??null,reason:form.elements.reason.value};mutate(JSON.stringify(['deadline',task.id,task.version,data]),id=>api.taskAction({requestId:id,task,action:'deadline',data}));};
}
function incidentCenterCode(row){return state.parents.find(t=>t.id===row.task_id)?.center_code??row.center_code;}
function incidentStatus(row){return row.status==='resolved'?'처리완료':'처리중';}
function parentTitle(id){return state.parents.find(t=>t.id===id)?.title??state.tasks.find(t=>t.id===id)?.title??'상위 업무 확인';}
function addIncidentRow(row,parent){
 const line=node('div',undefined,'incident-record');addRow(row,'incident',line,row.kind+' · 발생 '+stamp(row.created_at)+(row.resolved_at?' · 처리완료 '+stamp(row.resolved_at):''));
 if(row.task_id)button('↳ 상위 업무 · '+parentTitle(row.task_id),()=>openParentTask(row.task_id),line,'parent-mention');parent.append(line);
}
function renderIncidentList(rows,parent){
 [...rows].sort((a,b)=>Number(a.status==='resolved')-Number(b.status==='resolved')||String(b.created_at??'').localeCompare(String(a.created_at??''))||String(a.id).localeCompare(String(b.id))).forEach(row=>addIncidentRow(row,parent));
}
function incidentCreate(kind,task){
 if(!task){message('하던 업무의 특이사항 발생 버튼으로 등록해 주세요.',true);return;}
 const panel=$('task-ticket-dialog')??$('detail');if(panel.tagName==='DIALOG'&&!panel.open)panel.showModal();panel.replaceChildren(node('h2','특이사항 발생'),node('p','상위 업무 · '+task.title));const form=node('form',undefined,'portal-form');const label=node('label','유형'),select=node('select');select.name='kind';for(const item of incidentKinds){const option=node('option',item);option.value=item;select.append(option);}label.append(select);form.append(label);
 field(form,'제목','title',kind??'').required=true;field(form,'발생 내용','note','','textarea').required=true;form.append(node('button','처리중으로 등록','primary'));panel.append(form);
 form.onsubmit=e=>{e.preventDefault();const data={task_id:task.id,title:form.elements.title.value,kind:select.value,inputs:{발생내용:form.elements.note.value}};mutate(JSON.stringify(['incident',data]),id=>api.incidentAction({requestId:id,action:'create',data}),row=>{if($('task-ticket-dialog')?.open)$('task-ticket-dialog').close();state.view='incidents';$('center').value=task.center_code;state.selected={type:'incident',row};});};
}
function incidentDetail(row,panel){
 panel.append(node('p',centerName(incidentCenterCode(row))+' · '+row.kind+' · '+incidentStatus(row)),node('p','발생 '+stamp(row.created_at)+(row.resolved_at?' · 처리완료 '+stamp(row.resolved_at):'')));
 if(row.task_id)button('상위 업무 · '+parentTitle(row.task_id),()=>openParentTask(row.task_id),panel,'parent-mention');
 const writable=canWrite(row.center_code,'incidents');
 if(row.status==='open'&&writable){const form=node('form',undefined,'portal-form');field(form,'특이사항 제목','title',row.title).required=true;field(form,'발생 내용','note',row.inputs?.발생내용??'','textarea').required=true;field(form,'처리 내용','progress',row.inputs?.처리내용??'','textarea');const actions=node('div',undefined,'actions');const inputs=()=>({...row.inputs,발생내용:form.elements.note.value,처리내용:form.elements.progress.value});button('내용 저장',()=>{if(form.reportValidity())incidentAction(row,'edit',{title:form.elements.title.value,inputs:inputs()});},actions);button('처리완료',()=>{if(!form.reportValidity())return;const data={title:form.elements.title.value,inputs:inputs()};incidentAction(row,'resolve',{...data,note:form.elements.progress.value});},actions,'primary');form.append(actions);form.onsubmit=e=>e.preventDefault();panel.append(form);
 }else{panel.append(node('h3','발생 내용'),node('p',row.inputs?.발생내용??''),node('h3','처리 내용'),node('p',row.inputs?.처리내용??'처리 내용 기록 없음'));if(row.status==='resolved'&&allowed('incidents','edit',row.center_code))button('다시 처리중으로 열기',()=>incidentAction(row,'reopen'),panel);else if(row.status==='open'&&allowed('incidents','edit',row.center_code)){const form=node('form',undefined,'portal-form');field(form,'처리 내용','note',row.inputs?.처리내용??'','textarea');form.append(node('button','처리완료','primary'));form.onsubmit=e=>{e.preventDefault();incidentAction(row,'resolve',{note:form.elements.note.value});};panel.append(form);}}
 if(writable&&row.status==='open')button('배송팀 지원 요청',()=>incidentAction(row,'request_support'),panel);
 if(isHq()&&allowed('incidents','edit',row.center_code)&&row.status==='open'){const form=node('form',undefined,'portal-form');field(form,'배송팀 조치 내용','note','','textarea').required=true;form.append(node('button','조치 기록'));form.onsubmit=e=>{e.preventDefault();incidentAction(row,'support',{note:form.elements.note.value.trim(),done:false});};panel.append(form);}
 history(row,panel,'incident');
}
function incidentAction(incident,action,data={}){return mutate(JSON.stringify([incident.id,incident.version,action,data]),id=>api.incidentAction({requestId:id,incident,action,data}));}
async function history(row,panel,type){
 const details=node('details',undefined,'history');details.append(node('summary','처리 기록'));panel.append(details);
 try{const events=await api.events(type==='task'?{taskId:row.id}:{incidentId:row.id});if(!details.isConnected)return;for(const event of events.filter(e=>e.action!=='file_uploaded')){const entry=node('div',undefined,'history-entry');entry.append(node('small',stamp(event.occurred_at)+' · '+(actionLabels[event.action]??(event.action==='task_reopened'?'업무 재개':event.action))));if(event.action==='task_handoff'){const labels=id=>subjectLabel(state.participants?.find(s=>s.id===id),centerName);entry.append(node('p',labels(event.request_body?.from)+' → '+labels(event.request_body?.to)),node('small','인계 기록자 · '+subjectLabel(state.participants?.find(s=>s.user_id===event.actor_id),centerName)));}else if(event.action==='task_assigned')entry.append(node('p','처리 담당 · '+subjectLabel(state.participants?.find(s=>s.id===event.request_body?.handler),centerName)));const data=event.request_body?.data;if(data?.note)entry.append(node('p',data.note));if(data?.memo)entry.append(node('p',data.memo));if(data?.reason)entry.append(node('p',data.reason));details.append(entry);}}
 catch{details.append(node('p','처리 기록을 불러오지 못했습니다.'));}
}
function surveyForm(survey=null){
 const panel=$('detail');panel.replaceChildren(node('h2',survey?'업무조사 수정':'업무조사 등록'));const form=node('form',undefined,'portal-form');field(form,'업무명','title',survey?.title).required=true;
 const surveyInputs=renderSurveyFields({form,survey,field,node}),{files,filesWrapper}=surveyInputs;
 const hint=node('p');form.append(hint,node('button','조사 내용·첨부파일 저장','primary'));panel.append(form);
 let savedSurvey=survey,pendingSave=null;const uploads=new Map();
 form.onsubmit=async e=>{
  e.preventDefault();if(state.busy||!form.reportValidity())return;const selected=[...files.files];if(selected.some(file=>file.size<1||file.size>10*1024*1024)){message('첨부파일은 각각 10MB 이하로 선택해 주세요.',true);return;}
  const data={center_code:savedSurvey?.center_code??$('center').value,title:form.elements.title.value,details:surveyInputs.details()};
  const key=JSON.stringify([savedSurvey?.id,savedSurvey?.version,data]);if(pendingSave?.key!==key)pendingSave={key,requestId:crypto.randomUUID()};
  setBusy(true);message('조사 내용과 첨부파일을 저장하는 중입니다…');let contentSaved=false;
  try{
   savedSurvey=await api.surveyAction({requestId:pendingSave.requestId,survey:savedSurvey,action:savedSurvey?'edit':'submit',data});pendingSave=null;contentSaved=true;
   for(const file of selected){let upload=uploads.get(file);if(!upload){upload={requestId:crypto.randomUUID(),saved:false};uploads.set(file,upload);}if(upload.saved)continue;hint.textContent=file.name+' 저장 중…';await operationsFiles.upload({kind:'survey',subjectId:savedSurvey.id,requestId:upload.requestId,file});upload.saved=true;}
   state.selected={type:'survey',row:savedSurvey};let refreshFailed=false;try{await loadData();}catch{refreshFailed=true;}render();message('업무조사와 첨부파일을 저장했습니다.'+(refreshFailed?' 목록은 새로고침해 주세요.':''));
  }catch(error){hint.textContent=contentSaved?'조사 내용은 저장되었습니다. 선택한 파일을 유지했으니 다시 저장하면 남은 첨부파일을 이어서 올립니다.':'입력과 선택한 파일을 유지했습니다.';message(error.message||'저장하지 못했습니다. 다시 시도해 주세요.',true);}
  finally{setBusy(false);}
 };
 if(survey)attachments('survey',survey,filesWrapper,{allowUpload:false});
}
function surveyDetail(row,panel){
 panel.append(node('p',centerName(row.center_code)+' · '+surveyStages[row.stage]));const dl=node('dl');for(const [key,label] of surveyFields)if(row.details[key])dl.append(node('dt',label),node('dd',row.details[key]));panel.append(dl);
 if(canWrite(row.center_code,'forms')&&!row.template_id)button('조사 수정',()=>surveyForm(row),panel);
 if(canGenerateSurveyDraft(profile))button('AI 양식 초안 생성',()=>surveyDraft(row,panel),panel);
 if(isHq()){
  const stages=Object.keys(surveyStages),next=stages[stages.indexOf(row.stage)+1];if(next)button(surveyStages[next]+' 기록',()=>surveyAction(row,'stage',{stage:next}),panel);
  if(row.stage==='designed'&&!row.template_id)templateForm(row,panel);
 }
 if(row.template_id)panel.append(node('p','승인 양식이 연결되었습니다. 구축·운영 검증 단계는 실제 확인 후 기록하세요.'));
}
async function surveyDraft(survey,panel){
 if(!canGenerateSurveyDraft(profile))return;
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
 field(form,'업무 마감 (한국시간, 선택)','due_time','','time');
 field(form,'적용 시작일','effective_from',koreaDate(),'date').required=true;
 form.append(node('p','조사 내용을 확인한 뒤 승인하세요. 양식 승인은 구축 완료 기록과 별개입니다.'),node('button','정식 업무 양식 승인','primary'));
 form.onsubmit=e=>{e.preventDefault();const lines=name=>form.elements[name].value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
  const rule={kind:repeat.value};if(rule.kind==='weekdays')rule.days=[1,2,3,4,5,6,7].filter(day=>form.elements['day_'+day].checked);if(rule.kind==='monthly')rule.day=Number(month.value);if(rule.kind==='once')rule.date=once.value;
  const spec={effective_from:form.elements.effective_from.value,fields:lines('fields').map((label,index)=>({key:'field_'+index,label,type:'string',required_on_complete:form.elements.required.checked})),steps:lines('steps').map((label,index)=>({key:'step_'+index,label})),repeat:rule};
  if(form.elements.completion_condition.value.trim())spec.completion_condition=form.elements.completion_condition.value.trim();
  if(rule.kind!=='none')spec.owner_ids=[owner.value];for(const key of ['due_time'])if(form.elements[key].value)spec[key]=form.elements[key].value;
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
async function openNotification(n){try{if(allowed('notifications','edit'))await api.readNotification(n.id);if(n.reason_key?.startsWith('backup:')){state.view='backups';state.selected=null;await refresh();}else if(n.task_id)await openTask(n.task_id);else if(n.incident_id){const {data,error}=await supabase.from('operations_incidents').select('*').eq('id',n.incident_id).single();if(error)throw error;choose('incident',data);}if(allowed('notifications','edit'))n.read_at=new Date().toISOString();$('unread').textContent=state.notifications.filter(n=>!n.read_at).length||'';}catch(error){message(error.message,true);}}
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
 const order=['001','002','gimhae','yangsan'];const centers=[...state.context.centers].sort((a,b)=>{const rank=c=>{const i=order.indexOf(c.code);return i<0?99:i;};return rank(a)-rank(b);});
 document.querySelectorAll('[data-center-view]').forEach(nav=>{nav.replaceChildren();for(const center of centers){const el=node('button',centerName(center.code));el.type='button';el.dataset.view=nav.dataset.centerView;el.dataset.center=center.code;nav.append(el);}if(nav.dataset.centerView==='center'){const incidents=node('button','특이사항');incidents.type='button';incidents.dataset.view='incidents';nav.append(incidents);}if(!centers.length)nav.append(node('p','접근 가능한 센터가 없습니다.'));});
}
async function start(){
 setupPortalSidebar();for(const id of ['task-ticket-dialog','parent-task-dialog'])setupDialogDismiss($(id));$('task-date').value=koreaDate();
 $('task-date').onchange=refresh;$('new-task').onclick=taskCreate;$('issue-task').onclick=issueTaskPicker;document.querySelectorAll('[data-view-control]').forEach(el=>el.onclick=()=>{if(state.busy)return;const key={'task-unit':'unit','task-layout':'layout','task-status':'status'}[el.dataset.viewControl];state[key]=el.dataset.value;if(key==='unit')refresh();else render();});
 $('period-prev').onclick=()=>{$('task-date').value=shiftPeriod($('task-date').value,state.unit,-1);refresh();};$('period-next').onclick=()=>{$('task-date').value=shiftPeriod($('task-date').value,state.unit,1);refresh();};$('period-today').onclick=()=>{$('task-date').value=koreaDate();refresh();};
 $('user').textContent=profile.display_name??profile.email??'';
 try{if(new URLSearchParams(location.search).has('onedrive_state'))await finishOneDrive();state.context=await api.context();state.permissions=await api.permissions();for(const center of state.context.centers){const option=node('option',center.name);option.value=center.code;$('center').append(option);}const requested=new URLSearchParams(location.search).get('center');$('center').value=state.context.centers.some(c=>c.code===requested)?requested:state.context.writable_centers[0]??state.context.centers[0]?.code;
 document.querySelector('[data-view=hq]').hidden=!isHq();$('members-navigation').hidden=!isHq();$('permissions-navigation').hidden=!isHq();document.querySelector('[data-view=briefing]').hidden=!isHq();if(isHq()&&!requested)state.view='hq';
 document.querySelector('[data-view=backups]').hidden=!isHq();
 $('hq-navigation').hidden=!isHq();$('audit-navigation').hidden=!isHq();
 buildCenterNavigation();updateNavigation();const requestedView=new URLSearchParams(location.search).get('view');if(requestedView&&allowed(viewResource(requestedView)))state.view=requestedView;
 if(!allowed(viewResource(state.view),'read',['center','surveys'].includes(state.view)?$('center').value:undefined)){const first=[...document.querySelectorAll('nav button[data-view]')].find(el=>!el.hidden);if(first){state.view=first.dataset.view;if(first.dataset.center)$('center').value=first.dataset.center;}}

 $('center').onchange=()=>{const url=new URL(location.href);url.searchParams.set('center',$('center').value);historyReplace(url);state.selected=null;refresh();};
 $('refresh').onclick=refresh;$('mine').onchange=render;$('completed').onchange=refresh;
 document.querySelectorAll('nav button').forEach(el=>el.onclick=()=>{if(state.busy)return;state.view=el.dataset.view;if(el.dataset.center){$('center').value=el.dataset.center;const url=new URL(location.href);url.searchParams.set('center',el.dataset.center);historyReplace(url);}state.selected=null;if($('task-ticket-dialog').open)$('task-ticket-dialog').close();refresh();});await refresh();
 notificationTimer=setInterval(checkNotifications,30000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkNotifications();});
 addEventListener('pagehide',()=>clearInterval(notificationTimer),{once:true});
 addEventListener('pageshow',event=>{if(event.persisted){clearInterval(notificationTimer);notificationTimer=setInterval(checkNotifications,30000);checkNotifications();}});
 }catch(error){message(['PGRST202','42P01'].includes(error.code)?'업무 포털 서버 구성이 아직 적용되지 않았습니다. 관리자에게 서버 반영을 요청해 주세요.':error.message,true);setBusy(true);}
}
function historyReplace(url){globalThis.history.replaceState(null,'',url.pathname+url.search);}
if(profile){setupPortalMentions({supabase,centerName});await start();}
