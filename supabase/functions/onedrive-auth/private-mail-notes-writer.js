import {
  BRIEFING_TARGET,
  renderDailyBriefing,
  selectDailyPage,
} from './private-mail-briefing-model.js';
import { inspectBriefingTarget } from './private-mail-briefing.js';

const enc = encodeURIComponent;
const hex = /^[0-9a-f]{64}$/;
const blockContainers = new Set([
  'html',
  'head',
  'body',
  'div',
  'ul',
  'ol',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
]);
const voidTags = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(
    ' ',
  ),
);
const decode = (value) =>
  value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (raw, key) => {
      if (key[0] !== '#')
        return {
          amp: '&',
          lt: '<',
          gt: '>',
          quot: '"',
          apos: "'",
          nbsp: '\u00a0',
        }[key.toLowerCase()];
      const number =
        key[1].toLowerCase() === 'x'
          ? parseInt(key.slice(2), 16)
          : Number(key.slice(1));
      return number > 0 &&
        number <= 0x10ffff &&
        !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number)
        : raw;
    },
  );

// Deliberately accepts bounded, well-formed OneNote HTML, never repairs malformed markup.
function scanHtml(html) {
  if (
    typeof html !== 'string' ||
    new TextEncoder().encode(html).length > 2 * 1024 * 1024
  )
    throw Error('PAGE_HTML_LIMIT');
  const root = { children: [] },
    stack = [root],
    nodes = [];
  let offset = 0;
  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    const endText = start === -1 ? html.length : start;
    const value = decode(html.slice(offset, endText).replaceAll('\r\n', '\n'));
    if (value && (value.trim() || !blockContainers.has(stack.at(-1).tag)))
      stack.at(-1).children.push(value);
    if (start === -1) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end === -1) throw Error('PAGE_HTML_FORMAT');
      // Comments within the managed region are part of its conflict fingerprint.
      stack.at(-1).children.push({ comment: html.slice(start + 4, end) });
      offset = end + 3;
      continue;
    }
    if (/^<!doctype\s/i.test(html.slice(start, start + 12))) {
      const end = html.indexOf('>', start);
      if (end === -1) throw Error('PAGE_HTML_FORMAT');
      offset = end + 1;
      continue;
    }
    let end = start + 1,
      quote = null;
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === html.length || quote) throw Error('PAGE_HTML_FORMAT');
    const token = html.slice(start + 1, end);
    if (token[0] === '/') {
      const tag = token.slice(1).trim().toLowerCase();
      if (
        !/^[a-z][a-z0-9:-]*$/.test(tag) ||
        stack.length === 1 ||
        stack.at(-1).tag !== tag
      )
        throw Error('PAGE_HTML_FORMAT');
      stack.pop();
    } else {
      const match = /^([a-z][a-z0-9:-]*)([\s\S]*)$/i.exec(token);
      if (!match) throw Error('PAGE_HTML_FORMAT');
      const tag = match[1].toLowerCase(),
        attrs = Object.create(null);
      let rest = match[2];
      const selfClosing = /\/\s*$/.test(rest);
      if (selfClosing) rest = rest.replace(/\/\s*$/, '');
      let attributeCount = 0;
      while (rest.trim()) {
        if (++attributeCount > 200) throw Error('PAGE_HTML_LIMIT');
        const attr =
          /^\s+([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>"'=]+)))?/.exec(
            rest,
          );
        if (!attr) throw Error('PAGE_HTML_FORMAT');
        const key = attr[1].toLowerCase();
        if (Object.hasOwn(attrs, key)) throw Error('PAGE_HTML_FORMAT');
        attrs[key] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
        rest = rest.slice(attr[0].length);
      }
      const node = {
        tag,
        attrs,
        children: [],
        parent: stack.at(-1),
      };
      stack.at(-1).children.push(node);
      nodes.push(node);
      if (nodes.length > 30000 || stack.length > 100)
        throw Error('PAGE_HTML_LIMIT');
      if (!voidTags.has(tag) && !selfClosing) stack.push(node);
    }
    offset = end + 1;
  }
  if (stack.length !== 1) throw Error('PAGE_HTML_FORMAT');
  return { nodes };
}
function canonical(node, contentOnly = false) {
  if (typeof node === 'string') return node;
  if (Object.hasOwn(node, 'comment')) return ['comment', node.comment];
  return [
    node.tag,
    Object.entries(node.attrs)
      .filter(
        ([key]) =>
          key !== 'id' && (!contentOnly || ['data-id', 'href'].includes(key)),
      )
      .sort(([a], [b]) => a.localeCompare(b)),
    node.children.map((child) => canonical(child, contentOnly)),
  ];
}
function contentSignature(node) {
  const blocks = [];
  let value = '',
    links = [],
    images = [];
  const flush = (tag = 'p') => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (text || links.length || images.length)
      blocks.push({ tag, text, links, images });
    value = '';
    links = [];
    images = [];
  };
  const plain = (node) =>
    typeof node === 'string' ? node : (node.children ?? []).map(plain).join('');
  const visit = (node) => {
    if (typeof node === 'string') {
      value += node;
      return;
    }
    if (Object.hasOwn(node, 'comment')) {
      value += '[comment:' + node.comment + ']';
      return;
    }
    if (node.attrs['data-id']?.startsWith('sajo-mail-photos-')) return;
    if (node.tag === 'img') {
      images.push({ id: node.attrs['data-id'], alt: node.attrs.alt ?? '' });
      return;
    }
    if (node.tag === 'br') {
      value += ' ';
      return;
    }
    if (node.tag === 'a') {
      const href = node.attrs.href ?? '';
      if (!(href.startsWith('mailto:') && href.slice(7) === plain(node)))
        links.push(href);
    }
    const block = ['p', 'li', 'blockquote', 'h1', 'h2', 'h3'].includes(
      node.tag,
    );
    if (block) flush();
    for (const child of node.children ?? []) visit(child);
    if (block) flush(/^h[1-3]$/.test(node.tag) ? node.tag : 'p');
  };
  visit(node);
  flush();
  return blocks;
}
async function snapshot({ html, marker, hash }) {
  const { nodes } = scanHtml(html);
  const bodies = nodes.filter((node) => node.tag === 'body');
  if (bodies.length !== 1) throw Error('PAGE_HTML_FORMAT');
  const matches = nodes.filter((node) => node.attrs['data-id'] === marker);
  const tagged = nodes.filter((node) =>
    node.attrs['data-id']?.startsWith(marker + '-block-'),
  );
  const tables = matches.filter((node) => node.tag === 'table');
  if (tables.length > 1) throw Error('PAGE_MANAGED_AMBIGUOUS');
  let regions = [];
  if (tables.length) {
    regions = tables;
  } else if (tagged.length) {
    const start = nodes.indexOf(tagged[0]);
    const last = nodes.indexOf(tagged.at(-1));
    const manual = nodes.findIndex(
      (node, index) =>
        index > start && node.attrs['data-id'] === 'sajo-mail-manual',
    );
    regions = nodes.slice(start, manual > start ? manual : last + 1);
  } else if (matches.length === 1) {
    if (matches[0].parent.tag !== 'div') throw Error('PAGE_MANAGED_TARGET');
    regions = nodes.filter((node) => isDescendant(node, matches[0]));
  } else if (matches.length > 1) {
    const parent = matches[0].parent;
    const start = nodes.indexOf(matches[0]);
    const end = nodes.findIndex(
      (node, index) =>
        index > start && node.attrs['data-id'] === 'sajo-mail-manual',
    );
    if (matches.some((node) => node.parent !== parent) || end < start)
      throw Error('PAGE_MANAGED_AMBIGUOUS');
    regions = nodes.slice(start, end);
  }
  const native = new Set([
    'p',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'img',
    'table',
    'ul',
    'ol',
  ]);
  const regionSet = new Set(regions);
  const managedTargets = regions.filter((node) => {
    if (!native.has(node.tag)) return false;
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.attrs?.['data-id'] === 'sajo-mail-manual') return false;
      if (regionSet.has(parent) && native.has(parent.tag)) return false;
    }
    return true;
  });
  const managed = managedTargets.length
    ? {
        tag: 'div',
        attrs: { 'data-id': marker, id: managedTargets[0].attrs.id },
        parent: managedTargets[0].parent,
        regions: managedTargets,
        children: managedTargets,
      }
    : null;
  if (managed) {
    let inBody = false;
    for (let parent = managed.parent; parent; parent = parent.parent)
      if (parent === bodies[0]) inBody = true;
    if (
      !inBody ||
      managedTargets.some(
        (target) =>
          target.attrs.id &&
          nodes.filter((node) => node.attrs.id === target.attrs.id).length !==
            1,
      )
    )
      throw Error('PAGE_MANAGED_TARGET');
    for (const node of regions)
      if (node.attrs['data-id'] === 'sajo-mail-manual')
        throw Error('PAGE_MANAGED_TARGET');
  }
  const managedHash = managed
    ? await hash(JSON.stringify(canonical(managed)))
    : null;
  if (managedHash !== null && !hex.test(managedHash))
    throw Error('PAGE_CONTENT_HASH');
  return { managedHash, managed, managedTargets, nodes };
}
function normalizePage(page) {
  if (!page || typeof page.id !== 'string' || !page.id || page.id.length > 1000)
    throw Error('PAGE_IDENTITY');
  return {
    id: page.id,
    title: page.title,
    parent_section: { id: page.parentSection?.id },
  };
}
async function listPages({ graph, access, title }) {
  const path =
    '/me/onenote/sections/' + enc(BRIEFING_TARGET.sectionId) + '/pages';
  const filter = "title eq '" + title.replaceAll("'", "''") + "'";
  const pages = [],
    ids = new Set();
  let skip = 0;
  for (let batch = 0; batch < 50; batch++) {
    const query = new URLSearchParams({
      $filter: filter,
      $select: 'id,title',
      $expand: 'parentSection($select=id)',
      $top: '100',
      $skip: String(skip),
    });
    const response = await graph(path + '?' + query, access);
    const data = await response.json();
    if (!Array.isArray(data.value) || data.value.length > 100)
      throw Error('PAGE_LIST_INCOMPLETE');
    for (const raw of data.value) {
      const page = normalizePage(raw);
      if (ids.has(page.id)) throw Error('PAGE_LIST_INCOMPLETE');
      ids.add(page.id);
      pages.push(page);
    }
    const next = data['@odata.nextLink'];
    if (next == null) return pages;
    // Read only the numeric continuation; construct every subsequent URL ourselves.
    let link;
    try {
      link = new URL(next);
    } catch {
      throw Error('PAGE_LIST_INCOMPLETE');
    }
    const nextSkip = link.searchParams.get('$skip');
    if (
      link.origin !== 'https://graph.microsoft.com' ||
      decodeURIComponent(link.pathname) !==
        '/v1.0' + decodeURIComponent(path) ||
      !/^\d+$/.test(nextSkip ?? '') ||
      Number(nextSkip) !== skip + data.value.length ||
      Number(nextSkip) <= skip ||
      link.searchParams.has('$skiptoken')
    )
      throw Error('PAGE_LIST_INCOMPLETE');
    skip = Number(nextSkip);
  }
  throw Error('PAGE_LIST_INCOMPLETE');
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const imageBatchBytes = 3 * 1024 * 1024;
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
function describeImages(images, sourceIds) {
  if (!Array.isArray(images) || images.length > 150)
    throw Error('NOTES_IMAGE_LIMIT');
  const ids = new Set();
  return images
    .map((image) => {
      if (
        !image ||
        !uuid.test(image.sourceId ?? '') ||
        !sourceIds.includes(image.sourceId) ||
        typeof image.id !== 'string' ||
        !image.id.startsWith(image.sourceId + ':') ||
        !/^(?:0|[1-4]?\d)$/.test(image.id.slice(image.sourceId.length + 1)) ||
        ids.has(image.id)
      )
        throw Error('NOTES_IMAGE_SOURCE');
      ids.add(image.id);
      if (!['image/png', 'image/jpeg'].includes(image.mediaType))
        throw Error('NOTES_IMAGE_TYPE_UNSUPPORTED');
      if (
        typeof image.name !== 'string' ||
        !image.name.trim() ||
        image.name.length > 500 ||
        !hex.test(image.contentHash ?? '')
      )
        throw Error('NOTES_IMAGE_HASH');
      if (
        ![image.width, image.height].every(
          (n) => Number.isSafeInteger(n) && n > 0 && n <= 100000,
        ) ||
        image.width * image.height > 200000000
      )
        throw Error('NOTES_IMAGE_DIMENSIONS');
      const expectedUrl =
        'https://sajoansan.vercel.app/portal/?view=mail&message=' +
        image.sourceId;
      if (image.sourceUrl !== expectedUrl) throw Error('NOTES_IMAGE_SOURCE');
      const byteSize =
        image.bytes instanceof Uint8Array
          ? image.bytes.byteLength
          : image.byteSize;
      if (
        byteSize != null &&
        (!Number.isSafeInteger(byteSize) ||
          byteSize < 1 ||
          byteSize > imageBatchBytes)
      )
        throw Error('NOTES_IMAGE_LIMIT');
      const index = Number(image.id.slice(image.sourceId.length + 1));
      return {
        ...image,
        byteSize,
        index,
        part:
          'sajo-image-' +
          image.sourceId +
          '-' +
          index +
          '-' +
          image.contentHash,
      };
    })
    .sort(
      (a, b) =>
        sourceIds.indexOf(a.sourceId) - sourceIds.indexOf(b.sourceId) ||
        a.index - b.index,
    );
}
function imageHtml(image) {
  const width = Math.min(1000, image.width),
    height = (image.height * width) / image.width;
  return (
    '<p><a href="' +
    escape(image.sourceUrl) +
    '">원본 첨부: ' +
    escape(image.name) +
    ' (첨부 ' +
    (image.index + 1) +
    ')</a></p>' +
    '<p><img data-id="' +
    image.part +
    '" src="name:' +
    image.part +
    '" alt="' +
    escape(image.name) +
    '" width="' +
    width +
    '" height="' +
    height +
    '" /></p>'
  );
}
function photoReport(base, images, count) {
  const sources = new Set(images.map((image) => image.sourceId));
  let managedHtml = base.managedHtml.replace(
    /<div data-id="sajo-mail-photos-([0-9a-f-]+)"><\/div>/g,
    (_hook, sourceId) =>
      sources.has(sourceId)
        ? '<p data-id="sajo-mail-photos-' + sourceId + '">첨부사진</p>'
        : '',
  );
  let blockIndex = 0;
  managedHtml = managedHtml.replace(
    /<(p|h[1-6])(\s[^>]*?)?>/g,
    (open, tag, attrs = '') =>
      /\sdata-id=/.test(attrs)
        ? open
        : '<' +
          tag +
          ' data-id="sajo-mail-daily-' +
          base.day +
          '-block-' +
          blockIndex++ +
          '"' +
          attrs +
          '>',
  );
  const groups = new Map();
  for (const image of images.slice(0, count))
    groups.set(
      image.sourceId,
      (groups.get(image.sourceId) ?? '') + imageHtml(image),
    );
  for (const [sourceId, content] of groups) {
    const hook = '<p data-id="sajo-mail-photos-' + sourceId + '">첨부사진</p>';
    const at = managedHtml.indexOf(hook);
    if (at < 0 || managedHtml.indexOf(hook, at + hook.length) !== -1)
      throw Error('NOTES_IMAGE_SOURCE');
    managedHtml =
      managedHtml.slice(0, at) +
      content +
      hook +
      managedHtml.slice(at + hook.length);
  }
  managedHtml = managedHtml
    .replace(
      /^<div([^>]*)>/,
      '<table$1 style="border:0;border-collapse:collapse"><tr><td style="border:0">',
    )
    .replace(/<\/div>$/, '</td></tr></table>');
  return {
    ...base,
    managedHtml,
    html: base.html.replace(base.managedHtml, managedHtml),
  };
}
async function validateImageBytes(image, hash) {
  const bytes = image.bytes;
  if (
    !(bytes instanceof Uint8Array) ||
    !bytes.byteLength ||
    bytes.byteLength > imageBatchBytes ||
    (image.byteSize != null && bytes.byteLength !== image.byteSize)
  )
    throw Error('NOTES_IMAGE_LIMIT');
  const valid =
    image.mediaType === 'image/png'
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) throw Error('NOTES_IMAGE_TYPE_UNSUPPORTED');
  if ((await hash(bytes)) !== image.contentHash)
    throw Error('NOTES_IMAGE_HASH');
}
async function imageBatch(images, start, loadImage, hash) {
  const batch = [];
  let total = 0;
  for (const descriptor of images.slice(start, start + 5)) {
    if (
      batch.length &&
      (descriptor.byteSize == null ||
        total + descriptor.byteSize > imageBatchBytes)
    )
      break;
    let image = descriptor;
    if (!(image.bytes instanceof Uint8Array)) {
      if (typeof loadImage !== 'function') throw Error('NOTES_IMAGE_SOURCE');
      const loaded = await loadImage(descriptor);
      if (
        !loaded ||
        [
          'id',
          'sourceId',
          'name',
          'mediaType',
          'width',
          'height',
          'contentHash',
          'sourceUrl',
        ].some((key) => loaded[key] !== descriptor[key])
      )
        throw Error('NOTES_IMAGE_SOURCE');
      image = { ...descriptor, bytes: loaded.bytes };
    }
    await validateImageBytes(image, hash);
    total += image.bytes.byteLength;
    if (total > imageBatchBytes) throw Error('NOTES_IMAGE_LIMIT');
    batch.push(image);
    if (descriptor.byteSize == null) break;
  }
  return batch;
}
function multipartCommands(commands, images) {
  const body = new FormData();
  body.append(
    'Commands',
    new Blob([JSON.stringify(commands)], { type: 'application/json' }),
  );
  for (const image of images)
    body.append(image.part, new Blob([image.bytes], { type: image.mediaType }));
  return body;
}
function isDescendant(node, ancestor) {
  if (ancestor.regions?.includes(node)) return true;
  for (let parent = node.parent; parent; parent = parent.parent)
    if (parent === ancestor || ancestor.regions?.includes(parent)) return true;
  return false;
}
function fragmentChanges(html, targets) {
  if (
    targets.some(
      (target) => typeof target.attrs.id !== 'string' || !target.attrs.id,
    )
  )
    throw Error('PAGE_MANAGED_TARGET');
  const root = scanHtml(html).nodes[0];
  if (root.tag === 'table')
    return targets.map((target, index) => ({
      target: target.attrs.id,
      action: 'replace',
      content:
        index === 0
          ? html
          : '<p data-id="sajo-mail-retired-' +
            index +
            '" style="font-size:1pt;margin-top:0;margin-bottom:0">&#8203;</p>',
    }));

  const serialize = (node) =>
    typeof node === 'string'
      ? escape(node)
      : '<' +
        node.tag +
        Object.entries(node.attrs)
          .map(([key, value]) => ' ' + key + '="' + escape(value) + '"')
          .join('') +
        '>' +
        (node.children ?? []).map(serialize).join('') +
        (voidTags.has(node.tag) ? '' : '</' + node.tag + '>');
  const children = root.children.filter(
    (node) => typeof node !== 'string' || node.trim(),
  );
  return targets.map((target, index) => {
    const start = Math.floor((index * children.length) / targets.length);
    const end = Math.floor(((index + 1) * children.length) / targets.length);
    return {
      target: target.attrs.id,
      action: 'replace',
      content:
        children.slice(start, end).map(serialize).join('') ||
        '<p data-id="' +
          escape(root.attrs['data-id']) +
          '-block-empty-' +
          index +
          '"></p>',
    };
  });
}

