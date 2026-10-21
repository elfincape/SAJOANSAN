import { supabase } from './supabase';
import type { OperationsContext, OperationsRecord } from '../domain/operations';
export async function operationsRpc<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}
export function operationsContext() {
  return operationsRpc<OperationsContext>('operations_portal_context');
}
interface RangeQuery {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
}
export async function operationPages<T>(build: () => RangeQuery) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await build().range(offset, offset + 199);
    if (error) throw error;
    rows.push(...((data || []) as T[]));
    if ((data || []).length < 200) return rows;
  }
}
export function operationsTasks({
  center,
  from,
  through,
  includeCompleted = false,
  trash = false,
}: {
  center?: string;
  from: string;
  through: string;
  includeCompleted?: boolean;
  trash?: boolean;
}) {
  if (
    includeCompleted &&
    ![from, through].every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
  )
    throw Error('조회 기간을 확인해 주세요.');
  return operationPages<OperationsRecord>(() => {
    let query = supabase
      .from('operations_tasks')
      .select('*')
      .order('work_date')
      .order('created_at')
      .order('id');
    if (center) query = query.eq('center_code', center);
    query = trash
      ? query.not('deleted_at', 'is', null)
      : query.is('deleted_at', null);
    query = trash
      ? query
      : includeCompleted
        ? query.or(
            `status.in.(pending,in_progress),and(work_date.lte.${through},work_end_date.gte.${from}),and(work_end_date.is.null,work_date.gte.${from},work_date.lte.${through})`,
          )
        : query.in('status', ['pending', 'in_progress']);
    return query;
  });
}
export function operationsIncidents({
  center,
  hqSupport = false,
  includeResolved = false,
}: {
  center?: string;
  hqSupport?: boolean;
  includeResolved?: boolean;
}) {
  return operationPages<OperationsRecord>(() => {
    let query = supabase
      .from('operations_incidents')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id');
    if (center) query = query.eq('center_code', center);
    if (!includeResolved) query = query.eq('status', 'open');
    if (hqSupport)
      query = query.in('support_state', ['requested', 'supporting']);
    return query;
  });
}
export function operationsDailyLog({
  center,
  from,
  through,
  settlement,
}: {
  center?: string;
  from: string;
  through: string;
  settlement?: string;
}) {
  return operationPages<OperationsRecord>(() => {
    let query = supabase
      .from('operations_daily_log')
      .select('*')
      .gte('report_date', from)
      .lte('report_date', through)
      .order('occurred_at')
      .order('id');
    if (center) query = query.eq('center_code', center);
    if (settlement) query = query.eq('inputs->>정산방식', settlement);
    return query;
  });
}
export function operationsIncidentAction({
  requestId,
  incident,
  action,
  data = {},
}: {
  requestId: string;
  incident: OperationsRecord | null;
  action: string;
  data?: Record<string, unknown>;
}) {
  return operationsRpc<OperationsRecord>('operations_incident_action', {
    p_request_id: requestId,
    p_incident_id: incident?.id ?? null,
    p_expected_version: incident?.version ?? null,
    p_action: action,
    p_data: data,
  });
}
