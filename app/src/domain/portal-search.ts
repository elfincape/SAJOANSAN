export const searchLabels: Record<string, string> = {
  task: '업무',
  incident: '특이사항',
  survey: '업무조사',
  vehicles: '차량',
  drivers: '기사',
  routes: '코스',
  companies: '회사',
  delivery_points: '납품처',
  file: '첨부파일',
};
export interface SearchRow {
  id: string;
  title: string;
  center_code?: string;
  work_date?: string;
  task_id?: string;
  incident_id?: string;
  survey_id?: string;
  excerpt?: string;
  [key: string]: unknown;
}
export interface SearchResult {
  groups: { kind: string; total: number; items: SearchRow[] }[];
}
export function searchTarget(
  kind: string,
  row: SearchRow,
): {
  type?: 'task' | 'incident' | 'survey';
  id?: string;
  href?: string;
} | null {
  if (kind === 'file')
    for (const type of ['task', 'incident', 'survey'] as const)
      if (row[type + '_id']) return { type, id: String(row[type + '_id']) };
  if (['task', 'incident', 'survey'].includes(kind))
    return { type: kind as 'task' | 'incident' | 'survey', id: row.id };
  const page = (
    {
      vehicles: 'vehicles',
      drivers: 'drivers',
      routes: 'route-edit',
      companies: 'companies',
      delivery_points: 'delivery-points',
    } as Record<string, string>
  )[kind];
  return page
    ? {
        href:
          '/admin/' +
          page +
          '.html?' +
          new URLSearchParams({
            id: row.id,
            ...(row.center_code ? { center: row.center_code } : {}),
          }),
      }
    : null;
}
