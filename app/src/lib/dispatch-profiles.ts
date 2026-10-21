import { supabase } from './supabase';
import { normalizeProfile } from '../domain/dispatch-profiles';
import type {
  ProfileEntry,
  ProfileDestination,
} from '../domain/dispatch-profiles';
const fields = [
  'otd',
  'mode',
  'unloadMinutes',
  'inspectionMinutes',
  'marginMinutes',
  'notes',
];
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
