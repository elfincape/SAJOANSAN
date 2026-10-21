import { supabase } from './supabase';
import ExcelJS from 'exceljs';
export interface RelationIssue {
  address?: string;
  from?: string;
  to?: string;
  error: string;
  providerDetail?: string;
}
export interface RelationResult {
  from: string;
  to: string;
  reason: string;
  distanceMeters?: number;
  durationSeconds?: number;
  measuredAt?: string;
  cached?: boolean;
  error?: string;
}
export interface RelationJob {
  id: string;
  status: string;
  origin?: string;
  limit?: number;
  directionsBudget?: number;
  geocodingBudget?: number;
  error?: string;
  sourceRows?: number;
  stops?: number;
  geoDone?: number;
  geoTotal?: number;
  candidates?: number;
  processed?: number;
  completed?: number;
  cached?: number;
  failed?: number;
  deferred?: number;
  directionsAttempts?: number;
  geocodingAttempts?: number;
  geoIssues?: RelationIssue[];
  routeIssues?: RelationIssue[];
  apiIssue?: RelationIssue;
  lastResults?: RelationResult[];
  busy?: boolean;
  updatedAt?: string;
  sameLocation?: boolean;
}
export interface RelationPreview {
  sourceRows: number;
  stops: number;
  invalidRows: number;
  estimatedCandidates: number;
  directionsBudget: number;
}
export interface SavedRelationJob {
  id: string;
  status: string;
  directions_attempts: number;
  state?: { origin?: string; groups?: { sources?: { source: string }[] }[] };
}
export async function relationCall<T>(
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('naver-relations', {
    body: { ...args, center: '002', action },
  });
  if (error) {
    let text = error.message;
    try {
      text = (await error.context.json()).error || text;
    } catch {
      /* Preserve connection fallback. */
    }
    throw Error(text || '구간 수집 연결 실패');
  }
  if (data?.error && !(data.id && data.status)) throw Error(data.error);
  return data as T;
}
export function relationJobs(owner: string) {
  return supabase
    .from('naver_api_jobs')
    .select('id,status,state,directions_attempts')
    .eq('owner_id', owner)
    .eq('center_code', '002')
    .eq('state->>kind', 'collection')
    .order('created_at', { ascending: false })
    .range(0, 9)
    .returns<SavedRelationJob[]>();
}
export function latestRelationJob(owner: string) {
  return supabase
    .from('naver_api_jobs')
    .select('id')
    .eq('owner_id', owner)
    .eq('center_code', '002')
    .eq('state->>kind', 'collection')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
}
export function cancelRelationJob(id: string) {
  return supabase.rpc('naver_api_cancel', { p_job: id });
}
export async function relationsWorkbook() {
  const addresses = new Map<string, string>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from('naver_api_addresses')
      .select('id,address')
      .eq('center_code', '002')
      .order('id')
      .range(offset, offset + 499);
    if (error) throw Error('주소 조회 실패');
    for (const a of data) addresses.set(a.id, a.address);
    if (data.length < 500) break;
  }
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet('평택 도로 구간');
  sheet.addRow([
    '출발 주소',
    '도착 주소',
    '도로 거리(km)',
    '이동시간(분)',
    '측정 시각(KST)',
    '경로 기준',
    '상태',
  ]);
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from('naver_api_legs')
      .select(
        'from_id,to_id,distance_meters,duration_seconds,measured_at,priority',
      )
      .eq('center_code', '002')
      .order('from_id')
      .order('to_id')
      .order('coords_key')
      .order('priority')
      .range(offset, offset + 499);
    if (error) throw Error('구간 조회 실패');
    for (const row of data)
      sheet.addRow([
        addresses.get(row.from_id) || '',
        addresses.get(row.to_id) || '',
        Number(row.distance_meters) / 1000,
        Number(row.duration_seconds) / 60,
        new Date(row.measured_at).toLocaleString('ko-KR', {
          timeZone: 'Asia/Seoul',
        }),
        row.priority,
        Date.now() - Date.parse(row.measured_at) > 1800000
          ? '오래된 추정'
          : '조회 시점 추정',
      ]);
    if (data.length < 500) break;
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.columns.forEach((c, i) => {
    c.width = i < 2 ? 55 : 24;
  });
  sheet.getRow(1).font = { bold: true };
  return wb.xlsx.writeBuffer();
}
