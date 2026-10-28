import {
  COURSE_ROLE_LABELS,
  cellText,
  courseTableProblems,
} from '../domain/naver-course-import';
import type {
  CourseColumnRole,
  CourseTable,
} from '../domain/naver-course-import';
export interface CourseSheetTable {
  sheet: string;
  rows: unknown[][];
  table: CourseTable;
}
export function NaverCourseMapping({
  sources,
  choice,
  table,
  disabled,
  onSource,
  onHeader,
  onRole,
}: {
  sources: CourseSheetTable[];
  choice: string;
  table: CourseTable | null;
  disabled: boolean;
  onSource: (value: string) => void;
  onHeader: (value: number) => void;
  onRole: (column: number, role: CourseColumnRole) => void;
}) {
  const selected = choice === '' ? undefined : sources[Number(choice)],
    problems = table ? courseTableProblems(table) : [];
  const letter = (c: number) => {
    let n = c + 1,
      value = '';
    while (n > 0) {
      n--;
      value = String.fromCharCode(65 + (n % 26)) + value;
      n = Math.floor(n / 26);
    }
    return value;
  };
  return (
    <div className="capture-mapping space-y-3">
      <label>
        가져올 표
        <select
          className="app-select"
          aria-label="가져올 표"
          disabled={disabled}
          value={choice}
          onChange={(e) => onSource(e.target.value)}
        >
          <option value="">
            {sources.length > 1
              ? '여러 표를 찾았습니다. 가져올 표를 선택해 주세요.'
              : '표를 선택해 주세요.'}
          </option>
          {sources.map((source, i) => (
            <option key={i} value={i}>
              {source.sheet} · {source.table.headerRow + 1}행 제목
              {courseTableProblems(source.table).length
                ? ' · 열 확인 필요'
                : ''}
            </option>
          ))}
        </select>
      </label>
      {table && selected && (
        <>
          <p>
            {selected.sheet} ·{' '}
            {table.headerRow < 0
              ? '제목 없는 데이터'
              : `${table.headerRow + 1}${table.headerSpan === 2 ? '~' + (table.headerRow + 2) : ''}행 제목`}{' '}
            · {problems.length ? '열 연결 확인 필요' : '열 자동 연결 완료'}
            {!table.roles.includes('end')
              ? ' · 복귀 열 없음: 출발 차고지로 복귀'
              : ''}
          </p>
          <details
            key={choice + '-' + table.headerRow}
            open={problems.length > 0 ? true : undefined}
          >
            <summary>인식한 열 확인·수정</summary>
            <label>
              제목 행 (없으면 0)
              <input
                className="app-input"
                type="number"
                aria-label="제목 행 (없으면 0)"
                min={0}
                max={selected.rows.length}
                defaultValue={table.headerRow + 1}
                disabled={disabled}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (
                    Number.isInteger(n) &&
                    n >= 0 &&
                    n <= selected.rows.length
                  )
                    onHeader(n - 1);
                }}
              />
            </label>
            <div
              className="scroll"
              role="region"
              tabIndex={0}
              aria-label="엑셀 열 연결"
            >
              <table className="app-table">
                <thead>
                  <tr>
                    <th>엑셀 열</th>
                    <th>원본 값 예시</th>
                    <th>사용할 항목</th>
                  </tr>
                </thead>
                <tbody>
                  {table.headers.map((header, c) => (
                    <tr key={c}>
                      <th scope="row">
                        {letter(c)} · {header || '제목 없음'}
                      </th>
                      <td>
                        {selected.rows
                          .slice(table.headerRow + table.headerSpan)
                          .map((row) => cellText(row[c]))
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(' / ') || '빈 열'}
                      </td>
                      <td>
                        <select
                          aria-label={`${letter(c)}열 항목`}
                          className="app-select"
                          disabled={disabled}
                          value={table.roles[c]}
                          onChange={(e) =>
                            onRole(c, e.target.value as CourseColumnRole)
                          }
                        >
                          {Object.entries(COURSE_ROLE_LABELS).map(
                            ([role, label]) => (
                              <option key={role} value={role}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
