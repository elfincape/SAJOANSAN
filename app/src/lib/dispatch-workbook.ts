import ExcelJS from 'exceljs';
import type { ManualPayload } from './dispatch-drafts';
import type {
  DispatchDraft,
  DraftRoute,
  PreparedStop,
} from '../domain/dispatch-manual';
import type { DispatchDestination } from './dispatch-context';
import type { DispatchProfile } from '../domain/dispatch-profiles';
import { prepareStops } from '../domain/dispatch-manual';
export const printable = (value: unknown): string =>
  value == null
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
export const manualTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '미산정';
const time = manualTime;
export function manualRouteLabel(r: DraftRoute, draft: DispatchDraft | null) {
  const ordinal =
    (draft?.routes || [])
      .filter((route) => route.type === r.type)
      .findIndex((route) => route.id === r.id) + 1;
  return [
    r.type === 'fixed' ? r.course || '고정차 ' + ordinal : '임시차 ' + ordinal,
    r.driverName,
    r.vehicleNumber,
  ]
    .filter(Boolean)
    .join(' · ');
}
export function manualRouteIssues(r: DraftRoute) {
  return [...(r.issues || []), ...(r.warnings || [])]
    .map((i) => i.message || i.code)
    .join(' · ');
}
const routeIssues = manualRouteIssues;
export function restoredProfilesChanged(
  payload: ManualPayload,
  destinations: DispatchDestination[],
  date: string,
  addresses: NonNullable<ManualPayload['context']>['addresses'],
) {
  const signature = (stops: PreparedStop[]) =>
    JSON.stringify(
      stops
        .map((stop) => [
          stop.id,
          (stop.deliveryProfiles || [])
            .filter((entry) => entry.profile)
            .map((entry) => [
              String(entry.destinationId),
              ...(
                [
                  'revision',
                  'otd',
                  'mode',
                  'unloadMinutes',
                  'inspectionMinutes',
                  'marginMinutes',
                  'notes',
                  'updatedAt',
                ] as const
              ).map(
                (key) => entry.profile![key as keyof DispatchProfile] ?? null,
              ),
            ])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ])
        .filter(([, entries]) => entries.length)
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  const current = prepareStops(payload.rows || [], destinations, {
    date,
    addresses,
  });
  const grouping = (stops: PreparedStop[]) =>
    JSON.stringify(
      stops
        .map((stop) =>
          (stop.sourceRows || [])
            .map((row) => JSON.stringify([row.id, row.address, row.source]))
            .sort(),
        )
        .map((rows) => JSON.stringify(rows))
        .sort(),
    );
  return (
    grouping(payload.draft.stops || []) !== grouping(current.stops) ||
    signature(payload.draft.stops || []) !== signature(current.stops)
  );
}
export async function manualDispatchWorkbook(
  state: ManualPayload & {
    id: string | null;
    revision: number;
    dirty: boolean;
  },
) {
  if (!state.draft) throw Error('출력할 초안이 없습니다.');
  const wb = new ExcelJS.Workbook();
  const stop = (id: string) => state.draft.stops.find((s) => s.id === id)!;
  const routeLabel = (route: DraftRoute) =>
    manualRouteLabel(route, state.draft);

  const add = (name: string, headers: string[], rows: unknown[][]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(headers);
    for (const row of rows)
      ws.addRow(
        row.map((v) => (typeof v === 'object' ? printable(v) : (v ?? ''))),
      );
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => (c.width = 24));
  };
  const d = state.draft;
  add(
    '배정 초안',
    [
      '기준일',
      '유형',
      '코스',
      '기사',
      '차량',
      '톤수',
      'CJ 기준량',
      '순서',
      '착지',
      '주소',
      '박스',
      '원래 코스',
      '고객사',
      'OTD',
      '서비스 분',
      '여유 분',
      '도착 추정',
      '센터 입차',
      '센터 출발',
      '이배송',
      '확인 필요',
    ],
    d.routes.flatMap((r) =>
      r.stopIds.map((id, i) => {
        const s = stop(id);
        return [
          state.date,
          r.type === 'fixed' ? '고정' : '임시',
          r.course,
          r.driverName,
          r.vehicleNumber,
          r.tons,
          r.capacity,
          i + 1,
          s.name,
          s.address,
          s.boxes,
          s.courses,
          s.customers,
          s.otd,
          s.serviceMinutes,
          s.marginMinutes,
          time(r.schedule?.find((t) => t.stopId === id)?.arrivalTime),
          time(r.centerEntryTime),
          time(r.departureTime),
          r.interdelivery ? '협의 필요' : '없음',
          routeIssues(r),
        ];
      }),
    ),
  );
  add(
    '미배정',
    ['착지', '주소', '박스', '원래 코스', 'OTD', '확인 필요'],
    d.unassigned.map((id) => {
      const s = stop(id);
      return [s.name, s.address, s.boxes, s.courses, s.otd, s.issues];
    }),
  );
  add(
    '원본',
    [
      '파일',
      '시트',
      '행',
      '기준일',
      '코스',
      '고객사',
      '착지',
      '주소',
      '원본 박스',
      'OTD',
      '방식',
      '메모',
      '원본값',
    ],
    state.rows.map((r) => [
      r.source.file,
      r.source.sheet,
      r.source.row,
      r.date,
      r.course,
      r.customer,
      r.name,
      r.address,
      r.boxes,
      r.otd,
      r.mode,
      r.notes,
      r.source.raw,
    ]),
  );
  add(
    '당일 기사',
    ['코스', '기사', '차량', '톤수', '기준량', '운행 가능'],
    state.drivers.map((r) => [
      r.course,
      r.driverName,
      r.vehicleNumber,
      r.tons,
      r.capacity,
      r.available !== false ? '가능' : '불가',
    ]),
  );
  add(
    '확인 항목',
    ['코드', '내용'],
    (d.issues || []).map((i) => [i.code, i.message]),
  );
  add(
    '조정 이력',
    ['시각', '변경 이유'],
    state.history.map((h) => [h.at, h.reason]),
  );
  add(
    '사용 구간',
    ['코스', '구간 자료'],
    d.routes.flatMap((r) =>
      (r.usedLegs || []).map((leg) => [routeLabel(r), leg]),
    ),
  );
  add(
    '저장 정보',
    ['항목', '값'],
    [
      ['기준일', state.date],
      ['저장 ID', state.id],
      ['버전', state.revision],
      ['미저장 변경', state.dirty ? '있음' : '없음'],
      ['변경 이유', state.reason],
      ['설정', d.settings],
      ['상태', '가배차 추정 · 실제 배차 확정 아님'],
    ],
  );
  const bytes = await wb.xlsx.writeBuffer();
  return bytes;
}
