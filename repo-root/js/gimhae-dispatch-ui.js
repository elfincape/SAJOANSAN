import { requireAuth } from './auth.js';
import { supabase } from './supabase.js';
import {
  requireSelectedCenter,
  mountHeaderCenterSwitcher,
  setSelectedCenterCode,
} from './center.js';
import { menuPermissions } from './menu-permissions.js';
import { permissionAllowed } from './portal-permissions.js';
import {
  isPrivateFeatureOwner,
  loadPrivateFeatures,
} from './private-features.js';
import { confirmDialog } from './ui.js';
import {
  DOCKS,
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
  newFixedDriver,
  normalizeFixedDrivers,
  applyFixedDrivers,
  clearFixedAssignment,
} from './gimhae-dispatch-model.js';
import {
  analyze,
  imageData,
  loadFixedDefaults,
  saveFixedDefaults,
} from './gimhae-dispatch-data.js';

const $ = (id) => document.getElementById('gm-' + id);
const state = {
  draft: newDraft(),
  dirty: false,
  ready: false,
  editable: false,
  busy: false,
  center: null,
  copied: new Map(),
  fixedDefaults: null,
  defaultsLoaded: false,
  editingFixedId: null,
  previous: null,
  photoError: '',
  replyError: '',
  replyChanged: false,
  lastReply: '',
  showPrices: false,
  haulKey: '',
  haulWorker: null,
  haulTimer: null,
};
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const option = (value, label, selected) =>
  `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`;
