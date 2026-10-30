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
  person: Pick<PortalMember, 'active' | 'role' | 'centers'> &
    Partial<Pick<PortalMember, 'id'>>,
  center?: string,
) {
  if (!person?.active || !config) return { read: false, edit: false };
  if (person.role === 'admin') return { read: true, edit: true };
  if (config.admin_only) return { read: false, edit: false };
  if (
    person.id &&
    config.member_overrides &&
    Object.prototype.hasOwnProperty.call(config.member_overrides, person.id)
  ) {
    const override = config.member_overrides[person.id];
    if (
      !override ||
      !['none', 'read', 'edit'].includes(override.level) ||
      !['own', 'all'].includes(override.scope)
    )
      return { read: false, edit: false };
    const inScope =
      override.scope === 'all' ||
      (override.scope === 'own' &&
        (center ? person.centers.includes(center) : person.centers.length > 0));
    const read = override.level !== 'none' && inScope;
    const edit =
      read &&
      override.level === 'edit' &&
      (person.role === 'editor' ||
        ['incidents', 'notifications'].includes(config.resource)) &&
      (!centerEditResources.includes(config.resource) ||
        (center ? person.centers.includes(center) : person.centers.length > 0));
    return { read, edit };
  }
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
