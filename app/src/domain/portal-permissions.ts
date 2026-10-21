import type {
  PortalMember,
  PermissionConfig,
  PermissionRule,
} from './portal-types';
export const centerEditResources = [
  'tasks',
  'forms',
  'trash',
  'drivers',
  'vehicles',
  'companies',
  'delivery_points',
  'routes',
  'transfers',
  'charter',
  'dispatch_parser',
  'one_top',
];
export function effectivePermission(
  config: PermissionConfig,
  person: Pick<PortalMember, 'active' | 'role' | 'centers'>,
  center?: string,
) {
  if (!person?.active || !config) return { read: false, edit: false };
  if (person.role === 'admin') return { read: true, edit: true };
  if (config.admin_only) return { read: false, edit: false };
  const memberships = person.centers ?? [],
    matches = (rule: PermissionRule) =>
      !!rule &&
      (rule.everyone === true ||
        (rule.roles ?? []).includes(person.role) ||
        (rule.centers ?? []).some((c) => memberships.includes(c))) &&
      (rule.scope === 'all' ||
        (rule.scope === 'own' &&
          (center ? memberships.includes(center) : memberships.length > 0))),
    edit =
      (person.role === 'editor' ||
        ['incidents', 'notifications'].includes(config.resource)) &&
      matches(config.write_rule) &&
      (!centerEditResources.includes(config.resource) ||
        (center ? memberships.includes(center) : memberships.length > 0));
  return { read: matches(config.read_rule) || edit, edit };
}
export const memberRoleLabels: Record<string, string> = {
  admin: '관리자 · 배송팀',
  editor: '센터 업무 담당',
  viewer: '조회 전용',
};
