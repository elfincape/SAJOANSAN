import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ReadOnlyPop, syncBatch } from '../server/private-mail-collector.mjs';
const writes = [];
let input = Buffer.from('+OK ready\r\n');
const transport = {
  async write(bytes) {
    const cmd = Buffer.from(bytes).toString();
    writes.push(cmd);
    const response = cmd.startsWith('TOP')
      ? '-ERR unsupported\r\n'
      : cmd.startsWith('UIDL')
        ? '+OK\r\n1 id-one\r\n2 id-two\r\n.\r\n'
        : cmd.startsWith('LIST')
          ? '+OK\r\n1 50\r\n2 60\r\n.\r\n'
          : cmd.startsWith('RETR')
            ? '+OK\r\nDate: Sat, 17 Oct 2026 00:00:00 +0000\r\n\r\n..dot\r\n.\r\n'
            : '+OK\r\n';
    input = Buffer.concat([input, Buffer.from(response)]);
  },
  async read(buffer) {
    if (!input.length) return null;
    const count = Math.min(buffer.length, 3, input.length);
    buffer.set(input.subarray(0, count));
    input = input.subarray(count);
    return count;
  },
  close() {
    this.closed = true;
  },
};
const pop = new ReadOnlyPop(transport);
for (const [rejectedVerb, response, expected] of [
  ['USER', '-ERR unknown user', 'POP_USER_REJECTED'],
  ['PASS', '-ERR fixture-private-password', 'POP_PASSWORD_REJECTED'],
  ['PASS', '-ERR [AUTH] fixture-private-password', 'POP_PASSWORD_REJECTED'],
  ['PASS', '-ERR [IN-USE] private mailbox', 'POP_MAILBOX_BUSY'],
  ['PASS', '-ERR [LOGIN-DELAY] private account', 'POP_LOGIN_DELAY'],
  ['PASS', '-ERR [SYS/TEMP] private server', 'POP_AUTH_SERVER_ERROR'],
  ['PASS', '-ERR [https://private.test] secret', 'POP_PASSWORD_REJECTED'],
  ['PASS', 'unexpected private response', 'POP_AUTH_PROTOCOL_ERROR'],
]) {
  let authInput = Buffer.alloc(0),
    closed = false;
  const authWrites = [];
  const auth = new ReadOnlyPop({
    async write(bytes) {
      const verb = bytes.toString().split(' ')[0];
      authWrites.push(verb);
      authInput = Buffer.from(
        (verb === rejectedVerb ? response : '+OK') + '\r\n',
      );
    },
    async read(buffer) {
      const n = Math.min(buffer.length, authInput.length);
      if (!n) return null;
      buffer.set(authInput.subarray(0, n));
      authInput = authInput.subarray(n);
      return n;
    },
    close() {
      closed = true;
    },
  });
  await assert.rejects(
    () => auth.login('jhs96@eangroup.kr', 'fixture-private-password'),
    (error) => {
      assert.equal(error.code, expected);
      assert.equal(error.message, 'POP_LOGIN_FAILED');
      assert.ok(
        !/fixture-private|private\.test|secret/.test(JSON.stringify(error)),
      );
      return true;
    },
  );
  assert.deepEqual(
    authWrites,
    rejectedVerb === 'USER' ? ['USER'] : ['USER', 'PASS'],
  );
  assert.equal(closed, true);
}
for (const [read, expected] of [
  [async () => null, 'POP_AUTH_CLOSED'],
  [async () => new Promise(() => {}), 'POP_AUTH_TIMEOUT'],
]) {
  let closed = false;
  const auth = new ReadOnlyPop(
    {
      write: async () => {},
      read,
      close() {
        closed = true;
      },
    },
    { timeoutMs: 20 },
  );
  await assert.rejects(
    () => auth.login('jhs96@eangroup.kr', 'fixture-private-password'),
    (error) => error.code === expected,
  );
  assert.equal(closed, true);
}
await pop.greeting();
await assert.rejects(() => pop.login('x\r\nDELE 1', 'test'), /INPUT_REJECTED/);
await assert.rejects(() => pop.command('DELE', '1'), /COMMAND_REJECTED/);
await pop.login('jhs96@eangroup.kr', 'fake-only');
const entries = await pop.uidl();
assert.deepEqual(entries, [
  [1, 'id-one'],
  [2, 'id-two'],
]);
const raw = await pop.retr(1);
assert.ok(raw.toString().includes('\r\n.dot\r\n'));
let stored = 0,
  seen = 0;
