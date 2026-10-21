import { EditorStatus, useEditorGuard } from '../components/EditorStatus';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { FileArea } from '../components/FileArea';
import { useFeedback } from '../components/useFeedback';
import { deleteDeliveryPoint, deliveryPointUsage, loadDeliveryPoints, saveDeliveryPoint } from '../lib/delivery-points';
import type { DeliveryPoint } from '../lib/delivery-points';
import { pointPayload, pointToDraft } from '../domain/delivery-points';
import type { PointDraft } from '../domain/delivery-points';
import { compressDeliveryPointPhoto, extractRegionFromAddress, isProbablyImageFile, normalizeTime } from '../domain/delivery-photos';
import type { DeliveryPhoto } from '../domain/delivery-photos';
import { bizMinToDisplay, displayToBizMin } from '../domain/time';

function previewPhoto(photo: DeliveryPhoto) {
  if (!photo.dataUrl) return;
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (popup) {
    const root = createRoot(popup.document.body);
    root.render(<img src={photo.dataUrl} style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }} />);
    popup.addEventListener('pagehide', () => root.unmount(), { once: true });
  }
}
function DeliveryPointsContent() {
  const { center, editable } = useAdminPage();
  const { toast, confirm, feedback } = useFeedback();
  const [data, setData] = useState<DeliveryPoint[]>([]), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [draft, setDraft] = useState(pointToDraft);
  const [search, setSearch] = useState(''), [debouncedSearch, setDebouncedSearch] = useState(''), [region, setRegion] = useState(''), [method, setMethod] = useState(''), [sort, setSort] = useState('code');
  const [photoMessage, setPhotoMessage] = useState<{ text: string; error?: boolean } | null>(null), [photoBusy, setPhotoBusy] = useState(false);
  const photoBusyRef = useRef(false), savingRef = useRef(false), generation = useRef(0), nameInput = useRef<HTMLInputElement>(null);
  const initial = useRef<ReturnType<typeof loadDeliveryPoints> | undefined>(undefined);
  function select(row?: DeliveryPoint, focus = false, force = false) { if (!force && (saving || photoBusy)) return; if (!force && dirty) { void confirm('저장하지 않은 변경사항을 버리고 납품처 항목을 바꿀까요?').then(ok => { if (ok) select(row, focus, true); }); return; } generation.current++; setSelected(row?.id || null); setDraft(pointToDraft(row)); setPhotoMessage(null); if (focus) nameInput.current?.focus(); }
  useEffect(() => {
    let active = true; const request = initial.current ??= loadDeliveryPoints(center.code);
    void Promise.resolve(request).then(({ data, error }) => { if (error) throw error; if (!active) return; setData(data || []); const linked = data?.find(row => row.id === new URLSearchParams(location.search).get('id')); if (linked) select(linked); }).catch(() => { if (active) toast('납품처 목록을 불러오지 못했습니다.', 'error'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [center.code, toast]);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 200); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || document.activeElement !== document.body) return;
      const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file);
      if (files.length) { event.preventDefault(); void addPhotos(files); }
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [draft.photos.length, photoBusy, editable]);
  useEffect(() => () => { generation.current++; }, []);
  const update = <K extends keyof PointDraft>(key: K, value: PointDraft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  async function reload() {
    setLoading(true);
    try { const { data, error } = await loadDeliveryPoints(center.code); if (error) throw error; setData(data || []); return data || []; }
    catch { toast('납품처 목록을 불러오지 못했습니다.', 'error'); setData([]); return []; }
    finally { setLoading(false); }
  }
  const rows = data.filter(row => (!region || row.region === region) && (!method || row.delivery_method === method) && (!debouncedSearch || [row.code, row.name, row.address, row.security_key_location, row.security_password].filter(Boolean).join(' ').toLowerCase().includes(debouncedSearch.toLowerCase()))).sort((a, b) => String(a[sort === 'name' ? 'name' : 'code'] ?? '').localeCompare(String(b[sort === 'name' ? 'name' : 'code'] ?? ''), 'ko', { numeric: true }));
  const regions = [...new Set(data.map(row => row.region).filter((region): region is string => !!region))].sort((a, b) => a.localeCompare(b, 'ko'));
  const selectedRow = data.find(row => row.id === selected);
  const dirty = editable && JSON.stringify(draft) !== JSON.stringify(pointToDraft(selectedRow));
  useEditorGuard(dirty, saving || photoBusy, confirm);
  function extractRegion() { const region = extractRegionFromAddress(draft.address.trim()); if (region) { update('region', region); toast(`지역을 "${region}"으로 설정했습니다.`, 'success'); } else toast('주소에서 지역을 추출하지 못했습니다.', 'warn'); }
  function normalizeDeadline() {
    const value = draft.deadline.trim(); if (!value) return;
    const normal = normalizeTime(value);
    if (!normal) { toast('시간 형식이 올바르지 않습니다. 예: 22:00, 25:30', 'warn'); return; }
    if (displayToBizMin(normal) == null) { toast('시간은 04:00 ~ 27:59 범위여야 합니다.', 'warn'); return; }
    update('deadline', normal);
  }
  async function addPhotos(files: File[]) {
    if (!editable || !files.length || photoBusyRef.current) return;
    const remaining = 6 - draft.photos.length;
    if (remaining <= 0) { toast('사진은 납품처당 최대 6장까지 등록할 수 있습니다.', 'warn'); return; }
    const images = files.filter(isProbablyImageFile);
    if (!images.length) { setPhotoMessage({ text: '이미지 파일을 찾지 못했습니다. JPG/PNG/WebP 파일을 선택하거나 복사해주세요.' }); return; }
    if (files.length > remaining) toast(`최대 6장까지만 등록되어 ${remaining}장만 추가합니다.`, 'warn');
    const id = generation.current; photoBusyRef.current = true; setPhotoBusy(true); setPhotoMessage({ text: '사진을 불러와 압축하는 중입니다...' });
    try {
      for (const file of images.slice(0, remaining)) { const photo = await compressDeliveryPointPhoto(file); if (id !== generation.current) return; setDraft(previous => ({ ...previous, photos: [...previous.photos, photo] })); setPhotoMessage(null); }
      toast('사진이 추가되었습니다. 저장 버튼을 눌러 반영하세요.', 'success');
    } catch (error) { if (id === generation.current) setPhotoMessage({ text: error instanceof Error ? error.message : '사진 처리 중 오류가 발생했습니다.', error: true }); }
    finally { photoBusyRef.current = false; setPhotoBusy(false); }
  }
  async function save() {
    if (!editable || savingRef.current) return;
    if (!draft.name.trim()) { toast('이름은 필수입니다.', 'warn'); nameInput.current?.focus(); return; }
    if (draft.deadline.trim() && (!normalizeTime(draft.deadline.trim()) || displayToBizMin(normalizeTime(draft.deadline.trim())) == null)) { toast('마감 시간 형식이 올바르지 않습니다.', 'warn'); return; }
    savingRef.current = true; setSaving(true);
    try {
      const { data: saved, error, removedColumns } = await saveDeliveryPoint(pointPayload(draft, center.code));
      if (error) { toast(error.code === '23505' ? '이미 사용 중인 코드입니다.' : `저장 실패: ${error.message}`, 'error'); return; }
      if (removedColumns.length) console.warn('[delivery-points] DB에 없는 컬럼은 제외하고 저장했습니다.', removedColumns);
      toast(draft.id ? '수정되었습니다.' : '추가되었습니다.', 'success'); const next = await reload(); const row = next.find(row => row.id === saved?.id); if (row) select(row, false, true);
    } catch (error) { toast(`납품처 저장 중 오류가 발생했습니다. ${error instanceof Error ? error.message : ''}`, 'error'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function remove() {
    if (!editable || !draft.id) return;
    let inUse = 0; try { inUse = (await deliveryPointUsage(draft.id)).count || 0; } catch {}
    let message = `"${selectedRow?.name || '이 납품처'}"를 삭제할까요?`;
    if (inUse > 0) message += `\n\n⚠ 이 납품처가 ${inUse}개 코스에 등록되어 있습니다.\n코스에 등록된 상태이면 DB 제약상 삭제가 거부됩니다.\n먼저 해당 코스에서 제거한 뒤 다시 시도하세요.`;
    if (!await confirm(message, { okText: '삭제', cancelText: '취소', danger: true })) return;
    try { const { error } = await deleteDeliveryPoint(center.code, draft.id); if (error) { toast(error.code === '23503' ? '코스에 등록된 납품처라 삭제할 수 없습니다.' : `삭제 실패: ${error.message}`, 'error'); return; } toast('삭제되었습니다.', 'success'); await reload(); select(undefined, false, true); } catch { toast('삭제 중 오류가 발생했습니다.', 'error'); }
  }
  return <>
  <main className="app-main flex-1 max-w-[1600px] w-full mx-auto px-4 py-3" id="work-main" tabIndex={-1}>
    {!editable ? <p id="read-only-notice" className="text-sm text-amber-300 p-3">열람 전용 · 선택한 센터에서 이 업무를 수정할 권한이 없습니다.</p> : null}
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)] gap-4">

      
      <section className="work-list border border-zinc-700 rounded-lg overflow-hidden flex flex-col" style={{"minHeight": "70vh"}} aria-label="납품처 목록">
        <div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex flex-wrap gap-2 items-center">
          <input id="search-input" type="search" placeholder="코드/이름/주소 검색" aria-label="납품처 코드, 이름, 주소 검색" className="app-input flex-1 min-w-[180px]" value={search} onChange={event => setSearch(event.target.value)} />
          <select id="filter-region" className="app-select w-32" aria-label="지역 필터" value={region} onChange={event => setRegion(event.target.value)}>
            <option value="">지역(전체)</option>{regions.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <select id="filter-method" className="app-select w-32" aria-label="납품방식 필터" value={method} onChange={event => setMethod(event.target.value)}>
            <option value="">납품방식(전체)</option>
            <option value="대면">대면</option>
            <option value="검수">검수</option>
            <option value="무인">무인</option>
          </select>
          <select id="sort-key" className="app-select w-28" aria-label="납품처 정렬 기준" value={sort} onChange={event => setSort(event.target.value)}>
            <option value="code">코드순</option>
            <option value="name">이름순</option>
          </select>
          <button id="new-btn" data-permission-action="edit" className="btn btn-primary" onClick={() => select(undefined, true)} disabled={!editable}>+ 신규</button>
          <button id="notion-points-sync" className="btn btn-ghost hidden" type="button">노션 동기화</button>
        </div>
        <p id="notion-points-status" className="px-3 text-xs text-zinc-400" role="status" aria-live="polite"></p>

        <div className="table-wrap" style={{"maxHeight": "calc(100vh - 220px)", "border": "none", "borderRadius": "0"}} tabIndex={0} role="region" aria-label="목록">
          <table className="app-table">
            <thead>
              <tr>
                <th>코드</th>
                <th>이름</th>
                <th>코스 배정</th>
                <th>지역</th>
                <th>납품방식</th>
                <th>마감</th>
              </tr>
            </thead>
            <tbody id="dp-tbody">{rows.map(row => <tr key={row.id} data-id={row.id} className={`cursor-pointer${row.id === selected ? ' selected' : ''}`} onClick={() => select(row,true)}><td>{row.code || ''}</td><td><button type="button" className="text-left hover:underline" aria-label={`${row.name || '(이름 없음)'} 편집`}>{row.name || '(이름 없음)'}</button></td><td>{row.route_stops?.length ? '배정' : '미지정'}</td><td>{row.region || ''}</td><td>{row.delivery_method || ''}</td><td className="biz-time">{bizMinToDisplay(row.deadline_business_min)}</td></tr>)}</tbody>
          </table>
          <div id="empty-msg" className={`${rows.length ? "hidden " : ""}text-center text-sm text-zinc-500 py-12`}>
            조건에 맞는 납품처가 없습니다.
          </div>
        </div>

        <div className="px-3 py-2 border-t border-zinc-700 text-xs text-zinc-400 flex items-center justify-between">
          <span id="result-count" role="status" aria-live="polite" aria-atomic="true">{!data.length ? "데이터 없음" : rows.length === data.length ? `총 ${data.length}건` : `총 ${rows.length}건 (전체 ${data.length}건 중)`}</span>
          <span id="loading-indicator" className={loading ? "" : "hidden"} role="status" aria-live="polite">불러오는 중...</span>
        </div>
      </section>

      
      <section className="work-editor border border-zinc-700 rounded-lg bg-zinc-800/30" aria-labelledby="form-title">
        <div className="px-4 py-3 border-b border-zinc-700 flex items-center gap-3">
          <h2 id="form-title" className="app-function-title text-sm font-semibold">{draft.id ? selectedRow?.name || "(이름 없음)" : "새 납품처"}</h2>
          <span id="form-mode-badge" className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">{draft.id ? "편집" : "신규"}</span>
          <div className="flex-1"></div>
          <span id="form-meta" className="text-[11px] text-zinc-500">{draft.id && selectedRow?.updated_at ? `최종수정: ${new Date(selectedRow.updated_at).toLocaleString("ko-KR")}` : ""}</span>
        </div>

        <EditorStatus dirty={dirty} saving={saving} editable={editable} existing={Boolean(draft.id)} />
        <form id="dp-form" className="p-4 space-y-4" noValidate onSubmit={event => {event.preventDefault(); void save();}}><fieldset className="editor-fields space-y-4" disabled={!editable || saving}>
          <input type="hidden" id="f-id" value={draft.id} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="app-label" htmlFor="f-code">코드</label>
              <input id="f-code" className="app-input" placeholder="예: A001" value={draft.code} onChange={event => update('code',event.target.value)} />
            </div>
            <div>
              <label className="app-label" htmlFor="f-name">이름 *</label>
              <input id="f-name" className="app-input" required value={draft.name} onChange={event => update('name',event.target.value)} ref={nameInput} />
            </div>
          </div>

          <div>
            <label className="app-label" htmlFor="f-address">주소</label>
            <div className="flex gap-2">
              <input id="f-address" className="app-input flex-1" value={draft.address} onChange={event => update('address',event.target.value)} />
              <button type="button" id="btn-extract-region" className="btn btn-ghost text-xs whitespace-nowrap" onClick={extractRegion}>지역 자동추출</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="app-label" htmlFor="f-region">지역</label>
              <input id="f-region" className="app-input" placeholder="예: 서울 강남구" value={draft.region} onChange={event => update('region',event.target.value)} />
            </div>
            <div>
              <label className="app-label" htmlFor="f-deadline">납품마감</label>
              <input id="f-deadline" className="app-input biz-time" placeholder="예: 22:00 또는 02:30" aria-describedby="deadline-help" value={draft.deadline} onChange={event => update('deadline',event.target.value)} onBlur={normalizeDeadline} />
              <p id="deadline-help" className="text-[10px] text-zinc-500 mt-1">00:00~23:59 범위. 비워두면 마감 없음.</p>
            </div>
          </div>

          <fieldset>
            <legend className="app-label">진입조건 (가능 여부)</legend>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="cb"><input type="checkbox" id="f-1ton" checked={draft.allow_under_1ton} onChange={event => update('allow_under_1ton',event.target.checked)} />    1톤 이하</label>
              <label className="cb"><input type="checkbox" id="f-3_5ton" checked={draft.allow_under_3_5ton} onChange={event => update('allow_under_3_5ton',event.target.checked)} />  3.5톤 이하</label>
              <label className="cb"><input type="checkbox" id="f-5ton" checked={draft.allow_over_5ton} onChange={event => update('allow_over_5ton',event.target.checked)} />    5톤 이상</label>
              <label className="cb"><input type="checkbox" id="f-yard" checked={draft.allow_unmanned_yard} onChange={event => update('allow_unmanned_yard',event.target.checked)} />    무인 야적</label>
            </div>
          </fieldset>

          <div className="grid grid-cols-3 gap-3">
            <fieldset>
              <legend className="app-label">납품방식</legend>
              <div className="space-y-1">
                <label className="cb"><input type="radio" name="dmethod" value="대면" checked={draft.delivery_method === "대면"} onChange={event => update('delivery_method', event.target.value)} /> 대면</label>
                <label className="cb"><input type="radio" name="dmethod" value="검수" checked={draft.delivery_method === "검수"} onChange={event => update('delivery_method', event.target.value)} /> 검수</label>
                <label className="cb"><input type="radio" name="dmethod" value="무인" checked={draft.delivery_method === "무인"} onChange={event => update('delivery_method', event.target.value)} /> 무인</label>
                <label className="cb text-zinc-500"><input type="radio" name="dmethod" value="" checked={draft.delivery_method === ""} onChange={event => update('delivery_method', event.target.value)} /> 미지정</label>
              </div>
            </fieldset>
            <fieldset>
              <legend className="app-label">진입방식</legend>
              <div className="space-y-1">
                <label className="cb"><input type="radio" name="amethod" value="보안키" checked={draft.access_method === "보안키"} onChange={event => update('access_method', event.target.value)} /> 보안키</label>
                <label className="cb"><input type="radio" name="amethod" value="열쇠" checked={draft.access_method === "열쇠"} onChange={event => update('access_method', event.target.value)} />   열쇠</label>
                <label className="cb"><input type="radio" name="amethod" value="없음" checked={draft.access_method === "없음"} onChange={event => update('access_method', event.target.value)} />   없음</label>
                <label className="cb text-zinc-500"><input type="radio" name="amethod" value="" checked={draft.access_method === ""} onChange={event => update('access_method', event.target.value)} /> 미지정</label>
              </div>
            </fieldset>
            <fieldset>
              <legend className="app-label">납품장소</legend>
              <div className="space-y-1">
                <label className="cb"><input type="radio" name="dloc" value="창고" checked={draft.delivery_location === "창고"} onChange={event => update('delivery_location', event.target.value)} /> 창고</label>
                <label className="cb"><input type="radio" name="dloc" value="탑차" checked={draft.delivery_location === "탑차"} onChange={event => update('delivery_location', event.target.value)} /> 탑차</label>
                <label className="cb"><input type="radio" name="dloc" value="야적" checked={draft.delivery_location === "야적"} onChange={event => update('delivery_location', event.target.value)} /> 야적</label>
                <label className="cb text-zinc-500"><input type="radio" name="dloc" value="" checked={draft.delivery_location === ""} onChange={event => update('delivery_location', event.target.value)} /> 미지정</label>
              </div>
            </fieldset>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="app-label" htmlFor="f-security-key-location">열쇠보관장소</label>
              <input id="f-security-key-location" className="app-input" placeholder="예: 경비실, 출입문 상단, 키박스" value={draft.security_key_location} onChange={event => update('security_key_location',event.target.value)} />
            </div>
            <div>
              <label className="app-label" htmlFor="f-security-password">비밀번호</label>
              <input id="f-security-password" className="app-input" placeholder="보안키/키박스/출입문 비밀번호" value={draft.security_password} onChange={event => update('security_password',event.target.value)} />
            </div>
          </div>

          <div className="divider"></div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="app-label" htmlFor="f-rep-name">대표자명</label>
              <input id="f-rep-name" className="app-input" value={draft.rep_name} onChange={event => update('rep_name',event.target.value)} />
            </div>
            <div>
              <label className="app-label" htmlFor="f-rep-phone">대표번호</label>
              <input id="f-rep-phone" className="app-input" placeholder="예: 02-1234-5678" value={draft.rep_phone} onChange={event => update('rep_phone',event.target.value)} />
            </div>
            <div>
              <label className="app-label" htmlFor="f-mgr-name">담당자명</label>
              <input id="f-mgr-name" className="app-input" value={draft.contact_name} onChange={event => update('contact_name',event.target.value)} />
            </div>
            <div>
              <label className="app-label" htmlFor="f-mgr-office">담당자 사무실</label>
              <input id="f-mgr-office" className="app-input" value={draft.contact_office} onChange={event => update('contact_office',event.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="app-label" htmlFor="f-mgr-mobile">담당자 휴대폰</label>
              <input id="f-mgr-mobile" className="app-input" value={draft.contact_mobile} onChange={event => update('contact_mobile',event.target.value)} />
            </div>
          </div>

          <FileArea className="space-y-2" accept="image/*,.jpg,.jpeg,.png,.webp,.gif" multiple disabled={!editable || photoBusy} onFiles={files => void addPhotos(files)}>
            <div className="flex items-center justify-between gap-2">
              <label className="app-label mb-0" htmlFor="f-photo-input">납품처 사진</label>
              <span id="f-photo-count" className="text-[11px] text-zinc-500" role="status" aria-live="polite" aria-atomic="true">{draft.photos.length}/6</span>
            </div>
            <div id="f-photo-dropzone" tabIndex={0} role="region" aria-label="납품처 사진 붙여넣기" className="flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-600 bg-zinc-900/40 px-3 py-4 text-center text-xs text-zinc-400 hover:border-emerald-500 hover:text-emerald-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
              <input id="f-photo-input" type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.gif" multiple className="mt-3 block w-full max-w-xs text-xs text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-xs file:text-zinc-100 hover:file:bg-zinc-600" onChange={event => {void addPhotos([...(event.currentTarget.files || [])]); event.currentTarget.value="";}} />
              <span className="font-semibold text-zinc-200">이미지 붙여넣기</span>
              <span className="mt-1 text-emerald-300">이 영역을 클릭한 뒤 Ctrl+V로 사진을 붙여넣으세요.</span>
              <span className="mt-1">최대 6장 · HD(1280×720 이내) · 장당 1MB 이하 자동 압축</span>
            </div>
            <div id="f-photo-grid" className="grid grid-cols-3 gap-2">{photoMessage ? <div className={`col-span-3 rounded border border-zinc-700 bg-zinc-900/40 px-3 py-4 text-center text-xs ${photoMessage.error ? "text-red-300" : "text-emerald-300"}`}>{photoMessage.text}</div> : draft.photos.length ? draft.photos.map((photo,index) => <div key={photo.id || index} className="relative overflow-hidden rounded border border-zinc-700 bg-zinc-900"><button type="button" data-photo-view={index} className="block h-24 w-full" onClick={() => previewPhoto(photo)}><img src={photo.dataUrl} alt={`납품처 사진 ${index + 1}`} className="h-full w-full object-cover" /></button><button type="button" data-permission-action="edit" data-photo-delete={index} aria-label={`납품처 사진 ${index + 1} 삭제`} className="absolute right-1 top-1 rounded bg-red-600/90 px-1.5 py-0.5 text-[10px] text-white" disabled={!editable} onClick={() => update("photos",draft.photos.filter((_,i)=>i!==index))}>삭제</button></div>) : <div className="col-span-3 rounded border border-zinc-700 bg-zinc-900/40 px-3 py-4 text-center text-xs text-zinc-500">등록된 사진이 없습니다.</div>}</div>
          </FileArea>

          <div>
            <label className="app-label" htmlFor="f-memo">비고</label>
            <textarea id="f-memo" rows={2} className="app-textarea" value={draft.memo} onChange={event => update('memo',event.target.value)}></textarea>
          </div>

          <div className="work-form-actions flex items-center gap-2 pt-2 border-t border-zinc-700">
            <button type="submit" id="btn-save" data-permission-action="edit" className="btn btn-primary" disabled={!editable || saving} aria-busy={saving}>{saving ? '저장 중…' : '저장'}</button>
            <button type="button" id="btn-cancel" disabled={saving} className="btn btn-ghost" onClick={() => select(selectedRow, false, true)}>취소</button>
            <div className="flex-1"></div>
            <button type="button" id="btn-delete" data-permission-action="edit" className={`btn btn-danger${draft.id ? "" : " hidden"}`} onClick={() => void remove()} disabled={!editable}>삭제</button>
          </div>
        </fieldset></form>
      </section>
    </div>
  </main>
    {feedback}
  </>;
}
export default function DeliveryPoints() { return <AdminPage title="납품처 관리" bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><DeliveryPointsContent /></AdminPage>; }
