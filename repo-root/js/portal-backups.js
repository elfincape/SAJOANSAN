import {operationsBackups} from './onedrive-api.js';
const labels={centers:'센터',companies:'운수사',drivers:'기사',vehicles:'차량',routes:'코스',delivery_points:'납품처',route_stops:'코스별 납품처'};
const actions={added:'추가',removed:'삭제',changed:'변경'};
export function createPortalBackups({node,button,message,stamp}){
 let generation=0,selection=0;
 return async function renderBackups(){
  const ticket=++generation;++selection;
  const items=document.getElementById('items'),detail=document.getElementById('detail');
  document.getElementById('quick-actions').replaceChildren();items.replaceChildren(node('p','보관 원본을 불러오는 중입니다…'));
  document.getElementById('list-title').textContent='보관된 운영 원본';document.getElementById('count').textContent='';
  detail.replaceChildren(node('h2','운영 원본 보관'),node('p','매월 마지막 날 23:59 (한국시간)에 전체 운영 마스터를 보관합니다. OneDrive 저장이 실패하면 같은 원본으로 5분 간격으로 재시도합니다.'),node('p','저장 위치: SAJOANSAN 업무자료 / 시스템 백업. 현재 원본은 월말 원본과 구분합니다.'));
  try{
   const rows=await operationsBackups.list();if(ticket!==generation||!items.isConnected||document.querySelector('[data-view=backups]')?.getAttribute('aria-pressed')!=='true')return;
   items.replaceChildren();document.getElementById('count').textContent=rows.length+'건';
   if(!rows.length)items.append(node('p','아직 보관된 운영 원본이 없습니다.'));
   for(const row of rows)button((row.period==='baseline'?'현재 원본':row.period+' 월말 원본')+' · '+({saved:'OneDrive 저장 완료',pending:'저장 대기',failed:'저장 실패'}[row.status]),()=>show(row),items,'task-row');
  }catch(error){if(ticket===generation)message(error.message,true);}
  function active(selected){return ticket===generation&&selected===selection&&document.querySelector('[data-view=backups]')?.getAttribute('aria-pressed')==='true';}
  function show(row){
   const selected=++selection;detail.replaceChildren(node('h2',row.file_name),node('p','원본 보관 시각 · '+stamp(row.captured_at)));
   if(row.period==='baseline')detail.append(node('p','기능 적용 시점의 실제 운영 원본입니다. 월말 원본과 별도로 보관했습니다.'));
   for(const [key,count] of Object.entries(row.counts))detail.append(node('p',(labels[key]??key)+' · '+count+'건'));
   if(row.last_error)detail.append(node('p',row.last_error,'error'));
   detail.append(node('p','저장 시도 · '+row.attempts+'회'+(row.verified_at?' · 검증 완료 '+stamp(row.verified_at):' · DB 원본 보관, OneDrive 저장 대기')));
   if(row.status==='saved')button('원본 엑셀 다운로드',async()=>{
    message('OneDrive 원본 내용을 확인하는 중입니다…');try{const blob=await operationsBackups.download(row.id);if(!active(selected))return;const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=row.file_name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);message('다운로드를 시작했습니다.');}catch(error){if(active(selected))message(error.message,true);}
   },detail,'primary');
   else{const retry=button('같은 원본으로 OneDrive 저장 재시도',async()=>{
    retry.disabled=true;message('보관된 원본을 저장하는 중입니다…');try{await operationsBackups.retry(row.id);if(active(selected)){await renderBackups();message('원본 저장과 내용 검증을 완료했습니다.');}}catch(error){if(active(selected))message(error.message,true);}finally{retry.disabled=false;}
   },detail,'primary');}
   const comparison=node('section');detail.append(comparison);
   const compare=button('현재 운영정보와 비교',async()=>{
    compare.disabled=true;message('변경 내용을 비교하는 중입니다…');try{
     const result=await operationsBackups.compare(row.id);if(!active(selected))return;comparison.replaceChildren(node('h3','보관 이후 변경 · '+result.total+'건'));
     for(const summary of result.counts)comparison.append(node('p',(labels[summary.table_name]??summary.table_name)+' · 추가 '+summary.added+' · 삭제 '+summary.removed+' · 변경 '+summary.changed));
     for(const item of result.items)comparison.append(node('h4',(labels[item.table_name]??item.table_name)+' · '+item.title+' · '+actions[item.action]),node('p','변경 항목 · '+item.fields.join(', ')));
     if(result.limited)comparison.append(node('p','변경 기록 200건을 표시했습니다. 전체 원본은 엑셀에서 확인하세요.'));if(!result.total)comparison.append(node('p','보관 원본과 현재 운영정보가 같습니다.'));message('');
    }catch(error){if(active(selected))message(error.message,true);}finally{compare.disabled=false;}
   },detail);
  }
 };
}
