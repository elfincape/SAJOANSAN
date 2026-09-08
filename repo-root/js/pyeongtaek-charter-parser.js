// SheetJS is passed explicitly so the same engine can run in browser and tests.
const blank = cell => cell?.v == null || String(cell.v).trim() === '';
const label = cell => String(cell?.v ?? '').replace(/\s/g, '');

export function parseCharterSheet(sheet, XLSX) {
  if (!sheet?.['!ref']) throw new Error('선택한 시트가 비어 있습니다.');
  if (label(sheet.B3) !== '일자' || label(sheet.G3) !== '납품처명') {
    throw new Error('3행의 B열은 “일자”, G열은 “납품처명”이어야 합니다. 시트를 확인해 주세요.');
  }
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.r > 100002) throw new Error('프로토타입은 데이터 100,000행까지 지원합니다. 파일을 나누어 주세요.');
  const merges = (sheet['!merges'] || []).filter(m => m.s.c <= 1 && m.e.c >= 1 && m.e.r >= 3);
  const mergedRows = new Map();
  for (const merge of merges) {
    if (merge.s.c !== 1 || merge.e.c !== 1 || merge.s.r < 3 || merge.e.r > range.e.r) {
      throw new Error('B열 날짜 병합은 4행 이후의 B열 안에서만 허용됩니다.');
    }
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      if (mergedRows.has(r)) throw new Error('B열 날짜 병합 영역이 겹칩니다.');
      mergedRows.set(r, merge);
    }
  }
  const groups = new Map(), warnings = [];
  for (let r = 3; r <= range.e.r; r++) {
    const merge = mergedRows.get(r), start = merge?.s.r ?? r;
    const date = sheet[`B${start + 1}`], destination = sheet[`G${r + 1}`];
    if (blank(date)) {
      if (!blank(destination)) warnings.push(`${r + 1}행: 날짜가 없어 납품처를 제외했습니다.`);
      continue;
    }
    if (date.t === 'e' || (date.f && date.v == null)) throw new Error(`B${start + 1}: 날짜 셀 오류를 확인해 주세요.`);
    if (!groups.has(start)) groups.set(start, { date: { t: date.t, v: date.v, z: date.z }, destinations: [], sourceRow: start + 1 });
    if (!blank(destination)) {
      if (destination.t === 'e') throw new Error(`G${r + 1}: 납품처 셀 오류를 확인해 주세요.`);
      groups.get(start).destinations.push(String(destination.v).trim());
    }
  }
  const records = [];
  for (const record of groups.values()) {
    if (!record.destinations.length) {
      warnings.push(`${record.sourceRow}행: 납품처가 없어 운행을 제외했습니다.`);
    } else {
      if (record.destinations.length > 16378) throw new Error(`${record.sourceRow}행: 납품처 수가 엑셀 열 한도를 초과합니다.`);
      records.push(record);
    }
  }
  if (!records.length) throw new Error('파싱할 운행이 없습니다. 4행 이후의 날짜와 납품처를 확인해 주세요.');
  return { records, warnings };
}

export function buildCharterWorkbook(parsed, sourceWorkbook, XLSX) {
  const width = parsed.records.reduce((max, record) => Math.max(max, record.destinations.length), 0);
  const headers = ['', '', '일자', '', '', '', ...Array.from({ length: width }, (_, i) => `납품처${i + 1}`)];
  const sheet = XLSX.utils.aoa_to_sheet([[], [], headers]);
  parsed.records.forEach((record, i) => {
    const r = i + 4;
    // Preserve numeric Excel dates and the source workbook's 1900/1904 epoch.
    // Copy only values and number formats, never source formulas or hyperlinks.
    sheet[`C${r}`] = { ...record.date };
    record.destinations.forEach((value, j) => {
      sheet[XLSX.utils.encode_cell({ r: r - 1, c: j + 6 })] = { t: 's', v: value };
    });
  });
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: parsed.records.length + 2, c: width + 5 } });
  sheet['!cols'] = headers.map((_, i) => ({ wch: i === 2 ? 18 : i >= 6 ? 28 : 4 }));
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { WBProps: { date1904: !!sourceWorkbook.Workbook?.WBProps?.date1904 } };
  XLSX.utils.book_append_sheet(workbook, sheet, '평택 용차내역');
  return workbook;
}

export function displayCharterDate(cell, date1904, XLSX) {
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    return XLSX.SSF.format(cell.z, cell.v, { date1904 });
  }
  return String(cell.v ?? '');
}
