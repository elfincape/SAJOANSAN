import * as XLSX from 'xlsx';

export interface MatchRow { sourceRow: number; sourceValue: string; before: string; uploadRow: number | null; tText: string; matched: boolean }
export interface MatchOptions { skipHeader: boolean; ignoreSpaces: boolean }
export const firstSheet = (workbook: XLSX.WorkBook) => workbook.Sheets[workbook.SheetNames[0]];
export const sheetRange = (sheet: XLSX.WorkSheet) => sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
const cellAddress = (row: number, col: number) => XLSX.utils.encode_cell({ r: row, c: col });
const getCell = (sheet: XLSX.WorkSheet, row: number, col: number): XLSX.CellObject | undefined => sheet[cellAddress(row, col)];
function getCellText(sheet: XLSX.WorkSheet, row: number, col: number) {
  const cell = getCell(sheet, row, col);
  return cell ? String(cell.w ?? cell.v ?? '').trim() : '';
}
function cloneCell(cell?: XLSX.CellObject): XLSX.CellObject {
  if (!cell) return { t: 's', v: '' };
  const cloned = { ...cell }; delete cloned.w; return cloned;
}
function normalizeKey(value: string, ignoreSpaces: boolean) {
  let key = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (ignoreSpaces) key = key.replace(/\s/g, '');
  return key.toLowerCase();
}
export function matchWorkbooks(source: XLSX.WorkBook, upload: XLSX.WorkBook, options: MatchOptions) {
  const output = XLSX.read(XLSX.write(source, { bookType: 'xlsx', type: 'array' }), { type: 'array', cellDates: true });
  const sourceSheet = firstSheet(output), uploadSheet = firstSheet(upload);
  const sourceRange = sheetRange(sourceSheet), uploadRange = sheetRange(uploadSheet);
  const uploadMap = new Map<string, { row: number; pValue: string; tText: string; tCell?: XLSX.CellObject }>();
  const startRow = options.skipHeader ? 1 : 0;
  if (uploadRange) for (let r = Math.max(uploadRange.s.r, startRow); r <= uploadRange.e.r; r++) {
    const pValue = getCellText(uploadSheet, r, 15), key = normalizeKey(pValue, options.ignoreSpaces);
    if (!key || uploadMap.has(key)) continue;
    uploadMap.set(key, { row: r, pValue, tText: getCellText(uploadSheet, r, 19), tCell: getCell(uploadSheet, r, 19) });
  }
  const matches: MatchRow[] = [];
  if (sourceRange) {
    sourceRange.e.c = Math.max(sourceRange.e.c, 8); sourceSheet['!ref'] = XLSX.utils.encode_range(sourceRange);
    for (let r = Math.max(sourceRange.s.r, startRow); r <= sourceRange.e.r; r++) {
      const hValue = getCellText(sourceSheet, r, 7);
      if (!hValue) continue;
      const hit = uploadMap.get(normalizeKey(hValue, options.ignoreSpaces)), before = getCellText(sourceSheet, r, 8);
      if (hit) sourceSheet[cellAddress(r, 8)] = cloneCell(hit.tCell || { t: 's', v: hit.tText });
      matches.push({ sourceRow: r + 1, sourceValue: hValue, before, uploadRow: hit ? hit.row + 1 : null, tText: hit ? hit.tText : '', matched: !!hit });
    }
  }
  return { output, matches, uploadCount: uploadMap.size };
}
