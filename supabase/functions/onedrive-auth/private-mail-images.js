export const MAIL_PHOTO_LIMITS = Object.freeze({
  count: 3,
  perImageBytes: 2100000,
  totalBytes: 3000000,
  maxDimension: 8000,
});

const sensitive =
  /주민\s*등록증|주민\s*등록\s*번호|신분증|여권|운전\s*면허증|비밀\s*번호|패스워드|\bpassport\b|\b(?:government|national)[ _-]?id\b|\bdriver'?s?[ _-]?licen[cs]e\b|\bpassword\b|\b(?:api|access|auth|secret)[ _-]?(?:key|token)\b/i;

export function requiresMailPrivacyReview(value) {
  const text = typeof value === 'string' ? value : '';
  return (
    sensitive.test(text.replaceAll('_', ' ')) ||
    /\b\d{6}[ -][1-8]\d{6}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\b(?:sk|ghp|github_pat)[-_][A-Za-z0-9_\-]{20,}\b|\b(?:bearer|token)\s*[:= ]\s*[A-Za-z0-9_\-.]{16,}/i.test(
      text,
    )
  );
}

function canonicalHash(value) {
  if (typeof value !== 'string') return null;
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const bytes = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '=');
  return Array.from(bytes, (v) =>
    v.charCodeAt(0).toString(16).padStart(2, '0'),
  ).join('');
}

export function selectMailPhotos({ subject = '', text = '', files = [] } = {}) {
  if (!Array.isArray(files)) throw Error('IMAGE_MANIFEST');
  const selected = [],
    excluded = [],
    review = [],
    hashes = new Set(),
    indexes = new Set();
  const privacy =
    requiresMailPrivacyReview(`${subject}\n${text}`) ||
    files.some((file) => requiresMailPrivacyReview(file?.name));
  let total = 0;
  for (const file of files) {
    if (!/\.(?:jpe?g|png|webp)$/i.test(file?.name || '')) {
      excluded.push({ ...file, reason: 'UNSUPPORTED_IMAGE_TYPE' });
      continue;
    }
    const hash = canonicalHash(file.content_hash);
    if (
      !hash ||
      !Number.isInteger(file.index) ||
      file.index < 0 ||
      !Number.isInteger(file.byte_size) ||
      file.byte_size < 1
    ) {
      review.push({ ...file, reason: 'IMAGE_MANIFEST' });
      continue;
    }
    if (privacy) {
      review.push({ ...file, reason: 'IMAGE_PRIVACY_REVIEW' });
      continue;
    }
    if (hashes.has(hash)) {
      excluded.push({ ...file, reason: 'DUPLICATE_IMAGE' });
      continue;
    }
    if (indexes.has(file.index)) {
      review.push({ ...file, reason: 'IMAGE_MANIFEST' });
      continue;
    }
    indexes.add(file.index);
    hashes.add(hash);
    if (
      file.byte_size > MAIL_PHOTO_LIMITS.perImageBytes ||
      selected.length >= MAIL_PHOTO_LIMITS.count ||
      total + file.byte_size > MAIL_PHOTO_LIMITS.totalBytes
    ) {
      review.push({ ...file, reason: 'IMAGE_LIMIT' });
      continue;
    }
    selected.push({ ...file });
    total += file.byte_size;
  }
  return { selected, excluded, review };
}

export function mailPhotoExclusionReason(file, { width, height }) {
  if (
    width > 0 &&
    height > 0 &&
    width <= 64 &&
    height <= 64 &&
    file.byte_size <= 16000
  )
    return 'TINY_IMAGE';
  if (
    /(?:\blogo\b|(?:^|[_ .-])logo(?:[_ .-]|\d|$)|로고)/i.test(
      file.name || '',
    ) &&
    width > 0 &&
    height > 0 &&
    width <= 1200 &&
    height <= 240 &&
    file.byte_size <= 150000
  )
    return 'LOGO_IMAGE';
  return null;
}

