import { createOneDriveStorage } from './storage.js';
import { inspectBriefingTarget } from './private-mail-briefing.js';
import { handleMailAutomation } from './private-mail-background.js';
import { createMailSource } from './private-mail-source.js';
import { handleMailFilter } from './private-mail-filter-actions.js';
import { handleManualMessage } from './private-mail-manual.js';
import { writeMailHistoryDocument } from './private-mail-history.js';
import {
  MAIL_RAW_LIMIT,
  MAIL_DATA_LIMIT,
  MAIL_DERIVED_FILE_LIMIT,
} from './private-mail-limits.js';
import {
  verifyMailStream,
  checkedMailStream,
} from './private-mail-stream-verify.js';
import {
  startCollection,
  advanceCollection,
  validateCollection,
  collectionProgress,
} from './private-mail-collection-state.js';
import {
  APPROVED_MAIL_TARGET,
  createAnonymousDestinationCheck,
  isMailDestinationItem,
  validateMailPermissions,
} from './private-mail-policy.js';
const approvedAnonymousDestination =
  createAnonymousDestinationCheck(APPROVED_MAIL_TARGET);
const enc = encodeURIComponent;
const DIRECT_FILE_BYTES = 3276800;
const fileLimit = (kind) =>
  kind === 'eml' ? MAIL_RAW_LIMIT : MAIL_DERIVED_FILE_LIMIT;
const uuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s || '',
  );
