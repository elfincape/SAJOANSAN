import { PortalEventSnapshot } from './PortalEventSnapshot';
import { MentionText } from './PortalMentions';
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
    [error, setError] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setEvents([]);
    setLoading(true);
    setError(false);
    void portalApi
      .events(kind === 'task' ? { taskId: id } : { incidentId: id })
      .then((events) => {
        if (active) {
          setEvents(events.filter((e) => e.action !== 'file_uploaded'));
          setError(false);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) { setError(true); setLoading(false); }
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
      <summary style={{ color: 'var(--theme-text)' }}>처리 기록</summary>
      {loading ? <p role="status">처리 기록을 불러오는 중…</p> : error ? (
        <p>처리 기록을 불러오지 못했습니다.</p>
      ) : !events.length ? <p>조회 가능한 처리 기록이 없습니다.</p> : (
        events.map((event) => (
          <div key={event.id} className="history-entry">
            <small>
              <MentionText>{portalStamp(event.occurred_at)}</MentionText> ·
              <MentionText> </MentionText>
              <MentionText>
                {(
                  actionLabels[event.action] ??
                  (event.action === 'task_reopened'
                    ? '업무 재개'
                    : event.action)
                ).replaceAll('HQ', '배송팀')}
              </MentionText>
            </small>
            <PortalEventSnapshot event={event} />
            {event.action === 'task_handoff' ? (
              <>
                <p>
                  <MentionText>{label(event.request_body?.from)}</MentionText> →
                  <MentionText> </MentionText>
                  <MentionText>{label(event.request_body?.to)}</MentionText>
                </p>
                <small>
                  인계 기록자 ·<MentionText> </MentionText>
                  <MentionText>
                    {subjectLabel(
                      state.participants.find(
                        (s) => s.user_id === event.actor_id,
                      ),
                      centerName,
                    )}
                  </MentionText>
                </small>
              </>
            ) : event.action === 'task_assigned' ? (
              <p>
                처리 담당 ·<MentionText> </MentionText>
                <MentionText>{label(event.request_body?.handler)}</MentionText>
              </p>
            ) : null}
            {['note', 'memo', 'reason'].map((key) =>
              event.request_body?.data?.[key] ? (
                <p key={key}>
                  <MentionText>
                    {String(event.request_body.data[key]).replaceAll(
                      'HQ',
                      '배송팀',
                    )}
                  </MentionText>
                </p>
              ) : null,
            )}
          </div>
        ))
      )}
    </details>
  );
}
