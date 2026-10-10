// Existing sazocoupang layout, shared by browser download and server generation.
const START = 6, END = 23, FIRST = 9, LAST = 22;
const clone = value => JSON.parse(JSON.stringify(value || {}));
function time(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const minutes = Math.round((value % 1) * 1440);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  if (value instanceof Date) return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  const text = String(value).trim(), numeric = Number(text);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric < 1) return time(numeric);
  const m = text.match(/(오전|오후)?\s*(\d{1,2})\s*[:시]?\s*(\d{2})?/);
  if (!m) return null;
  let hour = Number(m[2]);
  if (m[1] === '오후' && hour < 12) hour += 12;
  if (m[1] === '오전' && hour === 12) hour = 0;
  if (hour > 23 || Number(m[3] || 0) > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(Number(m[3] || 0)).padStart(2, '0')}`;
}
function text(cell) {
  const value = cell?.value;
  if (value == null) return '';
  if (typeof value === 'object') return String(value.text ?? value.result ?? value.richText?.map(x => x.text || '').join('') ?? '').trim();
  return String(value).trim();
}
function candidates(cell) {
  const value = cell?.value;
  return [value instanceof Date || typeof value !== 'object' ? value : value?.result,
    value?.text, value?.richText?.map(x => x.text || '').join(''), text(cell)].map(time).filter(Boolean);
}
function findRow(sheet, value) {
  const target = time(value);
  if (!target) return null;
  for (let row = START; row <= END; row++) if (candidates(sheet.getRow(row).getCell(7)).includes(target)) return row;
  const [h, m] = target.split(':').map(Number), diff = h * 60 + m - 480;
  const fallback = START + diff / 30;
  return diff >= 0 && diff % 30 === 0 && fallback <= END ? fallback : null;
}
function label(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('입문확인 날짜를 확인해 주세요.');
  const d = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(d.valueOf()) || d.toISOString().slice(0, 10) !== date) throw Error('입문확인 날짜를 확인해 주세요.');
  return `${d.getUTCMonth() + 1}월${d.getUTCDate()}일(${['일요일','월요일','화요일','수요일','목요일','금요일','토요일'][d.getUTCDay()]})`;
}
function center(value) {
  return String(value || '').replace(/군지암|ㄱㅈㅇ/g, '곤지암').replace(/ㅍㅌ/g, '평택')
    .replace(/([가-힣])\s+(?=\d)/g, '$1').replace(/\s*(?:b2b|비투비)/gi, ' B2B')
    .replace(/\s+/g, '').replace(/B2B/g, 'b2b');
}
export async function buildCoupangWorkbook({ ExcelJS, JSZip, templateBuffer, worksheetName, date, matches, image, strict = true }) {
  const dateLabel = label(date);
  if (!ExcelJS || !JSZip || !templateBuffer || !Array.isArray(matches)) throw Error('엑셀 생성 입력을 확인해 주세요.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer);
  const sheet = workbook.getWorksheet(worksheetName) || workbook.worksheets[0];
  if (!sheet) throw Error('입문확인 시트를 찾을 수 없습니다.');
  sheet.getCell('G3').value = dateLabel;
  let sheetName = dateLabel, index = 2;
  while (workbook.worksheets.some(s => s !== sheet && s.name === sheetName)) sheetName = `${dateLabel}_${index++}`;
  sheet.name = sheetName;
  for (let row = 5; row <= END; row++) for (let col = FIRST; col <= LAST; col++) {
    const cell = sheet.getRow(row).getCell(col); cell.style = clone(cell.style);
  }
  if (image?.base64) {
    const mime = image.mediaType || 'image/png';
    if (!['image/png', 'image/jpeg', 'image/gif'].includes(mime)) throw Error('지원하는 이미지 형식을 확인해 주세요.');
    const id = workbook.addImage({ base64: `data:${mime};base64,${image.base64}`, extension: mime === 'image/jpeg' ? 'jpeg' : mime === 'image/gif' ? 'gif' : 'png' });
    let width = 0;
    for (let col = 1; col <= 5; col++) width += Math.round((sheet.getColumn(col).width || 8.43) * 7 + 5);
    const ratio = image.width && image.height ? image.height / image.width : 0.62;
    const span = Math.max(4, Math.max(80, Math.round(width * ratio)) / 20);
    sheet.addImage(id, { tl: { col: 0, row: 1 }, br: { col: 5, row: 1 + span }, editAs: 'oneCell' });
  }
  const errors = []; let written = 0;
  if (strict && matches.some(m => m.include && (!m.schedule?.reservationTime
    || !String(m.schedule?.centerRaw || '').trim() || !String(m.match?.matchedDispatch?.driver || '').trim()))) {
    throw Error('선택한 배차정보의 센터·시간·기사명을 확인해 주세요.');
  }
  for (const item of matches.filter(m => m.include && m.match?.matchedDispatch && m.schedule?.reservationTime)) {
    const row = findRow(sheet, item.schedule.reservationTime);
    if (!row) { errors.push(`${item.schedule.centerRaw} 시간 없음`); continue; }
    let col;
    for (let c = FIRST; c <= LAST; c += 2) if (!text(sheet.getRow(row).getCell(c)) && !text(sheet.getRow(row).getCell(c + 1))) { col = c; break; }
    if (!col) { errors.push(`${item.schedule.reservationTime} 자리 없음`); continue; }
    const dispatch = item.match.matchedDispatch;
    const a = sheet.getRow(row).getCell(col), b = sheet.getRow(row).getCell(col + 1);
    a.value = center(item.schedule.centerRaw); b.value = dispatch.driver || ''; a.numFmt = b.numFmt = '@';
    if (dispatch.groupFill) for (const cell of [a, b]) {
      cell.style = clone(cell.style);
      cell.style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dispatch.groupFill } };
    }
    written++;
  }
  if (strict && (!written || errors.length)) throw Error(errors.join(', ') || '입력할 배차정보가 없습니다.');
  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  const metadata = zip.file('xl/workbook.xml');
  if (metadata) zip.file('xl/workbook.xml', (await metadata.async('string')).replace(/\sfilterPrivacy="(?:1|true)"/g, ''));
  for (const path of Object.keys(zip.files).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
    zip.file(path, (await zip.file(path).async('string')).replace(/<conditionalFormatting[\s\S]*?<\/conditionalFormatting>/g, ''));
  }
  return { buffer: await zip.generateAsync({ type: 'arraybuffer' }), errors, written,
    filename: `쿠팡 입문확인_${date.replaceAll('-', '')}.xlsx` };
}
