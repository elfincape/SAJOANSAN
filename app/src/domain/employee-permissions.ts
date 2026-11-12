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

export function permissionActions(resource: string, role: string) {
  if (resource === 'notifications')
    return { read: '조회', edit: '조회·알림 확인' };
  if (resource === 'incidents' && role === 'viewer')
    return { read: '조회', edit: '조회·처리 상태 변경' };
  if (catalogs.includes(resource))
    return { read: '조회', edit: '조회·등록·수정·삭제' };
  if (
    [
      'distance_tools',
      'gimhae_dispatch',
      'pdf_converter',
      'straightener',
      'excel_compare',
      'pallet_slips',
      'temperature',
      'haul',
      'coupang',
      'dispatch_parser',
      'one_top',
      'charter',
      'busan',
    ].includes(resource)
  )
    return { read: '열기·조회', edit: '사용·저장' };
  return { read: '조회', edit: '조회·수정' };
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
  const actions = permissionActions(config.resource, person.role);
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
    actions,
    label: overview.edit
      ? actions.edit
      : overview.read
        ? actions.read
        : '접근 불가',
    readScope: scope('read'),
    editScope: scope('edit'),
    fixed: person.role === 'admin' || !!config.admin_only || !!restriction,
  };
}