function select(field, value, choices, label) {
  if (value && !choices.some(([v]) => v === value))
    choices = [[value, value], ...choices];
  return `<select data-field="${field}" aria-label="${escape(label)}" data-edit>${choices.map(([v, name]) => option(v, name, value)).join('')}</select>`;
}
function input(field, value, label, type = 'text', attrs = '') {
  return `<input data-field="${field}" type="${type}" value="${escape(value)}" aria-label="${escape(label)}" ${attrs} data-edit />`;
}
function status(message, error = false) {
  $('status').textContent = message;
  $('status').dataset.error = String(error);
  $('status').hidden = !error && state.ready;
}
function touch() {
  state.dirty = true;
  counters();
}
function counters() {
  const d = state.draft,
    total = d.requests.reduce((n, r) => n + r.count, 0);
  const filled = d.trucks.filter((t) =>
    [t.vehicle, t.driver, t.phone].every((v) => v?.trim()),
  ).length;
  const fixed = d.trucks.filter((t) => t.fixedDriverId).length;
  $('count').textContent = d.requestPending
    ? '분석 대기'
    : `요청 ${total}대 · 배차 ${filled}대${fixed ? ` · 고정 ${fixed}대` : ''}`;
  $('reply-count').textContent = d.requestPending
    ? ''
    : `${filled} / ${total}대`;
}
function controls() {
  for (const el of $('work').querySelectorAll('button,input,select,textarea'))
    el.disabled =
      state.busy || (!state.editable && el.hasAttribute('data-edit'));
  $('add-fixed').disabled ||= !state.defaultsLoaded;
  for (const el of $('fixed-form').querySelectorAll('button,input,select'))
    el.disabled = state.busy || !state.editable;
  const noRequest = state.draft.requestPending || !state.draft.requests.length;
  for (const id of ['reply', 'reply-region', 'apply-reply'])
    $(id).disabled ||= noRequest;
  $('apply-reply').disabled ||= !state.draft.replyText.trim();
  $('retry-photo').hidden = !state.photoError;
  $('undo').hidden = !state.previous;
  for (const button of document.querySelectorAll('[data-copy]'))
    button.disabled =
      state.busy ||
      !state.defaultsLoaded ||
      issues(state.draft, ['cj', 'summary'].includes(button.dataset.copy))
        .length > 0;
  $('work').setAttribute('aria-busy', String(state.busy));
}
async function run(action, { edit = false } = {}) {
  if (!state.ready || state.busy || (edit && !state.editable)) return;
  state.busy = true;
  controls();
  try {
    await action();
  } catch (error) {
    status(error.message || '요청을 처리하지 못했습니다.', true);
  } finally {
    state.busy = false;
    controls();
  }
}
function renderSource() {
  const d = state.draft,
    img = $('image');
  if (d.image) {
    if (img.getAttribute('src') !== d.image) img.src = d.image;
  } else img.removeAttribute('src');
  img.hidden = !d.image;
  $('view-photo').hidden = !d.image;
  $('image-empty').hidden = !!d.image;
  $('photo-state').textContent =
    state.photoError ||
    (d.requestPending
      ? '사진 분석 중…'
      : d.image && d.requests.length
        ? '분석 완료'
        : '');
  $('photo-state').dataset.error = String(!!state.photoError);
  const rows = d.requestPending
    ? []
    : d.volumes.filter((v) => d.requests.some((r) => r.region === v.region));
  $('summary').innerHTML = rows
    .map((v) => {
      const requests = d.requests.filter((r) => r.region === v.region);
      return `<div class="gm-region"><div class="gm-region-head"><strong>${escape(v.region)}</strong><span>${[...new Set(requests.map((r) => r.carrier || carrierFor(r.region, d.date)))].map(escape).join(' · ')}</span></div><div class="gm-volume">냉동 <b>${v.frozen ?? '-'}</b> · 냉장 <b>${v.chilled ?? '-'}</b><span>합계 ${v.frozen != null && v.chilled != null ? v.frozen + v.chilled : '-'}p</span></div>${requests.map((r) => `<div class="gm-request-line">${escape(r.temperature || '온도 미정')} <strong>${escape(r.tons ?? '?')}톤 ${r.count}대</strong></div>`).join('')}</div>`;
    })
    .join('');
  $('request-empty').hidden = !!rows.length;
  $('request-empty').textContent = d.requestPending
    ? '사진 분석 대기'
    : 'CJ 요청 대기';
}
function fixedStatus(f) {
  if (!f.enabled) return '오늘 제외';
  if (!state.draft.requests.length) return '오늘 포함 · 요청 대기';
  if (state.draft.requestPending) return '분석 대기';
  if (state.draft.trucks.some((t) => t.fixedDriverId === f.id))
    return '오늘 포함 · 배차 적용';
  const slot = state.draft.trucks.some((t) => {
    const r = state.draft.requests.find((r) => r.id === t.requestId);
    return (
      r?.region === f.region &&
      t.dock === f.dock &&
      (!f.carrier ||
        f.carrier === (r.carrier || carrierFor(r.region, state.draft.date)))
    );
  });
  return slot ? '기존 배차 유지' : '해당 요청 없음';
}
function renderFixedToday() {
  $('fixed-today').innerHTML = state.draft.fixedDrivers
    .map(
      (f) =>
        `<div class="gm-fixed-person" title="${escape([f.vehicle, f.phone, f.carrier || '운수사 공통', fixedStatus(f)].join(' · '))}"><label class="gm-fixed-choice"><input type="checkbox" data-fixed-toggle="${escape(f.id)}" aria-label="${escape(f.driver)} 오늘 포함" ${f.enabled ? 'checked' : ''} data-edit /><strong>${escape(f.driver)}</strong><span>${escape(f.region)} ${escape(f.dock)}번</span></label><button class="btn btn-ghost" data-edit-fixed="${escape(f.id)}" aria-label="${escape(f.driver)} 고정기사 수정" data-edit>수정</button></div>`,
    )
    .join('');
  $('fixed-empty').hidden =
    !state.defaultsLoaded || !!state.draft.fixedDrivers.length;
  $('add-fixed').classList.toggle(
    'btn-primary',
    !state.draft.fixedDrivers.length,
  );
  $('add-fixed').classList.toggle(
    'btn-ghost',
    !!state.draft.fixedDrivers.length,
  );
}
async function refreshFixedDefaults(apply = false) {
  let result;
  try {
    result = await loadFixedDefaults(supabase, state.center.code);
    $('fixed-status').textContent = '';
    $('fixed-retry').hidden = true;
  } catch (error) {
    $('fixed-status').textContent = '고정기사 정보를 불러오지 못했습니다.';
    $('fixed-retry').hidden = false;
    throw error;
  }
  state.fixedDefaults = result;
  state.defaultsLoaded = true;
  if (!apply) return;
  const defaults = normalizeFixedDrivers(result?.payload.fixedDrivers).map(
    (r) => ({ ...r, enabled: true }),
  );
  for (const truck of state.draft.trucks) {
    if (!truck.fixedDriverId) continue;
    const same = defaults.some(
      (f) =>
        f.id === truck.fixedDriverId &&
        f.driver === truck.driver &&
        f.vehicle === truck.vehicle,
    );
    if (!truck.fixedConfirmed || !same) clearFixedAssignment(truck, true);
  }
  state.draft.fixedDrivers = defaults;
  applyFixedDrivers(state.draft);
}
function renderTrucks() {
  const choices = [
    ['', '요청 연결 필요'],
    ...state.draft.requests.map((r, i) => [
      r.id,
      `${i + 1}. ${r.region} ${r.temperature} ${r.tons ?? '?'}톤`,
    ]),
  ];
  $('trucks').innerHTML = (state.draft.requestPending ? [] : state.draft.trucks)
    .map(
      (
        t,
        i,
      ) => `<tr data-id="${escape(t.id)}" class="${state.draft.requests.some((r) => r.id === t.requestId) ? '' : 'gm-unlinked'}">
    <td>${select('requestId', t.requestId, choices, '차량 요청 연결')}${t.fixedDriverId ? '<span class="gm-muted">고정기사</span>' : ''}${!t.requestId && t.region ? `<span class="gm-muted">${escape(t.region)}</span>` : ''}${t.actualTons != null ? `<span class="gm-muted">회신 차량 ${escape(t.actualTons)}톤</span>` : ''}</td>
    <td>${input('dock', t.dock, '도크 번호', 'text', 'maxlength="20"')}</td><td>${input('driver', t.driver, '기사명', 'text', 'maxlength="80"')}</td>
    <td>${input('vehicle', t.vehicle, '차량번호', 'text', 'maxlength="40"')}</td><td>${input('phone', t.phone, '기사 연락처', 'tel', 'maxlength="40"')}</td>
    <td>${input('arrival', t.arrival, '입차시간 조건', 'text', 'maxlength="80"')}</td>
    <td><textarea data-field="loadText" rows="2" maxlength="1000" aria-label="차량별 상차량·조건" data-edit>${escape(t.loadText)}</textarea></td>
    <td><div class="gm-row-actions"><button data-move="-1" aria-label="차량 ${i + 1} 위로" title="위로" data-edit>&#8593;</button><button data-move="1" aria-label="차량 ${i + 1} 아래로" title="아래로" data-edit>&#8595;</button><button data-remove-truck="${escape(t.id)}" aria-label="차량 ${i + 1} 삭제" title="차량 삭제" data-edit>&#215;</button></div></td></tr>`,
    )
    .join('');
  $('truck-empty').hidden = !!$('trucks').children.length;
}
function renderMessages() {
  const d = state.draft,
    ready = !d.requestPending && d.requests.length;
  const hasAssignment = d.trucks.some((t) =>
    [t.driver, t.vehicle, t.phone].some((v) => v?.trim()),
  );
  const requestIssues = ready ? issues(d) : [];
  $('request-issues').textContent = [...new Set(requestIssues)]
    .slice(0, 4)
    .join(' / ');
  $('issues').textContent =
    ready && (hasAssignment || d.replyPending)
      ? [...new Set(issues(d, true))].slice(0, 4).join(' / ')
      : '';
  $('carrier-messages').replaceChildren();
  $('cj-messages').replaceChildren();
  if (!ready) {
    $('carrier-messages').innerHTML =
      '<p class="gm-empty">CJ 요청 분석 대기</p>';
    $('cj-messages').innerHTML = '<p class="gm-empty">배차정보 대기</p>';
    return;
  }
  for (const message of messages(d)) {
    if (
      ['cj', 'summary'].includes(message.key) &&
      (d.replyPending || !hasAssignment)
    )
      continue;
    const article = document.createElement('article');
    article.className = 'gm-message';
    const copied = state.copied.get(message.key);
    const lines = Math.min(15, Math.max(4, message.text.split('\n').length));
    article.innerHTML = `<div class="gm-section-head"><h3>${escape(message.title)}</h3><button class="btn btn-primary" data-copy="${escape(message.key)}" aria-label="${escape(message.title)} 복사">복사</button></div><textarea rows="${lines}" readonly aria-label="${escape(message.title)}">${escape(message.text)}</textarea><div class="gm-message-footer"><span class="gm-message-status">${copied === message.text ? '복사됨' : copied ? '복사 후 변경됨' : ''}</span><button class="btn btn-ghost" data-preview="${escape(message.key)}" aria-label="${escape(message.title)} 전문 보기">전문 보기</button></div>`;
    let output = article;
    if (message.key === 'summary') {
      output = document.createElement('details');
      output.className = 'gm-settings';
      const title = document.createElement('summary');
      title.textContent = '차량 운영 현황';
      output.append(title, article);
    }
    $(
      ['cj', 'summary'].includes(message.key)
        ? 'cj-messages'
        : 'carrier-messages',
    ).append(output);
  }
  if (!hasAssignment && !d.replyPending)
    $('cj-messages').innerHTML = '<p class="gm-empty">운수사 회신 대기</p>';
}
function stopHaul() {
  state.haulWorker?.terminate();
  state.haulWorker = null;
  clearTimeout(state.haulTimer);
}
function scheduleHaul() {
  const d = state.draft,
    payload = { volumes: d.volumes, requests: d.requests };
  const key =
    !d.requestPending && d.requests.length ? JSON.stringify(payload) : '';
  if (key === state.haulKey) return;
  stopHaul();
  state.haulKey = key;
  $('haul').hidden = true;
  $('haul').replaceChildren();
  if (!key) return;
  const unavailable = () => {
    if (state.haulKey !== key) return;
    stopHaul();
    $('haul').textContent =
      '하불 비교를 완료하지 못했습니다. CJ 요청은 유지됩니다.';
    $('haul').hidden = false;
  };
  try {
    const worker = new Worker(
      new URL('./gimhae-dispatch-haul-worker.js', import.meta.url),
      { type: 'module' },
    );
    state.haulWorker = worker;
    state.haulTimer = setTimeout(unavailable, 5000);
    worker.onerror = unavailable;
    worker.onmessage = ({ data }) => {
      if (state.haulKey !== key) return;
      stopHaul();
      if (!Array.isArray(data?.results)) {
        unavailable();
        return;
      }
      const notices = data.results.filter((r) => r.status !== 'same');
      $('haul').innerHTML = notices
        .map((r) =>
          r.status === 'different'
            ? `<p title="김해→${escape(r.destination)}"><strong>${escape(r.region)} · 최저가 조합과 다름</strong><span>요청 ${escape(r.requestedLabel)} / 최저가 ${escape(r.bestLabel)}</span>${state.showPrices ? `<span>요청 ${Number(r.requestedCost).toLocaleString('ko-KR')}원 / 최저가 ${Number(r.bestCost).toLocaleString('ko-KR')}원</span>` : ''}<small>기존 하불단가·표준 적재 기준</small></p>`
            : `<p><strong>${escape(r.region)} · 하불 비교 보류</strong><span>${escape(r.reason)}</span></p>`,
        )
        .join('');
      $('haul').hidden = !notices.length;
    };
    worker.postMessage(payload);
  } catch {
    unavailable();
  }
}
function updateOutputs() {
  renderFixedToday();
  renderMessages();
  counters();
  controls();
}
function render() {
  $('date').value = state.draft.date;
  $('reply').value = state.draft.replyText;
  renderSource();
  renderFixedToday();
  renderTrucks();
  renderMessages();
  counters();
  controls();
  scheduleHaul();
}
async function analyzePhoto() {
  state.photoError = '';
  state.draft.requestPending = true;
  render();
  status('CJ 요청 사진 분석 중…');
  try {
    await $('image').decode();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const result = await analyze(
      supabase,
      state.center.code,
      state.draft,
      'request',
    );
    const next = importRequest(state.draft, result);
    state.draft = next;
    state.replyError = '';
    state.replyChanged = false;
    state.lastReply = '';
    $('reply-state').textContent = '';
    state.copied.clear();
    touch();
    render();
    const errors = issues({ ...next, fixedDrivers: [] });
    if (errors.length) {
      state.photoError = '사진 인식 결과 확인 필요';
      renderSource();
    }
    status(
      errors.length
        ? '사진 인식 결과가 불완전합니다. 다시 분석해 주세요.'
        : validDate(result.date)
          ? '사진 분석을 완료했습니다.'
          : '사진에서 날짜를 읽지 못했습니다. 기준날짜를 확인해 주세요.',
      !!errors.length || !validDate(result.date),
    );
  } catch (error) {
    state.photoError = error.message || '사진 분석에 실패했습니다.';
    renderSource();
    throw error;
  }
}
async function importPhoto(file) {
  await run(
    async () => {
      const data = await imageData(file);
      if (
        data === state.draft.image &&
        !state.draft.requestPending &&
        state.draft.requests.length &&
        !state.photoError &&
        !issues({ ...state.draft, fixedDrivers: [] }).length
      ) {
        status('같은 사진의 분석 결과입니다.');
        return;
      }
      if (
        !state.draft.requestPending &&
        (state.draft.image || state.draft.requests.length)
      )
        state.previous = {
          draft: structuredClone(state.draft),
          dirty: state.dirty,
        };
      state.draft.image = data;
      state.draft.imageName = file.name || '붙여넣은 사진';
      state.draft.requestPending = true;
      touch();
      await analyzePhoto();
    },
    { edit: true },
  );
}
$('paste').onclick = () => {
  if (!state.ready || !state.editable || state.busy) return;
  $('photo-file').click();
};
$('photo-file').onchange = (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) importPhoto(file);
};
$('paste').addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((x) =>
    x.type.startsWith('image/'),
  );
  e.preventDefault();
  if (!state.editable || state.busy) return;
  if (!item) {
    status('클립보드에 사진이 없습니다.', true);
    return;
  }
  importPhoto(item.getAsFile());
});
$('retry-photo').onclick = () => run(analyzePhoto, { edit: true });
$('undo').onclick = () =>
  run(
    async () => {
      if (!state.previous) return;
      Object.assign(state, state.previous);
      state.previous = null;
      state.photoError = '';
      state.replyError = '';
      state.replyChanged = false;
      state.lastReply = '';
      $('reply-state').textContent = '';
      state.copied.clear();
      restoreAnalysisState();
      render();
      status('이전 요청을 복원했습니다.');
    },
    { edit: true },
  );
