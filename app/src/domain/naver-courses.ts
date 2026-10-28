import {
  findCourseTables,
  courseTableProblems,
  deliveryColumns,
  isRepeatedCourseHeader,
  cellText,
} from './naver-course-import';
import type { CourseTable } from './naver-course-import';
export interface NaverCourse {
  id: string;
  sourceRow: number;
  name: string;
  stops: string[];
  sourceRows?: number[];
  rotations?: 2;
  sourceSheet?: string;
}
export interface CourseImport {
  courses: NaverCourse[];
  issues: { sourceRow: number; message: string }[];
}
export const COURSE_HEADERS = [
  '코스명',
  '차고지',
  '센터',
  '납품처1',
  '납품처2',
  '납품처3',
  '납품처4',
  '복귀차고지',
];
export function parseNaverCourses(
  rows: unknown[][],
  table?: CourseTable,
): CourseImport {
  const courses: NaverCourse[] = [],
    issues: CourseImport['issues'] = [];
  const text = cellText;
  if (!table) {
    const tables = findCourseTables(rows);
    if (tables.length !== 1)
      return {
        courses,
        issues: [
          {
            sourceRow: 1,
            message: tables.length
              ? '여러 표를 찾았습니다. 가져올 표를 선택해 주세요.'
              : '제목 행과 열을 자동으로 찾지 못했습니다. 시트·제목 행과 필요한 열을 선택해 주세요.',
          },
        ],
      };
    table = tables[0];
  }
  const problems = courseTableProblems(table);
  if (problems.length)
    return {
      courses,
      issues: problems.map((message) => ({
        sourceRow: Math.max(1, table!.headerRow + 1),
        message,
      })),
    };
  const nameColumn = table.roles.indexOf('name'),
    garageColumn = table.roles.indexOf('garage'),
    centerColumn = table.roles.indexOf('center'),
    endColumn = table.roles.indexOf('end'),
    destinations = deliveryColumns(table);
  const parsed: {
    course: NaverCourse;
    garage: string;
    center: string;
    deliveries: string[];
    base: string;
    rotation: string;
    valid: boolean;
  }[] = [];
  for (
    let i = table.headerRow + table.headerSpan;
    i < (table.endRow ?? rows.length);
    i++
  ) {
    const row = rows[i];
    if (!row.some((v) => text(v))) continue;
    if (isRepeatedCourseHeader(row, table)) continue;
    if (
      table.headerSpan === 2 &&
      JSON.stringify(table.headers.map((_, c) => text(row[c]))) ===
        JSON.stringify(
          table.headers.map((_, c) => text(rows[table!.headerRow]?.[c])),
        )
    ) {
      i++;
      continue;
    }
    const name = text(row[nameColumn]),
      garage = text(row[garageColumn]),
      center = text(row[centerColumn]),
      end = endColumn < 0 ? garage : text(row[endColumn]),
      deliveries = destinations.map((c) => text(row[c])).filter(Boolean);
    if (
      !name &&
      !garage &&
      !center &&
      !deliveries.length &&
      !text(row[endColumn])
    )
      continue;
    if (
      /^(합계|소계|총계)$/.test(name) &&
      !garage &&
      !center &&
      !deliveries.length &&
      !text(row[endColumn])
    )
      continue;
    const stops = [garage, center, ...deliveries, end];
    let message = '';
    if (!name || !garage || !center || !deliveries.length || !end)
      message =
        '코스명·차고지·센터·납품처·복귀 주소 중 비어 있는 값을 확인해 주세요. 빈 주소를 추정하지 않습니다.';
    else if (
      stops.some(
        (s) =>
          /^[-+]?\d+(?:\.\d+)?$/.test(s) ||
          /^0\d{8,10}$/.test(s.replaceAll('-', '')),
      )
    )
      message =
        '주소·장소명 열에 번호 또는 숫자만 들어 있습니다. 열 인식을 확인해 주세요.';
    else if (garage !== end)
      message =
        '출발 차고지와 복귀 차고지 주소가 다릅니다. 열 인식 또는 원본 값을 확인해 주세요.';
    else if (name.length > 100 || stops.some((s) => s.length > 300))
      message = '코스명은 100자, 주소는 300자 이내로 입력해 주세요.';
    else if (stops.length > 7)
      message = `센터 포함 경유지가 ${stops.length - 2}곳입니다. 네이버 한도 5곳을 초과합니다.`;
    if (message) issues.push({ sourceRow: i + 1, message });
    const match = name.match(/^(.+?)([12])회$/);
    const paired = match && (!/\d$/.test(match[1]) || /\s$/.test(match[1]));
    parsed.push({
      course: { id: 'row-' + (i + 1), sourceRow: i + 1, name, stops },
      garage,
      center,
      deliveries: stops.slice(2, -1),
      base: paired ? match[1].trim() : '',
      rotation: paired ? match[2] : '',
      valid: !message,
    });
  }
  const handled = new Set<string>();
  for (const entry of parsed) {
    if (!entry.base) {
      if (entry.valid) courses.push(entry.course);
      continue;
    }
    if (handled.has(entry.base)) continue;
    handled.add(entry.base);
    const group = parsed.filter((r) => r.base === entry.base);
    const first = group.filter((r) => r.rotation === '1'),
      second = group.filter((r) => r.rotation === '2');
    const fail = (message: string) =>
      group.forEach((r) =>
        issues.push({ sourceRow: r.course.sourceRow, message }),
      );
    if (first.length !== 1 || second.length !== 1) {
      fail(
        `${entry.base}: 1회·2회가 정확히 한 행씩 필요합니다. 짝 누락 또는 회차 중복을 확인해 주세요.`,
      );
      continue;
    }
    const one = first[0],
      two = second[0];
    if (!one.valid || !two.valid) {
      fail(
        `${entry.base}: 같은 호차의 다른 회차 입력 오류를 먼저 수정해 주세요.`,
      );
      continue;
    }
    if (one.garage !== two.garage || one.center !== two.center) {
      fail(
        `${entry.base}: 두 행의 차고지·센터·복귀차고지 주소를 동일하게 입력해 주세요.`,
      );
      continue;
    }
    const stops = [
      one.garage,
      one.center,
      ...one.deliveries,
      one.center,
      ...two.deliveries,
      one.garage,
    ];
    if (stops.length > 7) {
      fail(
        `${entry.base}: 2회전을 합친 경유지가 ${stops.length - 2}곳입니다. 네이버 한도 5곳을 초과합니다.`,
      );
      continue;
    }
    const sourceRows = [one.course.sourceRow, two.course.sourceRow],
      sourceRow = Math.min(...sourceRows);
    courses.push({
      id: 'row-' + sourceRow,
      sourceRow,
      sourceRows,
      name: entry.base,
      rotations: 2,
      stops,
    });
  }
  if (courses.length > 100 || parsed.length > 200)
    issues.push({
      sourceRow: 1,
      message: '한 번에 최대 100코스(2회전 포함 200행)를 등록해 주세요.',
    });
  if (!courses.length && !issues.length)
    issues.push({
      sourceRow: Math.max(1, table.headerRow + table.headerSpan + 1),
      message: '선택한 표에 등록할 코스가 없습니다.',
    });
  return { courses, issues };
}
