export interface OperationsRecord {
  id: string;
  title: string;
  center_code: string;
  status: string;
  version?: number;
  work_date?: string;
  work_end_date?: string | null;
  report_date?: string;
  occurred_at?: string;
  created_at?: string;
  updated_at?: string;
  due_at?: string | null;
  cj_share_due_at?: string | null;
  resolved_at?: string | null;
  kind?: string;
  support_state?: string;
  action?: string;
  action_note?: string;
  handoff_memo?: string;
  task_id?: string | null;
  incident_id?: string | null;
  inputs?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface OperationsContext {
  centers: { code: string; name: string }[];
  writable_centers: string[];
  [key: string]: unknown;
}
export interface OperationsFilters {
  center: string;
  from: string;
  through: string;
  kind: string;
  settlement: string;
  unfinished: boolean;
}
export const statusLabels: Record<string, string> = {
  pending: '미완료',
  in_progress: '진행중',
  completed: '완료',
  not_applicable: '해당없음',
  open: '처리중',
  resolved: '처리완료',
};
export const actionLabels: Record<string, string> = {
  member_updated: '멤버 설정 변경',
  task_assigned: '처리 담당 지정',
  task_handoff: '업무 인계',
  task_trashed: '휴지통 이동',
  task_restored: '업무 복원',
  created: '업무 등록',
  updated: '업무 수정',
  completed: '완료',
  not_applicable: '해당없음',
  handoff: '인계',
  deadline: '기한 변경',
  deadline_changed: '기한 변경',
  task_reopened: '업무 재개',
  incident_created: '특이사항 등록',
  incident_updated: '내용 수정',
  support_requested: 'HQ 지원 요청',
  support_action: 'HQ 실제 조치',
  resolved: '해결',
  reopened: '재개',
  file_uploaded: '첨부 파일 저장',
  cj_shared: 'CJ 공유 완료 기록',
  cj_share_retracted: 'CJ 공유 기록 정정',
};
export function koreaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function dateRange(period: string, through = koreaDate()) {
  const end = new Date(through + 'T00:00:00Z');
  if (!Number.isFinite(+end) || end.toISOString().slice(0, 10) !== through)
    throw Error('조회 날짜를 확인해 주세요.');
  const start = new Date(end);
  if (period === 'week') start.setUTCDate(start.getUTCDate() - 6);
  if (period === 'month') start.setUTCDate(1);
  return { from: start.toISOString().slice(0, 10), through };
}
export function filterOperations<T extends OperationsRecord>(
  rows: T[],
  { kind = '', settlement = '' } = {},
) {
  return rows.filter((row) => {
    const inputs = row.inputs ?? {},
      replacement =
        inputs['업무유형'] === '대차 배차 진행' ||
        row.title === '대차 배차 진행' ||
        !!inputs['대차기사명'] ||
        !!inputs['대차차량번호'];
    return (
      (!kind || replacement) &&
      (!settlement || inputs['정산방식'] === settlement)
    );
  });
}
export function exportRows(
  rows: OperationsRecord[],
  view: string,
): Record<string, unknown>[] {
  if (view === 'incidents')
    return rows.map((row) => ({
      발생일: row.created_at,
      특이사항: row.title,
      종류: row.kind,
      상태: statusLabels[row.status] ?? row.status,
      'HQ 지원':
        (
          {
            none: '없음',
            requested: '요청',
            supporting: '지원중',
            done: '지원완료',
          } as Record<string, string>
        )[row.support_state || ''] ?? row.support_state,
      발생내용: row.inputs?.['발생내용'] ?? '',
      해결시각: row.resolved_at ?? '',
    }));
  return rows.map((row) => ({
    업무일: row.work_date ?? row.report_date ?? '',
    업무: row.title,
    상태: statusLabels[row.status] ?? row.status,
    처리:
      view === 'daily' ? (actionLabels[row.action || ''] ?? row.action) : '',
    기사명: row.inputs?.['기사명'] ?? '',
    차량번호: row.inputs?.['차량번호'] ?? '',
    '코스·납품처': row.inputs?.['코스·납품처'] ?? '',
    톤수: row.inputs?.['톤수'] ?? '',
    사유: row.inputs?.['사유'] ?? '',
    대차기사명: row.inputs?.['대차기사명'] ?? '',
    대차차량번호: row.inputs?.['대차차량번호'] ?? '',
    정산방식: row.inputs?.['정산방식'] ?? '',
    '실제 조치': row.action_note ?? '',
    '인계 메모': row.handoff_memo ?? '',
  }));
}
