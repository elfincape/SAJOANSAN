import '../styles/common.css';
import '../styles/excel-compare.css';
import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { AdminPage } from '../components/AdminPage';
import { FileArea } from '../components/FileArea';
import { readCompareSheet, compareSheets, buildCompareWorkbook, resultColumns, resultValues } from '../domain/excel-compare';
import type { CompareData, Comparison, CompareOptions, ExportConfig } from '../domain/excel-compare';

type Side = 'left' | 'right';
interface Source { book: XLSX.WorkBook | null; data: CompareData | null; name: string; sheet: string; header: string; info: string }
interface Pair { id: number; left: number | null; right: number | null }
interface Result { comparison: Comparison; config: ExportConfig }
const sides: Side[] = ['left', 'right'];
const emptySource = (): Source => ({ book: null, data: null, name: '', sheet: '', header: '1', info: '선택된 파일 없음 · 파일당 최대 20MB' });
export default function ExcelCompare() {
  const [sources, setSources] = useState({ left: emptySource(), right: emptySource() });
  const [pairs, setPairs] = useState<Pair[]>([]);
  const nextId = useRef(0), revisions = useRef({ left: 0, right: 0 });
  const [imports, setImports] = useState({ left: [] as number[], right: [] as number[] });
  const [options, setOptions] = useState<CompareOptions>({ trim: true, ignoreCase: false, duplicates: 'occurrence', valueMode: 'raw' });
  const [existsOnly, setExistsOnly] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ text: '비교할 엑셀 파일 두 개를 선택해 주세요.', error: false });
  const [side, setSide] = useState<Side>('left');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const bothReady = !!sources.left.data && !!sources.right.data;
  const message = (text: string, error = false) => setStatus({ text, error });
  function invalidate(text?: string) { setResult(null); setPage(0); if (text) message(text); }
  useEffect(() => {
    setResult(null); setPage(0); setImports({ left: [], right: [] });
    setPairs(sources.left.data && sources.right.data ? [{ id: ++nextId.current, left: null, right: null }] : []);
  }, [sources.left.data, sources.right.data]);

  function readSource(source: Source): Source {
    let data: CompareData | null = null;
    try {
      if (source.book) {
        if (source.header === '') throw new Error('제목 행을 입력해 주세요. 제목이 없으면 0을 입력합니다.');
        data = readCompareSheet(source.book.Sheets[source.sheet], XLSX, Number(source.header), Boolean(source.book.Workbook?.WBProps?.date1904));
      }
      message('시트와 제목 행을 확인한 뒤 비교할 열을 연결해 주세요.');
    } catch (error) { message(error instanceof Error ? error.message : String(error), true); }
    return { ...source, data };
  }
  async function loadFile(side: Side, file?: File) {
    const revision = ++revisions.current[side];
    setSources(previous => ({ ...previous, [side]: { ...emptySource(), info: file ? `${file.name} · 읽는 중…` : emptySource().info } }));
    invalidate();
    if (!file) { message('엑셀 파일을 선택해 주세요.'); return; }
    try {
      if (!/\.(xlsx|xls|xlsm|xlsb)$/i.test(file.name)) throw new Error('.xlsx, .xls, .xlsm, .xlsb 파일을 선택해 주세요.');
      if (file.size > 20 * 1024 * 1024) throw new Error('파일당 최대 20MB까지 지원합니다.');
      message(`${file.name} 파일을 읽는 중…`);
      const buffer = await file.arrayBuffer();
      if (revision !== revisions.current[side]) return;
      const book = XLSX.read(buffer, { type: 'array', cellNF: true, cellText: true, cellDates: false });
      if (!book.SheetNames.length) throw new Error('파일에 시트가 없습니다.');
      const source = readSource({ book, data: null, name: file.name, sheet: book.SheetNames[0], header: '1', info: `${file.name} · ${book.SheetNames.length}개 시트` });
      setSources(previous => ({ ...previous, [side]: source }));
    } catch (error) {
      if (revision !== revisions.current[side]) return;
      setSources(previous => ({ ...previous, [side]: { ...previous[side], info: `${file.name} · 불러오기 실패` } }));
      message(`파일을 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }
  function changeSource(side: Side, update: Partial<Source>) {
    const next = readSource({ ...sources[side], ...update });
    invalidate(); setSources(previous => ({ ...previous, [side]: next }));
  }
  function changeOptions(update: Partial<CompareOptions>) { setOptions(previous => ({ ...previous, ...update })); invalidate('조건이 변경되었습니다. 다시 비교해 주세요.'); }
  async function runComparison() {
    if (busy || !sources.left.data || !sources.right.data) return;
    invalidate(); setBusy(true); message('행을 비교하는 중…');
    await new Promise(resolve => setTimeout(resolve, 20));
    try {
      const config: ExportConfig = { leftImports: imports.left, rightImports: imports.right, existenceOnly: existsOnly, labels: sides.map(side => `${sources[side].name} / ${sources[side].sheet}`) };
      if (!config.existenceOnly && !config.leftImports.length && !config.rightImports.length) throw new Error('가져올 열을 하나 이상 선택하거나, 존재 여부만 확인을 선택해 주세요.');
      const comparison = compareSheets(sources.left.data, sources.right.data, pairs.map(pair => ({ left: pair.left ?? -1, right: pair.right ?? -1 })), options);
      setResult({ comparison, config }); setSide('left'); setFilter('all');
      message('비교가 완료되었습니다. 조건 미충족 행은 TRUE/FALSE를 비워두며, 원본 행 번호로 확인할 수 있습니다.');
    } catch (error) { invalidate(); message(error instanceof Error ? error.message : String(error), true); }
    finally { setBusy(false); }
  }
  async function download() {
    if (!result || busy || !sources.left.data || !sources.right.data) return;
    setBusy(true); message('결과 Excel 파일을 만드는 중…');
    await new Promise(resolve => setTimeout(resolve, 20));
    try {
      const book = buildCompareWorkbook(sources.left.data, sources.right.data, result.comparison, result.config, XLSX);
      XLSX.writeFile(book, `엑셀_시트_비교_${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
      message('양쪽 시트의 전체 결과와 비교 요약을 다운로드했습니다.');
    } catch (error) { message(`다운로드 실패: ${error instanceof Error ? error.message : String(error)}`, true); }
    finally { setBusy(false); }
  }
  const other = side === 'left' ? 'right' : 'left';
  const rows = result?.comparison[side].rows.filter(row => filter === 'all' || (filter === 'true' && row.exists === true) || (filter === 'false' && row.exists === false) || (filter === 'excluded' && !row.eligible) || (filter === 'duplicate' && row.duplicate)) ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / 50)), currentPage = Math.min(page, totalPages - 1);
  const headers = result && sources[side].data && sources[other].data ? resultColumns(sources[side].data, sources[other].data, result.config[`${side}Imports`], result.config.existenceOnly) : [];
  return <AdminPage title="엑셀 시트 비교" bodyClass="">
    <main id="work-main" tabIndex={-1} className="app-main compare-container">
      <nav className="work-section-navigation" aria-label="작업 단계">{['비교할 엑셀 파일', '3 비교할 열 연결', '4 결과 방식 선택'].map((title, index) => <a key={title} href={`#work-section-${index + 1}`}>{title}</a>)}</nav>
      <fieldset id="workspace" disabled={busy}>
        <section id="work-section-1" className="file-grid" aria-label="비교할 엑셀 파일">{sides.map((side, index) => {
          const source = sources[side];
          return <FileArea as="article" key={side} accept=".xlsx,.xls,.xlsm,.xlsb" disabled={busy} onFiles={files => void loadFile(side, files[0])} className="panel file-card"><h3 className="app-function-title"><span className="number">{index + 1}</span> 시트 {index + 1}</h3>
            <label className="file-label" htmlFor={`${side}-file`}>{index ? '두 번째' : '첫 번째'} 엑셀 파일<input id={`${side}-file`} type="file" accept=".xlsx,.xls,.xlsm,.xlsb" aria-describedby={`${side}-info`} onChange={event => void loadFile(side, event.currentTarget.files?.[0])} /></label>
            <p id={`${side}-info`} className="muted file-info">{source.info}</p>
            <div className="sheet-settings"><label>비교할 시트<select id={`${side}-sheet`} disabled={!source.book} value={source.sheet} onChange={event => changeSource(side, { sheet: event.target.value })}>{source.book?.SheetNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>제목 행<input id={`${side}-header`} type="number" min="0" step="1" value={source.header} disabled={!source.book} onChange={event => changeSource(side, { header: event.target.value })} /></label></div>
            <p className="hint">{index ? '같은 파일을 양쪽에 선택해 서로 다른 시트도 비교할 수 있습니다.' : '제목이 없으면 0을 입력하세요. 제목 행 다음부터 비교합니다.'}</p>
            <div id={`${side}-sample`} className="sample muted">{source.data ? <><table><thead><tr>{['행', ...source.data.columns.map(column => column.label)].map((label, i) => <th key={i}>{label}</th>)}</tr></thead><tbody>{source.data.rows.slice(0, 3).map(row => <tr key={row.rowNumber}>{[row.rowNumber, ...row.texts].map((value, i) => <td key={i}>{value}</td>)}</tr>)}</tbody></table>{source.data.rows.length ? null : '제목 행 다음에 비교할 데이터가 없습니다.'}</> : '표시할 데이터가 없습니다.'}</div>
          </FileArea>;
        })}</section>
        <section id="work-section-2" className="panel section-gap"><div className="section-title"><h3 className="app-function-title"><span className="number">3</span> 비교할 열 연결</h3><button id="add-pair" className="btn btn-ghost" type="button" disabled={!bothReady || pairs.length >= Math.min(sources.left.data?.columns.length ?? 0, sources.right.data?.columns.length ?? 0)} onClick={() => { setPairs(items => [...items, { id: ++nextId.current, left: null, right: null }]); invalidate(); }}>+ 비교 열 추가</button></div>
          <p className="muted">연결한 모든 열의 값이 같은 행을 찾습니다. 예: 시트 1 A·B·C열 ↔ 시트 2 B·C·F열.</p>
          <div id="pairs" className="pairs">{bothReady ? pairs.map((pair, index) => <div key={pair.id} className="pair">{sides.map(side => <span key={side} style={{ display: 'contents' }}>{side === 'right' ? <span className="pair-arrow">↔</span> : null}<select data-side={side} aria-label={`비교 쌍 ${index + 1} · 시트 ${side === 'left' ? 1 : 2} 열`} value={pair[side] ?? ''} onChange={event => { const value = event.target.value === '' ? null : Number(event.target.value); setPairs(items => items.map(item => item.id === pair.id ? { ...item, [side]: value } : item)); invalidate('비교 열이 변경되었습니다. 비교를 실행해 주세요.'); }}><option value="">시트 {side === 'left' ? 1 : 2} 열 선택</option>{sources[side].data?.columns.map(col => <option key={col.index} value={col.index}>{col.label}</option>)}</select></span>)}<button className="btn btn-ghost" type="button" aria-label="이 비교 열 연결 삭제" onClick={() => { setPairs(items => items.filter(item => item.id !== pair.id)); invalidate('비교 열 연결을 삭제했습니다.'); }}>삭제</button></div>) : <p className="empty">두 파일의 시트를 선택하면 비교 열을 연결할 수 있습니다.</p>}</div>
          <label className="duplicate-label">값 비교 기준<select id="value-mode" value={options.valueMode} onChange={event => changeOptions({ valueMode: event.target.value as CompareOptions['valueMode'] })}><option value="raw">실제 셀 값 (숫자·문자 구분)</option><option value="display">셀에 표시된 값</option></select></label>
          <div className="options"><label><input id="trim-values" type="checkbox" checked={options.trim} onChange={event => changeOptions({ trim: event.target.checked })} /> 앞뒤 공백 무시</label><label><input id="ignore-case" type="checkbox" checked={options.ignoreCase} onChange={event => changeOptions({ ignoreCase: event.target.checked })} /> 영문 대소문자 무시</label></div>
          <p className="hint">기본은 실제 값으로 비교합니다. 숫자 1과 문자 “1”은 다릅니다. 표시값 비교는 서식·반올림이 적용된 문자열을 비교합니다. 모든 비교 열에 값이 있어야 조건을 충족하며, 0은 인정하고 빈칸·공백만 있는 값·오류 셀은 제외합니다.</p>
        </section>
        <section id="work-section-3" className="panel section-gap"><h3 className="app-function-title"><span className="number">4</span> 결과 방식 선택</h3><div className="mode-options">{[['extract', '매칭한 행에서 값 가져오기', '선택한 열을 상대 시트의 맞는 행 옆에 추가합니다.'], ['exists', '존재 여부만 확인', '양쪽 시트에서 같은 값의 존재를 TRUE / FALSE로 확인합니다.']].map(([value, title, text]) => <label key={value} className="mode-card"><input type="radio" name="result-mode" value={value} checked={existsOnly === (value === 'exists')} onChange={() => { setExistsOnly(value === 'exists'); invalidate('결과 방식이 변경되었습니다. 비교를 실행해 주세요.'); }} /><span><strong>{title}</strong><small>{text}</small></span></label>)}</div>
          <div id="extract-options" hidden={existsOnly}><div className="import-grid">{sides.map((side, index) => <div key={side}><h4>시트 {index ? 1 : 2}에서 → 시트 {index + 1}로 가져올 열</h4><div id={`${side}-imports`} className="column-choices">{bothReady ? sources[side === 'left' ? 'right' : 'left'].data?.columns.map(col => <label key={col.index} className="column-choice"><input type="checkbox" value={col.index} checked={imports[side].includes(col.index)} onChange={event => { const checked = event.target.checked; setImports(previous => ({ ...previous, [side]: checked ? [...previous[side], col.index].sort((a, b) => a - b) : previous[side].filter(index => index !== col.index) })); invalidate('가져올 열이 변경되었습니다. 다시 비교해 주세요.'); }} />{col.label}</label>) : '두 시트를 먼저 선택해 주세요.'}</div></div>)}</div>
            <label className="duplicate-label">같은 비교 값이 여러 행에 있을 때<select id="duplicates" value={options.duplicates} onChange={event => changeOptions({ duplicates: event.target.value as CompareOptions['duplicates'] })}><option value="occurrence">등장 순서대로 1:1 연결</option><option value="unique">양쪽 모두 유일한 값만 가져오기</option><option value="first">상대 시트의 첫 행 사용 (중복 재사용)</option></select></label><p className="hint">1:1 연결은 원본 행 순서를 따릅니다. 중복으로 상대 행이 부족하면 값은 비워두고 표시합니다. 존재 여부는 연결 여부와 별도로 계산합니다.</p>
          </div>
        </section>
        <div className="run-bar"><span id="ready-counts" className="muted">{bothReady ? `시트 1 데이터 ${sources.left.data!.rows.length.toLocaleString()}행 · 시트 2 데이터 ${sources.right.data!.rows.length.toLocaleString()}행` : '두 시트와 비교 열을 선택해 주세요.'}</span><button id="run-btn" type="button" className="btn btn-primary" disabled={busy || !bothReady || !pairs.length || pairs.some(pair => pair.left == null || pair.right == null)} onClick={() => void runComparison()}>비교 실행</button></div>
      </fieldset>
      <p id="status" className={status.error ? 'error' : ''} role="status" aria-live="polite">{status.text}</p>
      <section id="result-section" hidden={!result}>
        <div className="section-title"><h2 className="app-function-title">비교 결과</h2><button id="download-btn" type="button" className="btn btn-primary" disabled={!result || busy} onClick={() => void download()}>결과 Excel 다운로드</button></div>
        <div id="statistics" className="file-grid">{result ? sides.map((side, index) => {
          const stats = result.comparison[side].stats;
          return <article key={side} className="panel stat-card"><h3 className="app-function-title">시트 {index + 1} · {sources[side].sheet}</h3><dl className="stat-grid">{[['조건 충족 행', stats.eligible, ''], ['TRUE · 존재', stats.found, 'good'], ['FALSE · 없음', stats.missing, 'warn']].map(([label, count, color]) => <div key={label}><dt>{label}</dt><dd className={String(color)}>{Number(count).toLocaleString()}</dd></div>)}</dl><p className="stat-detail">데이터 {stats.total.toLocaleString()}행 · 조건 미충족 {stats.excluded.toLocaleString()}행 · 중복 관련 {stats.duplicate.toLocaleString()}행{result.config.existenceOnly ? '' : ` · 값 연결 ${stats.matched.toLocaleString()}행`}</p></article>;
        }) : null}</div>
        <div className="panel section-gap result-panel"><div className="result-controls"><label>기준 시트<select id="result-side" value={side} onChange={event => { setSide(event.target.value as Side); setPage(0); }}><option value="left">시트 1 기준</option><option value="right">시트 2 기준</option></select></label><label>보기<select id="result-filter" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}>{[['all', '전체 행'], ['true', 'TRUE · 상대 시트에 존재'], ['false', 'FALSE · 상대 시트에 없음'], ['excluded', '조건 미충족'], ['duplicate', '중복 관련 행']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><span className="hint">다운로드에는 필터와 관계없이 양쪽 전체 결과와 요약이 포함됩니다.</span></div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="목록"><table id="preview" className="app-table"><thead><tr>{headers.map((value, index) => <th key={index} scope="col">{value}</th>)}</tr></thead><tbody>{result && sources[side].data && sources[other].data ? rows.length ? rows.slice(currentPage * 50, (currentPage + 1) * 50).map(row => <tr key={row.sourceIndex}>{resultValues(sources[side].data!, sources[other].data!, row, result.config[`${side}Imports`], result.config.existenceOnly).map((value, index) => {
            const text = typeof value === 'boolean' ? value ? 'TRUE' : 'FALSE' : String(value);
            return <td key={index} title={text} className={typeof value === 'boolean' ? value ? 'true-cell' : 'false-cell' : undefined}>{text}</td>;
          })}</tr>) : <tr><td colSpan={headers.length}>해당하는 행이 없습니다.</td></tr> : null}</tbody></table></div>
          <div className="pagination"><span id="page-info" className="muted">{rows.length.toLocaleString()}행 · {currentPage + 1} / {totalPages}페이지 (50행씩)</span><button id="prev-page" type="button" className="btn btn-ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>이전</button><button id="next-page" type="button" className="btn btn-ghost" disabled={currentPage >= totalPages - 1} onClick={() => setPage(currentPage + 1)}>다음</button></div>
        </div>
      </section>
      <p className="footer-note">수식은 파일에 저장된 계산값을 사용합니다. Excel에서 계산 후 저장한 파일을 선택해 주세요. 결과는 원본 행 순서를 유지하는 새 파일이며, 원본 서식·수식·매크로는 복제하지 않습니다.</p>
    </main>
  </AdminPage>;
}
