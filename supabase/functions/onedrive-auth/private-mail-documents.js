import { inflateRawSync } from 'node:zlib';

export const MAIL_DOCUMENT_LIMITS = Object.freeze({
  bytes: 6 * 1024 * 1024,
  expandedBytes: 12_000_000,
  entries: 300,
  characters: 16_000,
  pages: 20,
  cells: 12_000,
});
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const mimeTypes = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'text/csv': 'csv',
  'text/plain': 'txt',
};
export function classifyMailDocument(file) {
  const name = String(
    file?.filename ?? file?.original_name ?? file?.name ?? '',
  ).toLowerCase();
  const extension = name.match(/\.([a-z0-9]+)$/)?.[1];
  const mime = String(
    file?.mimeType ?? file?.contentType ?? file?.content_type ?? '',
  )
    .split(';')[0]
    .trim()
    .toLowerCase();
  const kind = ['xlsx', 'docx', 'pdf', 'csv', 'txt'].includes(extension)
    ? extension
    : (mimeTypes[mime] ?? null);
  if (extension && !['xlsx', 'docx', 'pdf', 'csv', 'txt'].includes(extension))
    return null;
  if (kind && mimeTypes[mime] && mimeTypes[mime] !== kind) return null;
  return kind;
}
function decode(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('DOCUMENT_ENCODING');
  }
}
function xmlText(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('DOCUMENT_XML');
  return xml
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
      if (entity[0] === '#') {
        const n =
          entity[1].toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
          ? String.fromCodePoint(n)
          : '';
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity] ?? '';
    });
}
// Validate and bound inflation before handing Office data to a format parser.
function officeEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u16 = (p) => view.getUint16(p, true),
    u32 = (p) => view.getUint32(p, true);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) {
      end = p;
      break;
    }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10))
    fail('DOCUMENT_ZIP');
  const count = u16(end + 10),
    size = u32(end + 12),
    start = u32(end + 16);
  if (!count || count > MAIL_DOCUMENT_LIMITS.entries || start + size !== end)
    fail('DOCUMENT_LIMIT');
  let cursor = start,
    total = 0;
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) fail('DOCUMENT_ZIP');
    const flags = u16(cursor + 8),
      method = u16(cursor + 10),
      packed = u32(cursor + 20),
      expanded = u32(cursor + 24),
      nameLength = u16(cursor + 28),
      extra = u16(cursor + 30),
      comment = u16(cursor + 32),
      local = u32(cursor + 42);
    if (cursor + 46 + nameLength + extra + comment > end) fail('DOCUMENT_ZIP');
    const name = decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (flags & 1) fail('DOCUMENT_ENCRYPTED');
    if (
      ![0, 8].includes(method) ||
      name.includes('..') ||
      name.startsWith('/') ||
      name.includes('\\') ||
      entries.has(name)
    )
      fail('DOCUMENT_ZIP');
    total += expanded;
    if (
      total > MAIL_DOCUMENT_LIMITS.expandedBytes ||
      expanded > 4_000_000 ||
      expanded > Math.max(100_000, packed * 200)
    )
      fail('DOCUMENT_LIMIT');
    if (
      local + 30 > start ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method
    )
      fail('DOCUMENT_ZIP');
    const dataStart = local + 30 + u16(local + 26) + u16(local + 28);
    if (
      dataStart + packed > start ||
      decode(bytes.subarray(local + 30, local + 30 + u16(local + 26))) !== name
    )
      fail('DOCUMENT_ZIP');
    let output;
    try {
      output =
        method === 0
          ? bytes.subarray(dataStart, dataStart + packed)
          : inflateRawSync(bytes.subarray(dataStart, dataStart + packed), {
              maxOutputLength: Math.max(1, expanded),
            });
    } catch {
      fail('DOCUMENT_ZIP');
    }
    if (output.length !== expanded) fail('DOCUMENT_ZIP');
    if (
      /\.xml$|\.rels$/i.test(name) &&
      /<!DOCTYPE|<!ENTITY/i.test(decode(output))
    )
      fail('DOCUMENT_XML');
    entries.set(name, output);
    cursor += 46 + nameLength + extra + comment;
  }
  if (cursor !== end) fail('DOCUMENT_ZIP');
  return entries;
}
export async function extractMailDocument(input, type) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) fail('DOCUMENT_UNREADABLE');
  if (bytes.length > MAIL_DOCUMENT_LIMITS.bytes) fail('DOCUMENT_LIMIT');
  let text = '',
    priority = '',
    partial = false;
  const noteworthy =
    /변경|차이|누락|오류|취소|미납|지연|기한|마감|까지|확인\s*(?:요청|필요)|(?:deadline|changed|exception|overdue)/i;
  const append = (line, context = '') => {
    const remaining = MAIL_DOCUMENT_LIMITS.characters - text.length;
    text += line.slice(0, remaining);
    if (line.length <= remaining) return;
    partial = true;
    for (const [excerpt] of line.slice(remaining).matchAll(/[^\r\n]+/g)) {
      if (priority.length >= 3500) break;
      if (noteworthy.test(excerpt))
        priority += context + excerpt.slice(0, 500) + '\n';
    }
  };
  if (type === 'txt' || type === 'csv') {
    const plain = decode(bytes).replace(/^\uFEFF/, '');
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(plain)) fail('DOCUMENT_UNREADABLE');
    append(plain);
  } else if (type === 'docx' || type === 'xlsx') {
    const entries = officeEntries(bytes);
    if (type === 'docx') {
      const document = entries.get('word/document.xml');
      if (!document) fail('DOCUMENT_FORMAT');
      const xml = decode(document);
      append(
        xmlText(
          xml
            .replace(/<w:tab\b[^>]*\/>/g, '\t')
            .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
            .replace(/<\/w:p>/g, '\n')
            .replace(/<\/w:tc>/g, '\t'),
        ),
      );
      partial ||= [...entries.keys()].some((n) =>
        /^word\/(?:header|footer|footnotes|endnotes)/.test(n),
      );
    } else {
      if (!entries.has('xl/workbook.xml')) fail('DOCUMENT_FORMAT');
      // Reject implausible sparse coordinates before ExcelJS allocates row/cell arrays.
      for (const [name, data] of entries)
        if (/^xl\/worksheets\/.*\.xml$/.test(name)) {
          const xml = decode(data);
          if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('DOCUMENT_XML');
          let cells = 0;
          for (const match of xml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)) {
            let col = 0;
            for (const letter of match[1])
              col = col * 26 + letter.charCodeAt(0) - 64;
            if (
              ++cells > MAIL_DOCUMENT_LIMITS.cells ||
              col > 256 ||
              Number(match[2]) > 20000
            )
              fail('DOCUMENT_LIMIT');
          }
        }
      const library = await import('exceljs');
      const workbook = new (library.default ?? library).Workbook();
      try {
        await workbook.xlsx.load(bytes);
      } catch {
        fail('DOCUMENT_UNREADABLE');
      }
      let count = 0;
      for (const sheet of workbook.worksheets) {
        append('[' + sheet.name + ']\n');
        for (let rowIndex = 1; rowIndex <= sheet.rowCount; rowIndex++) {
          const row = sheet.getRow(rowIndex);
          if (!row.hasValues) continue;
          const parts = [];
          row.eachCell((cell) => {
            if (++count > MAIL_DOCUMENT_LIMITS.cells) {
              partial = true;
              return;
            }
            const value = cell.value;
            if (
              value &&
              typeof value === 'object' &&
              ('formula' in value || 'sharedFormula' in value)
            ) {
              parts.push(
                cell.address +
                  ': [수식 캐시] ' +
                  String(value.result ?? '결과 없음'),
              );
              partial = true;
            } else {
              const valueText = cell.text;
              if (valueText.length > 1000) partial = true;
              parts.push(cell.address + ': ' + valueText.slice(0, 1000));
            }
          });
          append(parts.join(' | ') + '\n', '[' + sheet.name + '] ');
          if (count > MAIL_DOCUMENT_LIMITS.cells) break;
        }
        if (count > MAIL_DOCUMENT_LIMITS.cells) break;
      }
    }
  } else if (type === 'pdf') {
    if (!new TextDecoder().decode(bytes.subarray(0, 8)).startsWith('%PDF-'))
      fail('DOCUMENT_FORMAT');
    const pdfjs = await import('unpdf/pdfjs');
    let task, document;
    try {
      task = pdfjs.getDocument({
        data: bytes.slice(),
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
        isOffscreenCanvasSupported: false,
        stopAtErrors: true,
      });
      document = await task.promise;
      if (document.numPages > MAIL_DOCUMENT_LIMITS.pages) partial = true;
      const deadline = performance.now() + 850;
      for (
        let p = 1;
        p <= Math.min(document.numPages, MAIL_DOCUMENT_LIMITS.pages);
        p++
      ) {
        const page = await document.getPage(p),
          content = await page.getTextContent();
        append('[페이지 ' + p + ']\n');
        let pageText = '';
        for (const item of content.items)
          if (typeof item.str === 'string')
            pageText += item.str + (item.hasEOL ? '\n' : ' ');
        if (!pageText.trim()) partial = true;
        append(pageText + '\n', '[페이지 ' + p + '] ');
        page.cleanup();
        if (p < document.numPages && performance.now() > deadline) {
          partial = true;
          break;
        }
      }
    } catch (error) {
      fail(
        error?.name === 'PasswordException'
          ? 'DOCUMENT_ENCRYPTED'
          : 'DOCUMENT_UNREADABLE',
      );
    } finally {
      if (task) await task.destroy();
    }
    if (!text.replace(/\[페이지 \d+\]/g, '').trim())
      fail('DOCUMENT_UNREADABLE');
  } else fail('DOCUMENT_UNSUPPORTED');
  if (priority) {
    const separator = '\n[중략 · 추가 확인 구간]\n';
    text =
      text.slice(
        0,
        MAIL_DOCUMENT_LIMITS.characters - separator.length - priority.length,
      ) +
      separator +
      priority;
  }
  text = text.trim();
  if (!text) fail('DOCUMENT_UNREADABLE');
  return { text, partial };
}
