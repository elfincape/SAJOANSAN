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
  newFixedDriver,
  normalizeFixedDrivers,
  applyFixedDrivers,
  clearFixedAssignment,
} from './gimhae-dispatch-model.js';
import {
  listDrafts,
  loadDraft,
  saveDraft,
  analyze,
  imageData,
  loadFixedDefaults,
  saveFixedDefaults,
} from './gimhae-dispatch-data.js';

const $ = (id) => document.getElementById('gm-' + id);
const state = {
  draft: newDraft(),
  id: null,
  revision: 0,
  dirty: false,
  ready: false,
  editable: false,
  busy: false,
  center: null,
  copied: new Map(),
  fixedDefaults: null,
  defaultsLoaded: false,
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
  $('saved').textContent = state.dirty
    ? '저장 전 변경사항'
    : state.id
      ? `저장됨 · v${state.revision}`
      : '새 작업';
}
function controls() {
  for (const el of $('work').querySelectorAll('button,input,select,textarea'))
    el.disabled =
      state.busy || (!state.editable && el.hasAttribute('data-edit'));
  $('load').disabled ||= !$('history').value;
  $('save-fixed').disabled ||= !state.defaultsLoaded;
  const noRequest = state.draft.requestPending || !state.draft.requests.length;
  for (const id of ['reply', 'reply-region', 'apply-reply'])
    $(id).disabled ||= noRequest;
  $('apply-reply').disabled ||= !state.draft.replyText.trim();
  $('apply-reply').hidden = !state.replyChanged && !state.replyError;
  $('retry-photo').hidden = !state.photoError;
  $('undo').hidden = !state.previous;
  for (const button of document.querySelectorAll('[data-copy]'))
    button.disabled =
      state.busy ||
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
      return `<tr><th scope="row">${escape(v.region)}</th><td>${v.frozen ?? '-'}</td><td>${v.chilled ?? '-'}</td><td>${v.frozen != null && v.chilled != null ? v.frozen + v.chilled : '-'}</td><td>${requests.map((r) => `<div>${escape(r.temperature || '온도 미정')} ${escape(r.tons ?? '?')}톤 ${r.count}대</div>`).join('')}</td><td>${[...new Set(requests.map((r) => r.carrier || carrierFor(r.region, d.date)))].map(escape).join(' · ')}</td></tr>`;
    })
    .join('');
  $('request-empty').hidden = !!rows.length;
  $('request-empty').textContent = d.requestPending
    ? '사진 분석 대기'
    : 'CJ 요청 대기';
}
function fixedStatus(f) {
  if (!f.enabled) return '오늘 제외';
  if (state.draft.requestPending) return '분석 대기';
  if (state.draft.trucks.some((t) => t.fixedDriverId === f.id)) return '적용됨';
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
        `<label class="gm-fixed-choice"><input type="checkbox" data-fixed-toggle="${escape(f.id)}" aria-label="${escape(f.driver || '고정기사')} 오늘 포함" ${f.enabled ? 'checked' : ''} data-edit /><span><strong>${escape(f.region)} ${escape(f.dock)}번 · ${escape(f.driver || '기사 미정')}</strong><span class="gm-muted">${escape(f.vehicle)} · ${fixedStatus(f)}</span></span></label>`,
    )
    .join('');
  const comparable = (rows) =>
    JSON.stringify(
      normalizeFixedDrivers(rows).map((r) => ({ ...r, enabled: true })),
    );
  $('fixed-status').textContent = !state.defaultsLoaded
    ? '불러오기 필요'
    : comparable(state.draft.fixedDrivers) !==
        comparable(state.fixedDefaults?.payload.fixedDrivers || [])
      ? '변경사항 있음'
      : state.fixedDefaults
        ? '저장됨'
        : '';
}
function renderFixed() {
  renderFixedToday();
  $('fixed').innerHTML = state.draft.fixedDrivers
    .map(
      (f) => `<tr data-id="${escape(f.id)}">
    <td>${select(
      'region',
      f.region,
      REGIONS.map((v) => [v, v]),
      '고정기사 지역',
    )}</td>
    <td>${select(
      'carrier',
      f.carrier,
      [
        ['', '공통'],
        ['광신', '광신'],
        ['동진', '동진'],
        ['해피', '해피'],
      ],
      '고정기사 운수사',
    )}</td>
    <td>${input('dock', f.dock, '고정기사 도크', 'text', 'maxlength="20"')}</td>
    <td>${input('driver', f.driver, '고정기사 이름', 'text', 'maxlength="80"')}</td>
    <td>${input('vehicle', f.vehicle, '고정기사 차량번호', 'text', 'maxlength="40"')}</td>
    <td>${input('phone', f.phone, '고정기사 연락처', 'tel', 'maxlength="40"')}</td>
    <td>${input('arrival', f.arrival, '고정기사 입차시간', 'text', 'maxlength="80"')}</td>
    <td><button class="btn btn-ghost" data-remove-fixed="${escape(f.id)}" data-edit>삭제</button></td></tr>`,
    )
    .join('');
  $('fixed-empty').hidden = !!state.draft.fixedDrivers.length;
}
async function refreshFixedDefaults(apply = false) {
  const result = await loadFixedDefaults(supabase, state.center.code);
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
  const requestIssues = ready ? issues(d) : [];
  $('request-issues').textContent = [...new Set(requestIssues)]
    .slice(0, 4)
    .join(' / ');
  $('issues').textContent = ready
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
    if (d.replyPending && ['cj', 'summary'].includes(message.key)) continue;
    const article = document.createElement('article');
    article.className = 'gm-message';
    const copied = state.copied.get(message.key);
    const lines = Math.min(15, Math.max(4, message.text.split('\n').length));
    article.innerHTML = `<div class="gm-section-head"><h3>${escape(message.title)}</h3><span class="gm-message-status">${copied === message.text ? '복사됨' : copied ? '복사 후 변경됨' : ''}</span><button class="btn btn-primary" data-copy="${escape(message.key)}">복사</button></div><textarea rows="${lines}" readonly aria-label="${escape(message.title)}">${escape(message.text)}</textarea>`;
    $(
      ['cj', 'summary'].includes(message.key)
        ? 'cj-messages'
        : 'carrier-messages',
    ).append(article);
  }
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
            ? `<p><strong>${escape(r.region)} · 최저가 조합과 다름</strong><span>요청 ${escape(r.requestedLabel)} / 최저가 ${escape(r.bestLabel)}</span>${state.showPrices ? `<span>요청 ${Number(r.requestedCost).toLocaleString('ko-KR')}원 / 최저가 ${Number(r.bestCost).toLocaleString('ko-KR')}원</span>` : ''}<small>김해→${escape(r.destination)} · 기존 하불단가·표준 적재 기준</small></p>`
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
  renderFixed();
  renderTrucks();
  renderMessages();
  counters();
  controls();
  scheduleHaul();
}
async function refreshHistory() {
  const rows = await listDrafts(supabase, state.center.code);
  $('history').innerHTML =
    option('', '선택', '') +
    rows
      .map((r) =>
        option(
          r.id,
          `${r.business_date} · v${r.revision} · ${new Date(r.updated_at).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })}`,
          state.id,
        ),
      )
      .join('');
}
async function save(copy = false) {
  const result = await saveDraft(
    supabase,
    state.center.code,
    state.draft,
    copy ? null : state.id,
    copy ? 0 : state.revision,
  );
  state.id = result.id;
  state.revision = result.revision;
  if (state.previous?.id === result.id) {
    state.previous.revision = result.revision;
    state.previous.dirty = true;
  }
  state.draft = normalizeDraft(result.payload);
  state.dirty = false;
  render();
  status('저장했습니다.');
  try {
    await refreshHistory();
  } catch {
    status('저장은 완료했습니다. 저장 목록 새로고침에 실패했습니다.', true);
  }
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
    if (next.date !== state.draft.date) {
      state.id = null;
      state.revision = 0;
    }
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
async function pastePhoto(file) {
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
          id: state.id,
          revision: state.revision,
          dirty: state.dirty,
        };
      state.draft.image = data;
      state.draft.imageName = '붙여넣은 사진';
      state.draft.requestPending = true;
      touch();
      await analyzePhoto();
    },
    { edit: true },
  );
}
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
  pastePhoto(item.getAsFile());
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
    throw Error('CJ 요청 사진을 먼저 붙여넣어 주세요.');
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
  if (value.length > 40000) {
    status('회신 원문은 40,000자까지 처리할 수 있습니다.', true);
    return;
  }
  $('reply').value = value;
  state.draft.replyText = value;
  state.replyChanged =
    value + '|' + $('reply-region').value !== state.lastReply;
  state.draft.replyPending = state.replyChanged || state.draft.replyPending;
  touch();
  run(analyzeReply, { edit: true });
});
$('reply').oninput = (e) => {
  state.draft.replyText = e.target.value;
  state.replyChanged = true;
  state.draft.replyPending = true;
  renderMessages();
  touch();
  controls();
};
$('reply-region').onchange = () => {
  state.replyChanged = !!state.draft.replyText.trim();
  state.draft.replyPending ||= state.replyChanged;
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
    state.id = null;
    state.revision = 0;
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
$('add-fixed').onclick = () =>
  run(
    async () => {
      if (state.draft.fixedDrivers.length >= 100)
        throw Error('고정기사는 최대 100명입니다.');
      state.draft.fixedDrivers.push(newFixedDriver());
      touch();
      renderFixed();
      renderMessages();
    },
    { edit: true },
  );
$('fixed').oninput = (e) => {
  if (!state.editable || state.busy) return;
  const f = state.draft.fixedDrivers.find(
      (f) => f.id === e.target.closest('[data-id]')?.dataset.id,
    ),
    field = e.target.dataset.field;
  if (!f || !field) return;
  const previous = f[field];
  f[field] =
    field === 'dock' ? dockNumber(e.target.value) : e.target.value.trim();
  if (['driver', 'vehicle', 'phone', 'arrival'].includes(field))
    for (const t of state.draft.trucks)
      if (t.fixedDriverId === f.id && t[field] === previous)
        t[field] = f[field];
  applyFixedDrivers(state.draft);
  touch();
  renderTrucks();
  updateOutputs();
};
$('fixed').onclick = (e) => {
  const button = e.target.closest('[data-remove-fixed]');
  if (!button) return;
  run(
    async () => {
      state.draft.fixedDrivers = state.draft.fixedDrivers.filter(
        (f) => f.id !== button.dataset.removeFixed,
      );
      applyFixedDrivers(state.draft);
      touch();
      renderFixed();
      renderTrucks();
      updateOutputs();
    },
    { edit: true },
  );
};
$('save-fixed').onclick = () =>
  run(
    async () => {
      state.fixedDefaults = await saveFixedDefaults(
        supabase,
        state.center.code,
        state.draft.fixedDrivers,
        state.fixedDefaults?.id || null,
        state.fixedDefaults?.revision || 0,
      );
      state.fixedDefaults.payload = normalizeDraft(state.fixedDefaults.payload);
      renderFixedToday();
      status('고정기사 기본값을 저장했습니다. 오늘 제외 상태는 유지됩니다.');
    },
    { edit: true },
  );
$('load-fixed').onclick = () =>
  run(
    async () => {
      if (
        state.draft.fixedDrivers.length &&
        !(await confirmDialog(
          '저장된 고정기사 기본값으로 바꿀까요? 오늘 포함 상태도 초기화됩니다.',
          { okText: '불러오기' },
        ))
      )
        return;
      await refreshFixedDefaults(true);
      touch();
      render();
      status('고정기사 기본값을 불러왔습니다.');
    },
    { edit: true },
  );
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
$('save').onclick = () => run(() => save(), { edit: true });
$('save-copy').onclick = () => run(() => save(true), { edit: true });
$('history').onchange = controls;
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
    state.photoError = '저장된 사진의 분석이 완료되지 않았습니다.';
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
$('load').onclick = () =>
  run(async () => {
    if (
      state.dirty &&
      !(await confirmDialog(
        '저장하지 않은 변경사항을 닫고 저장 내역을 불러올까요?',
        { okText: '불러오기' },
      ))
    )
      return;
    const row = await loadDraft(
      supabase,
      state.center.code,
      $('history').value,
    );
    state.draft = row.payload;
    state.id = row.id;
    state.revision = row.revision;
    state.dirty = false;
    resetTransient();
    restoreAnalysisState();
    render();
    status('저장 내역을 불러왔습니다.');
  });
$('new').onclick = () =>
  run(
    async () => {
      if (
        state.dirty &&
        !(await confirmDialog(
          '저장하지 않은 변경사항을 닫고 새 작업을 시작할까요?',
          { okText: '새 작업' },
        ))
      )
        return;
      await refreshFixedDefaults();
      state.draft = newDraft(
        defaultDate(),
        state.fixedDefaults?.payload.fixedDrivers,
      );
      state.id = null;
      state.revision = 0;
      state.dirty = false;
      resetTransient();
      render();
      status('새 작업입니다.');
    },
    { edit: true },
  );
document.addEventListener('click', (e) => {
  const copy = e.target.closest('[data-copy]');
  if (!copy) return;
  run(async () => {
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
addEventListener('beforeunload', (e) => {
  if (state.dirty || state.busy) {
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
        !(await confirmDialog(
          '저장하지 않은 변경사항을 닫고 센터를 전환할까요?',
          { okText: '전환' },
        )))
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
    await refreshHistory();
    await refreshFixedDefaults(true);
    render();
  });
}
initialize().catch((error) => status(error.message, true));