const bridge = {
  async seen() {
    return ++seen === 1;
  },
  async ingest() {
    stored++;
  },
};
const result = await syncBatch({
  pop,
  bridge,
  cutoff: new Date('2026-08-18T00:00:00Z'),
  packageMessage: async (raw, uidl) => ({ raw, uidl }),
  batch: 1,
});
assert.equal(result.saved, 1);
assert.equal(stored, 1);
assert.ok(writes.every((x) => !/^DELE/i.test(x)));
const failBridge = {
  seen: async () => false,
  ingest: async () => {
    throw Error('failure');
  },
};
await assert.rejects(
  () =>
    syncBatch({
      pop,
      bridge: failBridge,
      cutoff: new Date('2026-08-18T00:00:00Z'),
      packageMessage: async () => ({}),
    }),
  /SYNC_FAILED/,
);
await pop.quit();
assert.equal(transport.closed, true);
let oversized = Buffer.from('+OK\r\n' + 'a'.repeat(100) + '\r\n.\r\n');
const limited = new ReadOnlyPop(
  {
    write: async () => {},
    read: async (b) => {
      if (!oversized.length) return null;
      const n = Math.min(b.length, oversized.length);
      b.set(oversized.subarray(0, n));
      oversized = oversized.subarray(n);
      return n;
    },
    close() {},
  },
  { maxBytes: 64 },
);
await assert.rejects(() => limited.retr(1), /LIMIT_REACHED/);
console.log(
  'PASS read-only Node POP: fragmented lines, dot unstuffing, injection/DELE rejection, UIDL dedup, bounded batch/reception, partial failure, QUIT cleanup',
);

let abortSignal,
  deadlineClosed = false;
const deadlinePop = {
  uidl: async () => [[1, 'deadline']],
  list: async () => new Map([[1, 10]]),
  close() {
    deadlineClosed = true;
  },
};
const started = Date.now();
await assert.rejects(
  () =>
    syncBatch({
      pop: deadlinePop,
      bridge: {
        seen: async (id, { signal }) => {
          abortSignal = signal;
          return new Promise(() => {});
        },
      },
      cutoff: new Date(),
      packageMessage: async () => ({}),
      seconds: 0.02,
    }),
  (error) => error.message === 'SYNC_FAILED' && error.code === 'BATCH_TIMEOUT',
);
assert.ok(Date.now() - started < 500);
assert.equal(abortSignal.aborted, true);
assert.equal(deadlineClosed, true);
console.log(
  'PASS batch deadline aborts stalled bridge and closes POP transport',
);

let progressLookups = 0;
await assert.rejects(
  () =>
    syncBatch({
      pop: {
        ...deadlinePop,
        uidl: async () => [
          [1, 'unfinished'],
          [2, 'completed'],
        ],
        list: async () =>
          new Map([
            [1, 10],
            [2, 10],
          ]),
      },
      bridge: {
        seen: async () =>
          ++progressLookups === 1 ? true : new Promise(() => {}),
      },
      cutoff: new Date(),
      packageMessage: async () => ({}),
      seconds: 0.02,
    }),
  (error) => {
    assert.equal(
      error.counts?.cursor,
      createHash('sha256').update('completed').digest('hex'),
    );
    assert.equal(error.counts?.saved, 0);
    return error.message === 'SYNC_FAILED';
  },
);

let parseAttempts = 0,
  postMalformedSaved = 0;
const malformedPop = {
  uidl: async () => [
    [1, 'valid'],
    [2, 'malformed'],
  ],
  list: async () =>
    new Map([
      [1, 100],
      [2, 100],
    ]),
  top: async () => Buffer.from('Date: Sat, 17 Oct 2026 00:00:00 +0000\r\n\r\n'),
  retr: async () =>
    Buffer.from('Date: Sat, 17 Oct 2026 00:00:00 +0000\r\n\r\n'),
  close() {},
};
const malformedCounts = await syncBatch({
  pop: malformedPop,
  bridge: {
    seen: async () => false,
    ingest: async () => {
      postMalformedSaved++;
    },
  },
  cutoff: new Date('2026-08-18T00:00:00Z'),
  packageMessage: async () => {
    if (++parseAttempts === 1) throw Error('MIME_INVALID');
    return {};
  },
});
assert.equal(malformedCounts.undated, 1);
assert.equal(postMalformedSaved, 1);
console.log(
  'PASS malformed MIME does not block later messages; original POP mail is retained',
);

