import { requireRole } from './auth.js';
import { withCenterParam } from './center.js';

const element = (id) => document.getElementById(id);
let api;
let columns = [];
let rows = [];
let columnSequence = 0;
let rowSequence = 0;
let busy = false;

function message(text, error = false) {
  element('status').textContent = text;
  element('status').classList.toggle('error', error);
}

function parseTable(text, delimiter) {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const result = [];
  let row = [];
  let value = '';
  let quoted = false;
  let closed = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
        closed = true;
      } else value += character;
    } else if (character === delimiter || character === '\n') {
      row.push(value);
      value = '';
      closed = false;
      if (character === '\n') {
        result.push(row);
        row = [];
      }
    } else if (character === '"' && value === '' && !closed) quoted = true;
    else {
      if (closed) throw new Error('닫힌 따옴표 뒤의 CSV 구분자를 확인해 주세요.');
      value += character;
    }
  }
  if (quoted) throw new Error('닫히지 않은 따옴표가 있습니다. 원본 데이터를 확인해 주세요.');
  if (value !== '' || row.length || closed) result.push([...row, value]);
  return result;
}

function newColumn(name) {
  const field = 'column_' + ++columnSequence;
  return { field, headerName: name || `열 ${columns.length + 1}` };
}

function newRow() {
  return { id: 'row_' + ++rowSequence };
}

function displayedColumns() {
  const byId = new Map(columns.map((column) => [column.field, column]));
  return api.getAllDisplayedColumns().map((column) => byId.get(column.getColId())).filter(Boolean);
}

function updateCounts() {
  if (!api) return;
  element('counts').textContent = `${rows.length.toLocaleString()}행 · ${columns.length}열 · 표시 ${api.getDisplayedRowCount().toLocaleString()}행`;
  element('delete-rows').disabled = busy || !api.getSelectedRows().length;
  element('delete-column-button').disabled = busy || !columns.length;
  element('download-csv').disabled = busy || !columns.length;
  element('download-xlsx').disabled = busy || !columns.length || !window.ExcelJS;
}

function renderColumns() {
  api.setGridOption('columnDefs', columns);
  element('delete-column').replaceChildren(...columns.map((column) => new Option(column.headerName, column.field)));
  updateCounts();
}

function replaceTable(matrix) {
  if (!matrix.length) throw new Error('불러올 데이터가 없습니다.');
  const width = matrix.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  api.stopEditing();
  if (rows.length && !confirm('현재 표를 새 데이터로 바꿀까요? 필요한 데이터는 먼저 다운로드하세요.')) return false;
  const headers = element('has-header').checked ? matrix[0] : [];
  const data = element('has-header').checked ? matrix.slice(1) : matrix;
  columns = [];
  for (let index = 0; index < width; index++) columns.push(newColumn(headers[index] || `열 ${index + 1}`));
  rows = data.map((values) => {
    const row = newRow();
    columns.forEach((column, index) => { row[column.field] = values[index] ?? ''; });
    return row;
  });
  element('search').value = '';
  api.setGridOption('quickFilterText', '');
  api.setFilterModel(null);
  renderColumns();
  api.applyColumnState({ defaultState: { sort: null } });
  api.setGridOption('rowData', rows);
  updateCounts();
  message(`${rows.length.toLocaleString()}행을 불러왔습니다.`);
  return true;
}

function pasteAtCell(event) {
  if (busy) return;
  const text = event.clipboardData?.getData('text/plain');
  if (!text) return;
  if (event.target.closest('input,textarea') && !/[\t\r\n]/.test(text)) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    const matrix = parseTable(text, '\t');
    if (!matrix.length) return;
    const focused = api.getFocusedCell();
    api.stopEditing();
    const ordered = displayedColumns();
    const startColumn = Math.max(0, ordered.findIndex((column) => column.field === focused?.column.getColId()));
    const width = matrix.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    while (ordered.length < startColumn + width) {
      const column = newColumn();
      columns.push(column);
      ordered.push(column);
    }
    const startRow = focused?.rowIndex ?? 0;
    const targets = matrix.map((values, index) => {
      const existing = api.getDisplayedRowAtIndex(startRow + index)?.data;
      if (existing) return existing;
      const row = newRow();
      rows.push(row);
      return row;
    });
    matrix.forEach((values, index) => values.forEach((value, offset) => {
      targets[index][ordered[startColumn + offset].field] = value;
    }));
    renderColumns();
    api.setGridOption('rowData', [...rows]);
    message(`${matrix.length}행을 선택한 셀부터 붙여넣었습니다.`);
  } catch (error) { message(error.message, true); }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportRows() {
  api.stopEditing();
  const ordered = displayedColumns();
  const data = [];
  api.forEachNodeAfterFilterAndSort((node) => data.push(ordered.map((column) => String(node.data[column.field] ?? ''))));
  return { headers: ordered.map((column) => column.headerName), data };
}

function exportCsv() {
  const { headers, data } = exportRows();
  const escape = (value) => {
    const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const csv = [headers, ...data].map((row) => row.map(escape).join(',')).join('\r\n');
  download(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), '데이터편집.csv');
  message('현재 표시 조건의 데이터를 CSV로 다운로드했습니다.');
}

