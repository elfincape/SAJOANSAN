import { pageTitle } from '../page-paths';
import { CenterSwitcher } from './CenterSwitcher';
import { useWorkspaceScroll } from './useWorkspaceScroll';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  navigateWorkspace,
  registerWorkspaceNavigationGuard,
} from '../lib/workspace-navigation';
import { getLoadedAuthContext, loadAuthContext } from '../lib/auth';
import type { AuthContext } from '../lib/auth';
import {
  CENTERS,
  getSelectedCenter,
  setSelectedCenterCode,
  withCenterParam,
} from '../lib/center';
import type { Center } from '../lib/center';
import { permissionAllowed, resourceForPath } from '../lib/permissions';
import {
  FEATURE_CATALOG,
  FEATURE_CATEGORIES,
  featureForPath,
} from '../domain/feature-catalog';
import {
  loadPrivateFeatures,
  subscribePrivateFeatures,
} from '../lib/private-features';
import { featureAccessible } from '../lib/feature-access';
import { WorkspaceFrame } from './WorkspaceFrame';
import type { WorkspaceCommand } from './WorkspaceCommands';

type CenterChangeGuard = () => boolean | Promise<boolean>;
interface PageContext extends AuthContext {
  center: Center;
  editable: boolean;
  controlsDisabled: boolean;
  centerChangeGuard: React.MutableRefObject<CenterChangeGuard | null>;
  setCenterChangeGuard: (guard: CenterChangeGuard | null) => void;
  setControlsDisabled: (disabled: boolean) => void;
}
const Context = createContext<PageContext | null>(null);
export function useAdminPage() {
  const context = useContext(Context);
  if (!context) throw new Error('관리 화면 컨텍스트가 없습니다.');
  return context;
}
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
function activePath(href: string) {
  const path = new URL(href, location.origin).pathname;
  if (path === '/admin/')
    return ['/admin/', '/admin/index.html'].includes(location.pathname);
  if (
    path === '/admin/routes.html' &&
    location.pathname === '/admin/route-edit.html'
  )
    return true;
  return path === location.pathname;
}

