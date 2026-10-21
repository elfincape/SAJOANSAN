import { supabase } from './supabase';
export const mentionLabels: Record<string, string> = {
  task: '업무',
  incident: '특이사항',
  survey: '업무조사',
  routes: '코스',
  drivers: '기사',
  vehicles: '차량',
  companies: '운수사',
  delivery_points: '납품처',
};
const tables: Record<string, string> = {
  task: 'operations_tasks',
  incident: 'operations_incidents',
  survey: 'operations_surveys',
  routes: 'routes',
  drivers: 'drivers',
  vehicles: 'vehicles',
  companies: 'companies',
  delivery_points: 'delivery_points',
};
export interface MentionRow {
  id: string;
  title: string;
  kind: string;
  center_code?: string;
}
export async function searchMentions(query: string) {
  let result = await supabase.rpc('operations_mention_search', {
    p_query: query,
    p_center: null,
    p_page: 0,
  });
  if (result.error?.code === 'PGRST202' && query.length >= 2)
    result = await supabase.rpc('operations_search', {
      p_query: query,
      p_center: null,
      p_page: 0,
    });
  if (result.error) throw result.error;
  const key = query.toLowerCase(),
    rank = (row: MentionRow) => {
      const title = row.title.toLowerCase();
      return title === key
        ? 0
        : title.startsWith(key)
          ? 1
          : title.includes(key)
            ? 2
            : 3;
    };
  return (
    (result.data?.groups ?? []) as {
      kind: string;
      items: Omit<MentionRow, 'kind'>[];
    }[]
  )
    .flatMap((g) =>
      tables[g.kind] ? g.items.map((row) => ({ ...row, kind: g.kind })) : [],
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.title.localeCompare(b.title, 'ko', { numeric: true }),
    )
    .slice(0, 20);
}
export interface MentionRecord {
  row: Record<string, unknown>;
  relations: {
    kind: string;
    rows: Record<string, unknown>[];
    error?: boolean;
  }[];
}
export async function mentionRecord(
  kind: string,
  id: string,
): Promise<MentionRecord> {
  const table = tables[kind];
  if (!table) throw Error('지원하지 않는 정보입니다.');
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  const row = data as Record<string, unknown>,
    relations: MentionRecord['relations'] = [];
  if (kind === 'routes') {
    const groups: [string, unknown[]][] = [
        ['companies', [row.company_id]],
        ['drivers', [row.primary_driver_id, row.secondary_driver_id]],
        ['vehicles', [row.primary_vehicle_id, row.secondary_vehicle_id]],
      ],
      stops = await supabase
        .from('route_stops')
        .select('delivery_point_id,stop_order')
        .eq('route_id', id)
        .order('stop_order');
    if (stops.error) throw stops.error;
    groups.push([
      'delivery_points',
      (stops.data ?? []).map((s) => s.delivery_point_id),
    ]);
    for (const [table, ids] of groups) {
      const keys = [...new Set(ids.filter(Boolean))];
      if (!keys.length) continue;
      const result = await supabase.from(table).select('*').in('id', keys);
      if (result.error) {
        relations.push({ kind: table, rows: [], error: true });
        continue;
      }
      const records = new Map((result.data ?? []).map((r) => [r.id, r]));
      relations.push({
        kind: table,
        rows: keys
          .map((key) => records.get(key))
          .filter((value): value is Record<string, unknown> => !!value),
      });
    }
  }
  return { row, relations };
}
