import { APPROVED_MAIL_TARGET as TARGET } from './private-mail-policy.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const date = (year,month,date) => new Date(Date.UTC(year,month,date)).toISOString().slice(0,10);
function kstDay(now) {
  if(typeof now!=='string'||!Number.isFinite(Date.parse(now)))throw Error('MONTHLY_DATE');
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
function definition(template,ownerId) {
  const config=template.spec?.personal_monthly;
  if(!config)return null;
  if(config.ownerId!==ownerId)throw Error('MONTHLY_OWNER');

  if(!uuid.test(template.id??'')||!uuid.test(template.family_id??'')||!Number.isSafeInteger(template.version)||template.version<1||!['approved','retired'].includes(template.status)
    ||typeof template.title!=='string'||!template.title.trim()||template.title.length>200||!day(template.spec.effective_from)
    ||template.spec.repeat?.kind!=='monthly'||!Number.isInteger(template.spec.repeat.day)||template.spec.repeat.day<1||template.spec.repeat.day>31
    ||config.leadDays!==3||!['on','before'].includes(config.qualifier)
    ||![null,'previous_second_half','current_first_half','previous_full_month'].includes(config.targetPeriod??null)
    ||typeof config.originalSchedule!=='string'||!config.originalSchedule.trim()||config.originalSchedule.length>500
    ||config.source?.kind!=='onenote'||typeof config.source.pageId!=='string'||!config.source.pageId.trim()||config.source.pageId.length>500)throw Error('MONTHLY_TEMPLATE');
  const advanceRules={yangsan_first:[23,'current_first_half','month_end'],yangsan_second:[7,'previous_second_half','day15'],nonghyup:[1,'previous_full_month','day10']};
  const rule=advanceRules[config.advanceKind];
  if(config.advanceKind!=null&&!rule||rule&&(template.spec.repeat.day!==rule[0]||config.targetPeriod!==rule[1]||config.paymentRule!==rule[2])||!rule&&(config.targetPeriod!=null||config.paymentRule!=null))throw Error('MONTHLY_TEMPLATE');
  return {...template,config};
}
// Preview/materialization contract only. No operating registration or provider call.
export function monthlyWorkOccurrences(templates,{now,ownerId,existing=[]}) {
  if(ownerId!==TARGET.owner_id)throw Error('MONTHLY_OWNER');
  const today=kstDay(now),families=new Map(),seen=new Set(existing.map(item=>item.occurrenceKey??item.occurrence_key));
  for(const template of templates){const valid=definition(template,ownerId);if(!valid)continue;families.set(valid.family_id,[...(families.get(valid.family_id)??[]),valid]);}
  const [currentYear,currentMonth]=today.split('-').map(Number),end=Date.UTC(currentYear,currentMonth,1),result=[];
  for(const versions of families.values()){
    versions.sort((a,b)=>b.version-a.version);
    const first=versions.map(t=>t.spec.effective_from).sort()[0];let cursor=Date.parse(first.slice(0,7)+'-01T00:00:00Z');
    for(;cursor<=end;){
      const base=new Date(cursor),year=base.getUTCFullYear(),month=base.getUTCMonth(),scheduledMonth=date(year,month,1).slice(0,7);
      cursor=Date.UTC(year,month+1,1);
      const template=versions.find(t=>{const scheduled=date(year,month,t.spec.repeat.day);return scheduled.startsWith(scheduledMonth)&&scheduled>=t.spec.effective_from;});
      if(!template||template.status!=='approved')continue;
      const scheduledDate=date(year,month,template.spec.repeat.day),visibleFrom=new Date(Date.parse(scheduledDate+'T00:00:00Z')-3*86400000).toISOString().slice(0,10),occurrenceKey=template.family_id+':monthly:'+scheduledMonth+':'+ownerId;
      if(visibleFrom>today||seen.has(occurrenceKey))continue;
      const targetPeriod=template.config.targetPeriod==='previous_second_half'?{from:date(year,month-1,16),through:date(year,month,0)}:template.config.targetPeriod==='current_first_half'?{from:date(year,month,1),through:date(year,month,15)}:template.config.targetPeriod==='previous_full_month'?{from:date(year,month-1,1),through:date(year,month,0)}:null;
      const paymentDate=template.config.paymentRule==='month_end'?date(year,month+1,0):template.config.paymentRule==='day15'?date(year,month,15):template.config.paymentRule==='day10'?date(year,month,10):null;
      result.push({templateId:template.id,familyId:template.family_id,ownerId,title:template.title,occurrenceKey,scheduledMonth,scheduledDate,visibleFrom,targetPeriod,paymentDate,advanceKind:template.config.advanceKind??null,qualifier:template.config.qualifier,originalSchedule:template.config.originalSchedule,source:{...template.config.source},dueAt:null});seen.add(occurrenceKey);
    }
  }
  return result.sort((a,b)=>a.scheduledDate.localeCompare(b.scheduledDate)||a.familyId.localeCompare(b.familyId));
}

// Owner-only projection of canonical native instances. No template seed or issuance occurs here.
export async function loadMonthlyPortalTasks({db,ownerId,day:reportDay=null}) {
  if(ownerId!==TARGET.owner_id)throw Error('MONTHLY_OWNER');
  if(reportDay!==null&&!day(reportDay))throw Error('MONTHLY_DATE');
  const rows=await db('operations_tasks?select=*&owner_id=eq.'+ownerId+'&inputs->personal_monthly->>ownerId=eq.'+ownerId);
  if(!Array.isArray(rows))throw Error('MONTHLY_SOURCE');
  const ids=new Set();
  for(const row of rows){
    if(!uuid.test(row.id??'')||row.owner_id!==ownerId||row.inputs?.personal_monthly?.ownerId!==ownerId||row.inputs?.personal_work?.workId!=='source:'+row.id)throw Error('MONTHLY_SOURCE');
    ids.add(row.id);
  }
  if(!ids.size)return [];
  const values=reportDay===null?rows:await db('rpc/private_mail_portal_snapshots',{method:'POST',body:{p_box:TARGET.mailbox_id,p_user:ownerId,p_day:reportDay}});
  if(!Array.isArray(values))throw Error('MONTHLY_SOURCE');
  return values.filter(row=>ids.has(row.id)&&row.deleted_at==null&&row.owner_id===ownerId&&row.inputs?.personal_monthly?.ownerId===ownerId);
}
