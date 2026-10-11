export const masterLabels={centers:'센터',companies:'운수사',drivers:'기사',vehicles:'차량',routes:'코스',delivery_points:'납품처',route_stops:'코스별 납품처'};
export function splitOriginal(text){const chunks=[];for(let start=0;start<text.length;){let end=Math.min(start+30000,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;chunks.push(text.slice(start,end));start=end;}return chunks;}
export function makeBackupWorkbook(ExcelJS){return async backup=>{
 const data=JSON.parse(backup.original_text),workbook=new ExcelJS.Workbook();
 workbook.creator='SAJOANSAN';workbook.created=new Date(backup.captured_at);workbook.modified=new Date(backup.captured_at);
 const cover=workbook.addWorksheet('보관 정보');cover.columns=[{width:28},{width:65}];
 cover.addRows([['운영 마스터 원본',backup.period==='baseline'?'현재 원본':backup.period+' 월말 원본'],['보관 시각 (한국시간)',new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'medium'}).format(new Date(backup.captured_at))],['원본 출처','SAJOANSAN 운영 데이터베이스'],['자료','건수']]);
 for(const [table,label] of Object.entries(masterLabels)){
  const rows=data[table];if(!Array.isArray(rows)||rows.length!==backup.counts[table])throw Error('원본 건수가 일치하지 않습니다: '+label);
  cover.addRow([label,rows.length]);const sheet=workbook.addWorksheet(label),keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  sheet.columns=keys.length?keys.map(key=>({header:key,key,width:24})):[{header:'기록 없음',width:24}];
  for(const row of rows)sheet.addRow(Object.fromEntries(keys.map(key=>{const value=row[key];const cell=value&&typeof value==='object'?JSON.stringify(value):value;return [key,typeof cell==='string'&&cell.length>30000?cell.slice(0,29950)+' … (전체 값은 JSON 원본에 보존)':cell];})));
  sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF234F70'}};
  if(keys.length)sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:keys.length}};
 }
 // Exact JSON preserves null/empty differences, nested fields, timestamps and large numbers.
 const raw=workbook.addWorksheet('JSON 원본');raw.columns=[{header:'조각 순서',width:16},{header:'전체 원본 JSON (순서대로 연결)',width:90}];
 splitOriginal(backup.original_text).forEach((chunk,index)=>raw.addRow([index+1,chunk]));raw.views=[{state:'frozen',ySplit:1}];
 cover.getRow(1).font={bold:true,size:16};cover.getRow(4).font={bold:true};
 const bytes=new Uint8Array(await workbook.xlsx.writeBuffer());
 const check=new ExcelJS.Workbook();await check.xlsx.load(bytes);
 let restored='';check.getWorksheet('JSON 원본').eachRow((row,index)=>{if(index>1)restored+=row.getCell(2).value;});
 if(restored!==backup.original_text)throw Error('엑셀 원본 JSON 재검증에 실패했습니다.');
 for(const [table,label] of Object.entries(masterLabels))if(check.getWorksheet(label).actualRowCount!==Math.max(1,backup.counts[table]+1))throw Error('엑셀 자료 건수 검증에 실패했습니다: '+label);
 return bytes;
};}
