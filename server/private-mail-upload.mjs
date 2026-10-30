import { createHash } from 'node:crypto';
import {
  MAIL_RAW_LIMIT,
  MAIL_DERIVED_FILE_LIMIT,
  MAIL_METADATA_LIMIT,
} from '../supabase/functions/onedrive-auth/private-mail-limits.js';

export const MAIL_UPLOAD_CHUNK_BYTES = 3_276_800;
const hosts = [
  '.1drv.com',
  '.onedrive.com',
  '.microsoftpersonalcontent.com',
  '.sharepoint.com',
];
const failed = () => Error('FILE_UPLOAD_FAILED');

function expectedHash(value) {
  if (typeof value !== 'string') throw failed();
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw failed();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== value)
    throw failed();
  return bytes.toString('hex');
}

function sessionUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw failed();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    !hosts.some((host) => url.hostname.endsWith(host))
  )
    throw failed();
  return url.href;
}

async function responseJson(response) {
  if (!response.body) throw failed();
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAIL_METADATA_LIMIT) throw failed();
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch {
    await reader.cancel().catch(() => {});
    throw failed();
  } finally {
    reader.releaseLock();
  }
}

export async function uploadMailFile({
  file,
  begin,
  complete,
  fetcher = fetch,
  signal,
}) {
  signal?.throwIfAborted();
  if (
    !file ||
    !(file.bytes instanceof Uint8Array) ||
    !Number.isSafeInteger(file.byte_size) ||
    file.byte_size < 1 ||
    file.byte_size !== file.bytes.byteLength ||
    file.byte_size >
      (file.kind === 'eml' ? MAIL_RAW_LIMIT : MAIL_DERIVED_FILE_LIMIT) ||
    typeof begin !== 'function' ||
    typeof complete !== 'function'
  )
    throw failed();
  if (
    createHash('sha256').update(file.bytes).digest('hex') !==
    expectedHash(file.content_hash)
  )
    throw failed();
  const { bytes, ...metadata } = file;
  const started = await begin(metadata);
  signal?.throwIfAborted();
  if (started?.file) return { file: started.file };
  const url = sessionUrl(started?.uploadUrl);
  if (
    started.expiresAt !== undefined &&
    (!Number.isFinite(Date.parse(started.expiresAt)) ||
      Date.parse(started.expiresAt) <= Date.now())
  )
    throw failed();
  const finish = async () => {
    signal?.throwIfAborted();
    const result = await complete();
    if (!result?.file) throw failed();
    return result;
  };
  for (let offset = 0; offset < bytes.byteLength;) {
    signal?.throwIfAborted();
    const end = Math.min(offset + MAIL_UPLOAD_CHUNK_BYTES, bytes.byteLength),
      final = end === bytes.byteLength;
    let response;
    try {
      // The scoped upload capability receives no Microsoft or application credentials.
      response = await fetcher(url, {
        method: 'PUT',
        headers: {
          'Content-Length': String(end - offset),
          'Content-Range': `bytes ${offset}-${end - 1}/${bytes.byteLength}`,
          'Content-Type': 'application/octet-stream',
        },
        body: bytes.subarray(offset, end),
        signal: AbortSignal.any([
          AbortSignal.timeout(60000),
          ...(signal ? [signal] : []),
        ]),
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      signal?.throwIfAborted();
      if (final) {
        try {
          return await finish();
        } catch {
          signal?.throwIfAborted();
        }
      }
      throw failed();
    }
    let result;
    try {
      result = await responseJson(response);
    } catch {
      signal?.throwIfAborted();
      if (final && [200, 201].includes(response?.status)) {
        try {
          return await finish();
        } catch {
          signal?.throwIfAborted();
        }
      }
      throw failed();
    }
    if (final) {
      if (
        ![200, 201].includes(response.status) ||
        typeof result?.id !== 'string' ||
        !result.id ||
        result.id.length > 512 ||
        /[\r\n\0]/.test(result.id)
      )
        throw failed();
      return finish();
    }
    if (
      response.status !== 202 ||
      !Array.isArray(result?.nextExpectedRanges) ||
      result.nextExpectedRanges.length !== 1 ||
      result.nextExpectedRanges[0] !== `${end}-`
    )
      throw failed();
    offset = end;
  }
  throw failed();
}