function exifOrientation(bytes, start, end) {
  if (
    end - start < 14 ||
    String.fromCharCode(...bytes.subarray(start, start + 6)) !== 'Exif\0\0'
  )
    return 1;
  const base = start + 6,
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[base] === 0x49 && bytes[base + 1] === 0x49;
  if (!little && !(bytes[base] === 0x4d && bytes[base + 1] === 0x4d)) return 1;
  const u16 = (offset) => {
    if (offset < base || offset + 2 > end) throw Error('IMAGE_FORMAT');
    return view.getUint16(offset, little);
  };
  const u32 = (offset) => {
    if (offset < base || offset + 4 > end) throw Error('IMAGE_FORMAT');
    return view.getUint32(offset, little);
  };
  if (u16(base + 2) !== 42) return 1;
  const directory = base + u32(base + 4),
    count = u16(directory);
  if (directory + 2 + count * 12 > end) throw Error('IMAGE_FORMAT');
  for (let i = 0; i < count; i++) {
    const entry = directory + 2 + i * 12;
    if (u16(entry) === 0x112 && u16(entry + 2) === 3 && u32(entry + 4) === 1) {
      const orientation = u16(entry + 8);
      return orientation >= 1 && orientation <= 8 ? orientation : 1;
    }
  }
  return 1;
}

// Header inspection only: originals are never decoded, transformed, or rewritten.
export function inspectMailImage(input) {
  const bytes =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : null;
  if (!bytes || bytes.length < 12) throw Error('IMAGE_FORMAT');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset, length = 4) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  let mediaType, width, height;
  if (tag(0, 8) === '\x89PNG\r\n\x1a\n') {
    if (bytes.length < 33 || view.getUint32(8) !== 13 || tag(12) !== 'IHDR')
      throw Error('IMAGE_FORMAT');
    mediaType = 'image/png';
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    mediaType = 'image/jpeg';
    let offset = 2,
      orientation = 1,
      scan = false;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) throw Error('IMAGE_FORMAT');
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (!marker || offset + 2 > bytes.length) throw Error('IMAGE_FORMAT');
      const length = view.getUint16(offset),
        end = offset + length;
      if (length < 2 || end > bytes.length) throw Error('IMAGE_FORMAT');
      if (marker === 0xe1)
        orientation = exifOrientation(bytes, offset + 2, end);
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if (length < 11 || length !== 8 + 3 * bytes[offset + 7])
          throw Error('IMAGE_FORMAT');
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
      }
      if (marker === 0xda) {
        scan = true;
        break;
      }
      offset = end;
    }
    if (
      !scan ||
      bytes[bytes.length - 2] !== 0xff ||
      bytes[bytes.length - 1] !== 0xd9
    )
      throw Error('IMAGE_FORMAT');
    if (orientation >= 5) [width, height] = [height, width];
  } else if (tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    if (view.getUint32(4, true) + 8 !== bytes.length)
      throw Error('IMAGE_FORMAT');
    mediaType = 'image/webp';
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = tag(offset),
        length = view.getUint32(offset + 4, true),
        start = offset + 8;
      if (start + length > bytes.length) throw Error('IMAGE_FORMAT');
      if (kind === 'VP8X') {
        if (length !== 10) throw Error('IMAGE_FORMAT');
        width =
          1 +
          bytes[start + 4] +
          (bytes[start + 5] << 8) +
          (bytes[start + 6] << 16);
        height =
          1 +
          bytes[start + 7] +
          (bytes[start + 8] << 8) +
          (bytes[start + 9] << 16);
      } else if (kind === 'VP8 ' && width === undefined) {
        if (length < 10 || tag(start + 3, 3) !== '\x9d\x01\x2a')
          throw Error('IMAGE_FORMAT');
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
      } else if (kind === 'VP8L' && width === undefined) {
        if (length < 5 || bytes[start] !== 0x2f) throw Error('IMAGE_FORMAT');
        const bits = view.getUint32(start + 1, true);
        width = 1 + (bits & 0x3fff);
        height = 1 + ((bits >>> 14) & 0x3fff);
      }
      offset = start + length + (length % 2);
      if (offset > bytes.length) throw Error('IMAGE_FORMAT');
    }
  } else throw Error('IMAGE_FORMAT');
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAIL_PHOTO_LIMITS.maxDimension ||
    height > MAIL_PHOTO_LIMITS.maxDimension
  )
    throw Error('IMAGE_DIMENSIONS');
  return { mediaType, width, height };
}
