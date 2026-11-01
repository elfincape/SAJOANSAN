import { useEffect, useRef, useState } from 'react';
import { apiManagement } from '../lib/api-management';

type Row = Record<string, unknown>;
export function IsolatedStorageCheck({
  results,
  disabled,
  onBusyChange,
}: {
  results: Row[];
  disabled: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [report, setReport] = useState<Row[]>([]),
    [status, setStatus] = useState('');
  const workerRef = useRef<Worker | null>(null);
  const active = useRef(false),
    stop = useRef(false),
    alive = useRef(true),
    abort = useRef<null | (() => void)>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current = true;
      abort.current?.();
      workerRef.current?.terminate();
    };
  }, []);
  function replay(row: Row, existing?: Worker, keep = false): Promise<Row> {
    return new Promise((resolve, reject) => {
      const worker =
        existing ??
        new Worker(
          new URL('../lib/isolated-storage.worker.ts', import.meta.url),
          { type: 'module' },
        );
      const cleanup = () => {
        clearTimeout(timer);
        if (!keep) worker.terminate();
        abort.current = null;
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(Error('ISOLATED_TIMEOUT'));
      }, 120000);
      abort.current = () => {
        worker.terminate();
        cleanup();
        reject(Error('ISOLATED_CANCELLED'));
      };
      worker.onmessage = (event) => {
        cleanup();
        resolve(event.data);
      };
      worker.onerror = () => {
        cleanup();
        reject(Error('ISOLATED_WORKER_FAILED'));
      };
      worker.postMessage(
        existing
          ? row
          : { caseId: row.caseId, status: row.status, saved: row.saved },
      );
    });
  }
  async function run(input: unknown) {
    if (active.current || disabled) return;
    if (
      !Array.isArray(input) ||
      !input.length ||
      input.length > 40 ||
      input.some(
        (row) => !row || typeof row.caseId !== 'string' || !row.saved,
      ) ||
      new Set(input.map((row) => row.caseId)).size !== input.length
    ) {
      setStatus(
        '고정 사례의 saved 결과가 포함된 JSON 배열만 사용할 수 있습니다.',
      );
      return;
    }
    active.current = true;
    stop.current = false;
    setBusy(true);
    onBusyChange?.(true);
    setReport([]);
    try {
      for (const [index, row] of input.entries()) {
        if (stop.current || !alive.current) break;
        setStatus(`${index + 1}/${input.length} · ${row.caseId} SQL 재생 중`);
        let value: Row;
        try {
          value = await replay(row);
        } catch {
          value = {
            caseId: row.caseId,
            status: 'failed',
            error: 'ISOLATED_EXECUTION_FAILED',
            productionWritten: false,
          };
        }
        if (alive.current) setReport((old) => [...old, value]);
      }
      if (alive.current)
        setStatus(
          stop.current
            ? '현재 건까지 마치고 중지했습니다.'
            : 'SQL 재생이 끝났습니다. 통과·실패와 세부 검사는 결과에 보존됩니다.',
        );
    } finally {
      active.current = false;
      if (alive.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }
  async function virtualReception() {
    if (active.current || disabled) return;
    active.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setReport([]);
    setStatus('합성 MIME을 격리 수신 큐에 등록합니다.');
    const worker = new Worker(
      new URL('../lib/isolated-storage.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    let modelResult: Row | null = null;
    try {
      const prepared = await replay({ operation: 'prepare' }, worker, true);
      if (prepared.status !== 'queued') throw Error('RECEIPT_NOT_READY');
      if (!alive.current) return;
      setStatus('수신 큐·claim 완료. 고정 합성 메일을 실제 모델로 분석합니다.');
      const receipt = prepared.receipt as Row;
      modelResult = await apiManagement.stressCase(
        'mail-old-sent-collected-today',
        String(receipt.id),
      );
      if (!alive.current) return;
      setStatus(
        '모델 응답을 격리 SQL에 저장·재조회하고 노트 HTML을 생성합니다.',
      );
      const result = await replay(
        { operation: 'finish', result: modelResult },
        worker,
      );
      if (alive.current) {
        setReport([
          {
            ...result,
            receipt,
            flowPassed:
              result.status === 'passed' &&
              modelResult.automatedChecksPassed === true,
            modelTrace: modelResult.trace,
            modelStatus: modelResult.status,
            modelChecks: modelResult.checks,
            noteProof: modelResult.noteProof,
            networkCalled:
              Array.isArray(modelResult.trace) && modelResult.trace.length > 0,
            providerRequestAttempted:
              Array.isArray(modelResult.trace) && modelResult.trace.length > 0,
            modelCalled:
              Array.isArray(modelResult.trace) &&
              modelResult.trace.some(
                (row: Row) =>
                  row.provider === 'openai' &&
                  row.httpStatus === 200 &&
                  row.status === 'completed',
              ),
            sqlNetworkCalled: false,
            sqlDataTransmitted: false,
            dataTransmitted:
              Array.isArray(modelResult.trace) && modelResult.trace.length > 0,
          },
        ]);
        setStatus(
          result.status === 'passed' &&
            modelResult.automatedChecksPassed === true
            ? '가상 수신 → 실제 모델 → 격리 SQL → 노트 HTML 검증을 마쳤습니다. 실제 원노트 페이지는 작성하지 않았습니다.'
            : '가상 수신 검증에서 실패가 확인됐습니다. 결과를 다운로드해 확인하세요.',
        );
      }
    } catch {
      if (alive.current) {
        setReport([
          {
            caseId: 'mail-old-sent-collected-today',
            status: 'failed',
            error: 'VIRTUAL_RECEPTION_INCOMPLETE',
            modelTrace: modelResult?.trace ?? null,
            productionWritten: false,
          },
        ]);
        setStatus(
          '가상 수신 흐름을 끝내지 못했습니다. 자동으로 유료 요청을 반복하지 않았습니다.',
        );
      }
    } finally {
      worker.terminate();
      workerRef.current = null;
      active.current = false;
      if (alive.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }
  async function read(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setStatus('10MB 이하 JSON 파일만 사용할 수 있습니다.');
      return;
    }
    try {
      await run(JSON.parse(await file.text()));
    } catch {
      setStatus('JSON 파일을 읽지 못했습니다.');
    }
  }
  async function writeNote() {
    const row = report[0];
    if (active.current || disabled || row?.flowPassed !== true || typeof row.noteProof !== 'string' || !row.roundTrip) return;
    active.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setStatus('기존 분석·격리 SQL 결과로 별도 가상 검증 페이지를 저장하고 다시 읽습니다. 모델을 다시 호출하지 않습니다.');
    try {
      const note = await apiManagement.stressNote(row.noteProof, row.roundTrip);
      if (alive.current) {
        setReport([{ ...row, noteCheck: note }]);
        setStatus(note.status === 'passed'
          ? '별도 가상 검증 페이지의 실제 저장·재조회와 중복 없는 반복 처리를 확인했습니다.'
          : '가상 검증 페이지 확인을 끝내지 못했습니다. 기존 결과를 유지합니다. 코드: ' + String(note.code ?? 'STRESS_NOTE_FAILED'));
      }
    } catch {
      if (alive.current) setStatus('원노트 응답을 확인하지 못했습니다. 같은 버튼으로 기존 페이지부터 재조회할 수 있습니다. 분석은 다시 호출하지 않습니다.');
    } finally {
      active.current = false;
      if (alive.current) { setBusy(false); onBusyChange?.(false); }
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'isolated-sql-results.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div>
      <p className="feature-help">
        SQL 재생은 브라우저 메모리에서만 실행합니다. 원래 다운로드한 합성 결과
        파일 또는 현재 실행 결과를 사용하며, 운영 DB·외부 API·원노트로 전송하지
        않습니다. 처음 실행할 때 격리 DB 엔진을 내려받습니다.
      </p>
      <div className="feature-toolbar">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || disabled}
          onClick={() => void virtualReception()}
        >
          가상 수신 종단 검증
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || disabled || !results.length}
          onClick={() => void run(results)}
        >
          현재 결과 SQL 재생
        </button>
        <label>
          기존 합성 결과 JSON
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy || disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void read(file);
            }}
          />
        </label>
        {busy ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              stop.current = true;
              setStatus('현재 건을 마친 뒤 중지합니다.');
            }}
          >
            SQL 재생 중지
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || !report.length}
          onClick={download}
        >
          SQL 검증 결과 다운로드
        </button>
      </div>
      <p role="status" aria-live="polite">
        {status}
      </p>
      {report[0]?.flowPassed === true && typeof report[0].noteProof === 'string' ? (
        <button type="button" className="btn btn-ghost" disabled={busy || disabled} onClick={() => void writeNote()}>
          가상 검증 페이지에 저장
        </button>
      ) : null}
      {(report[0]?.noteCheck as Row | undefined)?.status === 'passed' ? (
        <p>{String((report[0].noteCheck as Row).title)} · 실제 재조회 확인 · 반복 처리 {String((report[0].noteCheck as Row).repeatStatus)}
          {typeof (report[0].noteCheck as Row).pageUrl === 'string' ? <> · <a href={String((report[0].noteCheck as Row).pageUrl)} target="_blank" rel="noopener noreferrer">검증 노트 열기</a></> : null}
        </p>
      ) : null}
      {report.some((row) => typeof row.noteHtml === 'string') ? (
        <iframe
          title="가상 검증 노트 미리보기"
          sandbox=""
          srcDoc={String(
            report.find((row) => typeof row.noteHtml === 'string')?.noteHtml,
          )}
          style={{ width: '100%', height: 360, border: 0, background: 'white' }}
        />
      ) : null}
      {report.length ? (
        <ul>
          {report.map((row) => (
            <li key={String(row.caseId)}>
              {String(row.caseId)} ·{' '}
              {row.status === 'passed' ? 'SQL 통과' : 'SQL 실패'}
              {row.flowPassed === false ? ' · 모델 기대값·단계 검토 필요' : ''}
              {row.error ? ' · ' + String(row.error) : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