async function exportXlsx() {
  if (!window.ExcelJS) { message('ExcelJS를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.', true); return; }
  busy = true;
  element('workspace').disabled = true;
  updateCounts();
  try {
    const { headers, data } = exportRows();
    const workbook = new window.ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('데이터');
    sheet.addRow(headers);
    sheet.addRows(data);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => { column.width = 22; });
    const buffer = await workbook.xlsx.writeBuffer();
    download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '데이터편집.xlsx');
    message('현재 표시 조건의 데이터를 XLSX로 다운로드했습니다.');
  } catch (error) { message('XLSX 다운로드 실패: ' + error.message, true); }
  finally { busy = false; element('workspace').disabled = false; updateCounts(); }
}

async function init() {
  const profile = await requireRole('editor');
  if (!profile) return;
  element('user-badge').textContent = profile.display_name || profile.email;
  element('back-link').href = withCenterParam('/admin/');
  if (!window.agGrid) { message('AG Grid를 불러오지 못했습니다. 네트워크 확인 후 새로고침하세요.', true); return; }
  api = window.agGrid.createGrid(element('data-grid'), {
    theme: window.agGrid.themeQuartz.withParams({ backgroundColor: '#18181b', foregroundColor: '#f4f4f5', headerBackgroundColor: '#27272a', accentColor: '#34d399', browserColorScheme: 'dark' }),
    columnDefs: [],
    rowData: [],
    defaultColDef: { editable: true, sortable: true, filter: 'agTextColumnFilter', floatingFilter: true, resizable: true, minWidth: 100, initialWidth: 170, cellDataType: false },
    maintainColumnOrder: true,
    rowSelection: { mode: 'multiRow', selectAll: 'filtered' },
    getRowId: (params) => params.data.id,
    stopEditingWhenCellsLoseFocus: true,
    suppressDragLeaveHidesColumns: true,
    overlayNoRowsTemplate: '<span>CSV 또는 엑셀 데이터를 불러오거나 행·열을 추가하세요.</span>',
    onModelUpdated: updateCounts,
    onSelectionChanged: updateCounts,
    onCellValueChanged: () => { api.refreshClientSideRowModel('filter'); updateCounts(); },
  });
  element('data-grid').addEventListener('paste', pasteAtCell, true);
  element('search').addEventListener('input', () => api.setGridOption('quickFilterText', element('search').value));
  element('import-paste').onclick = () => {
    try { if (replaceTable(parseTable(element('paste-input').value, '\t'))) element('paste-input').value = ''; }
    catch (error) { message(error.message, true); }
  };
  element('csv-file').onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    busy = true;
    element('workspace').disabled = true;
    updateCounts();
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('20MB 이하의 CSV 파일을 선택하세요.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      replaceTable(parseTable(text, ','));
    } catch (error) { message('CSV 불러오기 실패 (UTF-8 파일 필요): ' + error.message, true); }
    finally { busy = false; event.target.value = ''; element('workspace').disabled = false; updateCounts(); }
  };
  element('add-row').onclick = () => {
    api.stopEditing();
    if (!columns.length) { columns.push(newColumn()); renderColumns(); }
    const row = newRow();
    rows.push(row);
    api.applyTransaction({ add: [row] });
    updateCounts();
    message('빈 행을 추가했습니다. 검색·필터 조건에 따라 숨겨질 수 있습니다.');
  };
  element('delete-rows').onclick = () => {
    api.stopEditing();
    const selected = api.getSelectedRows();
    if (!selected.length || !confirm(`선택한 ${selected.length}행을 삭제할까요?`)) return;
    const ids = new Set(selected.map((row) => row.id));
    rows = rows.filter((row) => !ids.has(row.id));
    api.applyTransaction({ remove: selected });
    updateCounts();
    message(`${selected.length}행을 삭제했습니다.`);
  };
  element('add-column').onclick = () => {
    api.stopEditing();
    columns.push(newColumn(element('column-name').value.trim()));
    element('column-name').value = '';
    renderColumns();
    message('열을 추가했습니다.');
  };
  element('delete-column-button').onclick = () => {
    api.stopEditing();
    const field = element('delete-column').value;
    const column = columns.find((entry) => entry.field === field);
    if (!column || !confirm(`‘${column.headerName}’ 열과 해당 데이터를 삭제할까요?`)) return;
    columns = columns.filter((entry) => entry.field !== field);
    rows.forEach((row) => { delete row[field]; });
    renderColumns();
    api.refreshClientSideRowModel('filter');
    message('열을 삭제했습니다.');
  };
  element('download-csv').onclick = exportCsv;
  element('download-xlsx').onclick = exportXlsx;
  element('workspace').disabled = false;
  updateCounts();
  message(window.ExcelJS ? '데이터를 불러오거나 행·열을 추가해 시작하세요.' : 'CSV 편집은 가능합니다. XLSX 다운로드에 필요한 ExcelJS를 불러오지 못했습니다.', !window.ExcelJS);
}

init().catch((error) => message('편집 도구 초기화 실패: ' + error.message, true));
