import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// Optional isolated PostgreSQL runtime; not an application dependency.
if (!process.env.PGLITE_MODULE)
  throw Error(
    'Set PGLITE_MODULE to a local @electric-sql/pglite dist/index.js',
  );
const { PGlite } = await import(process.env.PGLITE_MODULE);
const { pgcrypto } = await import(
  new URL('./contrib/pgcrypto.js', process.env.PGLITE_MODULE).href
);
const db = new PGlite({ extensions: { pgcrypto } });
const owner = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002',
  box = '00000000-0000-4000-8000-000000000003',
  lease = '00000000-0000-4000-8000-000000000004';
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;grant usage on schema auth to authenticated;
 create table auth.users(id uuid primary key);create table public.user_profiles(id uuid primary key,active boolean);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant select on public.user_profiles to authenticated,service_role;
 insert into auth.users values('${owner}'),('${other}');insert into public.user_profiles values('${owner}',true),('${other}',true);`);
  await db.exec(
    await readFile(
      new URL('../repo-root/sql/private-mail.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    `insert into public.private_mailboxes(id,owner_id,account,drive_id,folder_id,enabled) values('${box}','${owner}','jhs96@eangroup.kr','drive','private',true);set role service_role;`,
  );
  const begin = await db.query(
    'select * from public.private_mail_begin($1,$2)',
    [box, lease],
  );
  assert.equal(begin.rows.length, 1);
  assert.equal(begin.rows[0].initial_days, 60);
  const age = await db.query(
    'select extract(epoch from(now()-cutoff_at))/86400 as days from public.private_mailboxes where id=$1',
    [box],
  );
  assert.ok(
    Math.abs(Number(age.rows[0].days) - 60) < 0.001,
    'default cutoff is 60 days',
  );
  assert.equal(
    (
      await db.query('select * from public.private_mail_begin($1,$2)', [
        box,
        other,
      ])
    ).rows.length,
    0,
  );
  const args = [
    box,
    lease,
    'a'.repeat(64),
    'b'.repeat(64),
    'fixture',
    'sender',
    '2026-10-17T00:00:00Z',
    '[]',
  ];
  const publish = () =>
    db.query(
      'select public.private_mail_publish($1,$2,$3,$4,$5,$6,$7,$8)',
      args,
    );
  await publish();
  await publish();
  assert.equal(
    (await db.query('select * from public.private_mail_messages')).rows.length,
    1,
  );
  args[1] = other;
  await assert.rejects(publish, /lease expired/);
  args[1] = lease;
  await db.exec(
    `update public.private_mailboxes set lease_until=now()-interval '1 second';`,
  );
  await assert.rejects(publish, /lease expired/);
  await db.exec(
    `reset role;set role authenticated;set "request.jwt.claim.sub"='${owner}';`,
  );
  assert.equal(
    (await db.query('select * from public.private_mail_messages')).rows.length,
    1,
  );
  assert.equal(
    (await db.query('select * from public.private_mailboxes')).rows.length,
    1,
  );
  await assert.rejects(
    () => db.exec('update public.private_mailboxes set enabled=true'),
    /permission denied/,
  );
  await assert.rejects(
    () => db.exec('delete from public.private_mail_messages'),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      db.query('select * from public.private_mail_begin($1,$2)', [box, lease]),
    /permission denied/,
  );
  await db.exec(`set "request.jwt.claim.sub"='${other}';`);
  assert.equal(
    (await db.query('select * from public.private_mail_messages')).rows.length,
    0,
  );
  assert.equal(
    (await db.query('select * from public.private_mailboxes')).rows.length,
    0,
  );
  await db.exec(
    `reset role;update public.user_profiles set active=false where id='${owner}';set role authenticated;set "request.jwt.claim.sub"='${owner}';`,
  );
  assert.equal(
    (await db.query('select * from public.private_mail_messages')).rows.length,
    0,
  );
  await db.exec('reset role;set role anon;');
  await assert.rejects(
    () => db.query('select * from public.private_mail_messages'),
    /permission denied/,
  );
  console.log(
    'PASS PostgreSQL: owner SELECT, nonowner/inactive isolation, anon denial, no client writes/RPC, service-only lease, expiry and UIDL uniqueness',
  );
  await db.exec('reset role;');
  await db.exec(`create table public.onedrive_connection(id boolean primary key,encrypted_tokens text not null,connected_by uuid,updated_at timestamptz);
   create table public.onedrive_oauth(state_hash text primary key,proof_hash text,user_id uuid,stage text,expires_at timestamptz,encrypted_data text);
   grant all on public.onedrive_connection,public.onedrive_oauth to service_role;
   insert into public.onedrive_connection values(true,'original-files','${owner}',now());
   insert into public.user_profiles values('2a828c2d-9a6f-40d4-8e13-336b591811cc',true);`);
  const fileOAuthSql = await readFile(
    new URL('../repo-root/sql/onedrive-integration.sql', import.meta.url),
    'utf8',
  );
  await db.exec(
    fileOAuthSql.match(
      /create or replace function public\.onedrive_finish_oauth[\s\S]+?end \$\$;/,
    )[0],
  );
  await db.exec(
    await readFile(
      new URL('../supabase/sql/private-mail-notes-oauth.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    `insert into public.onedrive_oauth values('state-notes','proof','2a828c2d-9a6f-40d4-8e13-336b591811cc','ready',now()+interval '10 minutes','notes-fixture','mail-briefing');set role service_role;`,
  );
  assert.equal(
    (
      await db.query(
        "select public.onedrive_finish_oauth('state-notes','proof','2a828c2d-9a6f-40d4-8e13-336b591811cc') as ok",
      )
    ).rows[0].ok,
    false,
    'file callback must never consume Notes consent',
  );
  assert.equal(
    (
      await db.query(
        "select public.onedrive_finish_notes_oauth('state-notes','wrong','2a828c2d-9a6f-40d4-8e13-336b591811cc') as ok",
      )
    ).rows[0].ok,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select public.onedrive_finish_notes_oauth('state-notes','proof','2a828c2d-9a6f-40d4-8e13-336b591811cc') as ok",
      )
    ).rows[0].ok,
    true,
  );
  const connections = (
    await db.query('select * from public.onedrive_connection')
  ).rows[0];
  assert.equal(connections.encrypted_tokens, 'original-files');
  assert.equal(connections.encrypted_notes_tokens, 'notes-fixture');
  assert.equal(
    (
      await db.query(
        "select public.onedrive_finish_notes_oauth('state-notes','proof','2a828c2d-9a6f-40d4-8e13-336b591811cc') as ok",
      )
    ).rows[0].ok,
    false,
    'consent proof cannot be replayed',
  );
  await db.exec('reset role;set role authenticated;');
  await assert.rejects(
    () =>
      db.query(
        "select public.onedrive_finish_notes_oauth('state-notes','proof','2a828c2d-9a6f-40d4-8e13-336b591811cc')",
      ),
    /permission denied/,
  );
  console.log(
    'PASS Notes OAuth PostgreSQL: separate credentials, purpose separation, proof, replay and service-only completion',
  );
  await db.exec('reset role;');
  await db.exec(
    await readFile(
      new URL('../supabase/sql/private-mail-automation.sql', import.meta.url),
      'utf8',
    ),
  );
  const autoBox = '39045005-313e-42e1-b50c-2394b3b6ff26';
  const autoOwner = '2a828c2d-9a6f-40d4-8e13-336b591811cc';
  const lease2 = '00000000-0000-4000-8000-000000000005';
  await db.query('insert into auth.users values($1)', [autoOwner]);
  await db.query(
    "insert into public.private_mailboxes(id,owner_id,account,drive_id,folder_id,enabled) values($1,$2,'jhs96@eangroup.kr','drive','private',true)",
    [autoBox, autoOwner],
  );
  {
    const historical = '99999999-1111-4111-8111-999999999999';
    await db.exec(
      "alter table public.private_mail_messages alter column report_day set expression as ((created_at at time zone 'Asia/Seoul')::date)",
    );
    await db.query(
      "insert into public.private_mail_messages(id,mailbox_id,owner_id,uidl_hash,content_hash,subject,sender,sent_at,created_at,files) values($1,$2,$3,$4,$5,'8월18일 자료','sender@example.test','2026-08-19T00:42:28Z','2026-10-31T04:12:48Z','[]'::jsonb)",
      [historical, autoBox, autoOwner, 'c'.repeat(64), 'd'.repeat(64)],
    );
    assert.equal(
      (
        await db.query(
          'select report_day::text d from private_mail_messages where id=$1',
          [historical],
        )
      ).rows[0].d,
      '2026-10-31',
    );
    await db.exec(
      await readFile(
        new URL(
          '../supabase/sql/private-mail-message-dates.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    assert.equal(
      (
        await db.query(
          'select report_day::text d from private_mail_messages where id=$1',
          [historical],
        )
      ).rows[0].d,
      '2026-08-19',
    );
    await db.query(
      "update private_mail_messages set received_at='2026-10-31T04:12:00Z' where id=$1",
      [historical],
    );
    assert.equal(
      (
        await db.query(
          'select report_day::text d from private_mail_messages where id=$1',
          [historical],
        )
      ).rows[0].d,
      '2026-10-31',
    );
    await db.query(
      "update private_mail_messages set received_at=null,sent_at='2026-10-30T15:01:00Z' where id=$1",
      [historical],
    );
    assert.equal(
      (
        await db.query(
          'select report_day::text d from private_mail_messages where id=$1',
          [historical],
        )
      ).rows[0].d,
      '2026-10-31',
    );
    await db.query('delete from private_mail_messages where id=$1', [
      historical,
    ]);
    console.log(
      'PASS actual PostgreSQL date migration: collection-day misclassification reproduced and corrected, real receipt wins, KST midnight preserved',
    );
  }
  await db.exec('set role service_role;');
  const rpc = async (name, args = []) =>
    (
      await db.query(
        `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as value`,
        args,
      )
    ).rows[0].value;
  assert.equal(
    await rpc('private_mail_job_start', [autoBox, false]),
    null,
    'automation defaults disabled',
  );
  await db.query(
    `update public.private_mailboxes set automation_config='{"enabled":true,"readStateVerified":true,"analysisConsent":false,"analysisConsentAt":null}' where id=$1`,
    [autoBox],
  );
  assert.equal(
    await rpc('private_mail_job_start', [box, true]),
    null,
    'fixed mailbox scope',
  );
  const job = await rpc('private_mail_job_start', [autoBox, false]);
  assert.equal(job.status, 'queued');
  assert.equal(
    (await rpc('private_mail_job_start', [autoBox, true])).id,
    job.id,
    'one durable job',
  );
  await db.query(
    "update public.private_mailboxes set lease=$2,lease_until=now()+interval '10 minutes' where id=$1",
    [autoBox, lease2],
  );
  assert.equal(
    await rpc('private_mail_job_claim', [autoBox, job.id, lease]),
    null,
    'manual lease wins',
  );
  await db.query(
    "update public.private_mailboxes set lease_until=now()-interval '1 second' where id=$1",
    [autoBox],
  );
  assert.equal(
    (await rpc('private_mail_job_claim', [autoBox, job.id, lease])).status,
    'running',
  );
  assert.equal(
    await rpc('private_mail_job_claim', [autoBox, job.id, lease2]),
    null,
    'no double claim',
  );
  const cycle = {
    id: other,
    requestId: job.id,
    startedAt: new Date().toISOString(),
    pending: ['c'.repeat(64)],
    total: 2,
    processed: 1,
    saved: 1,
    skipped: 0,
    undated: 0,
    oversized: 0,
    missing: 0,
    phase: 'collecting',
  };
  await db.query(
    'update public.private_mailboxes set last_counts=$2 where id=$1',
    [autoBox, { cycle }],
  );
  await assert.rejects(
    () =>
      rpc('private_mail_job_finish', [
        autoBox,
        job.id,
        lease,
        { ...cycle, processed: 2 },
        null,
      ]),
    /JOB_PROGRESS/,
  );
  assert.equal(
    (
      await rpc('private_mail_job_finish', [
        autoBox,
        job.id,
        lease,
        cycle,
        null,
      ])
    ).status,
    'queued',
    'remaining work queues immediately',
  );
  assert.equal(
    (await rpc('private_mail_job_claim', [autoBox, job.id, lease2])).cycleId,
    other,
  );
  await assert.rejects(
    () => rpc('private_mail_job_finish', [autoBox, job.id, lease, cycle, null]),
    /JOB_LEASE/,
  );
  await rpc('private_mail_job_stop', [autoBox]);
  assert.equal(
    (
      await rpc('private_mail_job_finish', [
        autoBox,
        job.id,
        lease2,
        cycle,
        null,
      ])
    ).status,
    'stopped',
  );
  assert.deepEqual(
    (
      await db.query(
        'select last_counts from public.private_mailboxes where id=$1',
        [autoBox],
      )
    ).rows[0].last_counts,
    { cycle },
    'queue never rewrites receipt',
  );
  await db.query(
    'update public.private_mailboxes set automation_next_at=null where id=$1',
    [autoBox],
  );
  assert.equal(
    await rpc('private_mail_job_start', [autoBox, false]),
    null,
    'scheduled job never adopts manual receipt',
  );
  await db.query(
    "update public.private_mailboxes set lease_until=now()+interval '1 minute' where id=$1",
    [autoBox],
  );
  assert.equal(
    await rpc('private_mail_job_start', [autoBox, true]),
    null,
    'run-now does not interrupt live manual collector',
  );
  await db.query(
    'update public.private_mailboxes set lease_until=null where id=$1',
    [autoBox],
  );
  const adopted = await rpc('private_mail_job_start', [autoBox, true]);
  assert.equal(
    adopted.id,
    cycle.requestId,
    'explicit resume keeps manual request identity',
  );
  assert.equal(adopted.cycleId, cycle.id);
  await rpc('private_mail_job_stop', [autoBox]);
  await db.query(
    "update public.private_mailboxes set last_counts='{}',lease_until=null where id=$1",
    [autoBox],
  );
  const retryJob = await rpc('private_mail_job_start', [autoBox, true]);
  for (let attempt = 1; attempt <= 5; attempt++) {
    await db.query(
      "update public.private_mailboxes set automation_job=jsonb_set(automation_job,'{notBefore}',to_jsonb((now()-interval '1 minute')::text)) where id=$1",
      [autoBox],
    );
    assert.ok(
      await rpc('private_mail_job_claim', [autoBox, retryJob.id, lease]),
    );
    const failed = await rpc('private_mail_job_finish', [
      autoBox,
      retryJob.id,
      lease,
      null,
      'POP_FAILED',
    ]);
    assert.equal(failed.status, attempt === 5 ? 'failed' : 'queued');
  }
  const frozenRetry = { ...cycle, requestId: retryJob.id };
  await db.query(
    'update public.private_mailboxes set last_counts=$2 where id=$1',
    [autoBox, { cycle: frozenRetry }],
  );
  assert.equal(
    await rpc('private_mail_job_start', [autoBox, false]),
    null,
    'failed cycle cannot retry before scheduled time',
  );
  await db.query(
    "update public.private_mailboxes set automation_next_at=now()-interval '1 second' where id=$1",
    [autoBox],
  );
  await db.query(
    "update public.private_mailboxes set automation_job=jsonb_set(automation_job,'{stopRequested}','true') where id=$1",
    [autoBox],
  );
  assert.equal(
    await rpc('private_mail_job_start', [autoBox, false]),
    null,
    'owner cancellation forbids scheduled restart',
  );
  await db.query(
    "update public.private_mailboxes set automation_job=jsonb_set(automation_job,'{stopRequested}','false'),lease_until=now()+interval '1 minute' where id=$1",
    [autoBox],
  );
  assert.equal(
    await rpc('private_mail_job_start', [autoBox, false]),
    null,
    'active mailbox lease prevents recovery',
  );
  await db.query(
    'update public.private_mailboxes set lease_until=null where id=$1',
    [autoBox],
  );
  await db.query(
    "update public.private_mailboxes set automation_job=jsonb_set(automation_job,'{leaseUntil}',to_jsonb((now()+interval '1 minute')::text)) where id=$1",
    [autoBox],
  );
  assert.equal(
    await rpc('private_mail_job_start', [autoBox, false]),
    null,
    'worker lease prevents recovery',
  );
  await db.query(
    "update public.private_mailboxes set automation_job=jsonb_set(automation_job,'{leaseUntil}','null') where id=$1",
    [autoBox],
  );
  const recovered = await rpc('private_mail_job_start', [autoBox, false]);
  assert.equal(recovered.id, retryJob.id);
  assert.equal(recovered.periodFailures, 0);
  assert.equal(
    (await rpc('private_mail_job_start', [autoBox, false])).createdAt,
    recovered.createdAt,
    'second tick cannot reset queued job budget',
  );
  assert.deepEqual(
    (
      await db.query(
        'select last_counts from public.private_mailboxes where id=$1',
        [autoBox],
      )
    ).rows[0].last_counts,
    { cycle: frozenRetry },
    'scheduled recovery preserves all checkpoint data',
  );
  await db.query(
    "update public.private_mailboxes set automation_job=jsonb_set(automation_job,'{periodFailures}','4') where id=$1",
    [autoBox],
  );
  await rpc('private_mail_job_claim', [autoBox, recovered.id, lease]);
  assert.equal(
    (
      await rpc('private_mail_job_finish', [
        autoBox,
        recovered.id,
        lease,
        frozenRetry,
        null,
      ])
    ).periodFailures,
    4,
    'successful chunk never erases this period failure count',
  );
  await rpc('private_mail_job_claim', [autoBox, recovered.id, lease]);
  const exhaustedPeriod = await rpc('private_mail_job_finish', [
    autoBox,
    recovered.id,
    lease,
    null,
    'POP_FAILED',
  ]);
  assert.equal(exhaustedPeriod.status, 'failed');
  assert.equal(exhaustedPeriod.periodFailures, 5);
  assert.equal(
    await rpc('private_mail_job_start', [autoBox, false]),
    null,
    'exhausted period waits for next scheduled window',
  );
  await rpc('private_mail_job_stop', [autoBox]);
  await db.query(
    "update public.private_mailboxes set automation_next_at=null,last_counts='{}' where id=$1",
    [autoBox],
  );
  const expiredJob = await rpc('private_mail_job_start', [autoBox, true]);
  await rpc('private_mail_job_claim', [autoBox, expiredJob.id, lease]);
  await db.query(
    "update public.private_mailboxes set automation_job=jsonb_set(automation_job,'{leaseUntil}',to_jsonb((now()-interval '1 second')::text)) where id=$1",
    [autoBox],
  );
  await assert.rejects(
    () =>
      rpc('private_mail_job_finish', [
        autoBox,
        expiredJob.id,
        lease,
        null,
        'POP_FAILED',
      ]),
    /JOB_LEASE/,
    'expired worker cannot publish progress',
  );
  assert.equal(
    (await rpc('private_mail_job_claim', [autoBox, expiredJob.id, lease2]))
      .lease,
    lease2,
    'expired dispatch recovers',
  );
  await rpc('private_mail_job_stop', [autoBox]);
  await rpc('private_mail_job_finish', [
    autoBox,
    expiredJob.id,
    lease2,
    null,
    'POP_FAILED',
  ]);
  await db.query(
    "update public.private_mailboxes set automation_config=automation_config || jsonb_build_object('analysisConsent',true,'analysisConsentAt',(now()-interval '1 hour')::text) where id=$1",
    [autoBox],
  );
  const insertMessage = async (hash, sent) =>
    (
      await db.query(
        "insert into public.private_mail_messages(mailbox_id,owner_id,uidl_hash,content_hash,subject,sender,sent_at,files) values($1,$2,$3,$3,'subject','sender',$4,'[]') returning id",
        [autoBox, autoOwner, hash.repeat(64), sent],
      )
    ).rows[0].id;
  const old = await insertMessage('d', '2020-01-01T00:00:00Z');
  const oldCreated = await insertMessage('1', new Date().toISOString());
  await db.query(
    "update public.private_mail_messages set created_at=now()-interval '2 hours' where id=$1",
    [oldCreated],
  );
  assert.equal(
    (
      await db.query(
        'select * from public.private_mail_analysis_claim($1,$2)',
        [oldCreated, lease],
      )
    ).rows.length,
    0,
    'old received mail cannot reach AI',
  );
  const retryAnalysis = await insertMessage('2', new Date().toISOString());
  for (let attempt = 1; attempt <= 5; attempt++) {
    await db.query(
      "update public.private_mail_messages set analysis_next_at=now()-interval '1 second' where id=$1",
      [retryAnalysis],
    );
    assert.equal(
      (
        await db.query(
          'select * from public.private_mail_analysis_claim($1,$2)',
          [retryAnalysis, lease],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      await rpc('private_mail_analysis_fail', [
        retryAnalysis,
        lease2,
        'AI_FAILED',
      ]),
      false,
    );
    assert.equal(
      await rpc('private_mail_analysis_fail', [
        retryAnalysis,
        lease,
        'AI_FAILED',
      ]),
      true,
    );
  }
  await db.query(
    'update public.private_mail_messages set analysis_next_at=null where id=$1',
    [retryAnalysis],
  );
  assert.equal(
    (
      await db.query(
        'select * from public.private_mail_analysis_claim($1,$2)',
        [retryAnalysis, lease],
      )
    ).rows.length,
    0,
    'five analysis attempts maximum',
  );
  const fresh = await insertMessage('e', new Date().toISOString());
  assert.equal(
    (
      await db.query(
        'select * from public.private_mail_analysis_claim($1,$2)',
        [old, lease],
      )
    ).rows.length,
    0,
    'old sent mail cannot reach AI',
  );
  assert.equal(
    (
      await db.query(
        'select * from public.private_mail_analysis_claim($1,$2)',
        [fresh, lease],
      )
    ).rows.length,
    1,
  );
  assert.equal(
    await rpc('private_mail_analysis_finish', [
      fresh,
      lease2,
      { summary: 'wrong lease' },
    ]),
    false,
  );
  assert.equal(
    await rpc('private_mail_analysis_finish', [
      fresh,
      lease,
      { summary: 'ready' },
    ]),
    true,
  );
  const day = (
    await db.query(
      'select report_day::text as day from public.private_mail_messages where id=$1',
      [fresh],
    )
  ).rows[0].day;
  let page = await rpc('private_mail_briefing_claim', [autoBox, day, lease]);
  assert.equal(page.dirty, true);
  assert.equal(
    await rpc('private_mail_briefing_claim', [autoBox, day, lease2]),
    null,
  );
  assert.equal(
    await rpc('private_mail_briefing_save', [
      autoBox,
      day,
      lease,
      { pageId: 'page', createAttempted: true },
    ]),
    true,
  );
  const fresh2 = await insertMessage('f', new Date().toISOString());
  await db.query('select * from public.private_mail_analysis_claim($1,$2)', [
    fresh2,
    lease2,
  ]);
  await rpc('private_mail_analysis_finish', [
    fresh2,
    lease2,
    { summary: 'concurrent' },
  ]);
  assert.equal(
    await rpc('private_mail_briefing_complete', [autoBox, day, lease]),
    false,
    'new analysis keeps dirty',
  );
  await rpc('private_mail_briefing_release', [autoBox, day, lease]);
  page = await rpc('private_mail_briefing_claim', [autoBox, day, lease2]);
  assert.equal(page.pageId, 'page');
  assert.equal(
    await rpc('private_mail_briefing_complete', [autoBox, day, lease2]),
    true,
  );
  await rpc('private_mail_briefing_release', [autoBox, day, lease2]);
  await db.exec('reset role;');
  await db.query('update public.user_profiles set active=false where id=$1', [
    autoOwner,
  ]);
  await db.exec('set role service_role;');
  assert.equal(
    await rpc('private_mail_job_start', [autoBox, true]),
    null,
    'active profile gate',
  );
  await db.exec('reset role;set role authenticated;');
  await assert.rejects(
    () => rpc('private_mail_job_start', [autoBox, true]),
    /permission denied/,
  );
  await assert.rejects(
    () => rpc('private_mail_automation_tick'),
    /permission denied/,
  );
  console.log(
    'PASS durable queue PostgreSQL: disabled default, scoped jobs, manual lease, fencing, receipt checks, immediate continuation, bounded retries, consent cutoff and revision-safe briefing',
  );
  await db.exec(`reset role;create schema extensions;create extension pgcrypto with schema extensions;
    create schema net;create schema cron;
    create table net.http_request_queue(id bigint,headers jsonb,url text);
    grant all on net.http_request_queue to public;
    create view cron.job as select 'private-mail-recovery'::text jobname,true active,'select public.private_mail_automation_tick()'::text command;
    create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
    create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000)
    returns bigint language plpgsql as $$ declare requests jsonb;begin
      requests=coalesce(nullif(current_setting('private_mail.fixture_requests',true),''),'[]')::jsonb;
      requests=requests||jsonb_build_object('url',url,'body',body,'headers',headers,'timeout',timeout_milliseconds);
      perform set_config('private_mail.fixture_requests',requests::text,false);return jsonb_array_length(requests);end;$$;`);
  await db.exec(
    await readFile(
      new URL('../supabase/sql/private-mail-scheduler.sql', import.meta.url),
      'utf8',
    ),
  );
  const queueAcl = (
    await db.query(
      "select has_column_privilege('anon','net.http_request_queue','headers','SELECT') as anon_headers,has_column_privilege('authenticated','net.http_request_queue','headers','SELECT') as user_headers,has_column_privilege('authenticated','net.http_request_queue','id','SELECT') as user_id,has_table_privilege('authenticated','net.http_request_queue','INSERT') as user_insert,has_table_privilege('authenticated','net.http_request_queue','UPDATE') as user_update,has_table_privilege('service_role','net.http_request_queue','SELECT') as server_read",
    )
  ).rows[0];
  assert.deepEqual(
    queueAcl,
    {
      anon_headers: false,
      user_headers: false,
      user_id: false,
      user_insert: false,
      user_update: false,
      server_read: true,
    },
    'only server actors may read transport credentials or enqueue requests',
  );
  await db.query('update public.user_profiles set active=true where id=$1', [
    autoOwner,
  ]);
  await db.query(
    `update public.private_mailboxes set automation_config='{"enabled":true,"readStateVerified":false,"analysisConsent":true,"analysisConsentAt":"2026-01-01T00:00:00Z"}',
    automation_job=null,automation_dispatch='{}',automation_next_at=null,last_counts='{}',lease=null,lease_until=null,briefing_pages='{}' where id=$1`,
    [autoBox],
  );
  await db.query(
    "update public.private_mail_messages set analysis_status='ready',analysis_lease=null,analysis_lease_until=null where mailbox_id=$1",
    [autoBox],
  );
  await db.exec('set role service_role;');
  assert.equal(
    await rpc('private_mail_scheduler_ready'),
    true,
    'installed cron/net/auth/crypto readiness',
  );
  await db.query(
    "select set_config('private_mail.fixture_requests','[]',false)",
  );
  const capJob = await rpc('private_mail_job_start', [autoBox, false]);
  assert.equal(
    capJob.status,
    'queued',
    'read-state flag remains false without blocking approved automation',
  );
  const requests = async () =>
    (
      await db.query(
        "select current_setting('private_mail.fixture_requests')::jsonb value",
      )
    ).rows[0].value;
  assert.equal((await requests()).length, 1);
  const wire = (await requests())[0];
  assert.equal(
    wire.url,
    'https://sajoansan.vercel.app/api/private-mail-worker',
  );
  assert.equal(wire.timeout, 250000);
  const raw = wire.headers.Authorization.slice('Bearer '.length);
  assert.match(raw, /^pmjob_[0-9a-f]{64}$/);
  const digest = async (token) =>
    (
      await db.query(
        "select rtrim(translate(encode(extensions.digest(convert_to($1,'UTF8'),'sha256'),'base64'),'+/','-_'),'=') value",
        [token],
      )
    ).rows[0].value;
  const firstHash = await digest(raw);
  assert.match(firstHash, /^[A-Za-z0-9_-]{43}$/);
  let dispatchState = (
    await db.query(
      'select automation_dispatch from public.private_mailboxes where id=$1',
      [autoBox],
    )
  ).rows[0].automation_dispatch;
  assert.equal(Object.hasOwn(dispatchState, firstHash), true);
  assert.equal(
    JSON.stringify(dispatchState).includes(raw),
    false,
    'raw capability is absent from persisted state',
  );
  assert.equal(await rpc('private_mail_dispatch_auth', ['invalid']), null);
  assert.equal(
    await rpc('private_mail_dispatch', [autoBox]),
    false,
    'unclaimed dispatch suppressed for sixty seconds',
  );
  assert.equal((await requests()).length, 1);
  let auth = await rpc('private_mail_dispatch_auth', [firstHash]);
  assert.equal(auth.kind, 'collect');
  assert.equal(auth.target, capJob.id);
  assert.equal(auth.jobRunning, false);
  assert.deepEqual(
    await rpc('private_mail_dispatch_auth', [firstHash]),
    auth,
    'same session may authenticate subsequent HTTP calls',
  );
  const initialClaimedAt = (
    await db.query(
      "select automation_dispatch->$2->>'claimedAt' value from public.private_mailboxes where id=$1",
      [autoBox, firstHash],
    )
  ).rows[0].value;
  assert.equal(
    await rpc('private_mail_dispatch', [autoBox]),
    false,
    'auth-to-claim interleave preserves session during sixty-second grace',
  );
  assert.deepEqual(await rpc('private_mail_dispatch_auth', [firstHash]), auth);
  assert.equal(
    (
      await db.query(
        "select automation_dispatch->$2->>'claimedAt' value from public.private_mailboxes where id=$1",
        [autoBox, firstHash],
      )
    ).rows[0].value,
    initialClaimedAt,
    'repeat authentication never extends claimedAt',
  );

  await rpc('private_mail_job_claim', [autoBox, capJob.id, lease]);
  assert.equal(
    (await rpc('private_mail_dispatch_auth', [firstHash])).jobRunning,
    true,
  );
  assert.equal(
    await rpc('private_mail_job_claim', [autoBox, capJob.id, lease2]),
    null,
    'replayed HTTP does not duplicate active work',
  );
  assert.equal(
    await rpc('private_mail_dispatch', [autoBox]),
    false,
    'active job lease skips dispatch',
  );
  await db.query(
    "update public.private_mailboxes set automation_config=jsonb_set(automation_config,'{enabled}','false') where id=$1",
    [autoBox],
  );
  assert.equal(
    (await rpc('private_mail_dispatch_auth', [firstHash])).jobRunning,
    true,
    'paused active chunk remains authorized to finish',
  );
  assert.equal(
    await rpc('private_mail_job_claim', [autoBox, capJob.id, lease2]),
    null,
    'pause blocks all new claims',
  );
  assert.equal(
    await rpc('private_mail_dispatch', [autoBox]),
    false,
    'pause prevents new dispatch',
  );
  assert.equal(
    (
      await rpc('private_mail_job_finish', [
        autoBox,
        capJob.id,
        lease,
        null,
        'POP_FAILED',
      ])
    ).status,
    'stopped',
    'paused chunk finishes with stopped job',
  );
  assert.equal(
    await rpc('private_mail_dispatch_auth', [firstHash]),
    null,
    'finished paused session is revoked',
  );
  await db.query(
    "update public.private_mailboxes set automation_config=jsonb_set(automation_config,'{enabled}','true') where id=$1",
    [autoBox],
  );

  await db.query(
    "update public.private_mailboxes set automation_job=automation_job || jsonb_build_object('status','queued','lease',null,'leaseUntil',null,'notBefore',clock_timestamp()-interval '1 second') where id=$1",
    [autoBox],
  );
  assert.equal(
    await rpc('private_mail_dispatch', [autoBox]),
    true,
    'verified paused finish cleared the old session',
  );
  assert.equal(
    await rpc('private_mail_dispatch_auth', [firstHash]),
    null,
    'finished session stays rejected',
  );
  let latest = (await requests()).at(-1);
  let latestHash = await digest(latest.headers.Authorization.slice(7));
  await rpc('private_mail_dispatch_auth', [latestHash]);
  assert.equal(
    await rpc('private_mail_dispatch', [autoBox]),
    false,
    'claimed session without lease retains the authentication grace',
  );
  await db.query(
    "update public.private_mailboxes set automation_dispatch=jsonb_set(automation_dispatch,array[$2,'claimedAt'],to_jsonb((clock_timestamp()-interval '61 seconds')::text)) where id=$1",
    [autoBox, latestHash],
  );
  assert.equal(
    await rpc('private_mail_dispatch', [autoBox]),
    true,
    'claimed crash before work claim recovers after sixty seconds',
  );
  assert.equal(
    await rpc('private_mail_dispatch_auth', [latestHash]),
    null,
    'recovered old session is rejected',
  );
  latest = (await requests()).at(-1);
  latestHash = await digest(latest.headers.Authorization.slice(7));
  await rpc('private_mail_dispatch_auth', [latestHash]);
  assert.ok(await rpc('private_mail_job_claim', [autoBox, capJob.id, lease2]));
  const nextChunk = {
    id: other,
    requestId: capJob.id,
    startedAt: new Date().toISOString(),
    pending: ['c'.repeat(64)],
    total: 1,
    processed: 0,
    saved: 0,
    skipped: 0,
    undated: 0,
    oversized: 0,
    missing: 0,
    phase: 'collecting',
  };
  await db.query(
    'update public.private_mailboxes set last_counts=$2 where id=$1',
    [autoBox, { cycle: nextChunk }],
  );
  const beforeChunk = (await requests()).length;
  assert.equal(
    (
      await rpc('private_mail_job_finish', [
        autoBox,
        capJob.id,
        lease2,
        nextChunk,
        null,
      ])
    ).status,
    'queued',
  );
  assert.equal(
    (await requests()).length,
    beforeChunk + 1,
    'verified chunk completion dispatches immediately despite claimed grace',
  );
  assert.equal(
    await rpc('private_mail_dispatch_auth', [latestHash]),
    null,
    'chunk completion clears old session',
  );
  latest = (await requests()).at(-1);
  latestHash = await digest(latest.headers.Authorization.slice(7));
  assert.equal(await rpc('private_mail_dispatch', [autoBox]), false);
  await db.query(
    "update public.private_mailboxes set automation_dispatch=jsonb_set(automation_dispatch,array[$2,'issuedAt'],to_jsonb((clock_timestamp()-interval '61 seconds')::text)) where id=$1",
    [autoBox, latestHash],
  );
  assert.equal(
    await rpc('private_mail_dispatch', [autoBox]),
    true,
    'unclaimed lost delivery recovers after sixty seconds',
  );
  latest = (await requests()).at(-1);
  latestHash = await digest(latest.headers.Authorization.slice(7));
  await db.query(
    "update public.private_mailboxes set automation_dispatch=jsonb_set(automation_dispatch,array[$2,'expiresAt'],to_jsonb((clock_timestamp()-interval '1 second')::text)) where id=$1",
    [autoBox, latestHash],
  );
  assert.equal(
    await rpc('private_mail_dispatch_auth', [latestHash]),
    null,
    'expired session rejected',
  );
  await db.query(
    "update public.private_mailboxes set automation_config=jsonb_set(automation_config,'{enabled}','false') where id=$1",
    [autoBox],
  );
  assert.equal(
    await rpc('private_mail_dispatch_auth', [latestHash]),
    null,
    'disabled mailbox rejects session',
  );
  await db.query(
    "update public.private_mailboxes set automation_config=jsonb_set(automation_config,'{enabled}','true'),automation_dispatch='{}',automation_job=null where id=$1",
    [autoBox],
  );
  await db.query(
    "select set_config('private_mail.fixture_requests','[]',false)",
  );
  for (let i = 0; i < 20; i++)
    await db.query(
      `insert into public.private_mail_messages(mailbox_id,owner_id,uidl_hash,content_hash,subject,sender,sent_at,files,analysis_next_at)
    values($1,$2,$3,$3,'cap fixture','sender',now(),'[]',now())`,
      [autoBox, autoOwner, (100 + i).toString(16).padStart(64, '0')],
    );
  let burst = await requests();
  assert.equal(
    burst.length,
    5,
    'five analysis targets per dispatch with duplicate suppression',
  );
  let capMessage = burst[0].body.messageId,
    analysisHash = await digest(burst[0].headers.Authorization.slice(7));
  assert.equal(
    (await rpc('private_mail_dispatch_auth', [analysisHash])).target,
    capMessage,
  );
  await db.query(
    "update public.private_mailboxes set automation_config=jsonb_set(automation_config,'{analysisConsent}','false') where id=$1",
    [autoBox],
  );
  assert.equal(
    await rpc('private_mail_dispatch_auth', [analysisHash]),
    null,
    'revoked analysis consent rejects existing session',
  );
  await db.query(
    "update public.private_mailboxes set automation_config=jsonb_set(automation_config,'{analysisConsent}','true') where id=$1",
    [autoBox],
  );
  await db.query(
    'update public.private_mail_messages set analysis_excluded=true where id=$1',
    [capMessage],
  );
  assert.equal(
    await rpc('private_mail_dispatch_auth', [analysisHash]),
    null,
    'new exclusion rejects existing session',
  );
  await db.query(
    'update public.private_mail_messages set analysis_excluded=false where id=$1',
    [capMessage],
  );
  assert.ok(
    (
      await db.query(
        'select * from public.private_mail_analysis_claim($1,$2)',
        [capMessage, lease],
      )
    ).rows.length,
  );
  assert.equal(
    await rpc('private_mail_analysis_fail', [capMessage, lease, 'AI_FAILED']),
    true,
  );
  assert.equal(
    (
      await db.query(
        'select automation_dispatch ? $2 present from public.private_mailboxes where id=$1',
        [autoBox, analysisHash],
      )
    ).rows[0].present,
    false,
    'verified analysis failure clears its session',
  );
  const nextAnalysis = (await requests()).find(
    (request) =>
      request.body.kind === 'analyze' && request.body.messageId !== capMessage,
  );
  const finishId = nextAnalysis.body.messageId,
    finishHash = await digest(nextAnalysis.headers.Authorization.slice(7));
  await rpc('private_mail_dispatch_auth', [finishHash]);
  assert.ok(
    (
      await db.query(
        'select * from public.private_mail_analysis_claim($1,$2)',
        [finishId, lease2],
      )
    ).rows.length,
  );
  assert.equal(
    await rpc('private_mail_analysis_finish', [
      finishId,
      lease2,
      { summary: 'fixture' },
    ]),
    true,
  );
  assert.equal(
    (
      await db.query(
        'select automation_dispatch ? $2 present from public.private_mailboxes where id=$1',
        [autoBox, finishHash],
      )
    ).rows[0].present,
    false,
    'verified analysis completion clears its session',
  );

  await db.query(
    "update public.private_mailboxes set automation_dispatch='{}' where id=$1",
    [autoBox],
  );
  const pending = (
    await db.query(
      "select id from public.private_mail_messages where mailbox_id=$1 and analysis_status='pending' and not analysis_excluded order by created_at,id",
      [autoBox],
    )
  ).rows;
  const artificial = {};
  for (const [i, row] of pending.slice(0, 16).entries())
    artificial['A'.repeat(41) + String(i).padStart(2, '0')] = {
      kind: 'analyze',
      target: row.id,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      claimed: false,
    };
  await db.query(
    'update public.private_mailboxes set automation_dispatch=$2 where id=$1',
    [autoBox, artificial],
  );
  await rpc('private_mail_dispatch', [autoBox]);
  dispatchState = (
    await db.query(
      'select automation_dispatch from public.private_mailboxes where id=$1',
      [autoBox],
    )
  ).rows[0].automation_dispatch;
  assert.ok(
    Object.keys(dispatchState).length <= 16,
    'hard capability storage limit',
  );
  await db.query(
    'update public.private_mailboxes set enabled=false where id=$1',
    [autoBox],
  );
  assert.equal(
    await rpc('private_mail_dispatch_auth', [analysisHash]),
    null,
    'mailbox disable revokes capabilities immediately',
  );
  await db.query(
    'update public.private_mailboxes set enabled=true where id=$1',
    [autoBox],
  );
  await db.exec('reset role;');
  await db.query('update public.user_profiles set active=false where id=$1', [
    autoOwner,
  ]);
  await db.exec('set role service_role;');
  assert.equal(
    await rpc('private_mail_dispatch_auth', [analysisHash]),
    null,
    'inactive owner revokes capabilities',
  );
  await db.exec('reset role;');
  await db.query('update public.user_profiles set active=true where id=$1', [
    autoOwner,
  ]);
  await db.exec('set role service_role;');
  await db.query(
    "update public.private_mail_messages set analysis_status='ready' where mailbox_id=$1",
    [autoBox],
  );
  const reportDays = {
    '2026-02-01': { dirty: true, revision: 1, pageId: 'app-page-1' },
    '2026-02-02': { dirty: true, revision: 1, pageId: 'app-page-2' },
    '2026-02-03': { dirty: true, revision: 1, pageId: 'app-page-3' },
    '2026-02-04': { dirty: true, revision: 1, pageId: 'app-page-4' },
  };
  await db.query(
    "update public.private_mailboxes set automation_dispatch='{}',automation_job=null,briefing_pages=$2 where id=$1",
    [autoBox, reportDays],
  );
  await db.query(
    "select set_config('private_mail.fixture_requests','[]',false)",
  );
  assert.equal(await rpc('private_mail_dispatch', [autoBox]), true);
  const reports = await requests();
  assert.equal(reports.length, 3, 'at most three report targets per dispatch');
  const reportHash = await digest(reports[0].headers.Authorization.slice(7)),
    reportDay = reports[0].body.day;
  assert.equal(
    (await rpc('private_mail_dispatch_auth', [reportHash])).kind,
    'report',
  );
  const reportCap = (
    await db.query(
      'select automation_dispatch->$2 cap from public.private_mailboxes where id=$1',
      [autoBox, reportHash],
    )
  ).rows[0].cap;
  assert.ok(
    Math.abs(
      Date.parse(reportCap.expiresAt) - Date.parse(reportCap.issuedAt) - 600000,
    ) < 1,
    'ten-minute lifetime',
  );
  await rpc('private_mail_briefing_claim', [autoBox, reportDay, lease]);
  await rpc('private_mail_briefing_complete', [autoBox, reportDay, lease]);
  assert.equal(
    (await rpc('private_mail_dispatch_auth', [reportHash])).kind,
    'report',
    'completed report retains auth until lease release',
  );
  await rpc('private_mail_briefing_release', [autoBox, reportDay, lease]);
  assert.equal(
    await rpc('private_mail_dispatch_auth', [reportHash]),
    null,
    'released clean report session is no longer eligible',
  );
  await db.query(
    "update public.private_mailboxes set automation_dispatch=jsonb_set(automation_dispatch,array[$2,'target'],to_jsonb('not-a-day'::text)) where id=$1",
    [autoBox, reportHash],
  );
  assert.equal(
    await rpc('private_mail_dispatch_auth', [reportHash]),
    null,
    'malformed or changed target fails closed',
  );
  await db.exec('reset role;set role authenticated;');
  await assert.rejects(
    () => rpc('private_mail_dispatch_auth', [analysisHash]),
    /permission denied/,
  );
  await assert.rejects(
    () => rpc('private_mail_dispatch', [autoBox]),
    /permission denied/,
  );
  console.log(
    'PASS dispatch capabilities PostgreSQL: fixed TLS worker, hash-only state, ten-minute sessions, target/consent/exclusion revocation, lease fencing, sixty-second recovery, bounded dispatch and service-only authentication',
  );

  await db.exec('reset role');
  await db.exec(
    await readFile(
      new URL('../supabase/sql/private-mail-manual.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        '../supabase/sql/private-mail-image-transport.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await db.exec('set role service_role');
  await db.query(
    "update public.private_mailboxes set automation_dispatch='{}' where id=$1",
    [autoBox],
  );
  const imageFixture = '11111111-1111-4111-8111-111111111111',
    imageUrl = 'https://placehold.co/480x160.png';
  const imageToken = await rpc('private_mail_image_transport_grant', [
      autoBox,
      autoOwner,
      imageFixture,
      imageUrl,
    ]),
    imageHash = await digest(imageToken);
  const imageCaps = (
    await db.query(
      'select automation_dispatch from public.private_mailboxes where id=$1',
      [autoBox],
    )
  ).rows[0].automation_dispatch;
  assert.ok(imageCaps[imageHash]);
  assert.ok(!JSON.stringify(imageCaps).includes(imageToken));
  assert.equal(
    await rpc('private_mail_image_transport_auth', [
      autoBox,
      imageHash,
      imageFixture,
      'https://placehold.co/other.png',
    ]),
    false,
  );
  assert.equal(
    await rpc('private_mail_image_transport_auth', [
      autoBox,
      imageHash,
      imageFixture,
      imageUrl,
    ]),
    true,
  );
  assert.equal(
    await rpc('private_mail_image_transport_auth', [
      autoBox,
      imageHash,
      imageFixture,
      imageUrl,
    ]),
    false,
  );
  assert.equal(
    await rpc('private_mail_dispatch_target_allowed', [
      autoBox,
      'remote-image',
      fresh,
    ]),
    false,
    'missing URL approval must never return SQL NULL',
  );
  await assert.rejects(
    () =>
      rpc('private_mail_image_transport_grant', [
        autoBox,
        autoOwner,
        fresh,
        imageUrl,
      ]),
    /IMAGE_TRANSPORT_SCOPE/,
  );
  await db.query(
    "update public.private_mailboxes set automation_config=jsonb_set(automation_config,'{remoteImages}',jsonb_build_object($2::text,jsonb_build_object('approvedUrls',jsonb_build_array($3::text)))) where id=$1",
    [autoBox, fresh, imageUrl],
  );
  const approvedImage = await rpc('private_mail_image_transport_grant', [
      autoBox,
      autoOwner,
      fresh,
      imageUrl,
    ]),
    approvedHash = await digest(approvedImage);
  await db.query(
    "update public.private_mailboxes set automation_config=jsonb_set(automation_config,array['remoteImages',$2,'excludedUrls'],jsonb_build_array($3::text)) where id=$1",
    [autoBox, fresh, imageUrl],
  );
  assert.equal(
    await rpc('private_mail_image_transport_auth', [
      autoBox,
      approvedHash,
      fresh,
      imageUrl,
    ]),
    false,
    'explicitly excluded URL must be denied even if approved list overlaps',
  );
  await assert.rejects(
    () =>
      rpc('private_mail_image_transport_grant', [
        autoBox,
        autoOwner,
        fresh,
        imageUrl,
      ]),
    /IMAGE_TRANSPORT_SCOPE/,
  );
  await db.query(
    "update public.private_mailboxes set automation_config=jsonb_set(automation_config,array['remoteImages',$2,'excludedUrls'],'[]') where id=$1",
    [autoBox, fresh],
  );
  await db.query(
    "update public.private_mailboxes set automation_config=jsonb_set(automation_config,array['remoteImages',$2,'approvedUrls'],jsonb_build_array('https://placehold.co/replacement.png')) where id=$1",
    [autoBox, fresh],
  );
  assert.equal(
    await rpc('private_mail_image_transport_auth', [
      autoBox,
      approvedHash,
      fresh,
      imageUrl,
    ]),
    false,
    'revoked URL must fail inside TTL',
  );
  await db.query(
    "update public.private_mailboxes set automation_config=automation_config-'remoteImages' where id=$1",
    [autoBox],
  );
  assert.equal(
    await rpc('private_mail_image_transport_auth', [
      autoBox,
      approvedHash,
      fresh,
      imageUrl,
    ]),
    false,
    'removed approval must fail closed',
  );
  await db.exec('reset role;set role authenticated');
  await assert.rejects(
    () =>
      rpc('private_mail_image_transport_grant', [
        autoBox,
        autoOwner,
        imageFixture,
        imageUrl,
      ]),
    /permission denied/,
  );
  console.log(
    'PASS image capabilities PostgreSQL: no legacy key, hash-only URL-bound one-use transport, missing/revoked approvals deny, no client grants',
  );
} finally {
  await db.close();
}

// Isolated manual-state regressions: no mail-server or OneNote operations.
{
  const manualDb = new PGlite();
  const ownerId = '2a828c2d-9a6f-40d4-8e13-336b591811cc',
    mailboxId = '39045005-313e-42e1-b50c-2394b3b6ff26';
  const received = new Date(Date.now() - 3600000).toISOString();
  const kstDay = (value) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  const tomorrow = new Date(
    Date.parse(kstDay(new Date()) + 'T00:00:00Z') + 86400000,
  )
    .toISOString()
    .slice(0, 10);
  try {
    await manualDb.exec(`create role anon;create role authenticated;create role service_role;
      create table public.user_profiles(id uuid primary key,active boolean);
      create table public.private_mailboxes(id uuid primary key,owner_id uuid,enabled boolean,briefing_pages jsonb default '{}',automation_config jsonb default '{}');
      create table public.private_mail_messages(mailbox_id uuid,owner_id uuid,report_day date,analysis_manual_selected_at timestamptz,analysis_status text,analysis jsonb);
      create function public.private_mail_automation_allowed(uuid) returns boolean language sql as $$select false$$;
      insert into public.user_profiles values('${ownerId}',true);
      insert into public.private_mailboxes(id,owner_id,enabled) values('${mailboxId}','${ownerId}',true);
      grant all on public.user_profiles,public.private_mailboxes,public.private_mail_messages to service_role;`);
    await manualDb.exec(
      await readFile(
        new URL('../supabase/sql/private-mail-manual.sql', import.meta.url),
        'utf8',
      ),
    );
    await manualDb.exec('set role service_role');
    const invoke = async (name, args) =>
      (
        await manualDb.query(
          'select public.' +
            name +
            '(' +
            args.map((_, i) => '$' + (i + 1)).join(',') +
            ') value',
          args,
        )
      ).rows[0].value;
    {
      const { normalizeManualItems } =
        await import('../supabase/functions/onedrive-auth/private-mail-manual.js');
      const requestId = crypto.randomUUID(),
        leaseId = crypto.randomUUID();
      const text =
        '11/2 월\n쿠팡창원 4p 배차입니다.\n하차 13:15\n경상남도 창원시 진해구 두동로 33 A동 5층';
      const claim = await invoke('private_mail_manual_claim', [
        mailboxId,
        ownerId,
        requestId,
        text,
        'a'.repeat(64),
        null,
        leaseId,
      ]);
      const precise = '2026-10-31T06:21:08.135431+00:00';
      const entry = {
        ...claim.entry,
        submittedAt: precise,
        referenceDate: '2026-10-31',
      };
      await manualDb.query(
        'update public.private_mailboxes set manual_entries=jsonb_set(manual_entries,array[$2],$3) where id=$1',
        [mailboxId, entry.entryId, entry],
      );
      const items = normalizeManualItems(
        {
          items: [
            {
              kind: 'dispatch',
              text: '11/2 쿠팡창원 배차 준비 · 4p · 하차 13:15',
              evidence: text,
              serviceOriginal: '11/2',
              dueOriginal: null,
              assignee: null,
              needsConfirmation: false,
            },
          ],
        },
        {
          text,
          entryId: entry.entryId,
          submittedAt: precise,
          referenceDate: entry.referenceDate,
        },
      );
      const saved = await invoke('private_mail_manual_finish', [
        mailboxId,
        ownerId,
        entry.entryId,
        leaseId,
        items,
        null,
        {},
      ]);
      assert.equal(saved.status, 'ready');
      assert.equal(saved.items[0].submittedAt, precise);
      assert.equal(saved.items[0].serviceDate, '2026-11-02');
      assert.equal(saved.items[0].dueAt, null);
      console.log(
        'PASS real manual SQL preserves PostgreSQL microsecond receipt identity through normalization and finish',
      );
    }
    for (const status of ['complete', 'cancelled', 'pending']) {
      const entryId = crypto.randomUUID();
      const item = {
        itemId: 'item-001',
        ref: entryId + ':manual:item-001',
        kind: status === 'pending' ? 'reference' : 'task',
        text: '합성 업무',
        evidence: '합성 처리 이력',
        visibleFrom: kstDay(received),
        receivedAt: received,
        submittedAt: received,
        done: false,
        completedAt: null,
        completionEvents: [],
        workflowStatus: status,
        declaredAt: received,
        ownerStateDeclared: true,
      };
      const initial = {
        entryId,
        status: 'ready',
        submittedAt: received,
        referenceDate: kstDay(received),
        referenceSource: 'received',
        items: [item],
      };
      await manualDb.query(
        "update public.private_mailboxes set manual_entries=$2,briefing_pages='{}' where id=$1",
        [mailboxId, { [entryId]: initial }],
      );
      assert.equal(
        await invoke('private_mail_manual_rollover', [mailboxId, tomorrow]),
        false,
        status + ' must not create empty nextday work',
      );
      assert.equal(
        await invoke('private_mail_report_allowed', [mailboxId, tomorrow]),
        false,
        status + ' alone must not enable an empty report',
      );
      if (status === 'pending') continue;
      await invoke('private_mail_manual_update', [
        mailboxId,
        ownerId,
        entryId,
        'item-001',
        false,
      ]);
      let stored = (
        await manualDb.query(
          'select manual_entries->$2 value from public.private_mailboxes where id=$1',
          [mailboxId, entryId],
        )
      ).rows[0].value;
      assert.equal(stored.items[0].done, false);
      assert.ok(
        stored.items[0].completionEvents.length > 0,
        status + ' explicit reopen must be recorded',
      );
      if (status === 'complete')
        assert.deepEqual(
          stored.items[0].completionEvents.map((e) => e.done),
          [true, false],
        );
      const events = stored.items[0].completionEvents.length;
      await invoke('private_mail_manual_update', [
        mailboxId,
        ownerId,
        entryId,
        'item-001',
        false,
      ]);
      stored = (
        await manualDb.query(
          'select manual_entries->$2 value from public.private_mailboxes where id=$1',
          [mailboxId, entryId],
        )
      ).rows[0].value;
      assert.equal(
        stored.items[0].completionEvents.length,
        events,
        'same-state retry must not invent another event',
      );
      assert.equal(
        await invoke('private_mail_manual_item_state', [
          stored.items[0],
          tomorrow,
        ]).then((x) => x.done),
        false,
      );
    }
    console.log(
      'PASS manual PostgreSQL closure: declared completion/cancellation reopens with immutable history; same-state idempotence; closed/reference-only records do not carry into empty nextday reports',
    );
  } finally {
    await manualDb.close();
  }
}

{
const ROOT=new URL('..',import.meta.url).pathname.replace(/\/$/,''), OWNER='2a828c2d-9a6f-40d4-8e13-336b591811cc', BOX='39045005-313e-42e1-b50c-2394b3b6ff26';
const db=new PGlite({extensions:{pgcrypto}});
try {
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;create table auth.users(id uuid primary key);create table public.user_profiles(id uuid primary key,active boolean);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant select on public.user_profiles to authenticated,service_role;`);
for(const path of ['repo-root/sql/private-mail.sql','supabase/sql/private-mail-automation.sql','supabase/sql/private-mail-filters.sql','supabase/sql/private-mail-manual.sql','supabase/sql/private-mail-history.sql','supabase/sql/private-mail-message-dates.sql','supabase/sql/private-mail-jev-review.sql']) await db.exec(await readFile(ROOT+'/'+path,'utf8'));
await db.query('insert into auth.users values($1)',[OWNER]);await db.query('insert into user_profiles values($1,true)',[OWNER]);await db.query("insert into private_mailboxes(id,owner_id,account,drive_id,folder_id,enabled) values($1,$2,'jhs96@eangroup.kr','isolated-drive','isolated-folder',true)",[BOX,OWNER]);await db.exec('set role service_role');
let count=0;
const seed=async()=>{const id='f0000000-0000-4000-8000-'+String(++count).padStart(12,'0');const item={itemId:'item-001',ref:id+':manual:item-001',kind:'task',text:'합성 확인',evidence:'합성 확인',done:false,completionEvents:[]};const entry={entryId:id,status:'ready',text:'합성 확인',textHash:'a'.repeat(64),submittedAt:'2026-10-31T00:00:00Z',referenceDate:'2026-10-31',items:[item]};await db.query('update private_mailboxes set manual_entries=jsonb_set(manual_entries,array[$2],$3) where id=$1',[BOX,id,entry]);return entry;};
const row=async e=>(await db.query('select manual_entries->$2 value from private_mailboxes where id=$1',[BOX,e.entryId])).rows[0].value;
const history=async()=>(await db.query('select history_id,payload from private_mail_analysis_history order by history_id')).rows;
const save=async(e,r)=>(await db.query('select public.private_mail_manual_jev_review($1,$2,$3,$4,$5,$6) value',[BOX,OWNER,e.entryId,e.textHash,e.items,r])).rows[0].value;
const review=(e,v=2)=>({sourceId:e.entryId,sourceRevision:null,policyVersion:'manual-semantics-v'+v,status:'review',model:'jev-1.14.0',findings:[{id:e.entryId+(v===2?':coverage':':manual:item-001'),unsupportedProbability:.9}],reviewIds:[e.entryId+(v===2?':coverage':':manual:item-001')],...(v===2?{coverageChecked:true,coverageUnavailable:null}:{})});
const legacy=await seed(), v1=review(legacy,1);assert.equal(await save(legacy,v1),true);assert.deepEqual((await row(legacy)).jevReview,v1);const legacyHistory=await history();
const current=await seed(), v2=review(current);assert.equal(await save(current,v2),true);assert.deepEqual((await row(current)).jevReview,v2);assert.deepEqual((await row(current)).items,current.items);
const snapshots=await history();for(const old of legacyHistory)assert.ok(snapshots.some(x=>x.history_id===old.history_id&&x.payload===old.payload));assert.ok(snapshots.some(x=>JSON.parse(x.payload).structuredResult.jevReview?.policyVersion==='manual-semantics-v2'));
assert.equal(await save(legacy,{...review(legacy),status:'no_concerns'}),false);assert.deepEqual((await row(legacy)).jevReview,v1);assert.deepEqual(await history(),snapshots);
for(const [label,mutate] of [
 ['cross-entry coverage',r=>{r.findings[0].id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee:coverage';r.reviewIds=[r.findings[0].id];}],
 ['missing finding ID',r=>{delete r.findings[0].id;r.reviewIds=[];}],['null finding ID',r=>{r.findings[0].id=null;r.reviewIds=[];}],
 ['string flag',r=>r.coverageChecked='true'],['null flag',r=>r.coverageChecked=null],
 ['unknown unavailable',r=>r.coverageUnavailable='SECRET_TEXT'],['numeric unavailable',r=>r.coverageUnavailable=3],
 ['false with coverage finding',r=>r.coverageChecked=false],['true without coverage finding',r=>{r.findings=[];r.reviewIds=[];}],
 ['checked and unavailable',r=>r.coverageUnavailable='INPUT_TOO_LARGE'],
 ['v1 cannot use coverage',r=>{r.policyVersion='manual-semantics-v1';delete r.coverageChecked;delete r.coverageUnavailable;}],
 ['v1 cannot use flag',r=>{r.policyVersion='manual-semantics-v1';r.findings[0].id=r.sourceId+':manual:item-001';r.reviewIds=[r.findings[0].id];}],
]) {const e=await seed(),r=review(e);mutate(r);const before=await history();await assert.rejects(()=>save(e,r),/JEV_REVIEW_FORMAT/,label);assert.equal((await row(e)).jevReview,undefined,label);assert.deepEqual(await history(),before,label);}
const large=await seed(), unavailable={...review(large),status:'unavailable',code:'INVALID_INPUT',findings:[],reviewIds:[],coverageChecked:false,coverageUnavailable:'INPUT_TOO_LARGE'};assert.equal(await save(large,unavailable),true);assert.deepEqual((await row(large)).jevReview,unavailable);
const prior=await row(current);assert.equal(await save(current,v2),false);assert.deepEqual(await row(current),prior);
console.log('PASS local PGlite JEV SQL: v1/v2 save/read, tightly typed coverage and entry identity, malformed flags rejected, prior v1 immutable, original items/history preserved; network disabled');
} finally {await db.close();}
}
