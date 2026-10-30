import '../styles/coupang.css';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { AdminPage } from '../components/AdminPage';
import { FileArea } from '../components/FileArea';
import {
  defaultEntryDate,
  formatEntryDateLabel,
  normalizeScheduleRow,
  isActiveScheduleRow,
  parseScheduleRowsFromText,
  parseDispatchText,
  matchScheduleToDispatch,
} from '../domain/coupang';
import type {
  RawSchedule,
  ScheduleRow,
  DispatchRow,
  CoupangMatch,
} from '../domain/coupang';
import { callCoupangVisionEdge, fileToBase64 } from '../lib/coupang-vision';
import {
  inspectCoupangTemplate,
  portalCoupangImage,
} from '../lib/coupang-template';
import { buildCoupangWorkbook } from '../lib/coupang-workbook';
interface View {
  templateBuffer: ArrayBuffer | null;
  worksheetName: string;
  templateInfo: ReactNode;
  imageFile: File | null;
  imagePreviewUrl: string;
  imageInfo: string;
  imageSize: {
    width: number;
    height: number;
  } | null;
  selectedDate: string;
  scheduleRows: ScheduleRow[];
  dispatchRows: DispatchRow[];
  matches: CoupangMatch[];
  scheduleJson: string;
  dispatchText: string;
  dispatchCount: string;
  model: string;
  scheduleRevision: number;
  analyzing: boolean;
  exporting: boolean;
}
interface PortalMessage {
  type: string;
  taskId: string;
  jobId?: string;
  date?: string;
  dispatch?: string;
  file?: File;
  settings?: {
    worksheet?: string;
  };
  schedule?: RawSchedule[];
  message?: string;
}
const errorMessage = (error: unknown) =>
  String(
    error && typeof error === 'object' && 'message' in error
      ? error.message
      : error,
  );