const hex = (s) => /^[a-f0-9]{64}$/.test(s || '');
const storedHash = (value) =>
  btoa(
    String.fromCharCode(
      ...Uint8Array.from(value.match(/../g), (part) => parseInt(part, 16)),
    ),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
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
  if (action === 'private-mail-briefing-status') {
    if (user.id !== APPROVED_MAIL_TARGET.owner_id)
      throw fail('OWNER_REQUIRED', 403);
    return json(
      await withLock(() =>
        inspectBriefingTarget({
          connected: ctx.connectedNotes || connected,
          graph,
        }),
      ),
    );
  }
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
    if (box.id === APPROVED_MAIL_TARGET.mailbox_id) {
      if (!(await approvedAnonymousDestination(user.id, box)))
        throw fail('OWNER_FOLDER_REQUIRED', 409);
      // The user chose the existing authenticated storage behavior for this
      // exact target. Graph authorization and local-item validation still apply.
      const folder = await (
        await graph(
          '/drives/' +
            enc(box.drive_id) +
            '/items/' +
            enc(box.folder_id) +
            '?$select=id,folder,parentReference,remoteItem',
          env.access,
        )
      ).json();
      if (!isMailDestinationItem(box, box.folder_id, folder))
        throw fail('OWNER_FOLDER_REQUIRED', 409);
      return;
    }
    let drive = await (
      await graph('/me/drive?$select=id,owner', env.access)
    ).json();
    if (String(drive.id).toLowerCase() !== box.drive_id.toLowerCase())
      throw fail('OWNER_FOLDER_REQUIRED', 409);
    if (!drive.owner?.user?.id)
      drive = await (await graph('/me/drive', env.access)).json();
    if (String(drive.id).toLowerCase() !== box.drive_id.toLowerCase())
      throw fail('OWNER_FOLDER_REQUIRED', 409);
    const owner = drive.owner?.user?.id;
    // /me/drive identifies the delegated account's default drive. Its owner is
    // optional; an item/ACL check below is still mandatory when it is omitted.
    const folder = await (
      await graph(
        '/drives/' +
          enc(box.drive_id) +
          '/items/' +
          enc(box.folder_id) +
          '?$select=id,folder,parentReference,remoteItem',
        env.access,
      )
    ).json();
    if (
      !folder.folder ||
      folder.id !== box.folder_id ||
      folder.remoteItem ||
      String(folder.parentReference?.driveId).toLowerCase() !==
        box.drive_id.toLowerCase()
    )
      throw fail('OWNER_FOLDER_REQUIRED', 409);
    await privatePermissions(box, box.folder_id, env, owner, folder);
    return owner;
  }
  async function privatePermissions(box, itemId, env, owner, item) {
    if (box.id === APPROVED_MAIL_TARGET.mailbox_id) {
      if (
        !(await approvedAnonymousDestination(user.id, box)) ||
        !isMailDestinationItem(box, itemId, item)
      )
        throw fail('OWNER_FOLDER_REQUIRED', 409);
      return;
    }
    const permissions = await (
      await graph(
        '/drives/' +
          enc(box.drive_id) +
          '/items/' +
          enc(itemId) +
          '/permissions',
        env.access,
      )
    ).json();
    validateMailPermissions(permissions, owner, false, fail);
  }
  async function fenceMailbox(box, lease) {
    const live = (
      await db(
        'private_mailboxes?select=id,owner_id,enabled,lease,lease_until,drive_id,folder_id&id=eq.' +
          box.id,
      )
    )[0];
    if (
      !live ||
      !live.enabled ||
      live.owner_id !== box.owner_id ||
      live.lease !== lease ||
      !Number.isFinite(Date.parse(live.lease_until)) ||
      Date.parse(live.lease_until) <= Date.now() ||
      live.drive_id !== box.drive_id ||
      live.folder_id !== box.folder_id
    )
      throw fail('수집 잠금이 만료되었습니다.', 409);
  }
  async function transferFile(box, file, bytes, holder, env, driveOwner) {
    await renew(holder);
    await fenceMailbox(box, body.lease);
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
    if (
      !parent.folder ||
      parent.id !== box.folder_id ||
      String(parent.parentReference?.driveId).toLowerCase() !==
        box.drive_id.toLowerCase()
    )
      throw fail('DESTINATION_REJECTED', 409);
    const path =
      '/drives/' +
      enc(box.drive_id) +
      '/items/' +
      enc(box.folder_id) +
      ':/' +
      enc(file.file_name);
    const old = await graph(path, env.access, { allowMissing: true });
    if (!old && !bytes) throw fail('FILE_NOT_UPLOADED', 409);
    await fenceMailbox(box, body.lease);
    const item = old
      ? await old.json()
      : await (
          await graph(
            path + ':/content?@microsoft.graph.conflictBehavior=fail',
            env.access,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: bytes,
            },
          )
        ).json();
    await privatePermissions(box, item.id, env, driveOwner, item);
    await verifyStored(box, file, item, env.access);
    return { ...file, item_id: item.id };
  }
  function storedMetadata(box, file, item) {
    const state = {
      hasfile: !!item?.file,
      nameMatches: item?.name === file.file_name,
      folderMatches: item?.parentReference?.id === box.folder_id,
      driveMatches:
        String(item?.parentReference?.driveId).toLowerCase() ===
        box.drive_id.toLowerCase(),
      sizeZero: item?.size === 0,
      sizeMatches: item?.size === file.byte_size,
    };
    if (
      !state.hasfile ||
      !item?.id ||
      !state.nameMatches ||
      !state.sizeMatches ||
      !state.folderMatches ||
      !state.driveMatches
    ) {
      console.warn(
        JSON.stringify({
          event: 'PRIVATE_MAIL_STORED_METADATA_REJECTED',
          ...state,
        }),
      );
      throw fail('FILE_HASH_REJECTED', 409);
    }
  }
  async function verifyStored(box, file, item, access) {
    if (file.byte_size <= DIRECT_FILE_BYTES)
      return verify(
        { ...file, drive_id: box.drive_id, folder_id: box.folder_id },
        item,
        access,
      );
    storedMetadata(box, file, item);
    const response = await graph(
      '/drives/' + enc(box.drive_id) + '/items/' + enc(item.id) + '/content',
      access,
      { timeoutMs: 120000 },
    );
    await verifyMailStream(response, {
      expectedBytes: file.byte_size,
      expectedHash: file.content_hash,
    });
  }
  const length = Number(req.headers.get('content-length') || 0);
  if (length > 30 * 1024 * 1024)
    throw fail('메일 크기 제한을 초과했습니다.', 413);
  const binary =
    ctx.ownerSync &&
    req.headers.get('content-type') === 'application/octet-stream';
  let body;
  if (binary) {
    const metadata = req.headers.get('x-mail-metadata') || '';
    if (metadata.length > 8192) throw fail('METADATA_LIMIT', 413);
    try {
      body = JSON.parse(decodeURIComponent(metadata));
    } catch {
      throw fail('METADATA_INVALID');
    }
    if (body.operation !== 'file') throw fail('BINARY_OPERATION_REJECTED');
  } else body = await readBody(req, fail);
  if (action === 'private-mail-folder') {
    if (body.configure !== undefined && typeof body.configure !== 'boolean')
      throw fail('CONFIGURE_FLAG_REJECTED');
    if (user.id !== '2a828c2d-9a6f-40d4-8e13-336b591811cc')
      throw fail('OWNER_REQUIRED', 403);
    let source;
    try {
      source = new URL(body.url);
    } catch {
      throw fail('FOLDER_URL_REQUIRED');
    }
    if (
      source.protocol !== 'https:' ||
      !['1drv.ms', 'onedrive.live.com'].includes(source.hostname) ||
      source.username ||
      source.password ||
      source.port ||
      source.hash ||
      source.href.length > 2048
    )
      throw fail('FOLDER_URL_REJECTED');
    return withLock(async () => {
      const connection = (
        await db('onedrive_connection?select=connected_by&id=eq.true')
      )[0];
      if (connection?.connected_by !== user.id)
        throw fail('OWNER_CONNECTION_REQUIRED', 409);
      const env = await environment();
      const encoded =
        'u!' +
        btoa(String.fromCharCode(...new TextEncoder().encode(source.href)))
          .replaceAll('+', '-')
          .replaceAll('/', '_')
          .replace(/=+$/, '');
      // Never redeem sharing grants or modify permissions. Existing owner access only.
      const item = await (
        await graph(
          '/shares/' +
            enc(encoded) +
            '/driveItem?$select=id,name,folder,parentReference',
          env.access,
        )
      ).json();
      const driveId = item.parentReference?.driveId;
      if (
        !item.folder ||
        !item.id ||
        typeof driveId !== 'string' ||
        driveId.toLowerCase() !== env.driveId.toLowerCase()
      )
        throw fail('OWNER_FOLDER_REQUIRED', 409);
      const box = { drive_id: driveId, folder_id: item.id };
      let owner,
        verified = false;
      try {
        owner = await privateDestination(box, env);
        verified = true;
      } catch (error) {
        if (!body.configure && error.status === 409)
          return json({
            folder_id: item.id,
            drive_id: driveId,
            name: String(item.name || '').slice(0, 200),
            private: false,
            reason: [
              'DRIVE_OWNER_UNAVAILABLE',
              'PERMISSIONS_INCOMPLETE',
              'ANONYMOUS_LINK_PRESENT',
              'ORGANIZATION_LINK_PRESENT',
              'SHARING_LINK_PRESENT',
              'INVITATION_PRESENT',
              'PERMISSION_IDENTITY_UNAVAILABLE',
              'OTHER_PRINCIPAL_PRESENT',
            ].includes(error.message)
              ? error.message
              : 'PRIVACY_NOT_VERIFIED',
          });
        // Register only an inactive destination draft; all file operations still verify it.
        if (
          !body.configure ||
          error.status !== 409 ||
          error.message !== 'DRIVE_OWNER_UNAVAILABLE'
        )
          throw error;
      }
      const result = {
        folder_id: item.id,
        drive_id: driveId,
        name: String(item.name || '').slice(0, 200),
        drive_owner_id: owner,
        private: verified,
        ...(!verified ? { reason: 'DRIVE_OWNER_UNAVAILABLE' } : {}),
      };
      if (!body.configure) return json(result);
      const rows = await db(
        'private_mailboxes?select=id,drive_id,folder_id,enabled&owner_id=eq.' +
          user.id +
          '&account=eq.jhs96%40eangroup.kr',
      );
      if (rows.length) {
        const old = rows[0];
        if (!verified && old.enabled)
          throw fail('DRIVE_OWNER_UNAVAILABLE', 409);
        if (old.drive_id !== driveId || old.folder_id !== item.id)
          throw fail('EXISTING_MAILBOX_DESTINATION_CONFLICT', 409);
        return json({
          ...result,
          mailbox: old.id,
          configured: true,
          enabled: old.enabled,
        });
      }
      const inserted = await db('private_mailboxes', {
        method: 'POST',
        body: {
          owner_id: user.id,
          account: 'jhs96@eangroup.kr',
          drive_id: driveId,
          folder_id: item.id,
          initial_days: 60,
          enabled: false,
          status: 'disabled',
        },
        prefer: 'return=representation',
      });
      if (inserted.length !== 1) throw fail('MAILBOX_CONFIG_FAILED', 409);
      return json({
        ...result,
        mailbox: inserted[0].id,
        configured: true,
        enabled: false,
      });
    });
  }
  const mailbox = async (id, token) => {
    if (!uuid(id)) throw fail('메일함 식별자가 필요합니다.');
    const box = (
      await db('private_mailboxes?select=*&id=eq.' + id, token ? { token } : {})
    )[0];
    if (!box || (user.id && box.owner_id !== user.id))
      throw fail('메일함에 접근할 수 없습니다.', 403);
    return box;
  };
  // Owner consent is server policy; no client enablement, destination, or key is accepted.
  const resolveJevConfiguration = (sourceId) => {
    if (user.id !== APPROVED_MAIL_TARGET.owner_id || !uuid(sourceId))
      return null;
    let key;
    try {
      key = globalThis.Deno?.env?.get('TYPESAFE_API_KEY');
    } catch {
      /* unavailable */
    }
    return { enabled: true, approvedSourceIds: [sourceId], key, fetcher };
  };
  if (
    [
      'private-mail-manual-add',
      'private-mail-manual-enqueue',
      'private-mail-manual-list',
      'private-mail-manual-update',
      'private-mail-manual-source',
    ].includes(action)
  ) {
    return handleManualMessage(action, body, user, {
      ...ctx,
      resolveJevConfiguration,
      enqueueManualReport: (day) =>
        db('rpc/private_mail_dispatch_report', {
          method: 'POST',
          body: { p_box: APPROVED_MAIL_TARGET.mailbox_id, p_report_day: day },
        }),
    });
  }
  const filterActions = [
    'private-mail-filter-status',
    'private-mail-rules-preview',
    'private-mail-rules-save',
    'private-mail-filter-override',
    'private-mail-filter-apply-preview',
    'private-mail-item-status',
  ];
  const automationActions = [
    'private-mail-background-work',
    'private-mail-automation-status',
    'private-mail-automation-config',
    'private-mail-run-now',
    'private-mail-job-stop',
    'private-mail-daily-overview',
    'private-mail-intent-correction',
    'private-mail-work-correction',
    'private-mail-analyze-one',
    'private-mail-remote-verify',
    'private-mail-report-now',
  ];
  if ([...automationActions, ...filterActions].includes(action)) {
    const remoteFetcher = async (url, options) => {
      let token;
      try {
        token = await db('rpc/private_mail_image_transport_grant', {
          method: 'POST',
          body: {
            p_box: APPROVED_MAIL_TARGET.mailbox_id,
            p_user: user.id,
            p_message: options.sourceId,
            p_url: url,
          },
        });
      } catch {
        throw Object.assign(Error('REMOTE_IMAGE_REVIEW'), {
          remoteStage: 'transport_grant',
        });
      }
      if (typeof token !== 'string' || !/^pmjob_[a-f0-9]{64}$/.test(token))
        throw Object.assign(Error('REMOTE_IMAGE_REVIEW'), {
          remoteStage: 'transport_grant',
        });
      try {
        return await fetcher(
          'https://sajoansan.vercel.app/api/private-mail-worker',
          {
            method: 'POST',
            redirect: 'error',
            signal: options.signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + token,
            },
            body: JSON.stringify({
              kind: 'remote-image',
              mailboxId: APPROVED_MAIL_TARGET.mailbox_id,
              messageId: options.sourceId,
              url,
            }),
          },
        );
      } catch {
        throw Object.assign(Error('REMOTE_IMAGE_SOURCE'), {
          remoteStage: 'transport_request',
        });
      }
    };
    const source = createMailSource({
      db,
      withLock,
      mailbox,
      environment,
      graph,
      verify,
      privateDestination,
      privatePermissions,
      remoteFetcher,
    });
    if (filterActions.includes(action))
      return handleMailFilter(action, body, user, {
        db,
        json,
        fail,
        loadText: source.loadText,
      });
    return handleMailAutomation(action, body, user, {
      ...ctx,
      resolveJevConfiguration,
      ...source,
      remoteFetcher,
      writeHistory: (document) =>
        writeMailHistoryDocument({
          document,
          mailbox,
          environment,
          withLock,
          graph,
          privateDestination,
          privatePermissions,
        }),
      connectedNotes: () => withLock(() => ctx.connectedNotes()),
    });
  }
  if (action === 'private-mail-sync') {
    if (ctx.ownerSync && body.operation === 'begin' && !body.mailbox)
      body.mailbox = ctx.collectorMailboxId;
    if (!uuid(ctx.collectorMailboxId))
      throw fail('수집 대상 메일함 설정이 필요합니다.', 503);
    if (body.mailbox !== ctx.collectorMailboxId)
      throw fail('수집 대상 메일함이 아닙니다.', 403);
    const box = await mailbox(body.mailbox);
    if (
      ctx.background &&
      body.operation === 'begin' &&
      box.automation_config?.enabled !== true
    )
      throw fail('AUTOMATION_DISABLED', 403);
    if (body.operation === 'begin') {
      const lease = crypto.randomUUID();
      const rows = await withLock(async () => {
        if (!box.enabled) {
          if (
            !ctx.ownerSync ||
            user.id !== '2a828c2d-9a6f-40d4-8e13-336b591811cc'
          )
            throw fail('OWNER_SYNC_DISABLED', 403);
          const current = await mailbox(body.mailbox);
          if (current.account !== 'jhs96@eangroup.kr')
            throw fail('MAILBOX_TARGET_REJECTED', 403);
          if (
            current.enabled ||
            (current.lease_until &&
              Date.parse(current.lease_until) > Date.now())
          )
            throw fail('MAILBOX_BUSY', 409);
          let stage = 'folder';
          try {
            const connection = (
              await db('onedrive_connection?select=connected_by&id=eq.true')
            )[0];
            if (connection?.connected_by !== user.id)
              throw fail('OWNER_CONNECTION_REQUIRED', 409);
            const env = await environment();
            await privateDestination(current, env);
            if (
              !Number.isInteger(current.initial_days) ||
              current.initial_days < 1 ||
              current.initial_days > 365 ||
              (current.cutoff_at &&
                !Number.isFinite(Date.parse(current.cutoff_at)))
            )
              throw fail('MAILBOX_TARGET_REJECTED', 409);
            stage = 'begin';
            const now = Date.now();
            // One conditional UPDATE acquires the lease and enables the verified
            // mailbox together. No enabled-without-lease intermediate state.
            const activated = await db(
              'private_mailboxes?id=eq.' +
                current.id +
                '&owner_id=eq.' +
                user.id +
                '&account=eq.jhs96%40eangroup.kr&enabled=eq.false&drive_id=eq.' +
                enc(current.drive_id) +
                '&folder_id=eq.' +
                enc(current.folder_id) +
                '&initial_days=eq.' +
                current.initial_days +
                (current.cutoff_at
                  ? '&cutoff_at=eq.' + enc(current.cutoff_at)
                  : '&cutoff_at=is.null') +
                '&or=(lease_until.is.null,lease_until.lt.' +
                enc(new Date(now).toISOString()) +
                ')',
              {
                method: 'PATCH',
                prefer: 'return=representation',
                body: {
                  enabled: true,
                  lease,
                  lease_until: new Date(now + 600000).toISOString(),
                  status: 'running',
                  last_started_at: new Date(now).toISOString(),
                  last_error: null,
                  cutoff_at:
                    current.cutoff_at ||
                    new Date(
                      now - current.initial_days * 86400000,
                    ).toISOString(),
                },
              },
            );
            if (activated.length !== 1) throw fail('MAILBOX_BUSY', 409);
            return activated;
          } catch (error) {
            const allowed = new Set([
              'OWNER_CONNECTION_REQUIRED',
              'MAILBOX_TARGET_REJECTED',
              'OWNER_FOLDER_REQUIRED',
              'DRIVE_OWNER_UNAVAILABLE',
              'PERMISSIONS_INCOMPLETE',
              'ANONYMOUS_LINK_PRESENT',
              'ORGANIZATION_LINK_PRESENT',
              'SHARING_LINK_PRESENT',
              'INVITATION_PRESENT',
              'PERMISSION_IDENTITY_UNAVAILABLE',
              'OTHER_PRINCIPAL_PRESENT',
              'MAILBOX_BUSY',
            ]);
            const code = allowed.has(error.message)
              ? error.message
              : stage === 'folder'
                ? 'FOLDER_CHECK_FAILED'
                : 'BEGIN_FAILED';
            console.warn(
              JSON.stringify({ event: 'private_mail', stage, code }),
            );
            throw fail(code, error.status === 403 ? 403 : 409);
          }
        }
        return db('rpc/private_mail_begin', {
          method: 'POST',
          body: { p_id: box.id, p_lease: lease },
        });
      });
      if (!rows.length) throw fail('MAILBOX_BUSY', 409);
      return json({
        lease,
        ...(ctx.ownerSync ? { mailbox: box.id } : {}),
        cutoff: rows[0].cutoff_at,
        cursor: rows[0].scan_cursor,
        ...(ctx.ownerSync ? { cycle: rows[0].last_counts?.cycle ?? null } : {}),
      });
    }
    if (
      !box.enabled ||
      !uuid(body.lease) ||
      body.lease !== box.lease ||
      Date.parse(box.lease_until) <= Date.now()
    )
      throw fail('수집 잠금이 만료되었습니다.', 409);
    if (body.operation === 'seen-many') {
      if (
        !ctx.ownerSync ||
        !Array.isArray(body.uidls) ||
        body.uidls.length > 75 ||
        body.uidls.some((id) => !hex(id))
      )
        throw fail('UIDL_LIST_REJECTED');
      if (body.since !== undefined && !Number.isFinite(Date.parse(body.since)))
        throw fail('UIDL_LIST_REJECTED');
      if (!body.uidls.length) return json({ seen: [], publishedSince: [] });
      const rows = await db(
        'private_mail_messages?select=uidl_hash,created_at&mailbox_id=eq.' +
          box.id +
          '&uidl_hash=in.(' +
          body.uidls.join(',') +
          ')&limit=75',
      );
      return json({
        seen: rows.map((row) => row.uidl_hash),
        publishedSince: body.since
          ? rows
              .filter(
                (row) => Date.parse(row.created_at) >= Date.parse(body.since),
              )
              .map((row) => row.uidl_hash)
          : [],
      });
    }
    if (body.operation === 'attach-cycle') {
      if (!ctx.ownerSync || !uuid(body.requestId) || !uuid(body.cycleId))
        throw fail('COLLECTION_STATE');
      return withLock(async () => {
        await fenceMailbox(box, body.lease);
        const current = (
          await db('private_mailboxes?select=last_counts&id=eq.' + box.id)
        )[0];
        const previous = current?.last_counts?.cycle;
        if (previous?.id !== body.cycleId || previous.phase !== 'collecting')
          throw fail('COLLECTION_CHANGED', 409);
        const cycle = validateCollection({
          ...previous,
          requestId: body.requestId,
        });
        await db(
          'private_mailboxes?id=eq.' + box.id + '&lease=eq.' + body.lease,
          {
            method: 'PATCH',
            body: { last_counts: { ...current.last_counts, cycle } },
          },
        );
        return json({ cycle });
      });
    }
    if (body.operation === 'start-cycle') {
      if (!ctx.ownerSync || user.id !== APPROVED_MAIL_TARGET.owner_id)
        throw fail('OWNER_REQUIRED', 403);
      if (box.last_counts?.cycle?.phase === 'collecting')
        throw fail('COLLECTION_ACTIVE', 409);
      let cycle;
      try {
        cycle = startCollection(
          body.uidls,
          crypto.randomUUID(),
          new Date().toISOString(),
          body.requestId,
        );
      } catch {
        throw fail('COLLECTION_STATE');
      }
      await withLock(async () => {
        await fenceMailbox(box, body.lease);
        const current = (
          await db('private_mailboxes?select=last_counts&id=eq.' + box.id)
        )[0];
        if (current?.last_counts?.cycle?.phase === 'collecting')
          throw fail('COLLECTION_ACTIVE', 409);
        await db(
          'private_mailboxes?id=eq.' + box.id + '&lease=eq.' + body.lease,
          {
            method: 'PATCH',
            body: { last_counts: { ...current?.last_counts, cycle } },
          },
        );
      });
      return json({ cycle });
    }
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
        'missing',
        'recovered',
      ]) {
        const n = body.counts?.[key] ?? 0;
        if (!Number.isInteger(n) || n < 0 || n > 100000)
          throw fail('수집 집계가 올바르지 않습니다.');
        counts[key] = n;
      }
      let cycle = box.last_counts?.cycle;
      if (body.cycleId !== undefined) {
        if (!ctx.ownerSync || cycle?.id !== body.cycleId)
          throw fail('COLLECTION_CHECKPOINT', 409);
        try {
          validateCollection(cycle);
          cycle = advanceCollection(cycle, {
            ...counts,
            processedUidls: body.processedUidls,
          });
        } catch {
          throw fail('COLLECTION_CHECKPOINT', 409);
        }
        counts.deferred = cycle.pending.length;
      }
      if (cycle) counts.cycle = cycle;
      const review = body.review ?? [];
      const reviewReasons = new Set([
        'RAW_SIZE_LIMIT',
        'SIZE_UNAVAILABLE',
        'PACKAGE_LIMIT',
        'MIME_INVALID',
        'MISSING_DATE',
      ]);
      if (
        !Array.isArray(review) ||
        review.length > 50 ||
        review.some(
          (item) =>
            !hex(item?.uidl) ||
            !reviewReasons.has(item.reason) ||
            (item.reportedBytes !== null &&
              (!Number.isSafeInteger(item.reportedBytes) ||
                item.reportedBytes < 0)) ||
            !Number.isSafeInteger(item.limitBytes) ||
            item.limitBytes < 0,
        )
      )
        throw fail('REVIEW_METADATA_REJECTED');
      const reviews = new Map(
        (Array.isArray(box.last_counts?.reviews)
          ? box.last_counts.reviews
          : []
        ).map((item) => [item.uidl, item]),
      );
      for (const item of review) reviews.set(item.uidl, item);
      if (body.processedUidls?.length) {
        const published = await db(
          'private_mail_messages?select=uidl_hash&mailbox_id=eq.' +
            box.id +
            '&uidl_hash=in.(' +
            body.processedUidls.join(',') +
            ')&limit=50',
        );
        for (const row of published) reviews.delete(row.uidl_hash);
      }
      if (reviews.size > 5000) throw fail('REVIEW_METADATA_LIMIT', 409);
      if (reviews.size) counts.reviews = [...reviews.values()];
      await withLock(async () => {
        await fenceMailbox(box, body.lease);
        return db(
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
      });
      return json({ ok: true });
    }
    if (['upload-session', 'upload-complete'].includes(body.operation)) {
      if (
        !ctx.ownerSync ||
        !hex(body.uidl) ||
        !hex(body.hash) ||
        !Number.isInteger(body.index) ||
        body.index < 0 ||
        body.index >= 50 ||
        !['eml', 'text', 'html', 'attachment'].includes(body.kind) ||
        typeof body.name !== 'string' ||
        body.name.length > 200 ||
        !hex(body.content_hash) ||
        !Number.isInteger(body.byte_size) ||
        body.byte_size < 1 ||
        body.byte_size > fileLimit(body.kind)
      )
        throw fail('FILE_METADATA_REJECTED');
      if (body.kind === 'eml' && body.content_hash !== body.hash)
        throw fail('EML_HASH_REJECTED');
      const file = {
        kind: body.kind,
        original_name: mailFilename(body.name),
        file_name: body.uidl + '_' + body.hash + '_' + body.index + '.bin',
        byte_size: body.byte_size,
        content_hash: storedHash(body.content_hash),
      };
      return withLock(async (holder) => {
        const env = await environment(),
          owner = await privateDestination(box, env);
        await fenceMailbox(box, body.lease);
        await renew(holder);
        const path =
          '/drives/' +
          enc(box.drive_id) +
          '/items/' +
          enc(box.folder_id) +
          ':/' +
          enc(file.file_name);
        const old = await graph(path, env.access, { allowMissing: true });
        if (old) {
          const item = await old.json();
          await privatePermissions(box, item.id, env, owner, item);
          let preservedEmpty = false;
          try {
            storedMetadata(box, file, item);
          } catch (error) {
            const recoverable = (candidate) =>
              !!candidate?.file &&
              !candidate.folder &&
              !candidate.remoteItem &&
              typeof candidate.id === 'string' &&
              candidate.id.length > 0 &&
              candidate.id.length <= 512 &&
              !/[\r\n\0]/.test(candidate.id) &&
              candidate.size === 0 &&
              candidate.name === file.file_name &&
              candidate.parentReference?.id === box.folder_id &&
              String(candidate.parentReference?.driveId).toLowerCase() ===
                box.drive_id.toLowerCase() &&
              typeof candidate.eTag === 'string' &&
              candidate.eTag.trim().length > 0 &&
              candidate.eTag.trim() !== '*' &&
              candidate.eTag.length <= 1024 &&
              !/[\r\n\0]/.test(candidate.eTag);
            if (
              error?.message !== 'FILE_HASH_REJECTED' ||
              body.operation !== 'upload-session' ||
              !recoverable(item)
            )
              throw error;
            // Preserve a possible prior session reservation as a separate item.
            const current = await (
              await graph(
                '/drives/' + enc(box.drive_id) + '/items/' + enc(item.id),
                env.access,
              )
            ).json();
            if (
              !recoverable(current) ||
              current.id !== item.id ||
              current.eTag !== item.eTag
            )
              throw fail('FILE_HASH_REJECTED', 409);
            await privatePermissions(box, current.id, env, owner, current);
            await fenceMailbox(box, body.lease);
            await renew(holder);
            const recoveryName = file.file_name.replace(
              /\.bin$/,
              '_미완료업로드_' + crypto.randomUUID() + '.bin',
            );
            await graph(
              '/drives/' + enc(box.drive_id) + '/items/' + enc(item.id),
              env.access,
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'If-Match': item.eTag,
                },
                body: JSON.stringify({
                  name: recoveryName,
                  '@microsoft.graph.conflictBehavior': 'fail',
                }),
              },
            );
            preservedEmpty = true;
          }
          if (!preservedEmpty) {
            await verifyStored(box, file, item, env.access);
            return json({ file: { ...file, item_id: item.id } });
          }
        }
        if (body.operation === 'upload-complete')
          throw fail('FILE_NOT_UPLOADED', 409);
        // Match the existing consumer OneDrive storage path; optional item metadata is rejected by some accounts.
        const session = await (
          await graph(path + ':/createUploadSession', env.access, {
            method: 'POST',
          })
        ).json();
        let url;
        try {
          url = new URL(session.uploadUrl);
        } catch {
          console.warn(
            JSON.stringify({
              event: 'PRIVATE_MAIL_UPLOAD_SESSION_REJECTED',
              reason: 'malformed_url',
            }),
          );
          throw fail('UPLOAD_SESSION_REJECTED', 502);
        }
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.port ||
          url.hash ||
          ![
            '.1drv.com',
            '.onedrive.com',
            '.microsoftpersonalcontent.com',
            '.sharepoint.com',
          ].some((host) => url.hostname.endsWith(host))
        ) {
          console.warn(
            JSON.stringify({
              event: 'PRIVATE_MAIL_UPLOAD_SESSION_REJECTED',
              reason: 'origin_policy',
              hostSuffix: url.hostname
                .split('.')
                .slice(-2)
                .join('.')
                .slice(0, 100),
            }),
          );
          throw fail('UPLOAD_SESSION_REJECTED', 502);
        }
        return json({
          uploadUrl: url.href,
          expiresAt: session.expirationDateTime,
        });
      });
    }
    if (body.operation === 'file') {
      if (
        !binary ||
        !ctx.ownerSync ||
        !hex(body.uidl) ||
        !hex(body.hash) ||
        !Number.isInteger(body.index) ||
        body.index < 0 ||
        body.index >= 50 ||
        !['eml', 'text', 'html', 'attachment'].includes(body.kind) ||
        typeof body.name !== 'string' ||
        body.name.length > 200 ||
        !hex(body.content_hash) ||
        !Number.isInteger(body.byte_size) ||
        body.byte_size < 1 ||
        body.byte_size > DIRECT_FILE_BYTES
      )
        throw fail('FILE_METADATA_REJECTED');
      if (body.kind === 'eml' && body.content_hash !== body.hash)
        throw fail('EML_HASH_REJECTED');
      const reader = req.body?.getReader();
      if (!reader) throw fail('FILE_BODY_REQUIRED');
      const bytes = new Uint8Array(body.byte_size);
      let offset = 0,
        timer;
      const deadline = Date.now() + 30000;
      try {
        for (;;) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw fail('FILE_READ_TIMEOUT', 408);
          const { value, done } = await Promise.race([
            reader.read(),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(fail('FILE_READ_TIMEOUT', 408)),
                remaining,
              );
            }),
          ]);
          clearTimeout(timer);
          if (done) break;
          if (offset + value.length > bytes.length)
            throw fail('FILE_SIZE_REJECTED', 413);
          bytes.set(value, offset);
          offset += value.length;
        }
      } catch (error) {
        reader.cancel().catch(() => {});
        throw error;
      } finally {
        clearTimeout(timer);
      }
      if (offset !== bytes.length || (await sha(bytes)) !== body.content_hash)
        throw fail('FILE_HASH_REJECTED');
      const file = {
        kind: body.kind,
        original_name: mailFilename(body.name),
        file_name: body.uidl + '_' + body.hash + '_' + body.index + '.bin',
        byte_size: bytes.length,
        content_hash: storedHash(body.content_hash),
      };
      return withLock(async (holder) => {
        const env = await environment(),
          driveOwner = await privateDestination(box, env);
        const ref = await transferFile(
          box,
          file,
          bytes,
          holder,
          env,
          driveOwner,
        );
        return json({ file: ref });
      });
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
    if (
      !['ingest', 'finish'].includes(body.operation) ||
      (body.operation === 'finish' && !ctx.ownerSync)
    )
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
    if (body.operation === 'finish') {
      let total = 0;
      const refs = [];
      for (const [index, file] of m.files.entries()) {
        if (
          !['eml', 'text', 'html', 'attachment'].includes(file.kind) ||
          typeof file.name !== 'string' ||
          file.name.length > 200 ||
          !Number.isInteger(file.byte_size) ||
          file.byte_size < 1 ||
          file.byte_size > fileLimit(file.kind) ||
          !hex(file.content_hash) ||
          file.bytes !== undefined ||
          file.data !== undefined
        )
          throw fail('MANIFEST_REJECTED');
        total += file.byte_size;
        if (total > MAIL_DATA_LIMIT) throw fail('MANIFEST_LIMIT', 413);
        refs.push({
          kind: file.kind,
          original_name: mailFilename(file.name),
          file_name: uidl + '_' + m.hash + '_' + index + '.bin',
          byte_size: file.byte_size,
          content_hash: storedHash(file.content_hash),
        });
      }
      if (
        refs.filter((f) => f.kind === 'eml').length !== 1 ||
        refs.find((f) => f.kind === 'eml').content_hash !== storedHash(m.hash)
      )
        throw fail('EML_HASH_REJECTED');
      return withLock(async (holder) => {
        let finishStage = 'destination',
          fileIndex = -1;
        try {
          const env = await environment(),
            driveOwner = await privateDestination(box, env),
            manifest = [];
          finishStage = 'file_verification';
          for (const file of refs) {
            fileIndex++;
            manifest.push(
              await transferFile(box, file, null, holder, env, driveOwner),
            );
          }
          finishStage = 'lock_renewal';
          await renew(holder);
          finishStage = 'database_publish';
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
        } catch (error) {
          console.warn(
            JSON.stringify({
              event: 'PRIVATE_MAIL_FINISH_FAILURE',
              stage: finishStage,
              fileIndex,
              httpStatus:
                Number.isInteger(error?.status) &&
                error.status >= 400 &&
                error.status <= 599
                  ? error.status
                  : null,
            }),
          );
          throw error;
        }
      });
    }
    let total = 0;
    const files = [];
    for (const [index, file] of m.files.entries()) {
      if (
        !['eml', 'text', 'html', 'attachment'].includes(file.kind) ||
        typeof file.data !== 'string' ||
        file.data.length > Math.ceil((fileLimit(file.kind) * 4) / 3) + 4
      )
        throw fail('메일 파일 제한을 초과했습니다.', 413);
      const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
      total += bytes.length;
      if (bytes.length > fileLimit(file.kind) || total > MAIL_DATA_LIMIT)
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
      const driveOwner = await privateDestination(box, env);
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
        await fenceMailbox(box, body.lease);
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
        await privatePermissions(box, item.id, env, driveOwner, item);
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
    return json({
      mailboxes: boxes.map((box) => {
        if (!box.last_counts?.cycle) return box;
        const { cycle, ...counts } = box.last_counts;
        let progress;
        try {
          progress = collectionProgress(cycle);
        } catch {
          progress = undefined;
        }
        return { ...box, last_counts: { ...counts, progress } };
      }),
    });
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
    const driveOwner = await privateDestination(box, env);
    const item = await (
      await graph(
        '/drives/' + enc(box.drive_id) + '/items/' + enc(file.item_id),
        env.access,
      )
    ).json();
    await privatePermissions(box, item.id, env, driveOwner, item);
    const large = file.byte_size > DIRECT_FILE_BYTES;
    if (large && ['text', 'html'].includes(file.kind))
      throw fail(
        '본문이 커서 미리보기를 제한했습니다. 원본 EML을 내려받아 확인해 주세요.',
        413,
      );
    let bytes, download;
    if (large) {
      storedMetadata(box, file, item);
      download = await graph(
        '/drives/' +
          enc(box.drive_id) +
          '/items/' +
          enc(file.item_id) +
          '/content',
        env.access,
        { timeoutMs: 120000 },
      );
    } else
      bytes = await verify(
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
    return new Response(
      large
        ? checkedMailStream(download.body, {
            expectedBytes: file.byte_size,
            expectedHash: file.content_hash,
          })
        : bytes,
      { headers },
    );
  });
}
