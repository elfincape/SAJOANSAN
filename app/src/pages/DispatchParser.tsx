import '../styles/common.css';
import '../styles/dispatch-parser.css';
import { useEffect, useRef, useState } from 'react';
import { AdminPage } from '../components/AdminPage';
import { parseDispatch, resultValue } from '../domain/dispatch-parser';
import type { DispatchRecord } from '../domain/dispatch-parser';

const columns = [['name', '거래처명'], ['ton', '톤수'], ['driver', '기사명'], ['vehicle', '차량번호'], ['phone', '연락처'], ['result', '결과값']] as const;
export default function DispatchParser() {
  const [raw, setRaw] = useState('');
  const [records, setRecords] = useState<DispatchRecord[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [toast, setToast] = useState({ text: '복사됨', error: false, visible: false });
  const [fallback, setFallback] = useState<{ text: string; message: string } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const section = useRef<HTMLElement>(null);
  const clipboard = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!fallback || !clipboard.current) return;
    clipboard.current.select(); document.execCommand('copy');
    setFallback(null); showToast(fallback.message);
  }, [fallback]);
  function showToast(text: string, error = false) {
    clearTimeout(timer.current); setToast({ text, error, visible: true });
    timer.current = setTimeout(() => setToast(item => ({ ...item, visible: false })), 2000);
  }
  function copy(text: string, message: string) {
    void navigator.clipboard.writeText(text).then(() => showToast(message)).catch(() => setFallback({ text, message }));
  }
  function runParse() {
    if (!raw.trim()) { showToast('원문을 입력하세요', true); return; }
    const next = parseDispatch(raw); setRecords(next); setShowResults(true);
    if (next.length) requestAnimationFrame(() => section.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  return <AdminPage title="배차정보 파서" bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col">
    <main id="work-main" tabIndex={-1} className="app-main flex-1 max-w-[1200px] w-full mx-auto px-4 py-6 flex flex-col gap-5">
      <section className="border border-zinc-700 rounded-lg overflow-hidden">
        <div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex flex-wrap items-center gap-2"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-400" /><span className="text-sm font-medium">배차 원문</span></div><div className="flex-1" /><button id="clear-btn" className="btn btn-ghost text-xs" onClick={() => { setRaw(''); setShowResults(false); setRecords([]); input.current?.focus(); }}>지우기</button><button id="parse-btn" className="btn btn-primary" onClick={runParse}>▶ 파싱 실행</button></div>
        <div className="p-3"><textarea ref={input} id="raw-input" className="app-textarea w-full" rows={9} value={raw} onChange={event => setRaw(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); runParse(); } }} /></div>
        <div className="px-3 pb-2 text-xs text-zinc-500">※ 레코드 구분자 <code> / </code> (공백·슬래시·공백) &nbsp;|&nbsp; <kbd className="bg-zinc-700 px-1 py-0.5 rounded text-zinc-300">Ctrl</kbd>+<kbd className="bg-zinc-700 px-1 py-0.5 rounded text-zinc-300">Enter</kbd> 로 파싱</div>
      </section>
      <section ref={section} id="result-section" className={`border border-zinc-700 rounded-lg overflow-hidden${showResults ? '' : ' hidden'}`}>
        <div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex flex-wrap items-center gap-2"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /><span className="text-sm font-medium">파싱 결과</span></div><span id="result-count" className="text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">{records.length}건</span><div className="flex-1" />
          <button id="copy-tsv-btn" className="btn btn-ghost text-xs" onClick={() => { if (records.length) copy(['거래처명\t톤수\t기사명\t차량번호\t연락처', ...records.map(r => [r.name, r.ton, r.driver, r.vehicle, r.phone].join('\t'))].join('\n'), `전체 ${records.length}건 TSV 복사됨`); }}>전체 TSV 복사</button>
          <button id="copy-all-btn" className="btn btn-ghost text-xs" onClick={() => { if (records.length) copy(records.map(resultValue).join(','), `전체 ${records.length}건 복사됨`); }}>전체 결과값 복사</button>
        </div>
        <div className="overflow-x-auto"><table className="app-table"><thead><tr><th className="w-8 text-center text-zinc-500 select-none">#</th>{columns.map(([key, label]) => <th key={key} className={`col-copy${key === 'ton' ? ' w-14 text-center' : ''}`} data-col={key} onClick={() => {
          const values = records.map(r => key === 'result' ? resultValue(r) : r[key] || '').filter(value => value.length > 0);
          if (values.length) copy(values.join('\n'), `${label} ${values.length}건 복사됨`);
        }}>{label}<span className="copy-icon">⎘</span></th>)}</tr></thead>
          <tbody id="result-body">{records.length ? records.map((record, index) => <tr key={index} className={`result-row ${record._warn ? 'row-warn ' : ''}${dragIndex === index ? 'dragging ' : ''}${dragOver === index ? 'drag-over' : ''}`} draggable data-index={index} onDragStart={event => { setDragIndex(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }} onDragOver={event => { event.preventDefault(); setDragOver(index); event.dataTransfer.dropEffect = 'move'; }} onDragLeave={() => setDragOver(null)} onDrop={event => {
            event.preventDefault(); setDragOver(null);
            const from = dragIndex ?? Number(event.dataTransfer.getData('text/plain'));
            if (!Number.isInteger(from) || from === index || !records[from]) return;
            const next = [...records]; const [item] = next.splice(from, 1); next.splice(index, 0, item); setRecords(next);
            showToast(`순서 변경: ${from + 1} → ${index + 1}`);
          }} onDragEnd={() => { setDragIndex(null); setDragOver(null); }}>
            <td className="text-center text-zinc-500 text-xs select-none"><span className="drag-handle" title="끌어서 순서 변경" aria-label="순서 변경">⋮⋮</span><span className="row-number">{index + 1}</span></td>
            <td className="font-medium">{record.name}</td><td className="text-center text-zinc-300">{record.ton || <span className="text-zinc-600">-</span>}</td><td>{record.driver || <span className="text-zinc-600">-</span>}</td><td className="font-mono text-xs">{record.vehicle || <span className="text-zinc-600">-</span>}</td><td className="font-mono text-xs">{record.phone || <span className="text-zinc-600">-</span>}</td><td className="result-cell text-emerald-400 font-mono text-xs" title={resultValue(record)}>{resultValue(record)}</td>
          </tr>) : <tr><td colSpan={7} className="text-center text-zinc-400 py-8 text-sm">파싱된 데이터가 없습니다.<br /><span className="text-xs text-zinc-500 mt-1 block">레코드 구분자 <code> / </code> 와 3줄 구조를 확인하세요.</span></td></tr>}</tbody>
        </table></div>
        <div className="p-3 border-t border-zinc-700 bg-zinc-800/30 flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" /></svg><p className="text-xs text-zinc-400">열 제목(거래처명·톤수·기사명·차량번호·연락처·결과값)을 클릭하면 해당 열의 전체 값이 복사됩니다. 결과 행은 왼쪽 핸들을 끌어서 순서를 바꿀 수 있습니다.</p></div>
      </section>
    </main>
    <div id="toast" className={`fixed bottom-6 left-1/2 z-50 pointer-events-none opacity-0 -translate-x-1/2 translate-y-2 bg-zinc-700 border border-zinc-600 text-zinc-100 text-xs px-4 py-2 rounded-full shadow-xl flex items-center gap-1.5${toast.visible ? ' show' : ''}`} style={{ borderColor: toast.error ? '#ef4444' : '' }}><svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg><span id="toast-msg">{toast.text}</span></div>
    {fallback ? <textarea ref={clipboard} readOnly value={fallback.text} style={{ position: 'fixed', opacity: 0, top: 0, left: 0 }} /> : null}
  </AdminPage>;
}
