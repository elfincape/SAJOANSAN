export type RouteRow={date:string;weekday:string;ansanGimhae1:number|'';ansanGimhae2:number|'';busanAnsan1:number|'';busanAnsan2:number|''};

type Message={date:string;weekday:string;speaker:string;body:string;chatMinute:number;sequence:number};
type Slot={identity:string;pallet:number|''};

export function parseKakaoBaseline(text:string):RouteRow[]{
  const messages:Message[]=[],dates=new Map<string,string>();
  let date='',weekday='',current:Message|null=null;
  const flush=()=>{if(current)messages.push(current);current=null;};
  for(const rawLine of String(text||'').replace(/&#x20;/gi,' ').split(/\r?\n/)){
    const dateMatch=rawLine.match(/^-+\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s+([^\s-]+)\s*-+$/);
    if(dateMatch){flush();date=`${dateMatch[1]}-${dateMatch[2].padStart(2,'0')}-${dateMatch[3].padStart(2,'0')}`;weekday=dateMatch[4];dates.set(date,weekday);continue;}
    const messageMatch=rawLine.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
    if(messageMatch){flush();if(date)current={date,weekday,speaker:messageMatch[1].trim(),chatMinute:parseChatMinute(messageMatch[2]),sequence:messages.length,body:messageMatch[3]||''};continue;}
    if(current)current.body+=`\n${rawLine}`;
  }
  flush();
  messages.sort((a,b)=>a.date.localeCompare(b.date)||a.chatMinute-b.chatMinute||a.sequence-b.sequence);

  const groups=new Map<string,{ansanGimhae:Slot[];busanAnsan:Slot[]}>();
  for(const message of messages){
    const normalized=message.body.replace(/\s+/g,' ').trim();
    const direction=/^안산\s*-\s*김해(?:\s|$)/.test(normalized)?'ansanGimhae':/^부산\s*-\s*안산(?:\s|$)/.test(normalized)?'busanAnsan':null;
    if(!direction)continue;
    if(!groups.has(message.date))groups.set(message.date,{ansanGimhae:[],busanAnsan:[]});
    const slots=groups.get(message.date)![direction],identity=messageIdentity(message),existing=slots.find(slot=>slot.identity===identity);
    let slot=existing;
    if(!slot&&slots.length<2){slot={identity,pallet:''};slots.push(slot);}
    const count=lastPallet(message.body);
    if(slot&&count!=='')slot.pallet=count;
  }

  return [...dates.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([rowDate,rowWeekday])=>{
    const group=groups.get(rowDate)||{ansanGimhae:[],busanAnsan:[]};
    return {date:rowDate,weekday:rowWeekday,ansanGimhae1:group.ansanGimhae[0]?.pallet??'',ansanGimhae2:group.ansanGimhae[1]?.pallet??'',busanAnsan1:group.busanAnsan[0]?.pallet??'',busanAnsan2:group.busanAnsan[1]?.pallet??''};
  });
}

export function mergeRouteRows(aiRows:RouteRow[],baseline:RouteRow[]):RouteRow[]{
  const aiByDate=new Map(aiRows.map(row=>[row.date,row]));
  return baseline.map(base=>{const ai=aiByDate.get(base.date);return {date:base.date,weekday:ai?.weekday||base.weekday,ansanGimhae1:valueOrBaseline(ai?.ansanGimhae1,base.ansanGimhae1),ansanGimhae2:valueOrBaseline(ai?.ansanGimhae2,base.ansanGimhae2),busanAnsan1:valueOrBaseline(ai?.busanAnsan1,base.busanAnsan1),busanAnsan2:valueOrBaseline(ai?.busanAnsan2,base.busanAnsan2)};});
}

function messageIdentity(message:Message){
  const plate=message.body.match(/(?:[가-힣]{2}\s*)?\d{2,3}\s*[가-힣]\s*\d{4}/)?.[0];
  if(plate)return `plate:${plate.replace(/\s+/g,'')}`;
  const phone=message.body.match(/01\d[-\s]?\d{3,4}[-\s]?\d{4}/)?.[0];
  return phone?`phone:${phone.replace(/\D/g,'')}`:`speaker:${message.speaker}`;
}
function lastPallet(body:string):number|''{const matches=[...String(body).matchAll(/(\d+)\s*[pP](?![a-zA-Z])/g)];return matches.length?Number(matches.at(-1)![1]):'';}
function parseChatMinute(value:string){const match=String(value).match(/(오전|오후)\s*(\d{1,2}):(\d{2})/);if(!match)return Number.MAX_SAFE_INTEGER;let hour=Number(match[2])%12;if(match[1]==='오후')hour+=12;return hour*60+Number(match[3]);}
function valueOrBaseline(value:number|''|undefined,baseline:number|''){return value==null||value===''?baseline:value;}
