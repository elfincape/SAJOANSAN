import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AccountMenu } from './AccountMenu';
import { ThemeToggle } from './ThemeToggle';
import { WorkspaceCommands } from './WorkspaceCommands';
import type { WorkspaceCommand } from './WorkspaceCommands';
import { signOut } from '../lib/auth';

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
  const sidebar = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const query = matchMedia('(max-width: 1000px)');
    const sync = () => {
      setMobile(query.matches);
      setDrawer(false);
    };
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    const dialog = sidebar.current;
    if (!dialog) return;
    if (dialog.open) dialog.close();
    if (!mobile) dialog.show();
    else if (drawer) {
      dialog.showModal();
      close.current?.focus();
    }
  }, [mobile, drawer]);
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
    if (!mobile) return;
    setDrawer(false);
    if (focus) toggle.current?.focus();
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
        aria-label="EAN 업무 탐색"
        onCancel={(event) => {
          event.preventDefault();
          closeDrawer();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
      >
        <div className="app-brand">
          <a href={brandHref}>
            <span translate="no">EAN</span>
          </a>
          <button
            ref={close}
            disabled={disabled}
            type="button"
            data-navigation-toggle
            aria-label="메뉴 닫기"
            title="메뉴 닫기"
            onClick={() => closeDrawer()}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </div>
        <div
          className="workspace-navigation-content"
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('a,button') &&
              !disabled
            )
              closeDrawer(false);
          }}
        >
          {navigation}
        </div>
        {currentLocation}
      </dialog>
      <header ref={header} id="app-header">
        <div className="app-header-row">
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
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <nav className="app-location" aria-label="현재 위치">
            {location}
          </nav>
          <div className="app-page-actions">{actions}</div>
          <div className="app-header-controls">
            <WorkspaceCommands commands={commands} disabled={disabled} />
            {centerControl}
            <AccountMenu
              name={userName}
              disabled={disabled}
              actions={accountActions}
              onSignOut={() => {
                void signOut();
              }}
            />
            <ThemeToggle disabled={disabled} />
          </div>
        </div>
      </header>
      <div className="workspace-content">{children}</div>
    </>
  );
}
