import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useAdminPage } from './AdminPage';
import { NaverCourseMapping } from './NaverCourseMapping';
import type { CourseSheetTable } from './NaverCourseMapping';
import { findCourseTables, courseTableAt } from '../domain/naver-course-import';
import type {
  CourseColumnRole,
  CourseTable,
} from '../domain/naver-course-import';
import { FileArea } from './FileArea';
import {
  COURSE_HEADERS,
  parseNaverCourses,
  courseTitle,
} from '../domain/naver-courses';
import type { CourseImport } from '../domain/naver-courses';
import {
  captureExports,
  captureImage,
  enqueueCapture,
  getCapture,
  saveFile,
} from '../lib/naver-courses';
import type { CaptureJob } from '../lib/naver-courses';
import { cancelBrowserJob } from '../lib/naver-browser';
import '../styles/naver-capture.css';
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function Preview({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true,
      url = '';
    void captureImage(path)
      .then((blob) => {
        if (active) {
          url = URL.createObjectURL(blob);
          setUrl(url);
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return (
    <>
      {error ? (
        <p role="alert">{error}</p>
      ) : url ? (
        <a href={url} download={name + '.png'} aria-label={name + ' PNG 저장'}>
          <img
            src={url}
            alt={name + ' 네이버 지도 실제 경로 결과'}
            loading="lazy"
          />
        </a>
      ) : (
        <p>이미지 불러오는 중</p>
      )}
    </>
  );
}
export function NaverCourseCapture({
  onBusy,
}: {
  onBusy: (busy: boolean) => void;
}) {
  const { setControlsDisabled, center: selectedCenter } = useAdminPage();
  const [input, setInput] = useState<CourseImport>({ courses: [], issues: [] }),
    [filename, setFilename] = useState(''),
    [job, setJob] = useState<CaptureJob | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  const [sources, setSources] = useState<CourseSheetTable[]>([]),
    [choice, setChoice] = useState(''),
    [table, setTable] = useState<CourseTable | null>(null);
  const mounted = useRef(true),
    center = selectedCenter.code;
  const legacyCombined = !!job?.courses.some(
    (c) => c.rotations === 2 && !c.rotation,
  );
  const running = !!job && ['queued', 'running'].includes(job.status);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onBusy(busy || running);
    setControlsDisabled(busy || running);
    return () => setControlsDisabled(false);
  }, [busy, running, setControlsDisabled, onBusy]);
  useEffect(() => {
    if (!running || !job) return;
    let active = true;
    const timer = setInterval(() => {
      void getCapture(job.id, center)
        .then((j) => {
          if (active && j) setJob(j);
        })
        .catch((e) => {
          if (active) setStatus(errorText(e));
        });
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [running, job?.id]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setStatus(errorText(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function mapSource(index: string, selectedTable?: CourseTable) {
    setChoice(index);
    const source = sources[Number(index)];
    if (!source || index === '') {
      setTable(null);
      setInput({ courses: [], issues: [] });
      return;
    }
    applyMapping(
      source,
      selectedTable
        ? { ...selectedTable, endRow: source.table.endRow }
        : source.table,
    );
  }
  function applyMapping(source: CourseSheetTable, next: CourseTable) {
    setTable(next);
    const parsed = parseNaverCourses(source.rows, next);
    setInput({
      ...parsed,
      courses: parsed.courses.map((c) => ({ ...c, sourceSheet: source.sheet })),
    });
  }
  function roleChange(column: number, role: CourseColumnRole) {
    if (!table || choice === '') return;
    const roles = [...table.roles];
    roles[column] = role;
    applyMapping(sources[Number(choice)], { ...table, roles });
  }
  async function upload(file: File) {
    setInput({ courses: [], issues: [] });
    setFilename(file.name);
    setJob(null);
    setSources([]);
    setChoice('');
    setTable(null);
    if (file.size > 10 * 1024 * 1024)
      throw Error('10MB 이하의 엑셀을 등록해 주세요.');
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array' }),
      found: CourseSheetTable[] = [],
      manual: CourseSheetTable[] = [];
    for (const sheet of book.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], {
        header: 1,
        defval: '',
        raw: false,
        blankrows: true,
        range: {
          s: { r: 0, c: 0 },
          e: XLSX.utils.decode_range(book.Sheets[sheet]['!ref'] || 'A1').e,
        },
      });
      if (!rows.some((row) => row.some((v) => String(v ?? '').trim())))
        continue;
      const tables = findCourseTables(rows);
      if (tables.length)
        for (const table of tables) found.push({ sheet, rows, table });
      else
        manual.push({
          sheet,
          rows,
          table: courseTableAt(
            rows,
            Math.max(
              0,
              rows.findIndex((row) => row.some((v) => String(v ?? '').trim())),
            ),
          ),
        });
    }
    if (!found.length && !manual.length)
      throw Error('데이터가 있는 시트가 없습니다.');
    const choices = [...found, ...manual];
    setSources(choices);
    if (found.length === 1) {
      setChoice('0');
      applyMapping(found[0], found[0].table);
    } else if (!found.length && manual.length === 1) {
      setChoice('0');
      applyMapping(manual[0], manual[0].table);
    } else setStatus('여러 시트·표를 찾았습니다. 가져올 표만 선택해 주세요.');
  }
  function template() {
    const book = XLSX.utils.book_new(),
      sheet = XLSX.utils.aoa_to_sheet([
        COURSE_HEADERS,
        [
          '예시 코스',
          '경기도 평택시 산단로 263',
          '경기도 오산시 성호대로 141',
          '경기도 화성시 향남읍 향남로 470',
          '',
          '',
          '',
          '',
        ],
      ]);
    for (const [name, point] of [
      ['예시 1호차 1회', '경기도 화성시 향남읍 향남로 470'],
      ['예시 1호차 2회', '경기도 평택시 경기대로 245'],
    ])
      XLSX.utils.sheet_add_aoa(
        sheet,
        [
          [
            name,
            '경기도 평택시 산단로 263',
            '경기도 오산시 성호대로 141',
            point,
            '',
            '',
            '',
            '',
          ],
        ],
        { origin: -1 },
      );
    XLSX.utils.book_append_sheet(book, sheet, '코스');
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['입력 방법'],
        [
          '시트·제목 행·열은 자동 탐색합니다. 이 양식은 선택 사항입니다. 예시 행은 지우고 입력하세요.',
        ],
        ['일반 운행: 한 행 = 차고지→센터→납품처들→차고지'],
        [
          '2회전: 같은 호차명의 끝을 1회, 2회로 입력합니다. 두 행의 차고지·센터 주소는 동일하게 입력하며 지도 조회와 출력은 각 회전별로 따로 합니다.',
        ],
        ['1회전: 차고지→센터→1회 납품처들→센터'],
        ['2회전: 센터→2회 납품처들→차고지'],
        [
          '각 회전의 실제 경유지는 최대 5곳입니다. 두 회전 합계로 제한하지 않으며 초과한 회전만 제외합니다.',
        ],
        ['같은 호차는 행 순서와 관계없이 1회전, 2회전 순서로 각각 출력합니다.'],
      ]),
      '입력안내',
    );
    sheet['!cols'] = COURSE_HEADERS.map(() => ({ wch: 36 }));

    saveFile(
      new Blob([XLSX.write(book, { type: 'array', bookType: 'xlsx' })]),
      '네이버_코스_입력양식.xlsx',
    );
  }
  async function start(retry = false) {
    const id = await enqueueCapture(
        center,
        retry
          ? job!.courses
          : input.courses.map((c, i) =>
              i === 0 && input.issues.length
                ? { ...c, importIssues: input.issues }
                : c,
            ),
        retry ? job!.id : undefined,
      ),
      next = await getCapture(id, center);
    if (!next)
      throw Error(
        '생성한 작업을 확인하지 못했습니다. 최근 작업을 불러와 주세요.',
      );
    setJob(next);
  }
  const done = job
      ? job.courses.filter((c) => job.results[c.id]?.imagePath).length
      : 0,
    failed = job
      ? job.courses.filter((c) => !job.results[c.id]?.imagePath)
      : [];
  const labels: Record<string, string> = {
    queued: '서버 대기 중',
    running: '네이버 지도 조회·캡처 중',
    completed: '작업 완료',
    cancelled: '작업 중지',
    attention: '지도 조회 확인 필요',
  };
  return (
    <section
      className="naver-capture panel space-y-4"
      aria-label="코스별 지도 캡처"
    >
      <div>
        <h2>코스별 지도 캡처</h2>
        <p>
          일반 운행과 1회·2회전을 각각 조회하고 실제 네이버 지도 화면을
          저장합니다.
        </p>
      </div>
      <div className="toolbar">
        <button
          className="btn btn-ghost"
          disabled={busy || running}
          onClick={template}
        >
          예시 엑셀 다운로드
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy || running}
          onClick={() =>
            void run(async () => {
              const j = await getCapture(undefined, center);
              if (j) {
                setJob(j);
                setInput({
                  courses: j.courses,
                  issues: j.courses.flatMap((c) => c.importIssues ?? []),
                });
                setFilename('최근 캡처 작업');
              } else setStatus('저장된 캡처 작업이 없습니다.');
            })
          }
        >
          최근 캡처 불러오기
        </button>
      </div>
      <FileArea
        accept=".xlsx,.xls,.csv"
        disabled={busy || running}
        onFiles={(files) => {
          if (files[0]) void run(() => upload(files[0]));
        }}
      >
        <label>
          코스 엑셀
          <input
            className="app-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={busy || running}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void run(() => upload(f));
              e.currentTarget.value = '';
            }}
          />
        </label>
      </FileArea>
      <p className="capture-help">
        시트·제목 행·열을 자동 탐색합니다. 최대 100건 조회(각 회전 1건) · 같은
        호차의 1회·2회는 호차별로 묶고 회전별로 조회·출력 · 센터 포함 경유지
        최대 5곳. 정확한 주소를 입력해 주세요. 일반 운행은 같은 차고지로
        복귀합니다. 1회전은 차고지→센터→납품처→센터, 2회전은
        센터→납품처→차고지로 각각 처리합니다. 2회전은 두 행에 동일한 차고지·센터
        주소를 입력합니다. 납품처는 빈 칸을 건너뛰고 왼쪽부터 포함합니다. 중간
        1회전의 센터 복귀와 2회전의 센터 출발을 각각 포함합니다.
      </p>
      {!job && sources.length > 0 && (
        <NaverCourseMapping
          sources={sources}
          choice={choice}
          table={table}
          disabled={busy || running}
          onSource={mapSource}
          onHeader={(row) => {
            if (choice !== '')
              mapSource(
                choice,
                courseTableAt(sources[Number(choice)].rows, row),
              );
          }}
          onRole={roleChange}
        />
      )}
      {input.issues.length > 0 && (
        <div role="alert">
          <strong>열 연결 또는 아래 원본 값을 확인해 주세요.</strong>
          <ul>
            {input.issues.map((e, i) => (
              <li key={i}>
                {e.sourceRow}행: {e.message}
              </li>
            ))}
          </ul>
          {input.courses.length > 0 &&
            input.issues.every((issue) => issue.courseId) && (
              <p>
                오류가 있는 회전은 제외하고 정상 항목부터 캡처할 수 있습니다.
              </p>
            )}
        </div>
      )}
      {input.courses.length > 0 && !job && (
        <div
          className="scroll"
          role="region"
          aria-label="업로드 코스 미리보기"
          tabIndex={0}
        >
          <table className="app-table">
            <thead>
              <tr>
                <th>원본 행</th>
                <th>코스명</th>
                <th>방문 순서</th>
              </tr>
            </thead>
            <tbody>
              {input.courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.sourceSheet ? c.sourceSheet + ' · ' : ''}
                    {(c.sourceRows ?? [c.sourceRow]).join(', ')}
                  </td>
                  <td>{courseTitle(c)}</td>
                  <td>{c.stops.join(' → ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="toolbar">
        <button
          className="btn btn-primary"
          disabled={
            busy ||
            running ||
            !input.courses.length ||
            input.issues.some((issue) => !issue.courseId) ||
            input.courses.some((c) => c.rotations === 2 && !c.rotation)
          }
          onClick={() => void run(() => start())}
        >
          {input.issues.some((issue) => issue.courseId) && input.courses.length
            ? `정상 ${input.courses.length}건 캡처 시작`
            : '코스별 캡처 시작'}
        </button>
        {running && (
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { error } = await cancelBrowserJob(job!.id);
                if (error) throw Error(error.message);
                const j = await getCapture(job!.id, center);
                if (j) setJob(j);
              })
            }
          >
            작업 중지
          </button>
        )}
        {job && !running && failed.length > 0 && (
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void run(() => start(true))}
          >
            미완료 {failed.length}건 재시도
          </button>
        )}
      </div>
      <div role="status" aria-live="polite" className="capture-status">
        {status ||
          (busy
            ? '처리 중입니다.'
            : job
              ? `${labels[job.status] || job.status} · ${done}/${job.courses.length}건 캡처 완료`
              : filename
                ? `${filename} · ${input.courses.length}건 조회`
                : '기존 엑셀을 등록하면 시트와 필요한 열을 찾아 연결합니다.')}
      </div>
      {legacyCombined && (
        <p role="alert">
          이전 통합 방식으로 만든 캡처입니다. 회전별 조회·출력은 원본 엑셀을
          다시 등록해 주세요.
        </p>
      )}
      {job && (
        <>
          <progress
            aria-label="코스 캡처 진행"
            value={Object.keys(job.results).length}
            max={job.courses.length}
          />
          <div className="toolbar">
            <button
              className="btn btn-ghost"
              disabled={busy || !done || legacyCombined}
              onClick={() => void run(() => captureExports(job, 'zip'))}
            >
              완료 {done}건 PNG 일괄 저장
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !done || legacyCombined}
              onClick={() => void run(() => captureExports(job, 'pdf'))}
            >
              완료 {done}건 PDF 출력
            </button>
          </div>
          <p>
            PDF는 완료된 조회·회전당 한 페이지입니다. PNG를 누르면 해당 이미지를
            저장합니다.
          </p>
          <div className="capture-results">
            {job.courses.map((c) => {
              const r = job.results[c.id];
              return (
                <article key={c.id} className="capture-card">
                  <h3>{courseTitle(c)}</h3>
                  <p>
                    {r?.imagePath
                      ? `${r.distanceText} · ${new Date(r.measuredAt!).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
                      : r?.issue || (running ? '캡처 대기 중' : '미완료')}
                  </p>
                  <details>
                    <summary>방문 순서 확인</summary>
                    <ol>
                      {c.stops.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  </details>
                  {r?.imagePath && (
                    <Preview
                      path={r.imagePath}
                      name={c.sourceRow + '_' + courseTitle(c)}
                    />
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
