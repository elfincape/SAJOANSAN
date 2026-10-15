import {requireRole} from './auth.js';
import {supabase} from './supabase.js';
import {browserJobRows,enqueueBrowserJob,watchBrowserJob,browserWorkbook} from './naver-browser-model.js';
import {menuPermissions} from './menu-permissions.js';
import {permissionAllowed} from './portal-permissions.js';
import {CENTER_ORIGINS,centerDestinations} from './destination-distance-db.js';
import {DEFAULTS,TONS,excelAddresses,longestRows,resultValues,distanceWorkbook} from './destination-distance-model.js';
const $=id=>document.getElementById(id);let workbook,dbRows=null,rows=[],busy=false,cancelled=false,key='',page=0,permissions,activeCenter=['ansan','001'].includes(new URL(location.href).searchParams.get('center'))?'001':'002';let currentJob=null;const PAGE=100;
const status=text=>$('status').textContent=text;
function lock(){document.querySelectorAll('input,select,button').forEach(e=>e.disabled=busy);for(const center of ['001','002'])$('center-'+center).disabled=busy||!permissionAllowed(permissions,'delivery_points','read',center);$('calculate').disabled=busy||(!workbook&&!dbRows);$('download').disabled=busy||!rows.some(r=>Number.isFinite(r.distanceKm));$('cancel').hidden=!busy;$('cancel').disabled=false;$('prev').disabled=busy||page===0;$('next').disabled=busy||(page+1)*PAGE>=rows.length;}
function criteria(){const origin=$('origin').value.trim(),efficiencies=Object.fromEntries(TONS.map(t=>[t,Number(document.querySelector('[data-efficiency="'+t+'"]').value)]));if(!origin||origin.length>300||Object.values(efficiencies).some(n=>!Number.isFinite(n)||n<=0))throw Error('출발지와 연비를 확인해 주세요.');return {origin,efficiencies};}
function render(){const body=$('results').querySelector('tbody');body.replaceChildren();page=Math.min(page,Math.max(0,Math.ceil(rows.length/PAGE)-1));let efficiencies;try{efficiencies=criteria().efficiencies;}catch{efficiencies=DEFAULTS;}
 for(const r of longestRows(rows).slice(page*PAGE,(page+1)*PAGE)){const tr=document.createElement('tr');[...resultValues(r,efficiencies),r.distanceText??'',r.measuredAt?new Date(r.measuredAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):''].forEach((value,i)=>{const td=document.createElement('td');td.textContent=typeof value==='number'&&i>=4?value.toLocaleString('ko-KR',{maximumFractionDigits:3}):value??'';if(i===4&&r.longest)td.className='longest';tr.append(td);});body.append(tr);}
 $('count').textContent=rows.length?rows.length+'착지 · '+rows.filter(r=>Number.isFinite(r.distanceKm)).length+'계산 완료 · '+rows.filter(r=>r.issue).length+'확인 필요':'';$('page').textContent=rows.length?(page+1)+' / '+Math.ceil(rows.length/PAGE):'';lock();}
