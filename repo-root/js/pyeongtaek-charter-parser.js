// SheetJS is passed explicitly so the same engine can run in browser and tests.
const blank = cell => cell?.v == null || String(cell.v).trim() === '';

export function extractCharterCity(address) {
  const match = String(address).match(/(?:^|\s)([가-힣]+?)(?:특별자치시|광역시|특별시|시)(?=\s|$|[,()])/);
  return match?.[1] || '';
}

export function charterLayout(records) {
  const cities = records.reduce((max, row) => Math.max(max, row.cities.length), 0);
  const destinations = records.reduce((max, row) => Math.max(max, row.destinations.length), 0);
  const cityColumn = i => i < 5 ? 19 + i : 20 + i; // Y is reserved for stop count.
  const overflow = Math.max(25, cities ? cityColumn(cities - 1) + 1 : 25);
  const destinationColumn = i => i < 13 ? 6 + i : overflow + i - 13;
  const width = Math.max(25, destinations ? destinationColumn(destinations - 1) + 1 : 0, cities ? cityColumn(cities - 1) + 1 : 0);
  if (width > 16384) throw new Error('결과가 엑셀 열 한도를 초과합니다. 운행을 나누어 주세요.');
  const headers = Array(width).fill(''); headers[2] = '일자'; headers[24] = '착지수';
  for (let i = 0; i < destinations; i++) headers[destinationColumn(i)] = `납품처${i + 1}`;
  for (let i = 0; i < cities; i++) headers[cityColumn(i)] = `지역${i + 1}`;
  return { headers, cityColumn, destinationColumn, width };
}

export function parseCharterSheet(sheet, XLSX) {
  if (!sheet?.['!ref']) throw new Error('선택한 시트가 비어 있습니다.');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.r > 100002) throw new Error('프로토타입은 데이터 100,000행까지 지원합니다. 파일을 나누어 주세요.');
  // Read by column position only. Title/header merges are not data groups.
  const merges = (sheet['!merges'] || []).filter(m => m.s.c <= 1 && m.e.c >= 1 && m.s.r >= 3);
  const mergedRows = new Map();
  for (const merge of merges) {
    // Formatting-only merged tails can extend beyond the populated sheet range.
    for (let r = merge.s.r; r <= Math.min(merge.e.r, range.e.r); r++) {
      if (mergedRows.has(r)) throw new Error('B열 날짜 병합 영역이 겹칩니다.');
      mergedRows.set(r, merge);
    }
  }
  const addressRows = new Map();
  for (const merge of sheet['!merges'] || []) {
    if (merge.s.c > 7 || merge.e.c < 7 || merge.s.r < 3) continue;
    for (let r = merge.s.r; r <= Math.min(merge.e.r, range.e.r); r++) {
      if (addressRows.has(r)) throw new Error('H열 주소 병합 영역이 겹칩니다.');
      addressRows.set(r, merge);
    }
  }
  const groups = new Map(), warnings = [];
  for (let r = 3; r <= range.e.r; r++) {
    const merge = mergedRows.get(r), start = merge?.s.r ?? r;
    const date = sheet[XLSX.utils.encode_cell({ r: start, c: merge?.s.c ?? 1 })], destination = sheet[`G${r + 1}`];
    if (blank(date)) {
      if (!blank(destination)) warnings.push(`${r + 1}행: 날짜가 없어 납품처를 제외했습니다.`);
      continue;
    }
    if (date.t === 'e' || (date.f && date.v == null)) throw new Error(`B${start + 1}: 날짜 셀 오류를 확인해 주세요.`);
    if (!groups.has(start)) groups.set(start, { date: { t: date.t, v: date.v, z: date.z }, destinations: [], cities: [], stopCount: 0, addressKeys: new Set(), sourceRow: start + 1 });
    const group = groups.get(start);
    const addressMerge = addressRows.get(r);
    const addressKey = XLSX.utils.encode_cell({ r: addressMerge?.s.r ?? r, c: addressMerge?.s.c ?? 7 });
    const address = sheet[addressKey];
    if (!blank(address) && !group.addressKeys.has(addressKey)) {
      if (address.t === 'e') throw new Error(`${addressKey}: 주소 셀 오류를 확인해 주세요.`);
      group.addressKeys.add(addressKey);
      group.stopCount++;
      const city = extractCharterCity(address.v);
      group.cities.push(city);
      if (!city) warnings.push(`${addressKey}: 시·광역시 이름을 찾지 못해 지역을 비워 두었습니다.`);
    }
    if (!blank(destination)) {
      if (destination.t === 'e') throw new Error(`G${r + 1}: 납품처 셀 오류를 확인해 주세요.`);
      groups.get(start).destinations.push(String(destination.v).trim());
    }
  }
  const records = [];
  for (const record of groups.values()) {
    delete record.addressKeys;
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
  const { headers, width, cityColumn, destinationColumn } = charterLayout(parsed.records);
  const sheet = XLSX.utils.aoa_to_sheet([[], [], headers]);
  parsed.records.forEach((record, i) => {
    const r = i + 4;
    // Preserve numeric Excel dates and the source workbook's 1900/1904 epoch.
    // Copy only values and number formats, never source formulas or hyperlinks.
    sheet[`C${r}`] = { ...record.date };
    record.destinations.forEach((value, j) => {
      sheet[XLSX.utils.encode_cell({ r: r - 1, c: destinationColumn(j) })] = { t: 's', v: value };
    });
    record.cities.forEach((value, j) => {
      sheet[XLSX.utils.encode_cell({ r: r - 1, c: cityColumn(j) })] = { t: 's', v: value };
    });
    sheet[`Y${r}`] = { t: 'n', v: record.stopCount };
  });
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: parsed.records.length + 2, c: width - 1 } });
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
