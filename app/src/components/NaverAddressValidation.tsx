import { useEffect, useState } from 'react';
import type { NaverCourse } from '../domain/naver-courses';
import { addressKey, courseAddressRows, editCourseAddress, validatedCourseIds } from '../domain/naver-address-validation';
import type { AddressCheck } from '../domain/naver-address-validation';
import { enqueueAddressValidation, getAddressValidation } from '../lib/naver-address-validation';
import type { AddressValidationJob } from '../lib/naver-address-validation';
import { cancelBrowserJob } from '../lib/naver-browser';

const labels = { valid: '정상', ambiguous: '후보 확인 필요', not_found: '후보 없음', network_error: '통신·검색 장애', unverified: '미검증' };
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
export function NaverAddressValidation({ center, courses, disabled, resetKey, onCoursesChange, onJobChange, onRunningChange }: {
  center: string; courses: NaverCourse[]; disabled: boolean; resetKey: number;
  onCoursesChange: (courses: NaverCourse[]) => void;
  onJobChange: (job: AddressValidationJob | null) => void;
  onRunningChange: (running: boolean) => void;
}) {
  const [job, setJob] = useState<AddressValidationJob | null>(null),
    [busy, setBusy] = useState(false), [message, setMessage] = useState(''),
    [drafts, setDrafts] = useState<Record<string, string>>({}), [problemsOnly, setProblemsOnly] = useState(false);
  const running = !!job && ['queued', 'running'].includes(job.status),
    locked = disabled || busy || running, rows = courseAddressRows(courses);
  const resultFor = (address: string): AddressCheck | undefined => {
    const key = addressKey(address), result = job?.center_code === center ? job.results[key] : undefined;
    return result?.query === key ? result : undefined;
  };
  const problems = rows.filter(row => resultFor(row.address)?.status !== 'valid'),
    eligible = validatedCourseIds(courses, job?.center_code === center ? job.results : {}),
    counts = Object.fromEntries(Object.keys(labels).map(status => [status, rows.filter(row => (resultFor(row.address)?.status ?? 'unverified') === status).length]));
  useEffect(() => {
    let active = true;setJob(null);setDrafts({});setMessage('');
    void getAddressValidation(center).then(next => { if (active) setJob(next); }).catch(error => { if (active) setMessage(text(error)); });
    return () => { active = false; };
  }, [center]);
  useEffect(() => { setDrafts({}); }, [resetKey]);
  useEffect(() => { onJobChange(job);onRunningChange(running || busy); }, [job, running, busy, onJobChange, onRunningChange]);
  useEffect(() => {
    if (!running || !job) return;let active = true;
    const timer = setInterval(() => { void getAddressValidation(center, job.id).then(next => { if (active && next) setJob(next); }).catch(error => { if (active) setMessage(text(error)); }); }, 3000);
    return () => { active = false;clearInterval(timer); };
  }, [running, job?.id, center]);
  async function run(action: () => Promise<void>) {
    if (busy) return;setBusy(true);setMessage('');
    try { await action(); } catch (error) { setMessage(text(error)); } finally { setBusy(false); }
  }
  async function submit(next: NaverCourse[], requested?: string[]) {
    const id = await enqueueAddressValidation(center, next, job?.id, requested), saved = await getAddressValidation(center, id);
    if (!saved) throw Error('생성한 주소 검증 작업을 확인하지 못했습니다.');
    setJob(saved);
  }
  return <section className="capture-validation" aria-label="주소 사전 검증">
    <h3>주소 사전 검증</h3>
    <p>중복 주소는 한 번만 검색합니다. 원문은 보존하며, 수정한 주소는 같은 원문을 쓰는 위치에 함께 적용합니다.</p>
    <div className="toolbar">
      <button className="btn btn-primary" disabled={locked || !rows.length} onClick={() => void run(() => submit(courses))}>전체 주소 검증</button>
      <button className="btn btn-ghost" disabled={locked || !problems.length} onClick={() => void run(() => submit(courses, [...new Set(problems.map(row => addressKey(row.address)))]))}>실패·미확인 주소 재검증</button>
      <button className="btn btn-ghost" disabled={locked} onClick={() => void run(async () => { const next = await getAddressValidation(center);if (!next) { setMessage('저장된 주소 검증 작업이 없습니다.');return; }setJob(next);if (!courses.length) onCoursesChange(next.courses); })}>최근 주소 검증 불러오기</button>
      {running && <button className="btn btn-ghost" disabled={busy} onClick={() => void run(async () => { const {error} = await cancelBrowserJob(job!.id);if (error) throw Error(error.message);setJob(await getAddressValidation(center, job!.id)); })}>주소 검증 중지</button>}
    </div>
    <p role="status" aria-live="polite">
      고유 주소 {rows.length}개 · 정상 {counts.valid} · 후보 확인 {counts.ambiguous} · 후보 없음 {counts.not_found} · 통신·검색 장애 {counts.network_error} · 미검증 {counts.unverified}
      {running ? ` · 서버 ${job!.status === 'queued' ? '대기' : '검증'} 중 ${job!.cursor}/${job!.addresses.length}` : ''}
      {job?.status === 'attention' ? ' · 검색 응답 문제로 중단했습니다. 확인된 주소와 기존 캡처는 보존됩니다.' : ''}
    </p>
    {!!courses.length && <p>주소 확인된 코스 {eligible.length}/{courses.length}건. 미확인 주소가 있는 코스의 새 경로 계산은 실행하지 않습니다.</p>}
    {message && <p role="alert">{message}</p>}
    {!rows.length ? <p>엑셀을 올리면 행·호차·역할별 주소가 표시됩니다.</p> : <>
      <label className="capture-validation-filter"><input type="checkbox" checked={problemsOnly} onChange={event => setProblemsOnly(event.target.checked)} /> 실패·미확인 주소만 보기</label>
      <div className="scroll"><table className="app-table capture-address-table"><thead><tr><th>사용 위치</th><th>주소 원문</th><th>검증할 주소</th><th>확인 상태·결과</th><th>작업</th></tr></thead><tbody>
        {(problemsOnly ? problems : rows).map(row => {
          const result = resultFor(row.address), value = drafts[row.original] ?? row.address,
            changed = addressKey(value) !== addressKey(row.address), status = result?.status ?? 'unverified',
            location = (use: typeof row.uses[number]) => `${use.sourceSheet ? use.sourceSheet + ' ' : ''}${use.sourceRow}행 · ${use.name} · ${use.role}`;
          return <tr key={row.original} data-address-status={status}><td>{row.uses.length === 1 ? location(row.uses[0]) : <details><summary>{location(row.uses[0])} · 총 {row.uses.length}곳</summary><ul>{row.uses.map(use => <li key={use.courseId + ':' + use.index}>{location(use)}</li>)}</ul></details>}</td>
            <td>{row.original}</td><td><input className="app-input" aria-label={location(row.uses[0]) + ' 검증할 주소'} maxLength={300} disabled={locked} value={value} onChange={event => setDrafts(previous => ({ ...previous, [row.original]: event.target.value }))} />{row.original !== row.address && <small>수정 적용됨 · 원문 보존</small>}</td>
            <td><strong>{labels[status]}</strong>{result?.confirmedAddress && <p>{result.confirmedAddress}</p>}{result?.issue && <p>{result.issue}</p>}{result?.candidates?.length ? <details><summary>검색 후보 {result.candidates.length}개 확인</summary><ul>{result.candidates.map(candidate => <li key={candidate}>{candidate}</li>)}</ul></details> : null}</td>
            <td><button className="btn btn-ghost" disabled={locked || !addressKey(value) || (!changed && status === 'valid')} onClick={() => void run(async () => { const next = changed ? editCourseAddress(courses, row.original, value) : courses;if (changed) onCoursesChange(next);await submit(next, [addressKey(value)]); })}>{changed ? '수정 적용·재검증' : '이 주소 재검증'}</button></td>
          </tr>;
        })}
      </tbody></table></div>
    </>}
  </section>;
}
