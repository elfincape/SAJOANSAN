export type CourseColumnRole =
  'name' | 'garage' | 'center' | 'delivery' | 'ignore' | 'unassigned';
export interface CourseTable {
  headerRow: number;
  headerSpan: number;
  headers: string[];
  effectiveHeaders: string[];
  roles: CourseColumnRole[];
  score: number;
  endRow?: number;
}
export const COURSE_ROLE_LABELS: Record<CourseColumnRole, string> = {
  name: '호차·코스명',
  garage: '차고지',
  center: '센터·상차지',
  delivery: '납품처',
  ignore: '참고 정보 · 사용 안 함',
  unassigned: '열의 의미 확인 필요',
};
export const cellText = (v: unknown) => String(v ?? '').trim();
const normalized = (v: unknown) =>
  cellText(v)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-·:()[\]（）/\\.]/g, '');
const legacyGarage = (value: string) =>
  /^(복귀|도착|종료)차고지(명|주소)*$/.test(normalized(value));
const legacyReturn = (value: string) =>
  /^(복귀(지|주소)?|차고지복귀|차고지도착|최종도착지(주소)?|종점)$/.test(
    normalized(value),
  );
const ordinal = (v: string) => Number(normalized(v).match(/\d+/)?.[0] ?? 0);
function roleOf(value: string): CourseColumnRole {
  const h = normalized(value);
  if (
    /^(no|번호|순번|연번|비고|메모|기사명?|기사이름|운전자|차량번호|차량톤수|차량|전화번호|연락처|휴대폰|톤수|온도|물량|박스수|대수|거리|시간|출발시간|입차시간|운수사|회사|운송사|착지수|납품처수)$/.test(
      h,
    ) ||
    /^(차고지|센터|납품처|착지|거래처|배송지)\d*(코드|번호|수량|물량|시간|거리)$/.test(
      h,
    )
  )
    return 'ignore';
  if (
    /^(코스명|코스|코스번호|코스이름|호차|호차명|호차번호|차량코스|차량코스명|운행코스|노선|노선명|노선번호|route|routename)$/.test(
      h,
    )
  )
    return 'name';
  if (legacyGarage(h)) return 'garage';
  if (legacyReturn(h)) return 'ignore';
  if (
    /^(출발)?차고지(명|주소|출발)*$/.test(h) ||
    /^(출발지|기점)(명|주소)*$/.test(h)
  )
    return 'garage';
  if (
    /^(센터|물류센터|상차센터|출고센터|상차지|출고지|공장|집하지)(명|주소)*$/.test(
      h,
    )
  )
    return 'center';
  if (
    /^(납품처|납품지|배송지|착지|하차지|거래처|경유지|고객사)(\d+|번|명|주소)*$/.test(
      h,
    )
  )
    return 'delivery';
  if (
    /^\d+(번|차)?(납품처|납품지|배송지|착지|하차지|거래처|경유지)(명|주소)*$/.test(
      h,
    )
  )
    return 'delivery';
  return 'unassigned';
}
function headerSpan(rows: unknown[][], r: number) {
  const next = (rows[r + 1] ?? []).map(normalized).filter(Boolean);
  return next.filter((v) => /^(주소|명|번호|납품처|착지)(\d+)?$/.test(v))
    .length >= 2 &&
    next.every(
      (v) => /^\d+$/.test(v) || /^(주소|명|번호|납품처|착지)(\d+)?$/.test(v),
    )
    ? 2
    : 1;
}
export function courseTableAt(
  rows: unknown[][],
  headerRow: number,
): CourseTable {
  const span = headerSpan(rows, headerRow),
    top = (rows[headerRow] ?? []).map(cellText),
    bottom = span === 2 ? (rows[headerRow + 1] ?? []).map(cellText) : [];
  const width = Math.max(
    top.length,
    bottom.length,
    rows.reduce((width, row) => Math.max(width, row.length), 0),
    0,
  );
  let previousDelivery = '';
  const headers = Array.from({ length: width }, (_, c) => {
    const label =
      top[c] ||
      (!top[c] && previousDelivery && /^\d+$/.test(bottom[c] ?? '')
        ? previousDelivery
        : '');
    if (top[c]) previousDelivery = roleOf(top[c]) === 'delivery' ? top[c] : '';
    return span === 2 ? [label, bottom[c]].filter(Boolean).join(' ') : label;
  });
  const effectiveHeaders = [...headers],
    roles = headers.map(roleOf);
  const samples = rows
    .slice(headerRow + span)
    .filter((r) => r.some((v) => cellText(v)));
  const genericPairs = headers.filter(
    (h, c) =>
      c > 0 &&
      /^(주소|도로명주소|소재지)\d*$/.test(normalized(h)) &&
      ['garage', 'center', 'delivery'].includes(roles[c - 1]),
  ).length;
  const addressLike = (value: unknown) =>
    /(?:대로|로|길)\s*\d|(?:시|군|구)\s+.*(?:동|읍|면|리)\s*\d/.test(
      cellText(value),
    );
  for (let c = 0; c < width; c++) {
    if (
      /^(주소|도로명주소|소재지)\d*$/.test(normalized(headers[c])) &&
      c > 0 &&
      ['garage', 'center', 'delivery'].includes(roles[c - 1])
    ) {
      const previous = normalized(headers[c - 1]);
      if (
        !previous.includes('주소') &&
        !samples.some((row) => addressLike(row[c - 1])) &&
        (genericPairs >= 2 || previous.includes('명'))
      ) {
        roles[c] = roles[c - 1];
        effectiveHeaders[c] = headers[c - 1] + ' 주소';
        roles[c - 1] = 'ignore';
      }
    }
    if (roles[c] === 'unassigned' && !samples.some((r) => cellText(r[c])))
      roles[c] = 'ignore';
  }
  if (
    roles.some((r, c) => r === 'garage' && !legacyGarage(effectiveHeaders[c]))
  )
    for (let c = 0; c < roles.length; c++)
      if (roles[c] === 'garage' && legacyGarage(effectiveHeaders[c]))
        roles[c] = 'ignore';
  for (let c = 1; c < roles.length; c++)
    if (
      roles[c] === 'unassigned' &&
      /^(주소|도로명주소|소재지)\d*$/.test(normalized(headers[c])) &&
      legacyReturn(headers[c - 1])
    )
      roles[c] = 'ignore';
  for (const role of ['garage', 'center'] as const) {
    const columns = roles.flatMap((r, c) => (r === role ? [c] : [])),
      addresses = columns.filter((c) =>
        normalized(effectiveHeaders[c]).includes('주소'),
      );
    if (addresses.length === 1)
      for (const c of columns) if (c !== addresses[0]) roles[c] = 'ignore';
  }
  // A place-name column followed by its numbered address column describes one stop.
  for (let c = 0; c < width; c++)
    if (
      roles[c] === 'delivery' &&
      normalized(effectiveHeaders[c]).includes('주소')
    ) {
      for (let p = 0; p < c; p++)
        if (
          roles[p] === 'delivery' &&
          !normalized(effectiveHeaders[p]).includes('주소') &&
          ((ordinal(effectiveHeaders[c]) > 0 &&
            ordinal(effectiveHeaders[p]) === ordinal(effectiveHeaders[c])) ||
            (p === c - 1 &&
              !ordinal(effectiveHeaders[p]) &&
              !ordinal(effectiveHeaders[c])))
        )
          roles[p] = 'ignore';
    }
  const garages = roles.flatMap((r, c) => (r === 'garage' ? [c] : []));
  if (
    garages.length === 2 &&
    samples.some((r) => cellText(r[garages[0]]) && cellText(r[garages[1]])) &&
    samples.every(
      (r) =>
        !cellText(r[garages[0]]) ||
        !cellText(r[garages[1]]) ||
        cellText(r[garages[0]]) === cellText(r[garages[1]]),
    )
  )
    roles[garages[1]] = 'ignore';
  const unique = new Set(
    roles.filter((r) => !['ignore', 'unassigned'].includes(r)),
  );
  return {
    headerRow,
    headerSpan: span,
    headers,
    effectiveHeaders,
    roles,
    score: unique.size * 10 + roles.filter((r) => r === 'delivery').length,
  };
}
export function findCourseTables(rows: unknown[][]): CourseTable[] {
  const found: CourseTable[] = [];
  for (let r = 0; r < rows.length; r++) {
    const hints = new Set(
      (rows[r] ?? [])
        .map((v) => roleOf(cellText(v)))
        .filter((r) => !['ignore', 'unassigned'].includes(r)),
    );
    if (hints.size < 2) continue;
    const table = courseTableAt(rows, r),
      roles = new Set(table.roles);
    if (
      (roles.has('name') &&
        ['garage', 'center', 'delivery'].some((k) =>
          roles.has(k as CourseColumnRole),
        )) ||
      (roles.has('garage') && roles.has('center') && roles.has('delivery'))
    ) {
      if (
        !found.some(
          (t) =>
            JSON.stringify(t.headers.map(normalized)) ===
            JSON.stringify(table.headers.map(normalized)),
        )
      )
        found.push(table);
      r += table.headerSpan - 1;
    }
  }
  return found.map((table, i) => {
    const endRow = found[i + 1]?.headerRow ?? rows.length;
    return { ...courseTableAt(rows.slice(0, endRow), table.headerRow), endRow };
  });
}
export function courseTableProblems(table: CourseTable): string[] {
  const problems: string[] = [];
  for (const role of ['name', 'garage', 'center'] as const) {
    const count = table.roles.filter((r) => r === role).length;
    if (count !== 1)
      problems.push(
        `${COURSE_ROLE_LABELS[role]} 열을 ${count ? '하나만' : '직접'} 선택해 주세요.`,
      );
  }
  if (!table.roles.includes('delivery'))
    problems.push('납품처 열을 선택해 주세요.');
  if (table.roles.includes('unassigned'))
    problems.push(
      '의미를 확인하지 못한 열의 역할을 선택해 주세요. 참고 열이면 사용 안 함으로 지정합니다.',
    );
  const numbers = table.roles.flatMap((role, c) =>
    role === 'delivery' && ordinal(table.effectiveHeaders[c])
      ? [ordinal(table.effectiveHeaders[c])]
      : [],
  );
  if (new Set(numbers).size !== numbers.length)
    problems.push(
      '같은 번호의 납품처 열이 여러 개입니다. 주소 열을 선택하고 이름 등 참고 열은 사용 안 함으로 지정해 주세요.',
    );
  return problems;
}
export function deliveryColumns(table: CourseTable): number[] {
  const columns = table.roles.flatMap((role, c) =>
    role === 'delivery' ? [c] : [],
  );
  return columns;
}
export function isRepeatedCourseHeader(
  row: unknown[],
  table: CourseTable,
): boolean {
  const relevant = table.roles.flatMap((r, c) =>
    !['ignore', 'unassigned'].includes(r) ? [c] : [],
  );
  return (
    relevant.length > 0 &&
    relevant.every((c) => normalized(row[c]) === normalized(table.headers[c]))
  );
}
