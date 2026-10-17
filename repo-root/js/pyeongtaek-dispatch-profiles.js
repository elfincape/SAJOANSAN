// Workbook parsing remains shared with the daily-volume importer.
export { readWorkbook } from './pyeongtaek-dispatch-data.js';

export const PROFILE_FIELDS = Object.freeze({
  code: '\uCC29\uC9C0\uCF54\uB4DC', name: '\uCC29\uC9C0\uBA85', address: '\uC8FC\uC18C',
  otd: 'OTD', mode: '\uB0A9\uD488\uBC29\uC2DD', unloadMinutes: '\uD558\uCC28\uC2DC\uAC04(\uBD84)',
  inspectionMinutes: '\uAC80\uC218\uC2DC\uAC04(\uBD84)', marginMinutes: '\uC5EC\uC720\uC2DC\uAC04(\uBD84)', notes: '\uBE44\uACE0',
});
const BASE = Object.freeze({ otd: '', mode: 'unknown', unloadMinutes: null, inspectionMinutes: null, marginMinutes: null, notes: '' });
const fields = Object.keys(BASE);
const text = value => value == null ? '' : String(value).trim();
const key = value => text(value).normalize('NFKC').toLowerCase().replace(/[\s_()[\]-]/g, '');
const matchKey = value => text(value).normalize('NFKC').replace(/\s+/g, ' ');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const issue = (field, code, message) => ({ field, code, message, severity: 'error' });
const aliases = {
  code: ['code', '\uCF54\uB4DC', '\uB0A9\uD488\uCC98\uCF54\uB4DC', '\uBC30\uC1A1\uCC98\uCF54\uB4DC'],
  name: ['name', '\uCC29\uC9C0', '\uB0A9\uD488\uCC98', '\uB0A9\uD488\uCC98\uBA85', '\uBC30\uC1A1\uCC98', '\uBC30\uC1A1\uCC98\uBA85'],
  address: ['address', '\uCC29\uC9C0\uC8FC\uC18C', '\uBC30\uC1A1\uC9C0\uC8FC\uC18C'],
  otd: ['otd', '\uB0A9\uD488\uB9C8\uAC10', '\uB9C8\uAC10\uC2DC\uAC04', '\uB3C4\uCC29\uC870\uAC74'],
  mode: ['mode', '\uBC30\uC1A1\uBC29\uC2DD', '\uB0A9\uD488\uBC29\uBC95', '\uC720\uBB34\uC778'],
  unloadMinutes: ['unloadMinutes', '\uD558\uCC28\uC2DC\uAC04', '\uD558\uCC28\uBD84'],
  inspectionMinutes: ['inspectionMinutes', '\uAC80\uC218\uC2DC\uAC04', '\uAC80\uC218\uBD84'],
  marginMinutes: ['marginMinutes', '\uC5EC\uC720\uC2DC\uAC04', '\uC5EC\uC720\uBD84'],
  notes: ['notes', '\uBA54\uBAA8', '\uD2B9\uC774\uC0AC\uD56D'],
};
const modes = new Map([
  ...['unmanned', '\uBB34\uC778', '\uBB34\uC778\uB0A9', '\uBB34\uC778\uBC30\uC1A1'].map(v => [v, 'unmanned']),
  ...['attended', '\uC720\uC778', '\uC720\uC778\uB0A9', '\uB300\uBA74', '\uB300\uBA74\uB0A9', '\uAC80\uC218', '\uAC80\uC218\uB0A9'].map(v => [v, 'attended']),
  ['yard', 'yard'], ['\uC57C\uC801', 'yard'], ['unknown', 'unknown'], ['\uBBF8\uD655\uC778', 'unknown'], ['', 'unknown'],
]);
const explicitInspection = value => ['\uAC80\uC218', '\uAC80\uC218\uB0A9'].includes(key(value));

