export const memberRoleLabels={admin:'관리자 · 배송팀',editor:'센터 업무 담당',viewer:'조회 전용'};
export function renderMembers({members,centers,node,button,field,save,items,panel,centerName}){
 items.replaceChildren();panel.replaceChildren(node('p','멤버를 선택하면 이름·센터·권한을 설정할 수 있습니다.'));
 for(const person of members){const row=button('',()=>edit(person),items,'task-row member-row');row.append(node('strong',person.name),node('small',(memberRoleLabels[person.role]??person.role)+(person.active?'':' · 비활성')),node('small',person.centers.map(centerName).join(', ')||'센터 미배정'));}
 function edit(person){
  panel.replaceChildren(node('h2','멤버 설정'),node('p',person.email??''));const form=node('form',undefined,'portal-form');const name=field(form,'이름','name',person.display_name??'');name.required=true;name.maxLength=100;
  const roles=node('fieldset');roles.append(node('legend','권한'));for(const [value,label] of Object.entries(memberRoleLabels)){const wrap=node('label',label,'member-choice'),radio=node('input');radio.type='radio';radio.name='role';radio.value=value;radio.checked=person.role===value;wrap.prepend(radio);roles.append(wrap);}form.append(roles);
  const group=node('fieldset');group.append(node('legend','소속 센터 · 여러 센터 선택 가능'));for(const center of centers){const el=field(group,centerName(center.code),'center_'+center.code,person.centers.includes(center.code),'checkbox');el.parentElement.classList.add('member-choice');}form.append(group);
  form.append(node('p','관리자는 모든 센터를 관리합니다. 센터 업무 담당은 선택한 센터를 수정하며, 조회 전용은 내용을 확인할 수 있습니다.'),node('button','멤버 설정 저장','primary'));panel.append(form);
  form.onsubmit=e=>{e.preventDefault();if(!form.reportValidity())return;save(person,{name:form.elements.name.value,role:form.elements.role.value,centers:centers.filter(c=>form.elements['center_'+c.code].checked).map(c=>c.code).sort()});};
 }
}
