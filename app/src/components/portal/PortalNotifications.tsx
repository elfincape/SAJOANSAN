import { usePortal } from './PortalStore';
import { portalApi, portalRecord } from '../../lib/portal';
import type { PortalNotification } from '../../domain/portal-types';
import { portalStamp } from '../../domain/portal-types';
export function PortalNotifications() {
  const { state, allowed, update, refresh, choose, message } = usePortal();
  async function open(n: PortalNotification) {
    try {
      if (allowed('notifications', 'edit'))
        await portalApi.readNotification(n.id);
      if (n.reason_key?.startsWith('backup:')) {
        update((s) => {
          s.view = 'backups';
          s.selected = null;
        });
        await refresh();
      } else if (n.task_id) {
        const row = await portalRecord('task', n.task_id);
        choose({ type: 'task', row });
      } else if (n.incident_id) {
        const row = await portalRecord('incident', n.incident_id);
        choose({ type: 'incident', row });
      }
      if (allowed('notifications', 'edit'))
        update((s) => {
          s.notifications = s.notifications.map((row) =>
            row.id === n.id
              ? { ...row, read_at: new Date().toISOString() }
              : row,
          );
          s.unread = s.notifications.filter((row) => !row.read_at).length;
        });
    } catch (error) {
      message(
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error),
        true,
      );
    }
  }
  return (
    <>
      {state.notifications.map((n) => (
        <button
          key={n.id}
          className="task-row"
          disabled={state.busy}
          onClick={() => void open(n)}
        >{`${n.read_at ? '' : '● '}${n.title} · ${portalStamp(n.created_at)}`}</button>
      ))}
      {!state.notifications.length ? (
        <div className="portal-empty">
          <strong>새로운 알림이 없습니다.</strong>
          <p>등록된 항목이 있으면 여기에 표시됩니다.</p>
        </div>
      ) : null}
    </>
  );
}
