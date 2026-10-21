import { supabase } from './supabase';
import { portalApi } from './portal';
import { operationPages } from './operations';
import type {
  PortalTask,
  PortalIncident,
  PortalEvent,
} from '../domain/portal-types';
import type { HistoryData } from '../domain/portal-history';
export async function portalHistoryRecords({
  center,
  from,
  through,
}: {
  center?: string;
  from: string;
  through: string;
}): Promise<HistoryData> {
  if (![from, through].every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)))
    throw Error('조회 기간을 확인해 주세요.');
  const start = from + 'T00:00:00+09:00',
    end = new Date(through + 'T00:00:00+09:00');
  end.setUTCDate(end.getUTCDate() + 1);
  const [log, tasks, incidents] = await Promise.all([
      portalApi.dailyLog({ center, from, through }),
      portalApi.tasks({ center, from, through, includeCompleted: true }),
      operationPages<PortalIncident>(() => {
        const query = supabase
          .from('operations_incidents')
          .select('*')
          .or(
            `status.eq.open,and(created_at.gte.${start},created_at.lt.${end.toISOString()})`,
          )
          .order('created_at')
          .order('id');
        return center ? query.eq('center_code', center) : query;
      }),
    ]),
    events = log.filter(
      (e) => e.action !== 'file_uploaded',
    ) as unknown as PortalEvent[];
  for (const [table, rows, ids] of [
    [
      'operations_tasks',
      tasks,
      events.filter((e) => !e.incident_id).map((e) => e.task_id),
    ],
    ['operations_incidents', incidents, events.map((e) => e.incident_id)],
  ] as const) {
    const present = new Set(rows.map((r) => r.id)),
      missing = [
        ...new Set(ids.filter((id): id is string => !!id && !present.has(id))),
      ];
    for (let offset = 0; offset < missing.length; offset += 100) {
      const extra = await operationPages<PortalTask & PortalIncident>(() => {
        const query = supabase
          .from(table)
          .select('*')
          .in('id', missing.slice(offset, offset + 100))
          .order('id');
        return center ? query.eq('center_code', center) : query;
      });
      rows.push(...extra);
    }
  }
  return { events, tasks, incidents };
}
