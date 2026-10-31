import { isRoutineMail } from './private-mail-work.js';
import PostalMime from 'postal-mime';
import { MAIL_RAW_LIMIT } from './private-mail-limits.js';
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

export const MAIL_IMAGE_KINDS = Object.freeze([
  'business_document',
  'business_scene',
  'signature',
  'business_card',
  'logo',
  'irrelevant',
  'uncertain',
]);

export function selectBriefingImages(analysis) {
  if (
    analysis &&
    isRoutineMail(analysis) &&
    !(analysis.issues?.length || analysis.imageItems?.issues?.length)
  )
    return [];
  const images = analysis?.source?.images,
    decisions = analysis?.imageDecisions;
  if (
    !Array.isArray(images) ||
    images.length > 5 ||
    !Array.isArray(decisions) ||
    decisions.length > 5
  )
    return [];
  const byId = new Map();
  for (const decision of decisions) {
    if (
      typeof decision?.imageId !== 'string' ||
      !decision.imageId ||
      byId.has(decision.imageId) ||
      !MAIL_IMAGE_KINDS.includes(decision.kind) ||
      typeof decision.include !== 'boolean'
    )
      return [];
    byId.set(decision.imageId, decision);
  }
  const ids = new Set();
  for (const image of images) {
    if (
      typeof image?.id !== 'string' ||
      !image.id ||
      ids.has(image.id) ||
      !byId.has(image.id)
    )
      return [];
    ids.add(image.id);
  }
  if (
    decisions.some(
      (decision) =>
        decision.include &&
        ['business_document', 'business_scene'].includes(decision.kind) &&
        !ids.has(decision.imageId),
    )
  )
    return [];
  return images.filter((image) => {
    const decision = byId.get(image.id);
    return (
      decision.include &&
      ['business_document', 'business_scene'].includes(decision.kind)
    );
  });
}

const businessName =
  /사고|파손|불량|누수|현장|제품|상품|화물|적재|상차|하차|온도|운송장|인수증|영수증|거래명세|납품확인|계약서|동의서|확인서|(?:^|[_. -])(?:accident|damage|cargo|product|temperature|receipt|delivery[ _-]?proof|pod)(?:[_. -]|\d|$)/i;
const businessCaption =
  /사고|파손|불량|누수|(?:현장|제품|상품|화물)\s*(?:사진|상태|상황|라벨|증빙|확인)|온도\s*(?:기록|사진|증빙|확인|영수증)|적재|상차|하차|운송장|인수증|거래명세|납품확인|accident|damage|cargo|temperature|delivery[ _-]?proof/i;
const cardName =
  /명함|(?:^|[_. -])(?:business[ _-]?card|name[ _-]?card|vcard)(?:[_. -]|\d|$)/i;
const signatureName =
  /(?:메일|이메일)\s*서명|(?:^|[_. -])(?:signature|email[ _-]?sig(?:nature)?|mail[ _-]?sig(?:nature)?)(?:[_. -]|\d|$)|^서명(?:[_. -]|\d|$)/i;
const logoName = /(?:^|[_. -])(?:logo|brand[ _-]?mark)(?:[_. -]|\d|$)|로고/i;
const decorationName =
  /(?:^|[_. -])(?:icon|spacer|pixel|tracking|beacon|social|facebook|instagram|linkedin|banner|divider|footer|sns)(?:[_. -]|\d|$)|아이콘|구분선/i;
const closing =
  /감사합니다[.!]?|고맙습니다[.!]?|(?:best\s+)?regards[,.]?|sincerely[,.]?|thank\s+you[,.]?|[가-힣A-Za-z]{2,20}\s+(?:드림|올림)/gi;
