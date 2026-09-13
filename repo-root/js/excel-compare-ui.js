import { requireRole } from './auth.js';
import { decorateCenterLinks, forceCenterSelectionFromUrl, mountHeaderCenterSwitcher, requireSelectedCenter, withCenterParam } from './center.js';
import { readCompareSheet, compareSheets, buildCompareWorkbook, resultColumns, resultValues } from './excel-compare.js';

const $ = id => document.getElementById(id);
const sides = ['left', 'right'];
const state = Object.fromEntries(sides.map(side => [side, { book: null, data: null, name: '', revision: 0 }]));
const PAGE_SIZE = 50;
let result = null, page = 0, busy = false;

function message(text, error = false) {
  $('status').textContent = text;
  $('status').className = error ? 'error' : '';
}
function invalidate() {
  result = null; page = 0;
  $('result-section').hidden = true;
  $('download-btn').disabled = true;
  $('preview').querySelector('thead').replaceChildren();
  $('preview').querySelector('tbody').replaceChildren();
}
function bothReady() { return sides.every(side => state[side].data); }
function selectedPairs() {
  return Array.from($('pairs').querySelectorAll('.pair')).map(row => Object.fromEntries(sides.map(side => {
    const value = row.querySelector(`[data-side="${side}"]`).value;
    return [side, value === '' ? null : Number(value)];
  })));
}
function selectedImports(side) { return Array.from($(`${side}-imports`).querySelectorAll('input:checked'), input => Number(input.value)); }
function existenceOnly() { return document.querySelector('input[name="result-mode"]:checked').value === 'exists'; }
function updateReady() {
  const ready = bothReady();
  const pairs = selectedPairs();
  $('add-pair').disabled = !ready || pairs.length >= Math.min(state.left.data.columns.length, state.right.data.columns.length);
  $('run-btn').disabled = busy || !ready || !pairs.length || pairs.some(pair => pair.left == null || pair.right == null);
  $('ready-counts').textContent = ready ? `시트 1 데이터 ${state.left.data.rows.length.toLocaleString()}행 · 시트 2 데이터 ${state.right.data.rows.length.toLocaleString()}행` : '두 시트와 비교 열을 선택해 주세요.';
}
function addPair() {
  if (!bothReady()) return;
  const used = selectedPairs();
  const row = document.createElement('div'); row.className = 'pair';
  for (const side of sides) {
    if (side === 'right') {
      const arrow = document.createElement('span'); arrow.className = 'pair-arrow'; arrow.textContent = '↔'; row.append(arrow);
    }
    const select = document.createElement('select'); select.dataset.side = side;
    select.setAttribute('aria-label', `비교 쌍 ${used.length + 1} · 시트 ${side === 'left' ? 1 : 2} 열`);
    select.add(new Option(`시트 ${side === 'left' ? 1 : 2} 열 선택`, ''));
    for (const col of state[side].data.columns) select.add(new Option(col.label, String(col.index)));
    select.addEventListener('change', () => { invalidate(); updateReady(); message('비교 열이 변경되었습니다. 비교를 실행해 주세요.'); });
    row.append(select);
  }
  const remove = document.createElement('button'); remove.className = 'btn btn-ghost'; remove.type = 'button'; remove.textContent = '삭제';
  remove.setAttribute('aria-label', '이 비교 열 연결 삭제');
  remove.addEventListener('click', () => { row.remove(); invalidate(); updateReady(); message('비교 열 연결을 삭제했습니다.'); });
  row.append(remove); $('pairs').append(row); invalidate(); updateReady();
}
function renderImports() {
  for (const side of sides) {
    const other = side === 'left' ? 'right' : 'left';
    const root = $(`${side}-imports`); root.replaceChildren();
    if (!bothReady()) { root.textContent = '두 시트를 먼저 선택해 주세요.'; continue; }
    for (const col of state[other].data.columns) {
      const label = document.createElement('label'); label.className = 'column-choice';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = col.index;
      input.addEventListener('change', () => { invalidate(); message('가져올 열이 변경되었습니다. 다시 비교해 주세요.'); });
      label.append(input, document.createTextNode(col.label)); root.append(label);
    }
  }
}
function resetMapping() {
  invalidate(); $('pairs').replaceChildren();
  if (bothReady()) addPair();
  else { const hint = document.createElement('p'); hint.className = 'empty'; hint.textContent = '두 파일의 시트를 선택하면 비교 열을 연결할 수 있습니다.'; $('pairs').append(hint); }
  renderImports(); updateReady();
}
function renderSample(side) {
  const root = $(`${side}-sample`); root.replaceChildren();
  const data = state[side].data;
  if (!data) { root.textContent = '표시할 데이터가 없습니다.'; return; }
  const table = document.createElement('table');
  const head = document.createElement('tr');
  ['행', ...data.columns.map(col => col.label)].forEach(value => { const th = document.createElement('th'); th.textContent = value; head.append(th); });
  table.append(head);
  data.rows.slice(0, 3).forEach(row => {
    const tr = document.createElement('tr');
    [row.rowNumber, ...row.texts].forEach(value => { const td = document.createElement('td'); td.textContent = value; tr.append(td); });
    table.append(tr);
  });
  root.append(table);
  if (!data.rows.length) root.append(document.createTextNode('제목 행 다음에 비교할 데이터가 없습니다.'));
}
function selectSheet(side) {
  const source = state[side]; source.data = null;
  try {
    if (source.book) {
      const rawHeader = $(`${side}-header`).value;
      if (rawHeader === '') throw new Error('제목 행을 입력해 주세요. 제목이 없으면 0을 입력합니다.');
      source.data = readCompareSheet(source.book.Sheets[$(`${side}-sheet`).value], XLSX, Number(rawHeader), Boolean(source.book.Workbook?.WBProps?.date1904));
    }
    message('시트와 제목 행을 확인한 뒤 비교할 열을 연결해 주세요.');
  } catch (error) { message(error.message, true); }
  renderSample(side); resetMapping();
}
async function loadFile(side) {
  const source = state[side], current = ++source.revision;
  source.book = null; source.data = null; source.name = '';
  $(`${side}-sheet`).replaceChildren(); $(`${side}-sheet`).disabled = true; $(`${side}-header`).disabled = true;
  renderSample(side); resetMapping();
  const file = $(`${side}-file`).files[0];
  $(`${side}-info`).textContent = file ? `${file.name} · 읽는 중…` : '선택된 파일 없음 · 파일당 최대 20MB';
  if (!file) { message('엑셀 파일을 선택해 주세요.'); return; }
  try {
    if (!/\.(xlsx|xls|xlsm|xlsb)$/i.test(file.name)) throw new Error('.xlsx, .xls, .xlsm, .xlsb 파일을 선택해 주세요.');
    if (file.size > 20 * 1024 * 1024) throw new Error('파일당 최대 20MB까지 지원합니다.');
    message(`${file.name} 파일을 읽는 중…`);
    const buffer = await file.arrayBuffer();
    if (current !== source.revision) return;
    const book = XLSX.read(buffer, { type: 'array', cellNF: true, cellText: true, cellDates: false });
    if (!book.SheetNames.length) throw new Error('파일에 시트가 없습니다.');
    source.book = book; source.name = file.name;
    for (const name of book.SheetNames) $(`${side}-sheet`).add(new Option(name, name));
    $(`${side}-sheet`).disabled = false; $(`${side}-header`).disabled = false;
    $(`${side}-header`).value = '1';
    $(`${side}-info`).textContent = `${file.name} · ${book.SheetNames.length}개 시트`;
    selectSheet(side);
  } catch (error) {
    if (current !== source.revision) return;
    $(`${side}-info`).textContent = `${file.name} · 불러오기 실패`;
    message(`파일을 읽을 수 없습니다: ${error.message}`, true);
  }
}
function renderStats() {
  $('statistics').replaceChildren();
  for (const [index, side] of sides.entries()) {
    const stats = result.comparison[side].stats;
    const card = document.createElement('article'); card.className = 'panel stat-card';
    const title = document.createElement('h3'); title.textContent = `시트 ${index + 1} · ${$(`${side}-sheet`).value}`;
    const grid = document.createElement('dl'); grid.className = 'stat-grid';
    for (const [label, count, color] of [['조건 충족 행', stats.eligible, ''], ['TRUE · 존재', stats.found, 'good'], ['FALSE · 없음', stats.missing, 'warn']]) {
      const item = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = count.toLocaleString(); dd.className = color; item.append(dt, dd); grid.append(item);
    }
    const detail = document.createElement('p'); detail.className = 'stat-detail';
    detail.textContent = `데이터 ${stats.total.toLocaleString()}행 · 조건 미충족 ${stats.excluded.toLocaleString()}행 · 중복 관련 ${stats.duplicate.toLocaleString()}행${result.config.existenceOnly ? '' : ` · 값 연결 ${stats.matched.toLocaleString()}행`}`;
    card.append(title, grid, detail); $('statistics').append(card);
  }
}
function renderPreview() {
  if (!result) return;
  const side = $('result-side').value, other = side === 'left' ? 'right' : 'left';
  const filter = $('result-filter').value;
  const rows = result.comparison[side].rows.filter(row => filter === 'all' ||
    (filter === 'true' && row.exists === true) || (filter === 'false' && row.exists === false) ||
    (filter === 'excluded' && !row.eligible) || (filter === 'duplicate' && row.duplicate));
  const data = state[side].data, opposite = state[other].data, imports = result.config[`${side}Imports`];
  const headers = resultColumns(data, opposite, imports, result.config.existenceOnly);
  const thead = $('preview').querySelector('thead'), tbody = $('preview').querySelector('tbody');
  thead.replaceChildren(); tbody.replaceChildren();
  const head = document.createElement('tr');
  headers.forEach(value => { const th = document.createElement('th'); th.textContent = value; th.scope = 'col'; head.append(th); }); thead.append(head);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); page = Math.min(page, totalPages - 1);
  for (const row of rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const tr = document.createElement('tr');
    resultValues(data, opposite, row, imports, result.config.existenceOnly).forEach(value => {
      const td = document.createElement('td');
      td.textContent = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : value;
      if (typeof value === 'boolean') td.className = value ? 'true-cell' : 'false-cell';
      td.title = td.textContent; tr.append(td);
    }); tbody.append(tr);
  }
  if (!rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = headers.length; td.textContent = '해당하는 행이 없습니다.'; tr.append(td); tbody.append(tr); }
  $('page-info').textContent = `${rows.length.toLocaleString()}행 · ${page + 1} / ${totalPages}페이지 (50행씩)`;
  $('prev-page').disabled = page === 0; $('next-page').disabled = page >= totalPages - 1;
}
async function runComparison() {
  if (busy || !bothReady()) return;
  invalidate(); busy = true; $('workspace').disabled = true; updateReady();
  message('행을 비교하는 중…');
  await new Promise(resolve => setTimeout(resolve, 20));
  try {
    const config = { leftImports: selectedImports('left'), rightImports: selectedImports('right'), existenceOnly: existenceOnly(),
      labels: sides.map(side => `${state[side].name} / ${$(`${side}-sheet`).value}`) };
    if (!config.existenceOnly && !config.leftImports.length && !config.rightImports.length) throw new Error('가져올 열을 하나 이상 선택하거나, 존재 여부만 확인을 선택해 주세요.');
    const comparison = compareSheets(state.left.data, state.right.data, selectedPairs(), {
      trim: $('trim-values').checked, ignoreCase: $('ignore-case').checked, duplicates: $('duplicates').value, valueMode: $('value-mode').value
    });
    result = { comparison, config };
    $('result-side').value = 'left'; $('result-filter').value = 'all';
    renderStats(); renderPreview(); $('result-section').hidden = false; $('download-btn').disabled = false;
    message('비교가 완료되었습니다. 조건 미충족 행은 TRUE/FALSE를 비워두며, 원본 행 번호로 확인할 수 있습니다.');
  } catch (error) { invalidate(); message(error.message, true); }
  finally { busy = false; $('workspace').disabled = false; updateReady(); }
}
async function download() {
  if (!result || busy) return;
  busy = true; $('workspace').disabled = true; $('download-btn').disabled = true; message('결과 Excel 파일을 만드는 중…');
  await new Promise(resolve => setTimeout(resolve, 20));
  try {
    const book = buildCompareWorkbook(state.left.data, state.right.data, result.comparison, result.config, XLSX);
    XLSX.writeFile(book, `엑셀_시트_비교_${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
    message('양쪽 시트의 전체 결과와 비교 요약을 다운로드했습니다.');
  } catch (error) { message(`다운로드 실패: ${error.message}`, true); }
  finally { busy = false; $('workspace').disabled = false; $('download-btn').disabled = !result; updateReady(); }
}
async function initialize() {
  const profile = await requireRole('editor'); if (!profile) return;
  await requireSelectedCenter({ force: forceCenterSelectionFromUrl() });
  mountHeaderCenterSwitcher(next => location.replace(withCenterParam(location.pathname, next)));
  decorateCenterLinks(document);
  $('user-badge').textContent = profile.display_name || profile.email || '';
  if (!globalThis.XLSX) throw new Error('엑셀 라이브러리를 불러오지 못했습니다. 새로고침해 주세요.');
  for (const side of sides) {
    $(`${side}-file`).addEventListener('change', () => loadFile(side));
    $(`${side}-sheet`).addEventListener('change', () => selectSheet(side));
    $(`${side}-header`).addEventListener('input', () => selectSheet(side));
  }
  $('add-pair').addEventListener('click', addPair);
  for (const id of ['trim-values', 'ignore-case', 'duplicates', 'value-mode']) $(id).addEventListener('change', () => { invalidate(); message('조건이 변경되었습니다. 다시 비교해 주세요.'); });
  document.querySelectorAll('input[name="result-mode"]').forEach(input => input.addEventListener('change', () => {
    $('extract-options').hidden = existenceOnly(); invalidate(); message('결과 방식이 변경되었습니다. 비교를 실행해 주세요.');
  }));
  $('run-btn').addEventListener('click', runComparison); $('download-btn').addEventListener('click', download);
  for (const id of ['result-side', 'result-filter']) $(id).addEventListener('change', () => { page = 0; renderPreview(); });
  $('prev-page').addEventListener('click', () => { page--; renderPreview(); }); $('next-page').addEventListener('click', () => { page++; renderPreview(); });
  $('workspace').disabled = false; message('비교할 엑셀 파일 두 개를 선택해 주세요.');
}
initialize().catch(error => message(`초기화 실패: ${error.message}`, true));
