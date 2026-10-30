import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {COL,TABLE_START_ROW,TEMPLATE_SCAN_BUFFER_ROWS,TEMPLATE_MIN_SCAN_ROWS,TEMPLATE_MAX_SCAN_ROWS,TEMPLATE_EMPTY_TAIL_ROWS} from '../domain/one-top-config';
import {normalizeVehicle,selectRecord,chooseTemperatures,formatTemplateDate,computeResultValues} from '../domain/one-top';
import type {Capture,MatchIssue} from '../domain/one-top';
import {prepareExcelImage,prepareSupplementExcelImage} from '../domain/one-top-images';
interface VehicleRow {row:number;vehicle:string;key:string}
export async function inspectOneTopTemplate(buffer:ArrayBuffer){const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const sheet=workbook.worksheets[0];if(!sheet)throw new Error('첫 번째 시트를 찾을 수 없습니다.');const vehicles=collectVehicleRows(sheet);if(!vehicles.length)throw new Error('H열에서 차량번호가 입력된 작업 행을 찾지 못했습니다.');return {sheetName:sheet.name,vehicleCount:vehicles.length,photoCount:findPhotoMarkerRows(sheet,vehicles).size};}
export async function matchOneTopWorkbook(templateBuffer:ArrayBuffer,captures:Capture[],onPartial?:(issues:MatchIssue[],log:string[])=>void){
 const analyzed=captures.filter((item):item is Capture & {result:NonNullable<Capture['result']>}=>item.status==='done'&&!!item.result),issues:MatchIssue[]=[],matchLog:string[]=[];
 const addIssue=(item:string,message:string)=>{issues.push({item,message});onPartial?.([...issues],[...matchLog]);};
 captures.filter(item=>item.status==='error').forEach(item=>addIssue(item.name,`API 판독 실패: ${item.error||'응답 오류'}`));
 captures.filter(item=>item.status!=='done'&&item.status!=='error').forEach(item=>addIssue(item.name,'API 분석이 완료되지 않았습니다.'));
      const workbook=new ExcelJS.Workbook(); await workbook.xlsx.load(templateBuffer.slice(0));
      const ws=workbook.worksheets[0]; const vehicleRows=collectVehicleRows(ws);
      markRowsWithExistingTemperatures(ws,vehicleRows);
      // Protect actual Q-cell images, nonblank Q content, and existing temperatures.
      const groups=groupVehicleRows(vehicleRows); const occupied=findPhotoMarkerRows(ws,vehicleRows);
      const insertedReceiptImages=new Set();
      const insertedVehicleKeys=new Set();

      for (const item of analyzed) {
        const key=normalizeVehicle(item.result.vehicle_number); const group=groups.get(key)||[];
        if (!key) { addIssue(item.name,'차량번호 판독 실패'); continue; }
        if (!group.length) { addIssue(item.name,`차량번호 미일치: ${item.result.vehicle_number}`); continue; }
        // 한 번의 결과 파일에서는 동일 차량번호에 온도 영수증을 최대 한 장만 신규 삽입한다.
        if(insertedVehicleKeys.has(key)){addIssue(item.name,`차량 ${item.result.vehicle_number}: 같은 차량 사진이 이미 반영되어 추가 사진을 제외했습니다.`);continue;}
        const imageKey=receiptImageKey(item.dataUrl);
        if(insertedReceiptImages.has(imageKey)){addIssue(item.name,`차량 ${item.result.vehicle_number}: 동일한 사진이 이미 반영되어 제외했습니다.`);continue;}
        // Whitespace alone does not establish that a receipt image exists.
        const target=group.find(x=>!occupied.has(x.row)&&!isPhotoRowOccupied(ws,x.row));
        if (!target) { addIssue(item.name,`차량 ${item.result.vehicle_number}: Q열이 빈 행이 없어 사진을 제외했습니다.`); continue; }
        if(isPhotoRowOccupied(ws,target.row)){addIssue(item.name,`차량 ${item.result.vehicle_number}: 선택 행의 Q열이 사용 중이라 사진을 제외했습니다.`);continue;}
        const record=selectRecord(item.result.records); const temps=chooseTemperatures(record?.a,record?.b);
        const receiptImage=await prepareExcelImage(item.dataUrl);
        addImageToCell(workbook,ws,receiptImage,COL.tempPhoto,target.row); markPhotoCell(ws,target.row); occupied.add(target.row);
        insertedReceiptImages.add(imageKey);
        insertedVehicleKeys.add(key);
        // Synchronize occupied rows after inserting the image.
        for(const row of vehicleRows)if(isPhotoRowOccupied(ws,row.row))occupied.add(row.row);
        if(item.supplementalDataUrl)addImageToCell(workbook,ws,await prepareSupplementExcelImage(item.supplementalDataUrl),COL.supplementalPhoto,target.row);
        writeTemperatureAndDate(ws,target.row,item.result.date,temps,false);
        writeResultValues(ws,target.row);
        matchLog.push(`${item.name} → ${target.vehicle} / ${target.row}행`);onPartial?.([...issues],[...matchLog]);
        if (temps.freezer==null && temps.refrigerated==null) addIssue(item.name,'온도값 판독 실패 또는 기준에 맞는 온도 없음');
      }

 return {workbook,issues,matchLog};
}
export async function oneTopOutputBlob(workbook:ExcelJS.Workbook){normalizeWorkbookPrivacy(workbook);const buffer=await workbook.xlsx.writeBuffer(),cleanBuffer=await disableRemovePersonalInfo(buffer);return new Blob([new Uint8Array(cleanBuffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});}
  export function collectVehicleRows(ws: ExcelJS.Worksheet) {
    const rows=[];
    const dimensionBottom=Number(ws.dimensions?.bottom||0);
    const modelRows=Array.isArray((ws as unknown as {_rows?:unknown[]})._rows)?(ws as unknown as {_rows:unknown[]})._rows.length:0;
    const baseLast=Math.max(ws.actualRowCount||0,ws.rowCount||0,dimensionBottom,modelRows,TABLE_START_ROW);
    let scanLast=Math.min(TEMPLATE_MAX_SCAN_ROWS,Math.max(baseLast+TEMPLATE_SCAN_BUFFER_ROWS,TEMPLATE_MIN_SCAN_ROWS));
    let emptyAfterLastMatch=0;
    for(let row=TABLE_START_ROW;row<=scanLast;row++){
      const vehicle=cellText(ws.getCell(row,COL.vehicle)); const key=normalizeVehicle(vehicle);
      if(key){rows.push({row,vehicle,key});emptyAfterLastMatch=0;scanLast=Math.min(TEMPLATE_MAX_SCAN_ROWS,Math.max(scanLast,row+TEMPLATE_SCAN_BUFFER_ROWS));}
      else if(rows.length&&row>baseLast&&++emptyAfterLastMatch>=TEMPLATE_EMPTY_TAIL_ROWS)break;
    }
    return rows;
  }

  function groupVehicleRows(rows:VehicleRow[]) { const map=new Map<string,VehicleRow[]>(); rows.forEach(x=>{if(!map.has(x.key))map.set(x.key,[]);map.get(x.key)!.push(x);}); return map; }

  function markRowsWithExistingTemperatures(ws:ExcelJS.Worksheet,vehicleRows:VehicleRow[]) {
    for(const item of vehicleRows){
      const hasTemperature=cellText(ws.getCell(item.row,COL.freezer))||cellText(ws.getCell(item.row,COL.refrigerated));
      const markerCell=ws.getCell(item.row,COL.tempPhoto);
      if(hasTemperature&&!cellText(markerCell)&&!hasPhotoMarker(markerCell))markerCell.value=' ';
    }
  }

  function findPhotoMarkerRows(ws:ExcelJS.Worksheet,vehicleRows:VehicleRow[]) { return new Set(vehicleRows.filter(item=>isPhotoRowOccupied(ws,item.row)).map(item=>item.row)); }

  function addImageToCell(workbook:ExcelJS.Workbook,ws:ExcelJS.Worksheet,dataUrl:string,col:number,row:number) { const extension=dataUrl.startsWith('data:image/png')?'png':'jpeg'; const imageId=workbook.addImage({base64:dataUrl.split(',')[1],extension}); placeImage(ws,imageId,col,row); }
  function placeImage(ws:ExcelJS.Worksheet,imageId:number,col:number,row:number) { ws.addImage(imageId,{tl:{col:col-1,row:row-1},br:{col,row},editAs:'oneCell'} as ExcelJS.ImageRange & {editAs:string}); if(!ws.getRow(row).height||ws.getRow(row).height<80)ws.getRow(row).height=90; }
  function markPhotoCell(ws:ExcelJS.Worksheet,row:number) { if(!cellText(ws.getCell(row,COL.tempPhoto)))ws.getCell(row,COL.tempPhoto).value=' '; }
  function hasPhotoMarker(cell:ExcelJS.Cell) { return typeof cell?.value==='string' && /^\s+$/.test(cell.value); }
  function isPhotoRowOccupied(ws:ExcelJS.Worksheet,row:number) {
    const photoCell=ws.getCell(row,COL.tempPhoto);
    return hasImageInPhotoCell(ws,row)||Boolean(cellText(photoCell))||Boolean(cellText(ws.getCell(row,COL.freezer)))||Boolean(cellText(ws.getCell(row,COL.refrigerated)));
  }
  function hasImageInPhotoCell(ws:ExcelJS.Worksheet,row:number) {
    const col=COL.tempPhoto-1,top=row-1;
    return ws.getImages().some(image=>{
      const {tl,br,ext}=image.range as ExcelJS.ImageRange & {ext?:{width:number;height:number}};
      if(br)return tl.col<col+1&&br.col>col&&tl.row<top+1&&br.row>top;
      if(!ext)return Math.floor(tl.col)===col&&Math.floor(tl.row)===top;
      // One-cell image widths depend on workbook font metrics. Protect conservatively
      // when an image starts to the left of Q; row heights and EMU offsets are explicit.
      if(tl.nativeCol>col)return false;
      const rowPixels=(index:number)=>{
        const item=ws.getRow(index+1);
        return item.hidden?0:(item.height??ws.properties.defaultRowHeight??15)*96/72;
      };
      let imageTop=tl.nativeRowOff/9525,targetTop=0;
      for(let index=0;index<Math.max(tl.nativeRow,top);index++){
        const height=rowPixels(index);
        if(index<tl.nativeRow)imageTop+=height;
        if(index<top)targetTop+=height;
      }
      return imageTop<targetTop+rowPixels(top)&&imageTop+ext.height>targetTop;
    });
  }
  function receiptImageKey(dataUrl:string) {
    return String(dataUrl||'');
  }
  function writeTemperatureAndDate(ws:ExcelJS.Worksheet,row:number,date:string,temps:ReturnType<typeof chooseTemperatures>,overwrite:boolean) { const values:[number,number|null][]=[[COL.freezer,temps.freezer],[COL.refrigerated,temps.refrigerated]]; for(const [col,val] of values)if(val!=null&&(overwrite||!cellText(ws.getCell(row,col))))ws.getCell(row,col).value=val; if(date&&!cellText(ws.getCell(row,COL.date)))ws.getCell(row,COL.date).value=formatTemplateDate(date); }
  function writeResultValues(ws:ExcelJS.Worksheet,row:number) { const values=computeResultValues(cellText(ws.getCell(row,COL.freezer)),cellText(ws.getCell(row,COL.refrigerated))); ws.getCell(row,COL.compliance).value=values.compliance; ws.getCell(row,COL.temperaturePair).value=values.temperaturePair; ws.getCell(row,COL.shipmentType).value=values.shipmentType; }
function cellText(cell:ExcelJS.Cell){const target=cell?.isMerged&&cell.master?cell.master:cell,value=target?.value;if(value==null)return '';if(typeof value==='object'){if('text'in value&&value.text!=null)return String(value.text).trim();if('result'in value&&value.result!=null)return String(value.result).trim();if('richText'in value)return value.richText.map(part=>part.text||'').join('').trim();}return String(value).trim();}
  function normalizeWorkbookPrivacy(workbook:ExcelJS.Workbook) {
    workbook.creator=workbook.creator||'SAJOANSAN';workbook.lastModifiedBy='SAJOANSAN';workbook.modified=new Date();
    const properties=(workbook.model as unknown as {workbookProperties?:Record<string,unknown>}).workbookProperties;if(properties){properties.filterPrivacy=false;properties.removePersonalInformation=false;}
  }

  async function disableRemovePersonalInfo(buffer:ExcelJS.Buffer) {
    const zip=await JSZip.loadAsync(buffer),workbookXml=zip.file('xl/workbook.xml');if(!workbookXml)return buffer;
    const xml=(await workbookXml.async('string')).replace(/\sfilterPrivacy="(?:1|true)"/gi,' filterPrivacy="0"').replace(/\sremovePersonalInformation="(?:1|true)"/gi,' removePersonalInformation="0"');
    zip.file('xl/workbook.xml',xml);return zip.generateAsync({type:'arraybuffer'});
  }

