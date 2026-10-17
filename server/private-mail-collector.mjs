// Inert transport/core only: no route, environment reader, credentials or scheduler.
import { createHash } from 'node:crypto';
const LIMIT = 10 * 1024 * 1024;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const COMMANDS = new Set([
  'USER',
  'PASS',
  'UIDL',
  'LIST',
  'TOP',
  'RETR',
  'QUIT',
]);
export class ReadOnlyPop {
  #transport;
  #buffer = Buffer.alloc(0);
  #busy = false;
  #maxBytes;
  #timeout;
  constructor(transport, { maxBytes = LIMIT, timeoutMs = 3000 } = {}) {
    this.#transport = transport;
    this.#maxBytes = maxBytes;
    this.#timeout = timeoutMs;
  }
  close() {
    this.#transport.close();
  }
  async #bounded(operation) {
    let timer;
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            this.close();
            reject(Error('POP_TIMEOUT'));
          }, this.#timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async #line() {
    for (;;) {
      const end = this.#buffer.indexOf('\r\n');
      if (end >= 0) {
        if (end > 65536) throw Error('LIMIT_REACHED');
        const line = this.#buffer.subarray(0, end);
        this.#buffer = this.#buffer.subarray(end + 2);
        return line;
      }
      if (this.#buffer.length > 65536) throw Error('LIMIT_REACHED');
      const chunk = new Uint8Array(8192);
      const n = await this.#transport.read(chunk);
      if (!Number.isInteger(n) || n <= 0 || n > chunk.length)
        throw Error('POP_CLOSED');
      this.#buffer = Buffer.concat([
        this.#buffer,
        Buffer.from(chunk.subarray(0, n)),
      ]);
    }
  }
  async greeting() {
    return this.#bounded(async () => {
      const line = (await this.#line()).toString('ascii');
      if (!/^\+OK(?: |$)/.test(line)) throw Error('POP_REJECTED');
    });
  }
  async command(verb, arg = '', multiline = false) {
    if (!COMMANDS.has(verb)) throw Error('COMMAND_REJECTED');
    if (typeof arg !== 'string' || /[\r\n\0]/.test(arg) || arg.length > 1024)
      throw Error('INPUT_REJECTED');
    if (this.#busy) throw Error('POP_BUSY');
    this.#busy = true;
    try {
      return await this.#bounded(async () => {
        await this.#transport.write(
          Buffer.from(verb + (arg ? ' ' + arg : '') + '\r\n'),
        );
        if (!/^\+OK(?: |$)/.test((await this.#line()).toString('ascii')))
          throw Error('POP_REJECTED');
        if (!multiline) return;
        const lines = [];
        let size = 0;
        for (;;) {
          let line = await this.#line();
          if (line.equals(Buffer.from('.'))) break;
          if (line[0] === 46) line = line.subarray(1);
          size += line.length + 2;
          if (size > this.#maxBytes) throw Error('LIMIT_REACHED');
          lines.push(line, Buffer.from('\r\n'));
        }
        return Buffer.concat(lines, size);
      });
    } catch (error) {
      if (error.message !== 'POP_REJECTED') this.close();
      throw error;
    } finally {
      this.#busy = false;
    }
  }
  async login(account, password) {
    if (
      account !== 'jhs96@eangroup.kr' ||
      typeof password !== 'string' ||
      !password ||
      /[\r\n\0]/.test(password) ||
      password.length > 1024
    )
      throw Error('INPUT_REJECTED');
    await this.command('USER', account);
    await this.command('PASS', password);
  }
  async uidl() {
    const text = (await this.command('UIDL', '', true)).toString('ascii');
    const numbers = new Set(),
      ids = new Set();
    const entries = text.trim()
      ? text
          .trim()
          .split('\r\n')
          .map((line) => {
            const match = /^([1-9][0-9]*) ([!-~]{1,70})$/.exec(line);
            if (!match) throw Error('UIDL_INVALID');
            const n = Number(match[1]);
            if (!Number.isSafeInteger(n) || numbers.has(n) || ids.has(match[2]))
              throw Error('UIDL_INVALID');
            numbers.add(n);
            ids.add(match[2]);
            return [n, match[2]];
          })
      : [];
    if (entries.length > 100000) throw Error('LIMIT_REACHED');
    return entries;
  }
  async list() {
    const text = (await this.command('LIST', '', true)).toString('ascii');
    const sizes = new Map();
    for (const line of text.trim() ? text.trim().split('\r\n') : []) {
      const m = /^([1-9][0-9]*) ([0-9]+)$/.exec(line);
      if (
        !m ||
        !Number.isSafeInteger(Number(m[1])) ||
        !Number.isSafeInteger(Number(m[2])) ||
        sizes.has(Number(m[1]))
      )
        throw Error('LIST_INVALID');
      sizes.set(Number(m[1]), Number(m[2]));
    }
    return sizes;
  }
  retr(number) {
    if (!Number.isSafeInteger(number) || number < 1)
      throw Error('INPUT_REJECTED');
    return this.command('RETR', String(number), true);
  }
  top(number) {
    if (!Number.isSafeInteger(number) || number < 1)
      throw Error('INPUT_REJECTED');
    return this.command('TOP', number + ' 0', true);
  }
  async quit() {
    try {
      await this.command('QUIT');
    } finally {
      this.close();
    }
  }
}

function sentDate(raw) {
  const end = raw.indexOf('\r\n\r\n');
  const header = raw
    .subarray(0, end < 0 ? raw.length : end)
    .toString('latin1')
    .replace(/\r\n[ \t]+/g, ' ');
  const value = /^Date:\s*(.*)$/im.exec(header)?.[1];
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
export async function syncBatch({
  pop,
  bridge,
  cutoff,
  packageMessage,
  batch = 5,
  seconds = 20,
  cursor = null,
  maxMessageBytes = 1024 * 1024,
}) {
  if (
    !(cutoff instanceof Date) ||
    !Number.isFinite(cutoff.getTime()) ||
    typeof packageMessage !== 'function' ||
    !Number.isInteger(batch) ||
    batch < 1 ||
    batch > 20 ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 240 ||
    !Number.isInteger(maxMessageBytes) ||
    maxMessageBytes < 1 ||
    maxMessageBytes > LIMIT
  )
    throw Error('CONFIG_REQUIRED');
  const counts = {
    saved: 0,
    skipped: 0,
    undated: 0,
    oversized: 0,
    deferred: 0,
    cursor,
  };
  const start = Date.now();
  const controller = new AbortController();
  const options = { signal: controller.signal };
  async function remaining(operation) {
    const ms = seconds * 1000 - (Date.now() - start);
    if (ms <= 0 || controller.signal.aborted) throw Error('BATCH_TIMEOUT');
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            pop.close();
            reject(Error('BATCH_TIMEOUT'));
          }, ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    const entries = (await remaining(() => pop.uidl())).reverse(),
      sizes = await remaining(() => pop.list());
    if (cursor) {
      const index = entries.findIndex(([, uidl]) => hash(uidl) === cursor);
      if (index >= 0) entries.push(...entries.splice(0, index + 1));
    }
    for (let index = 0; index < entries.length; index++) {
      if (Date.now() - start >= seconds * 1000 || counts.saved >= batch) {
        counts.deferred = entries.length - index;
        return counts;
      }
      const [number, uidl] = entries[index],
        id = hash(uidl);
      if (await remaining(() => bridge.seen(id, options))) {
        counts.cursor = id;
        continue;
      }
      if ((sizes.get(number) ?? maxMessageBytes + 1) > maxMessageBytes) {
        counts.oversized++;
        counts.cursor = id;
        continue;
      }
      const stopOversized = () => {
        counts.oversized++;
        counts.cursor = id;
        counts.deferred = entries.length - index - 1;
        return counts;
      };
      let header;
      try {
        header = await remaining(() => pop.top(number));
      } catch (error) {
        if (error.message === 'LIMIT_REACHED') return stopOversized();
        if (error.message !== 'POP_REJECTED') throw error;
      }
      const date = header ? sentDate(header) : null;
      if (date !== null && date < cutoff.getTime()) {
        counts.skipped++;
        counts.cursor = id;
        continue;
      }
      let raw;
      try {
        raw = await remaining(() => pop.retr(number));
      } catch (error) {
        if (error.message === 'LIMIT_REACHED') return stopOversized();
        throw error;
      }
      const sent = sentDate(raw);
      if (sent === null) {
        counts.undated++;
        counts.cursor = id;
        continue;
      }
      if (sent < cutoff.getTime()) {
        counts.skipped++;
        counts.cursor = id;
        continue;
      }
      let message;
      try {
        message = await remaining(() =>
          packageMessage(raw, Buffer.from(uidl), options),
        );
      } catch (error) {
        if (
          !['LIMIT_REACHED', 'MIME_INVALID', 'MISSING_DATE'].includes(
            error.message,
          )
        )
          throw error;
        if (error.message === 'LIMIT_REACHED') counts.oversized++;
        else counts.undated++;
        counts.cursor = id;
        continue;
      }
      await remaining(() => bridge.ingest(message, options));
      counts.saved++;
      counts.cursor = id;
    }
    counts.cursor = null;
    return counts;
  } catch {
    controller.abort();
    pop.close();
    throw Error('SYNC_FAILED');
  }
}
