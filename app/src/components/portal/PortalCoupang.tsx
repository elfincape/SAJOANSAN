import { MentionText } from './PortalMentions';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PortalTask, PortalInputs, PortalEvent } from '../../domain/portal-types';
import { portalStamp } from '../../domain/portal-types';
import { portalApi } from '../../lib/portal';
import {
  coupangEntryDate,
  validCoupangGenerated,
  coupangSessions,
  coupangResultVersions,
} from '../../domain/portal-coupang';
import type {
  CoupangGenerated,
  CoupangResult,
  CoupangSession,
} from '../../domain/portal-coupang';
import { operationsFiles } from '../../lib/portal-files';
import type { PortalFile } from '../../lib/portal-files';
import { PortalDialog } from './PortalDialog';
import { FileArea } from '../FileArea';
import { useDownload } from '../useDownload';
import { usePortal } from './PortalStore';
function ImageDialog({
  file,
  blob,
  onClose,
}: {
  file: PortalFile;
  blob?: Blob;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(blob ?? null),
    [url, setUrl] = useState(''),
    [status, setStatus] = useState('이미지 불러오는 중…');
  useEffect(() => {
    let active = true;
    if (!loaded)
      void operationsFiles
        .download(file.id)
        .then((blob) => {
          if (active) setLoaded(blob);
        })
        .catch((error) => {
          if (active)
            setStatus('이미지를 불러오지 못했습니다. ' + error.message);
        });
    return () => {
      active = false;
    };
  }, [file.id]);
  useEffect(() => {
    if (!loaded) return;
    const url = URL.createObjectURL(loaded);
    setUrl(url);
    setStatus('');
    return () => URL.revokeObjectURL(url);
  }, [loaded]);
  return (
    <PortalDialog
      id="coupang-image-dialog"
      label="쿠팡 입문확인 이미지"
      className="coupang-image-dialog"
      onClose={onClose}
    >
      <div className="actions">
        <strong>쿠팡 입문확인</strong>
        <button onClick={onClose}>닫기</button>
        {loaded ? (
          <button
            onClick={async () => {
              try {
                if (
                  !navigator.clipboard?.write ||
                  typeof ClipboardItem === 'undefined'
                )
                  throw Error();
                await navigator.clipboard.write([
                  new ClipboardItem({ 'image/png': loaded }),
                ]);
                setStatus(
                  '이미지를 복사했습니다. 전송할 곳에 Ctrl+V로 붙여넣으세요.',
                );
              } catch {
                setStatus("이미지를 우클릭하여 '이미지 복사'를 선택해 주세요.");
              }
            }}
          >
            이미지 복사
          </button>
        ) : null}
      </div>
      <p>
        <MentionText>{status}</MentionText>
      </p>
      {url ? <img alt="쿠팡 입문확인표" src={url} /> : null}
    </PortalDialog>
  );
}
function ResultCard({
  file,
  onError,
}: {
  file: PortalFile;
  onError: (text: string) => void;
}) {
  const [blob, setBlob] = useState<Blob | undefined>(),
    [url, setUrl] = useState(''),
    [preview, setPreview] = useState(false),
    [error, setError] = useState(''),
    { download, downloadLink } = useDownload(),
    image = file.mime_type?.startsWith('image/');
  useEffect(() => {
    if (!image) return;
    let active = true,
      url = '';
    void operationsFiles
      .download(file.id)
      .then((blob) => {
        if (active) {
          url = URL.createObjectURL(blob);
          setBlob(blob);
          setUrl(url);
        }
      })
      .catch(() => {
        if (active)
          setError(
            '이미지 미리보기를 불러오지 못했습니다. 다운로드를 다시 시도하세요.',
          );
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.id, image]);
  return (
    <div className="coupang-result">
      <strong>
        <MentionText>{file.original_name || file.file_name}</MentionText>
      </strong>
      {image ? (
        <button onClick={() => setPreview(true)}>이미지 확대·복사</button>
      ) : (
        <button
          onClick={async () => {
            try {
              download(
                await operationsFiles.download(file.id),
                file.file_name || file.original_name,
              );
            } catch (error) {
              onError(
                '다운로드 실패: ' +
                  (error instanceof Error ? error.message : String(error)),
              );
            }
          }}
        >
          엑셀 다운로드
        </button>
      )}
      {url ? (
        <img
          src={url}
          alt="생성한 쿠팡 입문확인표"
          role="button"
          tabIndex={0}
          title="클릭하여 확대·복사"
          onClick={() => setPreview(true)}
          onKeyDown={(e) => {
            if (['Enter', ' '].includes(e.key)) {
              e.preventDefault();
              setPreview(true);
            }
          }}
        />
      ) : null}
      {error ? (
        <p>
          <MentionText>{error}</MentionText>
        </p>
      ) : null}
      {preview ? (
        <ImageDialog
          file={file}
          blob={blob}
          onClose={() => setPreview(false)}
        />
      ) : null}
      {downloadLink}
    </div>
  );
}
export function PortalCoupang({
  task,
  dispatch,
  writable,
  collect,
  persist,
  onBusy,
  children,
}: {
  task: PortalTask;
  dispatch: string;
  writable: boolean;
  collect: () => PortalInputs;
  persist: (inputs: PortalInputs) => Promise<void>;
  onBusy: (busy: boolean) => void;
  children: ReactNode;
}) {
  const { refresh, message, state } = usePortal(),
    [historyOpen, setHistoryOpen] = useState(false),
    [events, setEvents] = useState<PortalEvent[]>([]),
    [historyError, setHistoryError] = useState(''),
    [selectedVersion, setSelectedVersion] = useState(''),
    [sourceRecord, setSourceRecord] = useState<PortalFile | undefined>(),
    { download, downloadLink } = useDownload(),
    [status, setStatus] = useState(''),
    [files, setFiles] = useState<PortalFile[]>([]),
    [resultError, setResultError] = useState(''),
    [source, setSource] = useState(''),
    [hasFrame, setHasFrame] = useState(false),
    [, redraw] = useState(0),
    frame = useRef<HTMLIFrameElement>(null),
    input = useRef<HTMLInputElement>(null),
    working = useRef(false),
    active = useRef(true),
    ready = useRef(false),
    run = useRef<{
      id: string;
      dispatch: string;
      date: string;
      sourceId: string;
      taskVersion: number;
      settings: CoupangResult['settings'];
    } | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    settings = task.template_snapshot!.spec!.integration!,
    session = useRef<CoupangSession>(
      coupangSessions.get(task.id) ?? {
        file: null,
        source: null,
        pending: null,
      },
    ).current,
    latest = useRef({ task, dispatch, collect, persist, writable }),
    currentResult = task.inputs?.coupang_result as CoupangResult | undefined | null,
    versions = coupangResultVersions(currentResult, events),
    result = selectedVersion ? versions.find(version => version.key === selectedVersion)?.result : currentResult;
  latest.current = { task, dispatch, collect, persist, writable };
  coupangSessions.set(task.id, session);
  function busy(value: boolean) {
    working.current = value;
    if (active.current) {
      onBusy(value);
      redraw((s) => s + 1);
    }
  }
  function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    run.current = null;
    busy(false);
  }
  async function initialize() {
    if (!ready.current || !frame.current || !run.current) return;
    const executing = run.current;
    let file = session.source?.fileId === executing.sourceId && session.source.saved ? session.file : null;
    if (!file) {
      const blob = await operationsFiles.download(
        executing.sourceId,
      );
      if (!active.current || run.current !== executing) return;
      file = new File([blob], '배차표.jpg', { type: blob.type });
    }
    if (!file) throw Error('배차표 사진을 먼저 넣어 주세요.');
    frame.current.contentWindow?.postMessage(
      {
        type: 'portal-coupang-run',
        taskId: task.id,
        jobId: run.current.id,
        date: run.current.date,
        dispatch: run.current.dispatch,
        file,
        settings: executing.settings,
      },
      location.origin,
    );
  }
  async function finish() {
    if (working.current || !session.pending) return;
    busy(true);
    const pending = session.pending;
    try {
      setStatus('생성한 엑셀·이미지 저장 중…');
      for (const entry of pending.files) {
        if (entry.saved) continue;
        const result = await operationsFiles.upload({
          kind: 'task',
          subjectId: task.id,
          requestId: entry.id,
          file: entry.file,
        });
        entry.fileId = result.id;
        if (!entry.fileId) throw Error('파일 저장 결과를 확인하지 못했습니다.');
        entry.saved = true;
      }
      if (!active.current) return;
      if (latest.current.task.inputs?.coupang_source_id !== pending.sourceFileId)
        throw Error('생성에 사용한 원본 사진과 현재 업무의 사진이 다릅니다. 생성 파일은 보존했으며 업무 연결은 저장하지 않았습니다.');
      const changed = latest.current.dispatch !== pending.inputDispatch;
      await latest.current.persist({
        ...latest.current.collect(),
        coupang_schedule: pending.schedule,
        coupang_result: {
          run_id: pending.runId,
          source_file_id: pending.sourceFileId,
          input_dispatch: pending.inputDispatch,
          task_version: pending.taskVersion,
          processor_version: 'portal-coupang-1',
          settings: pending.settings,
          files: pending.files.map((f) => f.fileId),
          dispatch: pending.dispatch,
          schedule: pending.schedule,
          capture_range: pending.captureRange,
          entry_date: pending.entryDate,
          generated_at: pending.generatedAt,
          image_error: pending.imageError ?? null,
        },
      });
      if (!active.current) return;
      session.pending = null;
      redraw((s) => s + 1);
      frame.current?.contentWindow?.postMessage(
        { type: 'portal-coupang-saved', taskId: task.id },
        location.origin,
      );
      let refreshFailed = false;
      try { await refresh(); } catch { refreshFailed = true; }
      if (!active.current) return;
      const savedMessage = (changed
          ? '배차정보가 바뀌었습니다. 현재 입력으로 다시 생성해 주세요.'
          : pending.imageError
            ? '엑셀은 저장했습니다. 이미지 생성 실패: ' + pending.imageError
            : '엑셀과 이미지를 저장했습니다.') + (refreshFailed ? ' 저장은 완료됐지만 목록을 갱신하지 못했습니다. 다시 조회해 주세요.' : '');
      setStatus(savedMessage);
      message(savedMessage);
    } catch (error) {
      if (active.current) {
        const text =
          (pending.files.every(file=>file.saved) ? '파일 보관 완료 · 업무 연결 저장 확인 필요: ' : `결과 파일 ${pending.files.filter(file=>file.saved).length}/${pending.files.length}개 보관 · `) +
          (error instanceof Error ? error.message : String(error)) +
          ' 저장된 파일은 유지되며 재시도할 수 있습니다.';
        setStatus(text);
        redraw((s) => s + 1);
        frame.current?.contentWindow?.postMessage(
          { type: 'portal-coupang-error', taskId: task.id, message: text },
          location.origin,
        );
      }
    } finally {
      busy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    const receive = async (event: MessageEvent) => {
      if (
        !active.current ||
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.taskId !== task.id
      )
        return;
      const data = event.data;
      if (data.type === 'portal-coupang-ready') {
        ready.current = true;
        try {
          await initialize();
        } catch (error) {
          stop();
          setStatus(error instanceof Error ? error.message : String(error));
        }
      }
      if (
        data.type === 'portal-coupang-progress' &&
        data.jobId === run.current?.id
      )
        setStatus(data.message);
      if (
        data.type === 'portal-coupang-run-error' &&
        data.jobId === run.current?.id
      ) {
        stop();
        setStatus(data.message);
      }
      if (data.type === 'portal-coupang-generated') {
        if (!run.current || data.jobId !== run.current.id || session.pending)
          return;
        if (
          !validCoupangGenerated(data as CoupangGenerated, run.current.date)
        ) {
          stop();
          setStatus('생성 결과를 받지 못했습니다. 다시 생성해 주세요.');
          return;
        }
        const completedRun = run.current;
        stop();
        session.pending = {
          runId: completedRun.id,
          sourceFileId: completedRun.sourceId,
          inputDispatch: completedRun.dispatch,
          taskVersion: completedRun.taskVersion,
          settings: completedRun.settings,
          captureRange: data.captureRange,
          entryDate: data.entryDate,
          generatedAt: new Date().toISOString(),
          dispatch: data.dispatch,
          schedule: data.schedule,
          imageError: data.imageError,
          files: [
            {
              id: crypto.randomUUID(),
              file: new File([data.buffer], data.filename, {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              }),
            },
            ...(data.image
              ? [
                  {
                    id: crypto.randomUUID(),
                    file: new File(
                      [data.image],
                      data.filename.replace(/\.xlsx$/i, '') +
                        '_' +
                        data.captureRange.replace(':', '-') +
                        '.png',
                      { type: 'image/png' },
                    ),
                  },
                ]
              : []),
          ],
        };
        await finish();
      }
    };
    window.addEventListener('message', receive);
    return () => {
      active.current = false;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener('message', receive);
    };
  }, [task.id]);
  useEffect(() => { setEvents([]); setSelectedVersion(''); setHistoryError(''); }, [task.id]);
  useEffect(() => {
    if (!historyOpen) return;
    let active = true;
    setHistoryError('이전 결과 확인 중…');
    void portalApi.events({ taskId: task.id }).then(rows => {
      if (active) { setEvents(rows); setHistoryError(''); }
    }).catch(() => { if (active) setHistoryError('이전 결과를 불러오지 못했습니다. 기록을 닫았다 다시 열어 주세요.'); });
    return () => { active = false; };
  }, [task.id, task.version, historyOpen]);
  const resultFilesKey = JSON.stringify([task.id, result?.files, result?.source_file_id]);
  useEffect(() => {
    let active = true;
    setFiles([]);
    setSourceRecord(undefined);
    if (!result?.files?.length) {
      setFiles([]);
      setResultError('');
      return;
    }
    setResultError('결과 파일 확인 중…');
    void operationsFiles
      .list('task', task.id)
      .then((rows) => {
        if (active) {
          setFiles(
            result.files
              .map((id) =>
                rows.find((file) => file.id === id && file.status === 'saved'),
              )
              .filter((file): file is PortalFile => !!file),
          );
          setSourceRecord(rows.find(file => file.id === result.source_file_id && file.status === 'saved'));
          const count = result.files.filter(id => rows.some(file => file.id === id && file.status === 'saved')).length;
          setResultError(count === result.files.length ? '' : `결과 파일 ${count}/${result.files.length}개 준비 · 나머지는 저장 상태 확인이 필요합니다.`);
        }
      })
      .catch((error) => {
        if (active)
          setResultError('생성 자료를 불러오지 못했습니다. ' + error.message);
      });
    return () => {
      active = false;
    };
  }, [resultFilesKey, task.version]);
  useEffect(() => {
    if (!session.file) return;
    const url = URL.createObjectURL(session.file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [session.file]);
  async function choose(file: File) {
    if (working.current || state.busy) return;
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size < 1 ||
      file.size > 10 * 1024 * 1024
    ) {
      setStatus('사진은 PNG·JPG·WEBP, 10MB 이하로 선택하세요.');
      return;
    }
    if (session.pending) {
      setStatus('생성 파일 저장을 먼저 재시도한 뒤 사진을 변경하세요.');
      if (input.current) input.current.value = '';
      return;
    }
    busy(true);
    try {
      setStatus('배차표 사진 저장 중…');
      const digest = await crypto.subtle.digest(
          'SHA-256',
          await file.arrayBuffer(),
        ),
        fingerprint = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
      if (session.fingerprint !== fingerprint) {
        session.fingerprint = fingerprint;
        session.file = file;
        session.source = { id: crypto.randomUUID(), saved: false };
      }
      if (!session.source!.saved) {
        const result = await operationsFiles.upload({
          kind: 'task',
          subjectId: task.id,
          requestId: session.source!.id,
          file,
        });
        session.source!.fileId = result.id;
        if (!session.source!.fileId) throw Error('사진 저장에 실패했습니다.');
        session.source!.saved = true;
      }
      if (!active.current) return;
      await latest.current.persist({
        ...latest.current.collect(),
        coupang_source_id: session.source!.fileId,
        coupang_schedule: [],
        coupang_result: null,
      });
      setStatus(
        '사진을 등록했습니다. 배차정보를 입력하고 사진 분석·배차 매칭을 누르세요.',
      );
    } catch (error) {
      if (active.current)
        setStatus(
          (error instanceof Error ? error.message : String(error)) +
            ' 사진을 다시 선택해 재시도하세요.',
        );
    } finally {
      busy(false);
    }
  }
  async function analyze() {
    if (working.current || state.busy || session.pending) return;
    if (!latest.current.dispatch.trim()) {
      setStatus('배차정보를 먼저 입력해 주세요.');
      return;
    }
    const sourceId = latest.current.task.inputs?.coupang_source_id;
    if (typeof sourceId !== 'string' || !sourceId) {
      setStatus('배차표 사진을 먼저 넣어 주세요.');
      return;
    }
    if (session.source && (!session.source.saved || session.source.fileId !== sourceId)) {
      setStatus('선택한 사진의 업무 연결 저장을 먼저 완료해 주세요. 같은 사진을 다시 선택해 확인할 수 있습니다.');
      return;
    }
    run.current = {
      id: crypto.randomUUID(),
      dispatch: latest.current.dispatch,
      date: coupangEntryDate(task),
      sourceId,
      taskVersion: latest.current.task.version,
      settings: structuredClone(settings),
    };
    busy(true);
    setStatus('사진 분석 준비 중…');
    timer.current = setTimeout(() => {
      run.current = null;
      busy(false);
      setStatus('분석 시간이 초과되었습니다. 다시 시도해 주세요.');
    }, 180000);
    try {
      setHasFrame(true);
      await initialize();
    } catch (error) {
      stop();
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <section className="coupang-workflow">
      <h3>배차표 · 입문확인 자료</h3>
      <p className="coupang-entry-date">
        입문확인 날짜 · <MentionText>{coupangEntryDate(task)}</MentionText>
      </p>
      <p className="coupang-progress" role="status">
        <MentionText>
          {status ||
            (!writable
              ? '저장된 이미지를 클릭하여 확대하거나 복사하세요.'
              : '')}
        </MentionText>
      </p>
      {writable ? (
        <FileArea
          className="coupang-photo-input"
          accept="image/png,image/jpeg,image/webp"
          disabled={working.current || state.busy}
          onFiles={(files) => {
            if (files[0]) void choose(files[0]);
          }}
        >
          <p>배차표 사진</p>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="배차표 사진 등록"
            disabled={working.current || state.busy}
            onChange={(e) => {
              if (e.target.files?.[0]) void choose(e.target.files[0]);
            }}
          />
          {source ? (
            <img
              src={source}
              alt="등록한 배차표"
              className="coupang-source-preview"
            />
          ) : null}
        </FileArea>
      ) : null}
      {children}
      {writable ? (
        <div className="actions">
          <button
            type="button"
            disabled={working.current || state.busy}
            onClick={() => void analyze()}
          >
            사진 분석·배차 매칭
          </button>
          <button
            type="button"
            hidden={!session.pending}
            disabled={working.current || state.busy}
            onClick={() => void finish()}
          >
            파일 저장 재시도
          </button>
        </div>
      ) : null}
      <div className="coupang-results">
        <details className="history" onToggle={event => setHistoryOpen(event.currentTarget.open)}>
          <summary style={{ color: 'var(--theme-text)' }}>결과 버전·입력 근거</summary>
          {historyError ? <p role="status">{historyError}</p> : null}
          <label>보관 결과<select aria-label="보관 결과" value={selectedVersion} onChange={event=>setSelectedVersion(event.target.value)}><option value="">현재 결과</option>{versions.filter(version=>version.key!==JSON.stringify(currentResult?.files)).map(version=><option key={version.key} value={version.key}>{portalStamp(version.result.generated_at || version.recordedAt || '')} · {version.result.files.length}개 파일</option>)}</select></label>
          {result ? <>
            <p>생성 시각 · {result.generated_at ? portalStamp(result.generated_at) : '기록 없음'}</p>
            <p>{result.input_dispatch === undefined ? '결과 배차정보' : '당시 입력'} · <MentionText>{result.input_dispatch ?? result.dispatch}</MentionText></p>
            {result.source_file_id ? <button type="button" disabled={!sourceRecord || state.busy} onClick={async()=>{try{if(sourceRecord)download(await operationsFiles.download(sourceRecord.id),sourceRecord.file_name);}catch(error){setStatus(error instanceof Error ? error.message : String(error));}}}>당시 원본 다운로드{sourceRecord ? '' : ' · 저장 상태 확인 필요'}</button> : <p>당시 원본 파일 연결은 이 버전에 기록되지 않았습니다.</p>}
          </> : <p>현재 연결된 결과가 없습니다. 기록에 남은 결과를 선택할 수 있습니다.</p>}
        </details>
        {resultError ? (
          <p>
            <MentionText>{resultError}</MentionText>
          </p>
        ) : null}
        {!result?.files?.length ? (
          <p>생성한 엑셀과 이미지가 여기에 표시됩니다.</p>
        ) : (
          <>
            {!selectedVersion && result.dispatch !== dispatch ? (
              <p>
                배차정보가 변경되었습니다. 현재 입력으로 다시 생성해 주세요.
              </p>
            ) : null}
            {files.map((file) => (
              <ResultCard key={file.id} file={file} onError={setStatus} />
            ))}
            {result.image_error ? (
              <p>
                이미지 생성 실패:<MentionText> </MentionText>
                <MentionText>{result.image_error}</MentionText>
              </p>
            ) : null}
          </>
        )}
      </div>
      {downloadLink}
      {hasFrame ? (
        <iframe
          ref={frame}
          title="쿠팡 자료 생성"
          hidden
          aria-hidden="true"
          src={
            '/admin/coupang-entry.html?center=' +
            encodeURIComponent(task.center_code) +
            '&portal_task=' +
            encodeURIComponent(task.id)
          }
        />
      ) : null}
    </section>
  );
}
