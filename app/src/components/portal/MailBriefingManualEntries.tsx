import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ModalClose } from '../Modal';
import { privateMail } from '../../lib/portal-mail';
import type {
  MailManualImage,
  MailManualEntry,
  MailManualItem,
  MailManualList,
} from '../../lib/portal-mail';

type DraftImage = {
  name: string;
  data: string;
  preview: string;
  hash: string;
  byteLength: number;
  pixelCount: number;
};
function headerDimensions(bytes: Uint8Array, png: boolean) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    png &&
    bytes.length >= 24 &&
    view.getUint32(8) === 13 &&
    view.getUint32(12) === 0x49484452
  )
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (!png) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 8
      )
        return {
          height: view.getUint16(offset + 3),
          width: view.getUint16(offset + 5),
        };
      offset += length;
    }
  }
  throw Error(
    '사진 크기 정보를 읽지 못했습니다. JPEG 또는 PNG 원본을 확인해 주세요.',
  );
}
function validDimensions(width: number, height: number) {
  if (
    !width ||
    !height ||
    width > 8000 ||
    height > 8000 ||
    width * height > 13000000
  )
    throw Error(
      '사진 가로·세로는 각각 8,000픽셀 이하, 사진당 1,300만 / 합계 1,600만 픽셀 이하여야 합니다.',
    );
}
async function readImage(file: File): Promise<DraftImage> {
  if (file.type === 'image/webp' || /\.webp$/i.test(file.name))
    throw Error(
      'OneNote 호환을 위해 WebP는 사용할 수 없습니다. JPEG 또는 PNG를 첨부해 주세요.',
    );
  if (!['image/jpeg', 'image/png'].includes(file.type))
    throw Error('JPEG 또는 PNG 사진만 첨부할 수 있습니다.');
  if (!file.size || file.size > 6000000)
    throw Error('사진 원본 한 장은 6,000,000바이트 이하여야 합니다.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png =
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (
    (file.type === 'image/png' && !png) ||
    (file.type === 'image/jpeg' && !jpeg)
  )
    throw Error('사진 형식이 올바르지 않습니다.');
  const dimensions = headerDimensions(bytes, png);
  validDimensions(dimensions.width, dimensions.height);
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('');
  const preview = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(Error('사진을 읽지 못했습니다. 다시 첨부해 주세요.'));
    reader.readAsDataURL(file);
  });
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    validDimensions(bitmap.width, bitmap.height);
  } catch {
    throw Error('사진을 열지 못했습니다. JPEG 또는 PNG 원본을 확인해 주세요.');
  } finally {
    bitmap?.close();
  }
  return {
    name: file.name,
    data: preview.slice(preview.indexOf(',') + 1),
    preview,
    hash,
    byteLength: bytes.length,
    pixelCount: dimensions.width * dimensions.height,
  };
}
export function StoredManualPhotos({
  entryId,
  images,
}: {
  entryId: string;
  images: MailManualImage[];
}) {
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const pending = useRef(false);
  async function show(image: MailManualImage) {
    if (pending.current) return;
    pending.current = true;
    setLoadingId(image.id);
    setError('');
    try {
      const result = await privateMail.manualSourceImage(entryId, image.id);
      if (
        !['image/jpeg', 'image/png'].includes(result.image.mediaType) ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(result.image.data)
      )
        throw Error('invalid image');
      setPhotos((previous) => ({
        ...previous,
        [image.id]: `data:${result.image.mediaType};base64,${result.image.data}`,
      }));
    } catch {
      setError('원본 사진을 불러오지 못했습니다. 다시 시도해 주세요.');
    } finally {
      pending.current = false;
      setLoadingId(null);
    }
  }
  return (
    <details>
      <summary>원본 사진 {images.length}장</summary>
      {images.map((image) => (
        <div key={image.id}>
          <p>
            {image.name} · {image.width} × {image.height}
          </p>
          {photos[image.id] ? (
            <img
              src={photos[image.id]}
              alt={image.name}
              style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }}
            />
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loadingId !== null}
              onClick={() => void show(image)}
            >
              {loadingId === image.id ? '불러오는 중…' : '사진 보기'}
            </button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
export function formatBriefingTimestamp(value?: string | null) {
  if (!value) return '확인 필요';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '확인 필요'
    : parsed.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
}
function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function failure(error: unknown) {
  const value =
    error && typeof error === 'object'
      ? (error as { code?: string; message?: string })
      : {};
  return (
    (
      {
        OWNER_REQUIRED: '본인 계정에서만 메시지를 추가할 수 있습니다.',
        MANUAL_TARGET_CONFLICT:
          '같은 메시지가 다른 대상 범위로 이미 접수돼 있습니다. 기존 접수건을 확인해 주세요.',
        MANUAL_SCHEMA_REQUIRED:
          '메시지 저장 준비 중입니다. 잠시 후 다시 시도해 주세요.',
        AI_NOT_CONFIGURED: '메시지 분석 연결이 준비되지 않았습니다.',
        IMAGE_LIMIT: '사진 개수나 원본 크기 제한을 확인해 주세요.',
        IMAGE_DIMENSIONS:
          '사진 가로·세로는 각각 8,000픽셀 이하, 사진당 1,300만 / 합계 1,600만 픽셀 이하여야 합니다.',
        IMAGE_PREPARE_FAILED:
          '원본 사진은 보관되어 있습니다. 사진 변환에 실패했으니 다시 시도해 주세요.',
        IMAGE_WORKER_REQUIRED:
          '원본 사진은 보관되어 있습니다. 사진 처리 연결을 확인한 뒤 다시 시도해 주세요.',
        IMAGE_MANIFEST:
          '사진 원본 확인에 실패했습니다. 저장된 원본을 확인한 뒤 다시 시도해 주세요.',
        IMAGE_FORMAT:
          '사진을 읽지 못했습니다. JPEG 또는 PNG 원본을 확인해 주세요.',
        IMAGE_PRIVACY_REVIEW:
          '보호가 필요한 정보가 있는 사진은 분석할 수 없습니다. 신분증·비밀번호 사진이 없는지 확인해 주세요.',
        UNSUPPORTED_IMAGE_TYPE:
          'OneNote 호환을 위해 JPEG·PNG만 지원합니다. WebP는 사용할 수 없습니다.',
        MANUAL_IMAGE_INVALID:
          '사진 형식·크기·개수를 확인해 주세요. JPEG·PNG만 지원합니다.',
        MANUAL_PRIVACY_REQUIRED:
          '사진의 외부 AI 분석 및 OneNote 전송 동의를 확인해 주세요.',
        MANUAL_IMAGE_PRIVACY_REQUIRED:
          '사진의 외부 AI 분석 및 OneNote 전송 동의를 확인해 주세요.',
        MANUAL_TEXT_INVALID: '메시지는 12,000자 이내로 입력해 주세요.',
        MANUAL_REFERENCE_INVALID: '메시지 기준일을 다시 확인해 주세요.',
        MANUAL_INPUT_INVALID:
          '메시지는 12,000자 이내로 입력하고 기준일을 확인해 주세요.',
        MAIL_PRIVACY_REVIEW:
          '입력 내용 중 보호가 필요한 정보가 있어 분석하지 않았습니다. 내용을 확인해 주세요.',
      } as Record<string, string>
    )[value.code || value.message || ''] ||
    '요청을 완료하지 못했습니다. 입력 내용과 기존 항목을 유지합니다. 다시 시도해 주세요.'
  );
}
export function MailBriefingManualEntries({
  day,
  disabled = false,
  onBusyChange,
  showItems = true,
  onChanged,
  inputOpen = false,
  initialDraft,
  refreshKey = 0,
  onInputClose,
}: {
  initialDraft?: {
    id: string;
    text: string;
    targetWorkId?: string;
    autoSubmit?: boolean;
  };
  refreshKey?: number;
  inputOpen?: boolean;
  onInputClose?: () => void;
  day: string;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  showItems?: boolean;
  onChanged?: () => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<DraftImage[]>([]);
  const imagesRef = useRef<DraftImage[]>([]);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [readingImages, setReadingImages] = useState(false);
  const reading = useRef(false);
  const imageGeneration = useRef(0);
  async function attach(files: File[]) {
    if (reading.current || locked.current || disabled || !files.length) return;
    reading.current = true;
    setReadingImages(true);
    const generation = imageGeneration.current;
    const next = [...imagesRef.current];
    const errors: string[] = [];
    try {
      for (const file of files) {
        try {
          const image = await readImage(file);
          if (generation !== imageGeneration.current || !mounted.current)
            return;
          if (next.some((existing) => existing.hash === image.hash)) {
            errors.push('중복 사진은 한 번만 첨부합니다.');
            continue;
          }
          if (next.length >= 3)
            throw Error('사진은 최대 3장까지 첨부할 수 있습니다.');
          if (
            next.reduce((sum, item) => sum + item.byteLength, 0) +
              image.byteLength >
            8000000
          )
            throw Error(
              '사진 원본 전체 크기는 8,000,000바이트 이하여야 합니다.',
            );
          if (
            next.reduce((sum, item) => sum + item.pixelCount, 0) +
              image.pixelCount >
            16000000
          )
            throw Error('사진당 1,300만 / 합계 1,600만 픽셀 이하여야 합니다.');
          next.push(image);
        } catch (error) {
          errors.push(
            error instanceof Error ? error.message : '사진을 읽지 못했습니다.',
          );
        }
      }
      if (generation !== imageGeneration.current || !mounted.current) return;
      imagesRef.current = next;
      setImages(next);
      setPrivacyConfirmed(false);
      draftVersion.current++;
      setFeedback([...new Set(errors)].join(' '));
    } finally {
      reading.current = false;
      if (mounted.current) setReadingImages(false);
    }
  }
  const [targetWorkId, setTargetWorkId] = useState<string | null>(null);
  const [referenceDate, setReferenceDate] = useState('');
  const [data, setData] = useState<MailManualList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [progress, setProgress] = useState('');
  const mounted = useRef(false);
  const locked = useRef(false);
  const request = useRef(0);
  const draftVersion = useRef(0);
  const submission = useRef<{
    key: string;
    id: string;
    retry?: boolean;
    entryId?: string;
  } | null>(null);
  useEffect(() => {
    setTargetWorkId(initialDraft?.targetWorkId ?? null);
    if (!initialDraft) return;
    imageGeneration.current++;
    imagesRef.current = [];
    setImages([]);
    setPrivacyConfirmed(false);
    setText(initialDraft.text);
    setReferenceDate('');
    submission.current = null;
    draftVersion.current++;
  }, [initialDraft?.id]);
  const autoSubmitted = useRef<string | null>(null);
  useEffect(() => {
    if (
      !inputOpen ||
      !initialDraft?.autoSubmit ||
      autoSubmitted.current === initialDraft.id ||
      text !== initialDraft.text ||
      targetWorkId !== (initialDraft.targetWorkId ?? null) ||
      disabled ||
      busy
    )
      return;
    autoSubmitted.current = initialDraft.id;
    void add();
  }, [inputOpen, initialDraft?.id, text, targetWorkId, disabled, busy]);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const result = await privateMail.manualList(day);
      if (!mounted.current || id !== request.current) return false;
      setData(result);
      return true;
    } catch (error) {
      if (mounted.current && id === request.current)
        setFeedback(failure(error));
      return false;
    } finally {
      if (mounted.current && id === request.current) setLoading(false);
    }
  }, [day]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [load, refreshKey]);
  const hasPending = data?.entries.some((entry) =>
    ['pending', 'processing'].includes(entry.status),
  );
  useEffect(() => {
    if (!hasPending) return;
    let stopped = false;
    const timer = setInterval(() => {
      if (!stopped)
        void load().then((ok) => {
          if (ok && !stopped) onChanged?.();
        });
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [hasPending, load, onChanged]);
  useEffect(() => {
    if (inputOpen) setFeedback('');
  }, [inputOpen]);
  async function act(action: () => Promise<void>) {
    if (locked.current || disabled) return;
    locked.current = true;
    setBusy(true);
    onBusyChange(true);
    setFeedback('');
    try {
      await action();
    } catch (error) {
      if (mounted.current) {
        setFeedback(failure(error));
        setProgress(
          '요청 결과를 확인하지 못했습니다. 입력과 접수 번호를 유지합니다.',
        );
      }
    } finally {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  async function retryEntry(entry: MailManualEntry) {
    await act(async () => {
      const source = await privateMail.manualSource(entry.entryId);
      const result = await privateMail.manualEnqueue({
        text: source.text,
        clientRequestId: source.clientRequestId,
        referenceDate: source.requestedReference,
        targetWorkId: source.targetWorkId,
        retry: true,
        privacyConfirmed: source.privacyConfirmed,
      });
      if (!mounted.current) return;
      await load();
      setFeedback(
        result.status === 'ready'
          ? '기존 메시지를 정리했습니다. 접수일과 원문은 유지됩니다.'
          : ['pending', 'processing'].includes(result.status)
            ? '기존 메시지를 분석 중입니다. 목록 새로고침으로 확인해 주세요.'
            : '기존 메시지를 정리하지 못했습니다. 접수된 원문을 유지합니다.',
      );
      onChanged?.();
    });
  }
  async function add() {
    const input = text.trim(),
      basis = referenceDate || null;
    if (
      locked.current ||
      reading.current ||
      disabled ||
      (!input && !images.length) ||
      input.length > 12000 ||
      (images.length > 0 && !privacyConfirmed) ||
      (basis && !validDay(basis))
    )
      return;
    const key = JSON.stringify({
      text: input,
      referenceDate: basis,
      targetWorkId,
      images: images.map((image) => image.hash),
      privacyConfirmed,
    });
    if (submission.current?.key !== key)
      submission.current = { key, id: crypto.randomUUID() };
    const clientRequestId = submission.current.id,
      retry = submission.current.retry === true,
      version = draftVersion.current;
    await act(async () => {
      setProgress('메시지를 접수하는 중입니다. 아직 분석 완료가 아닙니다.');
      const result =
        submission.current?.entryId && !retry
          ? (await privateMail.manualStatus(submission.current.entryId)).entry
          : await privateMail.manualEnqueue({
              text: input,
              clientRequestId,
              referenceDate: basis,
              targetWorkId,
              retry,
              images: images.map(({ name, data }) => ({ name, data })),
              privacyConfirmed,
            });
      if (!mounted.current) return;
      if (submission.current?.id === clientRequestId) {
        submission.current.entryId = result.entryId;
        submission.current.retry = result.status === 'failed';
      }
      const deadline = Date.now() + 180000;
      let status;
      while (mounted.current && draftVersion.current === version) {
        status = await privateMail.manualStatus(result.entryId);
        if (!mounted.current || draftVersion.current !== version) return;
        const entry = status.entry;
        if (entry.status === 'failed') {
          if (submission.current?.id === clientRequestId)
            submission.current.retry = true;
          setProgress('분석 실패 · 원문과 사진은 유지됩니다.');
          setFeedback(failure({ code: entry.error }));
          await load();
          onChanged?.();
          return;
        }
        if (entry.status === 'ready' && entry.needsConfirmation) {
          setProgress('분석 결과 확인 필요 · 자동으로 닫지 않습니다.');
          setFeedback(
            '날짜·대상·업무 내용을 목록에서 확인해 주세요. 접수된 결과는 유지됩니다.',
          );
          await load();
          onChanged?.();
          return;
        }
        if (
          entry.status === 'ready' &&
          ['complete', 'not_needed'].includes(status.report.status)
        )
          break;
        if (entry.status === 'ready' && status.report.status === 'failed') {
          setProgress('분석 완료 · OneNote 자동 저장 확인 필요');
          setFeedback(
            'OneNote 저장 상태: ' +
              (status.report.error || '확인 필요') +
              '. 메시지를 다시 제출하지 말고 상태를 다시 확인해 주세요.',
          );
          await load();
          onChanged?.();
          return;
        }
        setProgress(
          entry.status === 'pending'
            ? '접수 완료 · 분석 대기 중'
            : entry.status === 'processing'
              ? '분석 처리 중 · JEV 판단·API 분석의 개별 호출 단계는 서버에서 제공하지 않습니다.'
              : '분석 완료 · OneNote 자동 저장을 확인하는 중',
        );
        if (Date.now() >= deadline) {
          setProgress('처리 확인 시간 초과 · 서버 처리는 계속될 수 있습니다.');
          setFeedback(
            '입력과 접수 번호를 유지합니다. 상태 다시 확인을 눌러 기존 접수건을 조회해 주세요.',
          );
          await load();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      if (!mounted.current || draftVersion.current !== version || !status)
        return;
      submission.current = null;
      if (draftVersion.current === version) {
        setText('');
        imageGeneration.current++;
        imagesRef.current = [];
        setImages([]);
        setPrivacyConfirmed(false);
        setReferenceDate('');
      }
      onInputClose?.();
      setProgress('');
      setFeedback(
        status.report.status === 'not_needed'
          ? '분석을 마쳤습니다. 일일정리에 추가할 업무가 없습니다.'
          : '분석과 OneNote 자동 저장을 완료했습니다.',
      );
      await load();
      onChanged?.();
    });
  }
  async function complete(entryId: string, itemId: string, done: boolean) {
    await act(async () => {
      await privateMail.manualUpdate({ entryId, itemId, done });
      if (!mounted.current) return;
      const refreshed = await load();
      if (mounted.current)
        setFeedback(
          refreshed
            ? done
              ? '완료를 저장했습니다. 완료 기록에서 확인할 수 있습니다.'
              : '미완료로 되돌렸습니다. 미완료 목록에 계속 표시됩니다.'
            : '완료 상태는 저장했지만 목록을 갱신하지 못했습니다. 목록을 새로고침해 주세요.',
        );
    });
  }
  const entries = data?.day === day ? data.entries : [];
  const items = entries.flatMap((entry) =>
    entry.items.map((item) => ({ entry, item })),
  );
  const open = items.filter(({ item }) => !item.done),
    completed = items.filter(({ item }) => item.done);
  function row(entry: MailManualEntry, item: MailManualItem) {
    return (
      <li key={`${entry.entryId}:${item.itemId}`}>
        <div className="daily-item-heading">
          <label className="daily-task-check">
            <input
              type="checkbox"
              aria-label={`${item.text} 메시지 업무 완료`}
              checked={item.done}
              disabled={busy || disabled || loading}
              onChange={(event) =>
                void complete(entry.entryId, item.itemId, event.target.checked)
              }
            />
            <span>{item.text}</span>
          </label>
          <span className="daily-item-status">
            {item.kind === 'dispatch'
              ? '배차 요청'
              : item.kind === 'issue'
                ? '이슈'
                : '할 일'}
            {item.needsConfirmation ? ' · 확인 필요' : ''}
          </span>
        </div>
        <p className="daily-task-meta">
          담당: {item.assignee || '미지정'} · 처리기한:{' '}
          {item.dueAt
            ? formatBriefingTimestamp(item.dueAt)
            : item.dueDate || item.dueOriginal || '미지정'}
          {!item.dueAt && !item.dueDate && item.dueOriginal
            ? ' (날짜 확인 필요)'
            : ''}{' '}
          · {item.kind === 'dispatch' ? '운행 대상일' : '업무 대상일'}:{' '}
          {item.serviceDate || item.serviceOriginal || '미지정'}
          {!item.serviceDate && item.serviceOriginal ? ' (날짜 확인 필요)' : ''}
        </p>
        <p className="daily-task-meta">
          접수: {formatBriefingTimestamp(item.receivedAt || entry.submittedAt)}
          {!item.done && item.visibleFrom < day ? ' · 미완료 이월' : ''}
          {item.done
            ? ` · 완료: ${formatBriefingTimestamp(item.completedAt)}`
            : ''}
        </p>
        {entry.images?.length ? (
          <StoredManualPhotos entryId={entry.entryId} images={entry.images} />
        ) : null}
        <details className="manual-basis">
          <summary>날짜 해석 기준</summary>
          <p>
            기준일: {entry.referenceDate || '접수 시각의 한국 날짜'} ·{' '}
            {entry.referenceSource === 'owner' ? '직접 지정' : '접수 시각 기준'}
          </p>
          <p>
            원문 작성일: {entry.authoredDate || '확인되지 않음'}
            {entry.needsConfirmation || item.needsConfirmation
              ? ' · 날짜나 내용을 확인해 주세요.'
              : ''}
          </p>
        </details>
      </li>
    );
  }
  return (
    <section className="daily-manual" aria-label="메시지로 추가한 업무">
      {inputOpen ? (
        <Modal
          label="메시지 입력"
          onClose={() => onInputClose?.()}
          dismissable={!busy}
          width="xl"
        >
          <div
            className="daily-message-dialog"
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === 'file')
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (files.length) {
                if (!event.clipboardData.getData('text/plain'))
                  event.preventDefault();
                void attach(files);
              }
            }}
          >
            <div className="daily-dialog-heading">
              <h2>메시지 입력</h2>
              <ModalClose className="btn btn-ghost" disabled={busy}>
                닫기
              </ModalClose>
            </div>
            {targetWorkId && (
              <p className="daily-task-meta">
                선택한 업무에 반영합니다. 대상이 다른 내용은 확인이 필요합니다.
              </p>
            )}
            <label className="manual-message-label" htmlFor="manual-message">
              카톡 메시지·직접 입력
              <textarea
                id="manual-message"
                aria-label="카톡 메시지·직접 입력"
                className="app-input"
                rows={4}
                maxLength={12000}
                disabled={busy}
                value={text}
                onChange={(event) => {
                  draftVersion.current++;
                  setText(event.target.value);
                }}
              />
            </label>
            <label htmlFor="manual-images">
              사진 첨부 또는 붙여넣기
              <input
                id="manual-images"
                type="file"
                accept="image/jpeg,image/png"
                multiple
                disabled={busy || disabled || readingImages}
                onChange={(event) => {
                  void attach(Array.from(event.target.files || []));
                  event.target.value = '';
                }}
              />
            </label>
            <p className="daily-task-meta">
              JPEG·PNG 원본 최대 3장 · 장당 6,000,000바이트 · 합계
              8,000,000바이트 · 가로·세로 각각 8,000픽셀 및 사진당 1,300만 /
              합계 1,600만 픽셀 이하. 원본을 보관하며 서버에서 분석용 사진을
              최적화합니다. OneNote 호환을 위해 WebP는 지원하지 않습니다.
            </p>
            {readingImages && <p role="status">사진을 확인하는 중…</p>}
            {images.length > 0 && (
              <>
                <ul
                  aria-label="첨부 사진"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 16,
                    padding: 0,
                    listStyle: 'none',
                  }}
                >
                  {images.map((image) => (
                    <li key={image.hash} style={{ maxWidth: 180 }}>
                      <img
                        src={image.preview}
                        alt={image.name}
                        width={160}
                        height={100}
                        style={{ objectFit: 'contain', maxWidth: '100%' }}
                      />
                      <p style={{ overflowWrap: 'anywhere' }}>{image.name}</p>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy || readingImages}
                        aria-label={`${image.name} 사진 삭제`}
                        onClick={() => {
                          const next = imagesRef.current.filter(
                            (item) => item.hash !== image.hash,
                          );
                          imagesRef.current = next;
                          setImages(next);
                          setPrivacyConfirmed(false);
                          draftVersion.current++;
                        }}
                      >
                        삭제
                      </button>
                    </li>
                  ))}
                </ul>
                <label className="daily-task-check">
                  <input
                    type="checkbox"
                    checked={privacyConfirmed}
                    disabled={busy || readingImages}
                    onChange={(event) => {
                      setPrivacyConfirmed(event.target.checked);
                      draftVersion.current++;
                    }}
                  />
                  <span>
                    사진이 외부 AI 분석 및 OneNote로 전송되는 데 동의합니다.
                    신분증·비밀번호 사진이 없는지 확인했습니다.
                  </span>
                </label>
              </>
            )}
            <div className="daily-filter-actions">
              <label className="manual-reference" htmlFor="manual-reference">
                메시지 기준일 (선택)
                <input
                  id="manual-reference"
                  className="app-input"
                  type="date"
                  disabled={busy}
                  value={referenceDate}
                  onChange={(event) => {
                    draftVersion.current++;
                    setReferenceDate(event.target.value);
                  }}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy ||
                  disabled ||
                  readingImages ||
                  (!text.trim() && images.length === 0) ||
                  (images.length > 0 && !privacyConfirmed) ||
                  text.trim().length > 12000 ||
                  (Boolean(referenceDate) && !validDay(referenceDate))
                }
                onClick={() => void add()}
              >
                {busy
                  ? '처리 확인 중…'
                  : submission.current?.entryId && !submission.current.retry
                    ? '상태 다시 확인'
                    : '저장'}
              </button>
              <ModalClose className="btn btn-ghost" disabled={busy}>
                취소
              </ModalClose>
            </div>
            <p className="daily-task-meta">
              분석과 필요한 OneNote 저장을 확인하면 자동으로 닫힙니다. 확인
              필요·오류·시간 초과 시 입력을 유지합니다.
            </p>
            {progress && (
              <p role="status" aria-live="polite" aria-atomic="true">
                {progress}
              </p>
            )}
            {feedback ? <p role="alert">{feedback}</p> : null}
          </div>
        </Modal>
      ) : null}
      <p className="daily-feedback" role="status" aria-live="polite">
        {busy
          ? '메시지와 완료 상태를 저장하는 중…'
          : loading
            ? '메시지 업무를 불러오는 중…'
            : feedback}
      </p>
      <div aria-busy={loading} aria-label="접수 메시지 처리 상태">
        {entries
          .filter((entry) => entry.status !== 'ready')
          .map((entry) => (
            <div className="daily-task-meta" key={entry.entryId}>
              <p>
                {formatBriefingTimestamp(entry.submittedAt)} 접수 ·{' '}
                {['pending', 'processing'].includes(entry.status)
                  ? '정리 중'
                  : '분석 실패 · 원문이 보존되어 있습니다.'}
              </p>
              {entry.images?.length ? (
                <StoredManualPhotos
                  entryId={entry.entryId}
                  images={entry.images}
                />
              ) : null}
              {entry.status === 'failed' ? (
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={busy || disabled}
                  onClick={() => void retryEntry(entry)}
                >
                  기존 메시지 다시 정리
                </button>
              ) : null}
            </div>
          ))}
      </div>
      {showItems ? (
        <div aria-busy={loading}>
          <h3>
            미완료 <span className="daily-count">{open.length}</span>
          </h3>
          {open.length ? (
            <ul className="daily-items manual-open">
              {open.map(({ entry, item }) => row(entry, item))}
            </ul>
          ) : !loading ? (
            <p className="daily-empty">미완료 메시지 업무가 없습니다.</p>
          ) : null}
          <details className="manual-completed">
            <summary>완료 기록 {completed.length}건</summary>
            {completed.length ? (
              <ul className="daily-items">
                {completed.map(({ entry, item }) => row(entry, item))}
              </ul>
            ) : (
              <p className="daily-empty">이 날짜의 완료 기록이 없습니다.</p>
            )}
          </details>
        </div>
      ) : null}
    </section>
  );
}
