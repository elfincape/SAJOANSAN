import '../styles/route-edit.css';
import { useEffect, useRef, useState } from 'react';
import Sortable from 'sortablejs';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { StopForm } from '../components/StopForm';
import { useFeedback } from '../components/useFeedback';
import { deleteRouteStop, loadRouteDetails, updateStopOrder } from '../lib/route-stops';
import type { RouteDetails, RouteStop } from '../lib/route-stops';
import { withCenterParam } from '../lib/center';
import { bizMinToDisplay, formatSlack } from '../domain/time';

function RouteEditContent() {
  const { center, editable } = useAdminPage();
  const { toast, confirm, feedback } = useFeedback();
  const routeId = new URLSearchParams(location.search).get('id') || '';
  const [data, setData] = useState<RouteDetails>({ route: null, stops: [], points: [], company: null, drivers: [], vehicles: [] });
  const [editing, setEditing] = useState<RouteStop | null | undefined>(undefined);
  const body = useRef<HTMLTableSectionElement>(null), initial = useRef<ReturnType<typeof loadRouteDetails> | undefined>(undefined);
  const live = useRef(data); live.current = data;
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const redirect = (message: string) => { toast(message, 'error'); timer = setTimeout(() => location.replace(withCenterParam('/admin/routes.html', center)), 600); };
    if (!routeId) redirect('잘못된 접근입니다.');
    else {
      const request = initial.current ??= loadRouteDetails(center.code, routeId);
      void request.then(value => { if (!active) return; if (!value.route) { redirect('해당 코스를 찾을 수 없습니다.'); return; } setData(value); }).catch(() => { if (active) toast('코스 정보를 불러오지 못했습니다.', 'error'); });
    }
    return () => { active = false; clearTimeout(timer); };
  }, [routeId, center, toast]);
  async function reload() { try { const value = await loadRouteDetails(center.code, routeId); if (value.route) setData(value); else { toast('해당 코스를 찾을 수 없습니다.', 'error'); location.replace(withCenterParam('/admin/routes.html', center)); } } catch { toast('코스 정보를 불러오지 못했습니다.', 'error'); } }
  useEffect(() => {
    if (!body.current) return;
    const sortable = Sortable.create(body.current, {
      handle: '.drag-handle', animation: 150, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', disabled: !editable,
      onEnd: async event => {
        const from = event.oldIndex, to = event.newIndex;
        if (from == null || to == null) return;
        // Restore Sortable's temporary DOM move before React applies the new row state.
        event.from.insertBefore(event.item, event.from.children[from + (to < from ? 1 : 0)] || null);
        const backup = [...live.current.stops].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0));
        const next = [...backup]; const [item] = next.splice(from, 1); if (!item) return; next.splice(to, 0, item);
        const ordered = next.map((stop, index) => ({ ...stop, stop_order: index + 1 }));
        setData(previous => ({ ...previous, stops: ordered }));
        try { const { error } = await updateStopOrder(ordered.map(stop => ({ id: stop.id, route_id: routeId, delivery_point_id: stop.delivery_point_id, stop_order: stop.stop_order }))); if (error) throw error; toast('순서를 저장했습니다.', 'success'); }
        catch { toast('순서 저장 실패. 되돌립니다.', 'error'); setData(previous => ({ ...previous, stops: backup })); }
      },
    });
    return () => sortable.destroy();
  }, [editable, routeId, toast]);
  const points = new Map(data.points.map(point => [point.id, point]));
  const drivers = new Map(data.drivers.map(row => [row.id, row])), vehicles = new Map(data.vehicles.map(row => [row.id, row]));
  const route = data.route;
  async function remove(stop: RouteStop) {
    if (!editable) return;
    if (!await confirm(`납품처 "${points.get(stop.delivery_point_id)?.name || stop.delivery_point_id || ''}"을(를) 삭제할까요?`, { okText: '삭제', cancelText: '취소', danger: true })) return;
    try { const { error } = await deleteRouteStop(stop.id); if (error) { toast(`삭제 실패: ${error.message}`, 'error'); return; } toast('삭제되었습니다.', 'success'); await reload(); } catch { toast('삭제 중 오류가 발생했습니다.', 'error'); }
  }
  return <>
    <main id="work-main" tabIndex={-1} className="app-main flex-1 max-w-[1600px] w-full mx-auto px-4 py-3">
      {!editable ? <p id="read-only-notice" className="text-sm text-amber-300 p-3">열람 전용 · 선택한 센터에서 이 업무를 수정할 권한이 없습니다.</p> : null}
      <section id="route-info" className="border border-zinc-700 rounded-lg p-3 mb-3 bg-zinc-800/40"><div id="route-info-body" className="text-sm text-zinc-300">{route ? <div className="flex flex-wrap gap-x-6 gap-y-1"><div><span className="muted">코스</span> <strong>{route.name}</strong></div><div><span className="muted">호차</span> {route.car_number || '-'}</div><div><span className="muted">운수사</span> {data.company?.name || '-'}</div><div><span className="muted">주기사</span> {drivers.get(route.primary_driver_id || '')?.name || '-'}</div><div><span className="muted">주차량</span> {vehicles.get(route.primary_vehicle_id || '')?.plate_number || '-'}{vehicles.get(route.primary_vehicle_id || '')?.tonnage ? ' · ' + vehicles.get(route.primary_vehicle_id || '')!.tonnage + 't' : ''}</div>{drivers.has(route.secondary_driver_id || '') ? <div><span className="muted">보조기사</span> {drivers.get(route.secondary_driver_id!)?.name}</div> : null}{vehicles.has(route.secondary_vehicle_id || '') ? <div><span className="muted">보조차량</span> {vehicles.get(route.secondary_vehicle_id!)?.plate_number}</div> : null}<div className="ml-auto"><a href={withCenterParam('/admin/routes.html', center)} className="text-xs text-emerald-400 hover:underline">코스 정보 편집 →</a></div></div> : '불러오는 중...'}</div></section>
      <div className="flex flex-wrap items-center gap-2 mb-2"><button id="add-stop-btn" data-permission-action="edit" className="btn btn-primary" disabled={!editable} onClick={() => setEditing(null)}>+ 납품처 추가</button><div className="flex-1" /><span id="result-count" className="text-xs text-zinc-400">납품처 {data.stops.length}개</span></div>
      <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 280px)' }} tabIndex={0} role="region" aria-label="목록"><table className="app-table" id="stops-table"><thead><tr>{['순서', '코드', '납품처', '입차', '하차시작', '하차종료', '마감', '여유', '★', '열쇠보관장소', '비밀번호', '비고', '작업'].map((title, index) => <th key={title} className={index === 0 || index === 12 ? 'text-right' : index >= 3 && index <= 7 ? 'biz-time' : undefined} style={index === 0 ? { width: 64 } : undefined}>{title}</th>)}</tr></thead><tbody ref={body} id="stops-tbody">{[...data.stops].sort((a, b) => (a.stop_order ?? 0) - (b.stop_order ?? 0)).map(stop => {
        const point = points.get(stop.delivery_point_id), deadline = stop.deadline_business_min != null ? stop.deadline_business_min : point?.deadline_business_min;
        const slack = deadline != null && stop.unloading_end_business_min != null ? deadline - stop.unloading_end_business_min : null;
        const override = stop.override_delivery_method != null || stop.override_access_method != null || stop.override_delivery_location != null;
        return <tr key={stop.id} className="stop-row" data-id={stop.id}><td className="text-right"><span className="drag-handle inline-block mr-1" title="끌어서 순서 변경">⋮⋮</span><span className="tnum">{stop.stop_order ?? ''}</span></td><td>{point?.code || '-'}</td><td>{point?.name || '(삭제됨)'}<span className="ml-1 text-xs text-zinc-500">{point?.region || ''}</span></td><td className="biz-time">{bizMinToDisplay(stop.arrival_business_min)}</td><td className="biz-time">{bizMinToDisplay(stop.unloading_start_business_min)}</td><td className="biz-time">{bizMinToDisplay(stop.unloading_end_business_min)}</td><td className={`biz-time${deadline != null && stop.unloading_end_business_min != null && deadline < stop.unloading_end_business_min ? ' text-amber-400' : ''}`}>{bizMinToDisplay(deadline)}</td><td className="biz-time">{slack != null ? <span className={slack < 0 ? 'slack-neg' : slack < 30 ? 'text-amber-400' : 'slack-pos'}>{formatSlack(slack)}</span> : null}</td><td>{override ? <span className="text-amber-300" title="오버라이드 있음">★</span> : null}</td><td className="max-w-[160px] truncate" title={point?.security_key_location || ''}>{point?.security_key_location || ''}</td><td className="max-w-[120px] truncate" title={point?.security_password || ''}>{point?.security_password || ''}</td><td className="max-w-[180px] truncate" title={stop.memo || ''}>{stop.memo || ''}</td><td className="text-right whitespace-nowrap"><button className="btn btn-ghost text-xs" data-permission-action="edit" data-act="edit" data-id={stop.id} disabled={!editable} onClick={() => setEditing(stop)}>편집</button><button className="btn btn-ghost text-xs text-rose-400" data-permission-action="edit" data-act="delete" data-id={stop.id} disabled={!editable} onClick={() => void remove(stop)}>삭제</button></td></tr>;
      })}</tbody></table><div id="empty-msg" className={`${data.stops.length ? 'hidden ' : ''}text-center text-sm text-zinc-500 py-12`}>등록된 납품처가 없습니다. "+ 납품처 추가"로 시작하세요.</div></div>
    </main>
    {editing !== undefined ? <StopForm stop={editing} details={data} routeId={routeId} close={() => setEditing(undefined)} saved={reload} toast={toast} confirm={confirm} /> : null}
    {feedback}
  </>;
}
function RouteBackLink() { const { center } = useAdminPage(); return <a href={withCenterParam('/admin/routes.html', center)} className="text-xs text-zinc-400 hover:text-zinc-100">← 코스 목록</a>; }
export default function RouteEdit() { return <AdminPage title="코스 편집" centerTarget="/admin/routes.html" actions={<RouteBackLink />} bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><RouteEditContent /></AdminPage>; }
