import { PAGE_PATHS } from '../page-paths';

type Guard = (recheck?: boolean) => boolean | Promise<boolean>;
const guards = new Set<Guard>();
// Tools with document-owned styles or upload/unload lifecycles keep native navigation.
const continuousPages = new Set(['Portal', 'AdminHub', 'Dashboard', 'Companies', 'Vehicles', 'DeliveryPoints', 'Routes', 'Settings', 'Users', 'AuditLog']);
let navigate: ((url: URL, guarded: boolean) => void) | undefined;
export function registerWorkspaceNavigationGuard(guard: Guard) {
  guards.add(guard);
  return () => { guards.delete(guard); };
}
export async function allowWorkspaceNavigation(recheck = false) {
  for (const guard of guards) if (!await guard(recheck)) return false;
  return true;
}
export function workspaceDestination(href: string) {
  const url = new URL(href, location.href);
  const source = PAGE_PATHS[location.pathname as keyof typeof PAGE_PATHS];
  const destination = PAGE_PATHS[url.pathname as keyof typeof PAGE_PATHS];
  if (url.origin !== location.origin || !source || !destination ||
    !continuousPages.has(source) || !continuousPages.has(destination) ||
    url.pathname === '/login.html' || location.pathname === '/login.html' ||
    window !== window.top || new URLSearchParams(location.search).get('embedded') === '1' ||
    url.searchParams.has('embedded') || url.searchParams.has('portal_task')) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return url;
}
export function navigateWorkspace(href: string, guarded = false) {
  const url = workspaceDestination(href);
  if (url && navigate) navigate(url, guarded);
  else location.assign(href);
}
export function installWorkspaceNavigation(handler: NonNullable<typeof navigate>) {
  navigate = handler;
  return () => { navigate = undefined; };
}
