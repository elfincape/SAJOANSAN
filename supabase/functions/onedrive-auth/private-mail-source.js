import { APPROVED_MAIL_TARGET as TARGET } from './private-mail-policy.js';
import { mailBodyText, emlHeaderText } from './private-mail-body.js';
import {
  extractMailThreadHeaders,
  mailOwnershipContext,
} from './private-mail-analysis.js';
import { matchMailRules } from './private-mail-filter.js';
import { applyMailIntentOverride } from './private-mail-briefing-model.js';
import {
  selectMailPhotos,
  inspectMailImage,
  mailPhotoExclusionReason,
  requiresMailPrivacyReview,
} from './private-mail-images.js';
import { verifyMailStream } from './private-mail-stream-verify.js';
const enc = encodeURIComponent;
const sourceRow = (row) => {
  if (
    row?.owner_id !== TARGET.owner_id ||
    row.mailbox_id !== TARGET.mailbox_id ||
    !Array.isArray(row.files)
  )
    throw Error('ANALYSIS_SOURCE');
};
function hexHash(value) {
  if (/^[0-9a-f]{64}$/.test(value ?? '')) return value;
  if (!/^[A-Za-z0-9_-]{43}$/.test(value ?? '')) throw Error('IMAGE_SOURCE');
  const bytes = Uint8Array.from(
    atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='),
    (c) => c.charCodeAt(0),
  );
  if (bytes.length !== 32) throw Error('IMAGE_SOURCE');
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function createMailSource({
  db,
  withLock,
  mailbox,
  environment,
  graph,
  verify,
  privateDestination,
  privatePermissions,
}) {
  async function access(row, action) {
    sourceRow(row);
    return withLock(async () => {
      const box = await mailbox(row.mailbox_id),
        env = await environment(),
        driveOwner = await privateDestination(box, env);
      const item = async (file) => {
        const metadata = await (
          await graph(
            '/drives/' + enc(box.drive_id) + '/items/' + enc(file.item_id),
            env.access,
          )
        ).json();
        await privatePermissions(box, metadata.id, env, driveOwner, metadata);
        if (
          !metadata.file ||
          metadata.id !== file.item_id ||
          metadata.size !== file.byte_size ||
          metadata.name !== file.file_name ||
          metadata.parentReference?.id !== box.folder_id ||
          String(metadata.parentReference?.driveId).toLowerCase() !==
            box.drive_id.toLowerCase()
        )
          throw Error('MAIL_LOAD_FAILED');
        return metadata;
      };
      const bytes = async (file, max = 2100000) => {
        if (!file || file.byte_size > max) throw Error('BODY_LIMIT');
        return verify(
          { ...file, drive_id: box.drive_id, folder_id: box.folder_id },
          await item(file),
          env.access,
        );
      };
      const headers = async (file) => {
        await item(file);
        const response = await graph(
          '/drives/' +
            enc(box.drive_id) +
            '/items/' +
            enc(file.item_id) +
            '/content',
          env.access,
        );
        if (!response.body) throw Error('MAIL_LOAD_FAILED');
        const [hashBody, headBody] = response.body.tee();
        let checkError;
        const checking = verifyMailStream(new Response(hashBody), {
          expectedBytes: file.byte_size,
          expectedHash: file.content_hash,
        }).catch((error) => {
          checkError = error;
        });
        const reader = headBody.getReader(),
          parts = [];
        let length = 0;
        try {
          while (length < 65536) {
            const next = await reader.read();
            if (next.done) break;
            const part = next.value.subarray(0, 65536 - length);
            parts.push(part);
            length += part.length;
            if (new TextDecoder().decode(part).includes('\r\n\r\n')) break;
          }
        } finally {
          void reader.cancel().catch(() => {});
        }
        await checking;
        if (checkError) throw checkError;
        const joined = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          joined.set(part, offset);
          offset += part.length;
        }
        return emlHeaderText(joined);
      };
      return action({ box, bytes, headers });
    });
  }
  async function loadText(row, { signal } = {}) {
    signal?.throwIfAborted();
    const result = await access(row, async ({ bytes }) => {
      const file =
        row.files.find((file) => file.kind === 'text') ??
        row.files.find((file) => file.kind === 'html');
      return file
        ? mailBodyText(new TextDecoder().decode(await bytes(file)), file.kind)
        : '';
    });
    signal?.throwIfAborted();
    return result;
  }
  async function related(ids, { includeExcluded = false } = {}) {
    const ownerBox = await mailbox(TARGET.mailbox_id);
    const unique = [...new Set(ids)],
      result = [],
      seen = new Set();
    if (unique.length > 128) throw Error('RELATED_LIMIT');
    for (let offset = 0; offset < unique.length; offset += 8) {
      const filter =
        '(' +
        unique
          .slice(offset, offset + 8)
          .map(
            (id) =>
              '"' + id.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"',
          )
          .join(',') +
        ')';
      const rows = await db(
        'private_mail_messages?select=analysis,analysis_excluded,analysis_filter_override&mailbox_id=eq.' +
          TARGET.mailbox_id +
          '&analysis=not.is.null&' +
          enc('analysis->source->thread->>messageId') +
          '=in.' +
          enc(filter) +
          '&limit=21',
      );
      for (const row of rows) {
        const excluded =
          row.analysis_excluded === true &&
          row.analysis_filter_override !== 'include';
        if (
          !row.analysis?.source?.id ||
          seen.has(row.analysis.source.id) ||
          (excluded && !includeExcluded)
        )
          continue;
        seen.add(row.analysis.source.id);
        result.push({
          ...applyMailIntentOverride(
            row.analysis,
            ownerBox.automation_config?.intentOverrides?.[
              row.analysis.source.id
            ],
          ),
          source: { ...row.analysis.source, excluded },
        });
      }
      if (result.length > 20) throw Error('RELATED_LIMIT');
    }
    return result;
  }
  async function loadMail(row) {
    const source = await access(row, async ({ box, bytes, headers }) => {
      const bodyFile =
        row.files.find((file) => file.kind === 'text') ??
        row.files.find((file) => file.kind === 'html');
      const text = bodyFile
        ? mailBodyText(
            new TextDecoder().decode(await bytes(bodyFile)),
            bodyFile.kind,
          )
        : '';
      const base = {
        id: row.id,
        uidl_hash: row.uidl_hash,
        subject: row.subject,
        sender: row.sender,
        sent_at: row.sent_at,
        created_at: row.created_at,
        text,
      };
      const exclusion = matchMailRules({
        mail: base,
        rules: box.analysis_rules ?? [],
        override: row.analysis_filter_override ?? 'inherit',
      });
      if (exclusion.excluded) return { ...base, exclusion };
      if (requiresMailPrivacyReview(row.subject + '\n' + text))
        throw Error('MAIL_PRIVACY_REVIEW');
      const files = row.files.map((file, index) => ({
        ...file,
        index,
        name: file.original_name,
      }));
      const htmlFile = row.files.find((file) => file.kind === 'html');
      const hasImage = files.some((file) =>
        /\.(?:jpe?g|png|webp)$/i.test(file.name ?? ''),
      );
      const html =
        hasImage && htmlFile
          ? new TextDecoder().decode(await bytes(htmlFile))
          : '';
      const candidates = selectMailPhotos({
        subject: row.subject,
        text,
        files,
        html,
      });
      if (candidates.review.length) throw Error(candidates.review[0].reason);
      const images = [];
      for (const file of candidates.selected) {
        const data = await bytes(file),
          info = inspectMailImage(data);
        if (
          mailPhotoExclusionReason(file, info, {
            html,
            text,
            subject: row.subject,
          })
        )
          continue;
        images.push({
          id: row.id + ':' + file.index,
          name: file.original_name,
          mediaType: info.mediaType,
          width: info.width,
          height: info.height,
          contentHash: hexHash(file.content_hash),
          bytes: data,
        });
      }
      const eml = row.files.find((file) => file.kind === 'eml');
      const verifiedHeaders = eml ? await headers(eml) : '';
      return {
        ...base,
        images,
        headers: verifiedHeaders,
        ...mailOwnershipContext({
          text,
          headers: verifiedHeaders,
          account: box.account,
        }),
      };
    });
    if (source.exclusion?.excluded) return source;
    const thread = extractMailThreadHeaders(source.headers);
    return {
      ...source,
      related: await related([...thread.inReplyTo, ...thread.references]),
    };
  }
  async function loadImage(descriptor) {
    const row = (
      await db(
        'private_mail_messages?select=*&id=eq.' +
          enc(descriptor.sourceId) +
          '&mailbox_id=eq.' +
          TARGET.mailbox_id,
      )
    )[0];
    if (
      !row ||
      (row.analysis_excluded === true &&
        row.analysis_filter_override !== 'include')
    )
      throw Error('NOTES_IMAGE_SOURCE');
    const index = Number(descriptor.id.slice(descriptor.sourceId.length + 1)),
      file = row.files[index];
    if (!file || hexHash(file.content_hash) !== descriptor.contentHash)
      throw Error('NOTES_IMAGE_SOURCE');
    const data = await access(row, ({ bytes }) => bytes(file));
    return { ...descriptor, bytes: data };
  }
  return {
    loadText,
    loadMail,
    loadImage,
    relatedAnalyses: (analyses) => {
      const known = new Set(
        analyses.map((item) => item.source.thread?.messageId).filter(Boolean),
      );
      return related(
        analyses
          .flatMap((item) => [
            ...(item.source.thread?.inReplyTo ?? []),
            ...(item.source.thread?.references ?? []),
          ])
          .filter((id) => !known.has(id)),
        { includeExcluded: true },
      );
    },
  };
}
