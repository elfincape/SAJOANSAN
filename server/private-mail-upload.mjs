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

function nextRange(value, next, total) {
  const count = Array.isArray(value) ? value.length : null;
  const match =
    count === 1 && typeof value[0] === 'string'
      ? /^(0|[1-9][0-9]*)-(?:(0|[1-9][0-9]*))?$/.exec(value[0])
      : null;
  const finite = !!match && match[2] !== undefined;
  const startMatches =
    !!match &&
    Number.isSafeInteger(Number(match[1])) &&
    Number(match[1]) === next;
  const endMatches =
    !!match &&
    (!finite ||
      (Number.isSafeInteger(Number(match[2])) &&
        Number(match[2]) === total - 1));
  return {
    rangeCount: count,
    rangeKind: match
      ? finite
        ? 'finite'
        : 'open'
      : count > 1
        ? 'multiple'
        : 'invalid',
    rangeStartMatches: startMatches,
    rangeEndMatches: endMatches,
  };
}

const networkCodes = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ENOTFOUND',
  'ECONNRESET',
  'ETIMEDOUT',
]);
function requestFailure(error, signal) {
  const candidate = error?.cause?.code ?? error?.code;
  const networkCode = networkCodes.has(candidate) ? candidate : 'other';
  const aborted = signal?.aborted === true;
  const timeout =
    error?.name === 'TimeoutError' ||
    (!aborted && error?.name === 'AbortError') ||
    [
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'ETIMEDOUT',
    ].includes(networkCode);
  const redirect =
    error?.message === 'unexpected redirect' ||
    error?.cause?.message === 'unexpected redirect';
  return {
    timeout,
    aborted,
    networkCode,
    reason: aborted
      ? 'aborted'
      : redirect
        ? 'redirect_rejected'
        : timeout
          ? 'request_timeout'
          : 'network',
  };
}

async function upload(
  { file, begin, complete, fetcher = fetch, signal },
  diagnostic,
) {
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
  diagnostic.stage = 'begin';
  diagnostic.reason = 'bridge';
  const started = await begin(metadata);
  signal?.throwIfAborted();
  if (started?.file) return { file: started.file };
  diagnostic.stage = 'session';
  diagnostic.reason = 'session_url';
  const url = sessionUrl(started?.uploadUrl);
  if (
    started.expiresAt !== undefined &&
    (!Number.isFinite(Date.parse(started.expiresAt)) ||
      Date.parse(started.expiresAt) <= Date.now())
  ) {
    diagnostic.reason = 'session_expired';
    throw failed();
  }
  const finish = async () => {
    signal?.throwIfAborted();
    diagnostic.stage = 'complete';
    diagnostic.reason = 'verification';
    diagnostic.verificationAttempted = true;
    try {
      const result = await complete();
      if (!result?.file) throw failed();
      return result;
    } catch (error) {
      diagnostic.verificationFailed = true;
      throw error;
    }
  };
  let finiteReported = false;
  for (let offset = 0; offset < bytes.byteLength;) {
    signal?.throwIfAborted();
    const end = Math.min(offset + MAIL_UPLOAD_CHUNK_BYTES, bytes.byteLength),
      final = end === bytes.byteLength;
    Object.assign(diagnostic, {
      stage: 'request',
      reason: 'request',
      chunkIndex: diagnostic.chunkIndex + 1,
      final,
      httpStatus: null,
    });
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
    } catch (error) {
      const failure = requestFailure(error, signal);
      Object.assign(diagnostic, failure, { requestReason: failure.reason });
      signal?.throwIfAborted();
      if (final) {
        diagnostic.recoveryFrom = 'request';
        try {
          return await finish();
        } catch {
          signal?.throwIfAborted();
        }
      }
      throw failed();
    }
    diagnostic.httpStatus =
      Number.isInteger(response?.status) &&
      response.status >= 100 &&
      response.status <= 599
        ? response.status
        : null;
    if (
      (final && ![200, 201].includes(response.status)) ||
      (!final && response.status !== 202)
    ) {
      diagnostic.stage = 'http';
      diagnostic.reason = 'http_status';
      await response.body?.cancel().catch(() => {});
      throw failed();
    }
    diagnostic.stage = 'response_json';
    diagnostic.reason = 'json';
    let result;
    try {
      result = await responseJson(response);
    } catch {
      signal?.throwIfAborted();
      if (final && [200, 201].includes(response?.status)) {
        diagnostic.recoveryFrom = 'response_json';
        try {
          return await finish();
        } catch {
          signal?.throwIfAborted();
        }
      }
      throw failed();
    }
    if (final) {
      diagnostic.stage = 'final';
      diagnostic.reason = 'final_metadata';
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
    diagnostic.stage = 'range';
    diagnostic.reason = 'range';
    const range = nextRange(result?.nextExpectedRanges, end, bytes.byteLength);
    Object.assign(diagnostic, range);
    if (!range.rangeStartMatches || !range.rangeEndMatches) throw failed();
    if (range.rangeKind === 'finite' && !finiteReported) {
      console.warn(
        JSON.stringify({
          event: 'PRIVATE_MAIL_UPLOAD_RANGE',
          stage: 'range',
          httpStatus: response.status,
          chunkIndex: diagnostic.chunkIndex,
          final: false,
          ...range,
        }),
      );
      finiteReported = true;
    }
    offset = end;
  }
  throw failed();
}

export async function uploadMailFile(options = {}) {
  const diagnostic = {
    event: 'PRIVATE_MAIL_UPLOAD_FAILURE',
    stage: 'input',
    reason: 'validation',
    httpStatus: null,
    chunkIndex: 0,
    final: false,
    timeout: false,
    aborted: false,
    networkCode: 'other',
    rangeCount: null,
    rangeKind: 'not_seen',
    rangeStartMatches: false,
    rangeEndMatches: false,
    verificationAttempted: false,
    verificationFailed: false,
    recoveryFrom: 'none',
    requestReason: 'none',
  };
  try {
    return await upload(options, diagnostic);
  } catch (error) {
    if (options.signal?.aborted) {
      diagnostic.aborted = true;
      diagnostic.reason = 'aborted';
    }
    console.warn(JSON.stringify(diagnostic));
    throw error;
  }
}
