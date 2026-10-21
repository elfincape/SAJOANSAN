import * as XLSX from 'xlsx';
export type Cell = string | number | boolean | null;
export type Mapping = Record<string, number> & { headerRow: number };
export interface Source {
  file: string;
  sheet: string;
  row: number;
  raw: Cell[];
  signature?: string | null;
  contentSignature?: string | null;
}
export interface VolumeRow {
  id: string;
  source: Source;
  code: string;
  course: string;
  customer: string;
  name: string;
  address: string;
  otd: string;
  mode: string;
  notes: string;
  date: string;
  boxes: number | string | null;
  destinationCode?: string;
}
export interface ImportIssue {
  field?: string;
  code: string;
  message: string;
  severity: string;
  row?: number;
  rowId?: string;
  sourceRow?: number;
  resource?: string;
  table?: string;
}
export interface WorkbookSheet {
  name: string;
  rows: Cell[][];
  rawRows?: Cell[][];
  date1904?: boolean;
  signature?: string;
  contentSignature?: string;
}
export interface DispatchWorkbook {
  sheets: WorkbookSheet[];
  signature: string;
  contentSignature: string;
}
interface SheetMetadata {
  signature: string;
  contentSignature: string;
  file: string;
  sheet: string;
  rawRows: Cell[][];
  date1904?: boolean;
}
const sheetSources = new WeakMap<Cell[][], SheetMetadata>();
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_ROWS = 20000;
async function sha256(buffer: BufferSource) {
  return Array.from(
    new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buffer)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
const aliases = {
  code: [
    'code',
    '\uCC29\uC9C0\uCF54\uB4DC',
    '\uAC70\uB798\uCC98\uCF54\uB4DC',
    '\uB0A9\uD488\uCC98\uCF54\uB4DC',
  ],
  date: [
    'date',
    '\uBC30\uCC28\uC77C',
    '\uBC30\uCC28\uAE30\uC900\uC77C',
    '\uAE30\uC900\uC77C',
    '\uBC30\uC1A1\uC77C',
    '\uB0A9\uD488\uC77C',
    '\uC77C\uC790',
  ],
  course: [
    'course',
    '\uCF54\uC2A4',
    '\uCF54\uC2A4\uBA85',
    '\uC6D0\uB798\uCF54\uC2A4',
    '\uB178\uC120',
    '\uD638\uCC28',
  ],
  customer: [
    'customer',
    '\uACE0\uAC1D\uC0AC',
    '\uD654\uC8FC',
    '\uD654\uC8FC\uBA85',
  ],
  name: [
    'name',
    '\uCC29\uC9C0',
    '\uCC29\uC9C0\uBA85',
    '\uB0A9\uD488\uCC98',
    '\uB0A9\uD488\uCC98\uBA85',
    '\uBC30\uC1A1\uCC98',
    '\uBC30\uC1A1\uCC98\uBA85',
  ],
  address: [
    'address',
    '\uC8FC\uC18C',
    '\uBC30\uC1A1\uC9C0\uC8FC\uC18C',
    '\uCC29\uC9C0\uC8FC\uC18C',
  ],
  boxes: [
    'boxes',
    'box',
    '\uBC15\uC2A4',
    '\uBC15\uC2A4\uC218',
    '\uBC15\uC2A4\uC218\uB7C9',
    '\uC218\uB7C9',
    '\uBB3C\uB7C9',
  ],
  otd: [
    'otd',
    '\uB0A9\uD488\uB9C8\uAC10',
    '\uB9C8\uAC10\uC2DC\uAC04',
    '\uB3C4\uCC29\uC870\uAC74',
  ],
  mode: [
    'mode',
    '\uB0A9\uD488\uBC29\uC2DD',
    '\uBC30\uC1A1\uBC29\uC2DD',
    '\uB0A9\uD488\uBC29\uBC95',
  ],
  notes: ['notes', '\uBE44\uACE0', '\uBA54\uBAA8', '\uD2B9\uC774\uC0AC\uD56D'],
};
const text = (value: unknown) => (value == null ? '' : String(value).trim());
const headerKey = (value: unknown) =>
  text(value)
    .toLowerCase()
    .replace(/[\s_()\[\]-]/g, '');

function rowValues(values?: Cell[]) {
  const result = Array.from(values || [], cellValue);
  while (result.length && (result.at(-1) == null || result.at(-1) === ''))
    result.pop();
  return result;
}

function gridValues(rows: Cell[][]) {
  const result = Array.from(rows, rowValues);
  while (result.length && !result.at(-1)!.length) result.pop();
  return result;
}

// Version only: callers must also compare source coordinates or proven file aliases.
export function dispatchRowVersion(row: Partial<VolumeRow>) {
  return JSON.stringify([
    rowValues(row.source?.raw),
    ...Object.keys(aliases).map((field) =>
      field === 'code'
        ? text(row.code)
        : (row[field as keyof VolumeRow] ?? null),
    ),
  ]);
}

function cellValue(value: unknown): Cell {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value as Cell;
  if ('result' in value) return cellValue(value.result);
  if ('formula' in value || 'sharedFormula' in value)
    return '#FORMULA_WITHOUT_RESULT';
  if ('richText' in value && Array.isArray(value.richText))
    return value.richText.map((part) => part.text).join('');
  if ('text' in value) return cellValue(value.text);
  if ('error' in value) return cellValue(value.error);
  return JSON.stringify(value);
}

// The signature covers actual bytes, not name/mtime. No random or weak hash fallback.
export async function readWorkbook(file: File): Promise<DispatchWorkbook> {
  try {
    return await readWorkbookFile(file);
  } catch (cause) {
    if (/[가-힣]/.test((cause instanceof Error ? cause.message : '') || ''))
      throw cause;
    throw Object.assign(
      new Error(
        '엑셀 파일을 읽지 못했습니다. 파일 형식, 손상 여부와 브라우저 보안 연결을 확인해 주세요.',
      ),
      { cause },
    );
  }
}

async function readWorkbookFile(file: File): Promise<DispatchWorkbook> {
  if (!file || typeof file.arrayBuffer !== 'function')
    throw new Error('엑셀 파일을 선택해 주세요.');
  if (file.size > MAX_BYTES)
    throw new Error('파일은 30MB까지 가져올 수 있습니다.');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES)
    throw new Error('파일은 30MB까지 가져올 수 있습니다.');
  const signature = await sha256(buffer);
  const xlsx = XLSX;
  const book = xlsx.read(buffer, {
    type: 'array',
    cellDates: false,
    sheetRows: MAX_ROWS + 1,
  });
  const sheets: WorkbookSheet[] = book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    if (
      xlsx.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1').e.r >=
      MAX_ROWS
    )
      throw Error('시트는 원본 행 기준 20,000행까지 가져올 수 있습니다.');
    const rawRows = xlsx.utils
      .sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: true,
        range: 0,
      })
      .map((row) => row.map(cellValue));
    const rows = rawRows.map((row) => [...row]);
    for (const { s, e } of sheet['!merges'] || []) {
      if (e.r >= MAX_ROWS) throw Error('병합 영역이 20,000행 한도를 넘습니다.');
      const value = rawRows[s.r]?.[s.c] ?? null;
      for (let r = s.r; r <= e.r; r++) {
        rows[r] ||= [];
        for (let c = s.c; c <= e.c; c++) rows[r][c] = value;
      }
    }
    return {
      name,
      rows,
      rawRows,
      date1904: !!book.Workbook?.WBProps?.date1904,
    };
  });
  const contentSignature = await sha256(
    new TextEncoder().encode(
      JSON.stringify(
        sheets.map((sheet) => [
          sheet.name,
          sheet.date1904,
          gridValues(sheet.rawRows!),
          gridValues(sheet.rows),
        ]),
      ),
    ),
  );
  for (const sheet of sheets) {
    sheet.signature = signature;
    sheet.contentSignature = contentSignature;
    sheetSources.set(sheet.rows, {
      signature,
      contentSignature,
      file: file.name || '',
      sheet: sheet.name,
      rawRows: sheet.rawRows!,
      date1904: sheet.date1904,
    });
    delete sheet.rawRows;
    delete sheet.date1904;
  }
  return { sheets, signature, contentSignature };
}

