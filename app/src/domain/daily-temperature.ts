import type ExcelJS from 'exceljs';
export const TABLE_START_ROW=5;
export type TemperatureField=keyof typeof COLS;
export type TemperatureRow=Record<TemperatureField,string> & {_sourceRow:number|null;_styleSourceRole:string};
export interface TemperatureDefaults {branch:string;center:string;day:string;partition:string}
export interface TemperatureTemplate {workbook:ExcelJS.Workbook;worksheetName:string;rows:TemperatureRow[];sourceRowCount:number;sourceLastRow:number;roleHeaderRows:Record<string,number>}
  export const VB_SELECTION_CHANGE_CODE = `Private Sub Worksheet_SelectionChange(ByVal Target As Range)
    Dim shp As Shape
    Dim cel As Range
    Dim realTop As Double
    Dim realLeft As Double
    Const SAFE_MARGIN As Double = 3

    On Error Resume Next

    If ActiveSheet.Shapes.Count > 0 Then
        For Each shp In ActiveSheet.Shapes
            If Not shp.TopLeftCell Is Nothing Then
                Set cel = shp.TopLeftCell

                realTop = shp.Top + SAFE_MARGIN
                realLeft = shp.Left + SAFE_MARGIN

                If realTop > (cel.Top + cel.Height) Then
                    Set cel = cel.Offset(1, 0)
                End If

                If realLeft > (cel.Left + cel.Width) Then
                    Set cel = cel.Offset(0, 1)
                End If

                If Abs(shp.Left - cel.Left) > 1 Or _
                   Abs(shp.Top - cel.Top) > 1 Or _
                   Abs(shp.Width - cel.Width) > 1 Or _
                   Abs(shp.Height - cel.Height) > 1 Then

                    With shp
                        .LockAspectRatio = msoFalse
                        .Left = cel.Left
                        .Top = cel.Top
                        .Width = cel.Width
                        .Height = cel.Height
                    End With
                End If
            End If
        Next shp
    End If

    On Error GoTo 0
End Sub`;
  export const ROLE_ORDER = ['고정', '광역', '임시'];
  export const COLS = {
    seq: 2,
    branch: 3,
    center: 4,
    date: 5,
    carrier: 6,
    dm: 7,
    vehicle_no: 8,
    vehicle_type: 9,
    freezer_temp: 10,
    refrigerated_temp: 11,
    freezer_normal: 12,
    refrigerated_normal: 13,
    compliance: 14,
    partition_wall: 15,
    photo_partition: 16,
    photo_temp_log: 17,
    remark: 18
  };
  export const FIELDS = Object.keys(COLS) as TemperatureField[];
  export function extractRows(worksheet: ExcelJS.Worksheet) {
    const rows = [];
    const lastRow = Math.max(worksheet.rowCount || 0, worksheet.actualRowCount || 0, TABLE_START_ROW);
    for (let rowNumber = TABLE_START_ROW; rowNumber <= lastRow; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const record = { _sourceRow: rowNumber, _styleSourceRole: normalizeRole(cellText(row.getCell(COLS.vehicle_type))) || '고정' } as TemperatureRow;
      FIELDS.forEach(field => { record[field] = cellText(row.getCell(COLS[field])); });
      const hasAnyValue = FIELDS.some(field => record[field] !== '');
      const role = normalizeRole(record.vehicle_type);
      if (!hasAnyValue) continue;
      if (role && !record.dm && !record.vehicle_no && !record.carrier) continue;
      if (!role && !record.dm && !record.vehicle_no) continue;
      record.vehicle_type = role || record.vehicle_type || '고정';
      if (!record.compliance) record.compliance = '준수';
      if (!record.partition_wall) record.partition_wall = 'X';
      rows.push(record);
    }
    return rows;
  }

  export function collectRoleHeaderRows(worksheet: ExcelJS.Worksheet) {
    const headers: Record<string,number> = {};
    const lastRow = Math.max(worksheet.rowCount || 0, worksheet.actualRowCount || 0, TABLE_START_ROW);
    for (let rowNumber = TABLE_START_ROW; rowNumber <= lastRow; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const role = normalizeRole(cellText(row.getCell(COLS.vehicle_type)));
      if (!role || headers[role]) continue;
      const hasData = (['carrier', 'dm', 'vehicle_no'] as TemperatureField[]).some(field => cellText(row.getCell(COLS[field])) !== '');
      if (!hasData) headers[role] = rowNumber;
    }
    return headers;
  }

  export function parseEmbeddedDispatch(raw: string) {
    const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const chunks = text.split(/[ \t]\/(?=[ \t\n])/);
    const results = [];

    for (const chunk of chunks) {
      const lines = chunk.split('\n').map(line => line.trim()).filter(Boolean);
      let i = 0;
      while (i < lines.length) {
        if (!embeddedHasTonnage(lines[i])) { i++; continue; }
        if (i + 2 >= lines.length) break;

        const batchSpecs = embeddedTonCountSpecs(lines[i]);
        if (batchSpecs.length > 0) {
          const { name, tons } = embeddedBatchNameTon(lines[i], batchSpecs);
          if (!name) { i++; continue; }
          let offset = 1;
          let parsedCount = 0;
          for (const ton of tons) {
            if (i + offset + 1 >= lines.length) break;
            const { driver, vehicle } = embeddedDriverVehicle(lines[i + offset]);
            const phone = embeddedNormalizePhone(lines[i + offset + 1]);
            results.push({ name, ton, driver, vehicle, phone });
            parsedCount++;
            offset += 2;
          }
          i += parsedCount > 0 ? 1 + parsedCount * 2 : 1;
          continue;
        }

        const { name, ton } = embeddedNameTon(lines[i]);
        const { driver, vehicle } = embeddedDriverVehicle(lines[i + 1]);
        const phone = embeddedNormalizePhone(lines[i + 2]);
        if (name) results.push({ name, ton, driver, vehicle, phone });
        i += 3;
      }
    }
    return results;
  }

  function embeddedNormalizePhone(raw: string) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('010')) return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
    if (digits.length === 11) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
    if (digits.length === 10) return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
    return String(raw || '').trim();
  }

  function embeddedHasTonnage(line: string) {
    return /\d+(?:\.\d+)?(?:톤|축)/.test(line);
  }

  function embeddedNameTon(line: string) {
    const noPrefix = String(line || '').replace(/^\d+\.\s*/, '');
    const beforeAltSlash = noPrefix.split(/\s\/(?!\s*\d)/)[0];
    const cleaned = beforeAltSlash.split(/\s\//)[0].replace(/\s*경유\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const tonMatch = cleaned.match(/(\d+(?:\.\d+)?(?:톤|축))/);
    const ton = tonMatch ? tonMatch[1] : '';
    const name = (ton ? cleaned.slice(0, cleaned.indexOf(ton)).trim() : cleaned).replace(/\//g, '+').trim();
    return { name, ton };
  }

  function embeddedTonCountSpecs(line: string) {
    const specs = [];
    const re = /(\d+(?:\.\d+)?(?:톤|축))\s*(\d+)\s*대/g;
    let match;
    while ((match = re.exec(line)) !== null) {
      const count = Number(match[2]);
      if (Number.isFinite(count) && count > 0) specs.push({ ton: match[1], count });
    }
    return specs;
  }

  function embeddedBatchNameTon(line: string, specs: {ton:string;count:number}[]) {
    const firstSpecIndex = line.search(/\d+(?:\.\d+)?(?:톤|축)\s*\d+\s*대/);
    const namePart = firstSpecIndex >= 0 ? line.slice(0, firstSpecIndex).trim() : embeddedNameTon(line).name;
    return {
      name: String(namePart || '').replace(/\s+/g, ' ').trim().split(/\s+/)[0] || String(namePart || '').trim(),
      tons: specs.flatMap(spec => Array.from({ length: spec.count }, () => spec.ton))
    };
  }

  function embeddedDriverVehicle(line: string) {
    const parts = String(line || '').trim().split(/\s+/);
    return { driver: parts[0] || '', vehicle: parts[1] || '' };
  }

  export function parseDispatchParserRows(text: string) {
    return text
      .split(/\n+/)
      .map(line => parseDispatchParserLine(line))
      .filter((item): item is {dm:string;vehicle_no:string} => !!item);
  }

  function parseDispatchParserLine(line: string) {
    const cleaned = line.trim();
    if (!cleaned) return null;
    if (/거래처명|기사명|차량번호|연락처/.test(cleaned)) return null;

    const slashParts = cleaned.split('\\').map(v => v.trim()).filter(Boolean);
    if (slashParts.length >= 4) {
      return { dm: slashParts[2] || '', vehicle_no: slashParts[3] || '' };
    }

    const tabParts = cleaned.split(/\t+/).map(v => v.trim()).filter(Boolean);
    if (tabParts.length >= 4) {
      return { dm: tabParts[2] || '', vehicle_no: tabParts[3] || '' };
    }
    if (tabParts.length >= 2) {
      return { dm: tabParts[0] || '', vehicle_no: tabParts[1] || '' };
    }

    const vehicleMatch = cleaned.match(/([가-힣]{2,}\s?\d{1,3}[가-힣]\d{4}|\d{2,3}[가-힣]\d{4})/);
    if (!vehicleMatch) return null;
    const beforeVehicle = cleaned.slice(0, vehicleMatch.index).trim();
    const tokens = beforeVehicle.split(/\s+/).filter(Boolean);
    return {
      dm: tokens.at(-1) || '',
      vehicle_no: vehicleMatch[1].replace(/\s+/g, '')
    };
  }

  export function makeNewRow(role: string, dm: string, vehicleNo: string, carrier: string, defaults: TemperatureDefaults): TemperatureRow {
    const day = normalizeDay(defaults.day);
    return {
      _sourceRow: null,
      _styleSourceRole: role,
      seq: '',
      branch: defaults.branch.trim(),
      center: defaults.center.trim(),
      date: day,
      carrier,
      dm,
      vehicle_no: vehicleNo,
      vehicle_type: role,
      freezer_temp: '',
      refrigerated_temp: '',
      freezer_normal: '',
      refrigerated_normal: '',
      compliance: '준수',
      partition_wall: defaults.partition || 'X',
      photo_partition: '',
      photo_temp_log: '',
      remark: ''
    };
  }

  export function insertRowsByRole(rows: TemperatureRow[], newRows: TemperatureRow[], role: string) {
    const lastSame = findLastIndex(rows, row => normalizeRole(row.vehicle_type) === role);
    if (lastSame >= 0) {
      rows.splice(lastSame + 1, 0, ...newRows);
      return;
    }
    if (role === '임시') {
      const lastWide = findLastIndex(rows, row => normalizeRole(row.vehicle_type) === '광역');
      const lastFixed = findLastIndex(rows, row => normalizeRole(row.vehicle_type) === '고정');
      const insertAt = Math.max(lastWide, lastFixed) + 1;
      rows.splice(insertAt, 0, ...newRows);
      return;
    }
    if (role === '광역') {
      const lastFixed = findLastIndex(rows, row => normalizeRole(row.vehicle_type) === '고정');
      rows.splice(lastFixed + 1, 0, ...newRows);
      return;
    }
    rows.unshift(...newRows);
  }

  export function sortRowsByRole(rows: TemperatureRow[]) {
    return rows
      .map((row, order) => ({ row, order }))
      .sort((a, b) => roleRank(a.row.vehicle_type) - roleRank(b.row.vehicle_type) || a.order - b.order)
      .map(item => item.row);
  }

  export function renumberRows(rows: TemperatureRow[]) {
    rows.forEach((row, index) => { row.seq = String(index + 1); });
  }

  export function normalizeRole(value: unknown) {
    const text = String(value || '').trim();
    if (text.includes('고정')) return '고정';
    if (text.includes('광역')) return '광역';
    if (text.includes('임시')) return '임시';
    return '';
  }

  function roleRank(value: unknown) {
    const role = normalizeRole(value);
    const index = ROLE_ORDER.indexOf(role);
    return index === -1 ? 99 : index;
  }

  function findLastIndex<T>(array: T[], predicate: (item:T,index:number)=>boolean) {
    for (let i = array.length - 1; i >= 0; i--) {
      if (predicate(array[i], i)) return i;
    }
    return -1;
  }

  export function parseDay(value: unknown) {
    const match = String(value || '').match(/(\d{1,2})/);
    return match ? Number(match[1]) : '';
  }

  export function normalizeDay(value: unknown) {
    const day = parseDay(value);
    if (!day) return '';
    return `${day}일`;
  }

  function normalizeCellValue(value: unknown) {
    const text = String(value ?? '').trim();
    return text === '' ? null : text;
  }

  export function updateDerivedFields(row: TemperatureRow) {
    const freezer = parseTemperature(row.freezer_temp);
    const refrigerated = parseTemperature(row.refrigerated_temp);
    const hasFreezer = freezer !== null;
    const hasRefrigerated = refrigerated !== null;
    if (hasFreezer) row.freezer_normal = freezer <= -18 ? '정상' : '비정상';
    if (hasRefrigerated) row.refrigerated_normal = refrigerated >= 0 && refrigerated <= 10 ? '정상' : '비정상';

    const partition = String(row.partition_wall || '').trim().toUpperCase();
    if (hasFreezer && hasRefrigerated && partition) {
      const ok = row.freezer_normal === '정상' && row.refrigerated_normal === '정상' && partition === 'O';
      row.compliance = ok ? '준수' : '미준수';
    }
  }

  function parseTemperature(value: unknown) {
    const text = String(value ?? '').replace('℃', '').trim();
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  export function buildMailSubject() {
    const { start, end } = mailDateRange();
    return `이안물류 - 안산사조센터 일일 온도점검_${formatDateCompact(start)}~${formatDateCompact(end)}`;
  }

  export function buildMailBody() {
    const { start, end } = mailDateRange();
    return `안녕하세요

이안물류 장희성 입니다.



${formatDateCompact(start)}(${weekdayKo(start)})~${formatDateCompact(end)}(${weekdayKo(end)}) 일일온도점검 송부 드립니다.${' '}

첨부파일 확인 부탁드립니다.



감사합니다.`;
  }

  function mailDateRange() {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 1);
    return { start, end };
  }

  function formatDateCompact(date: Date) {
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  function weekdayKo(date: Date) {
    return ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  }

function cellText(cell:ExcelJS.Cell){const value=cell?.value;if(value==null)return '';if(typeof value==='object'){if('text'in value&&value.text)return String(value.text).trim();if('richText'in value)return value.richText.map(part=>part.text||'').join('').trim();if('result'in value&&value.result!=null)return String(value.result).trim();if(value instanceof Date)return `${value.getDate()}일`;}return String(value).trim();}
  export function writeRowsToWorksheet(worksheet: ExcelJS.Worksheet, state: TemperatureTemplate) {
    state.rows=sortRowsByRole(state.rows);
    state.rows.forEach(updateDerivedFields);
    renumberRows(state.rows);

    const usedRows = new Set();
    const headerRows = new Set(Object.values(state.roleHeaderRows || {}).filter(Boolean));
    let cursor = TABLE_START_ROW;

    ROLE_ORDER.forEach(role => {
      const headerRow = state.roleHeaderRows?.[role];
      if (headerRow) cursor = Math.max(cursor, headerRow + 1);

      state.rows
        .filter(record => normalizeRole(record.vehicle_type) === role)
        .forEach((record, roleOffset) => {
          while (headerRows.has(cursor)) cursor += 1;
          const rowNumber = cursor;
          const styleRowNumber = findStyleRowNumber(role, roleOffset, state);
          copyRowStyle(worksheet, styleRowNumber, rowNumber);
          writeRecordToRow(worksheet.getRow(rowNumber), record);
          usedRows.add(rowNumber);
          cursor += 1;
        });
    });

    // Clear only unused original data rows. Keep role separator/header rows intact so
    // the last row of each 고정/광역/임시 section is not overwritten or cleared.
    state.rows
      .filter(record => !normalizeRole(record.vehicle_type))
      .forEach((record, offset) => {
        while (headerRows.has(cursor)) cursor += 1;
        const rowNumber = cursor;
        const styleRowNumber = findStyleRowNumber(record.vehicle_type, offset, state);
        copyRowStyle(worksheet, styleRowNumber, rowNumber);
        writeRecordToRow(worksheet.getRow(rowNumber), record);
        usedRows.add(rowNumber);
        cursor += 1;
      });

    const lastTemplateRow = Math.max(state.sourceLastRow || 0, TABLE_START_ROW - 1);
    for (let rowNumber = TABLE_START_ROW; rowNumber <= lastTemplateRow; rowNumber++) {
      if (headerRows.has(rowNumber) || usedRows.has(rowNumber)) continue;
      const row = worksheet.getRow(rowNumber);
      const role = normalizeRole(cellText(row.getCell(COLS.vehicle_type)));
      const hasData = FIELDS.some(field => field !== 'vehicle_type' && cellText(row.getCell(COLS[field])) !== '');
      if (role && !hasData) continue;
      clearOutputRow(row);
    }
  }

  function writeRecordToRow(row: ExcelJS.Row, record: TemperatureRow) {
    FIELDS.forEach(field => {
      setPlainCellValue(row.getCell(COLS[field]), normalizeCellValue(record[field]));
    });
    row.commit?.();
  }

  function clearOutputRow(row: ExcelJS.Row) {
    FIELDS.forEach(field => setPlainCellValue(row.getCell(COLS[field]), null));
    row.commit?.();
  }

  function setPlainCellValue(cell: ExcelJS.Cell, value: string | null) {
    cell.value = value;
    const model=cell.model as Partial<ExcelJS.CellModel> & {si?:unknown;ref?:unknown};
    if (model) {
      delete model.formula;
      delete model.sharedFormula;
      delete model.result;
      delete model.si;
      delete model.ref;
    }
  }

  function findStyleRowNumber(role: string, offset: number, state: TemperatureTemplate) {
    const normalized = normalizeRole(role);
    const match = state.rows.find(row => row._sourceRow && normalizeRole(row.vehicle_type) === normalized);
    if (match?._sourceRow) return match._sourceRow;
    return Math.min(TABLE_START_ROW + offset, TABLE_START_ROW + Math.max(state.sourceRowCount - 1, 0));
  }

  function copyRowStyle(worksheet: ExcelJS.Worksheet, sourceRowNumber: number, targetRowNumber: number) {
    if (!sourceRowNumber || sourceRowNumber === targetRowNumber) return;
    const sourceRow = worksheet.getRow(sourceRowNumber);
    const targetRow = worksheet.getRow(targetRowNumber);
    targetRow.height = sourceRow.height;
    for (let col = COLS.seq; col <= COLS.remark; col++) {
      const sourceCell = sourceRow.getCell(col);
      const targetCell = targetRow.getCell(col);
      targetCell.style = JSON.parse(JSON.stringify(sourceCell.style || {}));
      if (sourceCell.numFmt) targetCell.numFmt = sourceCell.numFmt;
      if (sourceCell.alignment) targetCell.alignment = { ...sourceCell.alignment };
      if (sourceCell.border) targetCell.border = JSON.parse(JSON.stringify(sourceCell.border));
      if (sourceCell.fill) targetCell.fill = JSON.parse(JSON.stringify(sourceCell.fill));
      if (sourceCell.font) targetCell.font = JSON.parse(JSON.stringify(sourceCell.font));
    }
  }