export async function writeDailyBriefing({
  now,
  analyses,
  overrides = {},
  images = [],
  loadImage,
  maxImageBatches = 2,
  deadline = Infinity,
  store,
  connected,
  graph,
  hash,
}) {
  if (
    !Number.isSafeInteger(maxImageBatches) ||
    maxImageBatches < 1 ||
    maxImageBatches > 10 ||
    (deadline !== Infinity && !Number.isFinite(deadline))
  )
    throw Error('NOTES_IMAGE_LIMIT');
  const base = renderDailyBriefing({ now, analyses, overrides });
  const photos = describeImages(images, base.sourceIds);
  for (const image of photos)
    if (image.bytes instanceof Uint8Array)
      await validateImageBytes(image, hash);
  const finalReport = photoReport(base, photos, photos.length);
  const finalFingerprint = await hash(finalReport.managedHtml);
  const claimed = await store.claim(base.day);
  if (!claimed) return { status: 'busy', day: base.day };
  const { lease } = claimed;
  let state = claimed.state ?? {};
  const save = async (value) => {
    await store.save({ day: base.day, lease, value });
    state = { ...state, ...value };
  };
  const rejectPatch = async (error) => {
    const status =
      error?.providerStatus ?? (error?.status === 429 ? 429 : null);
    if ([403, 412, 429].includes(status)) {
      // These responses reject the request before execution; retain its acknowledged baseline.
      await save({ pendingWrite: null });
      const code = {
        403: 'NOTES_PERMISSION_REQUIRED',
        412: 'PAGE_PRECONDITION_FAILED',
        429: 'NOTES_RATE_LIMITED',
      }[status];
      throw Object.assign(Error(code), { providerStatus: status });
    }
    throw Object.assign(Error('PAGE_WRITE_UNCERTAIN'), {
      providerStatus: status ?? null,
    });
  };
  try {
    const connection = await connected();
    const target = await inspectBriefingTarget({
      connected: async () => connection,
      graph,
    });
    if (!target.readable) throw Error(target.reason);
    if (connection.notesGranted !== true)
      throw Error('NOTES_PERMISSION_REQUIRED');
    if (
      state.pageId != null &&
      (typeof state.pageId !== 'string' || !state.pageId)
    )
      throw Error('PAGE_IDENTITY');
    if (state.managedHash != null && !hex.test(state.managedHash))
      throw Error('PAGE_CONTENT_HASH');
    if (!hex.test(finalFingerprint)) throw Error('PAGE_CONTENT_HASH');
    const access = connection.accessToken,
      marker = 'sajo-mail-daily-' + base.day;
    const stage = async (count) => {
      const report = photoReport(base, photos, count),
        node = scanHtml(report.managedHtml).nodes[0];
      return {
        report,
        desiredHash: await hash(JSON.stringify(canonical(node))),
        content: JSON.stringify(contentSignature(node)),
        contentHash: await hash(JSON.stringify(contentSignature(node))),
        fingerprint: await hash(report.managedHtml),
        imageProgress:
          count < photos.length
            ? { fingerprint: finalFingerprint, next: count }
            : null,
      };
    };
    const initial = await stage(0);
    const pending = (desired, previousHash, operation = 'replace') => ({
      operation,
      fingerprint: desired.fingerprint,
      desiredHash: desired.desiredHash,
      contentHash: desired.contentHash,
      previousHash,
      imageProgress: desired.imageProgress,
    });
    let pages = await listPages({ graph, access, title: base.title });
    let selection = selectDailyPage({
      identity: base,
      pages,
      savedPageId: state.pageId ?? null,
      pagesComplete: true,
    });
    let status = 'updated',
      created = false;
    if (selection.kind === 'create') {
      if (state.createAttempted) throw Error('PAGE_CREATE_UNCERTAIN');
      await save({
        createAttempted: true,
        pendingWrite: pending(initial, null),
      });
      const html = initial.report.html
        .replace('<body>', '<body><div>')
        .replace('</body>', '</div></body>');
      let result;
      try {
        result = await (
          await graph(
            '/me/onenote/sections/' + enc(BRIEFING_TARGET.sectionId) + '/pages',
            access,
            {
              method: 'POST',
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
              body: html,
            },
          )
        ).json();
      } catch {
        throw Error('PAGE_CREATE_UNCERTAIN');
      }
      if (typeof result?.id !== 'string' || !result.id)
        throw Error('PAGE_CREATE_UNCERTAIN');
      pages = await listPages({ graph, access, title: base.title });
      selection = selectDailyPage({
        identity: base,
        pages,
        savedPageId: result.id,
        pagesComplete: true,
      });
      await save({ pageId: selection.pageId });
      created = true;
      status = 'created';
    } else if (
      state.pageId == null &&
      state.createAttempted &&
      !state.pendingWrite
    )
      throw Error('PAGE_CREATE_UNCERTAIN');
    const pageId = selection.pageId,
      contentPath = '/me/onenote/pages/' + enc(pageId) + '/content';
    const read = async () => {
      const response = await graph(contentPath + '?includeIDs=true', access);
      return {
        ...(await snapshot({ html: await response.text(), marker, hash })),
        etag: response.headers.get('ETag'),
      };
    };
    let current = await read();
    const verifyAndSave = async (desired) => {
      if (
        !current.managed ||
        JSON.stringify(contentSignature(current.managed)) !== desired.content
      )
        throw Error('PAGE_WRITE_UNCERTAIN');
      for (const node of current.nodes) {
        if (
          node.tag !== 'img' ||
          !node.attrs['data-id']?.startsWith('sajo-image-') ||
          !isDescendant(node, current.managed)
        )
          continue;
        let resource;
        try {
          resource = new URL(node.attrs.src);
        } catch {
          throw Error('PAGE_WRITE_UNCERTAIN');
        }
        if (
          resource.origin !== 'https://graph.microsoft.com' ||
          resource.username ||
          resource.password ||
          resource.hash ||
          !resource.pathname.startsWith('/v1.0/me/onenote/resources/') ||
          !resource.pathname.endsWith('/content')
        )
          throw Error('PAGE_WRITE_UNCERTAIN');
      }
      await save({
        pageId,
        managedHash: current.managedHash,
        fingerprint: desired.fingerprint,
        imageProgress: desired.imageProgress,
        pendingWrite: null,
      });
    };
    if (created) await verifyAndSave(initial);
    else {
      if (state.pendingWrite) {
        const intent = state.pendingWrite;
        const contentHash = current.managed
          ? await hash(JSON.stringify(contentSignature(current.managed)))
          : null;
        const legacyInitial =
          current.managed &&
          intent.previousHash === null &&
          !state.managedHash &&
          state.createAttempted === true &&
          JSON.stringify(contentSignature(current.managed)) === initial.content;
        const unchangedReplacement =
          current.managedHash !== null &&
          current.managedHash === intent.previousHash &&
          (intent.operation === 'replace' || intent.imageProgress?.next === 0);
        if (
          !hex.test(intent.fingerprint ?? '') ||
          !hex.test(intent.desiredHash ?? '') ||
          (intent.previousHash !== null &&
            !hex.test(intent.previousHash ?? '')) ||
          (current.managedHash !== intent.desiredHash &&
            (!hex.test(intent.contentHash ?? '') ||
              contentHash !== intent.contentHash) &&
            !legacyInitial &&
            !unchangedReplacement)
        )
          throw Error('PAGE_WRITE_UNCERTAIN');
        await save({
          pageId,
          managedHash: current.managedHash,
          fingerprint:
            legacyInitial || unchangedReplacement ? null : intent.fingerprint,
          imageProgress: unchangedReplacement
            ? null
            : (intent.imageProgress ?? null),
          pendingWrite: null,
        });
        status = 'reconciled';
      }
      if (current.managedHash !== (state.managedHash ?? null))
        throw Error('PAGE_MANAGED_CONFLICT');
      if (
        state.fingerprint === finalFingerprint &&
        current.managedHash !== null
      )
        return {
          status: status === 'reconciled' ? status : 'skipped',
          day: base.day,
          pageId,
        };
    }
    let completed = 0;
    if (state.imageProgress?.fingerprint === finalFingerprint) {
      completed = state.imageProgress.next;
      if (
        !Number.isSafeInteger(completed) ||
        completed < 0 ||
        completed > photos.length
      )
        throw Error('PAGE_WRITE_UNCERTAIN');
      const expected = await stage(completed);
      if (
        !current.managed ||
        JSON.stringify(contentSignature(current.managed)) !== expected.content
      )
        throw Error('PAGE_WRITE_UNCERTAIN');
    } else if (!created) {
      if (
        current.managed &&
        (!current.managed.attrs.id || current.managed.attrs.id.length > 1000)
      )
        throw Error('PAGE_MANAGED_TARGET');
      await save({
        pageId,
        pendingWrite: pending(initial, current.managedHash),
      });
      const change = current.managed
        ? {
            target: current.managed.attrs.id,
            action: 'replace',
            content: initial.report.managedHtml,
          }
        : {
            target: 'body',
            action: 'append',
            content: initial.report.managedHtml,
          };
      const headers = { 'Content-Type': 'application/json' };
      if (current.etag) headers['If-Match'] = current.etag;
      // Graph does not promise an atomic OneNote content CAS; target only freshly observed nodes.
      try {
        await graph(contentPath, access, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(
            (current.managedTargets?.length ?? 0) > 1
              ? fragmentChanges(
                  initial.report.managedHtml,
                  current.managedTargets,
                )
              : [change],
          ),
        });
      } catch (error) {
        await rejectPatch(error);
      }
      current = await read();
      await verifyAndSave(initial);
    }
    let batches = 0;
    while (completed < photos.length) {
      if (batches >= maxImageBatches || Date.now() + 60000 >= deadline)
        return {
          status: 'pending',
          day: base.day,
          pageId,
          imageCount: photos.length,
          imageNext: completed,
        };
      batches++;
      const batch = await imageBatch(photos, completed, loadImage, hash),
        next = completed + batch.length;
      // Original attachment loading can outlast generated IDs; refresh before each append.
      current = await read();
      if (current.managedHash !== state.managedHash)
        throw Error('PAGE_MANAGED_CONFLICT');
      if (
        current.nodes.filter((node) => node.tag === 'img').length +
          batch.length >
        150
      )
        throw Error('NOTES_IMAGE_LIMIT');
      if (Date.now() + 60000 >= deadline)
        return {
          status: 'pending',
          day: base.day,
          pageId,
          imageCount: photos.length,
          imageNext: completed,
        };
      const desired = await stage(next),
        groups = new Map();
      for (const image of batch)
        groups.set(
          image.sourceId,
          (groups.get(image.sourceId) ?? '') + imageHtml(image),
        );
      const commands = [];
      for (const [sourceId, content] of groups) {
        const hooks = current.nodes.filter(
          (node) => node.attrs['data-id'] === 'sajo-mail-photos-' + sourceId,
        );
        if (
          hooks.length !== 1 ||
          hooks[0].tag !== 'p' ||
          !hooks[0].attrs.id ||
          current.nodes.filter((node) => node.attrs.id === hooks[0].attrs.id)
            .length !== 1 ||
          !isDescendant(hooks[0], current.managed)
        )
          throw Error('PAGE_MANAGED_TARGET');
        commands.push({
          target: hooks[0].attrs.id,
          action: 'insert',
          position: 'before',
          content,
        });
      }
      await save({
        pageId,
        pendingWrite: pending(desired, current.managedHash, 'images'),
      });
      const headers = {};
      if (current.etag) headers['If-Match'] = current.etag;
      try {
        await graph(contentPath, access, {
          method: 'PATCH',
          headers,
          body: multipartCommands(commands, batch),
        });
      } catch (error) {
        await rejectPatch(error);
      }
      current = await read();
      await verifyAndSave(desired);
      completed = next;
    }
    return {
      status,
      day: base.day,
      pageId,
      ...(photos.length ? { imageCount: photos.length } : {}),
    };
  } finally {
    await store.release({ day: base.day, lease });
  }
}