function Shell({
  title,
  children,
  actions,
  centerTarget,
  mainId = 'work-main',
  area = 'admin',
  accountActions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  centerTarget?: string;
  mainId?: string;
  area?: 'admin' | 'dashboard';
  accountActions?: ReactNode;
}) {
  const { profile, permissions, center, controlsDisabled, centerChangeGuard } =
    useAdminPage();
  useEffect(
    () => registerWorkspaceNavigationGuard(() => !controlsDisabled),
    [controlsDisabled],
  );
  useWorkspaceScroll(area !== 'dashboard');
  const [features, setFeatures] = useState(() => loadPrivateFeatures(profile));
  useEffect(
    () =>
      subscribePrivateFeatures(() => setFeatures(loadPrivateFeatures(profile))),
    [profile],
  );
  const manager = ['editor', 'admin'].includes(profile.role);
  const canManage =
    manager ||
    FEATURE_CATALOG.some(
      (f) =>
        f.href?.startsWith('/admin/') &&
        f.resource &&
        featureAccessible(f, profile, permissions, center.code, features),
    ) ||
    Object.keys(permissions.access || {}).some(
      (resource) =>
        !portalResources.has(resource) &&
        permissionAllowed(permissions, resource, 'read', center.code),
    );
  const menus =
    area === 'admin'
      ? FEATURE_CATALOG.filter(
          (f) =>
            f.href &&
            f.hub !== false &&
            f.href !== '/portal/' &&
            featureAccessible(f, profile, permissions, center.code, features),
        )
      : [];
  function navigateTo(href: string) {
    void (async () => {
      if (
        controlsDisabled ||
        (centerChangeGuard.current && !(await centerChangeGuard.current()))
      )
        return;
      navigateWorkspace(withCenterParam(href, center), true);
    })();
  }
  const commands: WorkspaceCommand[] = FEATURE_CATALOG.filter(
    (f) =>
      f.href &&
      f.hub !== false &&
      featureAccessible(f, profile, permissions, center.code, features),
  ).map((f) => ({
    id: f.id,
    title: f.title,
    description: f.desc,
    group: FEATURE_CATEGORIES[f.category],
    run: () => navigateTo(f.href!),
  }));
  if (permissionAllowed(permissions, 'search', 'read'))
    commands.unshift({
      id: 'workspace-search',
      title: '업무 검색',
      group: '주요 화면',
      run: () => navigateTo('/portal/?view=search'),
    });
  if (canManage)
    commands.unshift({
      id: 'adminHub',
      title: '관리 허브',
      description: '관리 도구 전체 보기',
      group: '주요 화면',
      run: () => navigateTo('/admin/'),
    });
  if (manager)
    commands.unshift({
      id: 'dashboard',
      title: '대시보드',
      description: '코스·납품 현황 조회',
      group: '주요 화면',
      run: () => navigateTo('/'),
    });
  return (
    <WorkspaceFrame
      mainId={mainId}
      brandHref={withCenterParam('/portal/', center)}
      disabled={controlsDisabled}
      userName={profile.display_name || profile.email || '사용자'}
      commands={commands}
      actions={actions}
      accountActions={accountActions}
      location={
        <>
          {area === 'admin' && title !== '관리 허브' ? (
            <>
              <a href={withCenterParam('/admin/', center)}>관리 허브</a>
              <span className="app-path-divider" aria-hidden="true">
                /
              </span>
            </>
          ) : null}
          <h1>{title}</h1>
        </>
      }
      navigation={
        <>
          {' '}
          <nav id="app-workspace-navigation" aria-label="주요 화면">
            {[
              { href: '/portal/', label: '업무 포털', show: true },
              { href: '/admin/', label: '관리 허브', show: canManage },
              { href: '/', label: '대시보드', show: manager },
            ]
              .filter((item) => item.show)
              .map((item) => (
                <a
                  key={item.href}
                  className="workspace-link"
                  href={withCenterParam(item.href, center)}
                  aria-current={
                    item.href === (area === 'dashboard' ? '/' : '/admin/')
                      ? activePath(item.href)
                        ? 'page'
                        : 'location'
                      : undefined
                  }
                >
                  {item.label}
                </a>
              ))}
          </nav>
          <div className="app-local-menu">
            <nav aria-label="관리 업무">
              {Object.entries(FEATURE_CATEGORIES).map(([category, label]) => {
                const items = menus.filter(
                  (menu) => menu.category === category,
                );
                return items.length ? (
                  <details
                    key={category}
                    name="workspace-navigation"
                    className="work-nav-group"
                    open={
                      category ===
                      (menus.find((item) => activePath(item.href!))?.category ??
                        'transport')
                    }
                  >
                    <summary>{label}</summary>
                    {items.map((item) => (
                      <a
                        key={item.id}
                        href={withCenterParam(item.href!, center)}
                        data-center-link="true"
                        className="app-function-link"
                        aria-current={
                          activePath(item.href!) ? 'page' : undefined
                        }
                      >
                        <span>{item.title}</span>
                      </a>
                    ))}
                  </details>
                ) : null;
              })}
            </nav>
          </div>
        </>
      }
      currentLocation={
        <div className="workspace-current-location">
          <span>현재 화면</span>
          <strong>{title}</strong>
          <small>
            {center.shortName} ·{' '}
            {profile.role === 'admin'
              ? '관리자'
              : profile.role === 'editor'
                ? '업무 담당'
                : '조회 전용'}
          </small>
        </div>
      }
      centerControl={
        <CenterSwitcher
          disabled={controlsDisabled}
          value={center.code}
          options={CENTERS.map((item) => ({
            value: item.code,
            label: item.shortName,
          }))}
          onChange={async (code) => {
            if (
              centerChangeGuard.current &&
              !(await centerChangeGuard.current())
            )
              return;
            const next = setSelectedCenterCode(code);
            if (next)
              location.replace(
                withCenterParam(
                  centerTarget ||
                    location.pathname + location.search + location.hash,
                  next,
                ),
              );
          }}
        />
      }
    >
      {children}
    </WorkspaceFrame>
  );
}

