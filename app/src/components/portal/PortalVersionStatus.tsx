import { useEffect, useRef, useState } from 'react';
import type { PortalTask } from '../../domain/portal-types';
import { portalRecord } from '../../lib/portal';
import { usePortal } from './PortalStore';

export function PortalVersionStatus({ task, dirty, busy, readOnly }: {
  task: PortalTask; dirty: boolean; busy: boolean; readOnly: boolean;
}) {
  const portal = usePortal();
  const [latest, setLatest] = useState<PortalTask | null>(null);
  const [confirmLoad, setConfirmLoad] = useState(false);
  const current = useRef({ task, busy });
  current.current = { task, busy };
  const alive = useRef(true), pending = useRef(false), lastAttempt = useRef(0);
  async function check() {
    const snapshot = current.current;
    if (snapshot.busy || pending.current || document.visibilityState === 'hidden' || Date.now() - lastAttempt.current < 10000) return;
    pending.current = true;
    lastAttempt.current = Date.now();
    try {
      const row = await portalRecord('task', snapshot.task.id);
      if (alive.current && current.current.task.id === snapshot.task.id && current.current.task.version === snapshot.task.version) setLatest(row);
    } catch {
      // Background checks never discard inputs; saves retain their existing conflict validation.
    } finally { pending.current = false; }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setConfirmLoad(false); setLatest(null); if (!busy) void check(); }, [task.id, task.version]);
  useEffect(() => {
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, []);
  const listed = portal.state.tasks.find(row => row.id === task.id);
  const newer = [latest, listed].filter((row): row is PortalTask => !!row && row.version > task.version).sort((a, b) => b.version - a.version)[0];
  function load() {
    if (!newer || busy) return;
    portal.taskDrafts.delete(task.id);
    portal.choose({ type: 'task', row: newer });
    setConfirmLoad(false);
  }
  if (!newer) return null;
  return <section className="task-version-status" aria-label="업무 변경 알림">
    <div className="task-version-warning" role="status">
      <strong>업무 내용이 변경되었습니다.</strong>
      <p>{dirty ? '현재 입력은 유지했습니다. 최신 내용을 불러오기 전에 변경 내용을 확인하세요.' : '최신 내용을 불러와 변경된 업무를 확인하세요.'}</p>
      {confirmLoad && dirty && !readOnly ? <>
        <p>현재 저장하지 않은 입력을 버리고 최신 내용을 불러올까요?</p>
        <div className="actions">
          <button type="button" disabled={busy} onClick={load}>입력 버리고 최신 내용 불러오기</button>
          <button type="button" disabled={busy} onClick={() => setConfirmLoad(false)}>입력 유지</button>
        </div>
      </> : <button type="button" disabled={busy} onClick={() => dirty && !readOnly ? setConfirmLoad(true) : load()}>최신 내용 불러오기</button>}
    </div>
  </section>;
}
