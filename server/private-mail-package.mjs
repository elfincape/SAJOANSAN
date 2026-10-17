import PostalMime from 'postal-mime';
import { createHash } from 'node:crypto';
export const RAW_LIMIT = 1024 * 1024;
export const PACKAGE_LIMIT = 3 * 1024 * 1024;
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
    mail = await PostalMime.parse(raw, {
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
  const files = [
    { kind: 'eml', name: 'original.eml', data: raw.toString('base64') },
  ];
  let total = raw.length;
  const add = (kind, name, data) => {
    if (!data.length) return;
    total += data.length;
    if (data.length > RAW_LIMIT || total > 2 * RAW_LIMIT || files.length >= 50)
      throw Error('LIMIT_REACHED');
    files.push({ kind, name: safeName(name), data: data.toString('base64') });
  };
  if (mail.text) add('text', 'text', Buffer.from(mail.text));
  if (mail.html) add('html', 'html', Buffer.from(mail.html));
  for (const a of mail.attachments || [])
    add('attachment', a.filename || 'attachment', Buffer.from(a.content));
  const result = {
    uidl: digest(uidl),
    hash: digest(raw),
    subject: String(mail.subject || '').slice(0, 500),
    sender: String(mail.from?.address || '').slice(0, 500),
    sent: new Date(sent).toISOString(),
    files,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > PACKAGE_LIMIT)
    throw Error('LIMIT_REACHED');
  return result;
}
