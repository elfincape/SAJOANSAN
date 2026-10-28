export interface NaverCourse {
  id: string;
  sourceRow: number;
  name: string;
  stops: string[];
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
    else courses.push({ id: 'row-' + (i + 1), sourceRow: i + 1, name, stops });
  }
  if (courses.length + issues.length > 100)
    issues.push({
      sourceRow: 1,
      message: '한 번에 최대 100코스를 등록해 주세요.',
    });
  if (!courses.length && !issues.length)
    issues.push({ sourceRow: 2, message: '등록할 코스가 없습니다.' });
  return { courses, issues };
}
