import { supabase } from './supabase';
import { useErpCatalog } from './erp-course-catalog';
import { normalizeProfile } from '../domain/dispatch-profiles';
import type {
  ProfileEntry,
  ProfileDestination,
  DispatchProfile,
} from '../domain/dispatch-profiles';
const fields = [
  'otd',
  'mode',
  'unloadMinutes',
  'inspectionMinutes',
  'marginMinutes',
  'notes',
] as const satisfies readonly (keyof DispatchProfile)[];

async function saveErpProfiles(entries: ProfileEntry[]) {
  const changes = entries.flatMap((entry) => {
    const { erpRevision, originalProfile } = entry;
    if (!Number.isSafeInteger(erpRevision) || erpRevision! < 1 || !originalProfile)
      throw Error('ERP에서 착지 조건을 다시 읽은 후 변경 사항을 확인해 주세요.');
    const patch = Object.fromEntries(fields
      .filter((field) => entry.profile[field] !== originalProfile[field])
      .map((field) => [field, entry.profile[field]]));
    return Object.keys(patch).length ? [{
      operation: 'dispatch_profile',
      targetId: entry.targetId,
      expectedRevision: erpRevision!,
      patch,
    }] : [];
  }).sort((a, b) => a.targetId!.localeCompare(b.targetId!));
  if (!changes.length) return [];

  const encoder = new TextEncoder();
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    encoder.encode(JSON.stringify(['dispatch-profile-v1', changes])))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  const key = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  const body = JSON.stringify({ commandId: key, idempotencyKey: key, changes });
  if (encoder.encode(body).byteLength > 4 * 1024 * 1024)
    throw Error('ERP 한 번 저장 한도는 4MB입니다. 파일을 나누고 각 저장 결과를 확인해 주세요.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw Error('다시 로그인한 뒤 저장해 주세요.');
  const response = await fetch('/api/erp-course-catalog', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
    body,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (result?.code === 'REVISION_CONFLICT') {
      throw Object.assign(Error('ERP 착지 원본이 변경되었습니다.'), { code: 'PT409' });
    }
    throw Error(response.status === 403
      ? 'ERP 착지 조건 저장이 비활성화됐거나 수정 권한이 없습니다. 입력을 유지합니다.'
      : 'ERP 저장 결과를 확인하지 못했습니다. 동일한 내용으로 다시 시도해 주세요.');
  }
  const targets = result?.receipt?.targets;
  const expected = new Map(changes.map((change) => [change.targetId, change.expectedRevision + 1]));
  if (!Array.isArray(targets) || targets.length !== expected.size
    || new Set(targets.map((target) => target.id)).size !== expected.size
    || targets.some((target) => expected.get(target.id) !== target.revision)) {
    throw Error('ERP 저장 영수증을 확인하지 못했습니다. 동일한 내용으로 다시 시도해 주세요.');
  }
  if (targets.some((target) => !target.readable))
    throw Error('ERP 저장은 완료됐습니다. 변경된 접근 권한으로 일부 결과를 읽을 수 없습니다.');
  const records: ProfileDestination[] = result.records;
  if (!Array.isArray(records) || records.length !== expected.size
    || new Set(records.map((record) => record.id)).size !== expected.size
    || records.some((record) => expected.get(record.id) !== record.erp_revision || !record.dispatch_profile)) {
    throw Error('ERP 저장은 완료됐습니다. 결과를 받으려면 동일한 내용으로 다시 시도해 주세요.');
  }
  return records;
}
export async function saveProfiles(entries: ProfileEntry[]) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 1000)
    throw new Error('착지 조건은 한 번에 1~1,000건까지 저장할 수 있습니다.');
  const ids = new Set();
  const payload = entries.map((entry) => {
    const id = entry.targetId;
    const result = normalizeProfile(entry.profile);
    if (
      !(
        typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        )
      ) ||
      ids.has(id!.toLowerCase()) ||
      !Number.isInteger(entry.revision) ||
      entry.revision < 0 ||
      entry.revision > 2147483646 ||
      entry.issues?.length ||
      result.issues.length ||
      !fields.every((field) => Object.hasOwn(entry.profile || {}, field))
    )
      throw new Error(
        '착지 연결, 중복, 입력값과 버전을 확인한 뒤 저장해 주세요.',
      );
    ids.add(id!.toLowerCase());
    return { id, revision: entry.revision, profile: result.profile };
  });
  if (useErpCatalog)
    return saveErpProfiles(entries.map((entry, index) => ({ ...entry, profile: payload[index].profile })));
  const { data: rawData, error } = await supabase.rpc(
    'save_pyeongtaek_dispatch_profiles',
    { p_entries: payload },
  );
  if (error)
    throw Object.assign(
      new Error(
        error.code === 'PT409'
          ? '착지 조건이 변경되었거나 접근할 수 없습니다. 다시 조회한 뒤 저장해 주세요.'
          : '착지 조건을 저장하지 못했습니다. 권한과 입력값을 확인해 주세요.',
      ),
      { code: error.code, cause: error },
    );
  const data = rawData as ProfileDestination[] | null;
  const expected = new Map(
    payload.map((entry) => [entry.id!.toLowerCase(), entry.revision + 1]),
  );
  if (
    !Array.isArray(data) ||
    data.length !== payload.length ||
    data.some((record) => {
      const id = String(record.id ?? '')
          .trim()
          .toLowerCase(),
        revision = expected.get(id);
      expected.delete(id);
      return (
        revision == null ||
        record.dispatch_profile?.revision !== revision ||
        normalizeProfile(record.dispatch_profile).issues.length ||
        !fields.every((field) =>
          Object.hasOwn(record.dispatch_profile || {}, field),
        ) ||
        !Number.isFinite(Date.parse(record.dispatch_profile?.updatedAt ?? ''))
      );
    })
  )
    throw new Error(
      '저장 응답이 올바르지 않습니다. 재시도 전에 DB를 다시 조회해 주세요.',
    );
  return data;
}

export async function dispatchProfilePermissions() {
  const { data, error } = await supabase.rpc('operations_permissions_context');
  if (error) throw error;
  return data as import('./permissions').PermissionContext;
}