export function normalizeProfile(input = {}) {
  const profile = { ...BASE }, issues = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { profile, issues: [issue('profile', 'INVALID_PROFILE', '착지 조건 형식을 확인해 주세요.')] };
  for (const field of ['otd', 'notes']) {
    if (input[field] != null && typeof input[field] !== 'string') issues.push(issue(field, 'INVALID_TEXT', '문자 형식으로 입력해 주세요.'));
    else profile[field] = text(input[field]);
    if (profile[field].length > (field === 'otd' ? 500 : 4000)) issues.push(issue(field, 'TEXT_TOO_LONG', `${PROFILE_FIELDS[field]}은 ${field === 'otd' ? 500 : 4000}자까지 입력할 수 있습니다.`));
  }
  const mode = typeof input.mode === 'string' || input.mode == null ? modes.get(key(input.mode)) : undefined;
  if (mode === undefined) issues.push(issue('mode', 'INVALID_MODE', '납품방식은 무인, 유인, 야적, 미확인 중 하나로 입력해 주세요.'));
  else profile.mode = mode;
  for (const field of ['unloadMinutes', 'inspectionMinutes', 'marginMinutes']) {
    const value = input[field];
    if (value == null || (typeof value === 'string' && !value.trim())) continue;
    if (!['string', 'number'].includes(typeof value) || !/^\d+(?:\.\d+)?$/.test(text(value)) || !Number.isFinite(Number(value)) || Number(value) > 1440) {
      issues.push(issue(field, 'INVALID_MINUTES', '시간은 0~1440분 사이의 숫자로 입력하거나 비워 주세요.'));
    } else profile[field] = Number(value);
  }
  if (explicitInspection(input.mode) && !Object.hasOwn(input, 'inspectionMinutes')) profile.inspectionMinutes = 30;
  return { profile, issues };
}

export function suggestProfileMapping(rows) {
  let best = { headerRow: -1, ...Object.fromEntries(Object.keys(PROFILE_FIELDS).map(field => [field, -1])) }, score = 0;
  rows.slice(0, 50).forEach((row, headerRow) => {
    const keys = row.map(key), mapping = { headerRow };
    for (const [field, names] of Object.entries(aliases)) {
      const accepted = [field, PROFILE_FIELDS[field], ...names].map(key);
      const matches = keys.flatMap((value, index) => value && accepted.includes(value) ? [index] : []);
      mapping[field] = matches.length === 1 ? matches[0] : -1;
    }
    const found = Object.keys(PROFILE_FIELDS).filter(field => mapping[field] >= 0).length;
    if (found > score) { best = mapping; score = found; }
  });
  return best;
}

function importedOTD(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value >= 1) return value;
    const minutes = Math.min(1439, Math.round(value * 1440));
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const time = text(value).match(/^1899-12-(?:30|31)T(\d{2}:\d{2}):\d{2}(?:\.\d+)?Z$/);
  return time ? time[1] : value;
}

// Manual selection must rebase the patch, not copy a preview built for another target.
export function selectProfileTarget(entry, destination) {
  if (destination != null && (!destination.id || (destination.center_code != null && destination.center_code !== '002'))) throw new Error('평택센터 착지를 선택해 주세요.');
  const result = normalizeProfile({ ...(destination?.dispatch_profile || BASE), ...entry.patch });
  return { ...entry, targetId: destination?.id ?? null, revision: destination?.dispatch_profile?.revision ?? 0, profile: result.profile,
    issues: [...entry.issues.filter(value => !['MATCH_REQUIRED', 'NOT_FOUND', 'AMBIGUOUS_MATCH', 'ADDRESS_MISMATCH', 'DUPLICATE_TARGET', 'INVALID_PROFILE', 'INVALID_TEXT', 'TEXT_TOO_LONG', 'INVALID_MODE', 'INVALID_MINUTES'].includes(value.code)), ...result.issues,
      ...(!destination ? [issue('targetId', 'MATCH_REQUIRED', '저장할 기존 착지를 선택해 주세요.')] : [])] };
}

