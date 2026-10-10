import {requireAuth} from './auth.js';
import {supabase} from './supabase.js';
import {ENV} from './config.js';
import {createOperationsApi} from './operations-api.js';
import {statusLabels,actionLabels,koreaDate,dateRange,filterOperations,exportRows} from './operations-view.js';
const $=id=>document.getElementById(id), form=$('filters'), api=createOperationsApi(supabase);
const profile=await requireAuth();
if(profile) await start();
async function start(){
 $('user').textContent=profile.display_name||profile.email||'';
 let view='tasks',rows=[],selected=null,sequence=0,busy=false,pending=null,loadedFilters=null;
 const initial=dateRange('day');form.elements.from.value=initial.from;form.elements.through.value=initial.through;
 const center=new URLSearchParams(location.search).get('center');if(['ansan','pyeongtaek','001','002'].includes(center))form.elements.center.value=['pyeongtaek','002'].includes(center)?'002':'001';
 function message(value,error=false){$('message').textContent=value;$('message').classList.toggle('error',error);}
 function controls(disabled){busy=disabled;form.querySelectorAll('button').forEach(b=>b.disabled=disabled);$('refresh').disabled=disabled;document.querySelectorAll('nav button').forEach(b=>b.disabled=disabled);}
 function filters(){return Object.fromEntries(new FormData(form));}
 function time(value){return value?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)):'—';}
 function cell(tr,value,className){const td=document.createElement('td');td.textContent=value??'—';if(className)td.className=className;tr.append(td);return td;}
 function badge(status){const span=document.createElement('span');span.className='badge '+(['completed','resolved'].includes(status)?'done':['open','in_progress'].includes(status)?'open':'');span.textContent=statusLabels[status]??status;return span;}
 function showList(){
  $('list-title').textContent={tasks:'업무 현황',daily:'실제 처리 기록',incidents:'특이사항'}[view];$('count').textContent=`${rows.length}건`;
  $('head').replaceChildren();const head=document.createElement('tr');
  for(const title of view==='daily'?['처리 시각','업무','처리','정산방식']:view==='incidents'?['발생일','특이사항','상태','HQ 지원']:['업무일','업무','상태','정산방식','CJ 공유 마감']){const th=document.createElement('th');th.textContent=title;head.append(th);} $('head').append(head);$('rows').replaceChildren();
  if(!rows.length){const tr=document.createElement('tr');const td=cell(tr,'조회 조건에 해당하는 기록이 없습니다.','empty');td.colSpan=head.children.length;$('rows').append(tr);return;}
  for(const row of rows){const tr=document.createElement('tr');if(selected?.id===row.id)tr.className='selected';cell(tr,view==='daily'?time(row.occurred_at):view==='incidents'?time(row.created_at):row.work_date);
   const title=cell(tr,'','title'),button=document.createElement('button');button.className='row-link';button.textContent=row.title;button.onclick=()=>select(row);title.append(button);
   if(view==='daily'){cell(tr,actionLabels[row.action]??row.action);cell(tr,row.inputs?.['정산방식']||'—');}
   else{cell(tr,'').append(badge(row.status));cell(tr,view==='incidents'?({none:'없음',requested:'요청',supporting:'지원중',done:'지원완료'}[row.support_state]??row.support_state):row.inputs?.['정산방식']||'—');if(view==='tasks')cell(tr,time(row.cj_share_due_at));}
   $('rows').append(tr);
  }
 }
 function info(dl,label,value){if(value===null||value===undefined||value==='')return;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);dl.append(dt,dd);}
 function select(row){
  selected=row;showList();const panel=$('detail');panel.replaceChildren();const h=document.createElement('h2');h.textContent=row.title;panel.append(h,badge(row.status));const dl=document.createElement('dl');
  info(dl,'센터',{ '001':'안산','002':'평택'}[row.center_code]);info(dl,'업무일',row.work_date??row.report_date);info(dl,'처리 시각',row.occurred_at?time(row.occurred_at):null);info(dl,'배송 마감',row.due_at?time(row.due_at):null);info(dl,'CJ 공유 마감',row.cj_share_due_at?time(row.cj_share_due_at):null);
  for(const key of ['기사명','차량번호','코스·납품처','톤수','사유','대차기사명','대차차량번호','정산방식','발생내용'])info(dl,key,row.inputs?.[key]);
  info(dl,'실제 조치',row.action_note);info(dl,'인계 메모',row.handoff_memo);panel.append(dl);
  if(view==='incidents'){
   const actions=document.createElement('div');actions.className='actions';const change=document.createElement('button');change.textContent=row.status==='open'?'해결 처리':'재개';change.onclick=()=>incidentAction(row,row.status==='open'?'resolve':'reopen',{});actions.append(change);panel.append(actions);
   if(profile.role==='admin'&&row.status==='open'){
    const support=document.createElement('form');support.id='support-form';const label=document.createElement('label');label.textContent='실제로 수행한 HQ 조치';const note=document.createElement('textarea');note.required=true;note.maxLength=5000;label.append(note);support.append(label);
    const doneLabel=document.createElement('label');doneLabel.className='check';const done=document.createElement('input');done.type='checkbox';doneLabel.append(done,document.createTextNode('HQ 지원 완료'));support.append(doneLabel);const submit=document.createElement('button');submit.className='primary';submit.textContent='조치 기록';support.append(submit);support.onsubmit=e=>{e.preventDefault();incidentAction(row,'support',{note:note.value.trim(),done:done.checked});};panel.append(support);const help=document.createElement('p');help.className='note';help.textContent='지원 완료와 사건 해결은 별도로 기록됩니다.';panel.append(help);
   }
  }
 }
 async function incidentAction(row,action,data){
  if(busy)return;const key=JSON.stringify([row.id,row.version,action,data]);if(pending?.key!==key)pending={key,requestId:crypto.randomUUID()};controls(true);$('detail').querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await api.incidentAction({requestId:pending.requestId,incident:row,action,data});pending=null;await load();message('처리 내용이 저장됐습니다.');}
  catch(error){message(error.message||'저장하지 못했습니다. 다시 시도해 주세요.',true);}
  finally{controls(false);$('detail').querySelectorAll('button').forEach(b=>b.disabled=false);}
 }
 async function load(){
  const current=++sequence,f=filters();if(!f.from||!f.through||f.from>f.through){message('시작일과 종료일을 확인해 주세요.',true);return;}controls(true);message('기록을 불러오는 중입니다…');
  try{
   const result=view==='daily'?await api.dailyLog({center:f.center,from:f.from,through:f.through}):view==='incidents'?await api.incidents({center:f.center,includeResolved:!f.unfinished}):await api.tasks({center:f.center,from:f.from,through:f.through,includeCompleted:!f.unfinished});
   if(current!==sequence)return;loadedFilters=f;rows=filterOperations(result,f);const id=selected?.id;selected=rows.find(r=>r.id===id)??null;showList();if(selected)select(selected);else{$('detail').replaceChildren();const p=document.createElement('p');p.textContent='목록에서 항목을 선택하면 상세 내용을 볼 수 있습니다.';$('detail').append(p);}
   message(view==='tasks'?'과거 미완료 업무도 함께 표시합니다.':view==='daily'?'업무·특이사항의 실제 처리 시각을 기준으로 조회합니다.':'미해결 건은 기간과 관계없이 표시합니다.');
  }catch(error){if(current===sequence){rows=[];selected=null;showList();$('detail').replaceChildren();message(error.message||'기록을 불러오지 못했습니다.',true);}}
  finally{if(current===sequence)controls(false);}
 }
 form.onsubmit=e=>{e.preventDefault();load();};$('refresh').onclick=load;
 form.elements.period.onchange=()=>{if(form.elements.period.value==='custom')return;const range=dateRange(form.elements.period.value,koreaDate());form.elements.from.value=range.from;form.elements.through.value=range.through;};
 for(const name of ['from','through'])form.elements[name].onchange=()=>{form.elements.period.value='custom';};
 document.querySelectorAll('nav button').forEach(button=>button.onclick=()=>{view=button.dataset.view;selected=null;document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));form.elements.unfinished.disabled=view==='daily';load();});
 $('export').onclick=async()=>{
  if(!rows.length){message('다운로드할 기록이 없습니다.');return;}if(!globalThis.ExcelJS){message('엑셀 도구를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.',true);return;}
  controls(true);try{const data=exportRows(rows,view),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('운영기록');sheet.columns=Object.keys(data[0]).map(header=>({header,key:header,width:header==='업무'||header==='실제 조치'?30:18}));sheet.addRows(data);sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:sheet.columnCount}};sheet.getRow(1).font={bold:true};const blob=new Blob([await book.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`운영기록_${loadedFilters.center === '001' ? '안산' : '평택'}_${view}_${loadedFilters.from}_${loadedFilters.through}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);message(`현재 조회된 ${data.length}건을 다운로드했습니다.`);}catch(error){message(error.message,true);}finally{controls(false);}
 };
 if(ENV==='prod'){message('운영 전환 전인 시험 기능입니다.',true);controls(true);return;}
 await load();
}
