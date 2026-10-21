import { useWorkspaceScroll } from '../useWorkspaceScroll';
import { MentionText } from './PortalMentions';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Profile } from '../../lib/auth';
import { signOut } from '../../lib/auth';
import { ThemeToggle } from '../ThemeToggle';
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
  const [groups, setGroups] = useState(
    () => new Set(['center', 'hq', 'lookup']),
  );
  function group(name: string, open: boolean) {
    setGroups((previous) => {
      if (previous.has(name) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(name);
      else next.delete(name);
      return next;
    });
  }
  useEffect(() => {
    const name = ['center', 'incidents'].includes(view)
      ? 'center'
      : view === 'surveys'
        ? 'registration'
        : ['hq', 'briefing'].includes(view)
          ? 'hq'
          : ['mail', 'search', 'notifications'].includes(view)
            ? 'lookup'
            : 'manage';
    group(name, true);
  }, [view, center, permissions]);
  useWorkspaceScroll();
  const sidebar = useRef<HTMLDialogElement>(null),
    toggle = useRef<HTMLButtonElement>(null),
    close = useRef<HTMLButtonElement>(null),
    header = useRef<HTMLElement>(null),
    account = useRef<HTMLDivElement>(null),
    [mobile, setMobile] = useState(
      () => matchMedia('(max-width: 1000px)').matches,
    ),
    [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const query = matchMedia('(max-width: 1000px)'),
      sync = () => {
        setMobile(query.matches);
        setDrawer(false);
      };
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    const element = sidebar.current;
    if (!element) return;
    if (element.open) element.close();
    if (!mobile) element.show();
    else if (drawer) {
      element.showModal();
      close.current?.focus();
    }
  }, [mobile, drawer]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (header.current)
        document.body.style.setProperty(
          '--app-header-height',
          header.current.getBoundingClientRect().height + 'px',
        );
    });
    if (header.current) observer.observe(header.current);
    return () => observer.disconnect();
  }, []);
  function closeDrawer(focus = true) {
    if (mobile) {
      setDrawer(false);
      if (focus) toggle.current?.focus();
    }
  }
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
        aria-pressed={name === view && (!code || code === center)}
        disabled={busy}
        onClick={() => {
          onNavigate(name, code);
          closeDrawer(false);
        }}
      >
        {text}
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
  return (
    <>
      <a className="app-skip" href="#portal-content">
        본문으로 이동
      </a>
      <dialog
        ref={sidebar}
        id="app-sidebar"
        aria-label="이안물류 업무 탐색"
        onCancel={() => setDrawer(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDrawer();
        }}
      >
        <div className="app-brand">
          <a href={portalUrl}>
            이안물류<small>통합 업무</small>
          </a>
          <button
            ref={close}
            type="button"
            data-navigation-toggle
            aria-label="메뉴 닫기"
            title="메뉴 닫기"
            onClick={() => closeDrawer()}
          >
            ×
          </button>
        </div>
        <nav id="app-workspace-navigation" aria-label="주요 화면">
          <a className="workspace-link" href={portalUrl} aria-current="page">
            업무 포털
          </a>
          {manager ? (
            <a
              className="workspace-link"
              href={selected ? withCenterParam('/admin/', selected) : '/admin/'}
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
          <details
            className="sidebar-group"
            open={groups.has('center')}
            onToggle={(e) => group('center', e.currentTarget.open)}
          >
            <summary>
              <span className="sidebar-group-label">센터 업무</span>
            </summary>
            <nav
              id="center-navigation"
              data-center-view="center"
              aria-label="센터 업무"
            >
              {centers.map((c) =>
                nav('center', portalCenterName(c.code, centers), c.code),
              )}
              {!centers.length ? <p>접근 가능한 센터가 없습니다.</p> : null}
              {nav('incidents', '특이사항')}
            </nav>
          </details>
          <details
            className="sidebar-group"
            open={groups.has('registration')}
            onToggle={(e) => group('registration', e.currentTarget.open)}
          >
            <summary>
              <span className="sidebar-group-label">업무 등록·조사</span>
            </summary>
            <nav data-center-view="surveys" aria-label="센터별 업무 등록">
              {centers.map((c) =>
                nav('surveys', portalCenterName(c.code, centers), c.code),
              )}
              {!centers.length ? <p>접근 가능한 센터가 없습니다.</p> : null}
            </nav>
          </details>
          <section
            id="hq-navigation"
            hidden={!allowed('hq') && !allowed('briefing')}
          >
            <details
              className="sidebar-group"
              open={groups.has('hq')}
              onToggle={(e) => group('hq', e.currentTarget.open)}
            >
              <summary>
                <span className="sidebar-group-label">배송팀</span>
              </summary>
              <nav aria-label="배송팀 업무">
                {nav('hq', '전체 업무·지원 요청')}
                {nav('briefing', 'AI 브리핑')}
              </nav>
            </details>
          </section>
          <details
            className="sidebar-group"
            open={groups.has('lookup')}
            onToggle={(e) => group('lookup', e.currentTarget.open)}
          >
            <summary>
              <span className="sidebar-group-label">조회·알림</span>
            </summary>
            <nav aria-label="조회와 알림">
              {nav('mail', '개인 메일함')}
              {nav('search', '통합 검색')}
              {nav('notifications', '알림함')}
            </nav>
          </details>
          <details
            className="sidebar-group"
            open={groups.has('manage')}
            onToggle={(e) => group('manage', e.currentTarget.open)}
          >
            <summary>
              <span className="sidebar-group-label">포털 관리</span>
            </summary>
            <nav aria-label="운영 기록">
              {nav('history', '처리 기록')}
              {nav('permissions', '페이지별 권한')}
              {nav('connections', 'OneDrive 관리')}
              {nav('members', '사용자 권한·센터')}
              {nav('trash', '휴지통')}
              {nav('backups', '운영 원본 보관')}
              {selected && allowed('audit', center) ? (
                <a
                  id="audit-navigation"
                  href={withCenterParam('/admin/audit-log.html', selected)}
                >
                  변경 이력
                </a>
              ) : null}
            </nav>
          </details>
        </div>
      </dialog>
      <header ref={header} id="app-header">
        <div className="app-header-row">
          <button
            ref={toggle}
            type="button"
            className="app-menu-toggle"
            data-navigation-toggle
            aria-label="업무 메뉴 열기"
            title="업무 메뉴 열기"
            aria-controls="app-sidebar"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            ☰
          </button>
          <nav className="app-location" aria-label="현재 위치">
            <strong>업무 포털</strong>
          </nav>
          <div className="app-page-actions" />
          <div className="app-header-controls">
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
            <button
              type="button"
              id="app-account-toggle"
              popoverTarget="app-account-menu"
              aria-label="사용자 메뉴"
              title="사용자 메뉴"
              disabled={busy}
            >
              <span id="app-profile-label">
                {profile.display_name || profile.email || '사용자'}
              </span>
              <span aria-hidden="true">⌄</span>
            </button>
            <ThemeToggle disabled={busy} />
          </div>
        </div>
      </header>
      {children}
      <div ref={account} id="app-account-menu" popover="auto">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            account.current?.hidePopover();
            void signOut();
          }}
        >
          로그아웃
        </button>
      </div>
      <div id="app-legacy-hooks" hidden>
        <span id="user">
          <MentionText>
            {profile.display_name || profile.email || ''}
          </MentionText>
        </span>
      </div>
    </>
  );
}
