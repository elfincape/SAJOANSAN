import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { extractRows,collectRoleHeaderRows,renumberRows,sortRowsByRole,TABLE_START_ROW,writeRowsToWorksheet } from '../domain/daily-temperature';
import type { TemperatureTemplate } from '../domain/daily-temperature';
export async function readTemperatureTemplate(buffer:ArrayBuffer):Promise<TemperatureTemplate>{
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const sheet=workbook.worksheets[0];if(!sheet)throw new Error('Sheet1을 찾을 수 없습니다.');
 const rows=sortRowsByRole(extractRows(sheet));renumberRows(rows);
 return {workbook,worksheetName:sheet.name,rows,sourceRowCount:rows.length,sourceLastRow:Math.max(sheet.actualRowCount||sheet.rowCount||0,TABLE_START_ROW-1),roleHeaderRows:collectRoleHeaderRows(sheet)};
}
export async function downloadTemperatureWorkbook(template:TemperatureTemplate){
 const buffer=await template.workbook.xlsx.writeBuffer(),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);
 const sheet=workbook.getWorksheet(template.worksheetName)||workbook.worksheets[0];
 writeRowsToWorksheet(sheet,{...template,rows:template.rows.map(row=>({...row}))});normalizeWorkbookPrivacy(workbook);
 const output=await workbook.xlsx.writeBuffer(),clean=await disableRemovePersonalInfo(output);
 return new Blob([new Uint8Array(clean)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
  function normalizeWorkbookPrivacy(workbook: ExcelJS.Workbook) {
    workbook.creator = workbook.creator || 'SAJOANSAN';
    workbook.lastModifiedBy = workbook.lastModifiedBy || 'SAJOANSAN';
    workbook.created = workbook.created || new Date();
    workbook.modified = new Date();
    const properties=(workbook.model as unknown as {workbookProperties?:Record<string,unknown>}).workbookProperties;
    if(properties){
      properties.filterPrivacy = false;
      properties.removePersonalInformation = false;
    }
  }

  async function disableRemovePersonalInfo(buffer: ExcelJS.Buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const workbookXml = zip.file('xl/workbook.xml');
    if (!workbookXml) return buffer;
    let xml = await workbookXml.async('string');
    xml = xml
      .replace(/\sfilterPrivacy="1"/g, ' filterPrivacy="0"')
      .replace(/\sfilterPrivacy="true"/g, ' filterPrivacy="0"')
      .replace(/\sremovePersonalInformation="1"/g, ' removePersonalInformation="0"')
      .replace(/\sremovePersonalInformation="true"/g, ' removePersonalInformation="0"');
    zip.file('xl/workbook.xml', xml);
    return zip.generateAsync({ type: 'arraybuffer' });
  }

