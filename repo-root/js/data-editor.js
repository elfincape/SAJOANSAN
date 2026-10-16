import { requireRole } from './auth.js';
import { withCenterParam } from './center.js';
import { AllCommunityModule, ModuleRegistry, createGrid, themeQuartz } from 'ag-grid-community';
import ExcelJS from 'exceljs';
import Uppy from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import '@uppy/core/css/style.css';
import '@uppy/dashboard/css/style.css';

ModuleRegistry.registerModules([AllCommunityModule]);

const element = (id) => document.getElementById(id);
let api;
let columns = [];
let rows = [];
let columnSequence = 0;
let rowSequence = 0;
let busy = false;
let uppy;
let importedWorkbook = null;
let workbookFileId = null;
const fileStates = new Map();

function setBusy(value) {
  busy = value;
  element('workspace').disabled = value;
  uppy?.getPlugin('Dashboard').setOptions({ disabled: value });
  updateCounts();
  updateFileQueue();
}

function updateFileQueue() {
  if (!uppy) return;
  const files = uppy.getFiles();
  const selected = element('import-file').value;
  element('import-file').replaceChildren(...files.map((file) => new Option(file.name, file.id)));
  if (files.some((file) => file.id === selected)) element('import-file').value = selected;
  element('import-file').disabled = busy || !files.length;
  element('read-file').disabled = busy || !files.length;
  element('file-statuses').replaceChildren(...files.map((file) => {
    const item = document.createElement('li');
    const state = fileStates.get(file.id) || { text: '대기 중', stage: 'waiting' };
    const label = document.createElement('span');
    label.textContent = `${file.name}: ${state.text}`;
    item.append(label);
    if (state.stage === 'reading') {
      const progress = document.createElement('progress');
      progress.setAttribute('aria-label', `${file.name} 로컬 읽기 진행 중`);
      item.append(progress);
    }
    item.classList.toggle('error', state.stage === 'error');
    return item;
  }));
}

function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value !== 'object') return String(value);
  if ('formula' in value || 'sharedFormula' in value) return cellText(value.result);
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
  if ('error' in value) return String(value.error);
  if ('text' in value) return cellText(value.text);
  return '';
}

function validateSize(height, width) {
  if (height > 100000 || width > 500 || height * width > 2000000) {
    throw new Error('최대 100,000행 · 500열 · 2,000,000셀까지 불러올 수 있습니다. 원본 파일을 나눠 주세요.');
  }
}

function worksheetMatrix(sheet) {
  validateSize(sheet.rowCount, sheet.columnCount);
  const matrix = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => { values[columnNumber - 1] = cellText(cell.value); });
    matrix.push(values);
  });
  return matrix;
}

async function readSelectedFile() {
  const file = uppy.getFile(element('import-file').value);
  if (!file || busy) return;
  setBusy(true);
  importedWorkbook = null;
  workbookFileId = null;
  element('worksheet-controls').hidden = true;
  fileStates.set(file.id, { text: '브라우저에서 읽고 분석하는 중…', stage: 'reading' });
  updateFileQueue();
  try {
    const buffer = await file.data.arrayBuffer();
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      if (!workbook.worksheets.length) throw new Error('워크시트가 없는 파일입니다.');
      importedWorkbook = workbook;
      workbookFileId = file.id;
      element('worksheet').replaceChildren(...workbook.worksheets.map((sheet) => new Option(sheet.name, String(sheet.id))));
      element('worksheet-controls').hidden = false;
      fileStates.set(file.id, { text: `${workbook.worksheets.length}개 시트 읽기 완료 · 불러올 시트를 선택하세요.`, stage: 'ready' });
      message('워크시트를 선택하고 ‘선택 시트 불러오기’를 누르세요.');
    } else {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      const imported = replaceTable(parseTable(text, ','));
      fileStates.set(file.id, { text: imported ? '로컬 불러오기 완료' : '표 교체 취소 · 다시 읽기 가능', stage: 'ready' });
    }
  } catch (error) {
    fileStates.set(file.id, { text: error.message, stage: 'error' });
    message('파일 읽기 실패 (CSV는 UTF-8 필요): ' + error.message, true);
  } finally { setBusy(false); }
}

