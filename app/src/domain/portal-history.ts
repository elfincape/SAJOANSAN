import { koreaDate } from './operations';
import { taskState, overlapsPeriod } from './portal-calendar';
import type { PortalTask, PortalIncident, PortalEvent } from './portal-types';
export const historyStatuses: Record<string, string> = {
  active: '처리중',
  delayed: '지연',
  completed: '완료',
  not_applicable: '해당없음',
  trashed: '휴지통',
};
export interface HistoryData {
  events: PortalEvent[];
  tasks: PortalTask[];
  incidents: PortalIncident[];
}
export type HistoryRecord = (PortalTask | PortalIncident) & {
  kind: 'task' | 'incident';
  key: string;
  events: PortalEvent[];
  state: string;
  last_activity: string;
};
export const visibleHistoryEvents = (events: PortalEvent[]) =>
  events.filter((event) => event.action !== 'file_uploaded');
export function historyState(
  record: PortalTask | PortalIncident,
  kind: string,
  now = new Date(),
) {
  if (record.deleted_at) return 'trashed';
  if (record.status === 'not_applicable') return 'not_applicable';
  if (['completed', 'resolved'].includes(record.status)) return 'completed';
  return kind === 'incident' ? 'active' : taskState(record as PortalTask, now);
}
export function groupHistory({
  events = [],
  tasks = [],
  incidents = [],
  center = '',
  from,
  through,
  status = '',
  now = new Date(),
}: Partial<HistoryData> & {
  center?: string;
  from: string;
  through: string;
  status?: string;
  now?: Date;
}) {
  const grouped = new Map<string, PortalEvent[]>();
  for (const event of visibleHistoryEvents(events)) {
    const key = event.incident_id
      ? 'incident:' + event.incident_id
      : event.task_id
        ? 'task:' + event.task_id
        : null;
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(event);
  }
  const records: HistoryRecord[] = [];
  for (const [kind, rows] of [
    ['task', tasks],
    ['incident', incidents],
  ] as const)
    for (const row of rows) {
      const key = kind + ':' + row.id,
        history = grouped.get(key) ?? [],
        state = historyState(row, kind, now),
        eventInPeriod = history.some((e) => {
          const day = e.report_date || koreaDate(new Date(e.occurred_at));
          return day >= from && day <= through;
        }),
        unfinished = ['active', 'delayed'].includes(state),
        inPeriod =
          kind === 'task'
            ? overlapsPeriod(row as PortalTask, from, through)
            : !!row.created_at &&
              koreaDate(new Date(row.created_at)) >= from &&
              koreaDate(new Date(row.created_at)) <= through,
        start =
          kind === 'task'
            ? (row as PortalTask).work_date
            : row.created_at && koreaDate(new Date(row.created_at));
      if (
        (center && row.center_code !== center) ||
        (status && state !== status) ||
        !(eventInPeriod || inPeriod || (unfinished && start <= through))
      )
        continue;
      records.push({
        ...row,
        kind,
        key,
        events: history,
        state,
        last_activity: history.reduce(
          (last, e) => (e.occurred_at > last ? e.occurred_at : last),
          row.created_at || '',
        ),
      });
    }
  return records.sort(
    (a, b) =>
      b.last_activity.localeCompare(a.last_activity) ||
      a.key.localeCompare(b.key),
  );
}
