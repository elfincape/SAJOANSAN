import { createOneDriveStorage } from './storage.js';
const enc = encodeURIComponent,
  MAX = 10 * 1024 * 1024;
const uuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s || '',
  );
const hex = (s) => /^[a-f0-9]{64}$/.test(s || '');
const escape = (s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function safeMailHtml(source) {
  const tags = new Set(
    'p br div span strong b em i u s blockquote pre code ul ol li table thead tbody tr th td hr h1 h2 h3 h4'.split(
      ' ',
    ),
  );
  // Reconstruct only tag names; no original attributes, URLs, styles or active elements survive.
  const stripped = source.replace(
    /<(script|style|iframe|object|template|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    '',
  );
  const body = (stripped.match(/<[^>]*>|[^<]+|</g) || [])
    .map((token) => {
      const tag = token.match(/^<(\/?)([a-z0-9]+)(?:\s[^>]*)?\/?\s*>$/i);
      return tag && tags.has(tag[2].toLowerCase())
        ? '<' + tag[1] + tag[2].toLowerCase() + '>'
        : token.startsWith('<')
          ? ''
          : escape(token);
    })
    .join('');
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; style-src &apos;none&apos;; base-uri &apos;none&apos;; form-action &apos;none&apos;"></head><body>' +
    body +
    '</body></html>'
  );
}
export function mailFilename(value) {
  const name =
    String(value || 'attachment')
      .split(/[\\/]/)
      .at(-1)
      .normalize('NFC')
      .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
      .replace(/^[. ]+|[. ]+$/g, '')
      .slice(0, 120) || 'attachment';
  return /\.(pdf|txt|csv|xlsx|docx|pptx|jpg|jpeg|png|webp|zip|eml)$/i.test(name)
    ? name
    : name + '.download';
}
async function readBody(req, fail) {
  const reader = req.body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 30 * 1024 * 1024) {
      await reader.cancel();
      throw fail('메일 크기 제한을 초과했습니다.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes) || '{}');
}
async function sha(bytes) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('');
}

export async function handlePrivateMail(action, req, user, ctx) {
  const {
    db,
    graph,
    connected,
    settings,
    withLock,
    json,
    fail,
    hash,
    fetcher,
  } = ctx;
  const { environment, verify } = createOneDriveStorage({
    settings,
    connected,
    graph,
    fetcher,
    hash,
    fail,
  });
  async function renew(holder) {
    const now = new Date().toISOString();
    const rows = await db(
      'onedrive_locks?name=eq.connection&holder=eq.' +
        holder +
        '&expires_at=gt.' +
        enc(now),
      {
        method: 'PATCH',
        body: { expires_at: new Date(Date.now() + 180000).toISOString() },
        prefer: 'return=representation',
      },
    );
    if (!rows?.length) throw fail('OneDrive 연결 잠금이 만료되었습니다.', 409);
  }
  async function privateDestination(box, env) {
    if (env.driveId.toLowerCase() !== box.drive_id.toLowerCase())
      throw fail('OneDrive 계정이 메일 보관 계정과 다릅니다.', 409);
    const drive = await (
      await graph('/me/drive?$select=id,owner', env.access)
    ).json();
    const owner = drive.owner?.user?.id;
    if (!owner) throw fail('메일 보관 계정 소유자를 확인할 수 없습니다.', 409);
    const permissions = await (
      await graph(
        '/drives/' +
          enc(box.drive_id) +
          '/items/' +
          enc(box.folder_id) +
          '/permissions',
        env.access,
      )
    ).json();
    if (
      !Array.isArray(permissions.value) ||
      permissions['@odata.nextLink'] ||
      permissions.value.some((p) => {
        const identities = [
          p.grantedToV2,
          p.grantedTo,
          ...(p.grantedToIdentitiesV2 || []),
          ...(p.grantedToIdentities || []),
        ].filter(Boolean);
        return (
          p.link ||
          p.invitation ||
          !identities.length ||
          identities.some((identity) => identity.user?.id !== owner)
        );
      })
    )
      throw fail(
        '메일 폴더에 공유 권한이 있습니다. 본인 전용 비공개 폴더를 선택해 주세요.',
        409,
      );
  }
  const length = Number(req.headers.get('content-length') || 0);
  if (length > 30 * 1024 * 1024)
    throw fail('메일 크기 제한을 초과했습니다.', 413);
  const body = await readBody(req, fail);
  const mailbox = async (id, token) => {
    if (!uuid(id)) throw fail('메일함 식별자가 필요합니다.');
    const box = (
      await db('private_mailboxes?select=*&id=eq.' + id, token ? { token } : {})
    )[0];
    if (!box || (user.id && box.owner_id !== user.id))
      throw fail('메일함에 접근할 수 없습니다.', 403);
    return box;
  };
  if (action === 'private-mail-sync') {
    const box = await mailbox(body.mailbox);
    if (body.operation === 'begin') {
      if (!box.enabled) throw fail('수집이 활성화되지 않았습니다.', 409);
      const lease = crypto.randomUUID();
      const rows = await db('rpc/private_mail_begin', {
        method: 'POST',
        body: { p_id: box.id, p_lease: lease },
      });
      if (!rows.length) throw fail('이미 수집 중입니다.', 409);
      return json({
        lease,
        cutoff: rows[0].cutoff_at,
        cursor: rows[0].scan_cursor,
      });
    }
    if (
      !box.enabled ||
      !uuid(body.lease) ||
      body.lease !== box.lease ||
      Date.parse(box.lease_until) <= Date.now()
    )
      throw fail('수집 잠금이 만료되었습니다.', 409);
    if (body.operation === 'end') {
      if (body.cursor != null && !hex(body.cursor))
        throw fail('수집 위치가 올바르지 않습니다.');
      const counts = {};
      for (const key of [
        'saved',
        'skipped',
        'undated',
        'oversized',
        'deferred',
      ]) {
        const n = body.counts?.[key] ?? 0;
        if (!Number.isInteger(n) || n < 0 || n > 100000)
          throw fail('수집 집계가 올바르지 않습니다.');
        counts[key] = n;
      }
      await db(
        'private_mailboxes?id=eq.' + box.id + '&lease=eq.' + body.lease,
        {
          method: 'PATCH',
          body: {
            lease: null,
            lease_until: null,
            status: body.error ? 'error' : 'ready',
            last_error: body.error ? 'SYNC_FAILED' : null,
            last_counts: counts,
            scan_cursor: body.cursor ?? null,
            ...(!body.error
              ? { last_success_at: new Date().toISOString() }
              : {}),
          },
        },
      );
      return json({ ok: true });
    }
    const m = body.message;
    const uidl = body.operation === 'seen' ? body.uidl : m?.uidl;
    if (!hex(uidl)) throw fail('UIDL 해시가 올바르지 않습니다.');
    const existing = (
      await db(
        'private_mail_messages?select=id&mailbox_id=eq.' +
          box.id +
          '&uidl_hash=eq.' +
          uidl,
      )
    )[0];
    if (body.operation === 'seen') return json({ seen: !!existing });
    if (body.operation !== 'ingest')
      throw fail('지원하지 않는 수집 작업입니다.');
    if (existing) return json({ id: existing.id, duplicate: true });
    if (
      !hex(m.hash) ||
      typeof m.subject !== 'string' ||
      m.subject.length > 500 ||
      typeof m.sender !== 'string' ||
      m.sender.length > 500 ||
      !Number.isFinite(Date.parse(m.sent)) ||
      Date.parse(m.sent) < Date.parse(box.cutoff_at) ||
      !Array.isArray(m.files) ||
      !m.files.length ||
      m.files.length > 50
    )
      throw fail('메일 형식이 올바르지 않습니다.');
    let total = 0;
    const files = [];
    for (const [index, file] of m.files.entries()) {
      if (
        !['eml', 'text', 'html', 'attachment'].includes(file.kind) ||
        typeof file.data !== 'string' ||
        file.data.length > Math.ceil((MAX * 4) / 3) + 4
      )
        throw fail('메일 파일 제한을 초과했습니다.', 413);
      const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
      total += bytes.length;
      if (bytes.length > MAX || total > 2 * MAX)
        throw fail('메일 파일 제한을 초과했습니다.', 413);
      const contentHash = await hash(bytes);
      files.push({
        bytes,
        kind: file.kind,
        original_name: mailFilename(file.name),
        file_name: uidl + '_' + m.hash + '_' + index + '.bin',
        byte_size: bytes.length,
        content_hash: contentHash,
      });
    }
    if (
      files.filter((f) => f.kind === 'eml').length !== 1 ||
      (await sha(files.find((f) => f.kind === 'eml').bytes)) !== m.hash
    )
      throw fail('원본 메일 검증에 실패했습니다.');
    return withLock(async (holder) => {
      const env = await environment();
      await privateDestination(box, env);
      const parent = await (
        await graph(
          '/drives/' +
            enc(box.drive_id) +
            '/items/' +
            enc(box.folder_id) +
            '?$select=id,folder,parentReference',
          env.access,
        )
      ).json();
      if (!parent.folder || parent.id !== box.folder_id)
        throw fail('메일 보관 폴더를 확인해 주세요.', 409);
      const manifest = [];
      for (const file of files) {
        await renew(holder);
        const path =
          '/drives/' +
          enc(box.drive_id) +
          '/items/' +
          enc(box.folder_id) +
          ':/' +
          enc(file.file_name);
        const old = await graph(path, env.access, { allowMissing: true });
        // Names include both UIDL and content hashes. Retrying never replaces a changed file.
        const item = old
          ? await old.json()
          : await (
              await graph(
                path + ':/content?@microsoft.graph.conflictBehavior=fail',
                env.access,
                {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/octet-stream' },
                  body: file.bytes,
                },
              )
            ).json();
        await verify(
          { ...file, drive_id: box.drive_id, folder_id: box.folder_id },
          item,
          env.access,
        );
        const { bytes, ...ref } = file;
        manifest.push({ ...ref, item_id: item.id });
      }
      await renew(holder);
      const id = await db('rpc/private_mail_publish', {
        method: 'POST',
        body: {
          p_id: box.id,
          p_lease: body.lease,
          p_uidl: uidl,
          p_hash: m.hash,
          p_subject: m.subject,
          p_sender: m.sender,
          p_sent: m.sent,
          p_files: manifest,
        },
      });
      return json({ id });
    });
  }
  if (action === 'private-mail-status') {
    const boxes = await db(
      'private_mailboxes?select=id,account,enabled,status,last_started_at,last_success_at,last_error,last_counts,lease_until,initial_days',
      { token: user.token },
    );
    return json({ mailboxes: boxes });
  }
  if (action === 'private-mail-list') {
    const query = String(body.query || '')
      .trim()
      .slice(0, 100)
      .replace(/[%_\\]/g, '\\$&');
    const offset = Number(body.offset || 0);
    const pattern = '"*' + query.replace(/[\\"]/g, '\\$&') + '*"';
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      throw fail('조회 범위가 올바르지 않습니다.');
    const rows = await db(
      'private_mail_messages?select=id,subject,sender,sent_at&order=sent_at.desc,id.desc&limit=51&offset=' +
        offset +
        (query
          ? '&or=' +
            enc('(subject.ilike.' + pattern + ',sender.ilike.' + pattern + ')')
          : ''),
      { token: user.token },
    );
    return json({ messages: rows.slice(0, 50), more: rows.length > 50 });
  }
  if (!uuid(body.id)) throw fail('메일을 선택해 주세요.');
  const row = (
    await db('private_mail_messages?select=*&id=eq.' + body.id, {
      token: user.token,
    })
  )[0];
  if (!row || row.owner_id !== user.id)
    throw fail('메일에 접근할 수 없습니다.', 403);
  if (action === 'private-mail-detail')
    return json({
      message: {
        id: row.id,
        subject: row.subject,
        sender: row.sender,
        sent_at: row.sent_at,
        files: row.files.map((f, index) => ({
          index,
          kind: f.kind,
          name: f.original_name,
          size: f.byte_size,
        })),
      },
    });
  if (action !== 'private-mail-download' || !Number.isInteger(body.index))
    throw fail('메일 파일을 선택해 주세요.');
  const file = row.files[body.index];
  if (!file) throw fail('메일 파일이 없습니다.', 404);
  const box = await mailbox(row.mailbox_id, user.token);
  return withLock(async () => {
    const env = await environment();
    await privateDestination(box, env);
    const item = await (
      await graph(
        '/drives/' + enc(box.drive_id) + '/items/' + enc(file.item_id),
        env.access,
      )
    ).json();
    const bytes = await verify(
      { ...file, drive_id: box.drive_id, folder_id: box.folder_id },
      item,
      env.access,
    );
    // Recheck RLS immediately before returning bytes, including active-profile revocation.
    if (
      !(
        await db('private_mail_messages?select=id&id=eq.' + row.id, {
          token: user.token,
        })
      ).length
    )
      throw fail('메일 접근 권한이 만료되었습니다.', 403);
    const headers = new Headers(json({}).headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; sandbox; base-uri 'none'; form-action 'none'",
    );
    if (file.kind === 'html') {
      headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(safeMailHtml(new TextDecoder().decode(bytes)), {
        headers,
      });
    }
    headers.set(
      'Content-Type',
      file.kind === 'text'
        ? 'text/plain; charset=utf-8'
        : 'application/octet-stream',
    );
    headers.set(
      'Content-Disposition',
      "attachment; filename*=UTF-8''" + enc(mailFilename(file.original_name)),
    );
    return new Response(bytes, { headers });
  });
}
