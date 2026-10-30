import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import { BriefcaseBusiness, House, LayoutGrid, Menu, X } from 'lucide-react';
import { AccountMenu } from './AccountMenu';
import { ThemeToggle } from './ThemeToggle';
import { WorkspaceCommands } from './WorkspaceCommands';
import type { WorkspaceCommand } from './WorkspaceCommands';
import { signOut } from '../lib/auth';

type NavigationLink = {
  children?: ReactNode;
  className?: string;
  href?: string;
  title?: string;
  'aria-label'?: string;
};
function primaryLinks(node: ReactNode): ReactElement<NavigationLink>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<NavigationLink>(child)) return [];
    return child.props.className === 'workspace-link'
      ? [child]
      : primaryLinks(child.props.children);
  });
}
function RailIcon({ href = '' }: { href?: string }) {
  const path = href.split('?')[0];
  const Icon =
    path === '/'
      ? House
      : path.startsWith('/admin')
        ? LayoutGrid
        : BriefcaseBusiness;
  return <Icon aria-hidden="true" size={22} strokeWidth={1.5} />;
}

export function WorkspaceFrame({
  mainId,
  brandHref,
  location,
  navigation,
  currentLocation,
  centerControl,
  commands,
  userName,
  disabled = false,
  actions,
  accountActions,
  children,
}: {
  mainId: string;
  brandHref: string;
  location: ReactNode;
  navigation: ReactNode;
  currentLocation: ReactNode;
  centerControl: ReactNode;
  commands: WorkspaceCommand[];
  userName: string;
  disabled?: boolean;
  actions?: ReactNode;
  accountActions?: ReactNode;
  children: ReactNode;
}) {
  const [mobile, setMobile] = useState(
    () => matchMedia('(max-width: 1000px)').matches,
  );
  const [drawer, setDrawer] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const showNavigation = mobile || expanded;
  const sidebar = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const query = matchMedia('(max-width: 1000px)');
    const sync = () => {
      setMobile(query.matches);
      setDrawer(false);
      setExpanded(false);
    };
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    const dialog = sidebar.current;
    if (!dialog) return;
    if (dialog.open) dialog.close();
    if (!mobile) {
      const active = document.activeElement;
      dialog.show();
      if (active instanceof HTMLElement) {
        const bodyFocused = active === document.body;
        if (bodyFocused) active.setAttribute('tabindex', '-1');
        active.focus({ preventScroll: true });
        if (bodyFocused) active.removeAttribute('tabindex');
      }
    } else if (drawer) {
      dialog.showModal();
      close.current?.focus();
    }
  }, [mobile, drawer]);
  useEffect(() => {
    if (mobile || !expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !sidebar.current?.contains(event.target)
      )
        setExpanded(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [mobile, expanded]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (header.current)
        document.body.style.setProperty(
          '--app-header-height',
          `${header.current.getBoundingClientRect().height}px`,
        );
    });
    if (header.current) observer.observe(header.current);
    return () => observer.disconnect();
  }, []);
  function closeDrawer(focus = true) {
    if (mobile) setDrawer(false);
    else setExpanded(false);
    if (focus) (mobile ? toggle.current : close.current)?.focus();
  }
  return (
    <>
      <a className="app-skip" href={`#${mainId}`}>
        본문으로 이동
      </a>
      <dialog
        ref={sidebar}
        tabIndex={-1}
        id="app-sidebar"
        data-rail="true"
        data-expanded={showNavigation}
        aria-label="EAN 업무 탐색"
        onCancel={(event) => {
          event.preventDefault();
          closeDrawer();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
        onKeyDown={(event) => {
          if (!mobile && event.key === 'Escape') closeDrawer();
        }}
      >
        <div className="app-rail-heading">
          <button
            ref={close}
            disabled={disabled}
            type="button"
            data-navigation-toggle
            aria-label={
              mobile
                ? '메뉴 닫기'
                : showNavigation
                  ? '메뉴 접기'
                  : '업무 메뉴 펼치기'
            }
            title={
              mobile
                ? '메뉴 닫기'
                : showNavigation
                  ? '메뉴 접기'
                  : '업무 메뉴 펼치기'
            }
            aria-controls="workspace-navigation-panel"
            aria-expanded={showNavigation}
            onClick={() =>
              mobile ? closeDrawer() : setExpanded((value) => !value)
            }
          >
            {showNavigation ? (
              <X aria-hidden="true" size={18} strokeWidth={1.5} />
            ) : (
              <Menu aria-hidden="true" size={18} strokeWidth={1.5} />
            )}
          </button>
        </div>
        {!showNavigation ? (
          <nav className="app-rail-links" aria-label="주요 화면">
            {primaryLinks(navigation)
              .sort((a, b) => {
                const rank = (href = '') =>
                  href.split('?')[0] === '/'
                    ? 0
                    : href.startsWith('/admin')
                      ? 1
                      : 2;
                return rank(a.props.href) - rank(b.props.href);
              })
              .map((link) =>
                cloneElement(link, {
                  className: 'app-rail-link',
                  title: String(link.props.children),
                  'aria-label': String(link.props.children),
                  children: <RailIcon href={link.props.href} />,
                }),
              )}
          </nav>
        ) : null}
        <div
          id="workspace-navigation-panel"
          hidden={!showNavigation}
          className="workspace-navigation-content"
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('a,button') &&
              !disabled
            )
              closeDrawer();
          }}
        >
          {navigation}
          {currentLocation}
        </div>
      </dialog>
      <header ref={header} id="app-header">
        <div className="app-header-row">
          <a className="app-brand" href={brandHref}>
            <span translate="no">EAN</span>
          </a>
          <button
            ref={toggle}
            disabled={disabled}
            type="button"
            className="app-menu-toggle"
            data-navigation-toggle
            aria-label="업무 메뉴 열기"
            title="업무 메뉴 열기"
            aria-controls="app-sidebar"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <Menu aria-hidden="true" size={18} strokeWidth={1.5} />
          </button>
          <div className="app-context-pill">
            {centerControl}
            <nav className="app-location" aria-label="현재 위치">
              {location}
            </nav>
          </div>
          <div className="app-page-actions">{actions}</div>
          <div className="app-header-controls">
            <WorkspaceCommands commands={commands} disabled={disabled} />
            <ThemeToggle disabled={disabled} />
            <AccountMenu
              name={userName}
              disabled={disabled}
              actions={accountActions}
              onSignOut={() => {
                void signOut();
              }}
            />
          </div>
        </div>
      </header>
      <div className="workspace-content">{children}</div>
    </>
  );
}
