import { inspectMailImage } from './private-mail-images.js';
const attr = (tag, name) =>
  new RegExp(
    '(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))',
    'i',
  )
    .exec(tag)
    ?.slice(1)
    .find((v) => v != null) ?? '';
function safeUrl(value) {
  try {
    const url = new URL(value.replaceAll('&amp;', '&'));
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.hostname.endsWith('.') ||
      !/^[a-z][a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
    )
      return null;
    if (
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(
        url.hostname,
      ) ||
      /(?:^|\.)(?:nip\.io|sslip\.io|localtest\.me)$/.test(url.hostname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function remoteMailImageManifest(html) {
  if (typeof html !== 'string' || html.length > 2 * 1024 * 1024)
    throw Error('BODY_LIMIT');
  const content = [],
    excluded = [],
    seen = new Set();
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const raw = attr(tag, 'src'),
      style = attr(tag, 'style');
    const tiny =
      ['width', 'height'].some((name) => {
        const value = attr(tag, name);
        return (
          value !== '' && /^\d+(?:px)?$/i.test(value) && parseInt(value) <= 2
        );
      }) || /(?:width|height)\s*:\s*[012](?:px)?(?:\s*;|\s*$)/i.test(style);
    if (
      tiny ||
      /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style) ||
      /(?:pixel|tracking|beacon)(?:[/?_.-]|$)/i.test(raw)
    ) {
      excluded.push({ reason: 'tracking_or_hidden' });
      continue;
    }
    const url = safeUrl(raw);
    if (
      !url ||
      /(?:signature|business[-_ ]?card|logo)/i.test(
        attr(tag, 'alt') + ' ' + raw,
      )
    ) {
      excluded.push({ reason: 'unapproved_or_decorative' });
      continue;
    }
    if (!seen.has(url)) {
      seen.add(url);
      content.push({ url });
    }
    if (content.length > 5) throw Error('IMAGE_LIMIT');
  }
  return { content, excluded };
}
export async function loadApprovedRemoteMailImages({
  html,
  approvedUrls,
  sourceId,
  fetcher,
}) {
  const manifest = remoteMailImageManifest(html);
  if (!manifest.content.length) return [];
  const approved = new Set(
    (approvedUrls ?? []).map((value) => safeUrl(value)).filter(Boolean),
  );
  if (manifest.content.some((item) => !approved.has(item.url)))
    throw Error('REMOTE_IMAGE_REVIEW');
  // The caller must supply a transport that pins public destination addresses.
  // Edge fetch alone cannot guarantee that an approved hostname resolves publicly.
  if (typeof fetcher !== 'function') throw Error('REMOTE_IMAGE_REVIEW');
  const images = [];
  let total = 0;
  for (const [index, item] of manifest.content.entries()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(item.url, {
        sourceId,
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: { Accept: 'image/png,image/jpeg,image/webp' },
      });
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (
        !response.ok ||
        response.redirected ||
        !response.body ||
        declared > 2100000 ||
        !/^image\/(?:png|jpeg|webp)(?:;|$)/i.test(
          response.headers.get('content-type') ?? '',
        )
      )
        throw Error('REMOTE_IMAGE_SOURCE');
      const parts = [];
      let length = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > 2100000 || total + length > 4000000)
            throw Error('IMAGE_LIMIT');
          parts.push(next.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      const info = inspectMailImage(bytes);
      if (info.width <= 2 || info.height <= 2)
        throw Error('REMOTE_IMAGE_SOURCE');
      const contentHash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (v) => v.toString(16).padStart(2, '0'),
      ).join('');
      if (images.some((image) => image.contentHash === contentHash)) continue;
      total += length;
      images.push({
        id: sourceId + ':' + index,
        name: '메일 본문 이미지 ' + (index + 1),
        remoteUrl: item.url,
        contentHash,
        bytes,
        ...info,
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return images;
}
