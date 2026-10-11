export function permissionAllowed(context,resource,action='read',center){
 const access=context?.access?.[resource];if(!access)return false;
 return center?(access[action+'_centers']??[]).includes(center):access[action]===true;
}
export function renderPermissions({context,centers,node,button,field,items,panel,centerName,save}){
 items.replaceChildren();panel.replaceChildren(node('p','목록을 선택해 열람·수정 조건을 설정하세요.'));
 items.append(node('p','관리자는 모든 목록에 접근합니다. 수정은 멤버의 기본 역할·센터 권한 안에서 허용됩니다. 선택한 역할 또는 센터 소속 조건 중 하나를 만족하면 허용합니다.'));
 const order=['포털','운영관리 목록','운영 관리','도구'];let section='';for(const config of [...context.rules].sort((a,b)=>order.indexOf(a.section)-order.indexOf(b.section))){if(config.section!==section){section=config.section;items.append(node('h3',section));}const row=button('',()=>edit(config),items,'task-row permission-row');row.append(node('strong',config.title),node('small',config.admin_only?'관리자 전용':'열람: '+summary(config.read_rule)+' · 수정: '+summary(config.write_rule)));}
 function summary(rule){return rule.everyone?'활성 멤버 전체':[(rule.roles??[]).map(r=>({admin:'관리자',editor:'센터 업무 담당',viewer:'조회 전용'})[r]).join(', '),(rule.centers??[]).map(centerName).join(', ')].filter(Boolean).join(' / ')||'관리자만';}
 function edit(config){
  panel.replaceChildren(node('h2',config.title+' 권한'));if(config.admin_only){panel.append(node('p','계정·권한·외부 연결과 전체 원본을 관리하는 이 목록은 관리자 전용입니다.'));return;}
  const form=node('form',undefined,'portal-form permission-form'),columns=node('div',undefined,'permission-columns');
  for(const [key,title] of [['read_rule','열람'],['write_rule','수정']]){const rule=config[key],group=node('fieldset');group.append(node('legend',title+' 허용 조건'));
   const everyone=field(group,'활성 멤버 전체',key+'_everyone',rule.everyone,'checkbox');everyone.parentElement.classList.add('member-choice');if(key==='write_rule'&&!['incidents','notifications'].includes(config.resource))group.append(node('small','조회 전용 멤버는 수정할 수 없습니다.'));
   const admin=field(group,'관리자 · 항상 허용',key+'_admin',true,'checkbox');admin.disabled=true;admin.parentElement.classList.add('member-choice');
   for(const [role,label] of [['editor','센터 업무 담당'],['viewer','조회 전용']]){const el=field(group,label,key+'_'+role,rule.roles.includes(role),'checkbox');el.parentElement.classList.add('member-choice');if(key==='write_rule'&&!['incidents','notifications'].includes(config.resource)&&role==='viewer')el.disabled=true;}
   const members=node('fieldset');members.append(node('legend','특정 센터에 소속된 멤버'));for(const center of centers){const el=field(members,centerName(center.code),key+'_center_'+center.code,rule.centers.includes(center.code),'checkbox');el.parentElement.classList.add('member-choice');}group.append(members);
   const scope=node('fieldset');scope.append(node('legend','자료 범위'));for(const [value,label] of [['all','열람 가능한 전체 센터'],['own','본인 소속 센터 자료만']]){const wrap=node('label',label,'member-choice'),input=node('input');input.type='radio';input.name=key+'_scope';input.value=value;input.checked=rule.scope===value;wrap.prepend(input);scope.append(wrap);}group.append(scope);columns.append(group);
   const choices=[...group.querySelectorAll('input[type=checkbox]')].filter(el=>el!==everyone&&!el.name.endsWith('_admin')&&!el.name.endsWith('_viewer')||el.name.endsWith('_viewer')&&key==='read_rule');const sync=()=>choices.forEach(el=>el.disabled=everyone.checked);everyone.onchange=sync;sync();
  }form.append(columns,node('p',config.resource==='incidents'?'특이사항의 수정 조건은 처리완료·재개에도 적용됩니다. 내용 작성은 센터 담당 권한이 필요합니다.':'수정 허용 조건에 맞아도 열람 권한이 없으면 수정할 수 없습니다.'),node('button','권한 설정 저장','primary'));panel.append(form);
  form.onsubmit=e=>{e.preventDefault();const value=key=>({everyone:form.elements[key+'_everyone'].checked,roles:['admin',...['editor','viewer'].filter(role=>form.elements[key+'_'+role].checked&&!form.elements[key+'_'+role].disabled)],centers:centers.filter(c=>form.elements[key+'_center_'+c.code].checked).map(c=>c.code).sort(),scope:form.elements[key+'_scope'].value});save(config,{read:value('read_rule'),write:value('write_rule')});};
 }
}
