import {requireRole} from './auth.js';
import {supabase} from './supabase.js';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';
import {koreaDate} from './operations-view.js';
import {DEFAULT_ORIGIN,DEFAULT_EFFICIENCY,efficiencyFor,originalStops,fuelResult,fuelSummary,fuelRows,RESULT_HEADERS,loadFuelTrips} from './charter-fuel-model.js';
const $=id=>document.getElementById(id);
let source=[],results=[],issues=[],busy=false,stopped=false,storageKey='',resultPage=0,calculating=false;
const PAGE=100;
const fmt=(n,d=0)=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:d});
function message(text,error=false){$('status').textContent=text;$('status').className=error?'fuel-error':'';}
function controls(){
 document.querySelectorAll('input,select,button').forEach(e=>e.disabled=busy);
 $('calculate').disabled=busy||!source.length;$('export').disabled=busy||!results.length;
 $('cancel').hidden=!busy||!calculating;$('cancel').disabled=false;
 const count=results.reduce((n,r)=>n+r.rows.length,0);$('results-prev').disabled=busy||resultPage===0;$('results-next').disabled=busy||(resultPage+1)*PAGE>=count;
}
function settings(){
 const efficiencies=Object.fromEntries([...document.querySelectorAll('[data-efficiency]')].map(e=>[e.dataset.efficiency,Number(e.value)]));
 const origin=$('origin-address').value.trim(),price=Number($('fuel-price').value),priority=$('route-priority').value;
 if(!origin||origin.length>300)throw Error('출발지 주소를 입력해 주세요.');
 if(!Number.isFinite(price)||price<=0)throw Error('리터당 유류단가를 입력해 주세요.');
 if(Object.values(efficiencies).some(v=>!Number.isFinite(v)||v<=0))throw Error('톤수별 연비는 0보다 큰 값으로 입력해 주세요.');
 return {origin,price,priority,efficiencies};
}
function saveSettings(){
 try{localStorage.setItem(storageKey,JSON.stringify({origin:$('origin-address').value,price:$('fuel-price').value,priority:$('route-priority').value,efficiencies:Object.fromEntries([...document.querySelectorAll('[data-efficiency]')].map(e=>[e.dataset.efficiency,e.value]))}));}catch{}
}
function row(parent,values){const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=value??'';tr.append(td);}parent.append(tr);}
function render(){
 const tbody=$('results').querySelector('tbody');tbody.replaceChildren();
 const details=fuelRows(results);resultPage=Math.min(resultPage,Math.max(0,Math.ceil(details.length/PAGE)-1));
 for(const value of details.slice(resultPage*PAGE,(resultPage+1)*PAGE))row(tbody,value.map((v,i)=>i>=3?fmt(v,i===6?0:3):v));
 $('results-page').textContent=details.length?(resultPage+1)+' / '+Math.ceil(details.length/PAGE)+' 페이지 · '+details.length+'착지':'측정 결과가 없습니다.';
 const averages=$('averages').querySelector('tbody');averages.replaceChildren();
 for(const s of fuelSummary(results))row(averages,[s.label,s.count,fmt(s.averageDistance,3),fmt(s.averageLiters,3),fmt(s.averageFuelCost)]);
 const totalCost=results.reduce((n,r)=>n+r.fuelCost,0),totalKm=results.reduce((n,r)=>n+r.distanceKm,0);
 $('metrics').replaceChildren();for(const text of ['측정 완료 '+results.length+'운행','총 편도거리 '+fmt(totalKm,3)+'km','평균 유류비 '+fmt(results.length?totalCost/results.length:0)+'원 / 운행']){const span=document.createElement('span');span.textContent=text;$('metrics').append(span);}
 $('issues').hidden=!issues.length;$('issue-count').textContent='확인 필요 '+issues.length+'건';$('issue-list').replaceChildren();
 for(const issue of issues){const li=document.createElement('li');li.textContent=issue;$('issue-list').append(li);}
 controls();
}
async function distance(input,session,stops){
 const response=await fetch(SUPABASE_URL+'/functions/v1/kakao-distance',{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({center:'002',origin:input.origin,priority:input.priority,stops:stops.map(s=>({address:s.address}))}),signal:AbortSignal.timeout(100000)});
 let data;try{data=await response.json();}catch{throw Error('거리 계산 응답을 확인하지 못했습니다.');}
 if(!response.ok)throw Object.assign(Error(data.error||'거리 계산에 실패했습니다.'),{status:response.status});
 return data;
}
async function load(){
 const from=$('from-date').value,through=$('through-date').value;
 if(!from||!through||from>through)throw Error('조회 기간을 확인해 주세요.');
 const days=(new Date(through+'T00:00:00Z')-new Date(from+'T00:00:00Z'))/86400000;
 if(!Number.isFinite(days)||days>366)throw Error('조회 기간은 최대 1년으로 설정해 주세요.');
 source=await loadFuelTrips(supabase,{from,through});results=[];issues=[];render();
 $('db-count').textContent='평택 DB '+source.length+'운행 · 계산에 성공한 결과만 아래에 표시됩니다.';
 message(source.length+'운행을 불러왔습니다.');
}
async function calculate(){
 const input=settings();saveSettings();const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('다시 로그인해 주세요.');
 calculating=true;issues=[];stopped=false;render();let attempted=0;const done=new Set(results.map(r=>r.id));
 for(const trip of source){
  if(stopped)break;if(done.has(trip.id)){attempted++;continue;}
  const label=(trip.tons==null?'톤수 미정':trip.tons+'톤')+' · '+(trip.deliveries.map(d=>d.name).filter(Boolean).join(' / ')||'착지명 미정');
  try{
   if(!efficiencyFor(trip.tons,input.efficiencies))throw Error('해당 톤수의 연비 기준이 없습니다. DB 톤수를 확인해 주세요.');
   const stops=originalStops(trip);if(!stops.length||stops.some(s=>!s.address))throw Error('착지 주소가 비어 있습니다. DB에서 확인해 주세요.');
   message('거리 계산 중 '+(attempted+1)+' / '+source.length+'운행');
   const route=await distance(input,session,stops);
   results.push(fuelResult(trip,route,input));
  }catch(error){issues.push(label+' — '+error.message);if([401,403,429,503].includes(error.status)){stopped=true;}}
  attempted++;render();
 }
 render();message((stopped?'계산을 중지했습니다. ':'측정을 완료했습니다. ')+results.length+'운행 성공 · '+issues.length+'건 확인 필요'+(attempted<source.length?' · 미측정 '+(source.length-attempted)+'운행':''));
}
async function run(action){if(busy)return;busy=true;controls();try{await action();}catch(e){message(e.message||'처리하지 못했습니다.',true);}finally{calculating=false;busy=false;controls();}}
function download(){
 if(!globalThis.XLSX)throw Error('엑셀 기능을 불러오지 못했습니다.');
 const wb=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([RESULT_HEADERS,...fuelRows(results)]);
 sheet['!cols']=[{wch:10},{wch:28},{wch:60},...Array(4).fill({wch:23})];
 XLSX.utils.book_append_sheet(wb,sheet,'착지별 유류비');
 const avg=fuelSummary(results);XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['톤수','측정 운행수','평균 편도거리(km)','평균 사용량(L)','평균 유류비(원)'],...avg.map(s=>[s.label,s.count,Number(s.averageDistance.toFixed(3)),Number(s.averageLiters.toFixed(3)),Math.round(s.averageFuelCost)])]),'톤수별 평균');
 const values=settings();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['출발지','운행방식','유류단가(원/L)','경로기준'],[values.origin,'편도',values.price,values.priority],[],['톤수','연비(km/L)'],...Object.entries(values.efficiencies).map(([tons,value])=>[tons==='11'?'11톤 이상':tons+'톤',value])]),'계산 기준');
 XLSX.writeFile(wb,koreaDate()+'_임시차_평균유류비.xlsx',{compression:true});
}
async function initialize(){
 const url=new URL(location.href);if(url.searchParams.get('center')!=='pyeongtaek'&&url.searchParams.get('center')!=='002'){url.searchParams.set('center','pyeongtaek');location.replace(url.pathname+url.search);return;}
 const profile=await requireRole('editor');if(!profile)return;storageKey='sajo.charter.fuel.'+profile.id;
 const today=koreaDate();$('from-date').value=today.slice(0,8)+'01';$('through-date').value=today;
 try{
  const value=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(value){$('origin-address').value=value.origin||DEFAULT_ORIGIN;$('fuel-price').value=value.price||'';if(['DISTANCE','RECOMMEND','TIME'].includes(value.priority))$('route-priority').value=value.priority;
   for(const e of document.querySelectorAll('[data-efficiency]'))e.value=value.efficiencies?.[e.dataset.efficiency]??DEFAULT_EFFICIENCY[e.dataset.efficiency];}
 }catch{}
 document.querySelectorAll('#origin-address,#fuel-price,#route-priority,[data-efficiency]').forEach(e=>e.addEventListener('change',()=>{saveSettings();if(results.length){results=[];issues=[];render();message('계산 기준이 변경되었습니다. 다시 계산해 주세요.');}}));
 for(const e of [$('from-date'),$('through-date')])e.addEventListener('change',()=>{source=[];results=[];issues=[];render();$('db-count').textContent='조회 기간이 변경되었습니다. DB를 다시 불러와 주세요.';});
 $('results-prev').onclick=()=>{resultPage--;render();};$('results-next').onclick=()=>{resultPage++;render();};
 $('load-db').onclick=()=>run(load);$('calculate').onclick=()=>run(calculate);$('export').onclick=()=>run(download);$('cancel').onclick=()=>{stopped=true;message('진행 중인 운행 계산이 끝나면 중지합니다.');};
 render();message('평택 DB를 불러온 뒤 유류단가를 입력하고 계산하세요.');
}
initialize().catch(e=>message(e.message,true));
