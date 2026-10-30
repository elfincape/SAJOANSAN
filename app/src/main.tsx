import { WorkspaceProvider } from './components/WorkspaceProvider';
import { lazy, StrictMode, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { FileTransfers } from './components/FileArea';
import { PAGE_PATHS, pageTitle } from './page-paths';
import { loadAuthContext } from './lib/auth';
import { allowWorkspaceNavigation, installWorkspaceNavigation, workspaceDestination } from './lib/workspace-navigation';
import './styles/workspace-navigation.css';

const modules = import.meta.glob<{ default: ComponentType }>('./pages/*.tsx');
const loaderFor = (path: string) => {
  const name = PAGE_PATHS[path as keyof typeof PAGE_PATHS];
  return name ? modules['./pages/' + name + '.tsx'] : undefined;
};
const initialLoader = loaderFor(location.pathname);
const InitialPage = initialLoader ? lazy(initialLoader) : null;
const indexKey = '__workspaceIndex';

function Workspace() {
  const [current, setCurrent] = useState<{ Page: ComponentType; key: string }>(() => ({ Page: InitialPage!, key: location.href }));
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    if (!status || failed) return;
    const nodes = [...document.body.children].filter((node): node is HTMLElement =>
      node instanceof HTMLElement && !node.matches('.workspace-navigation-status, .workspace-navigation-announcement, .workspace-navigation-progress'));
    const previous = nodes.map(node => node.inert);
    nodes.forEach(node => { node.inert = true; });
    return () => nodes.forEach((node, i) => { node.inert = previous[i]; });
  }, [status, failed]);
  useEffect(() => {
    let index = Number(history.state?.[indexKey] ?? 0);
    let sequence = 0;
    const previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const storedScroll = history.state?.__workspaceScroll;
    const initialScroll: [number, number] = Array.isArray(storedScroll) && storedScroll.length === 2 && storedScroll.every(Number.isFinite) ? [storedScroll[0], storedScroll[1]] : [window.scrollX, window.scrollY];
    const scrollPositions = new Map<number, [number, number]>([[index, initialScroll]]);
    const saveScroll = () => {
      const position: [number, number] = [window.scrollX, window.scrollY];
      scrollPositions.set(index, position);
      history.replaceState({ ...history.state, __workspaceScroll: position }, '', location.href);
    };
    let cancelScrollRestore = () => {};
    function restoreScroll(position: readonly number[]) {
      cancelScrollRestore();
      const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
      const observer = new ResizeObserver(attempt);
      const timer = window.setTimeout(cancel, 1800);
      function cancel() {
        observer.disconnect();
        clearTimeout(timer);
        events.forEach(event => removeEventListener(event, cancel));
      }
      function attempt() {
        window.scrollTo({ left: position[0], top: position[1], behavior: 'instant' });
        if (Math.abs(window.scrollY - position[1]) < 2 && Math.abs(window.scrollX - position[0]) < 2) cancel();
      }
      cancelScrollRestore = cancel;
      events.forEach(event => addEventListener(event, cancel, { passive: true }));
      observer.observe(document.body);
      observer.observe(document.documentElement);
      attempt();
    }
    let restoring: { index: number; complete: () => void } | undefined;
    let traversal: { index: number; commit: () => void } | undefined;
    const replaceState = history.replaceState;
    // Portal filters and center selection replace their URL without creating a route entry.
    history.replaceState = function (state, unused, url) {
      replaceState.call(history, { ...state, [indexKey]: index }, unused, url);
    };
    history.replaceState(history.state, '', location.href);
    function finish() {
      setStatus('');
      dispatchEvent(new Event('workspace:navigation-end'));
    }
    async function open(url: URL, guarded: boolean, delta?: number) {
      const request = ++sequence;
      try {
        if (!await allowWorkspaceNavigation(guarded)) {
          if (request === sequence) setStatus('');
          return;
        }
        if (request !== sequence) return;
        setFailed(false);
        setStatus('화면을 준비하고 있습니다.');
        const loader = loaderFor(url.pathname);
        if (!loader) return;
        const [module, auth] = await Promise.all([loader(), loadAuthContext(true)]);
        if (!auth || request !== sequence) return;
        const ready = await allowWorkspaceNavigation(true);
        if (request !== sequence) return;
        if (!ready) { finish(); return; }
        const commit = () => {
          document.title = pageTitle(url.pathname) ?? document.title;
          flushSync(() => {
            setStatus('');
            setCurrent({ Page: module.default, key: url.href });
          });
          const position = delta === undefined ? [0, 0] : scrollPositions.get(index) ?? [0, 0];
          restoreScroll(position);
          finish();
        };
        saveScroll();
        if (delta !== undefined) {
          traversal = { index: index + delta, commit };
          history.go(delta);
        } else {
          history.pushState({ [indexKey]: ++index }, '', url);
          commit();
        }
      } catch {
        if (request === sequence) {
          setFailed(true);
          setStatus('화면을 열지 못했습니다. 연결을 확인하고 새로고침한 뒤 다시 선택해 주세요.');
        }
      } finally {
        if (request === sequence) {
          dispatchEvent(new Event('workspace:navigation-end'));
        }
      }
    }
    const uninstall = installWorkspaceNavigation((url, guarded) => { void open(url, guarded); });
    function click(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.hasAttribute('download') || link.target && link.target !== '_self' || link.relList.contains('external')) return;
      const url = workspaceDestination(link.href);
      if (!url) return;
      event.preventDefault();
      void open(url, false);
    }
    function pop(event: PopStateEvent) {
      const nextIndex = event.state?.[indexKey];
      if (typeof nextIndex !== 'number' || location.pathname === '/login.html') { location.reload(); return; }
      if (restoring) {
        if (nextIndex !== restoring.index) { history.go(restoring.index - nextIndex); return; }
        const restored = restoring.complete;
        restoring = undefined;
        restored();
        return;
      }
      if (traversal && nextIndex === traversal.index) {
        index = nextIndex;
        const commit = traversal.commit;
        traversal = undefined;
        commit();
        return;
      }
      const url = new URL(location.href);
      const delta = nextIndex - index;
      if (!delta) return;
      sequence++;
      traversal = undefined;
      restoring = { index, complete: () => { void open(url, false, delta); } };
      history.go(-delta);
    }
    // Window bubbling runs after editor guards and React link handlers.
    addEventListener('click', click);
    addEventListener('popstate', pop);
    addEventListener('pagehide', saveScroll);
    restoreScroll(initialScroll);
    return () => {
      sequence++;
      uninstall();
      history.replaceState = replaceState;
      history.scrollRestoration = previousScrollRestoration;
      cancelScrollRestore();
      removeEventListener('click', click);
      removeEventListener('popstate', pop);
      removeEventListener('pagehide', saveScroll);
    };
  }, []);
  const Page = current.Page;
  return <>
    <Suspense fallback={<div className="workspace-boot" role="status">화면을 불러오고 있습니다…</div>}>
      <Page key={current.key} />
    </Suspense>
    {status ? <>
      <div className={failed ? 'workspace-navigation-status' : 'workspace-navigation-announcement'} role={failed ? 'alert' : 'status'}>{status}</div>
      {!failed ? <div className="workspace-navigation-progress" aria-hidden="true" /> : null}
    </> : null}
  </>;
}
document.title = pageTitle(location.pathname) ?? document.title;
if (InitialPage) createRoot(document.body).render(<StrictMode><WorkspaceProvider><FileTransfers><Workspace /></FileTransfers></WorkspaceProvider></StrictMode>);
