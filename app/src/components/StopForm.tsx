import { useRef, useState } from 'react';
import { Modal } from './Modal';
import { useAdminPage } from './AdminPage';
import type { useFeedback } from './useFeedback';
import { reorderAroundSaved, upsertRouteStop } from '../lib/route-stops';
import type { RouteDetails, RouteStop } from '../lib/route-stops';
import type { DeliveryPoint } from '../lib/delivery-points';
import { normalizeStopTime } from '../domain/route-stops';
import { bizMinToDisplay, displayToBizMin } from '../domain/time';

export function StopForm({ stop, details, routeId, close, saved, toast, confirm }: { stop: RouteStop | null; details: RouteDetails; routeId: string; close: () => void; saved: () => Promise<void>; toast: ReturnType<typeof useFeedback>['toast']; confirm: ReturnType<typeof useFeedback>['confirm'] }) {
  const { editable } = useAdminPage();
  const initialPoint = details.points.find(point => point.id === stop?.delivery_point_id);
  const [point, setPoint] = useState<DeliveryPoint | undefined>(initialPoint);
  const [search, setSearch] = useState(initialPoint ? `${initialPoint.code || ''} ${initialPoint.name}`.trim() : ''), [showResults, setShowResults] = useState(false);
  const registered = new Set(details.stops.map(stop => stop.delivery_point_id));
  const unregistered = details.points.filter(point => !registered.has(point.id)).sort((a, b) => String(a.code || a.name || '').localeCompare(String(b.code || b.name || ''), 'ko-KR', { numeric: true }));
  const [unregisteredValue, setUnregisteredValue] = useState(unregistered.some(point => point.id === initialPoint?.id) ? initialPoint!.id : '');
  const [draft, setDraft] = useState({ order: stop?.stop_order == null ? String(details.stops.reduce((max, stop) => Math.max(max, stop.stop_order || 0), 0) + 1) : String(stop.stop_order), arrival: stop?.arrival_text || bizMinToDisplay(stop?.arrival_business_min), start: stop?.unloading_start_text || bizMinToDisplay(stop?.unloading_start_business_min), end: stop?.unloading_end_text || bizMinToDisplay(stop?.unloading_end_business_min), deadline: stop?.deadline_text || bizMinToDisplay(stop?.deadline_business_min), delivery: stop?.override_delivery_method || '', access: stop?.override_access_method || '', location: stop?.override_delivery_location || '', memo: stop?.memo || '' });
  const submitting = useRef(false);
  const hits = search.trim() ? details.points.filter(point => (point.code || '').toLowerCase().includes(search.trim().toLowerCase()) || (point.name || '').toLowerCase().includes(search.trim().toLowerCase())).slice(0, 30) : [];
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
    if (!point) { toast('납품처를 선택해주세요.', 'warn'); return; }
    const arrival = normalizeStopTime(draft.arrival.trim()), start = normalizeStopTime(draft.start.trim()), end = normalizeStopTime(draft.end.trim()), deadline = normalizeStopTime(draft.deadline.trim());
    if (!stop && details.stops.some(stop => stop.delivery_point_id === point.id)) {
      close();
      if (!await confirm('이 코스에 같은 납품처가 이미 등록되어 있습니다.\n중복으로 추가할까요?', { okText: '추가', cancelText: '취소' })) return;
    }
    const order = parseInt(draft.order, 10), desired = Number.isFinite(order) && order > 0 ? order : details.stops.length + 1;
    const payload = { ...(stop ? { id: stop.id } : {}), route_id: routeId, delivery_point_id: point.id, stop_order: -999999, arrival_text: arrival || null, arrival_business_min: arrival ? displayToBizMin(arrival) : null, unloading_start_text: start || null, unloading_start_business_min: start ? displayToBizMin(start) : null, unloading_end_text: end || null, unloading_end_business_min: end ? displayToBizMin(end) : null, deadline_text: deadline || null, deadline_business_min: deadline ? displayToBizMin(deadline) : null, override_delivery_method: draft.delivery || null, override_access_method: draft.access || null, override_delivery_location: draft.location || null, memo: draft.memo.trim() || null };
    submitting.current = true;
    try { const { data, error } = await upsertRouteStop(payload); if (error) { toast(`저장 실패: ${error.message}`, 'error'); return; } if (data) await reorderAroundSaved(details.stops, data, desired, routeId); toast(stop ? '수정되었습니다.' : '추가되었습니다.', 'success'); close(); await saved(); }
    catch { toast('저장 중 오류가 발생했습니다.', 'error'); }
    finally { submitting.current = false; }
  }
  return <Modal width="xl" label={stop ? '납품처 편집' : '납품처 추가'} onClose={close}><div className="p-5 max-h-[85vh] overflow-auto"><div className="flex items-center justify-between mb-3"><h2 className="app-function-title text-base font-semibold">{stop ? '납품처 편집' : '납품처 추가'}</h2><button data-x className="btn btn-ghost text-xs" onClick={close}>닫기</button></div>
    <form data-permission-action="edit" id="stop-form" className="space-y-3" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div><div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px] gap-2 items-end"><div><label className="app-label" htmlFor="dp-search">납품처 *</label><input id="dp-search" className="app-input" placeholder="코드 또는 이름으로 검색" autoComplete="off" value={search} onChange={event => { setSearch(event.target.value); setShowResults(true); }} /></div><div><label className="app-label" htmlFor="dp-unregistered">미등록 납품처</label><select id="dp-unregistered" className="app-select" value={unregisteredValue} onChange={event => { setUnregisteredValue(event.target.value); const point = details.points.find(point => point.id === event.target.value); if (point) selectPoint(point); }}><option value="">미등록 납품처 선택</option>{unregistered.length ? unregistered.map(point => <option key={point.id} value={point.id}>{`${point.code || ''} ${point.name || ''}`.trim()}{point.region ? ' · ' + point.region : ''}</option>) : <option value="" disabled>미등록 납품처 없음</option>}</select></div></div>
        <div id="dp-results" className={`mt-1 max-h-40 overflow-auto border border-zinc-700 rounded-md bg-zinc-900${showResults && hits.length ? '' : ' hidden'}`}>{hits.map(point => <div key={point.id} className="px-2 py-1.5 text-sm hover:bg-zinc-700 cursor-pointer" data-id={point.id} onClick={() => selectPoint(point)}><strong>{point.code || ''}</strong> · {point.name} <span className="muted text-xs">{point.region || ''}</span></div>)}</div>
        <div id="dp-selected" className="mt-1 text-xs">{point ? <>선택: <strong>{point.code || ''}</strong> · {point.name} <span className="muted">{point.region || ''}</span></> : null}</div><input type="hidden" id="dp-id" value={point?.id || ''} />
      </div>
      <div className="grid grid-cols-3 gap-3"><div><label className="app-label" htmlFor="s-order">순서</label><input id="s-order" type="number" min="1" className="app-input" value={draft.order} onChange={event => update('order', event.target.value)} /></div>{([['arrival', 's-arrival', '입차 *', '예: 22:00'], ['start', 's-ustart', '하차시작', '예: 22:10'], ['end', 's-uend', '하차종료', '예: 22:30'], ['deadline', 's-deadline', '마감 (납품처 단위 오버라이드, 비우면 납품처 기본값)', '비워두면 납품처 마감 사용']] as const).map(([key, id, label, placeholder]) => <div key={key} className={key === 'deadline' ? 'col-span-2' : undefined}><label className="app-label" htmlFor={id}>{label}</label><input id={id} className="app-input biz-time" placeholder={placeholder} value={draft[key]} onChange={event => update(key, event.target.value)} onBlur={() => normalize(key)} /></div>)}</div>
      <details className="border border-zinc-700 rounded-md"><summary className="px-3 py-2 cursor-pointer text-sm">고급 설정 (오버라이드)</summary><div className="p-3 grid grid-cols-3 gap-3">{([
        ['delivery', 'ov-dmethod', '납품방식', ['대면', '검수', '무인']], ['access', 'ov-amethod', '진입방식', ['보안키', '열쇠', '없음']], ['location', 'ov-dloc', '납품장소', ['창고', '탑차', '야적']],
      ] as const).map(([key, id, label, values]) => <div key={key}><label className="app-label" htmlFor={id}>{label}</label><select id={id} className="app-select" value={draft[key]} onChange={event => update(key, event.target.value)}><option value="">기본값 사용</option>{values.map(value => <option key={value} value={value}>{value}</option>)}</select></div>)}</div></details>
      <div><label className="app-label" htmlFor="s-memo">비고</label><textarea id="s-memo" rows={2} className="app-textarea" value={draft.memo} onChange={event => update('memo', event.target.value)} /></div><div id="form-warn" className="hidden text-xs text-amber-400 bg-amber-900/20 border border-amber-900/40 rounded-md px-3 py-2" />
      <div className="flex items-center gap-2 pt-2 border-t border-zinc-700"><button type="submit" className="btn btn-primary" disabled={!editable}>저장</button><button type="button" data-x className="btn btn-ghost" onClick={close}>취소</button></div>
    </form>
  </div></Modal>;
}