let manyLines = Buffer.from('+OK\r\n' + '\r\n'.repeat(300000) + '.\r\n');
const shortLines = new ReadOnlyPop({
  write: async () => {},
  close() {},
  read: async (buffer) => {
    const n = Math.min(buffer.length, manyLines.length);
    if (!n) return null;
    buffer.set(manyLines.subarray(0, n));
    manyLines = manyLines.subarray(n);
    return n;
  },
});
const bufferFrom = Buffer.from;
let separators = 0;
const initialRSS = process.memoryUsage().rss;
try {
  Buffer.from = function (value, ...args) {
    if (value === '\r\n') separators++;
    return bufferFrom(value, ...args);
  };
  assert.equal((await shortLines.retr(1)).length, 600000);
} finally {
  Buffer.from = bufferFrom;
}
assert.ok(
  separators <= 1,
  'POP response cannot retain a separate Buffer per line',
);
console.log(
  JSON.stringify({
    pass: '300000 empty POP lines use bounded 64KiB blocks',
    separators,
    rssDelta: process.memoryUsage().rss - initialRSS,
  }),
);

// A frozen collection set must finish without re-scanning or taking new arrivals.
const frozenIds = Array.from({ length: 587 }, (_, i) =>
  createHash('sha256')
    .update('backlog-' + i)
    .digest('hex'),
);
let frozenStored = 0;
const frozenCounts = await syncBatch({
  pop: {
    uidl: async () => frozenIds.map((_, i) => [i + 1, 'backlog-' + i]),
    list: async () => new Map(frozenIds.map((_, i) => [i + 1, 100])),
    top: async () => Buffer.from('Date: Fri, 30 Oct 2026 00:00:00 GMT\r\n\r\n'),
    retr: async () =>
      Buffer.from('Date: Fri, 30 Oct 2026 00:00:00 GMT\r\n\r\nbody'),
    close() {},
  },
  bridge: {
    seen: async () => false,
    ingest: async () => {
      frozenStored++;
    },
  },
  cutoff: new Date('2026-09-01Z'),
  packageMessage: async () => ({}),
  batch: 20,
  seconds: 180,
  uidls: frozenIds.slice(0, 50),
});
assert.deepEqual(
  frozenCounts.processedUidls,
  frozenIds.slice(0, 20),
  'checkpoint must advance the frozen prefix only',
);
assert.equal(frozenStored, 20);
const collectionState =
  await import('../supabase/functions/onedrive-auth/private-mail-collection-state.js');
let collection = collectionState.startCollection(
  frozenIds,
  '00000000-0000-4000-8000-000000000081',
  '2026-10-30T08:00:00Z',
);
let chunks = 0;
while (collection.pending.length) {
  const ids = collection.pending.slice(0, 20);
  collection = collectionState.advanceCollection(collection, {
    processedUidls: ids,
    saved: ids.length,
    skipped: 0,
    undated: 0,
    oversized: 0,
    missing: 0,
  });
  chunks++;
}
assert.equal(chunks, 30);
assert.equal(collection.saved, 587);
assert.equal(collection.processed, 587);
assert.equal(collection.phase, 'complete');
const initialCollection = collectionState.startCollection(
  frozenIds.slice(0, 4),
  '00000000-0000-4000-8000-000000000082',
  '2026-10-30T08:00:00Z',
);
assert.throws(
  () =>
    collectionState.advanceCollection(initialCollection, {
      processedUidls: [frozenIds[1]],
      saved: 1,
    }),
  /COLLECTION_CHECKPOINT/,
);
assert.throws(
  () =>
    collectionState.advanceCollection(initialCollection, {
      processedUidls: [frozenIds[0]],
      saved: 2,
    }),
  /COLLECTION_COUNTS/,
);
const resumedCollection = collectionState.advanceCollection(
  JSON.parse(JSON.stringify(initialCollection)),
  { processedUidls: frozenIds.slice(0, 2), saved: 2 },
);
assert.deepEqual(resumedCollection.pending, frozenIds.slice(2, 4));
console.log(
  'PASS collection snapshot: 587 messages/30 chunks, exact checkpoint prefix, count integrity and serialized resume',
);
const recoveredCollection = collectionState.advanceCollection(
  initialCollection,
  { processedUidls: frozenIds.slice(0, 2), saved: 1, recovered: 1 },
);
assert.equal(
  recoveredCollection.saved,
  2,
  'lost publish acknowledgement is reconciled by persisted UIDL rather than counted as missing',
);
