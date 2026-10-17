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
 grant select on public.user_profiles to authenticated;
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
} finally {
  await db.close();
}
