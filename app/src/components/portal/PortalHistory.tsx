import { useEffect, useState } from 'react';
import type { PortalEvent } from '../../domain/portal-types';
import { portalStamp } from '../../domain/portal-types';
import { portalApi } from '../../lib/portal';
import { actionLabels } from '../../domain/operations';
import { usePortal } from './PortalStore';
import { subjectLabel } from './PortalTaskList';
export function PortalRecordHistory({
  kind,
  id,
  version,
}: {
  kind: 'task' | 'incident';
  id: string;
  version: number;
}) {
  const { state, centerName } = usePortal(),
    [events, setEvents] = useState<PortalEvent[]>([]),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void portalApi
      .events(kind === 'task' ? { taskId: id } : { incidentId: id })
      .then((events) => {
        if (active) {
          setEvents(events.filter((e) => e.action !== 'file_uploaded'));
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [kind, id, version]);
  const label = (id?: string) =>
    subjectLabel(
      state.participants.find((s) => s.id === id),
      centerName,
    );
  return (
    <details className="history">
      <summary>처리 기록</summary>
      {error ? (
        <p>처리 기록을 불러오지 못했습니다.</p>
      ) : (
        events.map((event) => (
          <div key={event.id} className="history-entry">
            <small>
              {portalStamp(event.occurred_at)} ·{' '}
              {(
                actionLabels[event.action] ??
                (event.action === 'task_reopened' ? '업무 재개' : event.action)
              ).replaceAll('HQ', '배송팀')}
            </small>
            {event.action === 'task_handoff' ? (
              <>
                <p>
                  {label(event.request_body?.from)} →{' '}
                  {label(event.request_body?.to)}
                </p>
                <small>
                  인계 기록자 ·{' '}
                  {subjectLabel(
                    state.participants.find(
                      (s) => s.user_id === event.actor_id,
                    ),
                    centerName,
                  )}
                </small>
              </>
            ) : event.action === 'task_assigned' ? (
              <p>처리 담당 · {label(event.request_body?.handler)}</p>
            ) : null}
            {['note', 'memo', 'reason'].map((key) =>
              event.request_body?.data?.[key] ? (
                <p key={key}>
                  {String(event.request_body.data[key]).replaceAll(
                    'HQ',
                    '배송팀',
                  )}
                </p>
              ) : null,
            )}
          </div>
        ))
      )}
    </details>
  );
}
