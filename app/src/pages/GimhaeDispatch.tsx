import { DialogFrame } from '../components/DialogFrame';
import { permissionAllowed } from '../lib/permissions';
import { useEffect, useRef, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { FileArea } from '../components/FileArea';
import { useFeedback } from '../components/useFeedback';
import {
  isPrivateFeatureOwner,
  loadPrivateFeatures,
} from '../lib/private-features';
import { analyze, imageData } from '../lib/gimhae';
import {
  REGIONS,
  newDraft,
  normalizeDraft,
  carrierFor,
  dockNumber,
  reconcileDocks,
  importRequest,
  applyReply,
  messages,
  issues,
  filledTruck,
  validDate,
  defaultDate,
} from '../domain/gimhae';
import type { DispatchDraft } from '../domain/gimhae';
import type { HaulComparison } from '../domain/gimhae-haul';
import '../styles/gimhae-dispatch.css';

interface View {
  draft: DispatchDraft;
  dirty: boolean;
  busy: boolean;
  previous: { draft: DispatchDraft; dirty: boolean } | null;
  photoError: string;
  replyChanged: boolean;
  lastReply: string;
  replyState: string;
  copied: Record<string, string>;
  status: string;
  statusError: boolean;
}
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
function Work() {
  const { center, profile, permissions, setCenterChangeGuard } = useAdminPage();
  const editable = permissionAllowed(permissions, 'gimhae_dispatch', 'edit');
  const { confirm, feedback } = useFeedback();
  const [view, setView] = useState<View>(() => ({
    draft: newDraft(),
    dirty: false,
    busy: false,
    previous: null,
    photoError: '',
    replyChanged: false,
    lastReply: '',
    replyState: '',
    copied: {},
    status: '',
    statusError: false,
  }));
  const current = useRef(view);
  const file = useRef<HTMLInputElement>(null),
    photo = useRef<HTMLImageElement>(null),
    reply = useRef<HTMLTextAreaElement>(null);
  const [trucksOpen, setTrucksOpen] = useState(false);
  const previewDialog = useRef<HTMLDialogElement>(null),
    messageAreas = useRef(new Map<string, HTMLTextAreaElement>());
  const [preview, setPreview] = useState<{
      title: string;
      text?: string;
      image?: string;
    } | null>(null),
    [haul, setHaul] = useState<HaulComparison[]>([]),
    [haulError, setHaulError] = useState(false);
  const prices = useRef(
    isPrivateFeatureOwner(profile) && loadPrivateFeatures(profile).haulPrices,
  ).current;
  function update(change: (next: View) => void) {
    const next = {
      ...current.current,
      draft: structuredClone(current.current.draft),
      copied: { ...current.current.copied },
    };
    change(next);
    current.current = next;
    setView(next);
  }
  function status(text: string, error = false) {
    update((s) => {
      s.status = text;
      s.statusError = error;
    });
  }
  async function run(action: () => void | Promise<void>, edit = false) {
    if (current.current.busy || (edit && !editable)) return;
    update((s) => {
      s.busy = true;
    });
    try {
      await action();
    } catch (error) {
      status(messageOf(error), true);
    } finally {
      update((s) => {
        s.busy = false;
      });
    }
  }
  useEffect(() => {
    setCenterChangeGuard(
      async () =>
        !current.current.busy &&
        (!current.current.dirty ||
          (await confirm('현재 요청과 회신을 닫고 센터를 전환할까요?', {
            okText: '전환',
          }))),
    );
    return () => setCenterChangeGuard(null);
  }, [setCenterChangeGuard]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (current.current.busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    addEventListener('beforeunload', guard);
    return () => removeEventListener('beforeunload', guard);
  }, []);
  useEffect(() => {
    if (preview && !previewDialog.current?.open)
      previewDialog.current?.showModal();
    if (!preview && previewDialog.current?.open) previewDialog.current.close();
  }, [preview]);
  const d = view.draft,
    ready = !d.requestPending && d.requests.length > 0;
  const haulKey = ready
    ? JSON.stringify({ volumes: d.volumes, requests: d.requests })
    : '';
  useEffect(() => {
    setHaul([]);
    setHaulError(false);
    if (!haulKey) return;
    let active = true,
      worker: Worker | undefined;
    const unavailable = () => {
      if (active) {
        setHaulError(true);
        worker?.terminate();
      }
    };
    const timer = setTimeout(unavailable, 5000);
    try {
      worker = new Worker(
        new URL('../domain/gimhae-haul-worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onerror = unavailable;
      worker.onmessage = ({ data }) => {
        if (!active) return;
        clearTimeout(timer);
        worker?.terminate();
        if (!Array.isArray(data?.results)) return unavailable();
        setHaul(
          data.results.filter((row: HaulComparison) => row.status !== 'same'),
        );
      };
      worker.postMessage(JSON.parse(haulKey));
    } catch {
      unavailable();
    }
    return () => {
      active = false;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [haulKey]);
  const editDisabled = view.busy || !editable,
    total = d.requests.reduce((n, r) => n + r.count, 0),
    filled = d.trucks.filter((t) =>
      [t.driver, t.vehicle, t.phone].every((v) => v?.trim()),
    ).length,
    hasAssignment = d.trucks.some((t) =>
      [t.driver, t.vehicle, t.phone].some((v) => v?.trim()),
    );
  const requestIssues = ready
      ? [...new Set(issues(d))].slice(0, 4).join(' / ')
      : '',
    completeIssues =
      ready && (hasAssignment || d.replyPending)
        ? [...new Set(issues(d, true))].slice(0, 4).join(' / ')
        : '';
  function touch(change: (draft: DispatchDraft) => void) {
    if (editDisabled) return;
    update((s) => {
      change(s.draft);
      s.dirty = true;
    });
  }
  function resetTransient(s: View) {
    s.previous = null;
    s.photoError = '';
    s.replyChanged = false;
    s.lastReply = '';
    s.replyState = '';
    s.copied = {};
  }
  async function analyzePhoto() {
    update((s) => {
      s.photoError = '';
      s.draft.requestPending = true;
    });
    status('CJ 요청 사진 분석 중…');
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await photo.current?.decode();
      const result = await analyze(
          center.code,
          current.current.draft,
          'request',
        ),
        next = importRequest(current.current.draft, result);
      update((s) => {
        s.draft = next;
        s.replyChanged = false;
        s.lastReply = '';
        s.replyState = '';
        s.copied = {};
        s.dirty = true;
      });
      const errors = issues({ ...next, fixedDrivers: [] });
      if (errors.length)
        update((s) => {
          s.photoError = '사진 인식 결과 확인 필요';
        });
      status(
        errors.length
          ? '사진 인식 결과가 불완전합니다. 다시 분석해 주세요.'
          : validDate(result.date)
            ? '사진 분석을 완료했습니다.'
            : '사진에서 날짜를 읽지 못했습니다. 기준날짜를 확인해 주세요.',
        !!errors.length || !validDate(result.date),
      );
    } catch (error) {
      update((s) => {
        s.photoError = messageOf(error);
      });
      throw error;
    }
  }
  function importPhoto(selected: File) {
    void run(async () => {
      const data = await imageData(selected),
        s = current.current;
      if (
        data === s.draft.image &&
        !s.draft.requestPending &&
        s.draft.requests.length &&
        !s.photoError &&
        !issues({ ...s.draft, fixedDrivers: [] }).length
      ) {
        status('같은 사진의 분석 결과입니다.');
        return;
      }
      update((next) => {
        if (
          !next.draft.requestPending &&
          (next.draft.image || next.draft.requests.length)
        )
          next.previous = {
            draft: structuredClone(next.draft),
            dirty: next.dirty,
          };
        next.draft.image = data;
        next.draft.imageName = selected.name || '붙여넣은 사진';
        next.draft.requestPending = true;
        next.dirty = true;
      });
      await analyzePhoto();
    }, true);
  }
  function undo() {
    void run(() => {
      const previous = current.current.previous;
      if (!previous) return;
      update((s) => {
        s.draft = structuredClone(previous.draft);
        s.dirty = previous.dirty;
        resetTransient(s);
        if (s.draft.requestPending)
          s.photoError = '현재 사진의 분석이 완료되지 않았습니다.';
        else if (
          s.draft.image &&
          issues({ ...s.draft, fixedDrivers: [] }).length
        )
          s.photoError = '사진 인식 결과 확인 필요';
        if (s.draft.replyPending) {
          s.replyChanged = true;
          s.replyState = '현재 회신의 분석이 완료되지 않았습니다.';
        }
      });
      status('이전 요청을 복원했습니다.');
    }, true);
  }
  function changeReply(value: string) {
    if (editDisabled || !ready) return;
    update((s) => {
      s.draft.replyText = value;
      s.draft.replyPending = true;
      s.replyChanged = true;
      s.replyState = value.trim() ? '분석 전' : '';
      s.dirty = true;
    });
  }
  const [replyRegion, setReplyRegion] = useState('');
  async function analyzeReply() {
    const s = current.current;
    if (s.draft.requestPending || !s.draft.requests.length)
      throw Error('CJ 요청 사진을 먼저 선택하거나 붙여넣어 주세요.');
    const signature = s.draft.replyText + '|' + replyRegion;
    if (signature === s.lastReply && !s.replyChanged && !s.draft.replyPending) {
      status('이미 반영된 회신입니다.');
      return;
    }
    update((s) => {
      s.draft.replyPending = true;
      s.replyState = '회신 분석 중…';
    });
    try {
      const result = await analyze(center.code, current.current.draft, 'reply');
      if (replyRegion && Array.isArray(result.trucks))
        for (const truck of result.trucks)
          if (!truck.region) truck.region = replyRegion;
      const next = normalizeDraft(
        applyReply(structuredClone(current.current.draft), result),
      );
      next.replyPending = false;
      update((s) => {
        s.draft = next;
        s.lastReply = signature;
        s.replyChanged = false;
        s.dirty = true;
        s.replyState = '반영 완료';
      });
      status('운수사 회신을 반영했습니다.');
      if (next.trucks.some((t) => !t.requestId)) setTrucksOpen(true);
    } catch (error) {
      update((s) => {
        s.replyState = messageOf(error);
      });
      throw error;
    }
  }
  type TruckField =
    | 'requestId'
    | 'dock'
    | 'driver'
    | 'vehicle'
    | 'phone'
    | 'arrival'
    | 'loadText';
  function truckInput(id: string, field: TruckField, value: string) {
    touch((draft) => {
      const row = draft.trucks.find((t) => t.id === id);
      if (!row) return;
      if (
        ['driver', 'vehicle', 'requestId'].includes(field) &&
        row[field] !== value
      ) {
        row.fixedDriverId = '';
        row.fixedConfirmed = false;
      }
      row[field] = value;
      if (
        row.fixedDriverId &&
        ['phone', 'arrival', 'loadText', 'dock'].includes(field)
      )
        row.fixedConfirmed = true;
      if (field === 'requestId') {
        row.region =
          draft.requests.find((r) => r.id === value)?.region || row.region;
        reconcileDocks(draft);
      }
    });
  }
  function dockCommit(id: string) {
    if (editDisabled) return;
    update((s) => {
      const row = s.draft.trucks.find((t) => t.id === id);
      if (!row) return;
      row.dock = dockNumber(row.dock);
      row.dockManual = true;
      const f = s.draft.fixedDrivers.find((f) => f.id === row.fixedDriverId);
      if (f) f.dock = row.dock;
    });
  }
  function moveTruck(id: string, delta?: number) {
    void run(async () => {
      const index = current.current.draft.trucks.findIndex((t) => t.id === id);
      if (index < 0) return;
      if (
        delta === undefined &&
        filledTruck(current.current.draft.trucks[index]) &&
        !(await confirm('이 차량의 배차정보를 삭제할까요?', { okText: '삭제' }))
      )
        return;
      update((s) => {
        const rows = s.draft.trucks;
        if (delta === undefined) rows.splice(index, 1);
        else {
          const target = index + delta;
          if (target < 0 || target >= rows.length) return;
          [rows[index], rows[target]] = [rows[target], rows[index]];
        }
        reconcileDocks(s.draft);
        s.dirty = true;
      });
    }, true);
  }
  function copyMessage(message: ReturnType<typeof messages>[number]) {
    void run(async () => {
      const errors = issues(
        current.current.draft,
        ['cj', 'summary'].includes(message.key),
      );
      if (errors.length) throw Error(errors[0]);
      try {
        await navigator.clipboard.writeText(message.text);
      } catch {
        messageAreas.current.get(message.key)?.focus();
        messageAreas.current.get(message.key)?.select();
        status('클립보드 접근이 제한되어 문구를 선택했습니다.', true);
        return;
      }
      update((s) => {
        s.copied[message.key] = message.text;
      });
      status(message.title + ' 문구를 복사했습니다.');
    });
  }
  const outputs = ready ? messages(d) : [];
  function messageCard(message: ReturnType<typeof messages>[number]) {
    const article = (
      <article key={message.key} className="gm-message">
        <div className="gm-section-head">
          <h3>{message.title}</h3>
          <button
            className="btn btn-primary"
            data-copy={message.key}
            aria-label={`${message.title} 복사`}
            disabled={
              view.busy ||
              issues(d, ['cj', 'summary'].includes(message.key)).length > 0
            }
            onClick={() => copyMessage(message)}
          >
            복사
          </button>
        </div>
        <textarea
          ref={(element) => {
            if (element) messageAreas.current.set(message.key, element);
            else messageAreas.current.delete(message.key);
          }}
          rows={Math.min(15, Math.max(4, message.text.split('\n').length))}
          readOnly
          aria-label={message.title}
          value={message.text}
          disabled={view.busy}
        />
        <div className="gm-message-footer">
          <span className="gm-message-status">
            {view.copied[message.key] === message.text
              ? '복사됨'
              : view.copied[message.key]
                ? '복사 후 변경됨'
                : ''}
          </span>
          <button
            className="btn btn-ghost"
            data-preview={message.key}
            aria-label={`${message.title} 전문 보기`}
            disabled={view.busy}
            onClick={() =>
              setPreview({ title: message.title, text: message.text })
            }
          >
            전문 보기
          </button>
        </div>
      </article>
    );
    return message.key === 'summary' ? (
      <details key={message.key} className="gm-settings">
        <summary>차량 운영 현황</summary>
        {article}
      </details>
    ) : (
      article
    );
  }
  const volumes = ready
    ? d.volumes.filter((v) => d.requests.some((r) => r.region === v.region))
    : [];
  const truckFields: [TruckField, string, number][] = [
    ['dock', '도크 번호', 20],
    ['driver', '기사명', 80],
    ['vehicle', '차량번호', 40],
    ['phone', '기사 연락처', 40],
    ['arrival', '입차시간 조건', 80],
  ];
  return (
    <main id="gm-app" className="app-main" tabIndex={-1}>
      <div id="gm-work" aria-busy={view.busy}>
        <div className="gm-toolbar gm-topbar">
          <label>
            기준날짜
            <input
              id="gm-date"
              type="date"
              required
              disabled={editDisabled}
              value={d.date}
              onChange={(event) => {
                const date = event.target.value;
                if (!validDate(date)) return;
                update((s) => {
                  if (s.draft.date !== date) {
                    s.lastReply = '';
                  }
                  s.draft.date = date;
                  s.dirty = true;
                });
              }}
            />
          </label>
          <button
            id="gm-new"
            className="btn btn-ghost"
            disabled={editDisabled}
            onClick={() =>
              void run(async () => {
                if (
                  current.current.dirty &&
                  !(await confirm(
                    '현재 요청과 회신을 비우고 새 작업을 시작할까요?',
                    { okText: '새 작업' },
                  ))
                )
                  return;
                update((s) => {
                  s.draft = newDraft(defaultDate());
                  s.dirty = false;
                  resetTransient(s);
                });
                status('새 작업입니다.');
              }, true)
            }
          >
            새 작업
          </button>
          <span id="gm-center" className="gm-muted">
            {center.name} · 김해 출발 배차{editable ? '' : ' · 열람 전용'}
          </span>
        </div>
        <div className="gm-flow">
          <section
            className="gm-stage gm-source-band"
            aria-labelledby="gm-source-title"
          >
            <div className="gm-source">
              <div className="gm-section-head">
                <h3 id="gm-source-title">CJ 요청</h3>
                <button
                  id="gm-undo"
                  className="btn btn-ghost gm-icon"
                  aria-label="이전 요청 복원"
                  title="이전 요청 복원"
                  hidden={!view.previous}
                  disabled={editDisabled}
                  onClick={undo}
                >
                  ↶
                </button>
              </div>
              <FileArea
                id="gm-paste"
                className="gm-paste"
                hint={false}
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                disabled={editDisabled}
                role="region"
                aria-label="CJ 요청 사진 붙여넣기"
                aria-disabled={editDisabled}
                title="JPG·PNG·WEBP, 최대 15MB"
                onFiles={(files) => {
                  if (files[0]) importPhoto(files[0]);
                }}
              >
                <span id="gm-image-empty" hidden={!!d.image}>
                  클릭 후 Ctrl+V · 사진 끌어놓기
                </span>
                <img
                  ref={photo}
                  id="gm-image"
                  src={d.image || undefined}
                  alt="CJ 요청 원본"
                  hidden={!d.image}
                />
              </FileArea>
              <button
                type="button"
                id="gm-select-photo"
                className="btn btn-ghost"
                disabled={editDisabled}
                onClick={() => file.current?.click()}
              >
                사진 파일 선택
              </button>
              <input
                ref={file}
                id="gm-photo-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                aria-label="CJ 요청 사진 파일"
                hidden
                disabled={editDisabled}
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  event.target.value = '';
                  if (selected) importPhoto(selected);
                }}
              />
              <div className="gm-analysis-state">
                <span
                  id="gm-photo-state"
                  role="status"
                  data-error={!!view.photoError}
                >
                  {view.photoError ||
                    (d.requestPending
                      ? '사진 분석 중…'
                      : d.image && d.requests.length
                        ? '분석 완료'
                        : '')}
                </span>
                <button
                  id="gm-view-photo"
                  className="btn btn-ghost"
                  hidden={!d.image}
                  disabled={view.busy}
                  onClick={() =>
                    setPreview({ title: 'CJ 요청 원본', image: d.image })
                  }
                >
                  원본 보기
                </button>
                <button
                  id="gm-retry-photo"
                  className="btn btn-ghost"
                  hidden={!d.image || !view.photoError}
                  disabled={editDisabled}
                  onClick={() =>
                    void run(async () => {
                      if (
                        hasAssignment &&
                        !(await confirm(
                          '요청표를 다시 분석하면 현재 배차 연결을 다시 구성합니다. 계속할까요?',
                          { okText: '다시 분석' },
                        ))
                      )
                        return;
                      update((s) => {
                        s.previous = {
                          draft: structuredClone(s.draft),
                          dirty: s.dirty,
                        };
                      });
                      await analyzePhoto();
                    }, true)
                  }
                >
                  {view.photoError ? '다시 시도' : '선택한 API로 다시 분석'}
                </button>
              </div>
            </div>
            <div className="gm-request-summary">
              <p id="gm-count" className="gm-muted">
                {d.requestPending
                  ? '분석 대기'
                  : `요청 ${total}대 · 배차 ${filled}대`}
              </p>
              <div id="gm-summary">
                {volumes.map((v) => {
                  const requests = d.requests.filter(
                    (r) => r.region === v.region,
                  );
                  return (
                    <div key={v.region} className="gm-region">
                      <div className="gm-region-head">
                        <strong>{v.region}</strong>
                        <span>
                          {[
                            ...new Set(
                              requests.map(
                                (r) =>
                                  r.carrier || carrierFor(r.region, d.date),
                              ),
                            ),
                          ].join(' · ')}
                        </span>
                      </div>
                      <div className="gm-volume">
                        냉동 <b>{v.frozen ?? '-'}</b> · 냉장{' '}
                        <b>{v.chilled ?? '-'}</b>
                        <span>
                          합계{' '}
                          {v.frozen != null && v.chilled != null
                            ? v.frozen + v.chilled
                            : '-'}
                          p
                        </span>
                      </div>
                      {requests.map((r) => (
                        <div key={r.id} className="gm-request-line">
                          {r.temperature || '온도 미정'}{' '}
                          <strong>
                            {r.tons ?? '?'}톤 {r.count}대
                          </strong>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              <p
                id="gm-request-empty"
                className="gm-empty"
                hidden={!!volumes.length}
              >
                {d.requestPending ? '사진 분석 대기' : 'CJ 요청 대기'}
              </p>
              <div
                id="gm-haul"
                role="status"
                aria-live="polite"
                hidden={!haulError && !haul.length}
              >
                {haulError
                  ? '하불 비교를 완료하지 못했습니다. CJ 요청은 유지됩니다.'
                  : haul.map((row, i) =>
                      row.status === 'different' ? (
                        <p key={i} title={`김해→${row.destination}`}>
                          <strong>{row.region} · 최저가 조합과 다름</strong>
                          <span>
                            요청 {row.requestedLabel} / 최저가 {row.bestLabel}
                          </span>
                          {prices ? (
                            <span>
                              요청{' '}
                              {Number(row.requestedCost).toLocaleString(
                                'ko-KR',
                              )}
                              원 / 최저가{' '}
                              {Number(row.bestCost).toLocaleString('ko-KR')}원
                            </span>
                          ) : null}
                          <small>기존 하불단가·표준 적재 기준</small>
                        </p>
                      ) : (
                        <p key={i}>
                          <strong>{row.region} · 하불 비교 보류</strong>
                          <span>{row.reason}</span>
                        </p>
                      ),
                    )}
              </div>
            </div>
          </section>
          <section className="gm-stage" aria-labelledby="gm-carrier-title">
            <div className="gm-section-head">
              <h3 id="gm-carrier-title">운수사 요청</h3>
            </div>
            <div id="gm-request-issues" className="gm-issues" role="status">
              {requestIssues}
            </div>
            <div id="gm-carrier-messages" className="gm-messages gm-carriers">
              {ready ? (
                outputs
                  .filter((m) => !['cj', 'summary'].includes(m.key))
                  .map(messageCard)
              ) : (
                <p className="gm-empty">CJ 요청 분석 대기</p>
              )}
            </div>
          </section>
          <section
            className="gm-stage gm-reply-band"
            aria-labelledby="gm-reply-title"
          >
            <div className="gm-section-head">
              <h3 id="gm-reply-title">운수사 회신</h3>
              <span id="gm-reply-count" className="gm-muted">
                {d.requestPending ? '' : `${filled} / ${total}대`}
              </span>
            </div>
            <div className="gm-reply-source">
              <textarea
                ref={reply}
                id="gm-reply"
                rows={7}
                maxLength={40000}
                aria-label="운수사 회신 원문"
                placeholder="회신 붙여넣기"
                disabled={editDisabled || !ready}
                value={d.replyText}
                onChange={(e) => changeReply(e.target.value)}
                onPaste={(e) => {
                  e.preventDefault();
                  if (editDisabled || !ready) return;
                  const value = e.clipboardData.getData('text/plain');
                  if (!value.trim()) return;
                  const input = e.currentTarget,
                    start = input.selectionStart,
                    end = input.selectionEnd,
                    separator =
                      start === end &&
                      end === input.value.length &&
                      input.value &&
                      !input.value.endsWith('\n')
                        ? '\n\n'
                        : '',
                    inserted = separator + value;
                  if (
                    input.value.length - (end - start) + inserted.length >
                    40000
                  ) {
                    status(
                      '회신 원문은 40,000자까지 처리할 수 있습니다.',
                      true,
                    );
                    return;
                  }
                  changeReply(
                    input.value.slice(0, start) +
                      inserted +
                      input.value.slice(end),
                  );
                  requestAnimationFrame(() =>
                    reply.current?.setSelectionRange(
                      start + inserted.length,
                      start + inserted.length,
                    ),
                  );
                }}
              />
              <div className="gm-reply-actions">
                <label>
                  목적지 보완
                  <select
                    id="gm-reply-region"
                    disabled={editDisabled || !ready}
                    value={replyRegion}
                    onChange={(e) => {
                      setReplyRegion(e.target.value);
                      update((s) => {
                        s.replyChanged = !!s.draft.replyText.trim();
                        s.draft.replyPending ||= s.replyChanged;
                        if (s.replyChanged) s.replyState = '분석 전';
                      });
                    }}
                  >
                    <option value="">원문 기준</option>
                    {REGIONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <button
                  id="gm-apply-reply"
                  className="btn btn-primary"
                  disabled={editDisabled || !ready || !d.replyText.trim()}
                  onClick={() => void run(analyzeReply, true)}
                >
                  회신 분석
                </button>
                <span id="gm-reply-state" role="status" className="gm-muted">
                  {view.replyState}
                </span>
              </div>
            </div>
          </section>
          <section
            className="gm-stage gm-cj-band"
            aria-labelledby="gm-cj-title"
          >
            <div className="gm-section-head">
              <h3 id="gm-cj-title">CJ 전달</h3>
            </div>
            <div id="gm-issues" className="gm-issues" role="status">
              {completeIssues}
            </div>
            <div id="gm-cj-messages" className="gm-messages">
              {!ready ? (
                <p className="gm-empty">배차정보 대기</p>
              ) : !hasAssignment && !d.replyPending ? (
                <p className="gm-empty">운수사 회신 대기</p>
              ) : !d.replyPending && hasAssignment ? (
                outputs
                  .filter((m) => ['cj', 'summary'].includes(m.key))
                  .map(messageCard)
              ) : null}
            </div>
          </section>
        </div>
        <details
          open={trucksOpen}
          onToggle={(e) => setTrucksOpen(e.currentTarget.open)}
          id="gm-truck-details"
          className="gm-settings gm-band"
        >
          <summary>차량별 배차정보</summary>
          <div className="gm-scroll">
            <table className="gm-trucks-table">
              <thead>
                <tr>
                  {[
                    '요청 연결',
                    '도크',
                    '기사',
                    '차량번호',
                    '연락처',
                    '입차시간',
                    '상차량·조건',
                    '관리',
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody id="gm-trucks">
                {(d.requestPending ? [] : d.trucks).map((t, i) => (
                  <tr
                    key={t.id}
                    data-id={t.id}
                    className={
                      d.requests.some((r) => r.id === t.requestId)
                        ? ''
                        : 'gm-unlinked'
                    }
                  >
                    <td>
                      <select
                        data-field="requestId"
                        aria-label="차량 요청 연결"
                        disabled={editDisabled}
                        value={t.requestId}
                        onChange={(e) =>
                          truckInput(t.id, 'requestId', e.target.value)
                        }
                      >
                        <option value="">요청 연결 필요</option>
                        {t.requestId &&
                        !d.requests.some((r) => r.id === t.requestId) ? (
                          <option value={t.requestId}>{t.requestId}</option>
                        ) : null}
                        {d.requests.map((r, i) => (
                          <option key={r.id} value={r.id}>
                            {i + 1}. {r.region} {r.temperature} {r.tons ?? '?'}
                            톤
                          </option>
                        ))}
                      </select>
                      {!t.requestId && t.region ? (
                        <span className="gm-muted">{t.region}</span>
                      ) : null}
                      {t.actualTons != null ? (
                        <span className="gm-muted">
                          회신 차량 {t.actualTons}톤
                        </span>
                      ) : null}
                    </td>
                    {truckFields.map(([field, label, max]) => (
                      <td key={field}>
                        <input
                          data-field={field}
                          type={field === 'phone' ? 'tel' : 'text'}
                          aria-label={label}
                          maxLength={max}
                          value={t[field]}
                          disabled={editDisabled}
                          onChange={(e) =>
                            truckInput(t.id, field, e.target.value)
                          }
                          onBlur={
                            field === 'dock'
                              ? () => dockCommit(t.id)
                              : undefined
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <textarea
                        data-field="loadText"
                        rows={2}
                        maxLength={1000}
                        aria-label="차량별 상차량·조건"
                        value={t.loadText}
                        disabled={editDisabled}
                        onChange={(e) =>
                          truckInput(t.id, 'loadText', e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <div className="gm-row-actions">
                        <button
                          data-move="-1"
                          aria-label={`차량 ${i + 1} 위로`}
                          title="위로"
                          disabled={editDisabled}
                          onClick={() => moveTruck(t.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          data-move="1"
                          aria-label={`차량 ${i + 1} 아래로`}
                          title="아래로"
                          disabled={editDisabled}
                          onClick={() => moveTruck(t.id, 1)}
                        >
                          ↓
                        </button>
                        <button
                          data-remove-truck={t.id}
                          aria-label={`차량 ${i + 1} 삭제`}
                          title="차량 삭제"
                          disabled={editDisabled}
                          onClick={() => moveTruck(t.id)}
                        >
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p
            id="gm-truck-empty"
            className="gm-empty"
            hidden={!d.requestPending && !!d.trucks.length}
          >
            배차정보 대기
          </p>
        </details>
      </div>
      <p
        id="gm-status"
        role="status"
        aria-live="polite"
        data-error={view.statusError}
        hidden={!view.statusError}
      >
        {view.status}
      </p>
      <dialog
        ref={previewDialog}
        id="gm-preview-dialog"
        aria-labelledby="gm-preview-title"
        onCancel={() => setPreview(null)}
        onClose={() => setPreview(null)}
      ><DialogFrame>
        <div className="gm-section-head">
          <h3 id="gm-preview-title">{preview?.title || '원본'}</h3>
          <button
            id="gm-close-preview"
            className="btn btn-ghost"
            onClick={() => setPreview(null)}
          >
            닫기
          </button>
        </div>
        <img
          id="gm-preview-image"
          alt="CJ 요청 원본 확대"
          src={preview?.image}
          hidden={!preview?.image}
        />
        <textarea
          id="gm-preview-text"
          aria-label="전달문 전문"
          readOnly
          value={preview?.text || ''}
          hidden={preview?.text === undefined}
        />
      </DialogFrame></dialog>
      {feedback}
    </main>
  );
}
export default function GimhaeDispatch() {
  return (
    <AdminPage title="김해 배차 요청" mainId="gm-app" bodyClass="">
      <Work />
    </AdminPage>
  );
}
