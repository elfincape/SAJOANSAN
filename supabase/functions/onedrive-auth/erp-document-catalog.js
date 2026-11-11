// The upload journal keeps a numeric concurrency token. In legacy mode it is
// updated_at in microseconds (not an ERP revision); pending ERP intents must be
// drained before switching the writer. Preserve PostgreSQL's full precision.
export function legacyDocumentRevision(value) {
  const milliseconds = Date.parse(value);
  const fraction = String(value).match(/\.(\d+)(?:Z|[+-]\d\d(?::?\d\d)?)$/)?.[1] || '';
  const revision = milliseconds * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6));
  if (!Number.isSafeInteger(revision) || revision < 1000000000000000)
    throw Error('Invalid document concurrency timestamp');
  return revision;
}

export function makeLegacyDocumentCatalog(db, fail) {
  const tables = { driver: 'drivers', company: 'companies', route: 'routes', vehicle: 'vehicles' };
  function table(kind) {
    if (!Object.hasOwn(tables, kind)) throw fail('지원하지 않는 원본입니다.', 400);
    return tables[kind];
  }
  async function subject(user, kind, id) {
    if (!/^[0-9a-f-]{36}$/i.test(id || '')) throw fail('원본을 선택해 주세요.', 400);
    const [row] = await db(table(kind) + '?select=*&id=eq.' + encodeURIComponent(id), { token: user.token });
    if (!row || row.deleted_at) throw fail('해당 원본에 접근할 수 없습니다.', 403);
    return { ...row, revision: legacyDocumentRevision(row.updated_at) };
  }
  async function list(user, kind, center) {
    const result = [];
    let after;
    for (;;) {
      const rows = await db(table(kind) + '?select=*&deleted_at=is.null&order=id&limit=500'
        + '&center_code=eq.' + encodeURIComponent(center)
        + (after ? '&id=gt.' + encodeURIComponent(after) : ''), { token: user.token });
      result.push(...rows);
      if (rows.length < 500) return result;
      const next = rows.at(-1).id;
      if (next === after) throw fail('원장 조회가 반복되었습니다.', 502);
      after = next;
    }
  }
  async function saveHealth(user, journal) {
    const latest = await subject(user, 'driver', journal.subject_driver_id);
    const conflict = () => ({ state: 'conflict', currentRevision: latest.revision,
      currentExpiry: latest.health_certificate_expires_on });
    if (latest.revision !== journal.expiry_expected_revision) return conflict();
    const saved = await db('drivers?id=eq.' + encodeURIComponent(latest.id)
      + '&updated_at=eq.' + encodeURIComponent(latest.updated_at) + '&deleted_at=is.null', {
      token: user.token, method: 'PATCH', prefer: 'return=representation',
      body: { health_certificate_expires_on: journal.document_expiry },
    });
    if (saved?.length === 1) return { state: 'saved' };
    const current = await subject(user, 'driver', latest.id);
    return { state: 'conflict', currentRevision: current.revision,
      currentExpiry: current.health_certificate_expires_on };
  }
  return { subject, list, saveHealth };
}

export function makeDocumentCatalog(origin, fetcher, fail) {
  if (!origin) return null;
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password) throw Error('Invalid ERP document endpoint');
  const centers = {
    '390ae870-1a16-fd3e-0864-b588debc435a': '001',
    'b14b130d-eb5c-17aa-5c6a-33e1233aa48b': '002',
  };
  async function request(user, suffix, options = {}) {
    return fetcher(new URL('/api/course-catalog' + suffix, base), {
      ...options,
      headers: { Authorization: 'Bearer ' + user.token, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  }
  async function query(user, parameters) {
    const response = await request(user, '?' + new URLSearchParams(parameters));
    if (!response.ok) throw fail('ERP 원장 조회에 실패했습니다.', [401,403,404].includes(response.status) ? 403 : 502);
    return response.json();
  }
  async function subject(user, kind, id) {
    const row = await query(user, { kind, id });
    if (row.id !== id || row.kind !== kind || row.deletedAt) throw fail('ERP 원장에 접근할 수 없습니다.', 403);
    const codes = (row.attributes?.center || []).map(value => centers[value]).filter(Boolean);
    if (codes.length !== 1) throw fail('서류에 사용할 원장의 센터 속성을 확인해 주세요.', 409);
    return { ...row.fields, id: row.id, revision: row.revision, center_code: codes[0] };
  }
  async function list(user, kind, center) {
    const result = [];
    const attributes = Object.entries(centers);
    const value = attributes.find(([, code]) => code === center)?.[0];
    if (!value) throw fail('ERP 센터 속성을 확인해 주세요.', 409);
    let after;
    do {
      const page = await query(user, { kind, center: value, ...(after ? { after } : {}) });
      result.push(...page.items.map(row => ({ ...row.fields, id: row.id })));
      if (after && page.nextAfter === after) throw fail('ERP 원장 조회가 반복되었습니다.', 502);
      after = page.nextAfter;
    } while (after);
    return result;
  }
  async function saveHealth(user, journal) {
    // The same uploaded document and revision always produce the same ERP command.
    const seed = new TextEncoder().encode('onedrive-health:' + journal.request_id + ':' + journal.expiry_expected_revision);
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', seed));
    const hex = Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
    const command = [hex.slice(0,8),hex.slice(8,12),'4'+hex.slice(13,16),'8'+hex.slice(17,20),hex.slice(20,32)].join('-');
    const response = await request(user, '/driver-health-expiry', {
      method: 'POST',
      body: JSON.stringify({ commandId: command, idempotencyKey: command, changes: [{
        operation: 'patch', targetId: journal.subject_driver_id, expectedRevision: journal.expiry_expected_revision,
        fields: { kind: 'driver', health_certificate_expires_on: journal.document_expiry },
      }] }),
    });
    if (response.ok) return { state: 'saved' };
    const error = await response.json().catch(() => ({}));
    if (response.status === 409 && error.code === 'REVISION_CONFLICT') {
      const latest = await subject(user, 'driver', journal.subject_driver_id);
      return { state: 'conflict', currentRevision: latest.revision, currentExpiry: latest.health_certificate_expires_on };
    }
    return { state: 'pending' };
  }
  return { subject, list, saveHealth };
}
