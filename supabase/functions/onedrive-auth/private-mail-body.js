const entities = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
export function mailBodyText(source, kind) {
  if (typeof source !== 'string' || source.length > 2 * 1024 * 1024)
    throw Error('BODY_LIMIT');
  if (kind === 'text') return source.trim();
  if (kind !== 'html') throw Error('BODY_UNAVAILABLE');
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<(script|style|iframe|object|template|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      '',
    )
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|table)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, key) => {
      if (key[0] !== '#') return entities[key.toLowerCase()];
      const n =
        key[1].toLowerCase() === 'x'
          ? parseInt(key.slice(2), 16)
          : Number(key.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : raw;
    })
    .replace(/\r\n/g, '\n')
    .replace(/\n[\t ]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export function emlHeaderText(bytes) {
  if (!(bytes instanceof Uint8Array)) throw Error('MAIL_LOAD_FAILED');
  const limit = Math.min(bytes.length, 65536);
  for (let i = 0; i + 3 < limit; i++)
    if (
      bytes[i] === 13 &&
      bytes[i + 1] === 10 &&
      bytes[i + 2] === 13 &&
      bytes[i + 3] === 10
    )
      return new TextDecoder().decode(bytes.subarray(0, i));
  return '';
}
