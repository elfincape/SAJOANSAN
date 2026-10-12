// Render workbook formatting rather than a generic table.
export function parseCaptureRange(value){const m=String(value).toUpperCase().match(/^([A-Z]{1,3})([1-9]\d{0,3}):([A-Z]{1,3})([1-9]\d{0,3})$/);if(!m)throw Error('이미지 범위를 A1:E20 형식으로 입력하세요.');const col=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);const range={left:col(m[1]),top:Number(m[2]),right:col(m[3]),bottom:Number(m[4])};if(range.left>range.right||range.top>range.bottom||(range.right-range.left+1)*(range.bottom-range.top+1)>2000)throw Error('이미지 범위는 최대 2,000칸이며 시작 셀이 끝 셀보다 앞이어야 합니다.');return range;}
const DEFAULT_THEME=['FFFFFF','000000','E7E6E6','44546A','4472C4','ED7D31','A5A5A5','FFC000','5B9BD5','70AD47','0563C1','954F72'];
export function themeColors(xml=''){
 const names=['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'];
 return names.map((name,i)=>{const part=xml.match(new RegExp('<(?:\\w+:)?'+name+'>([\\s\\S]*?)</(?:\\w+:)?'+name+'>'))?.[1];return part?.match(/lastClr="([0-9A-Fa-f]{6})"/)?.[1]??part?.match(/srgbClr[^>]*val="([0-9A-Fa-f]{6})"/)?.[1]??DEFAULT_THEME[i];});
}
const INDEXED=['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF'];
export function excelColor(value,theme=DEFAULT_THEME,fallback='#000000'){
 if(!value)return fallback;
 let hex=value.argb?.slice(-6)??(value.theme!=null?theme[value.theme]:INDEXED[value.indexed]);
 if(!hex||!/^[0-9a-f]{6}$/i.test(hex))return fallback;
 if(value.tint){const t=value.tint;hex=[0,2,4].map(i=>{const c=parseInt(hex.slice(i,i+2),16);return Math.round(t<0?c*(1+t):c+(255-c)*t).toString(16).padStart(2,'0');}).join('');}
 return '#'+hex.toLowerCase();
}
export function columnPixels(width,maximumDigitWidth=7){return Math.floor(((256*width+Math.floor(128/maximumDigitWidth))/256)*maximumDigitWidth);}
export function cellDisplayText(cell){
 let value=cell.value;if(value?.formula||value?.sharedFormula)value=value.result;
 if(value==null)return '';
 if(value.richText)return value.richText.map(run=>run.text).join('');
 if(value.text!=null)return String(value.text);
 if(value.error)return value.error;
 const fmt=cell.numFmt??'';
 if((value instanceof Date||typeof value==='number')&&/[hH]|\[h\]/.test(fmt)){
  const seconds=value instanceof Date?value.getUTCHours()*3600+value.getUTCMinutes()*60+value.getUTCSeconds():Math.round((value%1)*86400);
  const hour=Math.floor(seconds/3600)%24,minute=Math.floor(seconds/60)%60,second=seconds%60;
  const h=/hh/i.test(fmt)?String(hour).padStart(2,'0'):String(hour);
  return h+':'+String(minute).padStart(2,'0')+(/s/i.test(fmt)?':'+String(second).padStart(2,'0'):'');
 }
 if(value instanceof Date)return value.toISOString().slice(0,10);
 if(typeof value==='number'&&fmt!=='General'&&fmt!=='@'){
  const percent=fmt.includes('%'),decimals=fmt.match(/\.([0#]+)/)?.[1]?.length??0;
  if(/[0#]/.test(fmt))return (value*(percent?100:1)).toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals,useGrouping:fmt.includes(',')})+(percent?'%':'');
 }
 return String(value);
}
const BORDER={hair:[.5,[]],thin:[1,[]],medium:[2,[]],thick:[3,[]],double:[3,[]],dotted:[1,[1,2]],dashed:[1,[4,3]],dashDot:[1,[4,2,1,2]],dashDotDot:[1,[4,2,1,2,1,2]],mediumDashed:[2,[6,3]],mediumDashDot:[2,[6,2,1,2]],mediumDashDotDot:[2,[6,2,1,2,1,2]],slantDashDot:[2,[6,2,1,2]]};
function canvasFont(font,size){return (font.italic?'italic ':'')+(font.bold?'bold ':'')+size+'px '+JSON.stringify(font.name||'Calibri')+', "Malgun Gothic", sans-serif';}
async function normalFont(buffer){
 if(!globalThis.JSZip)return {name:'Calibri',size:11};
 const zip=await globalThis.JSZip.loadAsync(buffer),xml=await zip.file('xl/styles.xml')?.async('string');if(!xml)return {name:'Calibri',size:11};
 const doc=new DOMParser().parseFromString(xml,'application/xml'),styles=[...doc.getElementsByTagName('cellStyle')],normal=styles.find(style=>style.getAttribute('builtinId')==='0'||style.getAttribute('name')==='Normal');
 const xfs=doc.getElementsByTagName('cellStyleXfs')[0]?.getElementsByTagName('xf'),id=Number(xfs?.[Number(normal?.getAttribute('xfId')??0)]?.getAttribute('fontId')??0),font=doc.getElementsByTagName('fonts')[0]?.getElementsByTagName('font')[id];
 return {name:font?.getElementsByTagName('name')[0]?.getAttribute('val')||'Calibri',size:Number(font?.getElementsByTagName('sz')[0]?.getAttribute('val')||11)};
}
export async function captureWorkbookRange({ExcelJS,buffer,range='A1:E20',worksheetName}){
 const box=parseCaptureRange(range),book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
 const sheet=book.getWorksheet(worksheetName)||book.worksheets[0];if(!sheet)throw Error('시트를 찾을 수 없습니다.');
 const theme=themeColors(book._themes?.theme1),base=await normalFont(buffer),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 const fonts=new Map();for(let r=box.top;r<=box.bottom;r++)for(let c=box.left;c<=box.right;c++){const font=sheet.getCell(r,c).font??base;fonts.set(font.name||base.name,canvasFont(font,(font.size||base.size)*96/72));}
 if(document.fonts)await Promise.all([document.fonts.load(canvasFont(base,base.size*96/72)),...[...fonts.values()].map(font=>document.fonts.load(font))]);
 ctx.font=canvasFont(base,base.size*96/72);const mdw=Math.max(1,Math.round(Math.max(...'0123456789'.split('').map(value=>ctx.measureText(value).width))));
 const widths=[],heights=[],xs=[0],ys=[0];for(let c=1;c<=Math.max(box.right,sheet.columnCount);c++){widths[c]=sheet.getColumn(c).hidden?0:columnPixels(sheet.getColumn(c).width??sheet.properties.defaultColWidth??8.43,mdw);xs[c]=(xs[c-1]??0)+widths[c];}
 for(let r=1;r<=Math.max(box.bottom,sheet.rowCount);r++){heights[r]=sheet.getRow(r).hidden?0:(sheet.getRow(r).height??sheet.properties.defaultRowHeight??15)*96/72;ys[r]=(ys[r-1]??0)+heights[r];}
 const width=xs[box.right]-xs[box.left-1],height=ys[box.bottom]-ys[box.top-1];if(width<=0||height<=0||width>6000||height>6000)throw Error('이미지 범위를 확인해 주세요.');
 canvas.width=Math.ceil(width*2);canvas.height=Math.ceil(height*2);ctx.scale(2,2);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
 const x=c=>xs[c-1]-xs[box.left-1],y=r=>ys[r-1]-ys[box.top-1];
 const merges=Object.values(sheet._merges??{}).map(value=>value.model),entries=[];
 for(let r=box.top;r<=box.bottom;r++)for(let c=box.left;c<=box.right;c++){
  if(!widths[c]||!heights[r])continue;
  const merge=merges.find(m=>r>=m.top&&r<=m.bottom&&c>=m.left&&c<=m.right);
  if(merge&&(r!==Math.max(merge.top,box.top)||c!==Math.max(merge.left,box.left)))continue;
  const cell=sheet.getCell(merge?.top??r,merge?.left??c),endC=Math.min(merge?.right??c,box.right),endR=Math.min(merge?.bottom??r,box.bottom);
  const item={cell,r,c,endC,endR,x:x(c),y:y(r),w:xs[endC]-xs[c-1],h:ys[endR]-ys[r-1],merge};entries.push(item);
  if(cell.fill?.type==='pattern'&&cell.fill.pattern!=='none'){ctx.fillStyle=excelColor(cell.fill.fgColor,theme,'#fff');ctx.fillRect(item.x,item.y,item.w,item.h);}
 }
 // Text gets Excel's number format, overflow, alignment and shrink-to-fit.
 for(const item of entries){
  const {cell,r,c,x:xx,y:yy,w,h,merge}=item,alignment=cell.alignment??{},font=cell.font??base,value=cellDisplayText(cell);if(!value)continue;
  let clipRight=xx+w,clipLeft=xx;
  if(!merge&&!alignment.wrapText&&!alignment.shrinkToFit&&typeof cell.value==='string'){
   for(let col=c+1;col<=box.right;col++){const next=sheet.getCell(r,col);if(cellDisplayText(next)||next.isMerged)break;clipRight=x(col)+widths[col];}
  }
  let size=(font.size||base.size)*96/72;ctx.font=canvasFont(font,size);
  if(alignment.shrinkToFit&&!alignment.wrapText){const measured=Math.max(...value.split('\n').map(line=>ctx.measureText(line).width));if(measured>w-4){size*=Math.max(.05,(w-4)/measured);ctx.font=canvasFont(font,size);}}
  const lines=[];for(const paragraph of value.split('\n')){
   if(!alignment.wrapText){lines.push(paragraph);continue;}
   let line='';for(const char of paragraph){if(line&&ctx.measureText(line+char).width>w-4){lines.push(line);line=char;}else line+=char;}lines.push(line);
  }
  const horizontal=alignment.horizontal??(typeof cell.value==='number'||cell.value instanceof Date?'right':'left'),vertical=alignment.vertical??'bottom',lineHeight=size*1.2;
  const totalHeight=lines.length*lineHeight,startY=vertical==='top'?yy+2:vertical==='middle'?yy+(h-totalHeight)/2:yy+h-totalHeight-2;
  const indent=(alignment.indent||0)*ctx.measureText('   ').width,textX=horizontal==='center'?xx+w/2:horizontal==='right'?xx+w-2-indent:xx+2+indent;
  ctx.save();ctx.beginPath();ctx.rect(clipLeft,yy,clipRight-clipLeft,h);ctx.clip();ctx.fillStyle=excelColor(font.color,theme);ctx.textAlign=horizontal==='center'?'center':horizontal==='right'?'right':'left';ctx.textBaseline='top';
  if(alignment.textRotation&&typeof alignment.textRotation==='number'){ctx.translate(xx+w/2,yy+h/2);ctx.rotate(-alignment.textRotation*Math.PI/180);ctx.textAlign='center';ctx.fillText(value,0,-size/2);}else lines.forEach((line,i)=>{ctx.fillText(line,textX,startY+i*lineHeight);if(font.underline||font.strike){const measured=ctx.measureText(line).width,start=horizontal==='center'?textX-measured/2:horizontal==='right'?textX-measured:textX;ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=Math.max(.5,size/14);ctx.beginPath();const at=startY+i*lineHeight+size*(font.strike?.5:1);ctx.moveTo(start,at);ctx.lineTo(start+measured,at);ctx.stroke();}});
  ctx.restore();
 }
 // Render stored border edges. Hidden worksheet gridlines are never invented.
 const edges=new Map(),grid=sheet.views[0]?.showGridLines!==false;
 function edge(x1,y1,x2,y2,border){const info=BORDER[border?.style];if(!info)return;const key=[x1,y1,x2,y2].join(',');if(!edges.has(key)||info[0]>edges.get(key).info[0])edges.set(key,{x1,y1,x2,y2,border,info});}
 for(let r=box.top;r<=box.bottom;r++)for(let c=box.left;c<=box.right;c++){
  if(!widths[c]||!heights[r])continue;const cell=sheet.getCell(r,c),border=cell.border??{},xx=x(c),yy=y(r),w=widths[c],h=heights[r],merge=merges.find(m=>r>=m.top&&r<=m.bottom&&c>=m.left&&c<=m.right);
  const fallback=grid&&!merge&&(!cell.fill||cell.fill.pattern==='none')?{style:'hair',color:{argb:'FFD4D4D4'}}:undefined;
  edge(xx,yy,xx+w,yy,border.top??fallback);edge(xx,yy+h,xx+w,yy+h,border.bottom??fallback);edge(xx,yy,xx,yy+h,border.left??fallback);edge(xx+w,yy,xx+w,yy+h,border.right??fallback);
 }
 for(const edge of edges.values()){
  ctx.strokeStyle=excelColor(edge.border.color,theme);ctx.lineWidth=edge.border.style==='double'?1:edge.info[0];ctx.setLineDash(edge.info[1]);ctx.lineCap='butt';
  const draw=offset=>{ctx.beginPath();if(edge.x1===edge.x2){ctx.moveTo(edge.x1+offset,edge.y1);ctx.lineTo(edge.x2+offset,edge.y2);}else{ctx.moveTo(edge.x1,edge.y1+offset);ctx.lineTo(edge.x2,edge.y2+offset);}ctx.stroke();};
  if(edge.border.style==='double'){draw(-1);draw(1);}else draw(0);
 }ctx.setLineDash([]);
 const offset=(positions,sizes,anchor,key)=>{const native=anchor?.['native'+(key==='col'?'Col':'Row')],n=native??Math.floor(anchor?.[key]??0),off=anchor?.['native'+(key==='col'?'Col':'Row')+'Off'];return (positions[n]??0)+(off!=null?off/9525:((anchor?.[key]??n)-n)*(sizes[n+1]||0));};
 for(const entry of sheet.getImages()){
  const data=book.getImage(entry.imageId);if(!data)continue;
  const left=offset(xs,widths,entry.range.tl,'col')-xs[box.left-1],top=offset(ys,heights,entry.range.tl,'row')-ys[box.top-1];
  const w=entry.range.br?offset(xs,widths,entry.range.br,'col')-offset(xs,widths,entry.range.tl,'col'):entry.range.ext?.width??0,h=entry.range.br?offset(ys,heights,entry.range.br,'row')-offset(ys,heights,entry.range.tl,'row'):entry.range.ext?.height??0;
  if(left+w<=0||top+h<=0||left>=width||top>=height)continue;
  const blob=data.buffer?new Blob([data.buffer],{type:'image/'+data.extension}):await(await fetch(data.base64)).blob(),url=URL.createObjectURL(blob);
  try{const image=new Image();image.src=url;await image.decode();ctx.drawImage(image,left,top,w||image.width,h||image.height);}finally{URL.revokeObjectURL(url);}
 }
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('이미지 생성 실패')),'image/png'));
}