export function suggestMapping(rows: Cell[][]): Mapping {
  let best: Mapping = {
    headerRow: -1,
    ...Object.fromEntries(Object.keys(aliases).map((key) => [key, -1])),
  };
  let score = 0;
  rows.slice(0, 50).forEach((row, headerRow) => {
    const keys = row.map(headerKey);
    const mapping: Mapping = { headerRow };
    for (const [field, names] of Object.entries(aliases)) {
      const matches = keys.flatMap((key, index) =>
        names.some((name) => headerKey(name) === key) ? [index] : [],
      );
      mapping[field] = matches.length === 1 ? matches[0] : -1;
    }
    const found = Object.keys(aliases).filter(
      (key) => mapping[key] >= 0,
    ).length;
    if (found > score) {
      best = mapping;
      score = found;
    }
  });
  return best;
}

function dateValue(value: unknown, date1904 = false) {
  if (typeof value === 'string' && /^\d{5}(?:\.\d+)?$/.test(value.trim()))
    value = Number(value);
  if (typeof value === 'string' && /^\d{8}$/.test(value.trim()))
    value = value.trim().replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  if (typeof value === 'number') {
    if (date1904) value += 1462;
    if (
      !Number.isFinite(value) ||
      value < 1 ||
      value > 2958465 ||
      Math.floor(value) === 60
    )
      return '';
    const days = Math.floor(value);
    return new Date(
      Date.UTC(1899, 11, 31) + (days > 60 ? days - 1 : days) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
  }
  const match = text(cellValue(value)).match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:T00:00:00(?:\.000)?Z)?$/,
  );
  if (!match) return '';
  const result = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const parsed = new Date(result + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === result
    ? result
    : '';
}

