import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildCoupangWorkbook} from '../repo-root/js/coupang-workbook.js';
const require=createRequire(import.meta.url),ExcelJS=require('exceljs'),JSZip=require('jszip');
const template=new ExcelJS.Workbook(),sheet=template.addWorksheet('입문확인');
for(let row=6;row<=23;row++){const total=480+(row-6)*30;sheet.getCell(row,7).value=String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');}
const templateBuffer=await template.xlsx.writeBuffer();
const item=index=>({include:true,schedule:{centerRaw:'평택'+index,reservationTime:'15:30'},match:{matchedDispatch:{driver:'기사'+index}}});
const result=await buildCoupangWorkbook({ExcelJS,JSZip,templateBuffer,date:'2026-10-13',matches:[item(1),item(2),item(3)]});
assert.equal(result.captureRange,'G3:N21');
const book=new ExcelJS.Workbook();await book.xlsx.load(result.buffer);
assert.equal(book.worksheets[0].getCell('G3').value,'10월13일(화요일)');
assert.equal(book.worksheets[0].getCell('N21').value,'기사3');
assert.equal(book.worksheets[0].getCell('O21').value,null);
const first=await buildCoupangWorkbook({ExcelJS,JSZip,templateBuffer,date:'2027-01-01',matches:[{...item(1),schedule:{centerRaw:'평택2',reservationTime:'08:00'}}]});
assert.equal(first.captureRange,'G3:J6');assert.equal(first.filename,'쿠팡 입문확인_20270101.xlsx');
await assert.rejects(()=>buildCoupangWorkbook({ExcelJS,JSZip,templateBuffer,date:'2026-02-30',matches:[item(1)]}),/날짜/);
console.log('PASS: real XLSX output, G3:N21 automatic bounds, first/last used cells and date rollover');
