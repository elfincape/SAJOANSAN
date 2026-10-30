import { WorkflowNavigation } from '../components/WorkflowNavigation';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Papa from 'papaparse';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { FileArea } from '../components/FileArea';
import { useFeedback } from '../components/useFeedback';
import { autoMap, FIELDS, normalizeImport } from '../domain/course-import';
import type { CsvRow } from '../domain/course-import';
import { executeImport } from '../lib/course-import';
function lines(nodes: ReactNode[]){return nodes.length ? nodes.map((node,index)=><Fragment key={index}>{index ? <br/> : null}{node}</Fragment>) : <i>없음</i>;}
function CourseImportContent(){
 const {center,editable}=useAdminPage(),{toast,feedback}=useFeedback();
 const [rows,setRows]=useState<CsvRow[]>([]),[headers,setHeaders]=useState<string[]>([]),[mapping,setMapping]=useState<Record<string,string>>({}),[ready,setReady]=useState(false),[fileInfo,setFileInfo]=useState('');
 const [replaceStops,setReplaceStops]=useState(true),[dryRun,setDryRun]=useState(false),[running,setRunning]=useState(false),[logs,setLogs]=useState<{text:string;cls:string}[]>([]);
 const lock=useRef(false),readGeneration=useRef(0),logEnd=useRef<HTMLSpanElement>(null);
 useEffect(()=>()=>{readGeneration.current++;},[]);
 useEffect(()=>{logEnd.current?.scrollIntoView({block:'nearest'});},[logs]);
 const normalized=useMemo(()=>normalizeImport(rows,mapping),[rows,mapping]);
 function readCsv(file:File){
  if(!editable)return;const generation=++readGeneration.current;
  setFileInfo(`${file.name} (${(file.size/1024).toFixed(1)} KB)`);
  Papa.parse<CsvRow>(file,{header:true,skipEmptyLines:'greedy',transformHeader:header=>header.trim(),complete:result=>{if(generation!==readGeneration.current)return;setHeaders(result.meta.fields||[]);if(!result.data.length){toast('CSV에 데이터가 없습니다','error');return;}setRows(result.data);setMapping(autoMap(result.meta.fields||[]));setReady(true);toast(`${result.data.length}행을 읽었습니다`,'success');},error:error=>{if(generation===readGeneration.current)toast(`파싱 오류: ${error.message}`,'error');}});
 }
 const cards:[string,number][]=[['회사',normalized.companies.length],['기사',normalized.drivers.length],['차량',normalized.vehicles.length],['납품처',normalized.points.length],['코스',normalized.routes.length],['납품처 항목',normalized.stops.length]];
 const previews={
  companies:lines(normalized.companies.slice(0,50).map(company=>company.name)),
  drivers:lines(normalized.drivers.slice(0,50).map(driver=><>{driver.name} <span className="text-zinc-500">/ {driver.company_name}</span></>)),
  vehicles:lines(normalized.vehicles.slice(0,50).map(vehicle=><>{vehicle.plate_number} <span className="text-zinc-500">{vehicle.tonnage??''}t</span></>)),
  points:lines(normalized.points.slice(0,50).map(point=>`${point.code} ${point.name}`)),
  routes:lines(normalized.routes.slice(0,50).map(route=><>{route.car_number} · {route.name} <span className="text-zinc-500">/ {route.company_name}</span></>)),
  stops:lines(normalized.stops.slice(0,50).map(stop=>`${stop.route_key.split('|')[1]} #${stop.stop_order} · ${stop.point_code}`)),
 };
 async function execute(){
  if(!editable||lock.current)return;if(!ready){toast('먼저 CSV를 업로드하세요','error');return;}
  lock.current=true;setRunning(true);setLogs([]);
  const log=(message:string,cls='')=>setLogs(previous=>[...previous,{text:`[${new Date().toLocaleTimeString()}] ${message}`,cls}]);
  try{log(`▶ 시작 (${dryRun?'DRY-RUN':'실제 저장'}) / 대상 센터: ${center.name}`);await executeImport(normalized,center,dryRun,replaceStops,log);toast('가져오기 완료','success');}
  catch(error){const message=error instanceof Error?error.message:String(error);log(`❌ 오류: ${message}`,'text-red-400');toast(`실패: ${message}`,'error');}
  finally{lock.current=false;setRunning(false);}
 }
 return <>
<main className="app-main max-w-7xl mx-auto px-4 py-6 space-y-6" id="work-main" tabIndex={-1}><WorkflowNavigation steps={[["work-section-1", "CSV 파일 선택"], ["step-mapping", "컬럼 확인·수정"], ["step-preview", "미리보기 확인"], ["step-execute", "DB에 저장"]]} />

  
  <FileArea as="section" id="work-section-1" accept=".csv,text/csv" disabled={running || !editable} onFiles={files=>{if(files[0])readCsv(files[0]);}} className="bg-zinc-800/40 border border-zinc-700 rounded-lg p-4">
    <h2 className="font-semibold mb-3">1단계 · CSV 파일 선택</h2>
    <div className="flex flex-wrap items-center gap-3">
      <input onChange={event => { const file=event.target.files?.[0];if(file)readCsv(file); }} aria-label="CSV 파일 선택" type="file" id="csv-file" accept=".csv,text/csv" className="text-sm file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 file:cursor-pointer" />
      <span id="file-info" className="text-xs text-zinc-400">{fileInfo}</span>
    </div>
    <details className="mt-3 text-xs text-zinc-400">
      <summary className="cursor-pointer hover:text-zinc-200">엑셀에서 헤더를 어떻게 정리해야 하나요?</summary>
      <div className="mt-2 pl-3 border-l border-zinc-700">
        <p>1행에 다음 헤더(또는 유사 이름)가 있어야 합니다. 정확히 일치하지 않아도 2단계에서 수동 매핑 가능:</p>
        <code className="block bg-zinc-900 rounded p-2 mt-1 text-zinc-300 whitespace-pre">호차, 운수사, 코스명, 톤수, 차량번호, 운전자명, 연락처, 입차시간, 하차시작, 하차종료, 납품마감, 코드, 납품처명, 1톤이하, 3.5톤이하, 5톤이상, 무인야적납, 대면, 검수, 무인, 보안키, 열쇠, 없음, 창고, 탑차, 야적, 주소, 열쇠보관장소, 비밀번호, 비고</code>
      </div>
    </details>
  </FileArea>

  
  <section id="step-mapping" className={`bg-zinc-800/40 border border-zinc-700 rounded-lg p-4${ready ? "" : " hidden"}`}>
    <h2 className="font-semibold mb-3">2단계 · 컬럼 매핑 확인</h2>
    <p className="text-xs text-zinc-400 mb-3">CSV의 컬럼명을 시스템 필드에 연결합니다. 자동 인식되지 않은 항목은 직접 선택하세요.</p>
    <div id="mapping-grid" className="grid grid-cols-1 md:grid-cols-2 gap-2">{FIELDS.map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm bg-zinc-900/60 rounded px-2 py-1.5"><span className="w-28 text-zinc-400 shrink-0">{label}</span><select data-field={key} className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-100" value={mapping[key]||""} onChange={event=>setMapping(previous=>({...previous,[key]:event.target.value}))}><option value="">— 사용 안 함 —</option>{headers.map(header=><option key={header} value={header}>{header}</option>)}</select></label>)}</div>
  </section>

  
  <section id="step-preview" className={`bg-zinc-800/40 border border-zinc-700 rounded-lg p-4${ready ? "" : " hidden"}`}>
    <h2 className="font-semibold mb-3">3단계 · 정규화 미리보기</h2>
    <div id="summary-cards" className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">{cards.map(([label,count])=><div key={label} className="bg-zinc-900 rounded p-2 text-center"><div className="text-xs text-zinc-400">{label}</div><div className="text-xl font-bold text-emerald-400">{count}</div></div>)}</div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div>
        <h3 className="text-sm font-semibold mb-1">회사 (companies)</h3>
        <div id="preview-companies" className="bg-zinc-900 rounded p-2 max-h-40 overflow-auto text-xs">{previews.companies}</div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">기사 (drivers)</h3>
        <div id="preview-drivers" className="bg-zinc-900 rounded p-2 max-h-40 overflow-auto text-xs">{previews.drivers}</div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">차량 (vehicles)</h3>
        <div id="preview-vehicles" className="bg-zinc-900 rounded p-2 max-h-40 overflow-auto text-xs">{previews.vehicles}</div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">납품처 (delivery_points)</h3>
        <div id="preview-points" className="bg-zinc-900 rounded p-2 max-h-40 overflow-auto text-xs">{previews.points}</div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">코스 (routes)</h3>
        <div id="preview-routes" className="bg-zinc-900 rounded p-2 max-h-40 overflow-auto text-xs">{previews.routes}</div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">납품처 항목 (route_stops)</h3>
        <div id="preview-stops" className="bg-zinc-900 rounded p-2 max-h-40 overflow-auto text-xs">{previews.stops}</div>
      </div>
    </div>

    <details className="mt-4">
      <summary className="cursor-pointer text-sm text-zinc-300 hover:text-zinc-100">⚠️ 경고/스킵된 행 보기 (<span id="warn-count">{normalized.warnings.length}</span>건)</summary>
      <div id="warnings" className="bg-zinc-900 rounded p-2 mt-2 max-h-60 overflow-auto text-xs space-y-1">{normalized.warnings.length ? normalized.warnings.map((warning,index)=><div key={index} className="text-amber-300/90">{warning}</div>) : <i className="text-zinc-500">경고 없음</i>}</div>
    </details>
  </section>

  
  <section id="step-execute" className={`bg-zinc-800/40 border border-zinc-700 rounded-lg p-4${ready ? "" : " hidden"}`}>
    <h2 className="font-semibold mb-3">4단계 · DB에 저장</h2><p className="text-sm mb-3">같은 코스의 납품 순서가 있으면 기존 납품처 항목을 덮어씁니다.</p>
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" id="opt-replace-stops" checked={replaceStops} onChange={event=>setReplaceStops(event.target.checked)} className="accent-emerald-500" />
        기존 코스의 납품처 항목을 모두 삭제하고 다시 입력 (권장)
      </label>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" id="opt-dry-run" checked={dryRun} onChange={event=>setDryRun(event.target.checked)} className="accent-amber-500" />
        Dry-run (실제 저장 없이 SQL 카운트만 확인)
      </label>
    </div>
    <button id="btn-execute" disabled={running || !editable} onClick={() => void execute()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded font-semibold">
      🚀 DB에 저장 시작
    </button>
    <div id="exec-log" className="mt-3 bg-zinc-900 rounded p-3 text-xs font-mono space-y-1 max-h-96 overflow-auto">{logs.map((entry,index)=><div key={index} className={entry.cls}>{entry.text}</div>)}<span ref={logEnd}/></div>
  </section>

</main>{feedback}</>;
}
export default function CourseImport(){return <AdminPage title="📥 코스표 일괄 가져오기" minRole="admin"><CourseImportContent/></AdminPage>;}
