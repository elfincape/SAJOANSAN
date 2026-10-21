import { usePortal } from './PortalStore';
import { PortalTaskRow } from './PortalTaskList';
import { finished, orderTasks } from '../../domain/portal-model';
import { taskPeriod } from '../../domain/portal-calendar';
import { portalStamp } from '../../domain/portal-types';
import { assignedToMe } from '../../domain/portal-assignment';
export function PortalHeadquarters() {
  const { state, profile, choose, centerName, update } = usePortal(),
    tasks = orderTasks(state.tasks, {
      userId: profile.id,
      handedOff: new Set(
        state.notifications.filter((n) => n.task_id).map((n) => n.task_id!),
      ),
    }),
    own = tasks.filter(
      (t) => assignedToMe(t, profile, state.participants) && !finished(t),
    ),
    pending = tasks.filter((t) => !finished(t)),
    incidents = state.incidents.filter((i) => i.status === 'open');
  return (
    <>
      <h3>내 업무</h3>
      {own.map((task) => (
        <PortalTaskRow
          key={task.id}
          row={task}
          hq
          centerName={centerName}
          onChoose={choose}
          extra={taskPeriod(task)}
        />
      ))}
      {!own.length ? <p>현재 맡은 미완료 업무가 없습니다.</p> : null}
      <details
        className="hq-review"
        open={state.hqReviewOpen}
        onToggle={(e) => {
          const open = e.currentTarget.open;
          if (open !== state.hqReviewOpen)
            update((s) => {
              s.hqReviewOpen = open;
            });
        }}
      >
        <summary>
          <strong>확인 필요</strong>
          <span className="badge">{pending.length + incidents.length}건</span>
        </summary>
        <div className="hq-review-list">
          {pending.map((task) => (
            <PortalTaskRow
              key={task.id}
              row={task}
              hq
              centerName={centerName}
              onChoose={choose}
              extra={taskPeriod(task)}
            />
          ))}
          {incidents.map((row) => (
            <PortalTaskRow
              key={row.id}
              row={{
                ...row,
                center_code:
                  state.parents.find((t) => t.id === row.task_id)
                    ?.center_code ?? row.center_code,
              }}
              type="incident"
              hq
              centerName={centerName}
              onChoose={() => choose({ type: 'incident', row })}
              extra={[
                portalStamp(row.created_at),
                row.support_state === 'requested'
                  ? '배송팀 지원 요청'
                  : row.support_state === 'supporting'
                    ? '배송팀 지원 중'
                    : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
          {!pending.length && !incidents.length ? (
            <p>확인 필요한 미완료 항목이 없습니다.</p>
          ) : null}
        </div>
      </details>
    </>
  );
}
