import { permissionAllowed } from '../lib/permissions';
import { useLegacyCommonCatalog } from '../lib/erp-course-catalog';
import { useRef, useState } from 'react';
import { Modal, ModalClose } from './Modal';
import { useAdminPage } from './AdminPage';
import { saveRoute } from '../lib/routes';
import type { Route, RouteMasters } from '../lib/routes';
import type { Notice } from './Toasts';

const routeDrafts = new Map<string, {draft: Record<string, unknown>; updatedAt?: string | null; createId:string}>();

export function RouteForm({ route, masters, close, saved, toast }: { route: Route | null; masters: RouteMasters; close: () => void; saved: () => Promise<void>; toast: (text: string, type: Notice['type']) => void }) {
  const { center, editable: pageEditable, permissions, profile } = useAdminPage();
  const editable = pageEditable && (!useLegacyCommonCatalog || permissionAllowed(permissions,'routes','edit',route ? route.center_code ?? 'unclassified' : center.code));
  const company = route?.company_id || '';
  const draftKey = profile.id+':'+(route?.id ?? 'new:'+center.code);
  const createId = useRef(routeDrafts.get(draftKey)?.createId ?? crypto.randomUUID());
  const original = useRef(routeDrafts.get(draftKey)?.updatedAt ?? route?.updated_at);
  const [saving,setSaving] = useState(false);
  const [draft, setDraft] = useState(() => (routeDrafts.get(draftKey)?.draft as {name:string;car:string;company:string;driver:string;driver2:string;vehicle:string;vehicle2:string;active:boolean;days:number[]} | undefined) ?? ({ name: route?.name || '', car: route?.car_number || '', company, driver: route?.primary_driver_id ?? '', driver2: route?.secondary_driver_id ?? '', vehicle: route?.primary_vehicle_id ?? '', vehicle2: route?.secondary_vehicle_id ?? '', active: route?.active !== false, days: [...(route?.closed_days || [])] }));
  routeDrafts.set(draftKey,{draft,updatedAt:original.current,createId:createId.current});
  const submitting = useRef(false);
  const currentDrivers = masters.drivers.filter(row => !draft.company || row.company_id === draft.company), currentVehicles = masters.vehicles.filter(row => !draft.company || row.company_id === draft.company);
  return <Modal dismissable={!saving} width="lg" label={route ? '코스 편집' : '새 코스'} onClose={() => { if (!submitting.current) close(); }}><div className="p-5"><div className="flex items-center justify-between mb-3"><h2 className="app-function-title text-base font-semibold">{route ? '코스 편집' : '새 코스'}</h2><ModalClose data-x className="btn btn-ghost text-xs">닫기</ModalClose></div>
    <fieldset disabled={saving || !editable}><form id="route-form" className="space-y-3" noValidate onSubmit={async event => {
      event.preventDefault(); if (!editable || submitting.current) return;
      const name = draft.name.trim(); if (!name) { toast('코스명은 필수입니다.', 'warn'); return; }
      const payload = { ...(route ? { id: route.id } : {}), center_code: route ? route.center_code ?? null : center.code, name, car_number: draft.car.trim() || null, company_id: draft.company || null, primary_driver_id: draft.driver || null, primary_vehicle_id: draft.vehicle || null, secondary_driver_id: draft.driver2 || null, secondary_vehicle_id: draft.vehicle2 || null, active: draft.active, closed_days: [...draft.days].sort((a, b) => a - b) };
      submitting.current = true; setSaving(true);
      try { const { error } = await saveRoute(payload, original.current,createId.current); if (error) { toast(`저장 실패: ${error.message}`, 'error'); return; } toast(route ? '수정되었습니다.' : '추가되었습니다.', 'success'); routeDrafts.delete(draftKey); close(); await saved(); }
      catch { toast('저장 중 오류가 발생했습니다.', 'error'); }
      finally { submitting.current = false; setSaving(false); }
    }}>
      <div><label className="app-label" htmlFor="r-name">코스명 *</label><input id="r-name" className="app-input" required value={draft.name} onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} /></div>
      <div className="grid grid-cols-2 gap-3"><div><label className="app-label" htmlFor="r-car">호차</label><input id="r-car" className="app-input" placeholder="예: 대-14호차" value={draft.car} onChange={event => setDraft(previous => ({ ...previous, car: event.target.value }))} /></div><div><label className="app-label" htmlFor="r-company">운수사</label><select id="r-company" className="app-select" value={draft.company} onChange={event => {
        const company = event.target.value;
        setDraft(previous => ({ ...previous, company }));
      }}><option value="">선택 안 함</option>{draft.company && !masters.companies.some(row => row.id === draft.company) ? <option value={draft.company}>기존 연결 · {draft.company}</option> : null}{masters.companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div></div>
      <div className="grid grid-cols-2 gap-3">{([['driver', 'r-driver', '주기사'], ['vehicle', 'r-vehicle', '주차량'], ['driver2', 'r-driver2', '보조기사'], ['vehicle2', 'r-vehicle2', '보조차량']] as const).map(([key, id, title]) => <div key={key}><label className="app-label" htmlFor={id}>{title}</label><select id={id} className="app-select" value={draft[key]} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))}><option value="">선택 안 함</option>{draft[key] && !(key.startsWith('driver') ? currentDrivers : currentVehicles).some(row => row.id === draft[key]) ? <option value={draft[key]}>기존 연결 · {draft[key]} (후보에 없음)</option> : null}{key.startsWith('driver') ? currentDrivers.map(row => <option key={row.id} value={row.id}>{row.name}{row.phone ? ' · ' + row.phone : ''}</option>) : currentVehicles.map(row => <option key={row.id} value={row.id}>{row.plate_number}{row.tonnage ? ' · ' + row.tonnage + 't' : ''}</option>)}</select></div>)}</div>
      <label className="cb"><input type="checkbox" id="r-active" checked={draft.active} onChange={event => setDraft(previous => ({ ...previous, active: event.target.checked }))} /> 활성</label>
      <div><label className="app-label">휴무일</label><div className="flex gap-3 flex-wrap mt-1">{['일', '월', '화', '수', '목', '금', '토'].map((day, index) => <label key={day} className="cb text-xs"><input type="checkbox" className="cd-check" value={index} checked={draft.days.includes(index)} onChange={event => { const checked = event.target.checked; setDraft(previous => ({ ...previous, days: checked ? [...previous.days, index] : previous.days.filter(day => day !== index) })); }} /> {day}</label>)}</div><p className="text-[10px] text-zinc-500 mt-1">체크한 요일에는 이 코스가 운행하지 않습니다.</p></div>
      <div className="flex items-center gap-2 pt-2 border-t border-zinc-700"><button type="submit" className="btn btn-primary" disabled={!editable}>저장</button><ModalClose data-x className="btn btn-ghost">취소</ModalClose></div>
    </form></fieldset>
  </div></Modal>;
}
