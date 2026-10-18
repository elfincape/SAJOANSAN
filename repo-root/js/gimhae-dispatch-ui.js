import { requireAuth } from './auth.js';
import { supabase } from './supabase.js';
import {
  requireSelectedCenter,
  mountHeaderCenterSwitcher,
  setSelectedCenterCode,
} from './center.js';
import { menuPermissions } from './menu-permissions.js';
import { permissionAllowed } from './portal-permissions.js';
import { confirmDialog } from './ui.js';
import {
  REGIONS,
  newDraft,
  newRequest,
  newTruck,
  normalizeDraft,
  carrierFor,
  regionName,
  numberValue,
  dockNumber,
  syncSlots,
  reconcileDocks,
  importRequest,
  applyReply,
  messages,
  issues,
  filledTruck,
  validDate,
  defaultDate,
} from './gimhae-dispatch-model.js';
import {
  listDrafts,
  loadDraft,
  saveDraft,
  analyze,
  imageData,
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
  tab: 'request',
  center: null,
  copied: new Map(),
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
    total = d.requests.reduce((n, r) => n + r.count, 0),
    filled = d.trucks.filter((t) => t.vehicle && t.driver && t.phone).length;
  $('count').textContent = `요청 ${total}대 · 회신 ${filled}대`;
  $('reply-count').textContent = `${d.trucks.length}대`;
  $('saved').textContent = state.dirty
    ? '저장 전 변경사항'
    : state.id
      ? `저장됨 · v${state.revision}`
      : '새 작업';
}
function controls() {
  for (const el of $('work').querySelectorAll('button,input,select,textarea')) {
    el.disabled =
      state.busy || (!state.editable && el.hasAttribute('data-edit'));
  }
  $('analyze-request').disabled ||= !state.draft.image;
  $('remove-image').disabled ||= !state.draft.image;
  $('analyze-reply').disabled ||= !state.draft.replyText.trim();
  $('load').disabled ||= !$('history').value;
  for (const button of document.querySelectorAll('[data-copy]')) {
    const cj = ['cj', 'summary'].includes(button.dataset.copy);
    button.disabled = state.busy || issues(state.draft, cj).length > 0;
  }
  $('drop').setAttribute(
    'aria-disabled',
    String(state.busy || !state.editable),
  );
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
function renderVolumes() {
  $('volumes').innerHTML = state.draft.volumes
    .map(
      (v, i) =>
        `<tr data-index="${i}"><td>${escape(v.region)}</td><td>${input('frozen', v.frozen, v.region + ' 냉동 팔레트', 'number', 'min="0" step="0.1" max="100000"')}</td><td>${input('chilled', v.chilled, v.region + ' 냉장 팔레트', 'number', 'min="0" step="0.1" max="100000"')}</td><td data-total>${v.frozen != null && v.chilled != null ? v.frozen + v.chilled : '-'}</td></tr>`,
    )
    .join('');
}
function renderRequests() {
  $('requests').innerHTML = state.draft.requests
    .map(
      (r) => `<tr data-id="${escape(r.id)}">
    <td>${select(
      'region',
      r.region,
      REGIONS.map((v) => [v, v]),
      '요청 지역',
    )}</td>
    <td>${select(
      'temperature',
      r.temperature,
      [
        ['', '선택'],
        ['냉장', '냉장'],
        ['냉동', '냉동'],
        ['냉동&냉장', '냉동&냉장'],
      ],
      '요청 온도',
    )}</td>
    <td>${input('tons', r.tons, '요청 톤수', 'number', 'min="0.1" max="30" step="0.1"')}</td>
    <td>${input('count', r.count, '요청 대수', 'number', 'min="1" max="30" step="1"')}</td>
    <td>${select(
      'carrier',
      r.carrier,
      [
        ['', '자동 · ' + carrierFor(r.region, state.draft.date)],
        ['광신', '광신'],
        ['동진', '동진'],
        ['해피', '해피'],
      ],
      '요청 운수사',
    )}</td>
    <td><button class="btn btn-ghost" data-remove-request="${escape(r.id)}" data-edit>삭제</button></td></tr>`,
    )
    .join('');
  $('request-empty').hidden = !!state.draft.requests.length;
}
function renderTrucks() {
  const choices = [
    ['', '요청 연결 필요'],
    ...state.draft.requests.map((r, i) => [
      r.id,
      `${i + 1}. ${r.region} ${r.temperature} ${r.tons ?? '?'}톤`,
    ]),
  ];
  $('trucks').innerHTML = state.draft.trucks
    .map(
      (
        t,
        i,
      ) => `<tr data-id="${escape(t.id)}" class="${state.draft.requests.some((r) => r.id === t.requestId) ? '' : 'gm-unlinked'}">
    <td>${select('requestId', t.requestId, choices, '차량 요청 연결')}${!t.requestId && t.region ? `<span class="gm-muted">${escape(t.region)}</span>` : ''}${t.actualTons != null ? `<span class="gm-muted">회신 차량 ${escape(t.actualTons)}톤</span>` : ''}</td>
    <td>${input('dock', t.dock, '도크 번호', 'text', 'maxlength="20"')}</td>
    <td>${input('driver', t.driver, '기사명', 'text', 'maxlength="80"')}</td>
    <td>${input('vehicle', t.vehicle, '차량번호', 'text', 'maxlength="40"')}</td>
    <td>${input('phone', t.phone, '기사 연락처', 'tel', 'maxlength="40"')}</td>
    <td>${input('arrival', t.arrival, '입차시간 조건', 'text', 'maxlength="80"')}</td>
    <td><textarea data-field="loadText" rows="2" maxlength="1000" aria-label="차량별 상차량·조건" data-edit>${escape(t.loadText)}</textarea></td>
    <td><div class="gm-row-actions"><button data-move="-1" aria-label="차량 ${i + 1} 위로" title="위로" data-edit>&#8593;</button><button data-move="1" aria-label="차량 ${i + 1} 아래로" title="아래로" data-edit>&#8595;</button><button data-remove-truck="${escape(t.id)}" aria-label="차량 ${i + 1} 삭제" title="차량 삭제" data-edit>&#215;</button></div></td></tr>`,
    )
    .join('');
  $('truck-empty').hidden = !!state.draft.trucks.length;
}
function renderMessages() {
  const findings = issues(state.draft, true);
  $('issues').textContent = findings.length
    ? [...new Set(findings)].slice(0, 6).join(' / ')
    : '';
  $('carrier-messages').replaceChildren();
  $('cj-messages').replaceChildren();
  for (const message of messages(state.draft)) {
    const article = document.createElement('article');
    article.className = 'gm-message';
    const copied = state.copied.get(message.key);
    article.innerHTML = `<div class="gm-section-head"><h3>${escape(message.title)}</h3><span class="gm-message-status">${copied === message.text ? '복사됨' : copied ? '복사 후 변경됨' : ''}</span><button class="btn btn-primary" data-copy="${escape(message.key)}">복사</button></div><textarea rows="12" readonly aria-label="${escape(message.title)}">${escape(message.text)}</textarea>`;
    $(
      ['cj', 'summary'].includes(message.key)
        ? 'cj-messages'
        : 'carrier-messages',
    ).append(article);
  }
  if (!$('carrier-messages').children.length)
    $('carrier-messages').textContent =
      '차량 요청을 입력하면 전달문이 생성됩니다.';
}
function render() {
  $('date').value = state.draft.date;
  $('reply').value = state.draft.replyText;
  $('instructions').value = state.draft.instructions;
  const image = $('image');
  if (state.draft.image) image.src = state.draft.image;
  else image.removeAttribute('src');
  image.hidden = !state.draft.image;
  $('image-empty').hidden = !!state.draft.image;
  $('image-name').textContent = state.draft.imageName;
  renderVolumes();
  renderRequests();
  renderTrucks();
  renderMessages();
  counters();
  controls();
}
function tab(name, focus = false) {
  state.tab = name;
  for (const key of ['request', 'reply', 'messages']) {
    const selected = key === name,
      button = $('tab-' + key);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    $('panel-' + key).hidden = !selected;
  }
  if (name === 'messages') renderMessages();
  if (name === 'reply') renderTrucks();
  controls();
  if (focus) $('tab-' + name).focus();
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
  state.draft = normalizeDraft(result.payload);
  state.dirty = false;
  counters();
  status('저장했습니다.');
  try {
    await refreshHistory();
  } catch {
    status('저장은 완료했습니다. 저장 목록 새로고침에 실패했습니다.', true);
  }
}
async function setImage(file) {
  await run(
    async () => {
      const data = await imageData(file);
      state.draft.image = data;
      state.draft.imageName = file.name || '붙여넣은 사진';
      touch();
      render();
      status('사진을 등록했습니다.');
    },
    { edit: true },
  );
}
$('file').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) setImage(file);
});
$('drop').onclick = () => {
  if (state.editable && !state.busy) $('file').click();
};
$('drop').onkeydown = (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    $('drop').click();
  }
};
$('drop').ondragover = (e) => {
  e.preventDefault();
  $('drop').dataset.drag = 'true';
};
$('drop').ondragleave = () => delete $('drop').dataset.drag;
$('drop').ondrop = (e) => {
  e.preventDefault();
  delete $('drop').dataset.drag;
  if (e.dataTransfer.files?.[0]) setImage(e.dataTransfer.files[0]);
};
document.addEventListener('paste', (e) => {
  if (state.tab !== 'request' || !state.editable || state.busy) return;
  const item = [...(e.clipboardData?.items || [])].find((x) =>
    x.type.startsWith('image/'),
  );
  if (item) {
    e.preventDefault();
    setImage(item.getAsFile());
  }
});
$('remove-image').onclick = () =>
  run(
    async () => {
      state.draft.image = '';
      state.draft.imageName = '';
      touch();
      render();
    },
    { edit: true },
  );
