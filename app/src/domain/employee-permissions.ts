import { FEATURE_CATALOG, resourceFeatureRestriction } from './feature-catalog';
import { effectivePermission } from './portal-permissions';
import type { PermissionConfig, PortalMember } from './portal-types';

type Person = Pick<PortalMember, 'active' | 'role' | 'centers'> &
  Partial<Pick<PortalMember, 'id'>>;
const catalogs = [
  'routes',
  'delivery_points',
  'drivers',
  'vehicles',
  'companies',
];

export function permissionCategory(config: PermissionConfig) {
  const feature = FEATURE_CATALOG.find(
    (item) => item.resource === config.resource,
  );
  if (feature) return feature.category;
  if (
    [
      'tasks',
      'forms',
      'incidents',
      'hq',
      'briefing',
      'notifications',
      'history',
      'search',
      'trash',
    ].includes(config.resource)
  )
    return 'daily';
  if (['mail', 'backups', 'connections'].includes(config.resource))
    return 'documents';
  return 'administration';
}

export function permissionTitle(config: PermissionConfig) {
  if (config.resource === 'permissions') return '직원별 업무 권한';
  if (config.resource === 'members') return '직원 역할·담당 범위';
  return config.title;
}

export function sharedPermission(resource: string) {
  const pages = FEATURE_CATALOG.filter(
    (item) => item.resource === resource && item.href && !item.parent,
  );
  return (
    pages.length > 0 && pages.every((item) => item.navigationScope === 'shared')
  );
}

// The SQL resource predicate determines access; feature restrictions are an
// additional page boundary, never an alternative grant or a data-scope filter.
export function employeePermissionSummary(
  config: PermissionConfig,
  person: Person,
  centers: { code: string }[],
  centerName: (code: string) => string,
) {
  const restriction = resourceFeatureRestriction(config.resource, person);
  const reason = !person.active
    ? '비활성 계정'
    : (restriction ??
      (config.admin_only && person.role !== 'admin' ? '관리자 전용' : null));
  const shared = sharedPermission(config.resource);
  const overview = reason
    ? { read: false, edit: false }
    : effectivePermission(config, person);
  function scope(action: 'read' | 'edit') {
    if (!overview[action]) return '허용 안 함';
    if (shared) return '공용 도구';
    const allowed = centers.filter(
      (center) => effectivePermission(config, person, center.code)[action],
    );
    const unclassified =
      catalogs.includes(config.resource) &&
      effectivePermission(config, person, '')[action];
    if (
      allowed.length === centers.length &&
      centers.length &&
      (!catalogs.includes(config.resource) || unclassified)
    )
      return catalogs.includes(config.resource)
        ? '전체 자료 · 미분류 포함'
        : '전체 센터 자료';
    const names = allowed.map((center) => centerName(center.code));
    if (unclassified) names.push('미분류');
    return names.join(' · ') || '접근 가능한 센터 자료 없음';
  }
  return {
    ...overview,
    reason,
    shared,
    level: overview.edit
      ? ('edit' as const)
      : overview.read
        ? ('read' as const)
        : ('none' as const),
    label: overview.edit ? '사용' : overview.read ? '조회' : '불가',
    readScope: scope('read'),
    editScope: scope('edit'),
    fixed: person.role === 'admin' || !!config.admin_only || !!restriction,
  };
}
