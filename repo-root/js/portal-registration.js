import {currentTemplates} from './portal-model.js';
import {cadenceLabels} from './portal-designer.js';
import {taskScheduleLabel} from './portal-task-views.js';
export function createRegistrationView({node,button,canWrite,addRow,centerName,customizeTask,surveyForm,retire,onTabChange}){
 return function renderRegistration({tab='templates',center,templates=[],surveys=[],items,actions}){
  const registered=currentTemplates(templates),active=tab==='surveys'?'surveys':'templates';
  const choices=[['templates','등록된 업무',registered.length],['surveys','업무조사',surveys.length]],tabs=node('div',undefined,'registration-tabs');
  tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','업무 등록과 조사 구분');
  items.setAttribute('role','tabpanel');items.setAttribute('aria-labelledby','registration-tab-'+active);
  const switchTab=value=>{onTabChange(value);document.getElementById('registration-tab-'+value)?.focus();};
  for(const [index,[value,title,count]] of choices.entries()){
   const control=button(title+' · '+count,()=>switchTab(value),tabs);
   control.id='registration-tab-'+value;control.setAttribute('role','tab');control.setAttribute('aria-selected',String(value===active));control.setAttribute('aria-controls',items.id);control.tabIndex=value===active?0:-1;
   control.onkeydown=event=>{
    const target=event.key==='ArrowRight'?choices[(index+1)%choices.length][0]:event.key==='ArrowLeft'?choices[(index+choices.length-1)%choices.length][0]:event.key==='Home'?choices[0][0]:event.key==='End'?choices.at(-1)[0]:null;
    if(target){event.preventDefault();switchTab(target);}
   };
  }
  actions.append(tabs);
  const writable=canWrite(center,'forms');
  if(active==='surveys'){
   if(writable)button('업무조사 등록',()=>surveyForm(),actions,'primary');
   surveys.forEach(s=>addRow(s,'survey',items,centerName(s.center_code)));
   if(!surveys.length)items.append(node('p','등록된 업무조사가 없습니다.'));
   return {count:surveys.length,title:'업무조사',description:'조사한 업무 내용과 검토 진행 상태를 확인하세요.'};
  }
  if(writable)button('센터 업무등록',()=>customizeTask(),actions,'primary');
  for(const t of registered){
   const entry=node('div',undefined,'registered-task-row'),info=node('div',undefined,'registered-task-info'),rowActions=node('div',undefined,'registered-task-actions'),spec=t.spec??{};
   if(writable)button(t.title,()=>customizeTask(t),info,'registered-task-title');else info.append(node('strong',t.title,'registered-task-title'));
   info.append(node('small',(cadenceLabels[spec.ui_cadence]??'기존 업무')+taskScheduleLabel(t)+' · 입력 '+(spec.fields?.length??0)+'개'));
   if(writable){
    const edit=button('수정',()=>customizeTask(t),rowActions,'registered-task-edit');edit.setAttribute('aria-label',t.title+' 수정');
    const remove=button('삭제',()=>retire(t),rowActions,'registered-task-delete');remove.setAttribute('aria-label',t.title+' 삭제');
   }
   entry.append(info,rowActions);items.append(entry);
  }
  if(!registered.length)items.append(node('p','등록된 업무가 없습니다.'));
  return {count:registered.length,title:'등록된 업무',description:'센터 업무 양식을 등록·수정하고 실행 주기를 관리하세요.'};
 };
}
