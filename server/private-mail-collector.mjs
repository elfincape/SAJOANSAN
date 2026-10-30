// Inert transport/core only: no route, environment reader, credentials or scheduler.
import { createHash } from 'node:crypto';
const LIMIT = 10 * 1024 * 1024;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const RESPONSE_CODES = new Set([
  'AUTH',
  'IN-USE',
  'LOGIN-DELAY',
  'SYS/TEMP',
  'SYS/PERM',
]);
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
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > LIMIT)
      throw Error('CONFIG_REQUIRED');
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
        const status = (await this.#line()).toString('ascii');
        if (!/^\+OK(?: |$)/.test(status)) {
          const error = Error(
            /^-ERR(?: |$)/.test(status) ? 'POP_REJECTED' : 'POP_PROTOCOL_ERROR',
          );
          const code = /^-ERR \[([A-Z/-]+)\](?: |$)/.exec(status)?.[1];
          if (RESPONSE_CODES.has(code)) error.responseCode = code;
          throw error;
        }
        if (!multiline) return;
        const blocks = [],
          crlf = Buffer.from('\r\n');
        let size = 0,
          used = 0,
          block = Buffer.allocUnsafe(Math.min(65536, this.#maxBytes));
        const append = (part) => {
          let offset = 0;
          while (offset < part.length) {
            if (used === block.length) {
              blocks.push(block);
              block = Buffer.allocUnsafe(Math.min(65536, this.#maxBytes));
              used = 0;
            }
            const count = Math.min(block.length - used, part.length - offset);
            part.copy(block, used, offset, offset + count);
            used += count;
            offset += count;
          }
        };
        for (;;) {
          let line = await this.#line();
          if (line.length === 1 && line[0] === 46) break;
          if (line[0] === 46) line = line.subarray(1);
          size += line.length + 2;
          if (size > this.#maxBytes) throw Error('LIMIT_REACHED');
          append(line);
          append(crlf);
        }
        blocks.push(block.subarray(0, used));
        return Buffer.concat(blocks, size);
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
    let step = 'USER';
    try {
      await this.command('USER', account);
      step = 'PASS';
      await this.command('PASS', password);
    } catch (error) {
      this.close();
      const code =
        {
          'IN-USE': 'POP_MAILBOX_BUSY',
          'LOGIN-DELAY': 'POP_LOGIN_DELAY',
          'SYS/TEMP': 'POP_AUTH_SERVER_ERROR',
          'SYS/PERM': 'POP_AUTH_SERVER_ERROR',
        }[error.responseCode] ||
        {
          POP_TIMEOUT: 'POP_AUTH_TIMEOUT',
          POP_CLOSED: 'POP_AUTH_CLOSED',
          POP_PROTOCOL_ERROR: 'POP_AUTH_PROTOCOL_ERROR',
          POP_REJECTED:
            step === 'USER' ? 'POP_USER_REJECTED' : 'POP_PASSWORD_REJECTED',
        }[error.message] ||
        'POP_LOGIN_FAILED';
      // Keep only a fixed category, never the command, password or server text.
      throw Object.assign(Error('POP_LOGIN_FAILED'), { code });
    }
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
  maxMessageBytes = 10 * 1024 * 1024,
  uidls = null,
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
  if (
    uidls !== null &&
    (!Array.isArray(uidls) ||
      uidls.length > 50 ||
      uidls.some((id) => !/^[a-f0-9]{64}$/.test(id)) ||
      new Set(uidls).size !== uidls.length)
  )
    throw Error('CONFIG_REQUIRED');
  const counts = {
    saved: 0,
    skipped: 0,
    undated: 0,
    oversized: 0,
    deferred: 0,
    cursor,
    ...(uidls !== null ? { processedUidls: [], missing: 0, recovered: 0 } : {}),
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
    let entries = (await remaining(() => pop.uidl())).reverse();
    const sizes = await remaining(() => pop.list());
    if (uidls !== null) {
      const map = new Map(entries.map((entry) => [hash(entry[1]), entry]));
      entries = uidls.map((id) => map.get(id) ?? [null, null, id]);
    } else if (cursor) {
      const index = entries.findIndex(([, uidl]) => hash(uidl) === cursor);
      if (index >= 0) entries.push(...entries.splice(0, index + 1));
    }
    for (let index = 0; index < entries.length; index++) {
      if (Date.now() - start >= seconds * 1000 || counts.saved >= batch) {
        counts.deferred = entries.length - index;
        return counts;
      }
      const [number, uidl, missingId] = entries[index],
        id = missingId ?? hash(uidl);
      const processed = () => {
        counts.cursor = id;
        if (uidls !== null) counts.processedUidls.push(id);
      };
      if (number === null) {
        counts.missing++;
        counts.skipped++;
        processed();
        continue;
      }
      if (await remaining(() => bridge.seen(id, options))) {
        if (uidls !== null && (await bridge.recovered?.(id)))
          counts.recovered++;
        processed();
        continue;
      }
      if ((sizes.get(number) ?? maxMessageBytes + 1) > maxMessageBytes) {
        counts.oversized++;
        processed();
        continue;
      }
      const stopOversized = () => {
        counts.oversized++;
        processed();
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
        processed();
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
        processed();
        continue;
      }
      if (sent < cutoff.getTime()) {
        counts.skipped++;
        processed();
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
        processed();
        continue;
      }
      await remaining(() => bridge.ingest(message, options));
      counts.saved++;
      processed();
    }
    counts.cursor = null;
    return counts;
  } catch (failure) {
    controller.abort();
    pop.close();
    throw Object.assign(Error('SYNC_FAILED'), {
      code: ['BATCH_TIMEOUT', 'FILE_UPLOAD_FAILED'].includes(failure?.message)
        ? failure.message
        : undefined,
      counts: { ...counts },
    });
  }
}
