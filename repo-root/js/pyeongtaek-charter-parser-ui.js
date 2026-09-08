import { requireRole } from './auth.js';
import { decorateCenterLinks, forceCenterSelectionFromUrl, mountHeaderCenterSwitcher, requireSelectedCenter, withCenterParam } from './center.js';
import { parseCharterSheet, buildCharterWorkbook, displayCharterDate } from './pyeongtaek-charter-parser.js';

const $ = id => document.getElementById(id);
const PAGE_SIZE = 50;
let source = null, output = null, parsed = null, filename = '', page = 0, revision = 0;

function message(text, error = false) {
  $('status').textContent = text;
  $('status').className = error ? 'text-sm text-red-300' : 'text-sm text-zinc-300';
}
function clearResult() {
  output = null; parsed = null; page = 0;
  $('result-section').hidden = true;
  $('download-btn').disabled = true;
  $('preview').querySelector('thead').replaceChildren();
  $('preview').querySelector('tbody').replaceChildren();
}

async function initialize() {
  const profile = await requireRole('editor');
  if (!profile) return;
  await requireSelectedCenter({ force: forceCenterSelectionFromUrl() });
  mountHeaderCenterSwitcher(next => location.replace(withCenterParam(location.pathname, next)));
  decorateCenterLinks(document);
  if (!globalThis.XLSX) throw new Error('엑셀 라이브러리를 불러오지 못했습니다. 새로고침해 주세요.');
  $('source-file').disabled = false;
  message('엑셀 파일을 선택해 주세요.');
  $('source-file').addEventListener('change', loadFile);
  $('source-sheet').addEventListener('change', () => { clearResult(); message('시트가 변경되었습니다. 파싱을 실행해 주세요.'); });
  $('parse-btn').addEventListener('click', runParser);
  $('prev-page').addEventListener('click', () => { page--; renderPreview(); });
  $('next-page').addEventListener('click', () => { page++; renderPreview(); });
  $('download-btn').addEventListener('click', () => {
    if (!output) return;
    try {
      XLSX.writeFile(output, `${filename}_평택용차내역.xlsx`, { compression: true });
      message('결과 엑셀 다운로드를 시작했습니다.');
    } catch (error) { message(`다운로드 실패: ${error.message}`, true); }
  });
}

async function loadFile() {
  const current = ++revision;
  clearResult(); source = null;
  $('parse-btn').disabled = true; $('source-sheet').disabled = true;
  $('source-sheet').replaceChildren();
  const file = $('source-file').files[0];
  if (!file) { message('엑셀 파일을 선택해 주세요.'); return; }
  try {
    if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('.xlsx 또는 .xls 파일을 선택해 주세요.');
    if (file.size > 20 * 1024 * 1024) throw new Error('프로토타입은 20MB 이하 파일을 지원합니다.');
    message('파일을 읽는 중…');
    const buffer = await file.arrayBuffer();
    if (current !== revision) return;
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, cellNF: true });
    if (!workbook.SheetNames.length) throw new Error('파일에 시트가 없습니다.');
    source = workbook;
    filename = file.name.replace(/\.[^.]+$/, '');
    for (const name of source.SheetNames) $('source-sheet').add(new Option(name, name));
    $('source-sheet').disabled = false; $('parse-btn').disabled = false;
    message(`${file.name} · 시트를 확인한 뒤 파싱을 실행해 주세요.`);
  } catch (error) {
    if (current === revision) message(`파일을 읽을 수 없습니다: ${error.message}`, true);
  }
}

function runParser() {
  clearResult();
  if (!source) return;
  try {
    parsed = parseCharterSheet(source.Sheets[$('source-sheet').value], XLSX);
    output = buildCharterWorkbook(parsed, source, XLSX);
    const count = parsed.records.reduce((sum, row) => sum + row.destinations.length, 0);
    $('summary').textContent = `차량 운행 ${parsed.records.length}건 · 납품처 ${count}건`;
    $('warnings').hidden = !parsed.warnings.length;
    $('warning-count').textContent = `확인 필요 ${parsed.warnings.length}건`;
    $('warning-list').replaceChildren();
    for (const warning of parsed.warnings) {
      const li = document.createElement('li'); li.textContent = warning; $('warning-list').append(li);
    }
    renderPreview();
    $('result-section').hidden = false; $('download-btn').disabled = false;
    message('파싱이 완료되었습니다. 미리보기를 확인하고 엑셀을 다운로드하세요.');
  } catch (error) { clearResult(); message(error.message, true); }
}

function renderPreview() {
  const width = parsed.records.reduce((max, record) => Math.max(max, record.destinations.length), 0);
  const head = $('preview').querySelector('thead'), body = $('preview').querySelector('tbody');
  head.replaceChildren(); body.replaceChildren();
  function row(parent, values, tag) {
    const tr = document.createElement('tr');
    for (const value of values) { const cell = document.createElement(tag); cell.textContent = value; tr.append(cell); }
    parent.append(tr);
  }
  row(head, ['행', ...Array.from({ length: width + 6 }, (_, i) => {
    const column = XLSX.utils.encode_col(i);
    return i === 2 ? `${column} · 일자` : i >= 6 ? `${column} · 납품처${i - 5}` : column;
  })], 'th');
  const first = page * PAGE_SIZE;
  parsed.records.slice(first, first + PAGE_SIZE).forEach((record, i) => {
    row(body, [first + i + 4, '', '', displayCharterDate(record.date, !!source.Workbook?.WBProps?.date1904, XLSX), '', '', '', ...Array.from({ length: width }, (_, j) => record.destinations[j] ?? '')], 'td');
  });
  const total = Math.ceil(parsed.records.length / PAGE_SIZE);
  $('page-info').textContent = `${page + 1} / ${total} 페이지 · 전체 ${parsed.records.length}건 (다운로드는 전체 결과)`;
  $('prev-page').disabled = page === 0;
  $('next-page').disabled = page + 1 >= total;
}

initialize().catch(error => message(error.message || '페이지를 불러오지 못했습니다.', true));