// Synchronous preview: indexes are zero-based; source.row is the original one-based row.
export function mapRows(
  rows: Cell[][],
  mapping: Mapping,
  { fileName = '', sheetName = '', date = '' } = {},
) {
  if (
    !Array.isArray(rows) ||
    rows.length > MAX_ROWS ||
    !mapping ||
    !Number.isInteger(mapping.headerRow) ||
    mapping.headerRow < -1 ||
    mapping.headerRow >= rows.length
  )
    throw new Error('제목 행과 20,000행 한도를 확인해 주세요.');
  for (const field of Object.keys(aliases)) {
    if (
      mapping[field] != null &&
      (!Number.isInteger(mapping[field]) || mapping[field] < -1)
    )
      throw new Error('열 매핑을 확인해 주세요.');
  }
  const metadata = sheetSources.get(rows);
  const sourceFile = fileName || metadata?.file || '';
  const sourceSheet = sheetName || metadata?.sheet || '';
  const parsed: VolumeRow[] = [],
    issues: ImportIssue[] = [];
  rows.forEach((input, index) => {
    if (
      index <= mapping.headerRow ||
      !input.some((value) => text(cellValue(value)) !== '')
    )
      return;
    const raw = Array.from(metadata?.rawRows[index] || input, cellValue);
    const get = (field: string) =>
      mapping[field] >= 0 ? cellValue(input[mapping[field]]) : null;
    const row: VolumeRow = {
      id: '',
      code: '',
      course: '',
      customer: '',
      name: '',
      address: '',
      otd: '',
      mode: '',
      notes: '',
      date: '',
      boxes: null as number | null,
      source: {
        file: sourceFile,
        sheet: sourceSheet,
        row: index + 1,
        raw,
        signature: metadata?.signature || null,
        contentSignature: metadata?.contentSignature || null,
      },
    };
    const rowIssues: ImportIssue[] = [];
    const issue = (field: string, code: string, message: string) =>
      rowIssues.push({
        row: index + 1,
        field,
        code,
        message,
        severity: 'error',
      });
    for (const field of [
      'code',
      'course',
      'customer',
      'name',
      'address',
      'otd',
      'mode',
      'notes',
    ] as const)
      row[field] = text(get(field));
    const inputDate = get('date');
    row.date = !(mapping.date >= 0)
      ? dateValue(date)
      : dateValue(inputDate, metadata?.date1904);
    if (!row.date)
      issue('date', 'INVALID_DATE', '올바른 배차 기준일을 입력해 주세요.');
    else if (date && row.date !== dateValue(date))
      issue(
        'date',
        'DATE_MISMATCH',
        '원본 일자가 선택한 배차 기준일과 다릅니다.',
      );
    for (const [field, label] of Object.entries({
      course: '원래 코스',
      customer: '고객사',
      name: '착지명',
      address: '주소',
    }))
      if (!row[field as keyof VolumeRow])
        issue(field, 'REQUIRED', `${label}을 확인해 주세요.`);
    const quantity = text(get('boxes'));
    row.boxes = /^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)$/.test(
      quantity,
    )
      ? Number(quantity.replaceAll(',', ''))
      : null;
    if (row.boxes === null || !Number.isFinite(row.boxes)) {
      row.boxes = null;
      issue('boxes', 'INVALID_BOXES', '박스 수는 0 이상의 숫자여야 합니다.');
    }
    const timeOnly = row.otd.match(
      /^1899-12-(?:30|31)T(\d{2}:\d{2}):\d{2}(?:\.\d+)?Z$/,
    );
    if (timeOnly) row.otd = timeOnly[1];
    if (typeof get('otd') === 'number') {
      const fraction = get('otd') as number;
      if (fraction >= 0 && fraction < 1) {
        const minutes = Math.round(fraction * 1440);
        row.otd = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      } else
        issue(
          'otd',
          'OTD_REVIEW',
          '숫자로 기록된 원본 도착 조건을 확인해 주세요.',
        );
    }
    // Whole-workbook hashes are provenance, not row versions: unrelated edits must not duplicate rows.
    row.id =
      'dispatch:v2:' +
      JSON.stringify([
        sourceFile,
        sourceSheet,
        index + 1,
        dispatchRowVersion(row),
      ]);
    issues.push(...rowIssues.map((value) => ({ ...value, rowId: row.id })));
    parsed.push(row);
  });
  return { rows: parsed, issues };
}