$('analyze-request').onclick = () =>
  run(
    async () => {
      if (
        state.draft.requests.length &&
        !(await confirmDialog(
          '사진 분석 결과로 요청표와 차량 칸을 새로 작성합니다. 현재 내용을 먼저 저장했나요?',
          { okText: '새로 작성' },
        ))
      )
        return;
      status('CJ 요청 사진 분석 중…');
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
      touch();
      render();
      status(
        validDate(result.date)
          ? '사진의 요청 날짜와 물량·차량 요청을 반영했습니다.'
          : '사진에서 날짜를 읽지 못했습니다. 현재 기준날짜를 확인해 주세요.',
        !validDate(result.date),
      );
    },
    { edit: true },
  );
$('analyze-reply').onclick = () =>
  run(
    async () => {
      status('운수사 회신 분석 중…');
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
      touch();
      render();
      status('회신 순서대로 배차정보와 상차량을 반영했습니다.');
    },
    { edit: true },
  );
$('reply').oninput = (e) => {
  state.draft.replyText = e.target.value;
  touch();
  controls();
};
$('instructions').oninput = (e) => {
  state.draft.instructions = e.target.value;
  touch();
};
$('date').onchange = (e) => {
  if (!validDate(e.target.value)) {
    e.target.value = state.draft.date;
    return;
  }
  if (state.draft.date !== e.target.value && state.id) {
    state.id = null;
    state.revision = 0;
    status(
      '새 날짜의 사본으로 저장됩니다. 이전 날짜의 저장 내역은 유지됩니다.',
    );
  }
  state.draft.date = e.target.value;
  touch();
  renderRequests();
  controls();
};
$('volumes').oninput = (e) => {
  const row = e.target.closest('[data-index]');
  if (!row || !e.target.dataset.field) return;
  const v = state.draft.volumes[Number(row.dataset.index)];
  v[e.target.dataset.field] = numberValue(e.target.value);
  row.querySelector('[data-total]').textContent =
    v.frozen != null && v.chilled != null ? v.frozen + v.chilled : '-';
  touch();
};
$('requests').onchange = (e) => {
  if (!state.editable || state.busy) return;
  const row = state.draft.requests.find(
      (r) => r.id === e.target.closest('[data-id]')?.dataset.id,
    ),
    field = e.target.dataset.field;
  if (!row || !field) return;
  const value = ['count', 'tons'].includes(field)
    ? numberValue(e.target.value)
    : e.target.value;
  if (
    field === 'count' &&
    (!Number.isInteger(value) ||
      value < 1 ||
      value > 30 ||
      state.draft.requests.reduce(
        (sum, r) => sum + (r.id === row.id ? value : r.count),
        0,
      ) > 100)
  ) {
    status('대수는 항목당 1~30대, 전체 100대 이내입니다.', true);
    e.target.value = row.count;
    return;
  }
  row[field] = value;
  try {
    syncSlots(state.draft);
    touch();
    renderRequests();
    controls();
  } catch (error) {
    status(error.message, true);
  }
};
$('requests').onclick = (e) => {
  const button = e.target.closest('[data-remove-request]');
  if (!button) return;
  run(
    async () => {
      if (
        !(await confirmDialog('이 요청과 연결된 차량정보를 삭제할까요?', {
          okText: '삭제',
        }))
      )
        return;
      state.draft.requests = state.draft.requests.filter(
        (r) => r.id !== button.dataset.removeRequest,
      );
      state.draft.trucks = state.draft.trucks.filter(
        (t) => t.requestId !== button.dataset.removeRequest,
      );
      touch();
      render();
    },
    { edit: true },
  );
};
$('add-request').onclick = () =>
  run(
    async () => {
      if (state.draft.requests.length >= 60)
        throw Error('요청 항목은 최대 60개입니다.');
      state.draft.requests.push(newRequest());
      syncSlots(state.draft);
      touch();
      render();
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
  row[field] = e.target.value;
  if (field === 'requestId') {
    const r = state.draft.requests.find((r) => r.id === row.requestId);
    row.region = r?.region || row.region;
    reconcileDocks(state.draft);
    e.target.closest('tr').classList.toggle('gm-unlinked', !r);
    renderTrucks();
    controls();
  }
  touch();
};
$('trucks').onchange = (e) => {
  if (e.target.dataset.field === 'dock') {
    const row = state.draft.trucks.find(
      (t) => t.id === e.target.closest('[data-id]')?.dataset.id,
    );
    if (row) {
      e.target.value = row.dock = dockNumber(e.target.value);
      row.dockManual = true;
    }
  }
};
$('trucks').onclick = (e) => {
  const button = e.target.closest('[data-move],[data-remove-truck]');
  if (!button) return;
  run(
    async () => {
      const id = button.closest('[data-id]').dataset.id,
        index = state.draft.trucks.findIndex((t) => t.id === id);
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
      counters();
    },
    { edit: true },
  );
};
$('add-truck').onclick = () =>
  run(
    async () => {
      if (state.draft.trucks.length >= 100)
        throw Error('차량은 최대 100대입니다.');
      state.draft.trucks.push(newTruck());
      touch();
      renderTrucks();
    },
    { edit: true },
  );
$('save').onclick = () => run(() => save(), { edit: true });
$('save-copy').onclick = () => run(() => save(true), { edit: true });
$('history').onchange = controls;
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
    state.copied.clear();
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
      state.draft = newDraft(defaultDate());
      state.id = null;
      state.revision = 0;
      state.dirty = false;
      state.copied.clear();
      render();
      tab('request');
      status('새 작업입니다.');
    },
    { edit: true },
  );
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-tab],[data-go]');
  if (go && !state.busy) tab(go.dataset.tab || go.dataset.go);
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
      status(
        '클립보드 접근이 제한되어 문구를 선택했습니다. 복사해 주세요.',
        true,
      );
      return;
    }
    state.copied.set(key, message.text);
    renderMessages();
    status(message.title + ' 문구를 복사했습니다.');
  });
});
document.querySelector('[role="tablist"]').onkeydown = (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const tabs = ['request', 'reply', 'messages'],
    index = tabs.indexOf(state.tab);
  tab(
    e.key === 'Home'
      ? tabs[0]
      : e.key === 'End'
        ? tabs[2]
        : tabs[(index + (e.key === 'ArrowRight' ? 1 : 2)) % 3],
    true,
  );
};
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
  await run(refreshHistory);
}
initialize().catch((error) => status(error.message, true));
