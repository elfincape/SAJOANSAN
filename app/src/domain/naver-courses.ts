import {
  findCourseTables,
  courseTableProblems,
  deliveryColumns,
  isRepeatedCourseHeader,
  cellText,
  meaningfulCourseRow,
} from './naver-course-import';
import type { CourseTable } from './naver-course-import';
export interface CourseIssue {
  sourceRow: number;
  message: string;
  courseId?: string;
}
export interface NaverCourse {
  id: string;
  sourceRow: number;
  name: string;
  stops: string[];
  sourceRows?: number[];
  rotations?: 2;
  sourceSheet?: string;
  rotation?: 1 | 2;
  groupName?: string;
  garage?: string;
  center?: string;
  importIssues?: CourseIssue[];
}
export interface CourseImport {
  courses: NaverCourse[];
  issues: CourseIssue[];
}
export function courseTitle(course: NaverCourse): string {
  return course.rotation
    ? `${course.groupName || course.name} · ${course.rotation}회전`
    : course.name + (course.rotations === 2 ? ' · 이전 통합 2회전' : '');
}
export function courseComparisonCount(course: NaverCourse): number {
  const deliveries = course.stops.slice(course.rotation === 2 ? 1 : 2, -1);
  const factorial = (n: number) => {
    let count = 1;
    for (let i = 2; i <= n; i++) count *= i;
    return count;
  };
  const duplicates = new Map<string, number>();
  for (const address of deliveries)
    duplicates.set(address, (duplicates.get(address) ?? 0) + 1);
  return (
    factorial(deliveries.length) /
    [...duplicates.values()].reduce((count, n) => count * factorial(n), 1)
  );
}
export const COURSE_HEADERS = [
  '코스명',
  '차고지',
  '센터',
  '납품처1',
  '납품처2',
  '납품처3',
  '납품처4',
  '납품처5',
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
      deliveries = destinations.map((c) => text(row[c])).filter(Boolean);
    if (!meaningfulCourseRow([name, garage, center, ...deliveries])) continue;
    if (
      /^(합계|소계|총계)$/.test(name) &&
      !garage &&
      !center &&
      !deliveries.length
    )
      continue;
    const match = name.match(/^(.+?)([12])회$/),
      paired = match && (!/\d$/.test(match[1]) || /\s$/.test(match[1]));
    const rotation = paired ? (Number(match[2]) as 1 | 2) : undefined,
      groupName = paired ? match[1].trim() : undefined;
    const stops =
      rotation === 1
        ? [garage, center, ...deliveries, center]
        : rotation === 2
          ? [center, ...deliveries, garage]
          : [garage, center, ...deliveries, garage];
    const course: NaverCourse = {
      id: 'row-' + (i + 1),
      sourceRow: i + 1,
      name,
      stops,
      ...(rotation ? { rotation, groupName, garage, center } : {}),
    };
    let message = '';
    const missing = [
      !name ? '호차·코스명' : '',
      !garage ? '차고지' : '',
      !center ? '센터' : '',
      !deliveries.length ? '납품처' : '',
    ].filter(Boolean);
    if (missing.length)
      message = `누락: ${missing.join(', ')}. 실제 코스 행의 값을 확인해 주세요.`;
    else if (
      stops.some(
        (s) =>
          /^[-+]?\d+(?:\.\d+)?$/.test(s) ||
          /^0\d{8,10}$/.test(s.replaceAll('-', '')),
      )
    )
      message =
        '주소·장소명 열에 번호 또는 숫자만 들어 있습니다. 열 인식을 확인해 주세요.';
    else if (name.length > 100 || stops.some((s) => s.length > 300))
      message = '코스명은 100자, 주소는 300자 이내로 입력해 주세요.';
    else if (stops.length > 7)
      message = `센터 포함 경유지가 ${stops.length - 2}곳입니다. 네이버 한도 5곳을 초과합니다.`;
    if (message)
      issues.push({
        sourceRow: i + 1,
        courseId: course.id,
        message: `${courseTitle(course)}: ${message}`,
      });
    parsed.push({
      course,
      garage,
      center,
      deliveries,
      base: groupName || '',
      rotation: rotation ? String(rotation) : '',
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
        issues.push({
          sourceRow: r.course.sourceRow,
          courseId: r.course.id,
          message,
        }),
      );
    if (first.length !== 1 || second.length !== 1) {
      fail(
        `${entry.base}: 1회·2회가 정확히 한 행씩 필요합니다. 짝 누락 또는 회차 중복을 확인해 주세요.`,
      );
      continue;
    }
    const one = first[0],
      two = second[0];
    if (
      one.valid &&
      two.valid &&
      (one.garage !== two.garage || one.center !== two.center)
    ) {
      fail(`${entry.base}: 두 행의 차고지·센터 주소를 동일하게 입력해 주세요.`);
      continue;
    }
    for (const turn of [one, two]) if (turn.valid) courses.push(turn.course);
  }
  if (courses.length > 100 || parsed.length > 200)
    issues.push({
      sourceRow: 1,
      message:
        '한 번에 최대 100건을 조회합니다. 각 회전은 별도 조회 1건입니다(원본 최대 200행).',
    });
  return { courses, issues };
}
