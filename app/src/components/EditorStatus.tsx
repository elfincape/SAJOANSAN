import { useEffect, useRef } from 'react';
import { navigateWorkspace, registerWorkspaceNavigationGuard } from '../lib/workspace-navigation';
import { useAdminPage } from './AdminPage';

export function EditorStatus({ dirty, saving, editable }: { dirty: boolean; saving: boolean; editable: boolean; existing: boolean }) {
  if (editable && !dirty && !saving) return null;
  return <p className="editor-status" data-state={saving ? 'saving' : dirty && editable ? 'dirty' : 'ready'} role="status" aria-live="polite">
    <span className="editor-status-dot" aria-hidden="true"/>
    {!editable ? '열람 전용 · 수정 권한이 필요합니다.' : saving ? '저장 중' : '저장하지 않은 변경사항'}
  </p>;
}

export function useEditorGuard(dirty: boolean, busy: boolean, confirm: (message: string) => Promise<boolean>) {
  const { setCenterChangeGuard, setControlsDisabled } = useAdminPage();
  const current = useRef({ dirty, busy, confirm });
  current.current = { dirty, busy, confirm };
  const leaving = useRef(false);
  useEffect(() => {
    setControlsDisabled(busy);
    return () => setControlsDisabled(false);
  }, [busy, setControlsDisabled]);
  useEffect(() => {
    async function allow() {
      const state = current.current;
      if (state.busy) return false;
      if (state.dirty && !await state.confirm('저장하지 않은 변경사항이 있습니다. 저장하지 않고 이동할까요?')) return false;
      leaving.current = true;
      return true;
    }
    setCenterChangeGuard(allow);
    const unregister = registerWorkspaceNavigationGuard(recheck => recheck ? !current.current.busy : allow());
    function unload(event: BeforeUnloadEvent) {
      if (!leaving.current && (current.current.dirty || current.current.busy)) {
        event.preventDefault(); event.returnValue = '';
      }
    }
    function navigate(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
      const next = new URL(link.href);
      if (next.pathname === location.pathname && next.search === location.search) return;
      if (!current.current.dirty && !current.current.busy) return;
      event.preventDefault();
      void allow().then(ok => { if (ok) navigateWorkspace(link.href, true); });
    }
    const resume = () => { leaving.current = false; };
    addEventListener('pageshow', resume);
    addEventListener('workspace:navigation-end', resume);
    addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate);
    return () => {
      unregister();
      setCenterChangeGuard(null);
      removeEventListener('pageshow', resume);
      removeEventListener('workspace:navigation-end', resume);
      removeEventListener('beforeunload', unload);
      document.removeEventListener('click', navigate);
    };
  }, [setCenterChangeGuard]);
}
