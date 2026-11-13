import { createWorkspaceStore } from '../lib/workspace-session';
import { WorkspaceDraftStatus } from './WorkspaceDraftStatus';
import { permissionAllowed } from '../lib/permissions';
import { useLayoutEffect, useRef, useState } from 'react';
import { Modal, ModalClose } from './Modal';
import { useAdminPage } from './AdminPage';
import type { useFeedback } from './useFeedback';
import { reorderAroundSaved, upsertRouteStop, saveRouteStops } from '../lib/route-stops';
import type { RouteDetails, RouteStop } from '../lib/route-stops';
import type { DeliveryPoint } from '../lib/delivery-points';
import { useLegacyCommonCatalog } from '../lib/erp-course-catalog';
import { normalizeStopTime } from '../domain/route-stops';
import { bizMinToDisplay, displayToBizMin } from '../domain/time';

type StopDraft = Record<'order'|'arrival'|'start'|'end'|'deadline'|'delivery'|'access'|'location'|'memo',string>;
const stopDrafts=createWorkspaceStore<{draft:StopDraft;modes:NonNullable<RouteStop['condition_modes']>;point?:DeliveryPoint;search:string;expected:RouteStop[];original:RouteStop|null;createId:string}>('stop-draft', value => !!value.draft && ['order','arrival','start','end','deadline','delivery','access','location','memo'].every(key => typeof value.draft[key as keyof StopDraft] === 'string') && Array.isArray(value.expected) && value.expected.every(row => typeof row.id === 'string' && typeof row.route_id === 'string') && typeof value.search === 'string' && typeof value.createId === 'string' && !!value.modes);
export function StopForm({ stop, details, routeId, close, saved, toast, confirm }: { stop: RouteStop | null; details: RouteDetails; routeId: string; close: () => void; saved: () => Promise<void>; toast: ReturnType<typeof useFeedback>['toast']; confirm: ReturnType<typeof useFeedback>['confirm'] }) {
  const { editable: pageEditable, permissions, profile } = useAdminPage();
  const editable = pageEditable && (!useLegacyCommonCatalog || permissionAllowed(permissions,'routes','edit',details.route?.center_code ?? 'unclassified'));
  const key=profile.id+':'+routeId+':'+(stop?.id ?? 'new');
  const restored=useRef(stopDrafts.get(key));
  const expected=useRef(restored.current?.expected ?? details.stops);
  stop=restored.current?.original ?? stop;
  const initialPoint = details.points.find(point => point.id === stop?.delivery_point_id);
  const [point, setPoint] = useState<DeliveryPoint | undefined>(restored.current?.point ?? initialPoint);
  const [search, setSearch] = useState(restored.current?.search ?? (initialPoint ? `${initialPoint.code || ''} ${initialPoint.name}`.trim() : '')), [showResults, setShowResults] = useState(false);
  const registered = new Set(details.stops.map(stop => stop.delivery_point_id));
  const unregistered = details.points.filter(point => !point.deleted_at && !registered.has(point.id)).sort((a, b) => String(a.code || a.name || '').localeCompare(String(b.code || b.name || ''), 'ko-KR', { numeric: true }));
  const [unregisteredValue, setUnregisteredValue] = useState(unregistered.some(point => point.id === initialPoint?.id) ? initialPoint!.id : '');
  const baselineDraft = useRef<StopDraft>({ order: stop?.stop_order == null ? String(details.stops.reduce((max, stop) => Math.max(max, stop.stop_order || 0), 0) + 1) : String(stop.stop_order), arrival: stop?.arrival_text ?? bizMinToDisplay(stop?.arrival_business_min), start: stop?.unloading_start_text ?? bizMinToDisplay(stop?.unloading_start_business_min), end: stop?.unloading_end_text ?? bizMinToDisplay(stop?.unloading_end_business_min), deadline: stop?.deadline_text ?? bizMinToDisplay(stop?.deadline_business_min), delivery: stop?.override_delivery_method || '', access: stop?.override_access_method || '', location: stop?.override_delivery_location || '', memo: stop?.memo || '' });
  const [draft, setDraft] = useState<StopDraft>(()=>restored.current?.draft ?? baselineDraft.current);
  const submitting = useRef(false), createdId = useRef(restored.current?.createId ?? crypto.randomUUID());
  const [modes, setModes] = useState(restored.current?.modes ?? stop?.condition_modes ?? {});
  const [saving, setSaving] = useState(false);
  const completed = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baselineDraft.current) || JSON.stringify(modes) !== JSON.stringify(stop?.condition_modes ?? {}) || point?.id !== initialPoint?.id || search !== (initialPoint ? `${initialPoint.code || ''} ${initialPoint.name}`.trim() : '');
  useLayoutEffect(()=>{if(completed.current) return; if (!dirty) { stopDrafts.delete(key); return; } stopDrafts.set(key,{draft,modes,point,search,expected:expected.current,original:stop,createId:createdId.current});},[key,draft,modes,point,search,stop,dirty]);
  const hits = search.trim() ? details.points.filter(point => !point.deleted_at && ((point.code || '').toLowerCase().includes(search.trim().toLowerCase()) || (point.name || '').toLowerCase().includes(search.trim().toLowerCase()))).slice(0, 30) : [];
  function selectPoint(point: DeliveryPoint) { setPoint(point); setSearch(`${point.code || ''} ${point.name}`.trim()); setUnregisteredValue(unregistered.some(row => row.id === point.id) ? point.id : ''); setShowResults(false); }
  const update = (key: keyof typeof draft, value: string) => setDraft(previous => ({ ...previous, [key]: value }));
  function normalize(key: 'arrival' | 'start' | 'end' | 'deadline') {
    const value = draft[key].trim(); if (!value) return;
    const normal = normalizeStopTime(value);
    if (!normal) { toast('시간 형식이 올바르지 않습니다. 예: 22:00, 25:30', 'warn'); return; }
    if (displayToBizMin(normal) == null) { toast('시간은 04:00 ~ 27:59 범위여야 합니다.', 'warn'); return; }
    update(key, normal);
  }
  async function submit() {
    if (!editable || submitting.current) return;
    if (!point && !stop?.delivery_point_id) { toast('납품처를 선택해주세요.', 'warn'); return; }
    for (const key of ['arrival','start','end','deadline'] as const) {
      const value=draft[key].trim();
      const old = key==='arrival' ? stop?.arrival_text ?? bizMinToDisplay(stop?.arrival_business_min) : key==='start' ? stop?.unloading_start_text ?? bizMinToDisplay(stop?.unloading_start_business_min) : key==='end' ? stop?.unloading_end_text ?? bizMinToDisplay(stop?.unloading_end_business_min) : stop?.deadline_text ?? bizMinToDisplay(stop?.deadline_business_min);
      if(value && value!==old && (!normalizeStopTime(value) || displayToBizMin(normalizeStopTime(value))==null)) {toast('시간 형식을 확인하세요. 입력은 보존됩니다.','warn');return;}
    }
    const arrival = normalizeStopTime(draft.arrival.trim()), start = normalizeStopTime(draft.start.trim()), end = normalizeStopTime(draft.end.trim()), deadline = normalizeStopTime(draft.deadline.trim());
    if (!stop && details.stops.some(stop => stop.delivery_point_id === point?.id)) {
      if (!await confirm('이 코스에 같은 납품처가 이미 등록되어 있습니다.\n중복으로 추가할까요?', { okText: '추가', cancelText: '취소' })) return;
    }
    const order = parseInt(draft.order, 10), desired = Number.isFinite(order) && order > 0 ? order : details.stops.length + 1;
    const payload = { id: stop?.id ?? createdId.current, route_id: routeId, delivery_point_id: point?.id ?? stop!.delivery_point_id, stop_order: -999999, arrival_text: arrival || null, arrival_business_min: arrival ? displayToBizMin(arrival) : null, unloading_start_text: start || null, unloading_start_business_min: start ? displayToBizMin(start) : null, unloading_end_text: end || null, unloading_end_business_min: end ? displayToBizMin(end) : null, deadline_text: deadline || null, deadline_business_min: deadline ? displayToBizMin(deadline) : null, override_delivery_method: modes.delivery_method === 'set' ? draft.delivery : draft.delivery || null, override_access_method: modes.access_method === 'set' ? draft.access : draft.access || null, override_delivery_location: modes.delivery_location === 'set' ? draft.location : draft.location || null, memo: draft.memo.trim() || null };
    if(stop) {
      for(const [key,textKey,minKey] of [['arrival','arrival_text','arrival_business_min'],['start','unloading_start_text','unloading_start_business_min'],['end','unloading_end_text','unloading_end_business_min'],['deadline','deadline_text','deadline_business_min']] as const) {
        if(draft[key]===(stop[textKey] ?? bizMinToDisplay(stop[minKey]))) {payload[textKey]=stop[textKey];payload[minKey]=stop[minKey];}
      }
      for(const [key,field] of [['delivery','override_delivery_method'],['access','override_access_method'],['location','override_delivery_location'],['memo','memo']] as const) {
        if(draft[key]===(stop[field] ?? '') && (key==='memo' || modes[key==='delivery'?'delivery_method':key==='access'?'access_method':'delivery_location']===stop.condition_modes?.[key==='delivery'?'delivery_method':key==='access'?'access_method':'delivery_location'])) payload[field]=stop[field];
      }
    }
    submitting.current = true; setSaving(true);
    try { if (useLegacyCommonCatalog) {
      const changed = {...payload, condition_modes: modes};
      const ordered = expected.current.filter(row => row.id !== changed.id).sort((a,b)=>(a.stop_order ?? 0)-(b.stop_order ?? 0));
      ordered.splice(Math.min(desired-1,ordered.length),0,changed);
      const {error} = await saveRouteStops(routeId,expected.current,ordered.map((row,index)=>({...row,stop_order:index+1})));
      if (error) throw error;
      completed.current = true; stopDrafts.delete(key); toast('저장되었습니다.','success'); close(); await saved(); return;
    }
    const { data, error } = await upsertRouteStop(payload); if (error) { toast(`저장 실패: ${error.message}`, 'error'); return; } if (data) await reorderAroundSaved(details.stops, data, desired, routeId); completed.current = true; stopDrafts.delete(key); toast(stop ? '수정되었습니다.' : '추가되었습니다.', 'success'); close(); await saved(); }
    catch (error) { toast(error && typeof error === 'object' && 'message' in error ? String(error.message) : '저장 중 오류가 발생했습니다.', 'error'); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <Modal dismissable={!saving} width="xl" label={stop ? '코스 연결·조건 편집' : '납품처 추가'} onClose={() => { if (!submitting.current) close(); }}><div className="p-5 max-h-[85vh] overflow-auto"><div className="flex items-center justify-between mb-3"><h2 className="app-function-title text-base font-semibold">{stop ? '코스 연결·조건 편집' : '납품처 추가'}</h2><ModalClose data-x className="btn btn-ghost text-xs">닫기</ModalClose></div>
    <WorkspaceDraftStatus storageKeys={[stopDrafts.storageKey(key)]} dirty={dirty} />
    <fieldset disabled={saving || !editable}><form data-permission-action="edit" id="stop-form" className="space-y-3" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div><div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px] gap-2 items-end"><div><label className="app-label" htmlFor="dp-search">납품처 *</label><input id="dp-search" className="app-input" placeholder="코드 또는 이름으로 검색" autoComplete="off" value={search} onChange={event => { setSearch(event.target.value); setShowResults(true); }} /></div><div><label className="app-label" htmlFor="dp-unregistered">미등록 납품처</label><select id="dp-unregistered" className="app-select" value={unregisteredValue} onChange={event => { setUnregisteredValue(event.target.value); const point = details.points.find(point => point.id === event.target.value); if (point) selectPoint(point); }}><option value="">미등록 납품처 선택</option>{unregistered.length ? unregistered.map(point => <option key={point.id} value={point.id}>{`${point.code || ''} ${point.name || ''}`.trim()}{point.region ? ' · ' + point.region : ''}</option>) : <option value="" disabled>미등록 납품처 없음</option>}</select></div></div>
        <div id="dp-results" className={`mt-1 max-h-40 overflow-auto border border-zinc-700 rounded-md bg-zinc-900${showResults && hits.length ? '' : ' hidden'}`}>{hits.map(point => <div key={point.id} className="px-2 py-1.5 text-sm hover:bg-zinc-700 cursor-pointer" data-id={point.id} onClick={() => selectPoint(point)}><strong>{point.code || ''}</strong> · {point.name}{point.deleted_at ? ' (삭제됨)' : ''} <span className="muted text-xs">{point.region || ''}</span></div>)}</div>
        <div id="dp-selected" className="mt-1 text-xs">{point ? <>선택: <strong>{point.code || ''}</strong> · {point.name} <span className="muted">{point.region || ''}</span></> : stop?.delivery_point_id ? <span>기존 연결 · {stop.delivery_point_id} (삭제되었거나 조회 권한 없음)</span> : null}</div><input type="hidden" id="dp-id" value={point?.id || ''} />
      </div>
      <div className="grid grid-cols-3 gap-3"><div><label className="app-label" htmlFor="s-order">순서</label><input id="s-order" type="number" min="1" className="app-input" value={draft.order} onChange={event => update('order', event.target.value)} /></div>{([['arrival', 's-arrival', '입차 *', '예: 22:00'], ['start', 's-ustart', '하차시작', '예: 22:10'], ['end', 's-uend', '하차종료', '예: 22:30'], ['deadline', 's-deadline', '마감 (납품처 단위 오버라이드, 비우면 납품처 기본값)', '비워두면 납품처 마감 사용']] as const).map(([key, id, label, placeholder]) => <div key={key} className={key === 'deadline' ? 'col-span-2' : undefined}><label className="app-label" htmlFor={id}>{label}</label><input id={id} className="app-input biz-time" placeholder={placeholder} value={draft[key]} onChange={event => update(key, event.target.value)} onBlur={() => normalize(key)} /></div>)}</div>
      {useLegacyCommonCatalog ? <div className="grid grid-cols-2 gap-3">{(['delivery_method','access_method','delivery_location','deadline'] as const).map(key => <label key={key} className="app-label">{{delivery_method:'납품방식',access_method:'진입방식',delivery_location:'납품장소',deadline:'마감'}[key]} 적용<select className="app-select" value={modes[key] ?? 'legacy'} onChange={event => setModes(previous => ({...previous,[key]:event.target.value as 'inherit'|'set'|'clear'}))}><option value="legacy" disabled>기존 값 유지</option><option value="inherit">공통 값 상속</option><option value="set">개별 지정</option><option value="clear">명시적 비움</option></select></label>)}</div> : null}
      <details className="border border-zinc-700 rounded-md"><summary className="px-3 py-2 cursor-pointer text-sm">고급 설정 (오버라이드)</summary><div className="p-3 grid grid-cols-3 gap-3">{([
        ['delivery', 'ov-dmethod', '납품방식', ['대면', '검수', '무인']], ['access', 'ov-amethod', '진입방식', ['보안키', '열쇠', '없음']], ['location', 'ov-dloc', '납품장소', ['창고', '탑차', '야적']],
      ] as const).map(([key, id, label, values]) => <div key={key}><label className="app-label" htmlFor={id}>{label}</label><select id={id} className="app-select" value={draft[key]} onChange={event => update(key, event.target.value)}><option value="">기본값 사용</option>{values.map(value => <option key={value} value={value}>{value}</option>)}</select></div>)}</div></details>
      <div><label className="app-label" htmlFor="s-memo">비고</label><textarea id="s-memo" rows={2} className="app-textarea" value={draft.memo} onChange={event => update('memo', event.target.value)} /></div><div id="form-warn" className="hidden text-xs text-amber-400 bg-amber-900/20 border border-amber-900/40 rounded-md px-3 py-2" />
      <div className="flex items-center gap-2 pt-2 border-t border-zinc-700"><button type="submit" className="btn btn-primary" disabled={!editable}>저장</button><ModalClose data-x className="btn btn-ghost" onAction={() => { completed.current = true; stopDrafts.delete(key); }}>취소</ModalClose></div>
    </form></fieldset>
  </div></Modal>;
}
