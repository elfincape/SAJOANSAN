import type * as XLSXModule from 'xlsx';
import type ExcelJSModule from 'exceljs';
type ExcelLibrary=typeof XLSXModule;type WorkbookLibrary=typeof ExcelJSModule;
export interface DistanceRow {sourceRow:number;name:string;address:string;issue:string;region?:string;regionKey?:string;distanceKm?:number|null;longest?:boolean;distanceText?:string;measuredAt?:string}
export type Efficiencies=Record<string,number>;
export const TONS=['1','2.5','3.5','5','11'];
export const DEFAULTS:Efficiencies={'1':8.3,'2.5':6.7,'3.5':6,'5':4.8,'11':4};
export const HEADERS=['원본행','착지명','주소','권역','주행거리(km)','1톤 유류량(L)','2.5톤 유류량(L)','3.5톤 유류량(L)','5톤 유류량(L)','11톤 이상 유류량(L)','확인 필요'];
const error=(value:unknown)=>/^#(?:N\/?A|VALUE!?|REF!?|DIV\/0!?|NAME\?|NUM!?|NULL!?|SPILL!?|CALC!?)/i.test(String(value??''));
export function excelAddresses(sheet:XLSXModule.WorkSheet,XLSX:ExcelLibrary,{addressColumn,nameColumn=null,startRow=1}:{addressColumn:number;nameColumn?:number|null;startRow?:number}){
 if(!sheet?.['!ref'])throw Error('시트가 비어 있습니다.');
 const range=XLSX.utils.decode_range(sheet['!ref']);if(range.e.r>20000)throw Error('20,000행까지 계산할 수 있습니다.');
 if(!Number.isInteger(startRow)||startRow<1||!Number.isInteger(addressColumn)||addressColumn<range.s.c||addressColumn>range.e.c)throw Error('주소 열과 시작 행을 확인해 주세요.');
 const merges=sheet['!merges']??[],read=(r:number,c:number)=>{const m=merges.find(m=>r>=m.s.r&&r<=m.e.r&&c>=m.s.c&&c<=m.e.c);const cell=sheet[XLSX.utils.encode_cell(m?m.s:{r,c})];return cell?.t==='e'||error(cell?.v)||cell?.f&&cell.v==null?{value:'',error:'수식 오류'}:{value:String(cell?.v??'').trim(),error:''};};
 const rows=[];
 for(let r=Math.max(startRow-1,range.s.r);r<=range.e.r;r++){
  const address=read(r,addressColumn),name=nameColumn==null?{value:''}:read(r,nameColumn);
  if(!address.value&&!address.error)continue;
  if(/^(주소|배송주소|납품처주소|address)$/i.test(address.value.replace(/\s/g,'')))continue;
  rows.push({sourceRow:r+1,name:name.value,address:address.value,issue:address.error});
 }
 if(!rows.length)throw Error('선택한 열에 주소가 없습니다.');return rows;
}
export function longestRows(rows:DistanceRow[]){
 const maxima=new Map<string,number>();for(const r of rows)if(r.regionKey&&Number.isFinite(r.distanceKm))maxima.set(r.regionKey,Math.max(maxima.get(r.regionKey)??-Infinity,r.distanceKm!));
 return rows.map(r=>({...r,longest:!!r.regionKey&&Number.isFinite(r.distanceKm)&&r.distanceKm===maxima.get(r.regionKey)}));
}
export function resultValues(row:DistanceRow,efficiencies:Efficiencies){return [row.sourceRow,row.name,row.address,row.region??'',row.distanceKm??null,...TONS.map(ton=>Number.isFinite(row.distanceKm)?row.distanceKm!/efficiencies[ton]:null),row.issue??''];}
export async function distanceWorkbook(ExcelJS:WorkbookLibrary,rows:DistanceRow[],efficiencies:Efficiencies,origin:string){
 const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('착지별 주행거리');sheet.addRow(HEADERS);
 for(const row of longestRows(rows)){const added=sheet.addRow(resultValues(row,efficiencies));if(row.longest)added.getCell(5).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFEB3B'}};for(let c=5;c<=10;c++)added.getCell(c).numFmt='0.000';}
 sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:'K'+sheet.rowCount};
 sheet.columns.forEach((c,i)=>c.width=i===2?60:i===1?28:20);sheet.getRow(1).font={bold:true};
 const criteria=wb.addWorksheet('계산 기준');criteria.addRows([['출발지',origin],['경로 기준','네이버 후보 중 최소거리'],[],['톤수','연비(km/L)'],...TONS.map(t=>[t==='11'?'11톤 이상':t+'톤',efficiencies[t]])]);criteria.columns.forEach(c=>c.width=35);
 return wb.xlsx.writeBuffer();
}
