import { createHash } from 'node:crypto';
import { MAIL_DERIVED_FILE_LIMIT } from './private-mail-limits.js';

function verifier({ expectedBytes, expectedHash } = {}) {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 0 ||
    expectedBytes > MAIL_DERIVED_FILE_LIMIT ||
    typeof expectedHash !== 'string'
  )
    throw Error('MAIL_STREAM_METADATA');
  let hash;
  if (/^[a-f0-9]{64}$/i.test(expectedHash)) hash = expectedHash.toLowerCase();
  else if (/^[A-Za-z0-9_-]{43}$/.test(expectedHash)) {
    const decoded = atob(
      expectedHash.replaceAll('-', '+').replaceAll('_', '/') + '=',
    );
    const canonical = btoa(decoded)
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    if (canonical !== expectedHash || decoded.length !== 32)
      throw Error('MAIL_STREAM_METADATA');
    hash = Array.from(decoded, (value) =>
      value.charCodeAt(0).toString(16).padStart(2, '0'),
    ).join('');
  } else throw Error('MAIL_STREAM_METADATA');
  const digest = createHash('sha256');
  let size = 0;
  return {
    append(chunk) {
      if (!(chunk instanceof Uint8Array)) throw Error('MAIL_STREAM_CHUNK');
      if (size + chunk.byteLength > expectedBytes)
        throw Error('MAIL_STREAM_SIZE');
      size += chunk.byteLength;
      digest.update(chunk);
    },
    finish() {
      if (size !== expectedBytes) throw Error('MAIL_STREAM_SIZE');
      const contentHash = digest.digest('hex');
      if (contentHash !== hash) throw Error('MAIL_STREAM_HASH');
      return { byte_size: size, content_hash: contentHash };
    },
  };
}

export async function verifyMailStream(response, expected) {
  let reader;
  try {
    const check = verifier(expected);
    if (!response?.ok) throw Error('MAIL_STREAM_RESPONSE');
    if (response.body) {
      reader = response.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        check.append(value);
      }
    }
    return check.finish();
  } catch (error) {
    try {
      if (reader) await reader.cancel();
      else await response?.body?.cancel();
    } catch {}
    throw error;
  } finally {
    reader?.releaseLock();
  }
}

// Blob consumers reject when the final size or digest fails; bytes pass through unchanged.
export function checkedMailStream(body, expected) {
  const check = verifier(expected);
  if (!body || typeof body.pipeThrough !== 'function')
    throw Error('MAIL_STREAM_BODY');
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        check.append(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        check.finish();
      },
    }),
  );
}
