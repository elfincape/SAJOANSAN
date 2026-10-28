export interface NaverCourse {
  id: string;
  sourceRow: number;
  name: string;
  stops: string[];
  sourceRows?: number[];
  rotations?: 2;
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
export function parseNaverCourses(rows: unknown[][]): CourseImport {
  const courses: NaverCourse[] = [],
    issues: CourseImport['issues'] = [];
  const text = (v: unknown) => String(v ?? '').trim();
  const header = rows[0]?.map(text) ?? [];
  if (COURSE_HEADERS.some((h) => !header.includes(h)))
    return {
      courses,
      issues: [
        {
          sourceRow: 1,
          message:
            '양식의 열 제목을 유지해 주세요: ' + COURSE_HEADERS.join(', '),
        },
      ],
    };
  if (new Set(header.filter(Boolean)).size !== header.filter(Boolean).length)
    return {
      courses,
      issues: [{ sourceRow: 1, message: '중복된 열 제목이 있습니다.' }],
    };
  const parsed: {
    course: NaverCourse;
    garage: string;
    center: string;
    deliveries: string[];
    base: string;
    rotation: string;
    valid: boolean;
  }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.some((v) => text(v))) continue;
    const get = (h: string) => text(row[header.indexOf(h)]);
    const name = get('코스명'),
      garage = get('차고지'),
      center = get('센터'),
      end = get('복귀차고지');
    const extra =
      row.slice(header.length).some((v) => text(v)) ||
      header.some((h, c) => !COURSE_HEADERS.includes(h) && text(row[c]));
    const stops = [
      garage,
      center,
      ...['납품처1', '납품처2', '납품처3', '납품처4'].map(get).filter(Boolean),
      end,
    ];
    let message = '';
    if (extra)
      message = '양식 밖에 값이 있습니다. 센터 포함 경유지는 최대 5곳입니다.';
    else if (!name || !garage || !center || !get('납품처1') || !end)
      message = '코스명·차고지·센터·납품처1·복귀차고지는 필수입니다.';
    else if (garage !== end)
      message = '출발 차고지와 복귀 차고지 주소를 동일하게 입력해 주세요.';
    else if (name.length > 100 || stops.some((s) => s.length > 300))
      message = '코스명은 100자, 주소는 300자 이내로 입력해 주세요.';
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
    issues.push({ sourceRow: 2, message: '등록할 코스가 없습니다.' });
  return { courses, issues };
}
