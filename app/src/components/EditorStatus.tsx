import { useEffect, useRef } from 'react';
import { useAdminPage } from './AdminPage';

export function EditorStatus({ dirty, saving, editable, existing }: { dirty: boolean; saving: boolean; editable: boolean; existing: boolean }) {
  return <p className="editor-status" data-state={saving ? 'saving' : dirty && editable ? 'dirty' : 'ready'} role="status" aria-live="polite">
    <span className="editor-status-dot" aria-hidden="true"/>
    {!editable ? '열람 전용 · 수정 권한이 필요합니다.' : saving ? '저장 중입니다. 잠시 기다려 주세요.' : dirty ? '저장하지 않은 변경사항 · 아래 저장 버튼으로 반영하세요.' : existing ? '저장된 내용을 보고 있습니다.' : '새 항목의 필수 정보를 입력한 뒤 저장하세요.'}
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
      void allow().then(ok => { if (ok) location.assign(link.href); });
    }
    const resume = () => { leaving.current = false; };
    addEventListener('pageshow', resume);
    addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate);
    return () => {
      setCenterChangeGuard(null);
      removeEventListener('pageshow', resume);
      removeEventListener('beforeunload', unload);
      document.removeEventListener('click', navigate);
    };
  }, [setCenterChangeGuard]);
}
