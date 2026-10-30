import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useAdminPage } from './AdminPage';
import { NaverCourseMapping } from './NaverCourseMapping';
import { NaverAddressValidation } from './NaverAddressValidation';
import { sameRoutingCourse, validatedCourseIds } from '../domain/naver-address-validation';
import type { AddressValidationJob } from '../lib/naver-address-validation';
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
  courseComparisonCount,
} from '../domain/naver-courses';
import type { CourseImport } from '../domain/naver-courses';
import {
  captureExports,
  captureVerificationLabel,
  captureImage,
  enqueueCapture,
  getCapture,
  saveFile,
} from '../lib/naver-courses';
import type { CaptureJob } from '../lib/naver-courses';
import { cancelBrowserJob } from '../lib/naver-browser';
import {cancelRelationJob} from '../lib/naver-relations';
import {latestShortlist,shortlistCall} from '../lib/naver-shortlist';
import type {ShortlistJob} from '../lib/naver-shortlist';
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
  const { setControlsDisabled, center: selectedCenter, profile, editable } = useAdminPage();
  const [input, setInput] = useState<CourseImport>({ courses: [], issues: [] }),
    [filename, setFilename] = useState(''),
    [job, setJob] = useState<CaptureJob | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  const [validation, setValidation] = useState<AddressValidationJob | null>(null),
    [validationRunning, setValidationRunning] = useState(false), [inputVersion,setInputVersion] = useState(0);
  const [strategy,setStrategy]=useState<'api3'|'full'>(editable?'api3':'full'),[shortlist,setShortlist]=useState<ShortlistJob|null>(null);
  const stopApi=useRef(false);
  const [sources, setSources] = useState<CourseSheetTable[]>([]),
    [choice, setChoice] = useState(''),
    [table, setTable] = useState<CourseTable | null>(null);
  const mounted = useRef(true),
    center = selectedCenter.code;
  const legacyCombined = !!job?.courses.some(
    (c) => c.rotations === 2 && !c.rotation,
  );
  const running = !!job && ['queued', 'running'].includes(job.status);
  const locked = busy || running || validationRunning,
    confirmedIds = validation?.center_code === center && validation.status === 'completed'
      ? validatedCourseIds(input.courses, validation.results) : [],
    inputMatchesJob = !!job && input.courses.length === job.courses.length && input.courses.every(c => job.courses.some(old => sameRoutingCourse(c, old)));
  const apiInputMatches=!!validation&&validation.courses.length===input.courses.length&&input.courses.every(c=>validation.courses.some(old=>sameRoutingCourse(c,old)));
  useEffect(()=>{let active=true;setShortlist(null);if(validation?.id&&editable)void latestShortlist(center,profile.id,validation.id).then(next=>{if(active)setShortlist(current=>current?.validationJob===validation.id?current:next);}).catch(e=>{if(active)setStatus(errorText(e));});return()=>{active=false;};},[center,profile.id,validation?.id,editable]);
  useEffect(() => { setJob(null);setValidation(null);setInput({courses:[],issues:[]});setSources([]);setFilename(''); }, [center]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onBusy(locked);
    setControlsDisabled(locked);
    return () => setControlsDisabled(false);
  }, [locked, setControlsDisabled, onBusy]);
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
    setInputVersion(value=>value+1);
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
    if (!job) setJob(await getCapture(undefined, center));
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
  async function start() {
    if (!validation || validation.center_code !== center || validation.status !== 'completed') throw Error('주소 사전 검증을 먼저 완료해 주세요.');
    if (!confirmedIds.length) throw Error('주소가 모두 확인된 코스가 없습니다. 주소 검증 표를 확인해 주세요.');
    let shortlistId: string | undefined;
    if(strategy==='api3'){
      if(!apiInputMatches)throw Error('입력 코스가 변경되었습니다. 전체 주소 검증을 눌러 현재 코스와 연결해 주세요. 확인된 주소는 재사용합니다.');
      if(!editable)throw Error('API 후보 조회에는 해당 센터 납품처 편집 권한이 필요합니다. 전순열 웹 모드를 이용해 주세요.');
      stopApi.current=false;
      let next=shortlist?.validationJob===validation.id ? await shortlistCall(center,'shortlist-status',{jobId:shortlist.id}) : await shortlistCall(center,'shortlist-create',{validationJobId:validation.id});
      setShortlist(next);
      while(['queued','running'].includes(next.status)){
        if(stopApi.current||!mounted.current)throw Error('API 후보 선정을 중지했습니다. 저장된 진행은 보존됩니다.');
        next=await shortlistCall(center,'shortlist-batch',{jobId:next.id});setShortlist(next);
        if(next.busy)await new Promise(resolve=>setTimeout(resolve,1000));
      }
      if(stopApi.current||next.status==='paused')throw Error('API 후보 선정을 중지했습니다.');
      if(!next.completedCourses)throw Error('완성된 API 후보가 없습니다. 표시된 오류를 확인하거나 전순열 웹 모드를 선택해 주세요.');
      shortlistId=next.id;
    }
    const id = await enqueueCapture(
        center,
        input.courses.map((c, i) =>
              i === 0 && input.issues.length
                ? { ...c, importIssues: input.issues }
                : c,
            ),
        job?.center_code === center ? job.id : undefined,
        validation.id,
        shortlistId,
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
          차고지·센터·복귀지를 고정하고, 회전별로 선택한 비교 방식의 네이버
          도로 경로를 저장합니다.
        </p>
      </div>
      <div className="toolbar">
        <label>비교 방식 <select className="app-input" aria-label="경로 비교 방식" value={strategy} disabled={locked} onChange={e=>setStrategy(e.target.value as 'api3'|'full')}>
          <option value="api3" disabled={!editable}>API 후보 3개 → 웹 전체거리 비교</option>
          <option value="full">모든 납품 순서 웹 비교</option>
        </select></label>
      </div>
      <p>{strategy==='api3'?'API는 센터→마지막 납품처 부분거리로 후보 3개를 고릅니다. 웹은 차고지 출발·복귀를 포함한 전체 동선으로 비교하며, 후보 밖 순열의 전역 최단을 보장하지 않습니다.':'차고지·센터·복귀지는 고정하고 가능한 납품 순서를 웹에서 전부 비교합니다.'}</p>
      {strategy==='api3'&&!!input.courses.length&&!apiInputMatches&&<p>현재 입력 코스의 전체 주소 검증을 먼저 완료해 주세요. 이미 확인된 주소는 재사용합니다.</p>}
      {shortlist&&strategy==='api3'&&<div role="status" aria-live="polite">
        API 후보 선정 {shortlist.processed}/{shortlist.totalEdges}구간 · 재사용 {shortlist.cached} · 요청 {shortlist.directionsAttempts}/{shortlist.directionsBudget} · 확인 {shortlist.completedCourses}/{shortlist.totalCourses}코스
        {shortlist.error&&<p>{shortlist.error}</p>}
        {!!shortlist.issues?.length&&<p>미완료 항목 {shortlist.issues.length}건. 주소·경유지 한도 또는 API 응답을 확인해 주세요. 확인된 코스는 보존됩니다.</p>}
        {['queued','running'].includes(shortlist.status)&&<button className="btn btn-ghost" onClick={()=>{stopApi.current=true;void cancelRelationJob(shortlist.id).then(({error})=>{if(error)setStatus(error.message);});}}>API 후보 선정 중지</button>}
        {!locked&&(['attention','paused'].includes(shortlist.status)||(shortlist.status==='completed'&&!shortlist.completedCourses))&&<button className="btn btn-ghost" onClick={()=>setShortlist(null)}>API 후보 새로 선정 준비</button>}
      </div>}
      <div className="toolbar">
        <button
          className="btn btn-ghost"
          disabled={locked}
          onClick={template}
        >
          예시 엑셀 다운로드
        </button>
        <button
          className="btn btn-ghost"
          disabled={locked}
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
                setInputVersion(value=>value+1);
                setSources([]);setChoice('');setTable(null);
              } else setStatus('저장된 캡처 작업이 없습니다.');
            })
          }
        >
          최근 캡처 불러오기
        </button>
      </div>
      <FileArea
        accept=".xlsx,.xls,.csv"
        disabled={locked}
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
            disabled={locked}
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
        주소를 입력합니다. 납품처는 빈 칸을 건너뛰어 포함하고, 납품처끼리의
        순서만 바꾸며 선택한 비교 방식을 적용합니다. 중간 1회전의 센터 복귀와 2회전의 센터
        출발을 각각 포함합니다. 웹 검증 대상은 네이버가 제공하는 자동차 경로 옵션
        전체의 실제 주행거리로 비교하며 직선거리·최단시간을 사용하지 않습니다.
        동률이면 원본 납품처 순서 기준으로 결정합니다. 일부 조합이 실패하면 최단
        검증은 미완료로 남습니다.
      </p>
      {sources.length > 0 && (
        <NaverCourseMapping
          sources={sources}
          choice={choice}
          table={table}
          disabled={locked}
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
      <NaverAddressValidation center={center} courses={input.courses} disabled={busy || running} resetKey={inputVersion}
        onCoursesChange={courses => setInput(previous => ({...previous,courses}))}
        onJobChange={setValidation} onRunningChange={setValidationRunning} />
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
      {input.courses.length > 0 && !inputMatchesJob && (
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
                <th>입력 순서 · 차고지와 센터 고정</th>
                <th>비교할 납품 순서</th>
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
                  <td>{courseComparisonCount(c)}개</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!job && input.courses.length > 0 && (
        <p>
          총{' '}
          {input.courses.reduce((sum, c) => sum + courseComparisonCount(c), 0)}
          개 순서를 차례로 조회하고 각 회전의 최단 경로를 저장합니다. 회전당
          최대 120개이며, 같은 경로의 성공 조회는 작업 안에서 재사용합니다. 비교
          중 중지하거나 재시도해도 저장된 비교 결과와 완료된 다른 회전은
          유지됩니다.
        </p>
      )}
      <div className="toolbar">
        <button
          className="btn btn-primary"
          disabled={
            busy ||
            running ||
            validationRunning ||
            !confirmedIds.length ||
            (strategy==='api3'&&!apiInputMatches) ||
            !input.courses.length ||
            input.issues.some((issue) => !issue.courseId) ||
            input.courses.some((c) => c.rotations === 2 && !c.rotation)
          }
          onClick={() => void run(() => start())}
        >
          주소 확인된 {confirmedIds.length}건 캡처 시작
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
            disabled={busy || validationRunning || !confirmedIds.length}
            onClick={() => void run(() => start())}
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
      {job?.status === 'attention' && Object.values(job.results).some(r => r.providerUnavailable) && (
        <p role="alert">네이버 검색·길찾기 응답 문제로 작업을 멈췄습니다. 주소 부재로 판정하지 않았으며, 완료된 캡처와 비교 이력은 보존했습니다.</p>
      )}
      {job && (
        <>
          {!inputMatchesJob && <p>이전 저장 결과입니다. 주소가 달라진 코스는 새 검증·캡처 후 갱신하며 기존 성공 결과는 보존합니다.</p>}
          <progress
            aria-label="코스 캡처 진행"
            value={
              job.courses.filter(
                (c) => job.results[c.id]?.imagePath || job.results[c.id]?.issue,
              ).length
            }
            max={job.courses.length}
          />
          <div className="toolbar">
            <button
              className="btn btn-ghost"
              disabled={busy || legacyCombined}
              onClick={() => void run(() => captureExports(job, 'xlsx'))}
            >
              구간거리 Excel 일괄 저장
            </button>
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
            저장합니다. Excel은 회전별 시트에 선택된 방문 순서와 직전 구간거리를
            세로로 정리합니다. 미확인 구간은 빈칸과 사유로 표시합니다.
          </p>
          <div className="capture-results">
            {job.courses.map((c) => {
              const r = job.results[c.id];
              return (
                <article key={c.id} className="capture-card">
                  <h3>{courseTitle(c)}</h3>
                  <p>
                    {r?.imagePath
                      ? `${r.routeLabel || '거리우선'} ${r.distanceText} · ${new Date(r.measuredAt!).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
                      : r?.issue || (running ? '캡처 대기 중' : '미완료')}
                  </p>
                  {r?.optimization && !r.imagePath && (
                    <progress
                      aria-label={courseTitle(c) + ' 납품 순서 비교'}
                      value={r.optimization.completed}
                      max={r.optimization.total}
                    />
                  )}
                  {captureVerificationLabel(r) && (
                    <p>{captureVerificationLabel(r)}</p>
                  )}
                  {r?.imagePath && !r.legEvidence?.verified && (
                    <p>
                      동일 경로의 구간거리 미확인 · 이전 캡처는 새 조회가 필요할
                      수 있습니다.
                    </p>
                  )}
                  <details>
                    <summary>
                      {r?.orderedStops
                        ? '선택된 방문 순서 확인'
                        : '입력 방문 순서 확인'}
                    </summary>
                    <ol>
                      {(r?.orderedStops ?? c.stops).map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  </details>
                  <button
                    className="btn btn-ghost"
                    disabled={busy || legacyCombined}
                    aria-label={courseTitle(c) + ' 구간거리 Excel 저장'}
                    onClick={() =>
                      void run(() => captureExports(job, 'xlsx', [c.id]))
                    }
                  >
                    구간거리 Excel 저장
                  </button>
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
