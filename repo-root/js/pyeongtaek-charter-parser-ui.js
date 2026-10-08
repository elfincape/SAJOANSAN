import { requireRole } from './auth.js';
import { decorateCenterLinks,forceCenterSelectionFromUrl,mountHeaderCenterSwitcher,requireSelectedCenter,withCenterParam } from './center.js';
import { confirmDialog } from './ui.js';
import { FIELDS,clone,parseNormalizedSheet,normalizeValue,updateField,activeIssues,calculatedStops,makeArchive,readArchive,horizontalData,buildNormalizedWorkbook,routingSummary } from './pyeongtaek-charter-model.js';
import { loadCharterTrips,existingVersions,saveCharterTrips,listCharterArchives,purgeCharterMonth } from './pyeongtaek-charter-db.js';
import { charterOneDrive } from './pyeongtaek-charter-onedrive.js';
const $=id=>document.getElementById(id),PAGE=50;
let center,profile,source,trips=[],versions=new Map(),origin='upload',page=0,fileRevision=0,editing=null,archives=[],busy=false,dirty=false,dirtyIds=new Set();
const number=value=>value==null?'빈칸':Number(value).toLocaleString('ko-KR');
function message(text,error=false){$('status').textContent=text;$('status').className=error?'text-sm text-red-300':'text-sm text-zinc-300';}
async function task(action){
 if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{await action();}catch(error){message(error.message||String(error),true);}
 finally{busy=false;enable();}
}
function enable(){
 if(busy){document.querySelectorAll('button').forEach(b=>b.disabled=true);return;}
 document.querySelectorAll('#trip-table button,#warning-list button').forEach(b=>b.disabled=false);
 for(const id of ['parse-btn'])$(id).disabled=!source;
 for(const id of ['db-save','download-btn','json-export','preview-toggle'])$(id).disabled=!visible().length;
 for(const id of ['db-load','archive-refresh','onedrive-open','filter-reset'])$(id).disabled=false;
 for(const id of ['onedrive-config','archive-save'])$(id).disabled=profile?.role!=='admin';
 $('archive-read').disabled=!$('archive-list').value;$('archive-purge').disabled=profile?.role!=='admin'||!selectedArchive()||!!selectedArchive()?.purged_at;
 $('prev-page').disabled=page===0;$('next-page').disabled=(page+1)*PAGE>=visible().length;
 $('edit-cancel').disabled=false;$('edit-form').querySelector('button[type=submit]').disabled=false;
}
function visible(){
 const from=$('from-date').value,to=$('to-date').value,query=$('customer-filter').value.trim().toLowerCase(),course=$('course-filter').value.trim().toLowerCase();
 return trips.filter(t=>(!t.date||((!from||t.date>=from)&&(!to||t.date<=to)))&&(!course||[t.course,t.vehicleSequence].some(v=>String(v||'').toLowerCase().includes(course)))&&(!$('issues-only').checked||activeIssues(t).length)&&(!query||t.deliveries.some(d=>[d.name,d.code,d.customer].some(v=>String(v||'').toLowerCase().includes(query)))));
}
function cellRow(parent,values,tag='td'){
 const row=document.createElement('tr');for(const value of values){const cell=document.createElement(tag);if(value instanceof Node)cell.append(value);else cell.textContent=value??'';row.append(cell);}parent.append(row);return row;
}
function showTrips(next,nextOrigin,nextVersions=new Map()){
 trips=next;origin=nextOrigin;versions=nextVersions;page=0;dirty=false;dirtyIds.clear();$('preview-wrap').hidden=true;render();
}
function render(){
 const shown=visible(),query=$('customer-filter').value,s=routingSummary(shown,query);
 $('summary').replaceChildren();for(const text of ['운행 '+shown.length+'건','냉동 '+number(s.frozen),'냉장 '+number(s.chilled),'총 수량 '+number(s.quantity),'납품일 평균 '+number(s.average)]){const box=document.createElement('span');box.className='metric';box.textContent=text;$('summary').append(box);}
 $('analysis').textContent='요일별 운행: '+['일','월','화','수','목','금','토'].map((day,i)=>day+' '+s.weekdays[i]).join(' · ')+(query?' | 함께 간 거래처: '+(s.companions.slice(0,10).map(([name,count])=>name+' '+count+'회').join(', ')||'없음'):'');
 const issues=shown.flatMap(t=>activeIssues(t).map(i=>({trip:t,...i})));$('warnings').hidden=!issues.length;$('warning-count').textContent='확인 필요 '+issues.length+'건';$('warning-list').replaceChildren();
 for(const issue of issues){const li=document.createElement('li');li.textContent=(issue.trip.date||'일자 미정')+' / '+(issue.trip.course||'코스 미정')+' / '+issue.cell+' '+issue.message;const button=document.createElement('button');button.className='btn btn-ghost text-xs ml-2';button.textContent='수정';button.onclick=()=>editTrip(issue.trip.id);li.append(button);$('warning-list').append(li);}
 const body=$('trip-table').querySelector('tbody');body.replaceChildren();
 for(const t of shown.slice(page*PAGE,(page+1)*PAGE)){const button=document.createElement('button');button.textContent='수정';button.className='btn btn-ghost';button.onclick=()=>editTrip(t.id);cellRow(body,[t.date||'',(t.course||'')+' / '+(t.vehicleSequence||''),(t.vehicleNumber||'')+' / '+(t.tons??''),t.driver,t.deliveries.map(d=>d.name||'(빈칸)').join(', '),calculatedStops(t),activeIssues(t).length,button]);}
 $('page-info').textContent=shown.length?(page+1)+' / '+Math.ceil(shown.length/PAGE)+' 페이지 · '+(origin==='db'?'DB':origin==='archive'?'보관본':'업로드')+(dirty?' · 미저장 수정 있음':''):'데이터가 없습니다.';
 if(!$('preview-wrap').hidden)renderPreview();enable();
}
function renderPreview(){
 const {headers,rows}=horizontalData(visible());const head=$('preview').querySelector('thead'),body=$('preview').querySelector('tbody');head.replaceChildren();body.replaceChildren();
 cellRow(head,headers.map((v,i)=>XLSX.utils.encode_col(i)+' · '+v),'th');
 for(const row of rows.slice(page*PAGE,(page+1)*PAGE))cellRow(body,row);
}
function inputFor(target,field){
 const [col,key,label,kind]=field,input=document.createElement('input');input.className='app-input';input.dataset.field=key;input.dataset.delivery=target.id&&target.stopId?target.id:'';
 input.type=kind==='number'?'number':kind==='date'?'date':'text';if(kind==='number'){input.step='any';input.min='0';}
 input.value=target[key]??'';input.setAttribute('aria-label',col+'열 '+label);return input;
}
function editTrip(id){
 if(busy)return;
 const trip=trips.find(t=>t.id===id);if(!trip)return;editing=clone(trip);$('edit-error').textContent='';
 $('edit-fields').replaceChildren();
 for(const field of FIELDS.filter(f=>f[4]==='trip')){const label=document.createElement('label'),span=document.createElement('span');span.className='app-label';span.textContent=field[0]+' · '+field[2];label.append(span,inputFor(editing,field));$('edit-fields').append(label);}
 const fields=FIELDS.filter(f=>f[4]==='delivery'),head=$('edit-deliveries').querySelector('thead'),body=$('edit-deliveries').querySelector('tbody');head.replaceChildren();body.replaceChildren();cellRow(head,['원본 행',...fields.map(f=>f[0]+' · '+f[2])],'th');
 for(const d of editing.deliveries)cellRow(body,[d.sourceRow,...fields.map(f=>inputFor(d,f))]);
 $('edit-issues').replaceChildren();editing.issues.forEach((issue,index)=>{if(issue.resolved)return;const label=document.createElement('label');label.className='cb issue';const box=document.createElement('input');box.type='checkbox';box.dataset.issue=index;label.append(box,document.createTextNode(issue.cell+' '+issue.message+' (빈칸 유지 확인)'));$('edit-issues').append(label);});
 $('edit-dialog').showModal();
}
function applyEdit(event){
 event.preventDefault();
 try{
  const next=clone(editing);
  for(const input of $('edit-form').querySelectorAll('[data-field]')){
   const target=input.dataset.delivery?next.deliveries.find(d=>d.id===input.dataset.delivery):next;
   const field=FIELDS.find(f=>f[1]===input.dataset.field);
   const value=normalizeValue(input.value,field[3]);
   if(String(target[input.dataset.field]??'')!==String(value??''))updateField(next,input.dataset.delivery||null,input.dataset.field,input.value);
  }
  for(const box of $('edit-form').querySelectorAll('[data-issue]'))if(box.checked)next.issues[Number(box.dataset.issue)].resolved=true;
  trips=trips.map(t=>t.id===next.id?next:t);dirty=true;dirtyIds.add(next.id);$('edit-dialog').close();render();message('수정을 적용했습니다. DB 저장 버튼으로 저장해 주세요.');
 }catch(error){$('edit-error').textContent=error.message;}
}
async function replaceAllowed(){return !dirty||await confirmDialog('저장하지 않은 수정이 있습니다. 다른 데이터를 불러오시겠습니까?');}
async function loadFile(){
 const revision=++fileRevision;source=null;$('source-sheet').replaceChildren();enable();
 const file=$('source-file').files[0];if(!file)return;
 try{
  if(!/\.(xlsx|xls)$/i.test(file.name)||file.size>20*1024*1024)throw new Error('20MB 이하 .xlsx/.xls 파일을 선택해 주세요.');
  const bytes=await file.arrayBuffer();if(revision!==fileRevision)return;
  const wb=XLSX.read(bytes,{type:'array',cellDates:false,cellNF:true});if(!wb.SheetNames.length)throw new Error('시트가 없습니다.');
  source={workbook:wb,name:file.name};for(const name of wb.SheetNames)$('source-sheet').add(new Option(name,name));$('source-sheet').disabled=false;enable();message('파일을 읽었습니다. 시트를 선택하고 파싱을 실행하세요.');
 }catch(error){message(error.message,true);}
}
async function parseFile(){
 if(!source||!await replaceAllowed())return;
 const next=parseNormalizedSheet(source.workbook.Sheets[$('source-sheet').value],XLSX,{centerCode:center.code,sourceName:source.name,sheetName:$('source-sheet').value,year:Number($('source-year').value),date1904:!!source.workbook.Workbook?.WBProps?.date1904});
 showTrips(next,'upload');message(next.length+'운행을 파싱했습니다. 확인 필요 항목을 수정하거나 DB에 저장하세요.');
}
async function loadDB(){
 if(!await replaceAllowed())return;
 if($('from-date').value&&$('to-date').value&&$('from-date').value>$('to-date').value)throw new Error('조회 기간을 확인해 주세요.');
 const rows=await loadCharterTrips(center.code,{from:$('from-date').value,to:$('to-date').value});
 const next=readArchive({schemaVersion:2,centerCode:center.code,trips:rows.map(r=>r.payload)},center.code);
 showTrips(next,'db',new Map(rows.map(r=>[r.id,r.version])));message('DB '+next.length+'운행을 불러왔습니다.');
}
async function saveDB(){
 const next=visible();let expected=versions;
 if(origin!=='db'){
  expected=await existingVersions(center.code,next.map(t=>t.id));const count=expected.size;
  if(count&&!await confirmDialog('동일 운행ID '+count+'건을 갱신합니다. 저장하시겠습니까?'))return;
 }
 const result=await saveCharterTrips(center.code,next,expected);for(const row of result)versions.set(row.id,row.version);
 origin='db';for(const t of next)dirtyIds.delete(t.id);dirty=dirtyIds.size>0;render();message('DB에 '+result.length+'운행을 저장했습니다.');
}
function downloadJson(){
 const blob=new Blob([JSON.stringify(makeArchive(visible(),center.code),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='용차_'+center.code+'_'+($('archive-month').value||'조회')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importJson(){
 const file=$('json-file').files[0];if(!file)return;if(!await replaceAllowed())return;
 if(file.size>20*1024*1024)throw new Error('20MB 이하 JSON 파일을 선택해 주세요.');
 const next=readArchive(JSON.parse(await file.text()),center.code);showTrips(next,'archive');message('JSON '+next.length+'운행을 불러왔습니다.');
}
function selectedArchive(){return archives.find(a=>a.id===$('archive-list').value);}
async function refreshArchives(){
 archives=await listCharterArchives(center.code);$('archive-list').replaceChildren();
 for(const a of archives)$('archive-list').add(new Option(a.month+' · '+a.record_count+'건 · '+a.verified_at+(a.purged_at?' · DB 정리 완료':''),a.id));
 enable();message('보관 목록을 갱신했습니다.');
}
async function configureDrive(){
 await charterOneDrive.configure(center.code,$('onedrive-url').value.trim());localStorage.setItem('sajo.charter.folder.'+center.code,$('onedrive-url').value.trim());$('onedrive-status').textContent='현재 센터의 저장 폴더가 연결되었습니다.';message('OneDrive 폴더를 연결했습니다.');
}
async function archiveMonth(){
 if(dirty)throw new Error('화면의 수정 내용을 DB에 먼저 저장해 주세요.');
 const month=$('archive-month').value;if(!month)throw new Error('보관할 월을 선택해 주세요.');
 if(!await confirmDialog(month+'월 DB 전체를 OneDrive JSON으로 보관하고 검증합니다. 진행하시겠습니까?'))return;
 const result=await charterOneDrive.archive(center.code,month);await refreshArchives();$('archive-list').value=result.id;message(month+'월 '+result.count+'운행을 OneDrive에 보관하고 검증했습니다.');enable();
}
async function readDrive(){
 if(!selectedArchive()||!await replaceAllowed())return;
 const json=await charterOneDrive.read(center.code,selectedArchive().id),next=readArchive(json,center.code);
 showTrips(next,'archive');message('OneDrive 보관본 '+next.length+'운행을 불러왔습니다.');
}
async function purgeMonth(){
 const archive=selectedArchive();if(!archive)return;
 if(dirty)throw new Error('화면의 미저장 수정을 먼저 저장해 주세요.');
 if(!await confirmDialog(archive.month+'월 '+archive.record_count+'운행을 Supabase에서 삭제합니다. 검증된 OneDrive JSON은 유지됩니다.',{danger:true,okText:'DB 정리'}))return;
 const removed=await purgeCharterMonth(archive.id);trips=trips.filter(t=>!t.date?.startsWith(archive.month));render();await refreshArchives();message('OneDrive 보관본을 유지하고 DB '+removed+'운행을 정리했습니다.');
}
async function initialize(){
 profile=await requireRole('editor');if(!profile)return;
 center=await requireSelectedCenter({force:forceCenterSelectionFromUrl()});mountHeaderCenterSwitcher(next=>location.replace(withCenterParam(location.pathname,next)));decorateCenterLinks(document);
 $('user-badge').textContent=(profile.display_name||profile.email||'')+' ('+profile.role+')';
 if(!globalThis.XLSX)throw new Error('엑셀 라이브러리를 불러오지 못했습니다. 새로고침해 주세요.');
 const now=new Date(),year=now.getFullYear();$('source-year').value=year;$('archive-month').value=year+'-'+String(now.getMonth()+1).padStart(2,'0');
 $('source-file').disabled=false;$('json-file').disabled=false;$('onedrive-url').value=localStorage.getItem('sajo.charter.folder.'+center.code)||'';
 const actions={'parse-btn':parseFile,'db-load':loadDB,'db-save':saveDB,'json-export':downloadJson,'archive-refresh':refreshArchives,'onedrive-config':configureDrive,'archive-save':archiveMonth,'archive-read':readDrive,'archive-purge':purgeMonth,'download-btn':()=>XLSX.writeFile(buildNormalizedWorkbook(visible(),XLSX),'용차_가로형_정산.xlsx',{compression:true}),'preview-toggle':()=>{$('preview-wrap').hidden=!$('preview-wrap').hidden;if(!$('preview-wrap').hidden)renderPreview();}};
 for(const [id,action]of Object.entries(actions))$(id).onclick=()=>task(action);
 $('source-file').onchange=loadFile;$('json-file').onchange=()=>task(importJson);
 for(const id of ['from-date','to-date','customer-filter','course-filter','issues-only'])$(id).addEventListener('input',()=>{page=0;render();});
 $('filter-reset').onclick=()=>{for(const id of ['from-date','to-date','customer-filter','course-filter'])$(id).value='';$('issues-only').checked=false;page=0;render();};
 $('archive-list').onchange=enable;$('prev-page').onclick=()=>{page--;render();};$('next-page').onclick=()=>{page++;render();};
 $('edit-form').onsubmit=applyEdit;$('edit-cancel').onclick=()=>$('edit-dialog').close();
 $('onedrive-open').onclick=()=>{
  try{const url=new URL($('onedrive-url').value);if(url.protocol!=='https:'||!['1drv.ms','onedrive.live.com'].includes(url.hostname))throw new Error('OneDrive 공유 링크를 입력해 주세요.');window.open(url.href,'_blank','noopener,noreferrer');}catch(error){message(error.message,true);}
 };
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
 render();message('엑셀 업로드 또는 DB 불러오기로 시작하세요.');
}
initialize().catch(error=>message(error.message||String(error),true));