function CoupangEntryContent() {
  const portalContext = new URLSearchParams(location.search).get('portal_task'),
    isPortal = !!portalContext && parent !== window;
  const [view, setView] = useState<View>({
    templateBuffer: null,
    worksheetName: '',
    templateInfo: '저장된 템플릿을 불러오는 중...',
    imageFile: null,
    imagePreviewUrl: '',
    imageInfo: '선택된 이미지 없음',
    imageSize: null,
    selectedDate: defaultEntryDate(),
    scheduleRows: [],
    dispatchRows: [],
    matches: [],
    scheduleJson: '',
    dispatchText: '',
    dispatchCount: '',
    model: 'claude-haiku-4-5-20251001',
    scheduleRevision: 0,
    analyzing: false,
    exporting: false,
  });
  const current = useRef(view),
    mounted = useRef(true),
    [imageFocused, setImageFocused] = useState(false);
  function update(changes: Partial<View>) {
    current.current = { ...current.current, ...changes };
    if (mounted.current) setView(current.current);
  }
  const [notice, setNotice] = useState({
      text: '',
      type: 'info',
      shown: false,
    }),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function toast(text: string, type = 'info') {
    clearTimeout(toastTimer.current);
    setNotice({ text, type, shown: true });
    toastTimer.current = setTimeout(
      () => setNotice((previous) => ({ ...previous, shown: false })),
      2600,
    );
  }
  function invalidateMatches() {
    update({ matches: [] });
  }
  function invalidateSchedule() {
    update({
      scheduleRevision: current.current.scheduleRevision + 1,
      scheduleRows: [],
      matches: [],
    });
  }
  function setEntryDate(date?: string) {
    update({ selectedDate: date || defaultEntryDate() });
  }
  function editDispatch(text: string) {
    update({ dispatchText: text, dispatchRows: [] });
    invalidateMatches();
  }
  function editJson(text: string) {
    update({ scheduleJson: text });
    invalidateSchedule();
  }
  const templateRequest = useRef<Promise<{
      buffer: ArrayBuffer;
      sheet: string;
    }> | null>(null),
    ready = useRef<Promise<void> | null>(null),
    templateGeneration = useRef(0);
  async function loadDefault(showToast = false, reuse = false) {
    const token = ++templateGeneration.current;
    update({ templateInfo: '저장된 템플릿을 불러오는 중...' });
    try {
      const request =
        reuse && templateRequest.current
          ? templateRequest.current
          : (async () => {
              const response = await fetch(
                `/templates/sazocoupang.xlsx?v=${Date.now()}`,
                { cache: 'no-store' },
              );
              if (!response.ok)
                throw new Error(
                  `템플릿을 찾을 수 없습니다. (${response.status})`,
                );
              const buffer = await response.arrayBuffer();
              return { buffer, sheet: await inspectCoupangTemplate(buffer) };
            })();
      templateRequest.current = request;
      const data = await request;
      if (token !== templateGeneration.current) return;
      applyTemplate(
        data.buffer,
        data.sheet,
        '저장된 템플릿',
        '/templates/sazocoupang.xlsx',
      );
      if (showToast) toast('저장된 템플릿을 다시 불러왔습니다.', 'success');
    } catch (error) {
      if (token !== templateGeneration.current) return;
      update({
        templateInfo: (
          <>
            <span className="text-amber-300">
              저장된 템플릿을 불러오지 못했습니다.
            </span>
            <br />
            {errorMessage(error)}
            <br />
            필요 시 임시 템플릿을 업로드하세요.
          </>
        ),
      });
      if (showToast) toast(`템플릿 로드 실패: ${errorMessage(error)}`, 'error');
    }
  }
  function applyTemplate(
    buffer: ArrayBuffer,
    sheet: string,
    name: string,
    detail: string,
  ) {
    update({
      templateBuffer: buffer.slice(0),
      worksheetName: sheet,
      templateInfo: (
        <>
          <div className="font-medium text-zinc-200">{name}</div>
          <div>
            {detail} · Sheet1: {sheet}
          </div>
        </>
      ),
    });
  }
  async function uploadTemplate(file: File) {
    const token = ++templateGeneration.current;
    try {
      const buffer = await file.arrayBuffer(),
        sheet = await inspectCoupangTemplate(buffer);
      if (token !== templateGeneration.current) return;
      applyTemplate(buffer, sheet, file.name, '임시 업로드 템플릿');
      toast('템플릿을 불러왔습니다.', 'success');
    } catch (error) {
      toast(`템플릿 로드 실패: ${errorMessage(error)}`, 'error');
    }
  }
  useEffect(() => {
    mounted.current = true;
    ready.current = loadDefault(false, true);
    return () => {
      mounted.current = false;
      templateGeneration.current++;
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    const url = view.imagePreviewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [view.imagePreviewUrl]);
  function handleImage(file: File | null) {
    invalidateSchedule();
    update({
      scheduleJson: '',
      imageFile: file,
      imagePreviewUrl: file ? URL.createObjectURL(file) : '',
      imageSize: null,
      imageInfo: file
        ? `${file.name} (${(file.size / 1024).toFixed(1)} KB)`
        : '선택된 이미지 없음',
    });
  }
  function imageError() {
    invalidateSchedule();
    update({
      imageFile: null,
      imageSize: { width: 0, height: 0 },
      imagePreviewUrl: '',
      imageInfo: '이미지를 읽지 못했습니다. 다른 이미지 파일을 선택하세요.',
    });
    toast('이미지를 읽지 못했습니다. 파일 형식을 확인하세요.', 'error');
  }
  async function analyzeImage(
    options: {
      throwOnError?: boolean;
    } = {},
  ) {
    const file = current.current.imageFile;
    if (!file) {
      toast('쿠팡 시간표 이미지를 선택하세요.', 'error');
      return;
    }
    invalidateSchedule();
    const revision = current.current.scheduleRevision;
    update({ analyzing: true });
    try {
      const base64 = await fileToBase64(file);
      if (revision !== current.current.scheduleRevision) return;
      const text = await callCoupangVisionEdge({
        model: current.current.model || 'claude-haiku-4-5-20251001',
        mediaType: file.type || 'image/png',
        base64,
      });
      if (revision !== current.current.scheduleRevision) return;
      const raw = parseScheduleRowsFromText(text),
        scheduleRows = raw
          .map(normalizeScheduleRow)
          .filter(isActiveScheduleRow);
      update({ scheduleJson: JSON.stringify(raw, null, 2), scheduleRows });
      toast(
        `API호출 완료: 시간표 ${scheduleRows.length}행을 추출했습니다.`,
        'success',
      );
    } catch (error) {
      if (options.throwOnError) throw error;
      const msg = errorMessage(error);
      toast(
        msg.includes('Failed to fetch')
          ? '이미지 분석 실패: 브라우저 직접 호출이 CORS/네트워크로 차단됐습니다. Supabase Edge Function coupang-vision 배포가 필요합니다.'
          : `이미지 분석 실패: ${msg}`,
        'error',
      );
    } finally {
      update({ analyzing: false });
    }
  }
  function loadScheduleJson() {
    invalidateSchedule();
    try {
      const rows = parseScheduleRowsFromText(current.current.scheduleJson)
        .map(normalizeScheduleRow)
        .filter(isActiveScheduleRow);
      update({ scheduleRows: rows });
      toast(`시간표 JSON ${rows.length}행을 반영했습니다.`, 'success');
    } catch (error) {
      toast(`JSON 파싱 실패: ${errorMessage(error)}`, 'error');
    }
  }
  function parseDispatchInput() {
    invalidateMatches();
    const dispatchRows = parseDispatchText(current.current.dispatchText);
    update({
      dispatchRows,
      dispatchCount: dispatchRows.length
        ? `${dispatchRows.length}건`
        : '파싱 결과 없음',
    });
    toast(
      `배차정보 ${dispatchRows.length}건을 파싱했습니다.`,
      dispatchRows.length ? 'success' : 'error',
    );
  }
  function runMatching() {
    if (!current.current.scheduleRows.length) {
      toast('시간표 JSON을 먼저 반영하세요.', 'error');
      return;
    }
    if (!current.current.dispatchRows.length) parseDispatchInput();
    const matches = current.current.scheduleRows.map((schedule) => ({
      schedule,
      match: matchScheduleToDispatch(schedule, current.current.dispatchRows),
      include: true,
    }));
    update({ matches });
    toast('매칭을 완료했습니다.', 'success');
  }
  const portalSettings = useRef<{
      worksheet?: string;
    }>({}),
    portalBusy = useRef(false),
    portalReadySent = useRef(false);
  const downloadRef = useRef<HTMLAnchorElement>(null),
    [downloadUrl, setDownloadUrl] = useState<{
      url: string;
      name: string;
    } | null>(null);
  useEffect(() => {
    if (!downloadUrl) return;
    downloadRef.current?.click();
    const timer = setTimeout(() => URL.revokeObjectURL(downloadUrl.url), 1000);
    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(downloadUrl.url);
    };
  }, [downloadUrl]);
  async function downloadWorkbook(
    options: {
      portalJobId?: string;
      throwOnError?: boolean;
    } = {},
  ) {
    const source = current.current;
    if (!source.templateBuffer) {
      toast('템플릿을 먼저 불러오세요.', 'error');
      return;
    }
    if (source.exporting) return;
    const snapshot = {
      ...source,
      templateBuffer: source.templateBuffer.slice(0),
      matches: JSON.parse(JSON.stringify(source.matches)) as CoupangMatch[],
      imageSize: { ...source.imageSize },
    };
    update({ exporting: true });
    try {
      const result = await buildCoupangWorkbook({
        ExcelJS,
        JSZip,
        templateBuffer: snapshot.templateBuffer,
        worksheetName: portalContext
          ? portalSettings.current.worksheet || snapshot.worksheetName
          : snapshot.worksheetName,
        date: snapshot.selectedDate,
        matches: snapshot.matches,
        strict: !!portalContext,
        image: snapshot.imageFile
          ? {
              base64: await fileToBase64(snapshot.imageFile),
              mediaType: snapshot.imageFile.type || 'image/png',
              width: snapshot.imageSize.width,
              height: snapshot.imageSize.height,
            }
          : null,
      });
      if (result.errors.length)
        toast(`일부 미입력: ${result.errors.join(', ')}`, 'error');
      if (isPortal) {
        let image: Blob | null = null,
          imageError: string | null = null;
        try {
          const { captureWorkbookRange } =
            await import('../lib/coupang-capture');
          image = await captureWorkbookRange({
            ExcelJS,
            buffer: result.buffer,
            worksheetName: result.worksheetName,
            range: result.captureRange,
          });
          if (image.size > 10 * 1024 * 1024)
            throw Error('범위 이미지가 10MB를 초과하여 엑셀만 첨부합니다.');
        } catch (error) {
          image = null;
          imageError = errorMessage(error) || '이미지를 생성하지 못했습니다.';
        }
        parent.postMessage(
          {
            type: 'portal-coupang-generated',
            taskId: portalContext,
            jobId: options.portalJobId || crypto.randomUUID(),
            captureRange: result.captureRange,
            entryDate: snapshot.selectedDate,
            buffer: result.buffer,
            filename: result.filename,
            image,
            imageError,
            schedule: current.current.scheduleRows,
            dispatch: current.current.dispatchText,
            matches: snapshot.matches,
          },
          location.origin,
        );
        return;
      }
      setDownloadUrl({
        url: URL.createObjectURL(
          new Blob([result.buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
        ),
        name: result.filename,
      });
    } catch (error) {
      if (options.throwOnError) throw error;
      toast(errorMessage(error) || '엑셀을 생성하지 못했습니다.', 'error');
    } finally {
      update({ exporting: false });
    }
  }
  async function runPortal(data: PortalMessage) {
    if (portalBusy.current) {
      parent.postMessage(
        {
          type: 'portal-coupang-run-error',
          taskId: portalContext,
          jobId: data.jobId,
          message: '이전 분석이 진행 중입니다. 잠시 후 다시 시도하세요.',
        },
        location.origin,
      );
      return;
    }
    portalBusy.current = true;
    const report = (type: string, extra: Record<string, unknown>) =>
      parent.postMessage(
        { type, taskId: portalContext, jobId: data.jobId, ...extra },
        location.origin,
      );
    try {
      if (
        !data.file ||
        typeof data.dispatch !== 'string' ||
        !data.dispatch.trim()
      )
        throw Error('배차표 사진과 배차정보를 넣어 주세요.');
      await ready.current;
      if (!current.current.templateBuffer)
        throw Error(
          '입문확인 엑셀 양식을 불러오지 못했습니다. 다시 시도하세요.',
        );
      portalSettings.current = data.settings ?? {};
      setEntryDate(data.date);
      update({ dispatchText: data.dispatch });
      const file = await portalCoupangImage(data.file);
      handleImage(file);
      const bitmap = await createImageBitmap(file);
      update({ imageSize: { width: bitmap.width, height: bitmap.height } });
      bitmap.close();
      report('portal-coupang-progress', { message: '1/4 · 사진 분석 중…' });
      await analyzeImage({ throwOnError: true });
      if (!current.current.scheduleRows.length)
        throw Error('사진에서 시간표를 찾지 못했습니다. 사진을 확인해 주세요.');
      report('portal-coupang-progress', { message: '2/4 · 분석값 정리 중…' });
      update({ scheduleJson: JSON.stringify(current.current.scheduleRows) });
      loadScheduleJson();
      report('portal-coupang-progress', { message: '3/4 · 배차정보 매칭 중…' });
      parseDispatchInput();
      if (!current.current.dispatchRows.length)
        throw Error(
          '배차정보에서 기사·차량 정보를 찾지 못했습니다. 입력 형식을 확인해 주세요.',
        );
      runMatching();
      const missing = current.current.matches.filter(
        (item) => !item.match.matchedDispatch,
      );
      if (missing.length)
        throw Error(
          '배차정보와 매칭되지 않은 센터: ' +
            missing.map((item) => item.schedule.centerRaw).join(', '),
        );
      report('portal-coupang-progress', {
        message: '4/4 · 엑셀·이미지 생성 중…',
      });
      await downloadWorkbook({ portalJobId: data.jobId, throwOnError: true });
    } catch (error) {
      report('portal-coupang-run-error', {
        message:
          errorMessage(error) || '자료를 생성하지 못했습니다. 다시 시도하세요.',
      });
    } finally {
      portalBusy.current = false;
    }
  }
  const receive = useRef<(event: MessageEvent) => Promise<void>>(
    async () => {},
  );
  receive.current = async (event) => {
    const data = event.data as PortalMessage;
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      data?.taskId !== portalContext
    )
      return;
    if (data.type === 'portal-coupang-run') {
      await runPortal(data);
      return;
    }
    if (data.type === 'portal-coupang-init') {
      portalSettings.current = data.settings ?? {};
      setEntryDate(data.date);
      editDispatch(data.dispatch ?? '');
      if (data.file) handleImage(await portalCoupangImage(data.file));
      editJson(
        data.schedule?.length ? JSON.stringify(data.schedule, null, 2) : '',
      );
      if (data.schedule?.length) loadScheduleJson();
    }
    if (
      data.type === 'portal-coupang-dispatch' &&
      current.current.dispatchText !== data.dispatch
    )
      editDispatch(data.dispatch ?? '');
    if (data.type === 'portal-coupang-saved')
      toast('업무 티켓에 첨부하고 분석·배차정보를 저장했습니다.', 'success');
    if (data.type === 'portal-coupang-error')
      toast(data.message || '', 'error');
  };
  useEffect(() => {
    if (!isPortal) return;
    const handler = (event: MessageEvent) => {
      void receive
        .current(event)
        .catch((error) => toast(errorMessage(error), 'error'));
    };
    window.addEventListener('message', handler);
    if (!portalReadySent.current) {
      portalReadySent.current = true;
      parent.postMessage(
        { type: 'portal-coupang-ready', taskId: portalContext },
        location.origin,
      );
    }
    return () => window.removeEventListener('message', handler);
  }, [isPortal, portalContext]);
  return (
    <>
      <main
        className="app-main flex-1 max-w-[1500px] w-full mx-auto px-4 py-6 space-y-5"
        id="work-main"
        tabIndex={-1}
      >
        <section
          hidden={isPortal}
          className="border border-zinc-700 rounded-lg bg-zinc-800/40 p-4"
        >
          <h2 className="text-sm font-semibold mb-2">작업 방식</h2>
          <ol className="text-xs text-zinc-400 space-y-1 list-decimal list-inside leading-relaxed">
            <li>
              저장된 엑셀 템플릿을 불러옵니다. 기본 위치는{' '}
              <code>/templates/coupang-entry-template.xlsx</code>입니다.
            </li>
            <li>
              쿠팡 시간표 이미지를 Claude Vision API로 분석해
              센터·예약시간·물량·냉장·냉동을 JSON으로 추출합니다.
            </li>
            <li>
              배차정보 텍스트는 기존 배차정보 파서 규칙에 맞춰
              기사명·차량번호·연락처를 파싱합니다.
            </li>
            <li>
              센터명 기준으로 시간표와 배차정보를 매칭하고, 확인 후 G6:G23 시간
              행의 I/J, K/L... U/V 영역에 입력합니다.
            </li>
          </ol>
          <p className="mt-3 text-xs text-amber-300">
            AIAPIFlow 호출은 브라우저가 아니라 Supabase Edge Function을 통해서만
            실행됩니다.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <FileArea
            hidden={isPortal}
            className="drop-card rounded-lg p-3"
            data-drop="template"
            accept=".xlsx,.xlsm"
            onFiles={(files) => {
              if (files[0]) void uploadTemplate(files[0]);
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="step-badge">1</span>
              <div>
                <div className="text-sm font-semibold">엑셀 템플릿</div>
                <div className="text-xs text-zinc-500">
                  G6:G23 시간 기준 입력
                </div>
              </div>
            </div>
            <button
              id="reload-template-btn"
              onClick={() => void loadDefault(true)}
              className="btn btn-ghost text-xs mb-3"
              type="button"
            >
              저장된 템플릿 다시 불러오기
            </button>
            <label className="app-label">입문확인 날짜</label>
            <input
              id="entry-date"
              value={view.selectedDate}
              disabled={isPortal}
              onChange={(event) => setEntryDate(event.target.value)}
              type="date"
              className="app-input mb-3"
            />
            <div id="entry-date-label" className="mb-3 text-xs text-sky-300">
              엑셀 G3/시트명: {formatEntryDateLabel(view.selectedDate)}
            </div>
            <label className="app-label">필요 시 임시 템플릿 업로드</label>
            <input
              id="template-file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadTemplate(file);
              }}
              type="file"
              accept=".xlsx,.xlsm"
              className="w-full text-sm"
            />
            <div id="template-info" className="mt-3 text-xs text-zinc-400">
              {view.templateInfo}
            </div>
          </FileArea>

          <FileArea
            className="drop-card rounded-lg p-3"
            data-drop="image"
            accept="image/*"
            hint={false}
            disabled={!!portalContext}
            onFiles={(files) => {
              if (files[0]) handleImage(files[0]);
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="step-badge">2</span>
              <div>
                <div className="text-sm font-semibold">쿠팡 시간표 이미지</div>
                <div className="text-xs text-zinc-500">
                  이미지 등록 후 API호출
                </div>
              </div>
            </div>
            <input
              id="image-file"
              hidden={isPortal}
              disabled={isPortal}
              onChange={(event) => handleImage(event.target.files?.[0] || null)}
              type="file"
              accept="image/*"
              className="w-full text-sm mb-3"
            />
            <div
              id="image-paste-box"
              className={`image-paste-box${imageFocused ? ' active' : ''}`}
              tabIndex={isPortal ? undefined : 0}
              role={isPortal ? undefined : 'button'}
              onFocus={() => setImageFocused(true)}
              onBlur={() => setImageFocused(false)}
              onClick={(event) => {
                if (!isPortal) event.currentTarget.focus();
              }}
              aria-label="쿠팡 시간표 이미지 붙여넣기 영역"
              title="클립보드 이미지 붙여넣기 (Ctrl+V)"
            >
              <div
                id="image-placeholder"
                hidden={!!view.imagePreviewUrl}
                className="px-4 text-xs text-zinc-400 leading-6"
              >
                {isPortal
                  ? '업무 티켓에서 배차표 사진을 먼저 등록하세요.'
                  : '시간표 이미지 없음'}
              </div>
              <img
                id="image-preview"
                className={view.imagePreviewUrl ? '' : 'hidden'}
                src={view.imagePreviewUrl || undefined}
                onLoad={(event) =>
                  update({
                    imageSize: {
                      width: event.currentTarget.naturalWidth || 0,
                      height: event.currentTarget.naturalHeight || 0,
                    },
                  })
                }
                onError={imageError}
                alt="쿠팡 시간표 미리보기"
              />
            </div>
            <div id="image-info" className="mt-3 text-xs text-zinc-400">
              {view.imageInfo}
            </div>
            <label
              className="app-label mt-3"
              htmlFor="coupang-vision-model"
              hidden={isPortal}
            >
              API 모델
            </label>
            <select
              id="coupang-vision-model"
              hidden={isPortal}
              value={view.model}
              onChange={(event) => update({ model: event.target.value })}
              className="app-input"
            >
              <option value="claude-haiku-4-5-20251001">
                기존 모델 · Claude Haiku 4.5
              </option>
              <option value="claude-opus-5">Claude Opus 5</option>
            </select>
            <button
              id="analyze-image-btn"
              disabled={view.analyzing}
              onClick={() => void analyzeImage()}
              className="btn btn-primary mt-3 w-full"
              type="button"
            >
              {view.analyzing ? 'API호출 중...' : 'API호출'}
            </button>
          </FileArea>
          <div
            hidden={isPortal}
            className="border border-zinc-700 rounded-lg bg-zinc-800/40 p-3"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="step-badge">3</span>
              <div>
                <div className="text-sm font-semibold">배차정보 텍스트</div>
                <div className="text-xs text-zinc-500">
                  기존 파서 규칙으로 센터/기사/차량 추출
                </div>
              </div>
            </div>
            <textarea
              id="dispatch-text"
              value={view.dispatchText}
              onChange={(event) => editDispatch(event.target.value)}
              rows={8}
              className="app-input font-mono text-xs"
              placeholder={
                '\uC608)\\n\uCFE0\uD321 \uC778\uCC9C15/11 5\uD1A4\\n\uD64D\uAE38\uB3D9 \uACBD\uAE3092\uBC141234\\n01012345678\\n\\n\uCFE0\uD321 \uC778\uCC9C12B2B 5\uD1A4\\n\uAE40\uAE30\uC0AC \uACBD\uAE3091\uC7905678\\n01098765432'
              }
            ></textarea>
            <div className="mt-3 flex gap-2">
              <button
                id="parse-dispatch-btn"
                onClick={parseDispatchInput}
                className="btn btn-ghost"
                type="button"
              >
                배차정보 파싱
              </button>
              <span
                id="dispatch-count"
                className="text-xs text-zinc-400 self-center"
              >
                {view.dispatchCount}
              </span>
            </div>
          </div>
          <div className="border border-zinc-700 rounded-lg bg-zinc-800/40 p-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="step-badge">4</span>
              <div>
                <div className="text-sm font-semibold">
                  추출 JSON 직접 붙여넣기
                </div>
                <div className="text-xs text-zinc-500">
                  API 실패 시 수동 보정 가능
                </div>
              </div>
            </div>
            <textarea
              id="schedule-json"
              value={view.scheduleJson}
              onChange={(event) => editJson(event.target.value)}
              rows={8}
              className="app-input font-mono text-xs"
              placeholder={
                '[{"centerRaw":"\uC778\uCC9C12 B2B","centerBase":"\uC778\uCC9C12","isB2B":true,"reservationTime":"09:00","quantity":276,"cold":1,"frozen":2}]'
              }
            ></textarea>
            <div className="mt-3 flex gap-2">
              <button
                id="load-json-btn"
                onClick={loadScheduleJson}
                className="btn btn-ghost"
                type="button"
              >
                JSON 반영
              </button>
              <button
                id="match-btn"
                onClick={runMatching}
                className="btn btn-primary"
                type="button"
              >
                매칭 실행
              </button>
            </div>
          </div>
        </section>

        <section className="border border-zinc-700 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex flex-wrap items-center gap-2">
            <span className="step-badge">5</span>
            <span className="text-sm font-semibold">매칭 확인</span>
            <span id="match-count" className="text-xs text-zinc-400">
              {view.matches.length
                ? `${view.matches.length}건`
                : view.scheduleRows.length
                  ? `시간표 ${view.scheduleRows.length}행`
                  : ''}
            </span>
            <div className="flex-1"></div>
            <button
              id="download-btn"
              onClick={() => void downloadWorkbook()}
              className="btn btn-primary"
              disabled={
                view.exporting ||
                !view.templateBuffer ||
                !view.matches.some(
                  (match) => match.include && match.match.matchedDispatch,
                )
              }
            >
              {isPortal
                ? '엑셀·이미지 생성하고 업무에 첨부'
                : '엑셀 입력 후 다운로드'}
            </button>
          </div>
          <div className="overflow-auto max-h-[62vh]">
            <table className="preview-table min-w-[1300px] w-full text-xs">
              <thead className="bg-zinc-900/80 sticky top-0 z-10">
                <tr className="text-zinc-300 border-b border-zinc-700">
                  <th className="px-2 py-2">입력</th>
                  <th className="px-2 py-2 text-left">예약시간</th>
                  <th className="px-2 py-2 text-left">센터</th>
                  <th className="px-2 py-2 text-left">물량</th>
                  <th className="px-2 py-2 text-left">냉장</th>
                  <th className="px-2 py-2 text-left">냉동</th>
                  <th className="px-2 py-2 text-left">기사</th>
                  <th className="px-2 py-2 text-left">차량</th>
                  <th className="px-2 py-2 text-left">매칭</th>
                  <th className="px-2 py-2 text-left">경고</th>
                </tr>
              </thead>
              <tbody id="match-body">
                {view.matches.map((item, index) => {
                  const dispatch = item.match.matchedDispatch;
                  return (
                    <tr
                      key={index}
                      className={`border-b border-zinc-800 ${item.match.warning ? 'bg-amber-950/20' : ''}`}
                    >
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          data-include={index}
                          checked={!!dispatch && item.include}
                          disabled={!dispatch}
                          onChange={(event) =>
                            update({
                              matches: view.matches.map((match, i) =>
                                i === index
                                  ? { ...match, include: event.target.checked }
                                  : match,
                              ),
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1 font-mono">
                        {item.schedule.reservationTime || ''}
                      </td>
                      <td className="px-2 py-1">{item.schedule.centerRaw}</td>
                      <td className="px-2 py-1">
                        {item.schedule.quantity ?? ''}
                      </td>
                      <td className="px-2 py-1">{item.schedule.cold ?? ''}</td>
                      <td className="px-2 py-1">
                        {item.schedule.frozen ?? ''}
                      </td>
                      <td className="px-2 py-1">{dispatch?.driver || ''}</td>
                      <td className="px-2 py-1 font-mono">
                        {dispatch?.vehicle || ''}
                      </td>
                      <td className="px-2 py-1">
                        {item.match.matchType} (
                        {Math.round(item.match.confidence * 100)}%)
                      </td>
                      <td className="px-2 py-1 text-amber-300">
                        {item.match.warning || ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div
            id="empty-state"
            className={`p-8 text-center text-sm text-zinc-500${view.matches.length ? ' hidden' : ''}`}
          >
            시간표 분석과 배차정보 파싱 후 매칭을 실행하세요.
          </div>
        </section>
      </main>
      <div
        id="toast"
        className={`fixed left-1/2 bottom-6 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-xl pointer-events-none${notice.shown ? ' show' : ' opacity-0 translate-y-2'} ${notice.type === 'error' ? 'bg-rose-950/95 border border-rose-700 text-rose-100' : notice.type === 'success' ? 'bg-emerald-950/95 border border-emerald-700 text-emerald-100' : 'bg-zinc-800 border border-zinc-700 text-zinc-100'}`}
      >
        {notice.text}
      </div>
      <a
        ref={downloadRef}
        hidden
        href={downloadUrl?.url}
        download={downloadUrl?.name}
      />
    </>
  );
}
export default function CoupangEntry() {
  return (
    <AdminPage
      title="쿠팡 입문확인"
      bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"
    >
      <CoupangEntryContent />
    </AdminPage>
  );
}
