import PostalMime from 'postal-mime';
import { createHash } from 'node:crypto';
import {
  MAIL_RAW_LIMIT,
  MAIL_DATA_LIMIT,
  MAIL_DERIVED_FILE_LIMIT,
  MAIL_METADATA_LIMIT,
  MAIL_FILE_COUNT_LIMIT,
} from '../supabase/functions/onedrive-auth/private-mail-limits.js';
export const RAW_LIMIT = MAIL_RAW_LIMIT;
export const PACKAGE_LIMIT = MAIL_METADATA_LIMIT;
export const DATA_LIMIT = MAIL_DATA_LIMIT;
export const DERIVED_FILE_LIMIT = MAIL_DERIVED_FILE_LIMIT;
const digest = (data) => createHash('sha256').update(data).digest('hex');
export function safeName(value) {
  const name =
    String(value || 'attachment')
      .normalize('NFC')
      .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
      .replace(/^[ .]+|[ .]+$/g, '')
      .slice(0, 120) || 'attachment';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    ? '_' + name
    : name;
}
export async function packageMessage(raw, uidl, { signal } = {}) {
  signal?.throwIfAborted();
  if (!Buffer.isBuffer(raw) || !raw.length || raw.length > RAW_LIMIT)
    throw Error('LIMIT_REACHED');
  let mail;
  try {
    const input =
      raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength
        ? raw.buffer
        : raw;
    mail = await PostalMime.parse(input, {
      forceRfc822Attachments: true,
      maxNestingDepth: 20,
      maxPartCount: 60,
      maxHeadersSize: 65536,
      maxForwardedAddresses: 50,
      maxRfc822NestingDepth: 0,
    });
  } catch {
    throw Error('MIME_INVALID');
  }
  signal?.throwIfAborted();
  const sent = Date.parse(mail.date);
  if (!Number.isFinite(sent)) throw Error('MISSING_DATE');
  const files = [{ kind: 'eml', name: 'original.eml', bytes: raw }];
  let total = raw.length;
  const add = (kind, name, data) => {
    if (!data.length) return;
    total += data.length;
    if (
      data.length > DERIVED_FILE_LIMIT ||
      total > DATA_LIMIT ||
      files.length >= MAIL_FILE_COUNT_LIMIT
    )
      throw Error('PACKAGE_LIMIT_REACHED');
    files.push({ kind, name: safeName(name), bytes: data });
  };
  for (const [kind, name, value] of [
    ['text', 'text', mail.text],
    ['html', 'html', mail.html],
  ]) {
    if (!value) continue;
    const length = Buffer.byteLength(value);
    if (length > DERIVED_FILE_LIMIT || total + length > DATA_LIMIT)
      throw Error('PACKAGE_LIMIT_REACHED');
    add(kind, name, Buffer.from(value));
    mail[kind] = undefined;
  }
  for (const a of mail.attachments || []) {
    signal?.throwIfAborted();
    const content = a.content;
    const bytes = ArrayBuffer.isView(content)
      ? Buffer.from(content.buffer, content.byteOffset, content.byteLength)
      : content instanceof ArrayBuffer
        ? Buffer.from(content)
        : null;
    if (!bytes) throw Error('MIME_INVALID');
    add('attachment', a.filename || 'attachment', bytes);
  }
  const result = {
    uidl: digest(uidl),
    hash: digest(raw),
    subject: String(mail.subject || '').slice(0, 500),
    sender: String(mail.from?.address || '').slice(0, 500),
    sent: new Date(sent).toISOString(),
    files,
  };
  for (const file of files) {
    file.byte_size = file.bytes.length;
    file.content_hash = digest(file.bytes);
  }
  if (
    Buffer.byteLength(
      JSON.stringify({
        ...result,
        files: files.map(({ bytes, ...metadata }) => metadata),
      }),
    ) > PACKAGE_LIMIT
  )
    throw Error('PACKAGE_LIMIT_REACHED');
  return result;
}
