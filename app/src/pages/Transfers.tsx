import { useEffect, useRef, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { FileArea } from '../components/FileArea';
import { useFeedback } from '../components/useFeedback';
import { dbRowToStateRow, stateRowToPayload, compressImageToDataUrl, dataUrlBytes, formatBytes, formatDateKr, makeUid } from '../domain/transfers';
import type { TransferRow } from '../domain/transfers';
import { formatPhone } from '../domain/phone';
import { loadTransferMasters, loadSavedTransfers, saveTransfer, deleteTransfer, deleteTransfers } from '../lib/transfers';
import type { TransferMasters } from '../lib/transfers';
import { transferWorkbook } from '../lib/transfer-workbook';
const today=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
const emptyDraft=()=>({date:today(),company:'',route:'',driver:'',vehicle:'',phone:'',memo:''});
const photoLabels=['상차리스트','상차사진','추가파레트 1','추가파레트 2'];
function TransfersContent(){
 const {center,profile,editable}=useAdminPage(),{toast,confirm,feedback}=useFeedback();
 const [masters,setMasters]=useState<TransferMasters>({companies:[],routes:[],drivers:[],vehicles:[]}),[rows,setRows]=useState<TransferRow[]>([]);
 const [draft,setDraft]=useState(emptyDraft),[photos,setPhotos]=useState<(string|null)[]>([null,null,null,null]),[touched,setTouched]=useState([false,false,false,false]),[editIndex,setEditIndex]=useState(-1);
 const [selected,setSelected]=useState<string[]>([]),[allChecked,setAllChecked]=useState(false),[saving,setSaving]=useState(false),[downloading,setDownloading]=useState(false),[filename,setFilename]=useState('');
 const dateInput=useRef<HTMLInputElement>(null),fileInputs=useRef<(HTMLInputElement|null)[]>([]),photoVersions=useRef([0,0,0,0]);
 const initial=useRef<{masters:ReturnType<typeof loadTransferMasters>;saved:ReturnType<typeof loadSavedTransfers>}|null>(null),saveLock=useRef(false),downloadLock=useRef(false);
 useEffect(()=>{let active=true;const request=initial.current ??= {masters:loadTransferMasters(center.code),saved:loadSavedTransfers(center.code)};
  void request.masters.then(data=>{if(active)setMasters(data);}).catch(()=>{if(active)toast('마스터 데이터를 불러오지 못했습니다.','error');});
  void request.saved.then(({data,error})=>{if(!active)return;if(error)toast(`저장된 이배송 목록을 불러오지 못했습니다: ${error.message}`,'error');else setRows((data||[]).map(row=>dbRowToStateRow(row,center)));});
  return()=>{active=false;photoVersions.current=photoVersions.current.map(version=>version+1);};
 },[center,toast]);
 useEffect(()=>{setSelected([]);setAllChecked(false);},[rows]);
 const options={routes:masters.routes.filter(row=>!draft.company||row.company_id===draft.company),drivers:masters.drivers.filter(row=>!draft.company||row.company_id===draft.company),vehicles:masters.vehicles.filter(row=>!draft.company||row.company_id===draft.company)};
 function changeField(key:keyof ReturnType<typeof emptyDraft>,value:string){
  if(key==='company'){setDraft(previous=>({...previous,company:value,route:'',driver:'',vehicle:'',phone:''}));return;}
  if(key==='driver'){const driver=masters.drivers.find(row=>row.id===value);setDraft(previous=>({...previous,driver:value,phone:driver?formatPhone(driver.phone||driver.contact||''):''}));return;}
  if(key==='route'){const route=masters.routes.find(row=>row.id===value);setDraft(previous=>{if(!route)return {...previous,route:value};const driverId=route.primary_driver_id?(options.drivers.some(row=>row.id===route.primary_driver_id)?route.primary_driver_id:''):previous.driver,vehicleId=route.primary_vehicle_id?(options.vehicles.some(row=>row.id===route.primary_vehicle_id)?route.primary_vehicle_id:''):previous.vehicle;const driver=masters.drivers.find(row=>row.id===driverId);return {...previous,route:value,driver:driverId,vehicle:vehicleId,phone:driver?formatPhone(driver.phone||driver.contact||''):''};});return;}
  setDraft(previous=>({...previous,[key]:value}));
 }
 function clearPhotos(){photoVersions.current=photoVersions.current.map(version=>version+1);setPhotos([null,null,null,null]);setTouched([false,false,false,false]);fileInputs.current.forEach(input=>{if(input)input.value='';});}
 function clearForm(){setDraft(emptyDraft());clearPhotos();}
 async function attachPhoto(index:number,file:File){if(!editable)return;const version=++photoVersions.current[index];try{const data=await compressImageToDataUrl(file,1024*1024);if(version!==photoVersions.current[index])return;setPhotos(previous=>previous.map((photo,i)=>i===index?data:photo));setTouched(previous=>previous.map((value,i)=>i===index?true:value));toast(`${photoLabels[index]} 사진을 등록했습니다.`,'success');}catch(error){if(version!==photoVersions.current[index])return;setPhotos(previous=>previous.map((photo,i)=>i===index?null:photo));setTouched(previous=>previous.map((value,i)=>i===index?true:value));toast(error instanceof Error?error.message:'사진 처리 중 오류가 발생했습니다.','error');}}
 function renderPhoto(index:number){return <FileArea hint={false} key={index} accept="image/*" disabled={!editable} onFiles={files=>{if(files[0]){const input=fileInputs.current[index];if(input)input.value='';void attachPhoto(index,files[0]);}}}><label className="app-label" htmlFor={`f-photo${index+1}`}>{photoLabels[index]}</label><input ref={element=>{fileInputs.current[index]=element;}} id={`f-photo${index+1}`} type="file" accept="image/*" className="app-input text-xs" onChange={event=>{const file=event.target.files?.[0];if(file)void attachPhoto(index,file);}}/><div className={`paste-zone mt-1 border border-dashed border-zinc-600 rounded-md bg-zinc-900/50 p-2 min-h-[84px] cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500${photos[index]?' border-emerald-500':''}`} tabIndex={0} data-photo={index+1} role="region" aria-label={`${photoLabels[index]} 사진 붙여넣기`}><div className="photo-preview text-xs text-zinc-500 text-center py-6">{photos[index]?<div className="flex items-center gap-2"><img src={photos[index]} alt={photoLabels[index]} className="w-16 h-16 object-cover rounded border border-zinc-700"/><div className="text-xs text-zinc-300"><div>{photoLabels[index]}</div><div className="text-zinc-500">{formatBytes(dataUrlBytes(photos[index]))}</div></div></div>:'클릭 후 Ctrl+V로 붙여넣기'}</div></div><button type="button" data-clear-photo={index+1} aria-label={`${photoLabels[index]} 사진 삭제`} className="mt-1 text-[11px] text-zinc-400 hover:text-rose-300" disabled={!editable} onClick={()=>{photoVersions.current[index]++;setPhotos(previous=>previous.map((photo,i)=>i===index?null:photo));setTouched(previous=>previous.map((value,i)=>i===index?true:value));const input=fileInputs.current[index];if(input)input.value='';toast(`${photoLabels[index]} 사진을 삭제했습니다.`,'info');}}>사진 삭제</button></FileArea>;}
 function addRow(){
  if(!editable)return;const company=masters.companies.find(row=>row.id===draft.company),route=masters.routes.find(row=>row.id===draft.route),driver=masters.drivers.find(row=>row.id===draft.driver),vehicle=masters.vehicles.find(row=>row.id===draft.vehicle);
  if(!draft.date){toast('일자를 입력하세요.','warn');return;}if(!company||!route||!driver||!vehicle){toast('운수사, 코스, 기사, 차량을 선택하세요.','warn');return;}
  const row:TransferRow={_uid:makeUid(),id:null,center:center.name,center_code:center.code,delivery_date:draft.date,company_id:company.id,route_id:route.id,driver_id:driver.id,vehicle_id:vehicle.id,company_name:company.name,route_name:route.car_number||route.name||'',driver_name:driver.name,driver_phone:draft.phone.trim(),vehicle_plate:vehicle.plate_number,photos:[...photos],memo:draft.memo.trim(),_dirty:true};
  const previous=rows[editIndex];if(editIndex>=0&&previous){setRows(items=>items.map((item,i)=>i===editIndex?{...row,_uid:previous._uid,id:previous.id,photos:[0,1,2,3].map(index=>touched[index]?photos[index]:previous.photos[index]??null)}:item));setEditIndex(-1);toast('행을 수정했습니다. DB 저장을 눌러 반영하세요.','success');}else{setRows(items=>[...items,row]);toast('행을 추가했습니다. DB 저장을 눌러야 저장됩니다.','success');}clearPhotos();setDraft(previous=>({...previous,memo:''}));
 }
 function edit(index:number){const row=rows[index];if(!row||!editable)return;setEditIndex(index);setDraft({date:row.delivery_date||'',company:row.company_id||'',route:row.route_id||'',driver:row.driver_id||'',vehicle:row.vehicle_id||'',phone:row.driver_phone||'',memo:row.memo||''});photoVersions.current=photoVersions.current.map(version=>version+1);setPhotos([...row.photos]);setTouched([false,false,false,false]);dateInput.current?.focus();}
 async function removeOne(index:number){if(!editable)return;const row=rows[index];if(!row||!await confirm('이 행을 삭제할까요?',{okText:'삭제',cancelText:'취소',danger:true}))return;if(row.id){const {error}=await deleteTransfer(center.code,row.id);if(error){toast(`DB 삭제 실패: ${error.message}`,'error');return;}}setRows(previous=>previous.filter((_,i)=>i!==index));toast('삭제했습니다.','success');}
 async function deleteSelected(){if(!editable)return;const removed=rows.filter(row=>selected.includes(row._uid));if(!removed.length){toast('삭제할 행을 선택하세요.','warn');return;}if(!await confirm(`선택한 ${removed.length}개 행을 삭제할까요? 저장된 행은 DB에서도 삭제됩니다.`,{okText:'삭제',cancelText:'취소',danger:true}))return;const ids=removed.map(row=>row.id).filter((id):id is string=>!!id);if(ids.length){const {error}=await deleteTransfers(center.code,ids);if(error){toast(`선택 삭제 실패: ${error.message}`,'error');return;}}setRows(previous=>previous.filter(row=>!selected.includes(row._uid)));toast('선택한 행을 삭제했습니다.','success');}
 async function clearAll(){if(!editable)return;if(!rows.length){toast('초기화할 항목이 없습니다.','warn');return;}if(!await confirm('현재 목록 전체를 초기화할까요? 저장된 행은 DB에서도 삭제됩니다.',{okText:'전체 초기화',cancelText:'취소',danger:true}))return;const ids=rows.map(row=>row.id).filter((id):id is string=>!!id);if(ids.length){const {error}=await deleteTransfers(center.code,ids);if(error){toast(`전체 초기화 실패: ${error.message}`,'error');return;}}setRows([]);toast('전체 목록을 초기화했습니다.','success');}
 async function reloadDb(){if(!await confirm('DB에서 다시 불러오면 현재 미저장 행은 사라질 수 있습니다. 계속할까요?',{okText:'새로고침',cancelText:'취소'}))return;const {data,error}=await loadSavedTransfers(center.code);if(error)toast(`저장된 이배송 목록을 불러오지 못했습니다: ${error.message}`,'error');else setRows((data||[]).map(row=>dbRowToStateRow(row,center)));toast('DB 목록을 다시 불러왔습니다.','success');}
 async function saveDb(){if(!editable||saveLock.current)return;if(!rows.length){toast('저장할 항목이 없습니다.','warn');return;}saveLock.current=true;setSaving(true);try{const saved:TransferRow[]=[];for(const row of rows){const {data,error}=await saveTransfer(center.code,row.id,stateRowToPayload(row,center,profile));if(error)throw error;saved.push(dbRowToStateRow(data,center));}setRows(saved);toast('DB에 저장했습니다.','success');}catch(error){toast(`DB 저장 실패: ${error instanceof Error?error.message:typeof error==='object'&&error&&'message'in error?error.message:String(error)}`,'error');}finally{saveLock.current=false;setSaving(false);}}
 const downloadRef=useRef<HTMLAnchorElement>(null),[downloadUrl,setDownloadUrl]=useState<{url:string;name:string}|null>(null);
 useEffect(()=>{if(!downloadUrl)return;downloadRef.current?.click();const timer=setTimeout(()=>URL.revokeObjectURL(downloadUrl.url),1000);return()=>{clearTimeout(timer);URL.revokeObjectURL(downloadUrl.url);};},[downloadUrl]);
 async function download(){if(downloadLock.current)return;if(!rows.length){toast('다운로드할 항목이 없습니다.','warn');return;}downloadLock.current=true;setDownloading(true);try{const blob=await transferWorkbook(rows),date=new Date(),ymd=`${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`,custom=filename.trim(),name=custom?(custom.endsWith('.xlsx')?custom:custom+'.xlsx'):`이배송_${ymd}.xlsx`;setDownloadUrl({url:URL.createObjectURL(blob),name});toast('엑셀 파일을 다운로드했습니다.','success');}catch(error){toast(`엑셀 다운로드 실패: ${error instanceof Error?error.message:String(error)}`,'error');}finally{downloadLock.current=false;setDownloading(false);}}
 const tableRows=rows.map((row,index)=><tr key={row._uid}><td><input type="checkbox" className="row-check" data-idx={index} aria-label={`이배송 ${index+1}행 선택`} checked={selected.includes(row._uid)} onChange={event=>setSelected(previous=>event.target.checked?[...previous,row._uid]:previous.filter(id=>id!==row._uid))}/></td><td>{index+1}</td><td>{row.center}</td><td>{formatDateKr(row.delivery_date)}</td><td>{row.company_name}</td><td>{row.route_name}</td><td>{row.driver_name}</td><td>{row.driver_phone||''}</td><td>{row.vehicle_plate}</td><td>{row.photos.filter(Boolean).length}/4</td><td>{row.memo||''}</td><td className={`${row.id?'text-emerald-300':'text-amber-300'} text-xs`}>{row.id?'저장됨':'미저장'}</td><td className="text-right"><button type="button" className="btn btn-ghost text-xs" data-permission-action="edit" data-edit={index} aria-label={`이배송 ${index+1}행 수정`} disabled={!editable} onClick={()=>edit(index)}>수정</button><button type="button" className="btn btn-ghost text-xs text-rose-400" data-permission-action="edit" data-del={index} aria-label={`이배송 ${index+1}행 삭제`} disabled={!editable} onClick={()=>void removeOne(index)}>삭제</button></td></tr>);
 return <>
<main className="app-main flex-1 max-w-[1500px] w-full mx-auto px-4 py-4 space-y-4" id="work-main" tabIndex={-1}>

  <section className="work-editor border border-zinc-700 rounded-lg bg-zinc-800/30 p-4" aria-label="이배송 입력">

    <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
      <div>
        <label className="app-label" htmlFor="f-center">센터</label>
        <input id="f-center" readOnly className="app-input" value={center.name} />
      </div>

      <div>
        <label className="app-label" htmlFor="f-date">일자</label>
        <input id="f-date" value={draft.date} onChange={event=>changeField("date",event.target.value)} ref={dateInput} type="date" className="app-input" />
      </div>

      <div>
        <label className="app-label" htmlFor="f-company">운수사</label>
        <select id="f-company" value={draft.company} onChange={event=>changeField("company",event.target.value)} className="app-select"><option value="">선택</option>{masters.companies.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>

      <div>
        <label className="app-label" htmlFor="f-route">코스번호</label>
        <select id="f-route" value={draft.route} onChange={event=>changeField("route",event.target.value)} className="app-select"><option value="">선택</option>{options.routes.map(item=><option key={item.id} value={item.id}>{item.car_number || item.name || ""}</option>)}</select>
      </div>

      <div>
        <label className="app-label" htmlFor="f-driver">기사명</label>
        <select id="f-driver" value={draft.driver} onChange={event=>changeField("driver",event.target.value)} className="app-select"><option value="">선택</option>{options.drivers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>

      <div>
        <label className="app-label" htmlFor="f-vehicle">차량번호</label>
        <select id="f-vehicle" value={draft.vehicle} onChange={event=>changeField("vehicle",event.target.value)} className="app-select"><option value="">선택</option>{options.vehicles.map(item=><option key={item.id} value={item.id}>{item.plate_number}</option>)}</select>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-3">
      <div>
        <label className="app-label" htmlFor="f-phone">연락처</label>
        <input id="f-phone" value={draft.phone} onChange={event=>changeField("phone",event.target.value)} className="app-input" />
      </div>

      {renderPhoto(0)}

      {renderPhoto(1)}

      {renderPhoto(2)}

      {renderPhoto(3)}
    </div>

    <div className="mt-3">
      <label className="app-label" htmlFor="f-memo">비고</label>
      <input id="f-memo" value={draft.memo} onChange={event=>changeField("memo",event.target.value)} className="app-input" />
    </div>

    <div className="work-form-actions flex items-center gap-2 mt-4">
      <button id="btn-add" disabled={!editable} onClick={addRow} data-permission-action="edit" className="btn btn-primary">{editIndex>=0 ? "행 수정" : "행 추가"}</button>
      <button id="btn-clear-form" onClick={() => {clearForm();dateInput.current?.focus();}} className="btn btn-ghost">입력 초기화</button>
      <div className="flex-1"></div>
      <span className="text-xs text-zinc-500">사진은 각 파일 1MB 이하로 압축됩니다.</span>
    </div>
  </section>

  <section className="work-list border border-zinc-700 rounded-lg overflow-hidden" aria-label="이배송 목록">
    <div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex items-center gap-2 flex-wrap">
      <span className="text-sm font-semibold">이배송 목록</span>
      <span id="row-count" className="text-xs text-zinc-400" role="status" aria-live="polite" aria-atomic="true">{rows.length}건</span>
      <div className="flex-1"></div>

      <button id="btn-reload-db" onClick={() => void reloadDb()} className="btn btn-ghost text-xs">DB 새로고침</button>
      <button id="btn-delete-selected" disabled={!editable} onClick={() => void deleteSelected()} data-permission-action="edit" className="btn btn-ghost text-xs text-rose-300">선택 삭제</button>
      <button id="btn-clear-list" disabled={!editable} onClick={() => void clearAll()} data-permission-action="edit" className="btn btn-ghost text-xs text-rose-400">전체 초기화</button>
      <button id="btn-save-db" disabled={!editable || saving} onClick={() => void saveDb()} data-permission-action="edit" className="btn btn-primary text-xs">{saving ? "저장 중..." : "DB 저장"}</button>
    </div>

    <div className="table-wrap" style={{border:"none",borderRadius:0,maxHeight:360}} tabIndex={0} role="region" aria-label="이배송 목록">
      <table className="app-table">
        <thead>
          <tr>
            <th><input id="chk-all" checked={allChecked} onChange={event=>{setAllChecked(event.target.checked);setSelected(event.target.checked ? rows.map(row=>row._uid) : []);}} type="checkbox" aria-label="이배송 전체 선택" /></th>
            <th>순서</th>
            <th>센터</th>
            <th>일자</th>
            <th>소속</th>
            <th>코스</th>
            <th>DM</th>
            <th>연락처</th>
            <th>차량번호</th>
            <th>사진</th>
            <th>비고</th>
            <th>상태</th>
            <th className="text-right">작업</th>
          </tr>
        </thead>
        <tbody id="tbody">{tableRows}</tbody>
      </table>

      <div id="empty-msg" className={`text-center text-sm text-zinc-500 py-12${rows.length ? " hidden" : ""}`}>
        추가된 이배송 항목이 없습니다.
      </div>
    </div>
  </section>

  <section className="border border-zinc-700 rounded-lg bg-zinc-800/30 p-4">
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
      <div>
        <label className="app-label" htmlFor="f-filename">다운로드 파일명</label>
        <input id="f-filename" value={filename} onChange={event=>setFilename(event.target.value)} className="app-input" placeholder="이배송_202604" />
      </div>
      <button id="btn-download" disabled={downloading} className="btn btn-primary" onClick={() => void download()}>{downloading ? "생성 중..." : "엑셀 다운로드"}</button>
    </div>
  </section>

</main><a ref={downloadRef} hidden href={downloadUrl?.url} download={downloadUrl?.name}/>{feedback}</>;
}
export default function Transfers(){return <AdminPage title="이배송 관리" bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><TransfersContent/></AdminPage>;}
