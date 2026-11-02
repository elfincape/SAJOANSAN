// Assemble an atomic owner-only activation from the reviewed native core and monthly extension.
// This module never connects to a database or applies SQL.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const OWNER = '2a828c2d-9a6f-40d4-8e13-336b591811cc';
function replace(source, before, after) {
  if (!source.includes(before)) throw Error('MONTHLY_ACTIVATION_CONTRACT');
  return source.replace(before, after);
}
export function monthlyOwnerOnlyCore(source) {
  source = replace(source, "work_scope='delivery_team' and center_code is null and inputs ? 'personal_work'",
    "work_scope='delivery_team' and center_code is null and inputs ? 'personal_monthly' and owner_id='" + OWNER + "'::uuid");
  source = replace(source, "where inputs ? 'personal_work';", "where inputs ? 'personal_monthly';");
  source = replace(source, 'for each row execute function public.private_mail_portal_task_guard();',
    "for each row when(new.inputs ? 'personal_monthly' or new.template_snapshot->'spec' ? 'personal_monthly') execute function public.private_mail_portal_task_guard();");
  source = replace(source, 'for each row execute function public.private_mail_portal_task_dirty();',
    "for each row when(new.inputs ? 'personal_monthly') execute function public.private_mail_portal_task_dirty();");
  source = replace(source, "where t.owner_id=p_user and t.inputs ? 'personal_work'", "where t.owner_id=p_user and t.inputs ? 'personal_monthly'");
  const anchor = "marker=p_document->'inputs'->'personal_work';ref=marker->>'workId';";
  return replace(source, anchor, anchor + "\n if p_user<>'" + OWNER + "'::uuid or not exists(select 1 from public.operations_tasks where owner_id=p_user and inputs ? 'personal_monthly' and inputs #>> '{personal_work,workId}'=ref) then raise exception 'MONTHLY_EXISTING_TARGET_ONLY';end if;");
}
export function monthlyActivationSql(core, monthly) {
  const scoped = monthlyOwnerOnlyCore(core).trimEnd();
  if (!scoped.endsWith('commit;') || !monthly.includes('\nbegin;')) throw Error('MONTHLY_ACTIVATION_CONTRACT');
  return scoped.slice(0, -7) + monthly.replace('\nbegin;', '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== '--print') throw Error('Only --print is supported; no database operation is performed');
  const [core, monthly] = await Promise.all(['private-mail-portal.sql', 'private-mail-monthly.sql'].map(name =>
    readFile(new URL('../supabase/sql/' + name, import.meta.url), 'utf8')));
  process.stdout.write(monthlyActivationSql(core, monthly));
}
