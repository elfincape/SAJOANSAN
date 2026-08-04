export function sanitizeTsvCell(value,type='text'){
  if(value===null||value===undefined)return '';
  if(type==='number'&&typeof value==='number'&&Number.isFinite(value))return String(value);
  let text=String(value).replace(/[\t\r\n]+/g,' ');
  if(/^[=+\-@]/.test(text))text=`'${text}`;
  return text;
}
export function buildTsv(columns,rows){
  const cols=Array.isArray(columns)?columns:[];
  const header=cols.map(c=>sanitizeTsvCell(c.label||c.key)).join('\t');
  const body=(Array.isArray(rows)?rows:[]).map(row=>cols.map(c=>sanitizeTsvCell(row?.[c.key],c.type)).join('\t'));
  return [header,...body].join('\n');
}
export function normalizeAssistantResponse(value){
  if(!value||typeof value!=='object')throw new Error('잘못된 응답 형식입니다.');
  return {answer:String(value.answer||''),columns:Array.isArray(value.columns)?value.columns.slice(0,30).map(c=>({key:String(c.key||''),label:String(c.label||c.key||''),type:c.type==='number'?'number':'text'})).filter(c=>c.key):[],rows:Array.isArray(value.rows)?value.rows.slice(0,100):[],notices:Array.isArray(value.notices)?value.notices.map(String).slice(0,10):[],meta:value.meta&&typeof value.meta==='object'?value.meta:{}};
}
