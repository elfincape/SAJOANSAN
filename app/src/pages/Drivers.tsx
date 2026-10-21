import { EditorStatus, useEditorGuard } from '../components/EditorStatus';
import '../styles/common.css';
import '../styles/driver-documents.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { DriverDocuments } from '../components/DriverDocuments';
import { useFeedback } from '../components/useFeedback';
import { deleteDriver, loadDrivers, saveDriver } from '../lib/drivers';
import type { Driver } from '../lib/drivers';
import { oneDriveDocuments, connectOneDrive, finishOneDrive } from '../lib/onedrive';
import { compileCenterPdfs } from '../lib/driver-pdf';
import type { PdfResult } from '../lib/driver-pdf';
import type { DocumentRecord } from '../domain/driver-documents';
import { compareHealthDates, healthStatus, validDate, watchHealthDate } from '../domain/driver-health';
import { documentChecks } from '../domain/driver-document-status';

const toDraft = (row?: Driver) => ({ id: row?.id || '', name: row?.name || '', phone: row?.phone || '', company: row?.company_id || '', memo: row?.memo || '', expiry: row?.health_certificate_expires_on || '' });
function formatPhone(value: string | null) {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('02')) { if (digits.length === 9) return `02-${digits.slice(2, 5)}-${digits.slice(5)}`; if (digits.length === 10) return `02-${digits.slice(2, 6)}-${digits.slice(6)}`; }
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return value;
}
const pdfSummary = (results: PdfResult[], total: number) => `처리 ${results.length}/${total} · 저장 ${results.filter(row => row.status === 'saved').length} · 서류 없음 ${results.filter(row => row.status === 'skipped').length} · 실패 ${results.filter(row => row.status === 'failed').length}`;
function DriversContent() {
  const { center, profile, editable } = useAdminPage();
  const { toast, confirm, feedback } = useFeedback();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadDrivers>>>({ rows: [], companies: [], routes: [], documents: new Map(), healthSchemaReady: false });
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [draft, setDraft] = useState(() => toDraft());
  const [resetKey, setResetKey] = useState(0);
  const [search, setSearch] = useState(''), [debouncedSearch, setDebouncedSearch] = useState(''), [company, setCompany] = useState(''), [sort, setSort] = useState('name');
  const [includeCompany, setIncludeCompany] = useState(true), [pdfPending, setPdfPending] = useState(false), [stopping, setStopping] = useState(false), [pdfStatus, setPdfStatus] = useState(''), [pdfResults, setPdfResults] = useState<PdfResult[]>([]);
  const pdfPendingRef = useRef(false), stopPdf = useRef(false);
  const [connection, setConnection] = useState(''), [connecting, setConnecting] = useState(false);
  const [folderForms, setFolderForms] = useState({ archive: false, pdf: false }), [folderUrls, setFolderUrls] = useState({ archive: '', pdf: '' }), [folderStatus, setFolderStatus] = useState({ archive: '', pdf: '' }), [folderBusy, setFolderBusy] = useState({ archive: false, pdf: false });
  const archiveInput = useRef<HTMLInputElement>(null), pdfInput = useRef<HTMLInputElement>(null), nameInput = useRef<HTMLInputElement>(null), savingRef = useRef(false);
  const initial = useRef<ReturnType<typeof loadDrivers> | undefined>(undefined), initialConnection = useRef<Promise<string> | undefined>(undefined);
  const [, refreshDate] = useState(0);
  function select(row?: Driver, focus = false, force = false) { if (!force && (saving)) return; if (!force && dirty) { void confirm('저장하지 않은 변경사항을 버리고 기사 항목을 바꿀까요?').then(ok => { if (ok) select(row, focus, true); }); return; } setSelected(row?.id || null); setDraft(toDraft(row)); setResetKey(key => key + 1); if (focus) nameInput.current?.focus(); }
  useEffect(() => {
    let active = true;
    const request = initial.current ??= loadDrivers(center.code);
    void request.then(value => { if (!active) return; setData(value); const linked = value.rows.find(row => row.id === new URLSearchParams(location.search).get('id')); if (linked) select(linked); }).catch(() => { if (active) toast('데이터를 불러오지 못했습니다.', 'error'); }).finally(() => { if (active) setLoading(false); });
    const connect = initialConnection.current ??= (async () => { if (await finishOneDrive()) toast('OneDrive 연결 완료', 'success'); const status = await oneDriveDocuments.status(); return status.connected ? 'OneDrive 연결됨' : 'OneDrive 연결이 필요합니다.'; })();
    void connect.then(value => { if (active) setConnection(value); }).catch(error => { if (active) setConnection(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [center.code, toast]);
  useEffect(() => watchHealthDate(() => refreshDate(value => value + 1)), []);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 200); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { const unload = (event: BeforeUnloadEvent) => { if (pdfPendingRef.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload); }, []);
  const onRecords = useCallback((id: string, records: DocumentRecord[] | null) => setData(previous => ({ ...previous, documents: new Map(previous.documents).set(id, records) })), []);
  const onSaved = useCallback((id: string, kind: string, expiry: string) => { if (kind === 'health_certificate') setData(previous => ({ ...previous, rows: previous.rows.map(row => row.id === id ? { ...row, health_certificate_expires_on: expiry } : row) })); }, []);
  async function reload() {
    setLoading(true);
    try { const next = await loadDrivers(center.code); setData(next); return next; }
    catch { toast('데이터를 불러오지 못했습니다.', 'error'); setData(previous => ({ ...previous, rows: [], routes: [] })); return null; }
    finally { setLoading(false); }
  }
  const companyById = new Map(data.companies.map(company => [company.id, company]));
  const counts = new Map<string, { primary: number; secondary: number }>();
  for (const route of data.routes) for (const key of ['primary', 'secondary'] as const) { const id = route[`${key}_driver_id`]; if (id) { const count = counts.get(id) || { primary: 0, secondary: 0 }; count[key]++; counts.set(id, count); } }
  const rows = data.rows.filter(row => (!company || row.company_id === company) && (!debouncedSearch || [row.name, row.phone].filter(Boolean).join(' ').toLowerCase().includes(debouncedSearch.toLowerCase())));
  rows.sort((a, b) => sort === 'company' ? (companyById.get(a.company_id || '')?.name || '').localeCompare(companyById.get(b.company_id || '')?.name || '', 'ko') || (a.name || '').localeCompare(b.name || '', 'ko') : sort === 'updated' ? String(b.updated_at || '').localeCompare(String(a.updated_at || '')) : (a.name || '').localeCompare(b.name || '', 'ko'));
  rows.sort((a, b) => compareHealthDates(a.health_certificate_expires_on, b.health_certificate_expires_on));
  const selectedRow = data.rows.find(row => row.id === selected);
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(toDraft(selectedRow));
  useEditorGuard(dirty, saving, confirm);
  const update = (key: keyof typeof draft, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
  async function save() {
    if (!editable || savingRef.current) return;
    const name = draft.name.trim(); if (!name) { toast('이름은 필수입니다.', 'warn'); nameInput.current?.focus(); return; }
    if (data.healthSchemaReady && draft.expiry && !validDate(draft.expiry)) { toast('올바른 만료일을 입력해 주세요.', 'warn'); return; }
    const payload = { ...(data.healthSchemaReady ? { health_certificate_expires_on: draft.expiry || null } : {}), ...(draft.id ? { id: draft.id } : {}), center_code: center.code, name, phone: draft.phone.trim() || null, company_id: draft.company || null, memo: draft.memo.trim() || null };
    savingRef.current = true; setSaving(true);
    try { const { data: row, error } = await saveDriver(payload); if (error) { toast(`저장 실패: ${error.message}`, 'error'); return; } toast(payload.id ? '수정되었습니다.' : '추가되었습니다.', 'success'); const next = await reload(); const saved = next?.rows.find(item => item.id === row.id); if (saved) select(saved, false, true); }
    catch { toast('저장 중 오류가 발생했습니다.', 'error'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function remove() {
    if (!editable || !draft.id) return;
    const count = counts.get(draft.id) || { primary: 0, secondary: 0 };
    let message = `"${selectedRow?.name || '이 기사'}"를 삭제할까요?`;
    if (count.primary + count.secondary > 0) message += `\n\n⚠ 이 기사가 배정된 코스: 주기사 ${count.primary}건, 보조기사 ${count.secondary}건.\n삭제하면 해당 코스의 기사 항목은 비워집니다 (NULL 처리).`;
    if (!await confirm(message, { okText: '삭제', cancelText: '취소', danger: true })) return;
    try { const { error } = await deleteDriver(center.code, draft.id); if (error) { toast(`삭제 실패: ${error.message}`, 'error'); return; } toast('삭제되었습니다.', 'success'); await reload(); select(undefined, false, true); } catch { toast('삭제 중 오류가 발생했습니다.', 'error'); }
  }
  async function saveCenterPdfs() {
    if (pdfPendingRef.current) return;
    const drivers = data.rows.map(row => ({ id: row.id, name: row.name }));
    if (!drivers.length) { setPdfStatus('현재 센터에 등록된 기사가 없습니다.'); return; }
    pdfPendingRef.current = true; stopPdf.current = false; setPdfPending(true); setStopping(false); setPdfResults([]); setPdfStatus('OneDrive 연결 확인 중…');
    try {
      if (!(await oneDriveDocuments.status()).connected) throw new Error('관리자가 OneDrive를 먼저 연결해 주세요.');
      const report = await compileCenterPdfs(oneDriveDocuments, drivers, { includeCompany, shouldStop: () => stopPdf.current, onProgress: ({ index, total, driver, message, results }) => { setPdfStatus(pdfSummary(results, total) + ` · ${index}번째 ${driver.name || '기사'} · ${message}`); setPdfResults(results); } });
      setPdfStatus((report.stopped ? '중단 · ' : '완료 · ') + pdfSummary(report.results, report.total)); setPdfResults(report.results);
    } catch (error) { setPdfStatus(error instanceof Error ? error.message : String(error)); }
    finally { pdfPendingRef.current = false; setPdfPending(false); }
  }
  async function saveFolder(kind: 'archive' | 'pdf') {
    const url = folderUrls[kind].trim(); if (!url) { setFolderStatus(previous => ({ ...previous, [kind]: '폴더 공유 링크를 입력해 주세요.' })); return; }
    setFolderBusy(previous => ({ ...previous, [kind]: true })); setFolderStatus(previous => ({ ...previous, [kind]: '폴더 확인 및 저장 중…' }));
    try { if (kind === 'archive') await oneDriveDocuments.configureArchive(url); else await oneDriveDocuments.configurePdf(url); setFolderUrls(previous => ({ ...previous, [kind]: '' })); setFolderStatus(previous => ({ ...previous, [kind]: kind === 'archive' ? '삭제 보관 폴더 설정 완료' : 'PDF 저장 폴더 설정 완료' })); }
    catch (error) { setFolderStatus(previous => ({ ...previous, [kind]: error instanceof Error ? error.message : String(error) })); }
    finally { setFolderBusy(previous => ({ ...previous, [kind]: false })); }
  }
  return <>
    <main id="work-main" tabIndex={-1} className="app-main flex-1 max-w-[1800px] w-full mx-auto px-4 py-3">
      {!editable ? <p id="read-only-notice" className="text-sm text-amber-300 p-3">열람 전용 · 선택한 센터에서 이 업무를 수정할 권한이 없습니다.</p> : null}
      <div className="driver-management-layout">
        <section className="work-list border border-zinc-700 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: '60vh' }} aria-label="기사 목록"><div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex flex-wrap gap-2 items-center">
          <input id="search-input" type="search" placeholder="이름/연락처 검색" aria-label="기사 이름, 연락처 검색" className="app-input flex-1 min-w-[180px]" value={search} onChange={event => setSearch(event.target.value)} /><select id="filter-company" className="app-select w-44" aria-label="운수사 필터" value={company} onChange={event => setCompany(event.target.value)}><option value="">운수사(전체)</option>{data.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select><select id="sort-key" className="app-select w-28" aria-label="기사 정렬 기준" value={sort} onChange={event => setSort(event.target.value)}>{[['name', '이름순'], ['company', '운수사순'], ['updated', '수정 최신순']].map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select>
          <label className="text-xs flex items-center gap-1"><input id="pdf-include-company" type="checkbox" checked={includeCompany} disabled={pdfPending} onChange={event => setIncludeCompany(event.target.checked)} /> PDF 파일명에 운수사 포함</label><button type="button" id="pdf-center-btn" className="btn btn-ghost" disabled={pdfPending} onClick={() => void saveCenterPdfs()}>센터 전체 PDF 생성</button><button id="new-btn" data-permission-action="edit" className="btn btn-primary" disabled={!editable} onClick={() => select(undefined, true)}>+ 신규</button>
        </div><div className="px-3 py-2 border-b border-zinc-700 space-y-2"><p className="text-xs text-zinc-400">센터 전체 PDF는 검색·운수사 필터와 관계없이 현재 센터의 모든 기사를 개별 파일로 OneDrive에 저장합니다. 서류 미등록 기사는 건너뜁니다.</p><p id="pdf-center-status" className="text-xs text-zinc-300" role="status" aria-live="polite">{pdfStatus}</p><button type="button" id="pdf-center-stop" className={`btn btn-ghost${pdfPending ? '' : ' hidden'}`} disabled={stopping} onClick={() => { stopPdf.current = true; setStopping(true); }}>현재 기사 완료 후 중단</button><ul id="pdf-center-details" className="text-xs text-amber-300 space-y-1 max-h-32 overflow-auto">{pdfResults.filter(row => row.status !== 'saved').map(row => <li key={row.driver.id}>{row.driver.name || '기사'} · {row.status === 'skipped' ? '서류 없음' : row.message}</li>)}</ul></div>
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 220px)', border: 'none', borderRadius: 0 }} tabIndex={0} role="region" aria-label="목록"><table className="app-table driver-list-table"><thead><tr>{['서류 등록', '이름', '연락처', '운수사', '보건증 만료일', '주코스', '보조코스'].map((label, index) => <th key={label} className={index > 4 ? 'text-right' : undefined}>{label}</th>)}</tr></thead><tbody id="list-tbody">{rows.map(row => {
            const health = healthStatus(row.health_certificate_expires_on), count = counts.get(row.id) || { primary: 0, secondary: 0 }, records = data.documents.get(row.id);
            return <tr key={row.id} data-id={row.id} className={`cursor-pointer${row.id === selected ? ' selected' : ''}${health.urgent ? ' ' + health.className : ''}`} onClick={() => select(row, true)}><td>{records ? <div className="driver-document-checks">{documentChecks(records).map(({ label, checked }) => <label key={label} className="driver-document-check"><span>{label}</span><input type="checkbox" className="driver-document-checkbox" disabled aria-label={`${label} 서류 등록`} checked={checked} /></label>)}</div> : <span className="text-xs text-zinc-400">조회 실패</span>}</td><td><button type="button" className="text-left hover:underline" aria-label={`${row.name} 편집`}>{row.name}</button></td><td>{formatPhone(row.phone)}</td><td>{companyById.get(row.company_id || '')?.name || ''}</td><td><span className={`health-badge ${health.className}`}>{health.label}{health.expiry ? ' · ' + health.expiry : ''}</span></td><td className="text-right">{count.primary}</td><td className="text-right">{count.secondary}</td></tr>;
          })}</tbody></table><div id="empty-msg" className={`${rows.length ? 'hidden ' : ''}text-center text-sm text-zinc-500 py-12`}>{loading ? '목록을 불러오는 중입니다…' : data.rows.length ? '검색 조건에 맞는 항목이 없습니다. 검색·필터 조건을 확인하세요.' : '등록된 기사가 없습니다. 신규 버튼으로 등록하세요.'}</div></div><div className="px-3 py-2 border-t border-zinc-700 text-xs text-zinc-400 flex items-center justify-between"><span id="result-count" role="status" aria-live="polite" aria-atomic="true">{!data.rows.length ? '데이터 없음' : rows.length === data.rows.length ? `총 ${data.rows.length}건` : `총 ${rows.length}건 (전체 ${data.rows.length}건 중)`}</span><span id="loading-indicator" className={loading ? '' : 'hidden'} role="status" aria-live="polite">불러오는 중...</span></div>
        </section>
        <section className="work-editor driver-editor border border-zinc-700 rounded-lg bg-zinc-800/30" aria-labelledby="form-title"><div className="px-4 py-3 border-b border-zinc-700 flex items-center gap-3"><h2 id="form-title" className="app-function-title text-sm font-semibold">{draft.id ? selectedRow?.name : '새 기사'}</h2><span id="form-mode-badge" className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">{draft.id ? '편집' : '신규'}</span><div className="flex-1" /><span id="form-meta" className="text-[11px] text-zinc-500">{draft.id && selectedRow?.updated_at ? `최종수정: ${new Date(selectedRow.updated_at).toLocaleString('ko-KR')}` : ''}</span></div>
          <EditorStatus dirty={dirty} saving={saving} editable={editable} existing={Boolean(draft.id)} />
          <form data-permission-action="edit" id="form" className="p-4 space-y-3" noValidate onSubmit={event => { event.preventDefault(); void save(); }}><fieldset className="editor-fields space-y-3" disabled={!editable || saving}><input type="hidden" id="f-id" value={draft.id} /><div><label className="app-label" htmlFor="f-name">이름 *</label><input ref={nameInput} id="f-name" className="app-input" required value={draft.name} onChange={event => update('name', event.target.value)} /></div><div><label className="app-label" htmlFor="f-phone">연락처 (휴대폰)</label><input id="f-phone" className="app-input" placeholder="예: 010-1234-5678" value={draft.phone} onChange={event => update('phone', event.target.value)} /></div><div><label className="app-label" htmlFor="f-company">소속 운수사</label><select id="f-company" className="app-select" value={draft.company} onChange={event => update('company', event.target.value)}><option value="">선택 안 함</option>{data.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div><div><label className="app-label" htmlFor="f-memo">비고</label><textarea id="f-memo" rows={2} className="app-textarea" value={draft.memo} onChange={event => update('memo', event.target.value)} /></div><div><label htmlFor="f-health-expiry" className="app-label">보건증 만료일</label><input id="f-health-expiry" type="date" className="app-input" aria-describedby="health-schema-note health-expiry-help" disabled={!data.healthSchemaReady} value={draft.expiry} onChange={event => update('expiry', event.target.value)} /><p id="health-schema-note" className="text-xs text-amber-300 mt-1" role="status" aria-live="polite">{data.healthSchemaReady ? '' : '보건증 만료일 저장 준비가 필요합니다. 관리자에게 문의해 주세요.'}</p><p id="health-expiry-help" className="text-xs text-zinc-400 mt-1">한국 시간 기준 · 만료일이 오늘부터 1개월 미만이면 우선 표시됩니다.</p></div><div className="work-form-actions flex items-center gap-2 pt-2 border-t border-zinc-700"><button type="submit" id="btn-save" data-permission-action="edit" className="btn btn-primary" disabled={!editable || saving} aria-busy={saving}>{saving ? '저장 중…' : '저장'}</button><button type="button" id="btn-cancel" disabled={saving} className="btn btn-ghost" onClick={() => select(selectedRow, false, true)}>취소</button><div className="flex-1" /><button type="button" id="btn-delete" data-permission-action="edit" className={`btn btn-danger${draft.id ? '' : ' hidden'}`} disabled={!editable} onClick={() => void remove()}>삭제</button></div></fieldset></form>
          <div className="driver-storage-settings px-4 py-3 border-t border-zinc-700"><p id="onedrive-status" className="driver-storage-status" role="status">{connection}</p><details><summary>OneDrive 연결 및 저장 폴더 설정</summary><div className="driver-storage-controls"><button type="button" id="onedrive-connect" className={`btn btn-ghost${profile.role === 'admin' ? '' : ' hidden'}`} disabled={connecting} onClick={async () => { setConnecting(true); try { await connectOneDrive(); } catch (error) { setConnection(error instanceof Error ? error.message : String(error)); setConnecting(false); } }}>OneDrive 연결 / 재연결</button>
            {(['archive', 'pdf'] as const).map(kind => <span key={kind} style={{ display: 'contents' }}><button type="button" id={`onedrive-${kind}-config`} className={`btn btn-ghost${profile.role === 'admin' ? '' : ' hidden'}`} onClick={() => { setFolderForms(previous => ({ ...previous, [kind]: !previous[kind] })); requestAnimationFrame(() => (kind === 'archive' ? archiveInput : pdfInput).current?.focus()); }}>{kind === 'archive' ? '삭제 보관 폴더 설정' : 'PDF 저장 폴더 설정'}</button><div id={`onedrive-${kind}-form`} className={`${folderForms[kind] ? '' : 'hidden '}mt-2 space-y-2`}><label htmlFor={`onedrive-${kind}-url`} className="app-label">{kind === 'archive' ? '삭제 보관 폴더 공유 링크' : '인허가 PDF 저장 폴더 공유 링크'}</label><input ref={kind === 'archive' ? archiveInput : pdfInput} id={`onedrive-${kind}-url`} type="url" className="app-input" autoComplete="off" value={folderUrls[kind]} onChange={event => setFolderUrls(previous => ({ ...previous, [kind]: event.target.value }))} /><button type="button" id={`onedrive-${kind}-save`} className="btn btn-primary" disabled={folderBusy[kind]} onClick={() => void saveFolder(kind)}>{kind === 'archive' ? '보관 폴더 저장' : 'PDF 폴더 저장'}</button><p id={`onedrive-${kind}-result`} className="text-xs text-zinc-300" role="status">{folderStatus[kind]}</p></div></span>)}
          </div></details></div>
          <DriverDocuments id="driver-documents" className="p-4 border-t border-zinc-700 space-y-3" ownerId={draft.id} adapter={oneDriveDocuments} editable={editable} resetKey={resetKey} getExpiry={() => draft.expiry} getPdfOptions={() => ({ includeCompany })} onSaved={onSaved} onRecords={onRecords} />
        </section>
      </div>
    </main>{feedback}
  </>;
}
export default function Drivers() { return <AdminPage title="기사 관리" bodyClass="drivers-page bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><DriversContent /></AdminPage>; }
