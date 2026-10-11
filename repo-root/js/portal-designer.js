import {koreaDate} from './operations-view.js';
export const cadenceLabels={none:'필요할 때마다',daily:'일일업무',weekly:'주간업무',monthly:'월간업무'};
export function openTaskDesigner({template,center,name,node,button,field,save}){
 const dialog=document.createElement('dialog');dialog.className='task-designer';dialog.setAttribute('aria-label','센터 업무 커스터마이징');document.body.append(dialog);
 const header=node('div',undefined,'parent-dialog-heading');header.append(node('h2',name+' · '+(template?'업무 양식 수정':'센터 업무등록')));button('닫기',()=>dialog.close(),header);dialog.append(header);
 const form=node('form',undefined,'portal-form');dialog.append(form);const spec=template?.spec??{};
 const title=field(form,'업무명','title',template?.title??'');title.required=true;title.maxLength=200;
 field(form,'업무 안내','description',spec.description??'','textarea');
 const label=node('label','업무 주기'),cadence=node('select');cadence.name='cadence';for(const [value,text] of Object.entries(cadenceLabels)){const option=node('option',text);option.value=value;cadence.append(option);}cadence.value=spec.ui_cadence??({daily:'daily',weekdays:'weekly',monthly:'monthly'}[spec.repeat?.kind]??'none');label.append(cadence);form.append(label);
 form.append(node('p','일일은 날짜별, 주간은 월요일부터 일요일까지, 월간은 해당 월에 티켓 1건을 발행합니다. 같은 기간에 다시 누르면 기존 티켓을 엽니다.'));
 field(form,'업무 마감시간 (한국시간, 선택)','due_time',spec.due_time??'','time');
 const fields=node('section',undefined,'designer-fields');fields.append(node('h3','작성할 입력 항목'));form.append(fields);const rows=[];
 function addField(existing={}){
  const row=node('fieldset',undefined,'designer-field');row.append(node('legend','입력 항목'));const name=field(row,'항목 이름','label',existing.label??'');name.required=true;
  const select=node('select'),wrap=node('label','입력 방식');for(const [value,text] of Object.entries({text:'짧은 글',textarea:'긴 글',number:'숫자',checkbox:'체크 여부',date:'날짜',select:'선택 목록'})){const option=node('option',text);option.value=value;select.append(option);}select.value=existing.control??({boolean:'checkbox',number:'number'}[existing.type]??'text');wrap.append(select);row.append(wrap);
  const options=field(row,'선택지 (한 줄에 하나)','options',(existing.options??[]).join('\n'),'textarea');options.parentElement.hidden=select.value!=='select';select.onchange=()=>{options.parentElement.hidden=select.value!=='select';options.required=select.value==='select';};select.onchange();
  const required=field(row,'완료할 때 필수 입력','required',existing.required_on_complete===true,'checkbox');
  const entry={row,name,select,options,required,key:existing.key??'f_'+crypto.randomUUID().replaceAll('-','')};rows.push(entry);button('항목 삭제',()=>{rows.splice(rows.indexOf(entry),1);row.remove();},row);fields.append(row);
 }
 for(const existing of spec.fields??[])addField(existing);button('입력 항목 추가',()=>addField(),fields);
 field(form,'처리 단계 (선택, 한 줄에 하나)','steps',(spec.steps??[]).map(s=>s.label).join('\n'),'textarea');
 field(form,'완료 전 확인 내용 (선택)','completion',spec.completion_condition??'','textarea');
 form.append(node('p','저장하면 이 센터 업무 화면에 버튼이 생깁니다. 양식을 수정해도 이미 발행한 티켓의 입력 항목과 기록은 유지됩니다.'));
 const submit=node('button','저장하고 업무 버튼 생성','primary');form.append(submit);let requestId=null,requestBody=null;
 form.onsubmit=async event=>{
  event.preventDefault();if(!form.reportValidity()||submit.disabled)return;
  const repeat={kind:cadence.value==='weekly'?'weekdays':cadence.value==='none'?'none':cadence.value};if(cadence.value==='weekly')repeat.days=[1];if(cadence.value==='monthly')repeat.day=1;
  const next={manual_issue:true,ui_cadence:cadence.value,effective_from:koreaDate(),description:form.elements.description.value,repeat,fields:rows.map(r=>({key:r.key,label:r.name.value.trim(),type:r.select.value==='number'?'number':r.select.value==='checkbox'?'boolean':'string',control:r.select.value,required_on_complete:r.required.checked,...(r.select.value==='select'?{options:[...new Set(r.options.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))]}:{})})),steps:form.elements.steps.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((label,index)=>({key:'step_'+index,label})),completion_condition:form.elements.completion.value};
  if(form.elements.due_time.value)next.due_time=form.elements.due_time.value;
  const body={center,title:title.value.trim(),spec:next,familyId:template?.family_id??null};const key=JSON.stringify(body);if(requestBody!==key){requestBody=key;requestId=crypto.randomUUID();}
  submit.disabled=true;try{await save({...body,requestId});dialog.close();}catch(error){let hint=form.querySelector('.designer-error');if(!hint){hint=node('p',undefined,'designer-error error');form.append(hint);}hint.textContent=error.message;}finally{submit.disabled=false;}
 };
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();title.focus();
}
