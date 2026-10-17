import { getCenterByCode, withCenterParam } from './center.js';
import { permissionAllowed } from './portal-permissions.js';

const portalResources = new Set([
  'tasks',
  'incidents',
  'forms',
  'search',
  'notifications',
  'hq',
  'history',
  'trash',
]);
export const applicationAreas = [
  { href: '/portal/', label: '업무 포털', area: 'portal' },
  { href: '/admin/', label: '관리 허브', area: 'admin' },
  { href: '/', label: '대시보드', area: 'dashboard' },
];

export function applicationAreaForPath(path = location.pathname) {
  if (path === '/portal' || path.startsWith('/portal/')) return 'portal';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  return 'dashboard';
}

export function renderWorkspaceNavigation(
  host,
  { profile, permissions, center },
) {
  const selected = getCenterByCode(center);
  const manager = ['editor', 'admin'].includes(profile?.role);
  const canManage =
    manager ||
    Object.keys(permissions?.access || {}).some(
      (resource) =>
        !portalResources.has(resource) &&
        permissionAllowed(
          permissions,
          resource,
          'read',
          selected?.code || center,
        ),
    );
  const area = applicationAreaForPath();
  const links = [];
  for (const destination of applicationAreas) {
    if (destination.area === 'admin' && !canManage) continue;
    if (destination.area === 'dashboard' && !manager) continue;
    const link = document.createElement('a');
    link.className = 'workspace-link';
    link.textContent = destination.label;
    if (destination.area === area) link.setAttribute('aria-current', 'page');
    // Never send a portal-only center to the admin's default center.
    if (selected) link.href = withCenterParam(destination.href, selected);
    else if (destination.area === 'portal') {
      const url = new URL(destination.href, location.origin);
      if (center) url.searchParams.set('center', center);
      link.href = url.pathname + url.search;
    } else {
      link.setAttribute('aria-disabled', 'true');
      link.title = '선택한 센터에서는 이 화면을 사용할 수 없습니다.';
    }
    links.push(link);
  }
  host.replaceChildren(...links);
}
