export function subjectLabel(subject,centerName){
 if(!subject)return '미지정';
 if(subject.kind==='center')return centerName(subject.center_code);
 if(subject.kind==='role')return subject.name;
 const properties=[...(subject.centers??[]).map(centerName),...(subject.role==='admin'?['배송팀']:[])];return subject.name+(properties.length?' · '+properties.join(', '):'');
}
export function renderParticipants({task,panel,options,node,button,field,centerName,writable,loadOptions,save,stash}){
 const section=node('section',undefined,'task-participants'),dl=node('dl');section.append(node('h3','업무 관계'),dl);panel.append(section);
 const person=id=>options.find(s=>s.user_id===id),subject=id=>options.find(s=>s.id===id),label=s=>subjectLabel(s,centerName);
 for(const [name,s] of [['발행자',person(task.created_by)],['처리 담당',subject(task.handler_subject_id)??person(task.owner_id)]])dl.append(node('dt',name),node('dd',label(s)));
 if(task.completed_by)dl.append(node('dt','완료 처리자'),node('dd',label(person(task.completed_by))));
 if(task.handoff_from_subject_id){dl.append(node('dt','인계자'),node('dd',label(subject(task.handoff_from_subject_id))),node('dt','인계받는 담당'),node('dd',label(subject(task.handoff_to_subject_id))),node('dt','인계 기록자'),node('dd',label(person(task.handoff_actor_id))));}
 if(!writable)return;const actions=node('div',undefined,'participant-actions');button('처리 담당 지정',()=>edit(false),actions);button('인계',()=>edit(true),actions);section.append(actions);
 async function edit(handoff){
  stash();section.querySelector('.participant-editor')?.remove();const form=node('form',undefined,'portal-form participant-editor');section.append(form);form.append(node('p','대상을 불러오는 중입니다…'));
  try{
   const choices=await loadOptions(task.center_code);if(!form.isConnected)return;form.replaceChildren();
   function choose(name,title,selected){const group=node('fieldset');group.append(node('legend',title));const tabs=node('div',undefined,'view-buttons'),list=node('div',undefined,'subject-options');group.append(tabs,list);let kind=choices.find(s=>s.id===selected)?.kind??'person';let value=selected??null;
    function render(){list.replaceChildren();tabs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===kind)));const visible=choices.filter(s=>s.kind===kind&&s.eligible);for(const s of visible){const wrap=node('label',label(s),'member-choice'),radio=node('input');radio.type='radio';radio.name=name;radio.value=s.id;radio.checked=value===s.id;radio.onchange=()=>value=s.id;wrap.prepend(radio);list.append(wrap);}if(!visible.length)list.append(node('p','선택할 수 있는 대상이 없습니다.'));}
    for(const [key,text] of [['person','사람'],['center','센터'],['role','역할']]){const b=button(text,()=>{if(kind!==key)value=null;kind=key;render();},tabs);b.dataset.kind=key;}render();form.append(group);return ()=>value;
   }
   const current=task.handler_subject_id??choices.find(s=>s.user_id===task.owner_id)?.id;
   const handler=handoff?null:choose('handler','처리 담당',current),from=handoff?choose('from','인계하는 담당',current):null,to=handoff?choose('to','인계받는 담당',null):null;
   if(handoff)field(form,'인계 메모','memo','','textarea');form.append(node('button',handoff?'인계 저장':'처리 담당 저장','primary'));
   form.onsubmit=e=>{e.preventDefault();const data=handoff?{handler:task.handler_subject_id??null,from:from(),to:to(),memo:form.elements.memo.value}:{handler:handler(),from:null,to:null,memo:''};if(!data.handler&&!data.to||handoff&&(!data.from||!data.to)){hint('대상을 선택하세요.');return;}save(data);};
  }catch(error){hint(error.message);}
  function hint(text){let el=form.querySelector('.error');if(!el){el=node('p',undefined,'error');form.append(el);}el.textContent=text;}
 }
}
