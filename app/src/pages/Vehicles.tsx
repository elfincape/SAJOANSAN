import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { useFeedback } from '../components/useFeedback';
import { deleteVehicle, loadVehicles, saveVehicle } from '../lib/vehicles';
import type { Vehicle } from '../lib/vehicles';

interface Draft { id: string; plate: string; tonnage: string; pallet: string; company: string; memo: string }
const parseTonnage = (text: string) => { if (!text) return null; const match = String(text).match(/(\d+(?:\.\d+)?)/); if (!match) return null; const n = parseFloat(match[1]); return !Number.isFinite(n) || n <= 0 || n > 999.99 ? null : Math.round(n * 100) / 100; };
const formatTonnage = (n?: number | null) => n == null ? '' : `${Number(n)}톤`;
const toDraft = (row?: Vehicle | null): Draft => ({ id: row?.id || '', plate: row?.plate_number || '', tonnage: formatTonnage(row?.tonnage), pallet: row?.pallet_capacity == null ? '' : String(row.pallet_capacity), company: row?.company_id || '', memo: row?.memo || '' });
function VehiclesContent() {
  const { center, editable } = useAdminPage();
  const { toast, confirm, feedback } = useFeedback();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadVehicles>>>({ rows: [], companies: [], routes: [] });
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [search, setSearch] = useState(''), [debouncedSearch, setDebouncedSearch] = useState('');
  const [company, setCompany] = useState(''), [sort, setSort] = useState('plate');
  const [selected, setSelected] = useState<string | null>(null), [draft, setDraft] = useState(() => toDraft());
  const plateInput = useRef<HTMLInputElement>(null), savingRef = useRef(false);
  const initial = useRef<ReturnType<typeof loadVehicles> | undefined>(undefined);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 200); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    let active = true; const request = initial.current ??= loadVehicles(center.code);
    void request.then(value => { if (active) setData(value); }).catch(() => { if (active) toast('데이터를 불러오지 못했습니다.', 'error'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [center.code, toast]);
  const reload = useCallback(async () => {
    setLoading(true);
    try { const next = await loadVehicles(center.code); setData(next); return next; }
    catch { toast('데이터를 불러오지 못했습니다.', 'error'); setData(previous => ({ ...previous, rows: [], routes: [] })); return null; }
    finally { setLoading(false); }
  }, [center.code, toast]);
  const companyById = new Map(data.companies.map(company => [company.id, company]));
  const counts = new Map<string, { primary: number; secondary: number }>();
  for (const route of data.routes) for (const key of ['primary', 'secondary'] as const) { const id = route[`${key}_vehicle_id`]; if (id) { const count = counts.get(id) || { primary: 0, secondary: 0 }; count[key]++; counts.set(id, count); } }
  const rows = data.rows.filter(row => (!company || row.company_id === company) && (!debouncedSearch || (row.plate_number || '').toLowerCase().includes(debouncedSearch.toLowerCase())));
  const byPlate = (a: Vehicle, b: Vehicle) => (a.plate_number || '').localeCompare(b.plate_number || '', 'ko', { numeric: true });
  rows.sort((a, b) => sort === 'tonnage' ? (a.tonnage ?? -1) - (b.tonnage ?? -1) || byPlate(a, b) : sort === 'company' ? (companyById.get(a.company_id || '')?.name || '').localeCompare(companyById.get(b.company_id || '')?.name || '', 'ko') || byPlate(a, b) : sort === 'updated' ? String(b.updated_at || '').localeCompare(String(a.updated_at || '')) : byPlate(a, b));
  const selectedRow = data.rows.find(row => row.id === selected);
  const update = (key: keyof Draft, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
  function select(row: Vehicle, focus = false) { setSelected(row.id); setDraft(toDraft(row)); if (focus) plateInput.current?.focus(); }
  function reset() { setSelected(null); setDraft(toDraft()); }
  async function save() {
    if (!editable || savingRef.current) return;
    const plate = draft.plate.trim();
    if (!plate) { toast('차량번호는 필수입니다.', 'warn'); plateInput.current?.focus(); return; }
    const tonnage = parseTonnage(draft.tonnage.trim()), pallet = draft.pallet === '' ? null : Math.max(0, parseInt(draft.pallet, 10));
    if (tonnage != null && !(tonnage > 0)) { toast('톤수는 0보다 커야 합니다.', 'warn'); return; }
    savingRef.current = true; setSaving(true);
    try {
      const payload = { ...(draft.id ? { id: draft.id } : {}), center_code: center.code, plate_number: plate, tonnage, pallet_capacity: Number.isFinite(pallet) ? pallet : null, company_id: draft.company || null, memo: draft.memo.trim() || null };
      const { data: row, error } = await saveVehicle(payload);
      if (error) { toast(error.code === '23505' ? '같은 운수사에 이미 같은 차량번호가 있습니다.' : `저장 실패: ${error.message}`, 'error'); return; }
      toast(payload.id ? '수정되었습니다.' : '추가되었습니다.', 'success');
      const next = await reload(); const saved = next?.rows.find(item => item.id === row.id); if (saved) select(saved); else setSelected(row.id);
    } catch { toast('저장 중 오류가 발생했습니다.', 'error'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function remove() {
    if (!editable || !draft.id) return;
    const count = counts.get(draft.id) || { primary: 0, secondary: 0 };
    let message = `"${selectedRow?.plate_number || '이 차량'}"을 삭제할까요?`;
    if (count.primary + count.secondary > 0) message += `\n\n⚠ 이 차량이 배정된 코스: 주차량 ${count.primary}건, 보조차량 ${count.secondary}건.\n삭제하면 해당 코스의 차량 항목은 비워집니다 (NULL 처리).`;
    if (!await confirm(message, { okText: '삭제', cancelText: '취소', danger: true })) return;
    try { const { error } = await deleteVehicle(center.code, draft.id); if (error) { toast(`삭제 실패: ${error.message}`, 'error'); return; } toast('삭제되었습니다.', 'success'); await reload(); reset(); }
    catch { toast('삭제 중 오류가 발생했습니다.', 'error'); }
  }
  return <>
    <main id="work-main" tabIndex={-1} className="app-main flex-1 max-w-[1200px] w-full mx-auto px-4 py-3">
      {!editable ? <p id="read-only-notice" className="text-sm text-amber-300 p-3">열람 전용 · 선택한 센터에서 이 업무를 수정할 권한이 없습니다.</p> : null}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(400px,480px)] gap-4">
        <section className="work-list border border-zinc-700 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: '60vh' }} aria-label="차량 목록">
          <div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex flex-wrap gap-2 items-center"><input id="search-input" type="search" placeholder="차량번호 검색" aria-label="차량번호 검색" className="app-input flex-1 min-w-[180px]" value={search} onChange={event => setSearch(event.target.value)} /><select id="filter-company" className="app-select w-44" aria-label="운수사 필터" value={company} onChange={event => setCompany(event.target.value)}><option value="">운수사(전체)</option>{data.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select><select id="sort-key" className="app-select w-28" aria-label="차량 정렬 기준" value={sort} onChange={event => setSort(event.target.value)}>{[['plate', '차량번호순'], ['tonnage', '톤수순'], ['company', '운수사순'], ['updated', '수정 최신순']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button id="new-btn" data-permission-action="edit" className="btn btn-primary" disabled={!editable} onClick={() => { reset(); plateInput.current?.focus(); }}>+ 신규</button></div>
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 220px)', border: 'none', borderRadius: 0 }} tabIndex={0} role="region" aria-label="목록"><table className="app-table"><thead><tr>{['차량번호', '톤수', '팔레트', '운수사', '주코스', '보조코스'].map((title, index) => <th key={title} className={[1, 2, 4, 5].includes(index) ? 'text-right' : undefined}>{title}</th>)}</tr></thead><tbody id="list-tbody">{rows.map(row => { const count = counts.get(row.id) || { primary: 0, secondary: 0 }; return <tr key={row.id} data-id={row.id} className={`cursor-pointer${row.id === selected ? ' selected' : ''}`} onClick={() => select(row, true)}><td><button type="button" className="text-left hover:underline" aria-label={`${row.plate_number || '(번호 없음)'} 편집`}>{row.plate_number || '(번호 없음)'}</button></td><td className="text-right">{row.tonnage != null ? row.tonnage + 't' : ''}</td><td className="text-right">{row.pallet_capacity ?? ''}</td><td>{companyById.get(row.company_id || '')?.name || ''}</td><td className="text-right">{count.primary}</td><td className="text-right">{count.secondary}</td></tr>; })}</tbody></table><div id="empty-msg" className={`${rows.length ? 'hidden ' : ''}text-center text-sm text-zinc-500 py-12`}>등록된 차량이 없습니다.</div></div>
          <div className="px-3 py-2 border-t border-zinc-700 text-xs text-zinc-400 flex items-center justify-between"><span id="result-count" role="status" aria-live="polite" aria-atomic="true">{!data.rows.length ? '데이터 없음' : rows.length === data.rows.length ? `총 ${data.rows.length}건` : `총 ${rows.length}건 (전체 ${data.rows.length}건 중)`}</span><span id="loading-indicator" className={loading ? '' : 'hidden'} role="status" aria-live="polite">불러오는 중...</span></div>
        </section>
        <section className="work-editor border border-zinc-700 rounded-lg bg-zinc-800/30" aria-labelledby="form-title"><div className="px-4 py-3 border-b border-zinc-700 flex items-center gap-3"><h2 id="form-title" className="app-function-title text-sm font-semibold">{draft.id ? selectedRow?.plate_number || '(번호 없음)' : '새 차량'}</h2><span id="form-mode-badge" className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">{draft.id ? '편집' : '신규'}</span><div className="flex-1" /><span id="form-meta" className="text-[11px] text-zinc-500">{draft.id && selectedRow?.updated_at ? `최종수정: ${new Date(selectedRow.updated_at).toLocaleString('ko-KR')}` : ''}</span></div>
          <form data-permission-action="edit" id="form" className="p-4 space-y-3" noValidate onSubmit={event => { event.preventDefault(); void save(); }}><input type="hidden" id="f-id" value={draft.id} />
            <div><label className="app-label" htmlFor="f-plate">차량번호 *</label><input ref={plateInput} id="f-plate" className="app-input" required placeholder="예: 12가3456" aria-describedby="plate-help" value={draft.plate} onChange={event => update('plate', event.target.value)} /><p id="plate-help" className="text-[10px] text-zinc-500 mt-1">차량번호는 중복될 수 없습니다.</p></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="app-label" htmlFor="f-tonnage-text">톤수</label><input id="f-tonnage-text" className="app-input" placeholder={'예: "3.5톤"'} aria-describedby="tonnage-help" value={draft.tonnage} onChange={event => update('tonnage', event.target.value)} onBlur={() => { const n = parseTonnage(draft.tonnage.trim()); if (n != null) update('tonnage', formatTonnage(n)); }} /><p id="tonnage-help" className="text-[10px] text-zinc-500 mt-1">숫자가 포함되면 자동으로 톤수 값에 반영됩니다.</p></div><div><label className="app-label" htmlFor="f-pallet">팔레트 적재량</label><input id="f-pallet" type="number" min="0" step="1" className="app-input" placeholder="예: 16" value={draft.pallet} onChange={event => update('pallet', event.target.value)} /></div></div>
            <div><label className="app-label" htmlFor="f-company">소속 운수사</label><select id="f-company" className="app-select" value={draft.company} onChange={event => update('company', event.target.value)}><option value="">선택 안 함</option>{data.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
            <div><label className="app-label" htmlFor="f-memo">비고</label><textarea id="f-memo" rows={2} className="app-textarea" value={draft.memo} onChange={event => update('memo', event.target.value)} /></div>
            <div className="work-form-actions flex items-center gap-2 pt-2 border-t border-zinc-700"><button type="submit" id="btn-save" data-permission-action="edit" className="btn btn-primary" disabled={!editable || saving}>저장</button><button type="button" id="btn-cancel" className="btn btn-ghost" onClick={() => setDraft(toDraft(selectedRow))}>취소</button><div className="flex-1" /><button type="button" id="btn-delete" data-permission-action="edit" className={`btn btn-danger${draft.id ? '' : ' hidden'}`} disabled={!editable} onClick={() => void remove()}>삭제</button></div>
          </form>
        </section>
      </div>
    </main>{feedback}
  </>;
}
export default function Vehicles() { return <AdminPage title="차량 관리" bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><VehiclesContent /></AdminPage>; }
