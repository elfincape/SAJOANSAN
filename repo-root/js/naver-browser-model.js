import {distanceWorkbook} from './destination-distance-model.js';
export async function enqueueBrowserJob(client,center,origin,addresses){
 const {data,error}=await client.rpc('naver_browser_enqueue',{p_center:center,p_origin:origin,p_addresses:addresses});if(error)throw Error(error.message);return data;
}
export function browserJobRows(rows,job){
 const terminal=['completed','cancelled','attention'].includes(job.status);
 return rows.map(row=>{const value=job.results?.[row.address];if(value){const ok=value.method==='naver-map-display'&&value.routeLabel==='거리우선'&&Number.isFinite(value.distanceKm)&&value.distanceKm>=0;return {...row,...(ok?value:{distanceKm:undefined}),issue:ok?(value.regionKey?'':'권역 확인 필요'):value.issue||'네이버 거리우선 확인 필요'};}return {...row,issue:row.issue||(terminal?'미계산':'')};});
}
export async function watchBrowserJob(client,id,onUpdate,pause=()=>new Promise(r=>setTimeout(r,5000))){
 for(;;){const {data,error}=await client.from('naver_browser_jobs').select('id,status,addresses,results,updated_at').eq('id',id).single();if(error)throw Error('서버 작업을 다시 확인해 주세요.');onUpdate(data);if(!['queued','running'].includes(data.status))return data;await pause();}
}
export async function browserWorkbook(ExcelJS,rows,efficiencies,origin){
 const buffer=await distanceWorkbook(ExcelJS,rows,efficiencies,origin),wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer);wb.getWorksheet(2).getCell('B2').value='네이버 지도 거리우선 표시값';
 const sheet=wb.getWorksheet(1);sheet.getCell('L1').value='네이버 표시거리';sheet.getCell('M1').value='측정일시';sheet.getColumn(12).width=22;sheet.getColumn(13).width=28;sheet.autoFilter={from:'A1',to:'M'+sheet.rowCount};
 rows.forEach((row,i)=>{sheet.getCell(i+2,12).value=row.distanceText??'';sheet.getCell(i+2,13).value=row.measuredAt??'';});return wb.xlsx.writeBuffer();
}
