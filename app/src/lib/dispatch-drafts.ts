import { supabase } from './supabase';
import { readDispatchRows } from './dispatch-context';
import type {
  DispatchDriver,
  DispatchAddress,
  DispatchLeg,
} from './dispatch-context';
import type { VolumeRow } from '../domain/dispatch-import';
import type {
  DispatchDraft,
  DispatchSettings,
} from '../domain/dispatch-manual';
export interface ManualPayload {
  version: number;
  center: string;
  date: string;
  rows: VolumeRow[];
  drivers: DispatchDriver[];
  draft: DispatchDraft;
  settings: DispatchSettings;
  context?: { addresses: DispatchAddress[]; legs: DispatchLeg[] };
  history: { at: string; reason: string }[];
  reason: string;
}
export interface ManualSnapshot {
  id: string;
  date: string;
  revision: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  payload?: ManualPayload;
}
interface DraftRecord {
  id: string;
  business_date: string;
  revision: number;
  owner_id: string;
  created_at: string;
  updated_at: string;
  payload?: ManualPayload;
  center_code: string;
}
function checkDate(date: string) {
  const parsed = new Date(date + 'T00:00:00Z');
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(+parsed) &&
    parsed.toISOString().slice(0, 10) === date
  );
}
function fail(error: { code?: string }): never {
  throw Object.assign(
    Error(
      error.code === 'PT409'
        ? '초안이 변경되었거나 접근할 수 없습니다. 다시 조회한 뒤 저장해 주세요.'
        : 'DB 요청을 처리하지 못했습니다. 로그인 상태와 권한, DB 연결을 확인해 주세요.',
    ),
    { code: error.code, cause: error },
  );
}
function snapshot(row: DraftRecord): ManualSnapshot {
  return {
    id: row.id,
    date: row.business_date,
    revision: row.revision,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...('payload' in row ? { payload: row.payload } : {}),
  };
}
export async function listManualDrafts(date: string) {
  if (!date || !checkDate(date))
    throw Error('배차 기준일을 YYYY-MM-DD 형식으로 입력해 주세요.');
  return (
    await readDispatchRows<DraftRecord>(
      'pyeongtaek_dispatch_drafts',
      'id,business_date,revision,owner_id,created_at,updated_at',
      ['id'],
      (query) => query.eq('business_date', date).is('payload->>type', null),
    )
  ).map(snapshot);
}
export async function loadManualDraft(id: string) {
  const { data, error } = await supabase
    .from('pyeongtaek_dispatch_drafts')
    .select('*')
    .eq('center_code', '002')
    .eq('id', id)
    .maybeSingle<DraftRecord>();
  if (error) fail(error);
  return data ? snapshot(data) : null;
}
export async function saveManualDraft({
  id = null,
  date,
  payload,
  revision = 0,
}: {
  id?: string | null;
  date: string;
  payload: ManualPayload;
  revision?: number;
}) {
  if (
    !date ||
    !checkDate(date) ||
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    (!id && revision !== 0)
  )
    throw Error('초안의 기준일, 저장 내용, 버전을 확인해 주세요.');
  const { data, error } = await supabase.rpc('save_pyeongtaek_dispatch_draft', {
    p_id: id,
    p_date: date,
    p_payload: payload,
    p_revision: revision,
  });
  if (error) fail(error);
  if (!data?.id || data.center_code !== '002' || data.revision !== revision + 1)
    throw Error(
      '저장 응답이 올바르지 않습니다. 재시도 전에 DB를 다시 조회해 주세요.',
    );
  return snapshot(data as DraftRecord);
}
