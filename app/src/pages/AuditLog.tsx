import '../styles/common.css';
import '../styles/audit-log.css';
import { useCallback, useEffect, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { Modal } from '../components/Modal';
import { Toasts } from '../components/Toasts';
import type { Notice } from '../components/Toasts';
import { auditPage, auditUsers } from '../lib/audit-log';
import type { AuditFilters, AuditRow, AuditUser } from '../lib/audit-log';
import { ACTION_LABEL, TABLE_LABEL, FIELD_LABEL, NOISE_FIELDS, changedFields, formatTs, identityOf, safeStringify, shortId } from '../domain/audit-log';

const emptyFilters = (): AuditFilters => ({ table: '', action: '', user: '', from: '', to: '' });
function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = { INSERT: 'bg-emerald-900/40 border-emerald-700 text-emerald-200', UPDATE: 'bg-amber-900/40 border-amber-700 text-amber-200', DELETE: 'bg-rose-900/40 border-rose-700 text-rose-200' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${map[action] || 'bg-zinc-700 border-zinc-600'}`}>{ACTION_LABEL[action] || action}</span>;
}
function Summary({ row }: { row: AuditRow }) {
  if (row.action === 'INSERT') return <>새로 생성: {identityOf(row.table_name, row.new_data || {})}</>;
  if (row.action === 'DELETE') return <>삭제됨: {identityOf(row.table_name, row.old_data || {})}</>;
  const keys = changedFields(row.old_data || {}, row.new_data || {});
  if (!keys.length) return <span className="muted">변경 없음</span>;
  return <span className="text-amber-300">수정: {keys.slice(0, 3).map(key => FIELD_LABEL[key] || key).join(', ')}{keys.length > 3 ? ` 외 ${keys.length - 3}개` : ''}</span>;
}
function Value({ value }: { value: unknown }) {
  if (value == null || value === '') return <span className="diff-mute">∅</span>;
  if (typeof value === 'boolean') return <span className={value ? 'text-emerald-300' : 'text-rose-300'}>{value ? '참' : '거짓'}</span>;
  if (typeof value === 'object') return <pre className="json-preview">{safeStringify(value)}</pre>;
  return <>{String(value)}</>;
}
function AuditDetail({ row, user, close }: { row: AuditRow; user: string; close: () => void }) {
  const old = row.old_data || {}, next = row.new_data || {}, changed = new Set(changedFields(old, next));
  const keys = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter(key => !NOISE_FIELDS.has(key)).sort((a, b) => (changed.has(a) ? 0 : 1) - (changed.has(b) ? 0 : 1) || (FIELD_LABEL[a] ? 0 : 1) - (FIELD_LABEL[b] ? 0 : 1) || a.localeCompare(b));
  const single = row.action === 'INSERT' || row.action === 'DELETE';
  const data = row.action === 'INSERT' ? next : old;
  const shown = single ? keys.filter(key => data[key] != null && data[key] !== '') : keys;
  return <Modal width="xl" label="변경 상세" onClose={close}><div className="p-5 max-h-[85vh] overflow-auto">
    <div className="flex items-start justify-between mb-3"><div><h2 className="app-function-title text-base font-semibold">변경 상세</h2><div className="text-xs muted mt-0.5">{[formatTs(row.changed_at), TABLE_LABEL[row.table_name] || row.table_name, ACTION_LABEL[row.action] || row.action, user].filter(Boolean).join(' · ')}</div><div className="text-[11px] muted mt-1">레코드 ID: <span className="font-mono">{row.row_id || ''}</span>{single ? null : <span className="ml-2">변경된 필드 {changed.size}개</span>}</div></div><button data-x className="btn btn-ghost text-xs" onClick={close}>닫기</button></div>
    <table className="diff-table"><thead><tr><th>필드</th>{single ? <th>{row.action === 'INSERT' ? '값 (생성)' : '값 (삭제)'}</th> : <><th>이전</th><th>이후</th></>}</tr></thead><tbody>{shown.length || !single ? shown.map(key => <tr key={key} className={`diff-row ${single ? row.action === 'INSERT' ? 'added' : 'removed' : changed.has(key) ? 'changed' : ''}`}><td style={{ width: 200 }}><div>{FIELD_LABEL[key] || key}</div><div className="text-[10px] muted">{key}</div></td>{single ? <td className={row.action === 'INSERT' ? 'diff-new' : 'diff-old'}><Value value={data[key]} /></td> : <><td className={changed.has(key) ? 'diff-old' : 'diff-mute'}><Value value={old[key]} /></td><td className={changed.has(key) ? 'diff-new' : 'diff-mute'}><Value value={next[key]} /></td></>}</tr>) : <tr><td colSpan={2} className="muted text-center py-6">표시할 필드가 없습니다.</td></tr>}</tbody></table>
    <details className="mt-4 border border-zinc-700 rounded-md"><summary className="px-3 py-2 cursor-pointer text-sm">원본 JSON 보기</summary><div className={`p-3 grid ${row.old_data && row.new_data ? 'grid-cols-2 gap-3' : 'grid-cols-1'}`}>{(['old_data', 'new_data'] as const).map(key => row[key] ? <div key={key}><div className="text-xs muted mb-1">{key}</div><pre className="json-preview bg-zinc-900 border border-zinc-700 rounded p-2">{safeStringify(row[key])}</pre></div> : null)}</div></details>
  </div></Modal>;
}
function AuditContent() {
  const { center } = useAdminPage();
  const [draft, setDraft] = useState(emptyFilters), [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(0), [total, setTotal] = useState(0);
  const [rows, setRows] = useState<AuditRow[]>([]), [users, setUsers] = useState<AuditUser[]>([]);
  const [loading, setLoading] = useState(true), [selected, setSelected] = useState<AuditRow | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const dismiss = useCallback((id: number) => setNotices(items => items.filter(item => item.id !== id)), []);
  useEffect(() => { let active = true; void Promise.resolve(auditUsers()).then(({ data, error }) => { if (active && !error) setUsers(data || []); }).catch(() => {}); return () => { active = false; }; }, []);
  useEffect(() => {
    let active = true; setRows([]); setLoading(true);
    void (async () => {
      try { const { data, error, count } = await auditPage(center.code, filters, page); if (error) throw error; if (active) { setRows(data || []); setTotal(count ?? 0); } }
      catch { if (active) { setRows([]); setTotal(0); setNotices(items => [...items, { id: Date.now(), text: '변경 이력을 불러오지 못했습니다.', type: 'error' }]); } }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [center.code, filters, page]);
  const user = (id: string | null) => { if (!id) return '시스템'; const match = users.find(user => user.id === id); return match ? match.display_name || match.email || id : shortId(id); };
  const totalPages = Math.max(1, Math.ceil(total / 50));
  const apply = () => { setFilters({ ...draft }); setPage(0); };
  return <>
    <main id="work-main" tabIndex={-1} className="app-main flex-1 max-w-[1500px] w-full mx-auto px-4 py-3">
      <section className="border border-zinc-700 rounded-lg p-3 mb-3 bg-zinc-800/30"><div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <select id="filter-table" className="app-select" value={draft.table} onChange={event => setDraft(previous => ({ ...previous, table: event.target.value }))}><option value="">테이블(전체)</option>{Object.entries(TABLE_LABEL).map(([key, label]) => <option key={key} value={key}>{label} ({key})</option>)}</select>
        <select id="filter-action" className="app-select" value={draft.action} onChange={event => setDraft(previous => ({ ...previous, action: event.target.value }))}><option value="">액션(전체)</option>{Object.entries(ACTION_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select id="filter-user" className="app-select" value={draft.user} onChange={event => setDraft(previous => ({ ...previous, user: event.target.value }))}><option value="">사용자(전체)</option>{users.map(user => <option key={user.id} value={user.id}>{user.display_name || user.email || user.id}</option>)}</select>
        {(['from', 'to'] as const).map(key => <input key={key} id={`filter-${key}`} type="date" className="app-input" title={key === 'from' ? '시작일' : '종료일'} value={draft[key]} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') apply(); }} />)}
        <div className="flex gap-2"><button id="apply-btn" className="btn btn-primary flex-1" onClick={apply}>조회</button><button id="reset-btn" className="btn btn-ghost" onClick={() => { setDraft(emptyFilters()); setFilters(emptyFilters()); setPage(0); }}>초기화</button></div>
      </div></section>
      <div className="flex items-center justify-between mb-2 px-1"><div id="result-count" className="text-xs text-zinc-400">{total ? `총 ${total}건` : '결과 없음'}</div><div className="flex items-center gap-2"><span id="page-info" className="text-xs text-zinc-400">{page + 1} / {totalPages} 페이지</span><button id="prev-btn" className="btn btn-ghost text-xs" disabled={page <= 0} onClick={() => setPage(value => value - 1)}>‹ 이전</button><button id="next-btn" className="btn btn-ghost text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(value => value + 1)}>다음 ›</button></div></div>
      <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 240px)' }} tabIndex={0} role="region" aria-label="목록"><table className="app-table"><thead><tr>{[['시각', 170], ['테이블', 140], ['액션', 70], ['레코드 ID', 200], ['사용자', 180], ['변경 요약', undefined]].map(([label, width]) => <th key={label} style={{ width }}>{label}</th>)}</tr></thead><tbody id="log-tbody">{rows.map(row => <tr key={row.id} className="cursor-pointer" onClick={() => setSelected(row)}><td className="text-xs whitespace-nowrap">{formatTs(row.changed_at)}</td><td>{TABLE_LABEL[row.table_name] || row.table_name}<span className="muted text-[10px] ml-1">{row.table_name}</span></td><td><ActionBadge action={row.action} /></td><td className="font-mono text-xs muted">{shortId(row.row_id)}</td><td className="text-xs">{user(row.changed_by)}</td><td className="text-xs"><Summary row={row} /></td></tr>)}</tbody></table><div id="empty-msg" className={`${rows.length || loading ? 'hidden ' : ''}text-center text-sm text-zinc-500 py-12`}>조건에 맞는 변경 이력이 없습니다.</div><div id="loading-indicator" className={`${loading ? '' : 'hidden '}text-center text-sm text-zinc-500 py-6`}>불러오는 중...</div></div>
    </main>
    {selected ? <AuditDetail row={selected} user={user(selected.changed_by)} close={() => setSelected(null)} /> : null}
    <Toasts notices={notices} dismiss={dismiss} />
  </>;
}
export default function AuditLog() { return <AdminPage title="변경 이력" minRole="admin" feature="auditLog" bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><AuditContent /></AdminPage>; }
