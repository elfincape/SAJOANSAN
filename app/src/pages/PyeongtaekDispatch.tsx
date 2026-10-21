import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { CJDispatch } from '../components/CJDispatch';
import { ManualDispatch } from '../components/ManualDispatch';
import { useFeedback } from '../components/useFeedback';
import '../styles/pyeongtaek-dispatch.css';
function Work() {
  const { center, setCenterChangeGuard } = useAdminPage(),
    { confirm, feedback } = useFeedback();
  const [tools, setTools] = useState(
      () => new URLSearchParams(location.search).get('view') === 'roads',
    ),
    [status, setStatus] = useState({
      cj: { dirty: false, busy: false },
      manual: { dirty: false, busy: false },
    }),
    current = useRef(status),
    leaving = useRef(false);
  const cjState = useCallback(
      (cj: { busy: boolean; dirty: boolean }) =>
        setStatus((old) => {
          const next = { ...old, cj };
          current.current = next;
          return next;
        }),
      [],
    ),
    manualState = useCallback(
      (manual: { busy: boolean; dirty: boolean }) =>
        setStatus((old) => {
          const next = { ...old, manual };
          current.current = next;
          return next;
        }),
      [],
    );
  useEffect(() => {
    setCenterChangeGuard(async () => {
      const s = current.current;
      if (s.cj.busy || s.manual.busy) return false;
      if (
        s.manual.dirty &&
        !(await confirm('저장하지 않은 변경사항을 버리시겠습니까?'))
      )
        return false;
      if (
        s.cj.dirty &&
        !(await confirm(
          '현재 가배차에 저장하지 않은 조정이 있습니다. 새 작업으로 바꿀까요?',
        ))
      )
        return false;
      leaving.current = true;
      return true;
    });
    return () => setCenterChangeGuard(null);
  }, [setCenterChangeGuard]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      const s = current.current;
      if (
        !leaving.current &&
        (s.cj.dirty || s.cj.busy || s.manual.dirty || s.manual.busy)
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const navigate = (e: MouseEvent) => {
      if (e.defaultPrevented || !(e.target instanceof Element)) return;
      const link = e.target.closest<HTMLAnchorElement>('a[href]');
      if (
        !link ||
        link.hasAttribute('download') ||
        link.target === '_blank' ||
        e.ctrlKey ||
        e.metaKey ||
        new URL(link.href, location.href).hash
      )
        return;
      const s = current.current;
      if (s.manual.busy) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (!s.manual.dirty) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void confirm('저장하지 않은 변경사항을 버리시겠습니까?').then((ok) => {
        if (ok) {
          leaving.current = true;
          location.assign(link.href);
        }
      });
    };
    addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    return () => {
      removeEventListener('beforeunload', unload);
      document.removeEventListener('click', navigate, true);
    };
  }, []);
  return (
    <main
      id="dispatch-app"
      className="app-main"
      tabIndex={-1}
      aria-busy={status.cj.busy || status.manual.busy}
    >
      <nav className="pd-toolbar" aria-label="배차 작업 선택">
        <button
          id="pd-mode-cj"
          type="button"
          aria-pressed={!tools}
          disabled={center.code !== '002'}
          onClick={() => setTools(false)}
        >
          CJ 당일 지시서 배차
        </button>
        <button
          id="pd-mode-tools"
          type="button"
          aria-pressed={tools}
          disabled={center.code !== '002'}
          onClick={() => setTools(true)}
        >
          직접 입력·납품정보·주행 수집
        </button>
      </nav>
      {center.code === '002' ? (
        <>
          <CJDispatch active={!tools} onStateChange={cjState} />
          <ManualDispatch
            active={tools}
            initialRoads={
              new URLSearchParams(location.search).get('view') === 'roads'
            }
            onStateChange={manualState}
          />
        </>
      ) : (
        <p id="pd-status" role="status" data-error="true">
          평택센터(002)에서만 사용할 수 있습니다.
        </p>
      )}
      {feedback}
    </main>
  );
}
export default function PyeongtaekDispatch() {
  return (
    <AdminPage title="평택 가배차" mainId="dispatch-app" bodyClass="">
      <Work />
    </AdminPage>
  );
}
