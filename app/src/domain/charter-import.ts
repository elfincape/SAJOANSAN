import type * as SheetJS from 'xlsx';
import type {CharterTrip,CharterOptions} from './charter';
export interface CharterSource {workbook:SheetJS.WorkBook;name:string;sheetName:string}
import {parseNormalizedSheet} from './charter';
function comparable(trip:CharterTrip){
 const value:Partial<CharterTrip>={...trip};for(const key of ['sourceName','sheetName','createdAt','updatedAt'] as const)delete value[key];return JSON.stringify(value);
}
export function parseCharterSources(sources:CharterSource[],XLSX:typeof SheetJS,options:CharterOptions={}){
 const byId=new Map<string,CharterTrip>();let duplicates=0;
 for(const source of sources){
  const sheetName=source.sheetName||source.workbook.SheetNames[0];let parsed;
  try{parsed=parseNormalizedSheet(source.workbook.Sheets[sheetName],XLSX,{...options,sourceName:source.name,sheetName,date1904:!!source.workbook.Workbook?.WBProps?.date1904});}
  catch(error){throw new Error(source.name+' / '+sheetName+': '+(error instanceof Error?error.message:String(error)));}
  for(const trip of parsed){
   const previous=byId.get(trip.id);
   if(previous){
    if(comparable(previous)!==comparable(trip))throw new Error('동일 운행ID의 내용이 다릅니다: '+previous.sourceName+' / '+trip.sourceName+' ('+(trip.date||'일자 미정')+' / '+(trip.course||'코스 미정')+'). 파일을 확인해 다시 선택해 주세요.');
    duplicates++;continue;
   }
   byId.set(trip.id,trip);
   if(byId.size>100000)throw new Error('전체 운행 100,000건까지 불러올 수 있습니다.');
  }
 }
 return {trips:[...byId.values()],duplicates};
}