const contact =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:\+82[- .]?\d{1,2}|0\d{1,2})[- .)]?\d{3,4}[- .]?\d{4}/i;
const plainHtml = (value) =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');
function cid(value) {
  if (typeof value !== 'string') return '';
  try {
    value = decodeURIComponent(value);
  } catch {}
  return value.replace(/^cid:/i, '').replace(/^<|>$/g, '').trim().toLowerCase();
}
function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(
    /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  ))
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
  return result;
}
function imagePositions(input) {
  // Context only; no HTML is rendered and no image URL is requested.
  const html =
    typeof input === 'string'
      ? input
          .slice(0, 300000)
          .replace(
            /<(script|style|head|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi,
            (value) => ' '.repeat(value.length),
          )
      : '';
  const stack = [],
    images = [],
    voids = new Set([
      'area',
      'base',
      'br',
      'col',
      'embed',
      'hr',
      'img',
      'input',
      'link',
      'meta',
      'param',
      'source',
      'track',
      'wbr',
    ]);
  for (const match of html.matchAll(/<\/?([A-Za-z][\w:-]*)\b[^>]{0,16000}>/g)) {
    const name = match[1].toLowerCase(),
      tag = match[0];
    if (tag.startsWith('</')) {
      const index = stack.findLastIndex((entry) => entry.name === name);
      if (index >= 0) stack.splice(index);
      continue;
    }
    const attrs = attributes(tag),
      signature =
        [attrs.id, attrs.class, attrs['data-smartmail']].some((value) =>
          /(?:^|[\s_-])(?:gmail_signature|moz-signature|(?:mail|email)[_-]?signature|signature)(?:[\s_-]|$)/i.test(
            value ?? '',
          ),
        ) || Object.hasOwn(attrs, 'data-mso-signature');
    if (name === 'img')
      images.push({
        src: attrs.src ?? '',
        position: match.index,
        width: Number(attrs.width),
        height: Number(attrs.height),
        signature: signature || stack.some((entry) => entry.signature),
        signatureStart: signature
          ? match.index
          : stack.filter((entry) => entry.signature).at(-1)?.position,
      });
    if (!voids.has(name) && !/\/\s*>$/.test(tag) && stack.length < 128)
      stack.push({ name, signature, position: match.index });
  }
  return { html, images };
}
function photoReason(file, info = {}, context = {}) {
  const name = file.name ?? file.original_name ?? '';
  if (cardName.test(name)) return 'BUSINESS_CARD_IMAGE';
  const { html, images } = context.positions ?? imagePositions(context.html);
  const contentId = cid(file.contentId ?? file.content_id ?? file.cid),
    filename = cid(name.split(/[\\/]/).at(-1));
  const refs = images.filter(
    (image) =>
      /^cid:/i.test(image.src) &&
      (contentId
        ? cid(image.src) === contentId
        : cid(image.src) === filename ||
          cid(image.src).split('@')[0] === filename),
  );
  const fileHash = canonicalHash(file.content_hash);
  const repeated =
    !!fileHash &&
    Array.isArray(context.repeatedHashes) &&
    context.repeatedHashes.some((value) => canonicalHash(value) === fileHash);
  const inline =
    refs.length > 0 ||
    file.inline === true ||
    file.isInline === true ||
    file.disposition === 'inline';
  let footer = false,
    caption = false,
    displaySmall = false;
  for (const ref of refs) {
    const before = plainHtml(
      html.slice(
        Math.max(0, ref.position - 3000, ref.signatureStart ?? 0),
        ref.position,
      ),
    );
    const endings = [...before.matchAll(closing)],
      last = endings.at(-1);
    const afterClosing = last
      ? before.slice(last.index + last[0].length)
      : before.slice(-500);
    caption ||= businessCaption.test(afterClosing);
    footer ||= !!last && contact.test(before.slice(-1200));
    displaySmall ||=
      ref.width > 0 && ref.height > 0 && ref.width <= 1600 && ref.height <= 400;
  }
  if (caption) return null;
  if (signatureName.test(name) || refs.some((ref) => ref.signature))
    return 'SIGNATURE_IMAGE';
  if (businessName.test(name)) return null;
  const { width, height } = info;
  const small =
    width > 0 &&
    height > 0 &&
    width <= 1600 &&
    height <= 400 &&
    file.byte_size <= 350000;
  if (
    width > 0 &&
    height > 0 &&
    width <= 64 &&
    height <= 64 &&
    file.byte_size <= 16000
  )
    return 'TINY_IMAGE';
  if (logoName.test(name) && file.byte_size <= 150000 && (small || inline))
    return 'LOGO_IMAGE';
  if (businessName.test(`${context.subject ?? ''}\n${context.text ?? ''}`))
    return null;
  if (
    footer &&
    inline &&
    (small ||
      (displaySmall && file.byte_size <= 350000) ||
      repeated ||
      decorationName.test(name))
  )
    return 'SIGNATURE_IMAGE';
  if (decorationName.test(name) && inline && (small || displaySmall))
    return 'DECORATIVE_IMAGE';
  if (repeated && inline && (small || displaySmall))
    return 'REPEATED_DECORATION';
  return null;
}

function possiblePhoto(file) {
  const name = file.name ?? file.original_name ?? '';
  return (
    file.kind === 'attachment' &&
    (/\.(?:jpe?g|png|webp)$/i.test(name) ||
      !/\.[^.]{1,10}$/.test(name) ||
      /^image\/(?:jpeg|png|webp)$/.test(file.mediaType ?? ''))
  );
}
export function needsMailPhotoMetadata(files, html) {
  if (!files.some(possiblePhoto)) return false;
  if (
    files.some(
      (file) =>
        possiblePhoto(file) &&
        !/\.(?:jpe?g|png|webp)$/i.test(file.name ?? file.original_name ?? '') &&
        !file.mediaType,
    )
  )
    return true;
  return imagePositions(html).images.some(
    (image) =>
      /^cid:/i.test(image.src) &&
      !files.some((file) => {
        const id = cid(file.contentId ?? file.content_id ?? file.cid);
        const name = cid(
          (file.name ?? file.original_name ?? '').split(/[\\/]/).at(-1),
        );
        return id
          ? cid(image.src) === id
          : cid(image.src) === name || cid(image.src).split('@')[0] === name;
      }),
  );
}
export async function recoverMailPhotoMetadata(files, raw) {
  if (
    !(raw instanceof Uint8Array) ||
    !raw.byteLength ||
    raw.byteLength > MAIL_RAW_LIMIT
  )
    throw Error('IMAGE_CONTEXT_REVIEW');
  let parsed;
  try {
    const input =
      raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength
        ? raw.buffer
        : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    parsed = await PostalMime.parse(input, {
      forceRfc822Attachments: true,
      maxNestingDepth: 20,
      maxPartCount: 60,
      maxHeadersSize: 65536,
      maxForwardedAddresses: 50,
      maxRfc822NestingDepth: 0,
    });
  } catch {
    throw Error('IMAGE_CONTEXT_REVIEW');
  }
  parsed.text = undefined;
  parsed.html = undefined;
  const wanted = new Set(
    files.filter(possiblePhoto).map((file) => file.byte_size),
  );
  const metadata = new Map();
  for (const attachment of parsed.attachments ?? []) {
    const content = attachment.content;
    attachment.content = undefined;
    const data =
      content instanceof ArrayBuffer
        ? new Uint8Array(content)
        : ArrayBuffer.isView(content)
          ? new Uint8Array(
              content.buffer,
              content.byteOffset,
              content.byteLength,
            )
          : null;
    if (!data || !wanted.has(data.byteLength)) continue;
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
    ]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    const key = hash + ':' + data.byteLength;
    const entry = {
      contentId: attachment.contentId ?? null,
      disposition: attachment.disposition ?? null,
      mediaType: attachment.mimeType,
    };
    const values = metadata.get(key) ?? [];
    if (
      !values.some((value) => JSON.stringify(value) === JSON.stringify(entry))
    )
      values.push(entry);
    metadata.set(key, values);
  }
  return files.map((file) => {
    if (!possiblePhoto(file)) return file;
    const matches =
      metadata.get(canonicalHash(file.content_hash) + ':' + file.byte_size) ??
      [];
    if (matches.length !== 1) throw Error('IMAGE_CONTEXT_REVIEW');
    return { ...file, ...matches[0] };
  });
}

export function selectMailPhotos({
  subject = '',
  text = '',
  html = '',
  files = [],
  repeatedHashes = [],
} = {}) {
  if (!Array.isArray(files)) throw Error('IMAGE_MANIFEST');
  const selected = [],
    excluded = [],
    review = [],
    hashes = new Set(),
    indexes = new Set();
  const privacy =
    requiresMailPrivacyReview(`${subject}\n${text}`) ||
    files.some((file) => requiresMailPrivacyReview(file?.name));
  const context = {
    subject,
    text,
    html,
    repeatedHashes: Array.isArray(repeatedHashes) ? repeatedHashes : [],
    positions: imagePositions(html),
  };
  let total = 0;
  for (const file of files) {
    if (
      !/\.(?:jpe?g|png|webp)$/i.test(file?.name || '') &&
      !/^image\/(?:jpeg|png|webp)$/.test(file?.mediaType ?? '')
    ) {
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
    const reason = photoReason(file, file, context);
    if (reason) {
      excluded.push({ ...file, reason });
      continue;
    }
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

export function mailPhotoExclusionReason(file, info, context = {}) {
  return photoReason(file, info, context);
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
