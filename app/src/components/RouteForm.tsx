import { createWorkspaceStore } from '../lib/workspace-session';
import { WorkspaceDraftStatus } from './WorkspaceDraftStatus';
import { catalogValueEqual } from '../lib/catalog-scope';
import { CatalogSaveReview } from './CatalogSaveReview';
import { EditorStatus } from './EditorStatus';
import { permissionAllowed } from '../lib/permissions';
import { useLegacyCommonCatalog } from '../lib/erp-course-catalog';
import { useLayoutEffect, useRef, useState } from 'react';
import { Modal, ModalClose } from './Modal';
import { useAdminPage } from './AdminPage';
import { saveRoute } from '../lib/routes';
import type { Route, RouteMasters } from '../lib/routes';
import type { Notice } from './Toasts';

const routeDrafts = createWorkspaceStore<{draft: Record<string, unknown>; updatedAt?: string | null; original?: Route | null; createId:string}>('route-draft', value => !!value.draft && ['name','car','company','driver','driver2','vehicle','vehicle2'].every(key => typeof value.draft[key] === 'string') && Array.isArray(value.draft.days) && typeof value.draft.active === 'boolean' && typeof value.createId === 'string' && (!value.original || typeof value.original.id === 'string'));

export function RouteForm({ route, masters, close, saved, toast }: { route: Route | null; masters: RouteMasters; close: () => void; saved: () => Promise<void>; toast: (text: string, type: Notice['type']) => void }) {
  const { center, editable: pageEditable, permissions, profile } = useAdminPage();

  const toDraft = (row: Route | null) => ({ name: row?.name || '', car: row?.car_number || '', company: row?.company_id || '', driver: row?.primary_driver_id ?? '', driver2: row?.secondary_driver_id ?? '', vehicle: row?.primary_vehicle_id ?? '', vehicle2: row?.secondary_vehicle_id ?? '', active: row?.active !== false, days: [...(row?.closed_days || [])] });
  const draftKey = profile.id+':'+(route?.id ?? 'new:'+center.code);
  const createId = useRef(routeDrafts.get(draftKey)?.createId ?? crypto.randomUUID());
  const baseline = useRef(routeDrafts.get(draftKey)?.original ?? route);
  const editable = pageEditable && (!useLegacyCommonCatalog || permissionAllowed(permissions,'routes','edit',baseline.current ? baseline.current.center_code ?? 'unclassified' : center.code));
  const original = useRef(routeDrafts.get(draftKey)?.updatedAt ?? route?.updated_at);
  const [saveError, setSaveError] = useState('');
  const [saving,setSaving] = useState(false);
  const [draft, setDraft] = useState(() => (routeDrafts.get(draftKey)?.draft as {name:string;car:string;company:string;driver:string;driver2:string;vehicle:string;vehicle2:string;active:boolean;days:number[]} | undefined) ?? toDraft(route));
  const completed = useRef(false);
  const submitting = useRef(false);
  const fields = { name: 'name', car: 'car_number', company: 'company_id', driver: 'primary_driver_id', driver2: 'secondary_driver_id', vehicle: 'primary_vehicle_id', vehicle2: 'secondary_vehicle_id', active: 'active', days: 'closed_days' } as const;
  function changedFields() {
    const before = toDraft(baseline.current);
    return Object.fromEntries(Object.entries(fields).filter(([key]) => !baseline.current || !catalogValueEqual(draft[key as keyof typeof draft], before[key as keyof typeof before])).map(([key, field]) => { const value = draft[key as keyof typeof draft]; return [field, typeof value === 'string' ? value.trim() || null : Array.isArray(value) ? [...value].sort((a,b)=>a-b) : value]; }));
  }
  const patch = changedFields();
  const dirty = Object.keys(patch).length > 0;
  useLayoutEffect(() => {
    if (completed.current) return;
    if (dirty) routeDrafts.set(draftKey,{draft,updatedAt:original.current,original:baseline.current,createId:createId.current});
    else routeDrafts.delete(draftKey);
  }, [draftKey, draft, dirty]);
  const currentDrivers = masters.drivers.filter(row => !draft.company || row.company_id === draft.company), currentVehicles = masters.vehicles.filter(row => !draft.company || row.company_id === draft.company);
  return <Modal dismissable={!saving} width="lg" label={route ? '코스 편집' : '새 코스'} onClose={() => { if (!submitting.current) close(); }}><div className="p-5"><div className="flex items-center justify-between mb-3"><h2 className="app-function-title text-base font-semibold">{route ? '코스 편집' : '새 코스'}</h2><ModalClose data-x className="btn btn-ghost text-xs">닫기</ModalClose></div>
    <WorkspaceDraftStatus storageKeys={[routeDrafts.storageKey(draftKey)]} dirty={dirty} />
    <EditorStatus dirty={dirty} saving={saving} editable={editable} existing={Boolean(route)} error={saveError} />
    <CatalogSaveReview<Route> table="routes" id={route?.id ?? ''} error={saveError} busy={saving} patch={patch} labels={{name:'코스명',car_number:'호차',company_id:'운수사',primary_driver_id:'주기사',secondary_driver_id:'보조기사',primary_vehicle_id:'주차량',secondary_vehicle_id:'보조차량',active:'활성',closed_days:'휴무일'}} onRebase={latest => {
      const before = toDraft(baseline.current), next = toDraft(latest);
      setDraft(current => Object.fromEntries(Object.keys(next).map(key => [key, catalogValueEqual(current[key as keyof typeof current], before[key as keyof typeof before]) ? next[key as keyof typeof next] : current[key as keyof typeof current]])) as typeof current);
      baseline.current = latest; original.current = latest.updated_at; setSaveError('');
    }}/>
    <fieldset disabled={saving || !editable}><form id="route-form" className="space-y-3" noValidate onSubmit={async event => {
      event.preventDefault(); if (!editable || submitting.current) return;
      const name = draft.name.trim(); if (!name) { toast('코스명은 필수입니다.', 'warn'); return; }
      const payload = route ? { id: route.id, ...patch } : { center_code: center.code, ...patch };
      submitting.current = true; setSaving(true); setSaveError('');
      try { const { error } = await saveRoute(payload, original.current,createId.current); if (error) { setSaveError(error.message); toast(`저장 실패: ${error.message}`, 'error'); return; } toast(route ? '수정되었습니다.' : '추가되었습니다.', 'success'); completed.current = true; routeDrafts.delete(draftKey); close(); await saved().catch(() => toast('저장은 완료됐지만 목록을 갱신하지 못했습니다.', 'warn')); }
      catch { setSaveError('저장 결과를 확인하지 못했습니다. 입력을 보존했습니다. 같은 내용으로 재시도할 수 있습니다.'); toast('저장 중 오류가 발생했습니다.', 'error'); }
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
      <div className="flex items-center gap-2 pt-2 border-t border-zinc-700"><button type="submit" className="btn btn-primary" disabled={!editable}>저장</button><ModalClose data-x className="btn btn-ghost" onAction={() => { completed.current = true; routeDrafts.delete(draftKey); }}>취소</ModalClose></div>
    </form></fieldset>
  </div></Modal>;
}
