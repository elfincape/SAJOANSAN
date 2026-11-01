import PostalMime from 'postal-mime';
import {
  fixtureById,
  STRESS_FIXTURES,
} from './private-mail-stress-fixtures.js';
import { mailMessageTimes, emlHeaderText } from './private-mail-body.js';
import { APPROVED_MAIL_TARGET } from './private-mail-policy.js';

export const ISOLATED_STORAGE_SQL_PATHS = Object.freeze([
  'repo-root/sql/private-mail.sql',
  'supabase/sql/private-mail-automation.sql',
  'supabase/sql/private-mail-filters.sql',
  'supabase/sql/private-mail-manual.sql',
  'supabase/sql/private-mail-history.sql',
  'supabase/sql/private-mail-message-dates.sql',
  'supabase/sql/private-mail-jev-review.sql',
]);
const OWNER = APPROVED_MAIL_TARGET.owner_id,
  BOX = APPROVED_MAIL_TARGET.mailbox_id;
const hash = async (value) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        typeof value === 'string' ? new TextEncoder().encode(value) : value,
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
const syntheticId = (fixture) =>
  fixture.remoteUrls?.length
    ? '11111111-1111-4111-8111-111111111111'
    : 'f0000000-0000-4000-8000-' +
      String(STRESS_FIXTURES.indexOf(fixture) + 1).padStart(12, '0');
