import '../styles/common.css';
import '../styles/daily-temperature.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { FileArea } from '../components/FileArea';
import { useClipboard } from '../components/useClipboard';
import { readTemperatureTemplate, downloadTemperatureWorkbook } from '../lib/daily-temperature';
import { FIELDS, ROLE_ORDER, VB_SELECTION_CHANGE_CODE, normalizeDay, normalizeRole, parseDay, parseDispatchParserRows, parseEmbeddedDispatch, makeNewRow, insertRowsByRole, sortRowsByRole, renumberRows, updateDerivedFields, buildMailSubject, buildMailBody } from '../domain/daily-temperature';
import type { TemperatureDefaults, TemperatureField, TemperatureRow, TemperatureTemplate } from '../domain/daily-temperature';
function renumberCopy(rows:TemperatureRow[]){const next=rows.map(row=>({...row}));renumberRows(next);return next;}
function DailyTemperatureContent(){
 const {center}=useAdminPage(),{copy,clipboard}=useClipboard();
 const [template,setTemplate]=useState<TemperatureTemplate|null>(null),[templateInfo,setTemplateInfo]=useState<ReactNode>('저장된 기본 템플릿을 불러오는 중...');
 const [defaults,setDefaults]=useState<TemperatureDefaults>({branch:'운영6지사',center:'안산사조센터',day:'',partition:'X'}),[addRole,setAddRole]=useState('임시'),[addText,setAddText]=useState('');
 const [parserOpen,setParserOpen]=useState(false),[parserRaw,setParserRaw]=useState(''),[parserRecords,setParserRecords]=useState<ReturnType<typeof parseEmbeddedDispatch>>([]);
 const [notice,setNotice]=useState({text:'',type:'info',shown:false}),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const toast=useCallback((text:string,type='info')=>{clearTimeout(timer.current);setNotice({text,type,shown:true});timer.current=setTimeout(()=>setNotice(previous=>({...previous,shown:false})),2600);},[]);
 const fileName=center.code==='002'?'one-top-two-room-template_PYT.xlsx':'one-top-two-room-template.xlsx',url='/templates/'+fileName,sourceName=center.code==='002'?'저장된 평택 기본 템플릿':'저장된 안산 기본 템플릿';
 const config={path:'repo-root/templates/'+fileName};
 const generation=useRef(0),initial=useRef<Promise<TemperatureTemplate>|null>(null),parserInput=useRef<HTMLTextAreaElement>(null);
 const applyTemplate=useCallback((next:TemperatureTemplate,name:string,detail:string,kind:'default'|'upload')=>{
  setTemplate(next);const first=next.rows[0];if(first)setDefaults(previous=>({...previous,branch:first.branch||previous.branch,center:first.center||previous.center,day:parseDay(first.date)?String(parseDay(first.date)):previous.day}));
  setTemplateInfo(<><div className="font-medium text-zinc-200">{name}</div><div>구분: {kind==='default'?'저장된 기본 템플릿':'임시 업로드 템플릿'}</div><div>Sheet1: {next.worksheetName} · 편집 대상 {next.rows.length}행</div><div className="mt-1 text-zinc-500">{detail}</div></>);
 },[]);
 const loadDefault=useCallback(async(showToast=false,reuse=false)=>{
  const token=++generation.current;setTemplateInfo(<><div className="font-medium text-zinc-200">{sourceName}</div><div>저장 위치에서 기본 템플릿을 불러오는 중...</div></>);
  try{const request=reuse&&initial.current?initial.current:(async()=>{const response=await fetch(`${url}?v=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw new Error(`기본 템플릿 파일을 찾을 수 없습니다. (${response.status})`);return readTemperatureTemplate(await response.arrayBuffer());})();initial.current=request;const next=await request;if(token!==generation.current)return;applyTemplate(next,sourceName,url,'default');if(showToast)toast('저장된 기본 템플릿을 다시 불러왔습니다.','success');}
  catch(error){if(token!==generation.current)return;const message=error instanceof Error?error.message:String(error);setTemplate(null);setTemplateInfo(<><div className="font-medium text-amber-200">저장된 기본 템플릿을 불러오지 못했습니다.</div><div>{message}</div><div className="mt-1">기본 파일을 <code>{url}</code>에 올리거나, 위 입력으로 임시 업로드하세요.</div></>);if(showToast)toast(`기본 템플릿을 불러오지 못했습니다: ${message}`,'error');}
 },[sourceName,url,applyTemplate,toast]);
 useEffect(()=>{void loadDefault(false,true);return()=>{generation.current++;clearTimeout(timer.current);};},[loadDefault]);
 useEffect(()=>{if(parserOpen)parserInput.current?.focus();},[parserOpen]);
 async function upload(file:File){const token=++generation.current;try{const next=await readTemperatureTemplate(await file.arrayBuffer());if(token!==generation.current)return;applyTemplate(next,file.name,'업로드 파일로 현재 작업 템플릿을 임시 교체했습니다.','upload');toast('업로드한 템플릿으로 교체했습니다.','success');}catch(error){if(token===generation.current)toast(`템플릿을 읽지 못했습니다: ${error instanceof Error?error.message:String(error)}`,'error');}}
 function updateCell(index:number,field:TemperatureField,value:string){setTemplate(previous=>{if(!previous)return previous;let rows=previous.rows.map(row=>({...row}));if(!rows[index])return previous;rows[index][field]=value;if(field==='vehicle_type'){rows[index][field]=normalizeRole(value)||value;rows=sortRowsByRole(rows);renumberRows(rows);}else if(['freezer_temp','refrigerated_temp','partition_wall'].includes(field))updateDerivedFields(rows[index]);return {...previous,rows};});}
 function addRows(){if(!template){toast('먼저 템플릿 Excel을 업로드하세요.','error');return;}const role=normalizeRole(addRole)||'임시',parsed=parseDispatchParserRows(addText.trim());if(!parsed.length){toast('추가할 배차정보 파서 값을 입력하세요.','error');return;}const next=template.rows.map(row=>({...row})),added=parsed.map(item=>makeNewRow(role,item.dm,item.vehicle_no,'이안물류',defaults));insertRowsByRole(next,added,role);const rows=sortRowsByRole(next);renumberRows(rows);setTemplate({...template,rows});setAddText('');toast(`${role} ${added.length}행을 추가했습니다.`,'success');}
 function applyDay(){const day=normalizeDay(defaults.day);if(!day){toast('점검일자 일을 입력하세요.','error');return;}setTemplate(previous=>previous?{...previous,rows:previous.rows.map(row=>({...row,date:day}))}:previous);toast(`점검일자를 ${day}로 적용했습니다.`,'success');}
 function runParser(){const records=parseEmbeddedDispatch(parserRaw);setParserRecords(records);if(!records.length)toast('파싱된 배차정보가 없습니다.','error');}
 function applyParser(){if(!parserRecords.length)return;setAddText(parserRecords.map(record=>[record.name,record.ton,record.driver,record.vehicle,record.phone].join('\t')).join('\n'));setParserOpen(false);toast(`배차정보 ${parserRecords.length}건을 입력칸에 가져왔습니다.`,'success');}
 async function copyValue(text:string,label:string){try{await copy(text);toast(`${label}${label==='VB 코드'?'를':'을'} 복사했습니다.`,'success');}catch(error){toast(`${label} 복사 실패: ${error instanceof Error?error.message:String(error)}`,'error');}}
 const downloadRef=useRef<HTMLAnchorElement>(null),[downloadUrl,setDownloadUrl]=useState<{url:string;name:string}|null>(null);
 useEffect(()=>{if(!downloadUrl)return;downloadRef.current?.click();const timeout=setTimeout(()=>URL.revokeObjectURL(downloadUrl.url),1000);return()=>{clearTimeout(timeout);URL.revokeObjectURL(downloadUrl.url);};},[downloadUrl]);
 async function download(){if(!template||!template.rows.length)return;try{const blob=await downloadTemperatureWorkbook(template),now=new Date(),yy=String(now.getFullYear()).slice(-2),mm=String(now.getMonth()+1).padStart(2,'0'),dd=String(parseDay(defaults.day)||now.getDate()).padStart(2,'0'),name=`${defaults.center.trim()||'안산사조센터'} 일일 온도점검_${yy}${mm}${dd}.xlsx`;setDownloadUrl({url:URL.createObjectURL(blob),name});toast('Excel 파일을 다운로드했습니다.','success');}catch(error){toast(`다운로드 생성 실패: ${error instanceof Error?error.message:String(error)}`,'error');}}
 const editorRows=template?.rows.map((row,index)=><tr key={index} className="border-b border-zinc-800 hover:bg-zinc-800/40" data-index={index}>{FIELDS.map(field=><td key={field} className="px-1 py-1">{field==='vehicle_type'?<div className="flex items-center gap-2"><select className="editor-select min-w-[5.5rem]" data-index={index} data-field={field} value={row[field]} onChange={event=>updateCell(index,field,event.target.value)}>{ROLE_ORDER.map(role=><option key={role} value={role}>{role}</option>)}</select><span className={`role-pill ${row.vehicle_type==='고정'?'role-fixed':row.vehicle_type==='광역'?'role-wide':'role-temp'}`}>{row.vehicle_type||'-'}</span></div>:field==='partition_wall'?<select className="editor-select" data-index={index} data-field={field} value={row[field]} onChange={event=>updateCell(index,field,event.target.value)}>{['','O','X'].map(value=><option key={value} value={value}>{value||'공란'}</option>)}</select>:<input className={`editor-input ${field==='seq'?'w-16':field==='date'?'w-24':''}`} data-index={index} data-field={field} value={row[field]??''} onChange={event=>updateCell(index,field,event.target.value)}/>}</td>)}<td className="px-2 py-1 text-center"><button className="text-xs text-rose-300 hover:text-rose-200" data-delete={index} onClick={()=>setTemplate(previous=>previous?{...previous,rows:renumberCopy(previous.rows.filter((_,i)=>i!==index))}:previous)}>삭제</button></td></tr>);
 return <>
<main className="app-main flex-1 max-w-[1500px] w-full mx-auto px-4 py-6 space-y-5" id="work-main" tabIndex={-1}>
    <section className="border border-zinc-700 rounded-lg bg-zinc-800/40 p-4">
      <details className="readability-guide">
      <summary>작업 방법 · 처음 사용하는 경우</summary>
      <ol className="text-xs text-zinc-400 space-y-1 list-decimal list-inside leading-relaxed">
        <li>저장된 기본 템플릿을 먼저 자동으로 불러오고, 필요할 때만 업로드 파일로 임시 교체합니다.</li>
        <li>템플릿은 Sheet1, <code>5행</code>부터 <code>B~R열</code>을 편집 대상으로 불러옵니다.</li>
        <li><code>I열</code> 차량 구분은 <strong>고정 → 광역 → 임시</strong> 순서를 유지합니다.</li>
        <li>추가 기사 정보는 <code>G열 담당자</code>, <code>H열 차량번호</code>에 들어가며 선택한 구분의 마지막 행 아래에 삽입됩니다.</li>
        <li>삽입 행은 지사/센터/날짜/운송사/기본값을 자동으로 채우고, <code>J~M</code>, <code>P~R</code>은 공란으로 둡니다.</li>
        <li>결과는 DB 저장 없이 Excel 파일로만 다운로드합니다.</li>
      </ol>
      </details>
    </section>

    <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <FileArea className="drop-card rounded-lg p-4 xl:col-span-1" data-drop="template" accept=".xlsx,.xlsm" onFiles={files=>{if(files[0])void upload(files[0]);}}>
        <div className="flex items-center gap-2 mb-3">
          <span className="step-badge">1</span>
          <div>
            <div className="text-sm font-semibold">기준 템플릿</div>
            <div className="text-xs text-zinc-500">저장된 기본 템플릿을 우선 사용합니다.</div>
          </div>
        </div>
        <details className="readability-guide text-xs text-zinc-400 leading-relaxed mb-3">
          <summary>기본 템플릿 관리 정보</summary>
          기본 저장 위치: <code id="default-template-path" className="text-emerald-300">{config.path}</code><br />
          GitHub에서 이 파일만 교체하면 다음 접속부터 기본 템플릿으로 사용됩니다.
        </details>
        <div className="flex flex-wrap gap-2 mb-3">
          <button id="reload-default-btn" onClick={() => void loadDefault(true)} className="btn btn-ghost text-xs" type="button">저장된 기본 템플릿 다시 불러오기</button>
        </div>
        <label className="app-label">필요 시 임시 업로드로 교체</label>
        <input id="template-file" onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);}} type="file" accept=".xlsx,.xlsm" className="w-full text-sm" />
        <div id="template-info" className="mt-3 text-xs text-zinc-400">{templateInfo}</div>
      </FileArea>

      <div className="border border-zinc-700 rounded-lg bg-zinc-800/40 p-4 xl:col-span-2">
        <div className="flex items-center gap-2 mb-3">
          <span className="step-badge">2</span>
          <div>
            <div className="text-sm font-semibold">공통 자동 입력값</div>
            <div className="text-xs text-zinc-500">새로 추가되는 행과 날짜 일괄 적용에 사용합니다.</div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="app-label" htmlFor="default-branch">지사</label>
            <input id="default-branch" className="app-input" value={defaults.branch} onChange={event=>setDefaults(previous=>({...previous,branch:event.target.value}))} />
          </div>
          <div>
            <label className="app-label" htmlFor="default-center">센터명</label>
            <input id="default-center" className="app-input" value={defaults.center} onChange={event=>setDefaults(previous=>({...previous,center:event.target.value}))} />
          </div>
          <div>
            <label className="app-label" htmlFor="default-day">점검일자</label>
            <div className="flex gap-2">
              <input id="default-day" value={defaults.day} onChange={event=>setDefaults(previous=>({...previous,day:event.target.value}))} type="number" min="1" max="31" className="app-input" placeholder="일" />
              <span className="self-center text-xs text-zinc-400">일</span>
            </div>
          </div>
          <div>
            <label className="app-label" htmlFor="default-partition">구획분리</label>
            <select id="default-partition" value={defaults.partition} onChange={event=>setDefaults(previous=>({...previous,partition:event.target.value}))} className="app-select">
              <option value="X">X</option>
              <option value="O">O</option>
              <option value="">공란</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button id="apply-day-btn" onClick={applyDay} className="btn btn-ghost" disabled={!template || !template.rows.length}>날짜 전체 적용</button>
          <button id="renumber-btn" onClick={() => {setTemplate(previous=>previous?{...previous,rows:renumberCopy(previous.rows)}:previous);toast("순번을 재정렬했습니다.","success");}} className="btn btn-ghost" disabled={!template || !template.rows.length}>순번 재정렬</button>
          <span className="text-xs text-zinc-500">점검일자는 모든 행에 같은 “nn일” 형태로 적용할 수 있습니다.</span>
        </div>
      </div>
    </section>

    <section className="border border-zinc-700 rounded-lg bg-zinc-800/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="step-badge">3</span>
        <div>
          <div className="text-sm font-semibold">기사/차량 추가</div>
          <div className="text-xs text-zinc-500">복붙 입력을 지원합니다. 기사명과 차량번호 조합은 한 행으로 유지됩니다.</div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-2">
          <label className="app-label" htmlFor="add-role">추가 구분</label>
          <select id="add-role" value={addRole} onChange={event=>setAddRole(event.target.value)} className="app-select">
            <option value="임시">임시</option>
            <option value="광역">광역</option>
          </select>
        </div>
        <div className="lg:col-span-10">
          <label className="app-label" htmlFor="add-text">배차정보 파서 값 붙여넣기</label>
          <textarea id="add-text" value={addText} onChange={event=>setAddText(event.target.value)} rows={7} className="app-input font-mono text-xs" placeholder="배차정보 파서의 전체 TSV 또는 결과값을 붙여넣으세요.\n예) 거래처명\t톤수\t기사명\t차량번호\t연락처\n한마루\t11톤\t이찬모\t경기92아5150\t01088582377\n또는 한마루\\11톤\\이찬모\\경기92아5150\\01088582377"></textarea>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button id="open-parser-btn" onClick={() => setParserOpen(true)} className="btn btn-ghost" type="button">배차정보 파서 열기</button>
        <button id="add-rows-btn" onClick={addRows} className="btn btn-primary" disabled={!template}>선택 구분으로 행 추가</button>
        <span className="text-xs text-zinc-500">기본 구분은 임시입니다. 필요한 경우 광역으로 바꾼 뒤 붙여넣으세요. 운송사는 항상 이안물류로 입력됩니다.</span>
      </div>
    </section>

    <section className="border border-zinc-700 rounded-lg overflow-hidden">
      <div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex flex-wrap items-center gap-2">
        <span className="step-badge">4</span>
        <span className="text-sm font-semibold">웹 편집 미리보기</span>
        <span id="row-count" className="text-xs text-zinc-400">{template?.rows.length ? `총 ${template.rows.length}행` : ""}</span>
        <div className="flex-1"></div>
        <button id="copy-vba-btn" onClick={() => void copyValue(VB_SELECTION_CHANGE_CODE,"VB 코드")} className="btn btn-ghost" type="button">VB코드복사</button>
        <button id="copy-mail-subject-btn" onClick={() => void copyValue(buildMailSubject(),"메일 제목")} className="btn btn-ghost" type="button">메일제목</button>
        <button id="copy-mail-body-btn" onClick={() => void copyValue(buildMailBody(),"메일 내용")} className="btn btn-ghost" type="button">메일내용</button>
        <button id="download-btn" onClick={() => void download()} className="btn btn-primary" disabled={!template || !template.rows.length}>Excel 다운로드</button>
      </div>
      <div className="overflow-auto max-h-[62vh]">
        <table className="editor-table min-w-[1800px] w-full text-xs">
          <thead className="bg-zinc-900/80 sticky top-0 z-10">
            <tr className="text-zinc-300 border-b border-zinc-700">
              <th className="px-2 py-2 text-left w-16">순번</th>
              <th className="px-2 py-2 text-left">지사</th>
              <th className="px-2 py-2 text-left">센터명</th>
              <th className="px-2 py-2 text-left w-24">점검일자</th>
              <th className="px-2 py-2 text-left">운송사</th>
              <th className="px-2 py-2 text-left">담당자</th>
              <th className="px-2 py-2 text-left">차량번호</th>
              <th className="px-2 py-2 text-left w-24">구분</th>
              <th className="px-2 py-2 text-left">냉동온도</th>
              <th className="px-2 py-2 text-left">냉장온도</th>
              <th className="px-2 py-2 text-left">냉동 정상</th>
              <th className="px-2 py-2 text-left">냉장 정상</th>
              <th className="px-2 py-2 text-left">준수</th>
              <th className="px-2 py-2 text-left">구획분리</th>
              <th className="px-2 py-2 text-left">구획분리 사진</th>
              <th className="px-2 py-2 text-left">온도기록지 사진</th>
              <th className="px-2 py-2 text-left">비고</th>
              <th className="px-2 py-2 text-left w-16">삭제</th>
            </tr>
          </thead>
          <tbody id="editor-body">{editorRows}</tbody>
        </table>
      </div>
      <div id="empty-state" className={`p-8 text-center text-sm text-zinc-500${template?.rows.length ? " hidden" : ""}`}>저장된 기본 템플릿을 불러오거나, 필요 시 Excel을 업로드하면 편집 표가 표시됩니다.</div>
    </section>
  </main><div id="parser-modal" className={`fixed inset-0 z-50 ${parserOpen ? "flex" : "hidden"} items-center justify-center bg-black/70 px-4 py-6`}>
    <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col">
      <div className="p-4 border-b border-zinc-700 flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-sky-600/20 border border-sky-600/40 flex items-center justify-center">🔎</div>
        <div>
          <h2 className="text-sm font-semibold">배차정보 파서</h2>
          <p className="text-xs text-zinc-400">배차 문자를 붙여넣고 파싱한 뒤, 결과를 추가차량 입력칸으로 가져옵니다.</p>
        </div>
        <div className="flex-1"></div>
        <button id="parser-close-btn" onClick={() => setParserOpen(false)} className="btn btn-ghost text-xs" type="button">닫기</button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 overflow-auto">
        <div className="space-y-2">
          <label className="app-label">배차 원문</label>
          <textarea id="parser-raw" ref={parserInput} value={parserRaw} onChange={event=>setParserRaw(event.target.value)} rows={18} className="app-input font-mono text-xs" placeholder="예)\n한마루 곤지암 11톤 2대\n이찬모 경기92아5150\n01088582377\n\n윤현식 경기92바6221\n01062041457"></textarea>
          <div className="flex flex-wrap items-center gap-2">
            <button id="parser-run-btn" onClick={runParser} className="btn btn-primary" type="button">파싱 실행</button>
            <button id="parser-clear-btn" onClick={() => {setParserRaw("");setParserRecords([]);}} className="btn btn-ghost" type="button">지우기</button>
            <span id="parser-count" className="text-xs text-zinc-400">{parserRecords.length ? `${parserRecords.length}건` : ""}</span>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="app-label mb-0">파싱 결과</label>
            <div className="flex-1"></div>
            <button id="parser-apply-btn" onClick={applyParser} className="btn btn-primary" type="button" disabled={!parserRecords.length}>결과 가져오기</button>
          </div>
          <div className="overflow-auto max-h-[430px] border border-zinc-700 rounded-lg">
            <table className="w-full min-w-[680px] text-xs">
              <thead className="bg-zinc-800 sticky top-0">
                <tr className="text-zinc-300 border-b border-zinc-700">
                  <th className="px-2 py-2 text-left">거래처명</th>
                  <th className="px-2 py-2 text-left">톤수</th>
                  <th className="px-2 py-2 text-left">기사명</th>
                  <th className="px-2 py-2 text-left">차량번호</th>
                  <th className="px-2 py-2 text-left">연락처</th>
                </tr>
              </thead>
              <tbody id="parser-preview-body">{parserRecords.length ? parserRecords.map((record,index)=><tr key={index} className="border-b border-zinc-800"><td className="px-2 py-1.5">{record.name}</td><td className="px-2 py-1.5 text-zinc-300">{record.ton}</td><td className="px-2 py-1.5">{record.driver}</td><td className="px-2 py-1.5 font-mono">{record.vehicle}</td><td className="px-2 py-1.5 font-mono text-zinc-300">{record.phone}</td></tr>) : <tr><td colSpan={5} className="px-3 py-8 text-center text-zinc-500">파싱 결과가 없습니다.</td></tr>}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div><div id="toast" className={`fixed left-1/2 bottom-6 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-xl pointer-events-none${notice.shown?' show':' opacity-0 translate-y-2'} ${notice.type==='error'?'bg-rose-950/95 border border-rose-700 text-rose-100':notice.type==='success'?'bg-emerald-950/95 border border-emerald-700 text-emerald-100':'bg-zinc-800 border border-zinc-700 text-zinc-100'}`}>{notice.text}</div><a ref={downloadRef} hidden href={downloadUrl?.url} download={downloadUrl?.name}/>{clipboard}</>;
}
export default function DailyTemperature(){return <AdminPage title="1탑2실 템플릿 생성" bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><DailyTemperatureContent/></AdminPage>;}
