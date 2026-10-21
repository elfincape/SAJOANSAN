import ExcelJS from 'exceljs';
import type { TransferRow } from '../domain/transfers';
const clone = <T,>(obj:T):T => JSON.parse(JSON.stringify(obj || {}));
export async function transferWorkbook(rows:TransferRow[]){
    const res = await fetch('/assets/templates/transfer-template.xlsx', { cache: 'no-store' });

    if (!res.ok) {
      throw new Error(`엑셀 템플릿을 불러오지 못했습니다. HTTP ${res.status}`);
    }

    const templateBuf = await res.arrayBuffer();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuf);

    const worksheet =
      workbook.getWorksheet('Sheet1 (2)') ||
      workbook.getWorksheet('Sheet1') ||
      workbook.worksheets[0];

    if (!worksheet) {
      throw new Error('엑셀 시트를 찾지 못했습니다.');
    }

    const startRow = 5;

    rows.forEach((item, index) => {
      const rowNum = startRow + index;

      if (index > 0) {
        copyRowStyle(worksheet, startRow, rowNum);
      }

      const row = worksheet.getRow(rowNum);

      if (!row.height || row.height < 80) {
        row.height = 90;
      }

      // 요청한 엑셀 위치
      // C: 센터
      // D: 일자
      // E: 소속
      // F: 코스
      // G: 기사명
      // H: 차량번호
      // I~L: 사진
      // M: 비고
      worksheet.getCell(`C${rowNum}`).value = item.center || '';
      worksheet.getCell(`D${rowNum}`).value = item.delivery_date || '';
      worksheet.getCell(`E${rowNum}`).value = item.company_name || '';
      worksheet.getCell(`F${rowNum}`).value = item.route_name || '';
      worksheet.getCell(`G${rowNum}`).value = item.driver_name || '';
      worksheet.getCell(`H${rowNum}`).value = item.vehicle_plate || '';
      worksheet.getCell(`M${rowNum}`).value = item.memo || '';

      // 사진은 각 셀 I/J/K/L에 셀 크기와 딱 맞게 삽입
      addImageToCell(workbook, worksheet, item.photos?.[0], 9, rowNum);   // I열
      addImageToCell(workbook, worksheet, item.photos?.[1], 10, rowNum);  // J열
      addImageToCell(workbook, worksheet, item.photos?.[2], 11, rowNum);  // K열
      addImageToCell(workbook, worksheet, item.photos?.[3], 12, rowNum);  // L열
    });

    const buf = await workbook.xlsx.writeBuffer();

    const blob = new Blob([new Uint8Array(buf)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    return blob;
}
function addImageToCell(workbook: ExcelJS.Workbook, worksheet: ExcelJS.Worksheet, dataUrl: string | null | undefined, colNumber: number, rowNumber: number) {
  if (!dataUrl) return;

  const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpeg';
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

  const imageId = workbook.addImage({
    base64,
    extension: ext
  });

  const colIndex = colNumber - 1;
  const rowIndex = rowNumber - 1;

  // 핵심 수정:
  // 여백 없이 현재 셀 경계 전체에 맞춤.
  // I5면 tl = I5 좌상단, br = J6 좌상단이므로 I5 셀 전체를 채움.
  worksheet.addImage(imageId, {
    tl: {
      col: colIndex,
      row: rowIndex
    },
    br: {
      col: colIndex + 1,
      row: rowIndex + 1
    },
    editAs: 'oneCell'
  } as ExcelJS.ImageRange & { editAs: string });
}

function copyRowStyle(ws: ExcelJS.Worksheet, fromRowNum: number, toRowNum: number) {
  const from = ws.getRow(fromRowNum);
  const to = ws.getRow(toRowNum);

  to.height = from.height;

  from.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const target = to.getCell(colNumber);

    target.style = clone(cell.style || {});
    target.numFmt = cell.numFmt;
    if(cell.alignment)target.alignment = clone(cell.alignment);
    if(cell.border)target.border = clone(cell.border);
    if(cell.fill)target.fill = clone(cell.fill);
    if(cell.font)target.font = clone(cell.font);
    if(cell.protection)target.protection = clone(cell.protection);
  });

  to.commit?.();
}

