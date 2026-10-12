import {koreaDate,actionLabels} from './operations-view.js';
import {periodBounds,taskPeriod} from './portal-task-views.js';
import {groupHistory,historyStatuses,visibleHistoryEvents} from './portal-history-model.js';
export function createPortalHistory({api,node,button,field,centerName,stamp,message,allowed,openRecord}){
 const initial=periodBounds(koreaDate(),'month'),saved={center:'',from:initial.from,through:initial.through,status:''};let generation=0;
 return function renderHistory(centers){
  const ticket=++generation,items=document.getElementById('items'),panel=document.getElementById('detail'),actions=document.getElementById('quick-actions');
  const authorized=new Set(centers.filter(c=>allowed('history','read',c.code)).map(c=>c.code));
  if(saved.center&&!authorized.has(saved.center))saved.center='';
  items.replaceChildren();actions.replaceChildren();panel.replaceChildren(node('h2','처리 기록'),node('p','업무를 펼치면 등록·수정·완료 이력을 볼 수 있습니다.'));
  document.getElementById('list-title').textContent='업무별 처리 기록';document.getElementById('count').textContent='';
  const form=node('form',undefined,'portal-form history-filters'),center=node('select'),label=node('label','센터');
  center.setAttribute('aria-label','처리 기록 센터');const all=node('option','모든 센터');all.value='';center.append(all);
  for(const c of centers.filter(c=>authorized.has(c.code))){const option=node('option',centerName(c.code));option.value=c.code;center.append(option);}
  center.value=saved.center;label.append(center);form.append(label);
  const from=field(form,'조회 시작일','from',saved.from,'date'),through=field(form,'조회 종료일','through',saved.through,'date');from.required=through.required=true;
  const status=node('select'),statusLabel=node('label','상태');status.setAttribute('aria-label','처리 기록 상태');const any=node('option','전체');any.value='';status.append(any);
  for(const [value,title] of Object.entries(historyStatuses)){const option=node('option',title);option.value=value;status.append(option);}status.value=saved.status;statusLabel.append(status);form.append(statusLabel);actions.append(form);
  const periods=node('div',undefined,'view-buttons');for(const [unit,title] of [['day','일'],['week','주'],['month','월']])button(title,()=>{const range=periodBounds(koreaDate(),unit);from.value=range.from;through.value=range.through;load();},periods);actions.append(periods);
  let request=0,loaded=null;
  function draw(){
   if(!loaded)return;
   const rows=groupHistory({...loaded,...saved}).filter(r=>authorized.has(r.center_code));
   items.replaceChildren();panel.replaceChildren(node('h2','처리 기록'),node('p','업무를 펼치면 등록·수정·완료 이력을 볼 수 있습니다.'));
   document.getElementById('count').textContent=rows.length+'건';
   for(const row of rows){
    const item=node('details',undefined,'history-task'),summary=node('summary',undefined,'task-row history-record'),body=node('div',undefined,'history-task-events');
    summary.append(node('span',centerName(row.center_code),'center-property'),node('strong',row.title??'업무'),node('small',row.kind==='task'?taskPeriod(row):'특이사항 · '+stamp(row.created_at)),node('span',historyStatuses[row.state],'badge status-'+row.state));
    item.append(summary,body);items.append(item);
    let fetched=false;
    item.addEventListener('toggle',async()=>{
     if(!item.open)return;show(row);if(fetched)return;
     fetched=true;body.replaceChildren(node('p','처리 기록을 불러오는 중입니다…'));
     try{
      const events=visibleHistoryEvents(await api.events(row.kind==='task'?{taskId:row.id}:{incidentId:row.id}));
      if(generation!==ticket||!item.isConnected)return;
      body.replaceChildren();
      for(const event of [...events].sort((a,b)=>String(a.occurred_at).localeCompare(String(b.occurred_at))||String(a.id).localeCompare(String(b.id),undefined,{numeric:true}))){
       const entry=node('div',undefined,'history-entry'),data=event.request_body?.data??{};
       entry.append(node('strong',(actionLabels[event.action]??event.action).replaceAll('HQ','배송팀')),node('small',stamp(event.occurred_at)));
       for(const note of [data.note,data.memo,data.reason,event.request_body?.memo])if(note)entry.append(node('p',String(note)));
       body.append(entry);
      }
      if(!events.length)body.append(node('p','등록된 처리 기록이 없습니다.'));
     }catch(error){fetched=false;if(item.isConnected)body.replaceChildren(node('p',error.message||'처리 기록을 불러오지 못했습니다.','error'));}
    });
   }
   if(!rows.length)items.append(node('p','조회 조건에 해당하는 업무가 없습니다.'));
  }
  async function load(){
   if(!form.reportValidity())return;if(from.value>through.value){message('조회 시작일과 종료일을 확인해 주세요.',true);return;}
   Object.assign(saved,{center:center.value,from:from.value,through:through.value,status:status.value});const current=++request;form.setAttribute('aria-busy','true');
   try{const data=await api.historyRecords({...saved});if(generation!==ticket||request!==current||!form.isConnected)return;loaded=data;draw();}
   catch(error){if(generation===ticket&&request===current)message(error.message||'처리 기록을 불러오지 못했습니다.',true);}
   finally{if(request===current)form.removeAttribute('aria-busy');}
  }
  function show(row){
   panel.replaceChildren(node('h2',row.title??'업무'));const dl=node('dl');panel.append(dl);
   const info=(label,value)=>{if(value!=null&&value!=='')dl.append(node('dt',label),node('dd',String(value)));};
   info('센터',centerName(row.center_code));info('현재 상태',historyStatuses[row.state]);if(row.kind==='task')info('업무일',taskPeriod(row));
   for(const [key,value] of Object.entries(row.inputs??{}))if(typeof value!=='object')info(key==='work_note'?'업무 내용':key,value);
   button(row.kind==='incident'?'특이사항 열기':'업무 열기',()=>openRecord(row.kind,row.id),panel,'primary');
  }
  status.onchange=()=>{saved.status=status.value;if(loaded)draw();else load();};
  from.onchange=through.onchange=center.onchange=load;form.onsubmit=e=>{e.preventDefault();load();};load();
 };
}
