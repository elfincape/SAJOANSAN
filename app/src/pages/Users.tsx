import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { useFeedback } from '../components/useFeedback';
import { withCenterParam } from '../lib/center';
import { normalizeUsername, validUsername } from '../lib/login';
import { loadUsers, updateUser, toggleUser, createUser, deleteUser } from '../lib/users';
import type { UserProfile } from '../lib/users';
const roleLabels = { admin: '관리자', editor: '센터 업무 담당', viewer: '조회 전용' };
const roleClasses = { admin: 'bg-rose-900/40 border-rose-700 text-rose-200', editor: 'bg-emerald-900/40 border-emerald-700 text-emerald-200', viewer: 'bg-zinc-700/60 border-zinc-600 text-zinc-200' };
const toDraft = (row?: UserProfile) => ({ id: row?.id || '', email: row?.email || '', username: row?.username || '', password: '', name: row?.display_name || '', role: row?.role || 'editor' as UserProfile['role'], active: row ? !!row.active : true });
function UsersContent() {
  const { profile, center } = useAdminPage();
  const { toast, confirm, feedback } = useFeedback();
  const [data, setData] = useState<UserProfile[]>([]), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => toDraft());
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [role, setRole] = useState(''), [active, setActive] = useState('');
  const usernameInput = useRef<HTMLInputElement>(null), passwordInput = useRef<HTMLInputElement>(null), savingRef = useRef(false);
  const initial = useRef<ReturnType<typeof loadUsers> | undefined>(undefined);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim().toLowerCase()), 200); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { let mounted = true; const request = initial.current ??= loadUsers(); void request.then(rows => { if (mounted) setData(rows); }).catch(() => { if (mounted) toast('사용자 목록을 불러오지 못했습니다.', 'error'); }).finally(() => { if (mounted) setLoading(false); }); return () => { mounted = false; }; }, [toast]);
  const reload = useCallback(async () => { setLoading(true); try { const rows = await loadUsers(); setData(rows); return rows; } catch { toast('사용자 목록을 불러오지 못했습니다.', 'error'); setData([]); return []; } finally { setLoading(false); } }, [toast]);
  const rank = { admin: 0, editor: 1, viewer: 2 };
  const rows = data.filter(row => (!role || row.role === role) && (active !== 'active' || row.active) && (active !== 'inactive' || !row.active) && (!query || [row.username, row.email, row.display_name].filter(Boolean).join(' ').toLowerCase().includes(query))).sort((a,b) => Number(b.active)-Number(a.active) || (rank[a.role] ?? 9)-(rank[b.role] ?? 9) || String(a.display_name || a.email || '').localeCompare(String(b.display_name || b.email || ''), 'ko'));
  const selectedRow = data.find(row => row.id === draft.id);
  const selfMessages = draft.id === profile.id ? [draft.role !== 'admin' ? '자기 자신의 admin 권한을 박탈할 수 없습니다.' : '', !draft.active ? '자기 자신을 비활성화할 수 없습니다.' : ''].filter(Boolean) : [];
  const selfWarn = selfMessages.length ? '⚠ ' + selfMessages.join(' ') : '';
  function select(row?: UserProfile, focus = false) { setDraft(toDraft(row)); if (focus) usernameInput.current?.focus(); }
  const otherAdmins = (id: string) => data.filter(row => row.role === 'admin' && row.active && row.id !== id).length;
  async function save() {
    if (savingRef.current) return;
    const username = normalizeUsername(draft.username), name = draft.name.trim(), email = draft.email.trim();
    if (!validUsername(username)) { toast('아이디는 3~32자의 영문, 숫자, 한글, _, ., -를 사용하세요.', 'warn'); usernameInput.current?.focus(); return; }
    if (data.some(row => normalizeUsername(row.username || '') === username && row.id !== draft.id)) { toast('이미 사용 중인 아이디입니다.', 'warn'); return; }
    if (!draft.id && draft.password.length < 8) { toast('비밀번호를 8자 이상 입력하세요.', 'warn'); passwordInput.current?.focus(); return; }
    if (draft.id === profile.id) {
      if (draft.role !== 'admin') { toast('자기 자신의 admin 권한을 박탈할 수 없습니다.', 'error'); return; }
      if (!draft.active) { toast('자기 자신을 비활성화할 수 없습니다.', 'error'); return; }
    }
    if (selectedRow?.role === 'admin' && selectedRow.active && !(draft.role === 'admin' && draft.active) && !otherAdmins(draft.id)) { toast('마지막 활성 admin입니다. 다른 admin이 있어야 변경할 수 있습니다.', 'error'); return; }
    savingRef.current = true; setSaving(true);
    try {
      let savedId: string;
      if (!draft.id) {
        const result = await createUser({ username, password: draft.password, display_name: name, role: draft.role, active: draft.active }); savedId = result.profile.id;
        setDraft(previous => ({...previous, password: ''}));
        toast('계정을 생성했습니다. 역할·담당 센터 설정에서 업무 범위를 확인하세요.', 'success');
      } else {
        const { data: result, error } = await updateUser(draft.id, { id: draft.id, email: email || null, username, display_name: name || null, active: draft.active });
        if (error) { toast(error.code === '23503' ? '해당 user_id가 auth.users에 없습니다. Supabase 대시보드에서 먼저 사용자를 생성하세요.' : error.code === '23505' ? '이미 사용 중인 아이디입니다.' : `저장 실패: ${error.message}`, 'error'); return; }
        savedId = result.id; toast('수정되었습니다.', 'success');
      }
      const next = await reload(); const row = next.find(row => row.id === savedId); if (row) select(row);
    } catch (error) { toast(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.', 'error'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function toggle(id: string) {
    const row = data.find(row => row.id === id); if (!row) return;
    if (id === profile.id && row.active) { toast('자기 자신을 비활성화할 수 없습니다.', 'error'); return; }
    if (row.active && row.role === 'admin' && !otherAdmins(id)) { toast('마지막 활성 admin입니다. 비활성화할 수 없습니다.', 'error'); return; }
    const verb = row.active ? '비활성화' : '활성화';
    if (!await confirm(`${row.display_name || row.email || '이 사용자'}를 ${verb}할까요?`, {okText: verb, cancelText: '취소', danger: row.active})) return;
    try { const { error } = await toggleUser(id, !row.active); if (error) { toast(`${verb} 실패: ${error.message}`, 'error'); return; } toast(`${verb}되었습니다.`, 'success'); const next = await reload(); if (draft.id === id) select(next.find(row => row.id === id)); }
    catch { toast(`${verb} 중 오류가 발생했습니다.`, 'error'); }
  }
  async function remove() {
    const row = selectedRow; if (!row) return;
    if (row.id === profile.id) { toast('자기 자신의 프로필을 삭제할 수 없습니다.', 'error'); return; }
    if (row.role === 'admin' && row.active && !otherAdmins(row.id)) { toast('마지막 활성 admin입니다. 삭제할 수 없습니다.', 'error'); return; }
    if (!await confirm(`"${row.display_name || row.email || '이 사용자'}"의 프로필을 삭제할까요?\n\n이 작업은 시스템 접근 권한만 회수합니다.\nSupabase의 auth.users 자체는 대시보드에서 별도로 삭제해야 합니다.`, {okText: '삭제', cancelText: '취소', danger: true})) return;
    try { const { error } = await deleteUser(row.id); if (error) { toast(`삭제 실패: ${error.message}`, 'error'); return; } toast('프로필을 삭제했습니다.', 'success'); await reload(); select(); }
    catch { toast('삭제 중 오류가 발생했습니다.', 'error'); }
  }
  return <>
  <main className="app-main flex-1 max-w-[1300px] w-full mx-auto px-4 py-3 space-y-4" id="work-main" tabIndex={-1}>

    <section className="border border-zinc-700 rounded-lg p-4 text-sm">
      <p>신규 계정의 아이디·비밀번호와 기본 역할을 설정합니다. 기존 사용자의 역할·담당 센터는 사용자 권한 설정에서 함께 관리합니다.</p>
      <p className="mt-2 text-xs text-zinc-400">계정 활성 상태는 접근 가능 여부, 역할·담당 센터와 페이지 조건은 실제 업무 범위를 정합니다.</p>
    </section>

    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)] gap-4">

      
      <section className="work-list border border-zinc-700 rounded-lg overflow-hidden flex flex-col" style={{"minHeight": "60vh"}} aria-label="사용자 목록">
        <div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex flex-wrap gap-2 items-center">
          <input id="search-input" type="search" placeholder="아이디/이메일/이름 검색" aria-label="사용자 아이디, 이메일, 이름 검색" className="app-input flex-1 min-w-[180px]" value={search} onChange={event => setSearch(event.target.value)} />
          <select id="filter-role" className="app-select w-32" aria-label="역할 필터" value={role} onChange={event => setRole(event.target.value)}>
            <option value="">역할(전체)</option>
            <option value="admin">관리자 · 배송팀</option>
            <option value="editor">센터 업무 담당</option>
                <option value="viewer">조회 전용</option>
          </select>
          <select id="filter-active" className="app-select w-28" aria-label="계정 활성 상태 필터" value={active} onChange={event => setActive(event.target.value)}>
            <option value="">상태(전체)</option>
            <option value="active">활성</option>
            <option value="inactive">비활성</option>
          </select>
        </div>

        <div className="table-wrap" style={{"maxHeight": "calc(100vh - 320px)", "border": "none", "borderRadius": "0"}} tabIndex={0} role="region" aria-label="사용자 목록">
          <table className="app-table">
            <thead>
              <tr>
                <th>아이디</th><th>기존 이메일</th>
                <th>표시이름</th>
                <th>역할</th>
                <th>상태</th>
                <th>마지막 수정</th>
                <th className="text-right">작업</th>
              </tr>
            </thead>
            <tbody id="list-tbody">{rows.map(row => <tr key={row.id} data-id={row.id} className={`cursor-pointer${row.id===draft.id ? ' selected' : ''}`} onClick={() => select(row,true)}><td className="font-mono text-xs">{row.username || '-'}</td><td className="font-mono text-xs">{row.email?.endsWith('@accounts.sajoansan.vercel.app') ? '-' : row.email || '-'}{row.id===profile.id ? <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-200">나</span> : null}</td><td>{row.display_name || ''}</td><td><span className={`text-[10px] px-1.5 py-0.5 rounded border ${roleClasses[row.role] || roleClasses.viewer}`}>{roleLabels[row.role] || '-'}</span></td><td><span className={`text-xs ${row.active ? 'text-emerald-400' : 'text-rose-400'}`}>{row.active ? '활성' : '비활성'}</span></td><td className="text-xs text-zinc-400">{row.updated_at ? new Date(row.updated_at).toLocaleString('ko-KR') : ''}</td><td className="text-right whitespace-nowrap"><button type="button" className="btn btn-ghost text-xs" aria-label={`${row.username || row.display_name || row.email || '사용자'} 편집`} onClick={event => {event.stopPropagation();select(row,true);}}>편집</button><button type="button" className={`btn btn-ghost text-xs ${row.active ? 'text-rose-300' : 'text-emerald-300'}`} aria-label={`${row.username || row.display_name || row.email || '사용자'} ${row.active ? '비활성화' : '활성화'}`} onClick={event => {event.stopPropagation();void toggle(row.id);}}>{row.active ? '비활성화' : '활성화'}</button></td></tr>)}</tbody>
          </table>
          <div id="empty-msg" className={`text-center text-sm text-zinc-500 py-12${!!rows.length ? " hidden" : ""}`}>
            등록된 프로필이 없습니다.
          </div>
        </div>
        <div className="px-3 py-2 border-t border-zinc-700 text-xs text-zinc-400 flex items-center justify-between">
          <span id="result-count" role="status" aria-live="polite" aria-atomic="true">{!data.length ? "데이터 없음" : rows.length===data.length ? `총 ${data.length}건` : `총 ${rows.length}건 (전체 ${data.length}건 중)`}</span>
          <span id="loading-indicator" className={`${!loading ? " hidden" : ""}`} role="status" aria-live="polite">불러오는 중...</span>
        </div>
      </section>

      
      <section className="work-editor border border-zinc-700 rounded-lg bg-zinc-800/30" aria-labelledby="form-title">
        <div className="px-4 py-3 border-b border-zinc-700 flex items-center gap-3">
          <h2 id="form-title" className="text-sm font-semibold">{draft.id ? selectedRow?.display_name || selectedRow?.email || "(이름 없음)" : "신규 계정 생성"}</h2>
          <span id="form-mode-badge" className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">{draft.id ? "편집" : "신규"}</span>
          <div className="flex-1"></div>
          <span id="form-meta" className="text-[11px] text-zinc-500">{selectedRow?.updated_at ? `최종수정: ${new Date(selectedRow.updated_at).toLocaleString("ko-KR")}` : ""}</span>
        </div>

        <form id="form" className="p-4 space-y-3" noValidate onSubmit={event => {event.preventDefault(); void save();}}>
          <input type="hidden" id="f-orig-id" value={draft.id} />

          <input type="hidden" id="f-id" value={draft.id} />
          <input type="hidden" id="f-email" value={draft.email} />
          <div>
            <label className="app-label" htmlFor="f-username">로그인 아이디 *</label>
            <input id="f-username" className="app-input" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={32} placeholder="ansan01" aria-describedby="username-help" aria-required="true" value={draft.username} onChange={event => setDraft(previous => ({...previous, username:event.target.value}))} ref={usernameInput} />
            <p id="username-help" className="text-xs text-zinc-500 mt-1">3~32자, 영문·숫자·한글·밑줄·마침표·하이픈. 영문 대소문자를 구분하지 않습니다.</p>
          </div>
          <div id="new-password-field" className={draft.id ? "hidden" : ""}>
            <label className="app-label" htmlFor="f-password">비밀번호 *</label>
            <input id="f-password" type="password" className="app-input" autoComplete="new-password" minLength={8} maxLength={256} placeholder="8자 이상" aria-required="true" value={draft.password} onChange={event => setDraft(previous => ({...previous, password:event.target.value}))} ref={passwordInput} />
          </div>
          <div>
            <label className="app-label" htmlFor="f-name">표시이름</label>
            <input id="f-name" className="app-input" value={draft.name} onChange={event => setDraft(previous => ({...previous, name:event.target.value}))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="app-label" htmlFor="f-role">역할 *</label>
              <select id="f-role" className="app-select" value={draft.role} onChange={event => setDraft(previous => ({...previous, role:event.target.value as UserProfile['role']}))} disabled={!!draft.id}>
                <option value="editor">센터 업무 담당</option>
                <option value="viewer">조회 전용</option>
                <option value="admin">관리자 · 배송팀</option>
              </select>
            </div>
            <div>
              <span className="app-label">상태</span>
              <label className="cb mt-1.5"><input type="checkbox" id="f-active" checked={draft.active} onChange={event => setDraft(previous => ({...previous,active:event.target.checked}))} /> 활성</label>
            </div>
          </div>

          <a id="permission-settings-link" href={withCenterParam("/portal/?view=members&user="+encodeURIComponent(draft.id),center)} className={`btn btn-ghost${!draft.id ? " hidden" : ""}`}>역할·담당 센터와 적용 권한 확인</a>
          <div id="self-warn" className={`text-xs text-amber-300 bg-amber-900/20 border border-amber-900/40 rounded-md px-3 py-2${!selfWarn ? " hidden" : ""}`} role="status" aria-live="polite" aria-atomic="true">{selfWarn}</div>

          <div className="work-form-actions flex items-center gap-2 pt-2 border-t border-zinc-700">
            <button type="submit" id="btn-save" className="btn btn-primary" disabled={saving}>저장</button>
            <button type="button" id="btn-cancel" className="btn btn-ghost" onClick={() => select(selectedRow)}>취소</button>
            <div className="flex-1"></div>
            <button type="button" id="btn-toggle-active" className={`btn btn-ghost${!draft.id ? " hidden" : ""}`} onClick={() => void toggle(draft.id)}>{selectedRow?.active ? "비활성화" : "활성화"}</button>
            <button type="button" id="btn-delete" className={`btn btn-danger${!draft.id ? " hidden" : ""}`} onClick={() => void remove()}>프로필 삭제</button>
          </div>
        </form>

        <div className="px-4 pb-4 text-[11px] text-zinc-500">
          ※ "프로필 삭제"는 시스템 접근 권한만 회수합니다. <code className="px-1 rounded bg-zinc-800">auth.users</code> 자체는 Supabase 대시보드에서 삭제하세요.
        </div>
      </section>
    </div>
  </main>{feedback}</>;
}
export default function Users() { return <AdminPage title="사용자 관리" minRole="admin" bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><UsersContent /></AdminPage>; }