export function AdminPage({
  title,
  feature,
  minRole = 'editor',
  bodyClass = 'bg-zinc-900 text-zinc-100 min-h-screen',
  children,
  actions,
  centerTarget,
  mainId,
  area = 'admin',
  accountActions,
}: {
  title: string;
  feature?: string;
  minRole?: 'viewer' | 'editor' | 'admin';
  bodyClass?: string;
  children: ReactNode;
  actions?: ReactNode;
  centerTarget?: string;
  mainId?: string;
  area?: 'admin' | 'dashboard';
  accountActions?: ReactNode;
}) {
  const params = new URLSearchParams(location.search);
  const portalEmbedded = params.has('portal_task') && parent !== window;
  const embedded = params.get('embedded') === '1' || portalEmbedded;
  const [auth, setAuth] = useState<AuthContext | null>(
    () => getLoadedAuthContext() ?? null,
  );
  const [error, setError] = useState('');
  const [controlsDisabled, setControlsDisabled] = useState(false);
  const centerChangeGuard = useRef<CenterChangeGuard | null>(null);
  const setCenterChangeGuard = useCallback(
    (guard: CenterChangeGuard | null) => {
      centerChangeGuard.current = guard;
    },
    [],
  );
  const [center, setCenter] = useState(() =>
    new URLSearchParams(location.search).get('selectCenter') === '1'
      ? null
      : getSelectedCenter(),
  );
  useLayoutEffect(() => {
    document.title = pageTitle(location.pathname) ?? `${title} · EAN`;
    document.body.className = `workspace-ui work-shell ${embedded ? 'work-embedded' : 'app-shell'} ${bodyClass}`;
    document.body.dataset.appArea = area;
    let active = true;
    void loadAuthContext()
      .then((context) => {
        if (active) setAuth(context);
      })
      .catch(() => {
        if (active)
          setError(
            '로그인 상태를 확인하지 못했습니다. 연결을 확인한 뒤 새로고침해 주세요.',
          );
      });
    return () => {
      active = false;
    };
  }, [title, bodyClass, embedded, area]);
  if (error)
    return (
      <p className="text-sm text-red-400 p-3" role="alert">
        {error}
      </p>
    );
  if (!auth)
    return (
      <div className="workspace-loading" role="status">
        <span className="workspace-spinner" aria-hidden="true" />
        로그인과 작업 권한을 확인하고 있습니다.
      </div>
    );
  if (!center)
    return (
      <div
        id="center-selection-overlay"
        className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4"
      >
        <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl p-6">
          <div className="text-center mb-5">
            <div className="text-lg font-semibold">센터를 선택하세요</div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            {CENTERS.map((item) => (
              <button
                key={item.code}
                type="button"
                data-center-code={item.code}
                className="rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-emerald-600/20 hover:border-emerald-500 p-4 text-left transition"
                onClick={() => setCenter(setSelectedCenterCode(item.code))}
              >
                <div className="text-sm font-semibold">{item.name}</div>
                <div className="text-xs text-zinc-500 mt-1">
                  이 센터 데이터로 이동합니다
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  const pageFeature = featureForPath(location.href);
  const resource = resourceForPath(location.pathname);
  const rank = { viewer: 1, editor: 2, admin: 3 };
  const allowedHub =
    ['/admin/', '/admin/index.html'].includes(location.pathname) &&
    Object.entries(auth.permissions.access).some(
      ([key, value]) => value.read && !portalResources.has(key),
    );
  const denied = resource
    ? pageFeature
      ? !featureAccessible(
          pageFeature,
          auth.profile,
          auth.permissions,
          center.code,
          loadPrivateFeatures(auth.profile),
        )
      : !permissionAllowed(auth.permissions, resource, 'read', center.code)
    : !allowedHub && rank[auth.profile.role] < rank[minRole];
  if (denied)
    return (
      <div id="modal-root">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="접근 권한"
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <div className="w-full max-w-md mx-4 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-2xl p-5">
            <p>
              {resource
                ? '이 목록의 열람 권한이 없습니다.'
                : `이 페이지에 접근할 권한이 없습니다. 필요 권한: ${minRole} 현재 권한: ${auth.profile.role}`}
            </p>
            <button
              type="button"
              className="btn btn-primary mt-4"
              onClick={() => location.replace(resource ? '/portal/' : '/')}
            >
              확인
            </button>
          </div>
        </div>
      </div>
    );
  if (feature && !loadPrivateFeatures(auth.profile)[feature]) {
    location.replace(withCenterParam('/admin/', center));
    return null;
  }
  const editable =
    !resource ||
    permissionAllowed(auth.permissions, resource, 'edit', center.code);
  return (
    <Context.Provider
      value={{
        ...auth,
        center,
        editable,
        controlsDisabled,
        setControlsDisabled,
        centerChangeGuard,
        setCenterChangeGuard,
      }}
    >
      {embedded ? (
        <>
          {portalEmbedded ? null : (
            <header className="border-b border-zinc-800 sticky top-0 z-30 bg-zinc-900/95 backdrop-blur">
              <div className="max-w-[1500px] mx-auto px-4 py-3 flex items-center gap-3">
                <a
                  href={withCenterParam('/admin/', center)}
                  className="text-xs text-zinc-400 hover:text-zinc-100"
                >
                  ← 관리 허브
                </a>
                <h1 className="text-base font-semibold">{title}</h1>
                <div className="flex-1" />
                <span id="user-badge" className="text-xs text-zinc-400">
                  {auth.profile.display_name || auth.profile.email || ''} (
                  {auth.profile.role})
                </span>
                {actions}
              </div>
            </header>
          )}
          {children}
        </>
      ) : (
        <Shell
          title={title}
          actions={actions}
          centerTarget={centerTarget}
          mainId={mainId}
          area={area}
          accountActions={accountActions}
        >
          {children}
        </Shell>
      )}
    </Context.Provider>
  );
}
