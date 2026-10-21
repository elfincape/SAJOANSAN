import { OPUS_FALLBACK_MODEL } from './one-top-config';
export interface ReceiptRecord {time:string;a:number|null;b:number|null}
export interface ReceiptResult {center_name?:string;vehicle_number:string;date:string;records:ReceiptRecord[]}
export interface Capture {id:string;dbId:string|null;savedAt:string|null;cloudDirty:boolean;name:string;dataUrl:string;supplementalDataUrl:string|null;status:'pending'|'analyzing'|'done'|'error';result:ReceiptResult|null;error:string;analysisModel?:string}
export interface MatchIssue {item:string;message:string}
export function computeResultValues(freezerRaw: unknown,refrigeratedRaw: unknown) {
    const freezerText=String(freezerRaw??'').trim(),refrigeratedText=String(refrigeratedRaw??'').trim();
    const freezer=toNullableNumber(freezerText),refrigerated=toNullableNumber(refrigeratedText);
    const freezerBlank=!freezerText,refrigeratedBlank=!refrigeratedText;
    return {
      compliance:(freezerBlank||(freezer!=null&&freezer<=-18))&&(refrigeratedBlank||(refrigerated!=null&&refrigerated>0&&refrigerated<10))?'준수':'미준수',
      temperaturePair:(!freezerBlank&&!refrigeratedBlank)?'O':'X',
      shipmentType:!freezerBlank&&refrigeratedBlank?'냉동 출고':freezerBlank&&!refrigeratedBlank?'냉장 출고':'',
    };
  }

export function chooseTemperatures(a: unknown,b: unknown) {
    const values=[{source:'A',value:toNullableNumber(a)},{source:'B',value:toNullableNumber(b)}].filter((x): x is {source:string;value:number}=>x.value!=null);
    const freezer=values.find(x=>x.value<=-16)?.value??null;
    const refrigeratedCandidates=values.filter(x=>x.value>-16&&x.value<=10).sort((x,y)=>{const xp=x.value>=.1&&x.value<=10?0:1,yp=y.value>=.1&&y.value<=10?0:1;return xp-yp||(x.source==='A'?-1:1);});
    return {freezer,refrigerated:refrigeratedCandidates[0]?.value??null};
  }

  // 영수증의 최신 기록은 시간 정렬 결과가 아니라 물리적으로 가장 맨 윗줄이다.
  // 같은 시간이 반복돼도 API가 반환한 원래 순서의 첫 번째 행을 사용한다.
export function selectRecord(records: ReceiptRecord[] | null | undefined) { return (records||[]).find(Boolean)||null; }
export function normalizeVehicle(value: unknown) { const digits=String(value||'').replace(/\D/g,''); return digits.slice(-4); }
export function normalizeDate(value: unknown) { const s=String(value||'').trim(); const m=s.match(/^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})$/); return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:''; }
export function normalizeTime(value: unknown) { const m=String(value||'').trim().match(/^(\d{1,2}):(\d{2})$/); return m?`${m[1].padStart(2,'0')}:${m[2]}`:''; }
export function normalizeCenterName(value: unknown) { const text=String(value||'').trim();return text.replace(/\s+/g,'').includes('ㄱㅈㅇ')?'곤지암':text; }
export function defaultKoreanDate(now=new Date()) { const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));const date=new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day)+(Number(parts.hour)>=19?1:0)));return date.toISOString().slice(0,10); }
export function formatTemplateDate(value: string) { const m=String(value||'').match(/^\d{4}-\d{2}-(\d{2})$/); return m?`${Number(m[1])}일`:value; }
export function toNullableNumber(value: unknown) { if(value===null||value===undefined||String(value).trim()==='')return null; const n=Number(String(value).replace(/℃/g,'').trim()); return Number.isFinite(n)?n:null; }
export function normalizeApiResult(value:unknown,defaultDate:string):ReceiptResult {
 const raw=(value&&typeof value==='object'?value:{}) as Record<string,unknown>,records=Array.isArray(raw.records)?raw.records:[];
 return {center_name:normalizeCenterName(raw.center_name),vehicle_number:raw.vehicle_number==null?'':String(raw.vehicle_number).trim(),date:normalizeDate(raw.date)||defaultDate,records:records.map((record:unknown)=>{const row=(record&&typeof record==='object'?record:{}) as Record<string,unknown>;return {time:normalizeTime(row.time),a:toNullableNumber(row.a),b:toNullableNumber(row.b)};})};
}
export function statusClass(status:string){return status==='done'?'status-ok':status==='error'?'status-error':'status-warn';}
  export function statusLabel(item:Capture){const count=item.result?.records?.length||0,modelNote=item.analysisModel===OPUS_FALLBACK_MODEL?' · Haiku 무응답으로 Opus 5 사용':'';return item.status==='done'?`분석 완료 (${count}건${count>1?' · 맨 윗줄 사용':''}${modelNote})`:item.status==='error'?`실패: ${item.error}`:item.status==='analyzing'?'분석 중':'대기';}
  export function newUuid(){if(typeof globalThis.crypto?.randomUUID==='function')return crypto.randomUUID();return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);});}