async function analyzeReply() {
  if (state.draft.requestPending || !state.draft.requests.length)
    throw Error('CJ 요청 사진을 먼저 선택하거나 붙여넣어 주세요.');
  const signature = state.draft.replyText + '|' + $('reply-region').value;
  if (
    signature === state.lastReply &&
    !state.replyChanged &&
    !state.draft.replyPending
  ) {
    status('이미 반영된 회신입니다.');
    return;
  }
  state.replyError = '';
  state.draft.replyPending = true;
  renderMessages();
  $('reply-state').textContent = '회신 분석 중…';
  try {
    const result = await analyze(
      supabase,
      state.center.code,
      state.draft,
      'reply',
    );
    if ($('reply-region').value && Array.isArray(result.trucks))
      for (const truck of result.trucks)
        if (!truck.region) truck.region = $('reply-region').value;
    state.draft = normalizeDraft(
      applyReply(structuredClone(state.draft), result),
    );
    state.draft.replyPending = false;
    state.lastReply = signature;
    state.replyChanged = false;
    touch();
    render();
    $('reply-state').textContent = '반영 완료';
    status('운수사 회신을 반영했습니다.');
    if (state.draft.trucks.some((t) => !t.requestId))
      $('truck-details').open = true;
  } catch (error) {
    state.replyError = error.message;
    $('reply-state').textContent = error.message;
    throw error;
  }
}
$('reply').addEventListener('paste', (e) => {
  e.preventDefault();
  if (
    !state.editable ||
    state.busy ||
    state.draft.requestPending ||
    !state.draft.requests.length
  )
    return;
  const value = e.clipboardData?.getData('text/plain') || '';
  if (!value.trim()) return;
  const input = $('reply');
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const separator =
    start === end &&
    end === input.value.length &&
    input.value &&
    !input.value.endsWith('\n')
      ? '\n\n'
      : '';
  const inserted = separator + value;
  if (input.value.length - (end - start) + inserted.length > 40000) {
    status('회신 원문은 40,000자까지 처리할 수 있습니다.', true);
    return;
  }
  input.setRangeText(inserted, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
$('reply').oninput = (e) => {
  state.draft.replyText = e.target.value;
  state.replyChanged = true;
  state.draft.replyPending = true;
  state.replyError = '';
  $('reply-state').textContent = e.target.value.trim() ? '분석 전' : '';
  renderMessages();
  touch();
  controls();
};
$('reply-region').onchange = () => {
  state.replyChanged = !!state.draft.replyText.trim();
  state.draft.replyPending ||= state.replyChanged;
  if (state.replyChanged) $('reply-state').textContent = '분석 전';
  renderMessages();
  controls();
};
$('apply-reply').onclick = () => run(analyzeReply, { edit: true });
$('date').onchange = (e) => {
  if (!validDate(e.target.value)) {
    $('date').value = state.draft.date;
    return;
  }
  if (state.draft.date !== e.target.value) {
    state.lastReply = '';
    for (const f of state.draft.fixedDrivers) f.enabled = true;
  }
  state.draft.date = e.target.value;
  applyFixedDrivers(state.draft);
  touch();
  render();
};
$('fixed-today').onchange = (e) => {
  if (!state.editable || state.busy) return;
  const f = state.draft.fixedDrivers.find(
    (f) => f.id === e.target.dataset.fixedToggle,
  );
  if (!f) return;
  f.enabled = e.target.checked;
  applyFixedDrivers(state.draft);
  touch();
  renderTrucks();
  updateOutputs();
};
function fixedDocks(value) {
  const form = $('fixed-form');
  const docks = [...(DOCKS[form.elements.region.value] || [])];
  if (value && !docks.includes(value)) docks.push(value);
  form.elements.dock.innerHTML = docks
    .map((d) => option(d, d + '번 도크', value))
    .join('');
}
function openFixed(id = null) {
  if (!state.editable || state.busy || !state.defaultsLoaded) return;
  const row = id
    ? state.draft.fixedDrivers.find((f) => f.id === id)
    : newFixedDriver();
  if (!row) return;
  state.editingFixedId = id;
  const form = $('fixed-form');
  for (const key of [
    'region',
    'carrier',
    'driver',
    'vehicle',
    'phone',
    'arrival',
  ])
    form.elements[key].value = row[key];
  fixedDocks(row.dock);
  $('fixed-dialog-title').textContent = id ? '고정기사 수정' : '고정기사 등록';
  $('submit-fixed').textContent = id ? '변경 적용' : '등록';
  $('delete-fixed').hidden = !id;
  $('delete-fixed').textContent = '등록 삭제';
  $('delete-fixed').dataset.confirm = '';
  $('fixed-error').textContent = '';
  $('refresh-fixed').hidden = true;
  $('fixed-dialog').showModal();
}
function syncRegisteredFixed(draft, rows) {
  const nextRows = normalizeFixedDrivers(rows).map((f) => ({
    ...f,
    enabled: draft.fixedDrivers.find((old) => old.id === f.id)?.enabled ?? true,
  }));
  for (const next of nextRows) {
    const old = draft.fixedDrivers.find((f) => f.id === next.id);
    if (!old) continue;
    for (const t of draft.trucks) {
      if (t.fixedDriverId !== next.id) continue;
      for (const field of ['driver', 'vehicle', 'phone', 'arrival'])
        if (t[field] === old[field]) t[field] = next[field];
    }
  }
  draft.fixedDrivers = nextRows;
  applyFixedDrivers(draft);
}
async function commitFixed(rows) {
  const result = await saveFixedDefaults(
    supabase,
    state.center.code,
    rows,
    state.fixedDefaults?.id || null,
    state.fixedDefaults?.revision || 0,
  );
  state.fixedDefaults = { ...result, payload: normalizeDraft(result.payload) };
  syncRegisteredFixed(state.draft, rows);
  if (state.previous) syncRegisteredFixed(state.previous.draft, rows);
  render();
}
async function fixedAction(action) {
  await run(
    async () => {
      $('fixed-error').textContent = '';
      try {
        await action();
        $('fixed-dialog').close();
        status('고정기사 정보를 반영했습니다.');
      } catch (error) {
        $('fixed-error').textContent = error.message;
        if (['PT409', '23505'].includes(error.code))
          $('refresh-fixed').hidden = false;
        throw error;
      }
    },
    { edit: true },
  );
}
$('add-fixed').onclick = () => openFixed();
$('fixed-today').onclick = (e) => {
  const button = e.target.closest('[data-edit-fixed]');
  if (button) openFixed(button.dataset.editFixed);
};
$('fixed-form').elements.region.onchange = () => fixedDocks();
$('cancel-fixed').onclick = () => $('fixed-dialog').close();
$('refresh-fixed').onclick = () =>
  run(
    async () => {
      try {
        await refreshFixedDefaults();
        const rows = state.fixedDefaults?.payload.fixedDrivers || [];
        syncRegisteredFixed(state.draft, rows);
        if (state.previous) syncRegisteredFixed(state.previous.draft, rows);
        render();
        $('refresh-fixed').hidden = true;
        $('fixed-error').textContent =
          '최신 기사정보를 불러왔습니다. 입력한 내용을 확인하고 다시 적용해 주세요.';
      } catch (error) {
        $('fixed-error').textContent = error.message;
      }
    },
    { edit: true },
  );
$('fixed-dialog').addEventListener('cancel', (e) => {
  if (state.busy) e.preventDefault();
});
$('fixed-form').onsubmit = (e) => {
  e.preventDefault();
  const fields = Object.fromEntries(new FormData(e.currentTarget));
  const current = state.draft.fixedDrivers.find(
    (f) => f.id === state.editingFixedId,
  );
  if (state.editingFixedId && !current) {
    $('fixed-error').textContent =
      '다른 창에서 삭제된 기사입니다. 취소 후 새로 등록해 주세요.';
    return;
  }
  const row = { ...(current || newFixedDriver()), ...fields };
  const rows = current
    ? state.draft.fixedDrivers.map((f) => (f.id === row.id ? row : f))
    : [...state.draft.fixedDrivers, row];
  fixedAction(() => commitFixed(rows));
};
$('delete-fixed').onclick = () => {
  const id = state.editingFixedId;
  if (!id) return;
  if (!$('delete-fixed').dataset.confirm) {
    $('delete-fixed').dataset.confirm = 'yes';
    $('delete-fixed').textContent = '삭제 확정';
    $('fixed-error').textContent = '이 기사의 고정 배차 등록을 삭제합니다.';
    return;
  }
  fixedAction(() =>
    commitFixed(state.draft.fixedDrivers.filter((f) => f.id !== id)),
  );
};
$('fixed-retry').onclick = () =>
  run(async () => {
    await refreshFixedDefaults(true);
    render();
  });
$('trucks').oninput = (e) => {
  if (!state.editable || state.busy) return;
  const row = state.draft.trucks.find(
      (t) => t.id === e.target.closest('[data-id]')?.dataset.id,
    ),
    field = e.target.dataset.field;
  if (!row || !field) return;
  if (
    ['driver', 'vehicle', 'requestId'].includes(field) &&
    row[field] !== e.target.value
  ) {
    row.fixedDriverId = '';
    row.fixedConfirmed = false;
  }
  row[field] = e.target.value;
  if (
    row.fixedDriverId &&
    ['phone', 'arrival', 'loadText', 'dock'].includes(field)
  )
    row.fixedConfirmed = true;
  if (field === 'requestId') {
    const r = state.draft.requests.find((r) => r.id === row.requestId);
    row.region = r?.region || row.region;
    reconcileDocks(state.draft);
    renderTrucks();
  }
  touch();
  updateOutputs();
};
$('trucks').onchange = (e) => {
  if (e.target.dataset.field !== 'dock') return;
  const t = state.draft.trucks.find(
    (t) => t.id === e.target.closest('[data-id]')?.dataset.id,
  );
  if (!t) return;
  e.target.value = t.dock = dockNumber(e.target.value);
  t.dockManual = true;
  const f = state.draft.fixedDrivers.find((f) => f.id === t.fixedDriverId);
  if (f) f.dock = t.dock;
  updateOutputs();
};
$('trucks').onclick = (e) => {
  const button = e.target.closest('[data-move],[data-remove-truck]');
  if (!button) return;
  run(
    async () => {
      const index = state.draft.trucks.findIndex(
        (t) => t.id === button.closest('[data-id]').dataset.id,
      );
      if (button.hasAttribute('data-remove-truck')) {
        if (
          filledTruck(state.draft.trucks[index]) &&
          !(await confirmDialog('이 차량의 배차정보를 삭제할까요?', {
            okText: '삭제',
          }))
        )
          return;
        state.draft.trucks.splice(index, 1);
      } else {
        const target = index + Number(button.dataset.move);
        if (target < 0 || target >= state.draft.trucks.length) return;
        [state.draft.trucks[index], state.draft.trucks[target]] = [
          state.draft.trucks[target],
          state.draft.trucks[index],
        ];
      }
      reconcileDocks(state.draft);
      touch();
      renderTrucks();
      updateOutputs();
    },
    { edit: true },
  );
};
function resetTransient() {
  state.previous = null;
  state.photoError = '';
  state.replyError = '';
  state.replyChanged = false;
  state.lastReply = '';
  state.copied.clear();
  $('reply-state').textContent = '';
}
function restoreAnalysisState() {
  if (state.draft.requestPending)
    state.photoError = '현재 사진의 분석이 완료되지 않았습니다.';
  else if (
    state.draft.image &&
    issues({ ...state.draft, fixedDrivers: [] }).length
  )
    state.photoError = '사진 인식 결과 확인 필요';
  if (state.draft.replyPending) {
    state.replyChanged = true;
    $('reply-state').textContent = '현재 회신의 분석이 완료되지 않았습니다.';
  }
}
$('new').onclick = () =>
  run(
    async () => {
      if (
        state.dirty &&
        !(await confirmDialog(
          '현재 요청과 회신을 비우고 새 작업을 시작할까요? 등록된 고정기사는 유지됩니다.',
          { okText: '새 작업' },
        ))
      )
        return;
      await refreshFixedDefaults();
      state.draft = newDraft(
        defaultDate(),
        state.fixedDefaults?.payload.fixedDrivers,
      );
      state.dirty = false;
      resetTransient();
      render();
      status('새 작업입니다.');
    },
    { edit: true },
  );
document.addEventListener('click', (e) => {
  const preview = e.target.closest('[data-preview]');
  if (preview) {
    const message = messages(state.draft).find(
      (m) => m.key === preview.dataset.preview,
    );
    if (message) {
      $('preview-title').textContent = message.title;
      $('preview-image').hidden = true;
      $('preview-text').hidden = false;
      $('preview-text').value = message.text;
      $('preview-dialog').showModal();
    }
    return;
  }
  const copy = e.target.closest('[data-copy]');
  if (!copy) return;
  run(async () => {
    if (!state.defaultsLoaded)
      throw Error('고정기사 정보를 먼저 불러와 주세요.');
    const key = copy.dataset.copy,
      errors = issues(state.draft, ['cj', 'summary'].includes(key));
    if (errors.length) throw Error(errors[0]);
    const message = messages(state.draft).find((m) => m.key === key);
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message.text);
    } catch {
      const area = copy.closest('article').querySelector('textarea');
      area.focus();
      area.select();
      status('클립보드 접근이 제한되어 문구를 선택했습니다.', true);
      return;
    }
    state.copied.set(key, message.text);
    renderMessages();
    status(message.title + ' 문구를 복사했습니다.');
  });
});
$('view-photo').onclick = () => {
  if (!state.draft.image) return;
  $('preview-title').textContent = 'CJ 요청 원본';
  $('preview-image').src = state.draft.image;
  $('preview-image').hidden = false;
  $('preview-text').hidden = true;
  $('preview-dialog').showModal();
};
$('close-preview').onclick = () => $('preview-dialog').close();
addEventListener('beforeunload', (e) => {
  if (state.busy) {
    e.preventDefault();
    e.returnValue = '';
  }
});
async function initialize() {
  state.center = await requireSelectedCenter();
  const profile = await requireAuth();
  if (!profile) return;
  const permissions = await menuPermissions();
  if (
    !permissionAllowed(
      permissions,
      'dispatch_parser',
      'read',
      state.center.code,
    )
  )
    throw Error('배차정보 열람 권한이 없습니다.');
  state.editable = permissionAllowed(
    permissions,
    'dispatch_parser',
    'edit',
    state.center.code,
  );
  state.showPrices =
    isPrivateFeatureOwner(profile) && loadPrivateFeatures(profile).haulPrices;
  state.ready = true;
  $('work').hidden = false;
  $('center').textContent =
    state.center.name +
    ' · 김해 출발 배차' +
    (state.editable ? '' : ' · 열람 전용');
  mountHeaderCenterSwitcher(async (next) => {
    if (
      state.busy ||
      (state.dirty &&
        !(await confirmDialog('현재 요청과 회신을 닫고 센터를 전환할까요?', {
          okText: '전환',
        })))
    ) {
      setSelectedCenterCode(state.center.code);
      const select = document.querySelector('#center-switcher select');
      if (select) select.value = state.center.code;
      return;
    }
    state.dirty = false;
    setSelectedCenterCode(next.code);
    location.reload();
  });
  render();
  status('');
  await run(async () => {
    await refreshFixedDefaults(true);
    render();
  });
}
initialize().catch((error) => status(error.message, true));
