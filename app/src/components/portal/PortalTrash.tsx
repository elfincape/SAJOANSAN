import { usePortal } from './PortalStore';
import { PortalTaskRow } from './PortalTaskList';
import { orderTasks } from '../../domain/portal-model';
import { portalStamp } from '../../domain/portal-types';
export function PortalTrash() {
  const { state, profile, choose, centerName } = usePortal();
  return (
    <>
      {orderTasks(state.tasks, {
        userId: profile.id,
        handedOff: new Set(
          state.notifications.filter((n) => n.task_id).map((n) => n.task_id!),
        ),
      }).map((task) => (
        <PortalTaskRow
          key={task.id}
          row={task}
          centerName={centerName}
          onChoose={choose}
          extra={
            centerName(task.center_code) +
            ' · 휴지통 이동 ' +
            portalStamp(task.deleted_at)
          }
        />
      ))}
      {!state.tasks.length ? (
        <div className="portal-empty">
          <strong>표시할 항목이 없습니다.</strong>
          <p>휴지통으로 이동한 업무가 여기에 표시됩니다.</p>
        </div>
      ) : null}
    </>
  );
}
