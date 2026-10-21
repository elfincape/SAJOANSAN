import { useCallback, useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { useFeedback } from '../components/useFeedback';
import { loadExportStops } from '../lib/course-export';
import { HEADERS, SORT_KEYS, PRESETS, FILTER_KEYS, compareVals, rowToFlat } from '../domain/course-export';
import type { ExportColumn, ExportFlat, SortEntry } from '../domain/course-export';
const filterLabels: Record<string,string> = {company_name:'운수사',route_name:'코스명',car_number:'호차',driver_name:'운전자명',region:'지역',point_name:'납품처'};
function initialCols(): ExportColumn[] {
  let saved: ExportColumn[] = [...HEADERS];
  try { saved = JSON.parse(localStorage.getItem('export.cols') || 'null') || saved; } catch { /* original storage fallback */ }
  const cols = saved.filter(col=>HEADERS.includes(col));
  for(const col of ['열쇠보관장소','비밀번호',...HEADERS] as ExportColumn[]) if(!cols.includes(col)) cols.push(col);
  return cols;
}
function CourseExportContent() {
 const {center} = useAdminPage(); const {toast,feedback} = useFeedback();
 const [flat,setFlat] = useState<ExportFlat[]>([]), [loaded,setLoaded] = useState(false);
 const [activeOnly,setActiveOnly] = useState(true), [format,setFormat] = useState('xlsx'), [filename,setFilename] = useState('');
 const [sorts,setSorts] = useState<SortEntry[]>(()=>PRESETS.default.map(sort=>({...sort}))), [cols,setCols] = useState(initialCols);
 const [filters,setFilters] = useState<Record<string,string[]>>({}), [queries,setQueries] = useState<Record<string,string>>({});
 const [dragged,setDragged] = useState(''), [drop,setDrop] = useState<{name:string;before:boolean}|null>(null);
 const request = useRef<{key:string;promise:ReturnType<typeof loadExportStops>}|null>(null), generation = useRef(0);
 const load = useCallback(async (reuse=false) => {
  const token=++generation.current,key=center.code+activeOnly;
  try { const promise=reuse && request.current?.key===key ? request.current.promise : loadExportStops(center.code,activeOnly);request.current={key,promise}; const rows=await promise;if(token===generation.current){setFlat(rows.map(rowToFlat));setLoaded(true);} }
  catch(error){if(token===generation.current){setFlat([]);setLoaded(true);toast(`데이터 로드 실패: ${error instanceof Error ? error.message : String(error)}`,'error');}}
 },[center.code,activeOnly,toast]);
 useEffect(()=>{void load(true);return()=>{generation.current++;};},[load]);
 const rows=flat.filter(row=>FILTER_KEYS.every(key=>!filters[key]?.length || filters[key].includes(String(row._sort[key]??'')))).sort((a,b)=>{for(const sort of sorts){const compared=compareVals(a._sort[sort.key],b._sort[sort.key],sort.dir);if(compared) return compared;}return 0;});
 const filterCount=Object.values(filters).reduce((sum,values)=>sum+values.length,0),outputCols=cols.length ? cols : [...HEADERS];
 function clearFilters(){setFilters({});setQueries({});}
 function updateCols(next:ExportColumn[]){setCols(next);try{localStorage.setItem('export.cols',JSON.stringify(next));}catch{/* original storage fallback */}}
 function addSortKey(){if(sorts.length>=SORT_KEYS.length){toast('더 이상 추가할 정렬 키가 없습니다.','warn');return;}const next=SORT_KEYS.find(key=>!sorts.some(sort=>sort.key===key.key))||SORT_KEYS[0];setSorts([...sorts,{key:next.key,dir:'asc'}]);}
 function moveSort(i:number,offset:number){setSorts(previous=>{const next=[...previous];[next[i],next[i+offset]]=[next[i+offset],next[i]];return next;});}
 function renderFilter(key:string){
  const selected=filters[key]||[],query=(queries[key]||'').trim().toLowerCase();
  const values=[...new Set(flat.map(row=>row._sort[key]).filter(value=>value!=null&&value!=='').map(String))].sort((a,b)=>a.localeCompare(b,'ko',{numeric:true})).filter(value=>!query||value.toLowerCase().includes(query)||selected.includes(value));
  return <div key={key} className="filter-group" data-key={key}><div className="text-xs text-zinc-400 mb-1 flex items-center justify-between"><span>{filterLabels[key]}</span><span className="filter-count text-emerald-400" data-for={key}>{selected.length ? `${selected.length}개 선택` : ''}</span></div><input type="text" className="filter-search w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs mb-1" placeholder="검색…" value={queries[key]||''} onChange={event=>setQueries(previous=>({...previous,[key]:event.target.value}))}/><div id={`filter-${key}`} className="filter-box">{values.length ? values.map(value=><label key={value} className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs hover:bg-zinc-700/50 rounded cursor-pointer"><input type="checkbox" data-filter={key} value={value} checked={selected.includes(value)} className="rounded border-zinc-600 bg-zinc-800" onChange={event=>setFilters(previous=>({...previous,[key]:event.target.checked ? [...selected,value] : selected.filter(item=>item!==value)}))}/><span className="truncate">{value}</span></label>) : <div className="text-xs text-zinc-500 italic px-1 py-2">{query ? '일치 없음' : '데이터 없음'}</div>}</div></div>;
 }
 const sortEditor=sorts.length ? sorts.map((sort,i)=><div key={i} className="flex items-center gap-2 bg-zinc-900/50 border border-zinc-700 rounded p-2" data-i={i}><span className="text-xs text-zinc-500 w-6">{i+1}.</span><select data-act="key" className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs flex-1" value={sort.key} onChange={event=>setSorts(previous=>previous.map((entry,index)=>index===i?{...entry,key:event.target.value}:entry))}>{SORT_KEYS.map(key=><option key={key.key} value={key.key}>{key.label}</option>)}</select><button data-act="dir" className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded w-16" onClick={()=>setSorts(previous=>previous.map((entry,index)=>index===i?{...entry,dir:entry.dir==='asc'?'desc':'asc'}:entry))}>{sort.dir==='asc'?'▲ 오름':'▼ 내림'}</button><button data-act="up" className="text-xs px-1.5 py-1 bg-zinc-700 hover:bg-zinc-600 rounded" disabled={i===0} onClick={()=>moveSort(i,-1)}>↑</button><button data-act="down" className="text-xs px-1.5 py-1 bg-zinc-700 hover:bg-zinc-600 rounded" disabled={i===sorts.length-1} onClick={()=>moveSort(i,1)}>↓</button><button data-act="del" className="text-xs px-2 py-1 bg-red-600/30 hover:bg-red-600/50 border border-red-600/50 rounded" onClick={()=>setSorts(previous=>previous.filter((_,index)=>index!==i))}>✕</button></div>) : <div className="text-xs text-zinc-500 italic">정렬 키가 없습니다 (입력 순서대로 출력).</div>;
 const ordered=[...cols,...HEADERS.filter(col=>!cols.includes(col))];
 const columnEditor=ordered.map(name=><label key={name} draggable data-col={name} className={`col-item flex items-center gap-2 bg-zinc-900/50 border border-zinc-700 rounded px-2 py-1.5 text-xs cursor-grab${dragged===name?' opacity-40':''}${drop?.name===name?(drop.before?' drop-before':' drop-after'):''}`} onDragStart={event=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',name);setDragged(name);}} onDragEnd={()=>{setDragged('');setDrop(null);}} onDragOver={event=>{event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();setDrop({name,before:event.clientY-rect.top<rect.height/2});}} onDragLeave={()=>setDrop(null)} onDrop={event=>{event.preventDefault();const src=event.dataTransfer.getData('text/plain') as ExportColumn;if(!src||src===name)return;const rect=event.currentTarget.getBoundingClientRect(),before=event.clientY-rect.top<rect.height/2,order=[...ordered],from=order.indexOf(src);if(from<0)return;order.splice(from,1);const to=order.indexOf(name);order.splice(before?to:to+1,0,src);updateCols(order.filter(col=>cols.includes(col)));setDrop(null);}}><span className="text-zinc-500 select-none">⋮⋮</span><input type="checkbox" checked={cols.includes(name)} className="rounded border-zinc-600 bg-zinc-800" onChange={event=>updateCols(event.target.checked?[...cols,name]:cols.filter(col=>col!==name))}/><span className="flex-1 truncate">{name}</span></label>);
 const preview=!loaded ? <div className="text-center text-xs text-zinc-500 py-12">데이터 로딩 중…</div> : !rows.length ? <div className="text-center text-xs text-zinc-500 py-12">조회된 데이터가 없습니다. 필터를 조정해 보세요.</div> : <><table className="text-xs w-max min-w-full"><thead className="bg-zinc-900 sticky top-0"><tr>{outputCols.map(col=><th key={col} className="px-2 py-1.5 text-left text-xs font-semibold text-zinc-300 border-b border-zinc-700 whitespace-nowrap">{col}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((row,i)=><tr key={i} className="hover:bg-zinc-800/50">{outputCols.map(col=><td key={col} className="px-2 py-1 text-xs text-zinc-300 border-b border-zinc-800/50 whitespace-nowrap">{row[col]??''}</td>)}</tr>)}</tbody></table>{rows.length>100?<div className="text-center text-xs text-zinc-500 py-2">… 미리보기는 상위 100건만 표시 (전체 {rows.length}건 다운로드)</div>:null}</>;
 const downloadRef=useRef<HTMLAnchorElement>(null),[downloadUrl,setDownloadUrl]=useState<{url:string;name:string}|null>(null);
 useEffect(()=>{if(!downloadUrl)return;downloadRef.current?.click();const timer=setTimeout(()=>URL.revokeObjectURL(downloadUrl.url),1000);return()=>{clearTimeout(timer);URL.revokeObjectURL(downloadUrl.url);};},[downloadUrl]);
 function download(){
  if(!rows.length){toast('다운로드할 데이터가 없습니다.','warn');return;}
  const data=rows.map(row=>Object.fromEntries(outputCols.map(col=>[col,row[col]??''])));
  const date=new Date(),ymd=`${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`,name=`${filename.trim()||`코스표_${center.name}_${ymd}`}.${format}`;
  let blob:Blob;
  if(format==='csv'){const csv=Papa.unparse({fields:outputCols,data:data.map(row=>outputCols.map(col=>row[col]))});blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});}
  else {const sheet=XLSX.utils.json_to_sheet(data,{header:outputCols}),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'코스표');blob=new Blob([XLSX.write(book,{bookType:'xlsx',type:'array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});}
  setDownloadUrl({url:URL.createObjectURL(blob),name});toast(`${format==='csv'?'CSV':'XLSX'} ${data.length}건 다운로드 완료`,'success');
 }
 return <>
<main className="app-main max-w-6xl mx-auto px-4 py-6 space-y-4" id="work-main" tabIndex={-1}>

  
  <section className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
    <h2 className="text-sm font-semibold text-zinc-200 mb-2">사용 안내</h2>
    <ol className="text-xs text-zinc-400 space-y-1 list-decimal list-inside">
      <li>필터로 원하는 데이터를 좁힌 뒤(여러 항목 선택 시 교집합), 정렬·포함 컬럼을 조정합니다.</li>
      <li>미리보기로 확인 후 "다운로드" 버튼을 누르세요. 엑셀에서 사용할 때는 데이터 형식이 유지되는 XLSX를 권장합니다.</li>
      <li>모든 컬럼을 포함해 받으면 <code>/admin/import.html</code> 으로 그대로 다시 업로드할 수 있습니다.</li>
    </ol>
  </section>

  
  <details className="bg-zinc-800/50 border border-zinc-700 rounded-lg" open>
    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-200 flex items-center justify-between">
      <span>⚙️ 기본 옵션</span>
      <span className="text-xs text-zinc-500">파일 형식 · 파일명 · 활성 코스</span>
    </summary>
    <div className="px-4 pb-4 pt-1 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs text-zinc-400">파일 형식</span>
          <select id="opt-format" className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm" value={format} onChange={event => setFormat(event.target.value)}>
            <option value="xlsx">XLSX (Excel · 권장)</option>
            <option value="csv">CSV (UTF-8 · 텍스트 전용)</option>
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="text-xs text-zinc-400">파일명 (확장자 제외, 비우면 자동)</span>
          <input id="opt-filename" type="text" placeholder="코스표_YYYYMMDD" className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm" value={filename} onChange={event => setFilename(event.target.value)} />
        </label>
      </div>

      <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
        <input id="opt-active-only" type="checkbox" className="rounded border-zinc-600 bg-zinc-900" checked={activeOnly} onChange={event => setActiveOnly(event.target.checked)} />
        활성 코스만 포함
      </label>
      <p className="text-xs text-zinc-500">시간 표기는 24시간제(0~24시) 표준만 사용합니다.</p>
    </div>
  </details>

  
  <details className="bg-zinc-800/50 border border-zinc-700 rounded-lg">
    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-200 flex items-center justify-between">
      <span>🔍 필터 <span id="filter-badge" className="ml-2 text-xs text-emerald-400">{filterCount ? `${filterCount}개 적용` : ""}</span></span>
      <span className="text-xs text-zinc-500">운수사 · 코스 · 호차 · 기사 · 지역 · 납품처 (모두 교집합)</span>
    </summary>
    <div className="px-4 pb-4 pt-1 space-y-3">
      <div className="flex justify-end">
        <button id="btn-filter-clear" className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded" onClick={clearFilters}>필터 초기화</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {renderFilter("company_name")}
        {renderFilter("route_name")}
        {renderFilter("car_number")}
        {renderFilter("driver_name")}
        {renderFilter("region")}
        {renderFilter("point_name")}
      </div>
    </div>
  </details>

  
  <details className="bg-zinc-800/50 border border-zinc-700 rounded-lg">
    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-200 flex items-center justify-between">
      <span>↕ 정렬 순서</span>
      <span id="sort-summary" className="text-xs text-zinc-500">{sorts.length ? sorts.map((sort,i)=>`${i+1}.${SORT_KEYS.find(key=>key.key===sort.key)?.label || sort.key}${sort.dir==='asc' ? '↑' : '↓'}`).join(" → ") : "정렬 없음"}</span>
    </summary>
    <div className="px-4 pb-4 pt-1 space-y-3">
      <div className="flex flex-wrap gap-2">
        <button data-preset="default" className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded" onClick={() => setSorts(PRESETS["default"].map(sort=>({...sort})))}>📋 기본</button>
        <button data-preset="route" className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded" onClick={() => setSorts(PRESETS["route"].map(sort=>({...sort})))}>🚚 코스순</button>
        <button data-preset="time" className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded" onClick={() => setSorts(PRESETS["time"].map(sort=>({...sort})))}>⏰ 시간순</button>
        <button id="btn-sort-clear" className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded" onClick={() => setSorts([])}>🗑 초기화</button>
      </div>
      <div id="sort-list" className="space-y-2">{sortEditor}</div>
      <button id="btn-sort-add" className="text-xs px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-600/50 rounded" onClick={addSortKey}>
        ➕ 정렬 키 추가
      </button>
    </div>
  </details>

  
  <details className="bg-zinc-800/50 border border-zinc-700 rounded-lg">
    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-200 flex items-center justify-between">
      <span>📋 포함 컬럼 <span id="cols-badge" className="ml-2 text-xs text-emerald-400">{`${cols.length}/${HEADERS.length}`}</span></span>
      <span className="text-xs text-zinc-500">파일에 포함할 컬럼/순서 선택</span>
    </summary>
    <div className="px-4 pb-4 pt-1 space-y-3">
      <div className="flex flex-wrap gap-2">
        <button id="btn-cols-all" className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded" onClick={() => updateCols([...HEADERS])}>전체 선택</button>
        <button id="btn-cols-none" className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded" onClick={() => updateCols([])}>전체 해제</button>
        <button id="btn-cols-default" className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded" onClick={() => updateCols([...HEADERS])}>기본값</button>
      </div>
      <p className="text-xs text-zinc-500">
        체크된 컬럼만 파일에 포함됩니다. 다시 import 하려면 모든 컬럼을 포함하세요.
        드래그(⋮⋮)로 순서를 변경할 수 있습니다.
      </p>
      <div id="cols-list" className="grid grid-cols-2 md:grid-cols-3 gap-1.5">{columnEditor}</div>
    </div>
  </details>

  
  <section className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-zinc-200">미리보기</h2>
      <div className="flex items-center gap-3">
        <span id="summary" className="text-xs text-zinc-400">{`총 ${rows.length}건 / 전체 ${flat.length}건 · 컬럼 ${outputCols.length}/${HEADERS.length}`}</span>
        <button id="btn-refresh" className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded" onClick={() => void load()}>🔄 새로고침</button>
      </div>
    </div>
    <div id="preview" className="overflow-auto max-h-[480px] border border-zinc-700 rounded">{preview}</div>
  </section>

  
  <section className="flex justify-end sticky bottom-3 z-10">
    <button id="btn-download" className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium shadow-lg" onClick={download}>
      ⬇ 다운로드
    </button>
  </section>
</main><a ref={downloadRef} hidden href={downloadUrl?.url} download={downloadUrl?.name}/>{feedback}</>;
}
export default function CourseExport(){return <AdminPage title="📤 코스표 내려받기"><CourseExportContent/></AdminPage>;}
