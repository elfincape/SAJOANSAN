import { charterRegion, VEHICLE_TONS } from './pyeongtaek-charter-rates.js';
// SheetJS is passed explicitly so the same engine can run in browser and tests.
const blank = cell => cell?.v == null || String(cell.v).trim() === '';

export function extractCharterCity(address) {
  return charterRegion(address).name;
}

export function charterLayout(records) {
  const cities = records.reduce((max, row) => Math.max(max, row.cities.length), 0);
  const destinations = records.reduce((max, row) => Math.max(max, row.destinations.length), 0);
  if (cities > 12) throw new Error('한 운행의 착지가 12개를 초과하여 T~AE열에 모두 담을 수 없습니다. 운행을 나누어 주세요.');
  const cityColumn = i => 19 + i;
  const overflow = 32; // AF is total stops, destination overflow starts at AG.
  const destinationColumn = i => i < 13 ? 6 + i : overflow + i - 13;
  const width = Math.max(32, destinations ? destinationColumn(destinations - 1) + 1 : 0);
  if (width > 16384) throw new Error('결과가 엑셀 열 한도를 초과합니다. 운행을 나누어 주세요.');
  const headers = Array(width).fill(''); headers[2] = '일자'; headers[4] = '원본 S열'; headers[5] = '톤수'; headers[31] = '총착지';
  for (let i = 0; i < destinations; i++) headers[destinationColumn(i)] = `납품처${i + 1}`;
  for (let i = 0; i < 12; i++) headers[cityColumn(i)] = `지역${i + 1}`;
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
  const fieldRows = new Map();
  for (const col of [16, 18]) {
    const cells = new Map();
    for (const m of sheet['!merges'] || []) {
      if (m.s.c > col || m.e.c < col || m.s.r < 3) continue;
      for (let r = m.s.r; r <= Math.min(m.e.r, range.e.r); r++) cells.set(r, m);
    }
    fieldRows.set(col, cells);
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
    if (!groups.has(start)) groups.set(start, { date: { t: date.t, v: date.v, z: date.z }, destinations: [], cities: [], stopCount: 0, stops: new Map(), sourceRow: start + 1 });
    const group = groups.get(start);
    for (const [col, field] of [[16, 'sourceQ'], [18, 'sourceS']]) {
      const m = fieldRows.get(col).get(r);
      const cell = sheet[XLSX.utils.encode_cell({ r: m?.s.r ?? r, c: m?.s.c ?? col })];
      if (blank(cell)) continue;
      if (cell.t === 'e') throw new Error(`${r + 1}행: ${XLSX.utils.encode_col(col)}열 셀 오류를 확인해 주세요.`);
      if (group[field] && String(group[field].v) !== String(cell.v)) throw new Error(`${start + 1}행 운행의 ${XLSX.utils.encode_col(col)}열 값이 여러 개입니다. 운행별 값을 확인해 주세요.`);
      group[field] = { t: cell.t, v: cell.v, z: cell.z };
    }
    const addressMerge = addressRows.get(r);
    const addressKey = XLSX.utils.encode_cell({ r: addressMerge?.s.r ?? r, c: addressMerge?.s.c ?? 7 });
    const address = sheet[addressKey];
    const stopKey = blank(address) ? `missing:${r}` : addressKey;
    if (!group.stops.has(stopKey)) group.stops.set(stopKey, { destinations: [], city: '', rate: null, hasAddress: !blank(address) });
    const stop = group.stops.get(stopKey);
    if (!blank(address) && !stop.read) {
      if (address.t === 'e') throw new Error(`${addressKey}: 주소 셀 오류를 확인해 주세요.`);
      stop.read = true;
      group.stopCount++;
      const region = charterRegion(address.v);
      stop.city = region.name; stop.rate = region.rate;
      if (!region.rate) warnings.push(`${addressKey}: “${region.name || address.v}”의 단가가 없어 정렬 시 뒤에 배치합니다.`);
    }
    if (!blank(destination)) {
      if (destination.t === 'e') throw new Error(`G${r + 1}: 납품처 셀 오류를 확인해 주세요.`);
      stop.destinations.push(String(destination.v).trim());
    }
  }
  const records = [];
  for (const record of groups.values()) {
    const stops = [...record.stops.values()];
    const ton = String(Number(record.sourceQ?.v));
    if (VEHICLE_TONS.includes(ton)) {
      stops.sort((a, b) => (b.rate?.rates[ton] ?? -1) - (a.rate?.rates[ton] ?? -1));
    } else if (record.stopCount) warnings.push(`${record.sourceRow}행: Q열 톤수에 해당하는 단가가 없어 원본 순서를 유지합니다.`);
    record.destinations = stops.flatMap(stop => stop.destinations);
    record.cities = stops.filter(stop => stop.hasAddress).map(stop => stop.city);
    delete record.stops;
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
    if (record.sourceQ) sheet[`F${r}`] = { ...record.sourceQ };
    if (record.sourceS) sheet[`E${r}`] = { ...record.sourceS };
    record.destinations.forEach((value, j) => {
      sheet[XLSX.utils.encode_cell({ r: r - 1, c: destinationColumn(j) })] = { t: 's', v: value };
    });
    record.cities.forEach((value, j) => {
      sheet[XLSX.utils.encode_cell({ r: r - 1, c: cityColumn(j) })] = { t: 's', v: value };
    });
    sheet[`AF${r}`] = { t: 'n', v: record.stopCount };
  });
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: parsed.records.length + 2, c: width - 1 } });
  sheet['!cols'] = headers.map((_, i) => ({ wch: i === 2 ? 18 : i === 4 ? 20 : i === 5 ? 10 : i >= 6 ? 28 : 4 }));
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
