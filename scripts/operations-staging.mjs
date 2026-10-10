import { readFile } from 'node:fs/promises';
const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (ref !== 'yvdialfqlbpjbbmcetev' || !token?.startsWith('sbp_fc')) throw Error('Only isolated staging is allowed');
const file = process.argv[2];
if (!['bootstrap', 'migrate', 'test', 'workflow', 'test-workflow', 'templates', 'test-templates','notion','test-notion'].includes(file)) throw Error('Unknown staging operation');
const sql = file === 'bootstrap' ? `begin;
create table if not exists public.centers(code text primary key,name text not null,active boolean not null default true);
create table if not exists public.user_profiles(id uuid primary key references auth.users(id),email text,display_name text,role text not null check(role in ('viewer','editor','admin')),active boolean not null default true);
alter table public.centers enable row level security;
alter table public.user_profiles enable row level security;
drop policy if exists profiles_self on public.user_profiles;
create policy profiles_self on public.user_profiles for select to authenticated using(id=auth.uid());
drop policy if exists centers_active on public.centers;
create policy centers_active on public.centers for select to authenticated using(active and auth.uid() is not null);
revoke all on public.centers,public.user_profiles from anon,authenticated;
grant select on public.centers,public.user_profiles to authenticated;
insert into public.centers(code,name) values('001','사조안산센터'),('002','사조평택센터') on conflict do nothing;
commit;` : await readFile(new URL({ migrate: '../repo-root/sql/operations-core.sql', test: '../tests/operations-core.integration.sql',
  workflow: '../repo-root/sql/operations-workflow.sql', 'test-workflow': '../tests/operations-workflow.integration.sql',
  templates: '../repo-root/sql/operations-templates.sql', 'test-templates': '../tests/operations-templates.integration.sql',
  notion:'../repo-root/sql/operations-notion.sql','test-notion':'../tests/operations-notion.integration.sql' }[file], import.meta.url), 'utf8');
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(60000)
});
if (!response.ok) throw Error(`Staging ${file}: HTTP ${response.status}: ${await response.text()}`);
const result = await response.json();
console.log(`Staging ${file} succeeded`, file.startsWith('test') ? JSON.stringify(result) : '');