const rpc = async (db, name, args) =>
  (
    await db.query(
      'select public.' +
        name +
        '(' +
        args.map((_, i) => '$' + (i + 1)).join(',') +
        ') value',
      args,
    )
  ).rows[0].value;
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function verifier(tests) {
  const check = (passed, name) => {
    tests.push({
      name: name ?? 'Storage invariant ' + (tests.length + 1),
      passed,
    });
    if (!passed) throw Error(name ?? 'ISOLATED_STORAGE_INVARIANT');
  };
  return {
    ok: (value, name) => check(!!value, name),
    equal: (actual, expected, name) => check(Object.is(actual, expected), name),
    deepEqual: (actual, expected, name) =>
      check(
        JSON.stringify(canonical(actual)) ===
          JSON.stringify(canonical(expected)),
        name,
      ),
    rejects: async (operation, expected) => {
      let error;
      try {
        await operation();
      } catch (caught) {
        error = caught;
      }
      check(
        !!error && expected.test(String(error.message)),
        'Invalid source data rejected without storing',
      );
    },
  };
}
async function setup({ PGlite, pgcrypto, sqlSources }) {
  if (typeof PGlite !== 'function' || !pgcrypto || !sqlSources)
    throw Error('ISOLATED_STORAGE_DEPENDENCIES');
  const sources = ISOLATED_STORAGE_SQL_PATHS.map((path, index) =>
    Array.isArray(sqlSources) ? sqlSources[index] : sqlSources[path],
  );
  if (sources.some((sql) => typeof sql !== 'string' || !sql.trim()))
    throw Error('ISOLATED_STORAGE_SQL_MISSING');
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;create table auth.users(id uuid primary key);create table public.user_profiles(id uuid primary key,active boolean);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant select on public.user_profiles to authenticated,service_role;`,
    );
    for (const sql of sources) await db.exec(sql);
    await db.query('insert into auth.users values($1)', [OWNER]);
    await db.query('insert into user_profiles values($1,true)', [OWNER]);
    await db.query(
      "insert into private_mailboxes(id,owner_id,account,drive_id,folder_id,enabled) values($1,$2,'jhs96@eangroup.kr','isolated-drive','isolated-folder',true)",
      [BOX, OWNER],
    );
    await db.exec('set role service_role');
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function history(db, id) {
  return (
    await db.query(
      'select history_id,payload from private_mail_analysis_history where source_id=$1 order by history_id',
      [id],
    )
  ).rows;
}
async function manual(db, f, s, assert) {
  assert.equal(
    s.entryId,
    syntheticId(f),
    'archive entry ID must identify fixed fixture',
  );
  assert.equal(s.status, 'ready');
  assert.equal(s.text, f.text);
  assert.equal(s.textHash, await hash(f.text.trim()));
  assert.equal(s.referenceDate, f.referenceDate);
  assert.equal(Date.parse(s.submittedAt), Date.parse(f.now));
  assert.ok(Array.isArray(s.items));
  const request = s.clientRequestId ?? s.entryId;
  const lease = crypto.randomUUID();
  // Seed only the authoritative fixed-fixture receipt. Saved model items remain unchanged.
  const receipt = {
    entryId: s.entryId,
    clientRequestId: request,
    requestIds: [request],
    text: f.text,
    textHash: s.textHash,
    submittedAt: s.submittedAt,
    referenceDate: s.referenceDate,
    requestedReference: s.referenceDate,
    referenceSource: 'owner',
    status: 'failed',
    attempts: 0,
    nextAt: '2000-01-01T00:00:00Z',
    items: [],
    authoredDate: null,
    error: 'MODEL_FAILED',
  };
  await db.query(
    'update private_mailboxes set manual_entries=jsonb_set(manual_entries,array[$2],$3) where id=$1',
    [BOX, s.entryId, receipt],
  );
  const claim = (l) =>
    rpc(db, 'private_mail_manual_claim', [
      BOX,
      OWNER,
      request,
      f.text,
      s.textHash,
      s.referenceDate,
      l,
      false,
    ]);
  const attempts = await Promise.all([
    claim(lease),
    claim(crypto.randomUUID()),
  ]);
  assert.equal(
    attempts.filter((x) => x.claimed).length,
    1,
    'concurrent duplicate must claim once',
  );
  assert.equal(attempts[0].claimed, true);
  const finish = (l, items = s.items) =>
    rpc(db, 'private_mail_manual_finish', [
      BOX,
      OWNER,
      s.entryId,
      l,
      items,
      s.authoredDate ?? null,
      s.inference ?? {},
    ]);
  const row = async () =>
    (
      await db.query(
        'select manual_entries->$2 value from private_mailboxes where id=$1',
        [BOX, s.entryId],
      )
    ).rows[0].value;
  assert.equal(
    await finish(crypto.randomUUID()),
    null,
    'wrong lease cannot save',
  );
  if (s.items.length) {
    const bad = structuredClone(s.items);
    bad[0].evidence = 'FORGED_OUTSIDE_FIXED_SOURCE';
    await assert.rejects(() => finish(lease, bad), /MANUAL_FORMAT/);
    assert.equal((await row()).status, 'processing');
  }
  const failed = await rpc(db, 'private_mail_manual_fail', [
    BOX,
    OWNER,
    s.entryId,
    lease,
    'MODEL_FAILED',
  ]);
  assert.equal(failed.status, 'failed');
  assert.equal(
    (await claim(crypto.randomUUID())).claimed,
    false,
    'cooldown blocks retry',
  );
  await db.query(
    "update private_mailboxes set manual_entries=jsonb_set(manual_entries,array[$2,'nextAt'],to_jsonb('2000-01-01T00:00:00Z'::text)) where id=$1",
    [BOX, s.entryId],
  );
  const retryLease = crypto.randomUUID();
  assert.equal((await claim(retryLease)).claimed, true);
  const saved = await finish(retryLease);
  assert.equal(saved.status, 'ready');
  assert.deepEqual(saved.items, s.items);
  assert.equal(saved.submittedAt, s.submittedAt);
  assert.equal(saved.text, f.text);
  assert.equal(saved.textHash, s.textHash);
  assert.equal(saved.referenceDate, s.referenceDate);
  if (s.jevReview) {
    assert.equal(
      await rpc(db, 'private_mail_manual_jev_review', [
        BOX,
        OWNER,
        s.entryId,
        s.textHash,
        s.items,
        s.jevReview,
      ]),
      true,
    );
    assert.deepEqual((await row()).jevReview, s.jevReview);
  }
  const before = await history(db, s.entryId);
  assert.ok(before.length >= 1, 'ready result has immutable outbox snapshot');
  const replay = await claim(crypto.randomUUID());
  assert.equal(
    replay.claimed,
    false,
    'lost ACK replay must reuse ready result',
  );
  assert.deepEqual(replay.entry.items, s.items);
  assert.deepEqual(
    await history(db, s.entryId),
    before,
    'lost ACK cannot duplicate history',
  );
  assert.equal(
    await finish(retryLease),
    null,
    'consumed finish cannot replace ready result',
  );
  if (s.items.length) {
    const itemId = s.items[0].itemId;
    if (s.items[0].done === true || s.items[0].workflowStatus === 'complete')
      await rpc(db, 'private_mail_manual_update', [
        BOX,
        OWNER,
        s.entryId,
        itemId,
        false,
      ]);
    const prefix = (await row()).items[0].completionEvents;
    const completed = await rpc(db, 'private_mail_manual_update', [
      BOX,
      OWNER,
      s.entryId,
      itemId,
      true,
    ]);
    assert.equal(completed.done, true);
    const completedRow = await row(),
      completedHistory = await history(db, s.entryId);
    assert.equal(completedRow.items[0].completionEvents.at(-1).done, true);
    assert.equal((await claim(crypto.randomUUID())).claimed, false);
    assert.equal(await finish(retryLease), null);
    await rpc(db, 'private_mail_manual_update', [
      BOX,
      OWNER,
      s.entryId,
      itemId,
      true,
    ]);
    assert.deepEqual(
      await row(),
      completedRow,
      'replay/repeated completion cannot replace owner state',
    );
    assert.deepEqual(await history(db, s.entryId), completedHistory);
    await rpc(db, 'private_mail_manual_update', [
      BOX,
      OWNER,
      s.entryId,
      itemId,
      false,
    ]);
    const reopened = await row();
    assert.deepEqual(
      reopened.items[0].completionEvents.slice(0, prefix.length),
      prefix,
    );
    assert.deepEqual(
      reopened.items[0].completionEvents
        .slice(prefix.length)
        .map((e) => e.done),
      [true, false],
    );
    assert.equal(reopened.text, f.text);
    assert.equal(reopened.submittedAt, s.submittedAt);
    for (const snapshot of before)
      assert.ok(
        (await history(db, s.entryId)).some(
          (x) =>
            x.history_id === snapshot.history_id &&
            x.payload === snapshot.payload,
        ),
        'original snapshot remains byte-for-byte',
      );
  }
  return {
    caseId: f.id,
    kind: 'manual',
    checks: [
      'fixed-source-identity',
      'actual-claim-finish',
      'concurrent-one-claim',
      'wrong-lease-denial',
      'failure-cooldown-retry',
      'lost-ack-ready-reuse',
      'original-unchanged',
      'immutable-history',
      ...(s.items.length ? ['completion-idempotence-and-reopen'] : []),
    ],
  };
}
async function mail(db, f, s, assert) {
  assert.equal(s.source?.id, syntheticId(f));
  assert.ok(
    Array.isArray(s.tasks) &&
      Array.isArray(s.updates) &&
      Array.isArray(s.summary),
  );
  const bytes = new TextEncoder().encode(f.mime),
    uidl = await hash(bytes);
  assert.equal(
    s.source.uidl,
    uidl,
    'saved UIDL must match fixed original MIME',
  );
  const parsed = await PostalMime.parse(bytes);
  const times = mailMessageTimes({
    headers: emlHeaderText(bytes),
    sentAt: parsed.date,
    collectedAt: f.now,
  });
  assert.equal(s.source.sentAt, times.sentAt);
  assert.equal(s.source.subject, parsed.subject);
  await db.query(
    "insert into private_mail_messages(id,mailbox_id,owner_id,uidl_hash,content_hash,subject,sender,sent_at,received_at,created_at,files,analysis_manual_selected_at) values($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,'[]',clock_timestamp())",
    [
      s.source.id,
      BOX,
      OWNER,
      uidl,
      parsed.subject,
      parsed.from?.address ?? 'sender@example.test',
      times.sentAt,
      times.receivedAt,
      f.now,
    ],
  );
  const lease = crypto.randomUUID();
  const claim = (l) =>
    db.query('select * from private_mail_analysis_claim($1,$2)', [
      s.source.id,
      l,
    ]);
  const claims = await Promise.all([claim(lease), claim(crypto.randomUUID())]);
  assert.equal(
    claims.reduce((n, x) => n + x.rows.length, 0),
    1,
  );
  assert.equal(claims[0].rows.length, 1);
  assert.equal(
    await rpc(db, 'private_mail_analysis_finish', [
      s.source.id,
      crypto.randomUUID(),
      s,
    ]),
    false,
  );
  await rpc(db, 'private_mail_analysis_fail', [
    s.source.id,
    lease,
    'MODEL_FAILED',
  ]);
  assert.equal(
    (await claim(crypto.randomUUID())).rows.length,
    0,
    'cooldown blocks retry',
  );
  await db.query(
    "update private_mail_messages set analysis_next_at=clock_timestamp()-interval '1 second' where id=$1",
    [s.source.id],
  );
  const retryLease = crypto.randomUUID();
  assert.equal((await claim(retryLease)).rows.length, 1);
  assert.equal(
    await rpc(db, 'private_mail_analysis_finish', [s.source.id, retryLease, s]),
    true,
  );
  const select = async () =>
    (
      await db.query(
        'select analysis,uidl_hash,content_hash,subject,sent_at,created_at from private_mail_messages where id=$1',
        [s.source.id],
      )
    ).rows[0];
  const stored = await select();
  assert.deepEqual(stored.analysis, s);
  assert.equal(stored.uidl_hash, uidl);
  assert.equal(stored.content_hash, uidl);
  const before = await history(db, s.source.id);
  assert.ok(before.length >= 1);
  assert.equal((await claim(crypto.randomUUID())).rows.length, 0);
  assert.equal(
    await rpc(db, 'private_mail_analysis_finish', [
      s.source.id,
      retryLease,
      { ...s, summary: [] },
    ]),
    false,
  );
  assert.deepEqual(await select(), stored);
  assert.deepEqual(await history(db, s.source.id), before);
  return {
    caseId: f.id,
    kind: 'mail',
    checks: [
      'fixed-MIME-hash-and-sent-date',
      'actual-claim-finish',
      'concurrent-one-claim',
      'wrong-lease-denial',
      'failure-cooldown-retry',
      'lost-ack-ready-reuse',
      'analysis-and-source-unchanged',
      'immutable-history',
    ],
  };
}

// Database roles and writes below exist only in the injected, newly constructed in-memory PGlite.
// Saved extraction values are never rebased to a new date/ref or replaced by fixture expectations.
export async function replayIsolatedCase(record, dependencies) {
  const tests = [],
    assert = verifier(tests);
  const report = {
    caseId: typeof record?.caseId === 'string' ? record.caseId : null,
    status: 'failed',
    tests,
    checks: [],
    storage: 'isolated-browser-pglite',
    productionWritten: false,
    oneNoteWritten: false,
    networkCalled: false,
    modelCalled: false,
    semanticVerification:
      'not assessed: SQL replay does not certify archived model/API correctness',
    sourceResultStatus: record?.status ?? null,
    sourceAutomatedChecksPassed: record?.automatedChecksPassed ?? null,
    sourceKind:
      record?.testSource === 'local-deterministic-resolver-no-provider'
        ? 'local-deterministic-extraction'
        : 'downloaded-extraction',
    receiptSeeding:
      'fixed fixture source and archived receipt metadata only; saved JSON/items/ref/time are not rewritten',
  };
  let db;
  try {
    const fixture = fixtureById(record?.caseId);
    assert.ok(fixture, 'Known frozen fixture');
    assert.ok(
      record?.saved &&
        typeof record.saved === 'object' &&
        !Array.isArray(record.saved),
      'Saved extraction exists',
    );
    const original = JSON.stringify(record.saved);
    assert.ok(original.length <= 1048576, 'Saved extraction is bounded');
    db = await setup(dependencies ?? {});
    const related = Object.fromEntries(
      (fixture.related ?? [])
        .filter(
          (entry) =>
            entry.entryId &&
            entry.status === 'ready' &&
            Array.isArray(entry.items),
        )
        .map((entry) => [entry.entryId, structuredClone(entry)]),
    );
    if (Object.keys(related).length)
      await db.query(
        'update private_mailboxes set manual_entries=$2 where id=$1',
        [BOX, related],
      );
    const priorHistory = (
      await db.query(
        'select history_id,payload from private_mail_analysis_history order by history_id',
      )
    ).rows;
    const result = await (fixture.kind === 'manual' ? manual : mail)(
      db,
      fixture,
      record.saved,
      assert,
    );
    const persisted = (
      await db.query(
        'select manual_entries from private_mailboxes where id=$1',
        [BOX],
      )
    ).rows[0].manual_entries;
    for (const [id, entry] of Object.entries(related))
      assert.deepEqual(
        persisted[id],
        entry,
        'Related source/cancellation/completion unchanged',
      );
    const finalHistory = (
      await db.query(
        'select history_id,payload from private_mail_analysis_history order by history_id',
      )
    ).rows;
    for (const old of priorHistory)
      assert.ok(
        finalHistory.some(
          (item) =>
            item.history_id === old.history_id && item.payload === old.payload,
        ),
        'Existing related history payload/hash unchanged',
      );
    assert.equal(
      JSON.stringify(record.saved),
      original,
      'Input archive remains unchanged',
    );
    Object.assign(report, result, {
      status: 'passed',
      relatedReceiptCount: Object.keys(related).length,
      historyCount: finalHistory.length,
    });
  } catch (error) {
    report.error = String(error?.message ?? error).slice(0, 300);
    if (!tests.some((test) => !test.passed))
      tests.push({ name: 'SQL replay completed', passed: false });
  } finally {
    if (db)
      try {
        await db.close();
      } catch (error) {
        report.status = 'failed';
        report.error =
          'ISOLATED_STORAGE_CLOSE: ' +
          String(error?.message ?? error).slice(0, 200);
      }
  }
  return report;
}

// One fixed, public synthetic MIME fixture; no caller-supplied mail or destination.
export async function prepareIsolatedMailCase(caseId, dependencies) {
  if (caseId !== 'mail-old-sent-collected-today')
    throw Error('ISOLATED_RECEPTION_CASE');
  const fixture = fixtureById(caseId);
  const bytes = new TextEncoder().encode(fixture.mime);
  const uidl = await hash(bytes);
  const parsed = await PostalMime.parse(bytes);
  const times = mailMessageTimes({
    headers: emlHeaderText(bytes),
    sentAt: parsed.date,
    collectedAt: fixture.now,
  });
  const tests = [],
    assert = verifier(tests);
  let db = await setup(dependencies ?? {}),
    closed = false,
    pending;
  const release = async () => {
    if (!closed) {
      closed = true;
      await db.close();
    }
  };
  try {
    const intakeLease = crypto.randomUUID();
    const begun = await db.query('select * from private_mail_begin($1,$2)', [
      BOX,
      intakeLease,
    ]);
    assert.equal(begun.rows.length, 1, 'Actual intake mailbox lease acquired');
    const files = [
      {
        index: 0,
        name: 'synthetic-reception.eml',
        mediaType: 'message/rfc822',
        byte_size: bytes.length,
        content_hash: uidl,
        storage: 'isolated-memory',
      },
    ];
    const publishArgs = [
      BOX,
      intakeLease,
      uidl,
      uidl,
      parsed.subject,
      parsed.from?.address ?? 'sender@example.test',
      times.sentAt,
      files,
    ];
    const id = await rpc(db, 'private_mail_publish', publishArgs);
    assert.ok(typeof id === 'string', 'Actual publish generated receipt UUID');
    assert.equal(
      await rpc(db, 'private_mail_publish', publishArgs),
      id,
      'Repeated normal intake deduplicates exact original MIME',
    );
    assert.equal(
      (
        await db.query(
          'select count(*)::int n from private_mail_messages where mailbox_id=$1',
          [BOX],
        )
      ).rows[0].n,
      1,
      'One original inbox row before extraction',
    );
    const selected = await rpc(db, 'private_mail_analysis_select', [
      BOX,
      id,
      OWNER,
    ]);
    assert.equal(
      selected.analysis_status,
      'pending',
      'Actual owner selection queues local original',
    );
    const workLease = crypto.randomUUID();
    const claims = await Promise.all([
      db.query('select * from private_mail_analysis_claim($1,$2)', [
        id,
        workLease,
      ]),
      db.query('select * from private_mail_analysis_claim($1,$2)', [
        id,
        crypto.randomUUID(),
      ]),
    ]);
    assert.equal(
      claims[0].rows.length,
      1,
      'Actual analysis claim held before callback',
    );
    assert.equal(
      claims[1].rows.length,
      0,
      'Duplicate analysis claimant rejected before callback',
    );
    const readSource = async () =>
      (
        await db.query(
          'select id,uidl_hash,content_hash,subject,sender,sent_at,created_at,files from private_mail_messages where id=$1',
          [id],
        )
      ).rows[0];
    const original = await readSource();
    const receipt = Object.freeze({
      caseId,
      id,
      uidl,
      contentHash: uidl,
      subject: parsed.subject,
      sentAt: times.sentAt,
      receivedAt: times.receivedAt,
      collectedAt: new Date(original.created_at).toISOString(),
      reportDay: selected.reportDay,
      originalBytes: bytes.length,
      status: 'processing',
      queued: true,
      storage: 'isolated-browser-pglite',
    });
    const complete = async (record) => {
      const report = {
        caseId,
        kind: 'mail',
        status: 'failed',
        tests,
        checks: [],
        receipt,
        storage: 'isolated-browser-pglite',
        productionWritten: false,
        oneNoteWritten: false,
        networkCalled: false,
        modelCalled: false,
        semanticVerification:
          'not assessed: this module verifies local reception and SQL persistence, not provider correctness',
        sourceResultStatus: record?.status ?? null,
      };
      try {
        assert.equal(
          record?.caseId,
          caseId,
          'Callback identifies the prepared fixed fixture',
        );
        const saved = record?.saved;
        assert.ok(
          saved && typeof saved === 'object' && !Array.isArray(saved),
          'Callback includes a saved extraction',
        );
        const originalSaved = JSON.stringify(saved);
        assert.ok(
          originalSaved.length <= 1048576,
          'Callback extraction is bounded',
        );
        assert.equal(
          saved.source?.id,
          id,
          'Callback retains actual publish receipt UUID',
        );
        assert.equal(
          saved.source?.uidl,
          uidl,
          'Callback matches original MIME hash',
        );
        assert.equal(
          saved.source?.subject,
          parsed.subject,
          'Callback matches original subject',
        );
        assert.equal(
          saved.source?.sentAt,
          times.sentAt,
          'Callback preserves verified original sender clock',
        );
        assert.equal(
          saved.source?.receivedAt,
          times.receivedAt,
          'Callback preserves unknown mailbox receipt as unknown',
        );
        assert.ok(
          Array.isArray(saved.tasks) &&
            Array.isArray(saved.updates) &&
            Array.isArray(saved.summary),
          'Callback includes the complete structured mail result',
        );
        assert.equal(
          await rpc(db, 'private_mail_analysis_finish', [
            id,
            crypto.randomUUID(),
            saved,
          ]),
          false,
          'Wrong completion lease cannot replace pending result',
        );
        assert.equal(
          await rpc(db, 'private_mail_analysis_finish', [id, workLease, saved]),
          true,
          'Original analysis lease completes after callback',
        );
        const stored = (
          await db.query(
            'select analysis,analysis_status from private_mail_messages where id=$1',
            [id],
          )
        ).rows[0];
        assert.equal(
          stored.analysis_status,
          'ready',
          'Persisted callback result is ready',
        );
        assert.deepEqual(
          stored.analysis,
          saved,
          'Actual SQL readback equals callback JSON',
        );
        assert.deepEqual(
          await readSource(),
          original,
          'Intake original bytes/hash/metadata unchanged',
        );
        const snapshots = await history(db, id);
        assert.ok(
          snapshots.length >= 1,
          'Ready result enqueued immutable history',
        );
        assert.equal(
          (
            await db.query('select * from private_mail_analysis_claim($1,$2)', [
              id,
              crypto.randomUUID(),
            ])
          ).rows.length,
          0,
          'Lost acknowledgment cannot claim completed extraction again',
        );
        assert.equal(
          await rpc(db, 'private_mail_analysis_finish', [
            id,
            workLease,
            { ...saved, summary: [] },
          ]),
          false,
          'Replayed old completion cannot overwrite ready analysis',
        );
        assert.deepEqual(
          (
            await db.query(
              'select analysis from private_mail_messages where id=$1',
              [id],
            )
          ).rows[0].analysis,
          saved,
          'Replayed completion preserves stored extraction',
        );
        assert.deepEqual(
          await history(db, id),
          snapshots,
          'Repeated completion cannot duplicate immutable history',
        );
        assert.equal(
          JSON.stringify(saved),
          originalSaved,
          'Callback extraction object remains unchanged',
        );
        Object.assign(report, {
          status: 'passed',
          roundTrip: stored.analysis,
          historyCount: snapshots.length,
          checks: [
            'normal-intake-begin-publish',
            'exact-MIME-deduplication',
            'claim-before-callback',
            'receipt-ID-and-original-hash',
            'actual-finish-readback',
            'source-unchanged',
            'lost-ack-and-history-idempotence',
          ],
        });
      } catch (error) {
        report.error = String(error?.message ?? error).slice(0, 300);
        if (!tests.some((test) => !test.passed))
          tests.push({ name: 'Prepared reception completed', passed: false });
      }
      try {
        await release();
      } catch (error) {
        report.status = 'failed';
        report.error =
          'ISOLATED_STORAGE_CLOSE: ' +
          String(error?.message ?? error).slice(0, 200);
      }
      return report;
    };
    return Object.freeze({
      queued: true,
      receipt,
      finish(record) {
        if (!pending) {
          if (closed) return Promise.reject(Error('ISOLATED_RECEPTION_CLOSED'));
          pending = complete(record);
        }
        return pending.then((report) => structuredClone(report));
      },
      async close() {
        if (pending) await pending;
        await release();
      },
    });
  } catch (error) {
    await release();
    throw error;
  }
}