function invalidate(){rows=[];page=0;render();}
function columns(){dbRows=null;const sheet=workbook.Sheets[$('sheet').value],range=XLSX.utils.decode_range(sheet['!ref']||'A1');for(const id of ['address-column','name-column']){$(id).replaceChildren();if(id==='name-column')$(id).add(new Option('선택 안 함',''));for(let c=range.s.c;c<=range.e.c;c++){const letter=XLSX.utils.encode_col(c);$(id).add(new Option(letter,c));}}invalidate();}
async function upload(){const file=$('file').files[0];if(!file)return;if(file.size>30*1024*1024)throw Error('30MB 이하 파일을 선택해 주세요.');workbook=null;dbRows=null;invalidate();const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});const sheets=wb.SheetNames.filter(n=>wb.Sheets[n]['!ref']);if(!sheets.length)throw Error('데이터가 있는 시트가 없습니다.');workbook=wb;$('sheet').replaceChildren(...sheets.map(n=>new Option(n,n)));columns();$('source-label').textContent=file.name;status(file.name);}
async function calculate(){if(currentJob)return follow(currentJob);const input=criteria();localStorage.setItem(key,JSON.stringify({...input,centers:Object.fromEntries(['001','002'].map(c=>[c,$('origin-'+c).value]))}));rows=dbRows?dbRows.map(r=>({...r})):excelAddresses(workbook.Sheets[$('sheet').value],XLSX,{addressColumn:Number($('address-column').value),nameColumn:$('name-column').value===''?null:Number($('name-column').value),startRow:Number($('start-row').value)});page=0;cancelled=false;

 const addresses=[...new Set(rows.filter(r=>!r.issue&&r.address).map(r=>r.address))];if(!addresses.length)throw Error('계산할 주소가 없습니다.');
 currentJob=await enqueueBrowserJob(supabase,activeCenter,input.origin,addresses);
 localStorage.setItem(key+'.job',JSON.stringify({id:currentJob,rows,origin:input.origin,center:activeCenter}));
 await follow(currentJob);
}
async function follow(id){
 currentJob=id;await watchBrowserJob(supabase,id,job=>{
  rows=browserJobRows(rows,job);render();
  status(({'queued':'서버 대기','running':'네이버 지도 조회 중','completed':'계산 완료','cancelled':'계산 중지','attention':'확인 필요 — 네이버 지도 조회를 중지했습니다.'})[job.status]+' · '+Object.keys(job.results??{}).length+' / '+(job.addresses?.length??rows.length));
 });currentJob=null;
}

async function download(){const input=criteria();if(!globalThis.ExcelJS)throw Error('엑셀 다운로드 모듈 확인 필요');const buffer=await browserWorkbook(ExcelJS,rows,input.efficiencies,input.origin),url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download='네이버_최단거리_계산.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function run(action){if(busy)return;busy=true;lock();try{await action();}catch(e){status(e.message);}finally{busy=false;render();}}
async function centerCalculate(center){if(!permissionAllowed(permissions,'delivery_points','read',center))throw Error('센터 납품처 열람 권한이 없습니다.');dbRows=null;invalidate();activeCenter=center;$('origin').value=$('origin-'+center).value;status('납품처 불러오는 중');dbRows=await centerDestinations(supabase,center);$('source-label').textContent=(center==='001'?'안산':'평택')+' 납품처 DB';await calculate();}
async function initialize(){const profile=await requireRole('editor');if(!profile)return;permissions=await menuPermissions();key='sajo.naver-browser.'+profile.id;try{const value=JSON.parse(localStorage.getItem(key)||'null');if(value){$('origin').value=value.origin||$('origin').value;for(const center of ['001','002'])$('origin-'+center).value=value.centers?.[center]||CENTER_ORIGINS[center];TONS.forEach(t=>document.querySelector('[data-efficiency="'+t+'"]').value=value.efficiencies?.[t]??DEFAULTS[t]);}}catch{}
 for(const center of ['001','002'])$('center-'+center).onclick=()=>run(()=>centerCalculate(center));
 $('file').onchange=()=>run(upload);$('sheet').onchange=columns;for(const id of ['address-column','name-column','start-row'])$(id).onchange=()=>{dbRows=null;invalidate();};$('origin').onchange=invalidate;document.querySelectorAll('[data-efficiency]').forEach(e=>e.onchange=()=>{render();});$('calculate').onclick=()=>run(calculate);$('download').onclick=()=>run(download);$('cancel').onclick=async()=>{if(currentJob){const {error}=await supabase.rpc('naver_browser_cancel',{p_job:currentJob});if(error)status('중지 요청 실패');}};$('prev').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};render();status('');try{const pending=JSON.parse(localStorage.getItem(key+'.job')||'null');if(pending?.id){rows=pending.rows;dbRows=pending.rows;activeCenter=pending.center;$('origin').value=pending.origin;$('source-label').textContent='최근 서버 작업';await run(()=>follow(pending.id));}}catch{status('최근 서버 작업을 불러오지 못했습니다.');}}
initialize().catch(e=>status(e.message));
