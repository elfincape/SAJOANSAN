import { useEffect, useRef, useState } from 'react';
import type { PortalTask } from '../../domain/portal-types';
import { portalRecord } from '../../lib/portal';
import { usePortal } from './PortalStore';
export function PortalVersionStatus({
  task,
  dirty,
  busy,
  readOnly,
}: {
  task: PortalTask;
  dirty: boolean;
  busy: boolean;
  readOnly: boolean;
}) {
  const portal = usePortal();
  const [latest, setLatest] = useState<PortalTask | null>(null);
  const [checkedAt, setCheckedAt] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [confirmLoad, setConfirmLoad] = useState(false);
  const current = useRef({ task, busy });
  current.current = { task, busy };
  const alive = useRef(true),
    pending = useRef(false),
    lastAttempt = useRef(0);
  async function check(explicit = false) {
    const snapshot = current.current;
    if (
      snapshot.busy ||
      pending.current ||
      document.visibilityState === 'hidden' ||
      (!explicit && Date.now() - lastAttempt.current < 10000)
    )
      return;
    pending.current = true;
    lastAttempt.current = Date.now();
    setChecking(true);
    setError('');
    try {
      const row = await portalRecord('task', snapshot.task.id);
      if (
        !alive.current ||
        current.current.task.id !== snapshot.task.id ||
        current.current.task.version !== snapshot.task.version
      )
        return;
      setLatest(row);
      setCheckedAt(
        new Date().toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    } catch {
      if (alive.current)
        setError(
          '서버 버전을 확인하지 못했습니다. 입력을 유지했습니다. 다시 확인하세요.',
        );
    } finally {
      pending.current = false;
      if (alive.current) setChecking(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setConfirmLoad(false);
    setLatest(null);
    setCheckedAt('');
    if (!busy) void check();
  }, [task.id, task.version]);
  useEffect(() => {
    const onFocus = () => {
      void check();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);
  const listed = portal.state.tasks.find((row) => row.id === task.id);
  const newer = [latest, listed]
    .filter((row): row is PortalTask => !!row && row.version > task.version)
    .sort((a, b) => b.version - a.version)[0];
  function load() {
    if (!newer || busy) return;
    portal.taskDrafts.delete(task.id);
    portal.choose({ type: 'task', row: newer });
    setConfirmLoad(false);
  }
  return (
    <section className="task-version-status" aria-label="서버 버전 확인">
      <div className="task-version-line">
        <span>
          열린 버전 {task.version}
          {checkedAt ? ` · 서버 조회 ${checkedAt}` : ' · 서버 버전 미확인'}
        </span>
        <button
          type="button"
          disabled={busy || checking}
          onClick={() => void check(true)}
        >
          {checking ? '버전 확인 중…' : '서버 버전 확인'}
        </button>
      </div>
      {error ? <p role="status">{error}</p> : null}
      {newer ? (
        <div className="task-version-warning" role="status">
          <strong>서버에 새 버전 {newer.version}이 있습니다.</strong>
          <p>
            {dirty
              ? '현재 입력은 유지했습니다. 새 버전을 불러오기 전에 변경 내용을 확인하세요.'
              : '새 버전을 불러와 변경된 업무 내용을 확인하세요.'}
          </p>
          {!readOnly ? (
            confirmLoad && dirty ? (
              <>
                <p>현재 저장하지 않은 입력을 버리고 새 버전을 불러올까요?</p>
                <div className="actions">
                  <button type="button" disabled={busy} onClick={load}>
                    입력 버리고 새 버전 불러오기
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmLoad(false)}
                  >
                    입력 유지
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => (dirty ? setConfirmLoad(true) : load())}
              >
                새 버전 불러오기
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