function importWorksheet() {
  if (!importedWorkbook || busy) return;
  setBusy(true);
  try {
    const sheet = importedWorkbook.getWorksheet(Number(element('worksheet').value));
    if (!sheet) throw new Error('워크시트를 선택하세요.');
    const imported = replaceTable(worksheetMatrix(sheet));
    fileStates.set(workbookFileId, { text: imported ? `‘${sheet.name}’ 로컬 불러오기 완료` : '시트 교체 취소', stage: 'ready' });
  } catch (error) {
    fileStates.set(workbookFileId, { text: error.message, stage: 'error' });
    message('시트 불러오기 실패: ' + error.message, true);
  } finally { setBusy(false); }
}

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
  element('download-xlsx').disabled = busy || !columns.length;
}

function renderColumns() {
  api.setGridOption('columnDefs', columns);
  element('delete-column').replaceChildren(...columns.map((column) => new Option(column.headerName, column.field)));
  updateCounts();
}

function replaceTable(matrix) {
  if (!matrix.length) throw new Error('불러올 데이터가 없습니다.');
  const width = matrix.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  validateSize(matrix.length, width);
  if (!width) throw new Error('불러올 셀이 없습니다.');
  api.stopEditing();
  if ((rows.length || columns.length) && !confirm('현재 표를 새 데이터로 바꿀까요? 필요한 데이터는 먼저 다운로드하세요.')) return false;
  const headers = element('has-header').checked ? matrix[0] : [];
  const data = element('has-header').checked ? matrix.slice(1) : matrix;
  columns = [];
  for (let index = 0; index < width; index++) columns.push(newColumn(cellText(headers[index]) || `열 ${index + 1}`));
  rows = data.map((values) => {
    const row = newRow();
    columns.forEach((column, index) => { row[column.field] = cellText(values[index]); });
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
    validateSize(Math.max(rows.length, (focused?.rowIndex ?? 0) + matrix.length), Math.max(columns.length, startColumn + width));
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
  setBusy(true);
  try {
    const { headers, data } = exportRows();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('데이터');
    sheet.addRow(headers);
    sheet.addRows(data);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => { column.width = 22; });
    const buffer = await workbook.xlsx.writeBuffer();
    download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '데이터편집.xlsx');
    message('현재 표시 조건의 데이터를 XLSX로 다운로드했습니다.');
  } catch (error) { message('XLSX 다운로드 실패: ' + error.message, true); }
  finally { setBusy(false); }
}

async function init() {
  const profile = await requireRole('editor');
  if (!profile) return;
  element('user-badge').textContent = profile.display_name || profile.email;
  element('back-link').href = withCenterParam('/admin/');
  api = createGrid(element('data-grid'), {
    theme: themeQuartz.withParams({ backgroundColor: '#18181b', foregroundColor: '#f4f4f5', headerBackgroundColor: '#27272a', accentColor: '#34d399', browserColorScheme: 'dark' }),
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
  uppy = new Uppy({
    autoProceed: false,
    restrictions: { maxFileSize: 20 * 1024 * 1024, maxNumberOfFiles: 5, allowedFileTypes: ['.csv', '.xlsx'] },
  }).use(Dashboard, {
    target: element('file-dashboard'), inline: true, height: 280, width: '100%', theme: 'dark',
    hideUploadButton: true, disableStatusBar: true, disableThumbnailGenerator: true,
    proudlyDisplayPoweredByUppy: false,
    locale: { strings: { dropPasteFiles: 'CSV 또는 XLSX 파일을 여기에 놓거나 %{browseFiles}', browseFiles: '파일 선택' } },
    note: '서버 업로드 없음 · 파일을 추가한 후 아래에서 로컬 읽기를 실행하세요.',
  });
  uppy.on('file-added', updateFileQueue);
  uppy.on('file-removed', (file) => {
    fileStates.delete(file.id);
    if (workbookFileId === file.id) {
      importedWorkbook = null;
      workbookFileId = null;
      element('worksheet-controls').hidden = true;
    }
    updateFileQueue();
  });
  uppy.on('restriction-failed', (file, error) => message(error.message, true));
  element('read-file').onclick = readSelectedFile;
  element('import-worksheet').onclick = importWorksheet;
  element('import-file').onchange = () => {
    element('worksheet-controls').hidden = element('import-file').value !== workbookFileId;
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
  message('CSV·XLSX 파일이나 붙여넣은 데이터를 불러오거나 행·열을 추가해 시작하세요.');
}

init().catch((error) => message('편집 도구 초기화 실패: ' + error.message, true));
