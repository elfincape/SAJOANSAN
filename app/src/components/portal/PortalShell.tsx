import {
  FEATURE_CATALOG,
  FEATURE_CATEGORIES,
} from '../../domain/feature-catalog';
import { featureAccessible } from '../../lib/feature-access';
import {
  loadPrivateFeatures,
  subscribePrivateFeatures,
} from '../../lib/private-features';
import type { WorkspaceCommand } from '../WorkspaceCommands';
import { WorkspaceFrame } from '../WorkspaceFrame';
import {
  PORTAL_VIEWS,
  PORTAL_NAV_GROUPS,
  portalViewTitle,
} from '../../domain/portal-navigation';
import { useWorkspaceScroll } from '../useWorkspaceScroll';
import { MentionText } from './PortalMentions';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Profile } from '../../lib/auth';
import {
  navigateWorkspace,
  registerWorkspaceNavigationGuard,
} from '../../lib/workspace-navigation';
import { permissionAllowed } from '../../lib/permissions';
import { getCenterByCode, withCenterParam } from '../../lib/center';
import { portalCenterName, viewResource } from '../../domain/portal-types';
import type {
  PortalContext,
  PortalPermissions,
} from '../../domain/portal-types';
export function PortalShell({
  profile,
  context,
  permissions,
  center,
  view,
  busy,
  unread,
  mailAvailable,
  onNavigate,
  onCenter,
  children,
}: {
  profile: Profile;
  context: PortalContext;
  permissions: PortalPermissions;
  center: string;
  view: string;
  busy: boolean;
  unread: number;
  mailAvailable: boolean;
  onNavigate: (view: string, center?: string) => void;
  onCenter: (center: string) => void;
  children: ReactNode;
}) {
  useEffect(() => registerWorkspaceNavigationGuard(() => !busy), [busy]);
  const [features, setFeatures] = useState(() => loadPrivateFeatures(profile));
  useEffect(
    () =>
      subscribePrivateFeatures(() => setFeatures(loadPrivateFeatures(profile))),
    [profile],
  );
  const [groups, setGroups] = useState(() => new Set(['center']));
  function group(name: string, open: boolean) {
    setGroups((previous) => {
      if (previous.has(name) === open) return previous;
      const next = open ? new Set([name]) : new Set(previous);
      if (!open) next.delete(name);
      return next;
    });
  }
  useEffect(() => {
    const section = PORTAL_VIEWS.find(
      (item) => item.id === (view === 'access' ? 'members' : view),
    )?.group;
    const name =
      PORTAL_NAV_GROUPS.find((item) => item.title === section)?.id ?? 'center';
    group(name, true);
  }, [view, center, permissions]);
  useWorkspaceScroll();
  const allowed = (resource: string, code?: string) =>
    resource === 'mail'
      ? mailAvailable
      : permissionAllowed(permissions, resource, 'read', code);
  function nav(name: string, text: string, code?: string) {
    return allowed(viewResource(name), code) ? (
      <button
        key={name + code}
        type="button"
        data-view={name}
        data-center={code}
        aria-pressed={
          (name === view || (name === 'members' && view === 'access')) &&
          (!code || code === center)
        }
        aria-current={
          (name === view || (name === 'members' && view === 'access')) &&
          (!code || code === center)
            ? 'page'
            : undefined
        }
        disabled={busy}
        onClick={() => {
          onNavigate(name, code);
        }}
      >
        {code ? text : portalViewTitle(name)}
        {name === 'notifications' ? (
          <>
            {' '}
            <span id="unread">{unread || ''}</span>
          </>
        ) : null}
      </button>
    ) : null;
  }
  const order = ['001', '002', 'gimhae', 'yangsan'],
    centers = [...context.centers].sort((a, b) => {
      const rank = (code: string) => {
        const i = order.indexOf(code);
        return i < 0 ? 99 : i;
      };
      return rank(a.code) - rank(b.code);
    }),
    selected = getCenterByCode(center),
    portalUrl = '/portal/?center=' + encodeURIComponent(center),
    manager =
      ['editor', 'admin'].includes(profile.role) ||
      Object.keys(permissions.access).some(
        (resource) =>
          ![
            'tasks',
            'incidents',
            'forms',
            'search',
            'notifications',
            'hq',
            'history',
            'trash',
          ].includes(resource) && allowed(resource),
      );
  const commands: WorkspaceCommand[] = PORTAL_VIEWS.flatMap((item) => {
    const codes =
      'byCenter' in item && item.byCenter
        ? centers.map((c) => c.code)
        : [undefined];
    return codes
      .filter((code) => allowed(viewResource(item.id), code))
      .map((code) => ({
        id: item.id + (code || ''),
        title:
          (code ? portalCenterName(code, centers) + ' · ' : '') + item.title,
        group: item.group,
        description:
          item.id === view && (!code || code === center)
            ? '현재 보고 있는 화면'
            : '업무 포털',
        run: () => {
          if (!busy) {
            onNavigate(item.id, code);
          }
        },
      }));
  });
  if (selected) {
    for (const feature of FEATURE_CATALOG) {
      if (
        !feature.href?.startsWith('/admin/') ||
        feature.hub === false ||
        !featureAccessible(
          feature,
          profile,
          permissions,
          selected.code,
          features,
        )
      )
        continue;
      commands.push({
        id: 'hub-' + feature.id,
        title: feature.title,
        description: feature.desc,
        group: FEATURE_CATEGORIES[feature.category],
        run: () => {
          if (!busy)
            navigateWorkspace(withCenterParam(feature.href!, selected));
        },
      });
    }
    if (manager)
      commands.unshift({
        id: 'hub',
        title: '관리 허브',
        description: '관리 도구 전체 보기',
        group: '주요 화면',
        run: () => {
          if (!busy) navigateWorkspace(withCenterParam('/admin/', selected));
        },
      });
    if (['editor', 'admin'].includes(profile.role))
      commands.unshift({
        id: 'dashboard',
        title: '대시보드',
        description: '코스·납품 현황 조회',
        group: '주요 화면',
        run: () => {
          if (!busy) navigateWorkspace(withCenterParam('/', selected));
        },
      });
  }
  return (
    <WorkspaceFrame
      mainId="portal-content"
      brandHref={portalUrl}
      disabled={busy}
      userName={profile.display_name || profile.email || '사용자'}
      commands={commands}
      location={
        <>
          <span className="workspace-area-label">업무 포털</span>
          <span className="app-path-divider" aria-hidden="true">
            /
          </span>
          <strong>{portalViewTitle(view)}</strong>
        </>
      }
      navigation={
        <>
          {' '}
          <nav id="app-workspace-navigation" aria-label="주요 화면">
            <a
              className="workspace-link"
              href={portalUrl}
              aria-current="location"
            >
              업무 포털
            </a>
            {manager ? (
              <a
                className="workspace-link"
                href={
                  selected ? withCenterParam('/admin/', selected) : '/admin/'
                }
              >
                관리 허브
              </a>
            ) : null}
            {['editor', 'admin'].includes(profile.role) ? (
              <a
                className="workspace-link"
                href={selected ? withCenterParam('/', selected) : '/'}
              >
                대시보드
              </a>
            ) : null}
          </nav>
          <div className="app-local-menu">
            {PORTAL_NAV_GROUPS.map((section) => {
              const items = PORTAL_VIEWS.filter(
                (item) => item.group === section.title,
              );
              const entries = items
                .flatMap((item) =>
                  'byCenter' in item && item.byCenter
                    ? centers.map((c) =>
                        nav(item.id, portalCenterName(c.code, centers), c.code),
                      )
                    : [nav(item.id, item.title)],
                )
                .filter(Boolean);
              const audit =
                section.id === 'manage' && selected && allowed('audit', center);
              if (!entries.length && !audit) return null;
              return (
                <section
                  key={section.id}
                  id={section.id === 'hq' ? 'hq-navigation' : undefined}
                >
                  <details
                    name="workspace-navigation"
                    className="sidebar-group"
                    open={groups.has(section.id)}
                    onToggle={(e) => group(section.id, e.currentTarget.open)}
                  >
                    <summary>
                      <span className="sidebar-group-label">
                        {section.title}
                      </span>
                    </summary>
                    <nav
                      id={
                        section.id === 'center'
                          ? 'center-navigation'
                          : undefined
                      }
                      data-center-view={
                        section.id === 'center'
                          ? 'center'
                          : section.id === 'registration'
                            ? 'surveys'
                            : undefined
                      }
                      aria-label={section.title}
                    >
                      {entries}
                      {audit && selected ? (
                        <a
                          id="audit-navigation"
                          href={withCenterParam(
                            '/admin/audit-log.html',
                            selected,
                          )}
                        >
                          변경 이력
                        </a>
                      ) : null}
                    </nav>
                  </details>
                </section>
              );
            })}
          </div>
        </>
      }
      currentLocation={
        <div className="workspace-current-location">
          <span>현재 화면</span>
          <strong>{portalViewTitle(view)}</strong>
          <small>
            {portalCenterName(center, centers)} ·{' '}
            {profile.role === 'admin'
              ? '관리자'
              : profile.role === 'editor'
                ? '업무 담당'
                : '조회 전용'}
          </small>
        </div>
      }
      centerControl={
        <label id="center-switcher" data-app-center="true">
          <span>센터</span>
          <select
            id="app-center-select"
            aria-label="작업 센터"
            value={center}
            disabled={busy}
            onChange={(e) => onCenter(e.target.value)}
          >
            {context.centers.map((c) => (
              <option key={c.code} value={c.code}>
                {getCenterByCode(c.code)?.shortName || c.name}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {children}{' '}
      <div id="app-legacy-hooks" hidden>
        <span id="user">
          <MentionText>
            {profile.display_name || profile.email || ''}
          </MentionText>
        </span>
      </div>
    </WorkspaceFrame>
  );
}
