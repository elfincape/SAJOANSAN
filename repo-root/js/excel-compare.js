// Pure comparison/export functions. Source workbooks are never modified.
export const COMPARE_LIMITS = Object.freeze({ rows: 100000, columns: 256, cells: 2000000 });

function hasCalendarDate(format = '') {
  if (/\[[hms]+\]/i.test(format)) return false;
  const tokens = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  return /[yd]/i.test(tokens) || (/m/i.test(tokens) && !/[hs]/i.test(tokens));
}

export function cellText(cell, XLSX, date1904 = false) {
  if (!cell || cell.v == null) return '';
  if (date1904 && cell.t === 'n' && hasCalendarDate(cell.z)) {
    return XLSX.SSF.format(cell.z, cell.v + 1462);
  }
  return String(cell.w ?? XLSX.utils.format_cell({ ...cell }) ?? cell.v);
}

export function readCompareSheet(sheet, XLSX, headerRow = 1, date1904 = false) {
  if (!Number.isInteger(headerRow) || headerRow < 0) throw new Error('제목 행은 0 이상의 정수로 입력해 주세요.');
  if (!sheet?.['!ref']) throw new Error('선택한 시트가 비어 있습니다.');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const width = range.e.c + 1;
  const start = headerRow || range.s.r;
  if (headerRow && headerRow > range.e.r + 1) throw new Error('제목 행이 시트 범위를 벗어났습니다.');
  if (width > COMPARE_LIMITS.columns || range.e.r - start + 1 > COMPARE_LIMITS.rows ||
      width * (range.e.r - start + 1) > COMPARE_LIMITS.cells) {
    throw new Error('시트당 데이터 10만 행, 256열, 200만 셀까지 지원합니다. 필요한 범위를 별도 파일로 저장해 주세요.');
  }
  const columns = Array.from({ length: width }, (_, index) => {
    const letter = XLSX.utils.encode_col(index);
    const title = headerRow ? cellText(sheet[`${letter}${headerRow}`], XLSX, date1904) : '';
    return { index, letter, label: title ? `${letter} · ${title}` : `${letter}열` };
  });
  const rows = [];
  for (let r = start; r <= range.e.r; r++) {
    const cells = columns.map(col => sheet[`${col.letter}${r + 1}`] || null);
    // Keep partially filled rows and original Excel row numbers, omit fully empty rows.
    if (cells.some(cell => cell && (cell.f || (cell.v != null && String(cell.v) !== '')))) {
      rows.push({ rowNumber: r + 1, cells, texts: cells.map(cell => cellText(cell, XLSX, date1904)) });
    }
  }
  return { columns, rows, headerRow, date1904 };
}

function keyFor(row, columns, options, date1904) {
  const values = [];
  for (const column of columns) {
    const cell = row.cells[column];
    if (!cell || cell.t === 'e' || cell.v == null) return null;
    let value = options.valueMode === 'display' ? row.texts[column] : cell.v;
    if (typeof value === 'string') {
      if (!value.trim()) return null;
      if (options.trim) value = value.trim();
      if (options.ignoreCase) value = value.toLocaleLowerCase('ko-KR');
    } else if (options.valueMode === 'raw' && typeof value === 'number' && date1904 && hasCalendarDate(cell.z)) {
      value += 1462;
    }
    values.push(value);
  }
  // Tuple serialization prevents delimiter collisions between multiple columns.
  return JSON.stringify(values);
}

