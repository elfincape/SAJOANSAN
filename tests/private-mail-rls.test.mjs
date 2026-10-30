import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// Optional isolated PostgreSQL runtime; not an application dependency.
if (!process.env.PGLITE_MODULE)
  throw Error(
    'Set PGLITE_MODULE to a local @electric-sql/pglite dist/index.js',
  );
const { PGlite } = await import(process.env.PGLITE_MODULE);
const db = new PGlite();
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
} finally {
  await db.close();
}
