export const statusLabels={pending:'미완료',in_progress:'진행중',completed:'완료',not_applicable:'해당없음',open:'미해결',resolved:'해결'};
export const actionLabels={created:'업무 등록',updated:'업무 수정',completed:'완료',not_applicable:'해당없음',handoff:'인계',deadline_changed:'기한 변경',incident_created:'특이사항 등록',incident_updated:'내용 수정',support_requested:'HQ 지원 요청',support_action:'HQ 실제 조치',resolved:'해결',reopened:'재개'};
export function koreaDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function dateRange(period,through=koreaDate()) {
 const end=new Date(through+'T00:00:00Z');
 if(!Number.isFinite(end.valueOf())||end.toISOString().slice(0,10)!==through)throw Error('조회 날짜를 확인해 주세요.');
 const start=new Date(end);
 if(period==='week')start.setUTCDate(start.getUTCDate()-6);
 if(period==='month')start.setUTCDate(1);
 return {from:start.toISOString().slice(0,10),through};
}
export function filterOperations(rows,{kind='',settlement=''}={}){
 return rows.filter(row=>{
  const inputs=row.inputs??{};
  const replacement=inputs['업무유형']==='대차 배차 진행'||row.title==='대차 배차 진행'||!!inputs['대차기사명']||!!inputs['대차차량번호'];
  return (!kind||replacement)&&(!settlement||inputs['정산방식']===settlement);
 });
}
export function exportRows(rows,view){
 if(view==='incidents')return rows.map(row=>({'발생일':row.created_at,'특이사항':row.title,'종류':row.kind,'상태':statusLabels[row.status]??row.status,
  'HQ 지원':{none:'없음',requested:'요청',supporting:'지원중',done:'지원완료'}[row.support_state]??row.support_state,'발생내용':row.inputs?.['발생내용']??'','해결시각':row.resolved_at??''}));
 return rows.map(row=>({'업무일':row.work_date??row.report_date??'','업무':row.title,'상태':statusLabels[row.status]??row.status,'처리':view==='daily'?(actionLabels[row.action]??row.action):'',
 '기사명':row.inputs?.['기사명']??'','차량번호':row.inputs?.['차량번호']??'','코스·납품처':row.inputs?.['코스·납품처']??'',
 '톤수':row.inputs?.['톤수']??'','사유':row.inputs?.['사유']??'','대차기사명':row.inputs?.['대차기사명']??'',
 '대차차량번호':row.inputs?.['대차차량번호']??'','정산방식':row.inputs?.['정산방식']??'','실제 조치':row.action_note??'', '인계 메모':row.handoff_memo??''}));
}