function indexRows(data, columns, options) {
  const keys = data.rows.map(row => keyFor(row, columns, options, data.date1904));
  const groups = new Map();
  keys.forEach((key, index) => {
    if (key == null) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  return { keys, groups };
}

export function compareSheets(left, right, pairs, options = {}) {
  if (!pairs.length) throw new Error('비교할 열을 한 쌍 이상 연결해 주세요.');
  for (const [side, data] of [['left', left], ['right', right]]) {
    const columns = pairs.map(pair => pair[side]);
    if (columns.some(col => !Number.isInteger(col) || col < 0 || col >= data.columns.length)) {
      throw new Error('각 비교 쌍에서 두 시트의 열을 모두 선택해 주세요.');
    }
    if (new Set(columns).size !== columns.length) throw new Error('같은 시트의 비교 열을 중복 선택할 수 없습니다.');
  }
  const settings = { trim: true, ignoreCase: false, duplicates: 'occurrence', valueMode: 'raw', ...options };
  if (!['raw', 'display'].includes(settings.valueMode)) throw new Error('값 비교 기준을 확인해 주세요.');
  if (!['occurrence', 'first', 'unique'].includes(settings.duplicates)) throw new Error('중복 처리 방식을 확인해 주세요.');
  const indexes = [indexRows(left, pairs.map(p => p.left), settings), indexRows(right, pairs.map(p => p.right), settings)];
  const results = [left, right].map((data, side) => {
    const own = indexes[side], other = indexes[1 - side], seen = new Map();
    const rows = data.rows.map((row, index) => {
      const key = own.keys[index];
      const matches = key == null ? [] : (other.groups.get(key) || []);
      const occurrence = seen.get(key) || 0;
      if (key != null) seen.set(key, occurrence + 1);
      let matchIndex = null;
      if (matches.length) {
        if (settings.duplicates === 'first') matchIndex = matches[0];
        else if (settings.duplicates === 'unique') matchIndex = matches.length === 1 && own.groups.get(key).length === 1 ? matches[0] : null;
        else matchIndex = matches[occurrence] ?? null;
      }
      const duplicate = key != null && ((own.groups.get(key)?.length || 0) > 1 || matches.length > 1);
      const status = key == null ? '조건 미충족' : !matches.length ? '미일치' :
        matchIndex != null ? '매칭 완료' : settings.duplicates === 'unique' ? '중복 · 추출 제외' : '중복 · 상대 행 부족';
      return { sourceIndex: index, rowNumber: row.rowNumber, eligible: key != null, exists: key == null ? null : matches.length > 0,
        matchIndex, matchCount: matches.length, duplicate, status };
    });
    return { rows, stats: {
      total: rows.length,
      eligible: rows.filter(row => row.eligible).length,
      excluded: rows.filter(row => !row.eligible).length,
      found: rows.filter(row => row.exists === true).length,
      missing: rows.filter(row => row.exists === false).length,
      matched: rows.filter(row => row.matchIndex != null).length,
      duplicate: rows.filter(row => row.duplicate).length
    } };
  });
  return { left: results[0], right: results[1], pairs: pairs.map(pair => ({ ...pair })), options: settings };
}

function snapshotCell(cell, date1904) {
  // Export cached values only: never move formulas, links, macros, or executable text into formulas.
  if (!cell || cell.v == null) return null;
  const result = { t: cell.t, v: cell.v };
  // Both source date systems can coexist in one result workbook (1900 date system).
  if (date1904 && cell.t === 'n' && hasCalendarDate(cell.z)) result.v += 1462;
  if (cell.z) result.z = cell.z;
  return result;
}

export function resultColumns(data, other, importColumns, existenceOnly) {
  return ['원본 행', '상대 시트에 존재', '매칭 상태', '상대 일치 행수', '연결된 상대 행',
    ...data.columns.map(col => `원본 ${col.label}`),
    ...(existenceOnly ? [] : importColumns.map(index => `가져옴 ${other.columns[index].label}`))];
}

export function resultValues(data, other, row, importColumns, existenceOnly) {
  const matched = row.matchIndex == null ? null : other.rows[row.matchIndex];
  return [row.rowNumber, row.exists == null ? '' : row.exists, existenceOnly ? (row.eligible ? '존재 여부 확인' : '조건 미충족') : row.status,
    row.matchCount, existenceOnly ? '' : (matched?.rowNumber ?? ''), ...data.rows[row.sourceIndex].texts,
    ...(existenceOnly ? [] : importColumns.map(index => matched?.texts[index] ?? ''))];
}

export function buildCompareWorkbook(left, right, comparison, config, XLSX) {
  const { leftImports = [], rightImports = [], existenceOnly = false, labels = ['시트 1', '시트 2'] } = config;
  const book = XLSX.utils.book_new();
  const summary = [
    ['엑셀 시트 비교', '시트 1', '시트 2'], ['파일 / 시트', ...labels],
    ['방식', existenceOnly ? '존재 여부만 확인' : '값 가져오기'],
    ['비교 기준', comparison.options.valueMode === 'raw' ? '실제 셀 값 (숫자·문자 구분)' : '셀 표시값'],
    ['매칭 조건', '모든 비교 쌍이 같아야 일치'],
    ['앞뒤 공백 무시', comparison.options.trim], ['영문 대소문자 무시', comparison.options.ignoreCase],
    ['중복 처리', { occurrence: '등장 순서대로 1:1', first: '상대 첫 행 사용', unique: '양쪽 모두 유일한 키만 추출' }[comparison.options.duplicates]],
    ['안내', '조건 미충족 행의 존재 여부는 빈칸입니다. 수식은 저장된 계산값으로 비교·추출합니다.'],
    ['안내', '서식·수식·매크로를 복제하지 않는 새 결과 파일입니다. 원본 행 순서를 유지합니다.'],
    [], ['항목', '시트 1', '시트 2']
  ];
  for (const [name, key] of [['데이터 행수', 'total'], ['조건 충족 행수', 'eligible'], ['조건 미충족 행수', 'excluded'],
    ['상대 시트에 존재 (TRUE)', 'found'], ['상대 시트에 없음 (FALSE)', 'missing'], ['중복 관련 행수', 'duplicate']]) {
    summary.push([name, comparison.left.stats[key], comparison.right.stats[key]]);
  }
  if (!existenceOnly) summary.push(['값 연결 행수', comparison.left.stats.matched, comparison.right.stats.matched]);
  summary.push([], ['비교 쌍', '시트 1 열', '시트 2 열']);
  comparison.pairs.forEach((pair, index) => summary.push([index + 1, left.columns[pair.left].label, right.columns[pair.right].label]));
  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  summarySheet['!cols'] = [{ wch: 28 }, { wch: 65 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(book, summarySheet, '비교 요약');
  for (const [data, other, result, imports, name] of [
    [left, right, comparison.left, leftImports, '시트1 결과'], [right, left, comparison.right, rightImports, '시트2 결과']
  ]) {
    if (imports.some(col => !Number.isInteger(col) || col < 0 || col >= other.columns.length)) throw new Error('가져올 열 선택이 올바르지 않습니다.');
    const headers = resultColumns(data, other, imports, existenceOnly);
    const values = [headers];
    for (const row of result.rows) {
      const matched = row.matchIndex == null ? null : other.rows[row.matchIndex];
      values.push([row.rowNumber, row.exists, existenceOnly ? (row.eligible ? '존재 여부 확인' : '조건 미충족') : row.status,
        row.matchCount, existenceOnly ? null : (matched?.rowNumber ?? null),
        ...data.rows[row.sourceIndex].cells.map(cell => snapshotCell(cell, data.date1904)),
        ...(existenceOnly ? [] : imports.map(col => snapshotCell(matched?.cells[col], other.date1904))) ]);
    }
    const sheet = XLSX.utils.aoa_to_sheet(values);
    sheet['!cols'] = headers.map((_, index) => ({ wch: index === 2 ? 24 : 20 }));
    if (values.length > 1) sheet['!autofilter'] = { ref: sheet['!ref'] };
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  return book;
}
