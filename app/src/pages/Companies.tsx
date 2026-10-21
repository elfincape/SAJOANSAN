import { EditorStatus, useEditorGuard } from '../components/EditorStatus';
import '../styles/common.css';
import '../styles/driver-documents.css';
import { useEffect, useRef, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { DriverDocuments } from '../components/DriverDocuments';
import { useFeedback } from '../components/useFeedback';
import { companyDocuments, oneDriveConnection } from '../lib/onedrive';
import { deleteCompany, loadCompanies, saveCompany } from '../lib/companies';
import type { Company } from '../lib/companies';

const defaultFolder = 'https://1drv.ms/f/c/6dace80ad4c07b59/IgCRF6DHb-8GQLZozZ3qz83pAVln53UZ6lkCVgU3kr9L0Fw?e=9tBipw';
const toDraft = (row?: Company) => ({ id: row?.id || '', name: row?.name || '', memo: row?.memo || '' });
function CompaniesContent() {
  const { center, profile, editable } = useAdminPage();
  const { toast, confirm, feedback } = useFeedback();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadCompanies>>>({ rows: [], drivers: [], vehicles: [], routes: [] });
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [draft, setDraft] = useState(() => toDraft());
  const [search, setSearch] = useState(''), [debouncedSearch, setDebouncedSearch] = useState(''), [sort, setSort] = useState('name');
  const [resetKey, setResetKey] = useState(0);
  const [folder, setFolder] = useState(defaultFolder), [folderStatus, setFolderStatus] = useState(''), [registering, setRegistering] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null), savingRef = useRef(false);
  const initial = useRef<ReturnType<typeof loadCompanies> | undefined>(undefined);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 200); return () => clearTimeout(timer); }, [search]);
  function select(row?: Company, focus = false, force = false) { if (!force && (saving)) return; if (!force && dirty) { void confirm('저장하지 않은 변경사항을 버리고 운수사 항목을 바꿀까요?').then(ok => { if (ok) select(row, focus, true); }); return; } setSelected(row?.id || null); setDraft(toDraft(row)); setResetKey(key => key + 1); if (focus) nameInput.current?.focus(); }
  useEffect(() => {
    let active = true; const request = initial.current ??= loadCompanies(center.code);
    void request.then(value => {
      if (!active) return; setData(value);
      const linked = value.rows.find(row => row.id === new URLSearchParams(location.search).get('id')); if (linked) select(linked);
    }).catch(() => { if (active) toast('데이터를 불러오지 못했습니다.', 'error'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [center.code, toast]);
  async function reload() {
    setLoading(true);
    try { const next = await loadCompanies(center.code); setData(next); return next; }
    catch { toast('데이터를 불러오지 못했습니다.', 'error'); setData({ rows: [], drivers: [], vehicles: [], routes: [] }); return null; }
    finally { setLoading(false); }
  }
  const counts = new Map<string, { drivers: number; vehicles: number; routes: number }>();
  for (const kind of ['drivers', 'vehicles', 'routes'] as const) for (const row of data[kind]) { if (row.company_id) { const count = counts.get(row.company_id) || { drivers: 0, vehicles: 0, routes: 0 }; count[kind]++; counts.set(row.company_id, count); } }
  const rows = data.rows.filter(row => !debouncedSearch || (row.name || '').toLowerCase().includes(debouncedSearch.toLowerCase())).sort((a, b) => sort === 'updated' ? String(b.updated_at || '').localeCompare(String(a.updated_at || '')) : String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  const selectedRow = data.rows.find(row => row.id === selected);
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(toDraft(selectedRow));
  useEditorGuard(dirty, saving, confirm);
  async function save() {
    if (!editable || savingRef.current) return;
    const name = draft.name.trim();
    if (!name) { toast('이름은 필수입니다.', 'warn'); nameInput.current?.focus(); return; }
    const payload = { ...(draft.id ? { id: draft.id } : {}), center_code: center.code, name, memo: draft.memo.trim() || null };
    savingRef.current = true; setSaving(true);
    try {
      const { data: saved, error } = await saveCompany(payload);
      if (error) { toast(error.code === '23505' ? '이미 존재하는 운수사 이름입니다.' : `저장 실패: ${error.message}`, 'error'); return; }
      toast(payload.id ? '수정되었습니다.' : '추가되었습니다.', 'success'); const next = await reload(); const row = next?.rows.find(row => row.id === saved.id); if (row) select(row, false, true);
    } catch { toast('저장 중 오류가 발생했습니다.', 'error'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function remove() {
    if (!editable || !draft.id) return;
    const count = counts.get(draft.id) || { drivers: 0, vehicles: 0, routes: 0 };
    const refs = [count.drivers ? `기사 ${count.drivers}명` : '', count.vehicles ? `차량 ${count.vehicles}대` : '', count.routes ? `코스 ${count.routes}개` : ''].filter(Boolean);
    let message = `"${selectedRow?.name || '이 운수사'}"를 삭제할까요?`;
    if (refs.length) message += `\n\n⚠ 이 운수사에 연결된 데이터가 있습니다: ${refs.join(', ')}.\n삭제하면 해당 데이터의 운수사 항목은 비워집니다 (NULL 처리).`;
    if (!await confirm(message, { okText: '삭제', cancelText: '취소', danger: true })) return;
    try { const { error } = await deleteCompany(center.code, draft.id); if (error) { toast(`삭제 실패: ${error.message}`, 'error'); return; } toast('삭제되었습니다.', 'success'); await reload(); select(undefined, false, true); }
    catch { toast('삭제 중 오류가 발생했습니다.', 'error'); }
  }
  return <>
    <main id="work-main" tabIndex={-1} className="app-main flex-1 max-w-[1200px] w-full mx-auto px-4 py-3">
      {!editable ? <p id="read-only-notice" className="text-sm text-amber-300 p-3">열람 전용 · 선택한 센터에서 이 업무를 수정할 권한이 없습니다.</p> : null}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] gap-4">
        <section className="work-list border border-zinc-700 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: '60vh' }} aria-label="운수사 목록"><div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex flex-wrap gap-2 items-center"><input id="search-input" type="search" placeholder="이름 검색" aria-label="운수사 이름 검색" className="app-input flex-1 min-w-[180px]" value={search} onChange={event => setSearch(event.target.value)} /><select id="sort-key" className="app-select w-28" aria-label="운수사 정렬 기준" value={sort} onChange={event => setSort(event.target.value)}><option value="name">이름순</option><option value="updated">수정 최신순</option></select><button id="new-btn" data-permission-action="edit" className="btn btn-primary" disabled={!editable} onClick={() => select(undefined, true)}>+ 신규</button></div>
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 220px)', border: 'none', borderRadius: 0 }} tabIndex={0} role="region" aria-label="목록"><table className="app-table"><thead><tr>{['이름', '기사', '차량', '코스', '비고'].map((title, index) => <th key={title} className={[1, 2, 3].includes(index) ? 'text-right' : undefined}>{title}</th>)}</tr></thead><tbody id="list-tbody">{rows.map(row => { const count = counts.get(row.id) || { drivers: 0, vehicles: 0, routes: 0 }; return <tr key={row.id} data-id={row.id} className={`cursor-pointer${row.id === selected ? ' selected' : ''}`} onClick={() => select(row, true)}><td><button type="button" className="text-left hover:underline" aria-label={`${row.name} 편집`}>{row.name}</button></td><td className="text-right">{count.drivers}</td><td className="text-right">{count.vehicles}</td><td className="text-right">{count.routes}</td><td className="muted">{row.memo || ''}</td></tr>; })}</tbody></table><div id="empty-msg" className={`${rows.length ? 'hidden ' : ''}text-center text-sm text-zinc-500 py-12`}>{loading ? '목록을 불러오는 중입니다…' : data.rows.length ? '검색 조건에 맞는 항목이 없습니다. 검색·필터 조건을 확인하세요.' : '등록된 운수사가 없습니다. 신규 버튼으로 등록하세요.'}</div></div>
          <div className="px-3 py-2 border-t border-zinc-700 text-xs text-zinc-400 flex items-center justify-between"><span id="result-count" role="status" aria-live="polite" aria-atomic="true">{!data.rows.length ? '데이터 없음' : rows.length === data.rows.length ? `총 ${data.rows.length}건` : `총 ${rows.length}건 (전체 ${data.rows.length}건 중)`}</span><span id="loading-indicator" className={loading ? '' : 'hidden'} role="status" aria-live="polite">불러오는 중...</span></div>
        </section>
        <section className="work-editor border border-zinc-700 rounded-lg bg-zinc-800/30" aria-labelledby="form-title"><div className="px-4 py-3 border-b border-zinc-700 flex items-center gap-3"><h2 id="form-title" className="app-function-title text-sm font-semibold">{draft.id ? selectedRow?.name : '새 운수사'}</h2><span id="form-mode-badge" className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">{draft.id ? '편집' : '신규'}</span><div className="flex-1" /><span id="form-meta" className="text-[11px] text-zinc-500">{draft.id && selectedRow?.updated_at ? `최종수정: ${new Date(selectedRow.updated_at).toLocaleString('ko-KR')}` : ''}</span></div>
          <EditorStatus dirty={dirty} saving={saving} editable={editable} existing={Boolean(draft.id)} />
          <form data-permission-action="edit" id="form" className="p-4 space-y-3" noValidate onSubmit={event => { event.preventDefault(); void save(); }}><fieldset className="editor-fields space-y-3" disabled={!editable || saving}><input type="hidden" id="f-id" value={draft.id} /><div><label className="app-label" htmlFor="f-name">이름 *</label><input ref={nameInput} id="f-name" className="app-input" required aria-describedby="name-help" value={draft.name} onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} /><p id="name-help" className="text-[10px] text-zinc-500 mt-1">운수사 이름은 중복될 수 없습니다.</p></div><div><label className="app-label" htmlFor="f-memo">비고</label><textarea id="f-memo" rows={3} className="app-textarea" value={draft.memo} onChange={event => setDraft(previous => ({ ...previous, memo: event.target.value }))} /></div><div className="work-form-actions flex items-center gap-2 pt-2 border-t border-zinc-700"><button type="submit" id="btn-save" data-permission-action="edit" className="btn btn-primary" disabled={!editable || saving} aria-busy={saving}>{saving ? '저장 중…' : '저장'}</button><button type="button" id="btn-cancel" disabled={saving} className="btn btn-ghost" onClick={() => select(selectedRow, false, true)}>취소</button><div className="flex-1" /><button type="button" id="btn-delete" data-permission-action="edit" className={`btn btn-danger${draft.id ? '' : ' hidden'}`} disabled={!editable} onClick={() => void remove()}>삭제</button></div></fieldset></form>
          <div id="company-storage" className={`${profile.role === 'admin' ? '' : 'hidden '}p-4 border-t border-zinc-700 space-y-2`}><label className="app-label" htmlFor="company-folder">운수사 인허가 파일 저장소</label><input id="company-folder" className="app-input" type="url" value={folder} onChange={event => setFolder(event.target.value)} /><button id="company-folder-register" data-permission-action="edit" type="button" className="btn btn-ghost" disabled={!editable || registering} onClick={async () => { setRegistering(true); setFolderStatus('저장소 확인 중…'); try { await oneDriveConnection.configureCompany(folder.trim()); setFolderStatus('운수사 인허가 저장소 등록 완료'); } catch (error) { setFolderStatus(error instanceof Error ? error.message : String(error)); } finally { setRegistering(false); } }}>저장소 등록</button><p id="company-folder-status" role="status" className="text-xs text-zinc-400">{folderStatus}</p></div>
          <DriverDocuments id="company-documents" className="p-4 border-t border-zinc-700 space-y-3" ownerId={draft.id} adapter={companyDocuments} companyMode editable={editable} resetKey={resetKey} />
        </section>
      </div>
    </main>{feedback}
  </>;
}
export default function Companies() { return <AdminPage title="운수사 관리" bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><CompaniesContent /></AdminPage>; }