export function previewProfiles(rows, mapping, destinations, { fileName = '', sheetName = '' } = {}) {
  if (!Array.isArray(rows) || rows.length > 20000 || !mapping || !Number.isInteger(mapping.headerRow) || mapping.headerRow < -1 || mapping.headerRow >= rows.length) throw new Error('제목 행과 20,000행 한도를 확인해 주세요.');
  for (const field of Object.keys(PROFILE_FIELDS)) if (mapping[field] != null && (!Number.isInteger(mapping[field]) || mapping[field] < -1)) throw new Error('열 매핑을 확인해 주세요.');
  if (!fields.some(field => mapping[field] >= 0)) throw new Error('OTD, 납품방식 등 착지 조건 열을 하나 이상 연결해 주세요.');
  const columns = Object.keys(PROFILE_FIELDS).map(field => mapping[field]).filter(column => column >= 0);
  if (new Set(columns).size !== columns.length) throw new Error('하나의 원본 열을 여러 항목에 중복 연결할 수 없습니다.');
  const records = destinations.filter(d => d.center_code == null || d.center_code === '002');
  const entries = [];
  rows.forEach((row, index) => {
    if (index <= mapping.headerRow || !row.some(value => text(value))) return;
    const get = field => mapping[field] >= 0 ? row[mapping[field]] : undefined;
    const patch = Object.fromEntries(fields.filter(field => mapping[field] >= 0).map(field => [field, field === 'otd' ? importedOTD(get(field)) : get(field) ?? null]));
    if (explicitInspection(patch.mode) && !(mapping.inspectionMinutes >= 0)) patch.inspectionMinutes = 30;
    const entry = { sourceRow: index + 1, code: text(get('code')), name: text(get('name')), address: text(get('address')),
      targetId: null, revision: 0, profile: null, issues: [], candidates: [], patch, fileName, sheetName };
    let candidates = [];
    if (entry.code) candidates = records.filter(d => text(d.code) === entry.code);
    else if (entry.address && entry.name) candidates = records.filter(d => matchKey(d.address) === matchKey(entry.address) && matchKey(d.name) === matchKey(entry.name));
    else entry.issues.push(issue('targetId', 'MATCH_REQUIRED', '착지코드 또는 주소와 착지명이 모두 필요합니다.'));
    entry.candidates = candidates;
    if (candidates.length === 1) {
      if (entry.address && matchKey(candidates[0].address) !== matchKey(entry.address)) entry.issues.push(issue('address', 'ADDRESS_MISMATCH', '코드는 같지만 주소가 다릅니다. 저장할 착지를 직접 확인해 주세요.'));
      else Object.assign(entry, selectProfileTarget(entry, candidates[0]));
    } else if (candidates.length > 1) entry.issues.push(issue('targetId', 'AMBIGUOUS_MATCH', '일치하는 착지가 여러 개입니다. 저장할 착지를 직접 선택해 주세요.'));
    else if (!entry.issues.length) entry.issues.push(issue('targetId', 'NOT_FOUND', '일치하는 기존 착지를 찾지 못했습니다.'));
    if (!entry.profile) {
      const result = normalizeProfile(patch);
      entry.profile = result.profile;
      entry.issues.push(...result.issues);
    }
    entries.push(entry);
  });
  const counts = new Map();
  for (const entry of entries) if (entry.targetId) counts.set(entry.targetId, (counts.get(entry.targetId) || 0) + 1);
  for (const entry of entries) if (counts.get(entry.targetId) > 1) entry.issues.push(issue('targetId', 'DUPLICATE_TARGET', '여러 원본 행이 같은 착지를 가리킵니다. 중복을 확인해 주세요.'));
  return { entries, issues: entries.flatMap(entry => entry.issues.map(value => ({ ...value, row: entry.sourceRow, sourceRow: entry.sourceRow }))) };
}

export async function saveProfiles(supabase, entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 1000) throw new Error('착지 조건은 한 번에 1~1,000건까지 저장할 수 있습니다.');
  const ids = new Set();
  const payload = entries.map(entry => {
    const id = entry.targetId ?? entry.id;
    const result = normalizeProfile(entry.profile);
    if (!uuid(id) || ids.has(id.toLowerCase()) || !Number.isInteger(entry.revision) || entry.revision < 0 || entry.revision > 2147483646 || entry.issues?.length || result.issues.length || !fields.every(field => Object.hasOwn(entry.profile || {}, field))) throw new Error('착지 연결, 중복, 입력값과 버전을 확인한 뒤 저장해 주세요.');
    ids.add(id.toLowerCase());
    return { id, revision: entry.revision, profile: result.profile };
  });
  const { data, error } = await supabase.rpc('save_pyeongtaek_dispatch_profiles', { p_entries: payload });
  if (error) throw Object.assign(new Error(error.code === 'PT409' ? '착지 조건이 변경되었거나 접근할 수 없습니다. 다시 조회한 뒤 저장해 주세요.' : '착지 조건을 저장하지 못했습니다. 권한과 입력값을 확인해 주세요.'), { code: error.code, cause: error });
  const expected = new Map(payload.map(entry => [entry.id.toLowerCase(), entry.revision + 1]));
  if (!Array.isArray(data) || data.length !== payload.length || data.some(record => {
    const id = text(record.id).toLowerCase(), revision = expected.get(id);
    expected.delete(id);
    return revision == null || record.dispatch_profile?.revision !== revision || normalizeProfile(record.dispatch_profile).issues.length || !fields.every(field => Object.hasOwn(record.dispatch_profile || {}, field)) || !Number.isFinite(Date.parse(record.dispatch_profile?.updatedAt));
  })) throw new Error('저장 응답이 올바르지 않습니다. 재시도 전에 DB를 다시 조회해 주세요.');
  return data;
}
