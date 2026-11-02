import { dailyWorkItems } from './private-mail-work.js';
import { analyzeTargetedManual } from './private-mail-manual.js';
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

export function monthlyMailRelated(tasks,{ownerId,overrides={}}) {
 if(ownerId!==TARGET.owner_id)throw Error('MONTHLY_OWNER');
 return dailyWorkItems({groups:[],tasks:[],issues:[],waiting:[]},{},{portalTasks:tasks,portalOwnerId:ownerId,workOverrides:overrides})
  .filter(item=>item.monthly&&['task','issue'].includes(item.category)).slice(0,100)
  .map(item=>({ref:item.workId,kind:'tasks',text:item.title,evidence:item.title,status:item.status==='complete'?'complete':'pending',ownerId,monthly:item.monthly}));
}
export async function normalizeMonthlyMailUpdates({updates,candidates,mail,context,ai,fetcher,isolatedVerification=false}) {
 const accepted=[],review=[],responses=[],seen=new Set(),sourceTime=Date.parse(mail.received_at??mail.sent_at);
 if(!Number.isFinite(sourceTime))return {updates:[],review:updates.map(update=>({ref:update.ref,reason:'monthly_source_time_confirmation'})),responses};
 const sourceAt=new Date(sourceTime).toISOString();
 for(const update of updates){
  const prior=candidates.find(item=>item.ref===update.ref),evidence=update.evidence;
  if(!prior||seen.has(update.ref)||typeof evidence!=='string'||!evidence.trim()||evidence.length>2000||!context.currentBody.includes(evidence)){review.push({ref:update.ref,reason:'monthly_source_confirmation'});continue;}
  seen.add(update.ref);
  const monthly=prior.monthly,period=monthly.targetPeriod,periodMonth=period?.from.slice(0,7);
  const explicitPeriod=/(?:(20[0-9]{2})\s*년\s*)?([0-9]{1,2})\s*월\s*분/.exec(evidence);
  const range=/([0-9]{1,2})\s*일?\s*(?:~|부터)\s*([0-9]{1,2}|말일)\s*일?/.exec(evidence);
  const wrongPeriod=explicitPeriod&&(!periodMonth||Number(periodMonth.slice(5))!==Number(explicitPeriod[2])||(explicitPeriod[1]&&periodMonth.slice(0,4)!==explicitPeriod[1]));
  const wrongRange=range&&(!period||Number(period.from.slice(8))!==Number(range[1])||(range[2]!=='말일'&&Number(period.through.slice(8))!==Number(range[2])));
  const wrongStage=(monthly.advanceKind==='yangsan_first'&&/2차/.test(evidence)&&!/1차/.test(evidence))||(monthly.advanceKind==='yangsan_second'&&/1차/.test(evidence)&&!/2차/.test(evidence));
  const sameTitle=candidates.some(other=>other.ref!==prior.ref&&other.text===prior.text&&other.status!=='complete');
  if(wrongPeriod||wrongRange||wrongStage||(sameTitle&&!/(?:20[0-9]{2}|[0-9]{1,2}\s*월|이번\s*달|지난\s*달|전월|당월)/.test(evidence))){review.push({ref:update.ref,reason:'monthly_period_confirmation'});continue;}
  try{
   const result=await analyzeTargetedManual({isolatedVerification,entry:{text:context.currentBody,focusEvidence:evidence,submittedAt:sourceAt,referenceDate:kstDay(sourceAt),originalContext:JSON.stringify({subject:mail.subject,sender:mail.sender,envelope:mail.envelope,ownerContext:context.ownerContext})},target:{workId:prior.ref,title:prior.text,kind:'task',status:prior.status,monthly,mailContext:{ownerContext:context.ownerContext,intent:mail.intent??'update'}},ai,fetcher});responses.push(result.response);const item=result.reply.items[0];
   if(item.needsConfirmation||item.workRef!==prior.ref||!['pending','complete'].includes(item.workflowStatus)){review.push({ref:prior.ref,reason:'monthly_meaning_confirmation'});continue;}
   accepted.push({ref:prior.ref,sourceId:mail.id,sourceAt,resolution:'monthly_mail_v1',status:item.workflowStatus,...(item.stateDeclared===true?{stateDeclared:true}:{}),text:item.text,evidence,details:item.details??[],needsConfirmation:false});
  }catch(error){const code=['MANUAL_FORMAT','MANUAL_EVIDENCE','MODEL_RESPONSE','MODEL_TRUNCATED','MODEL_TIMEOUT','MODEL_FAILED','AI_NOT_CONFIGURED'].includes(error?.code??error?.message)?(error.code??error.message):'MONTHLY_VERIFICATION_FAILED';review.push({ref:prior.ref,reason:'monthly_verification_unavailable',code,...(['evidence','details','serviceOriginal','completionEvidence'].includes(error?.targetField)?{field:error.targetField}:{})});}
 }
 return {updates:accepted,review,responses};
}

// Bind diagnostic output to the fixed synthetic source and actual isolated SQL readback.
export function verifyMonthlyDiagnosticSnapshot(fixture,saved,tasks){
 const seed=fixture?.monthlyTask,update=saved?.monthlyUpdates?.[0];
 if(!fixture?.monthlyTemplate||!seed||!Array.isArray(tasks)||tasks.length!==1||(saved.monthlyUpdates?.length??0)>1)throw Error('STRESS_MONTHLY_SQL_MISMATCH');
 const task=tasks[0],monthly=seed.inputs.personal_monthly,m=task.inputs?.personal_work,status=update?.status==='complete'?'completed':'pending';
 const summary=update?[update.text,...update.details]:[],keys=update?['source:'+seed.id,'source:'+saved.source.id]:['source:'+seed.id];
 if(task.id!==seed.id||task.owner_id!==TARGET.owner_id||task.title!==seed.title||task.status!==status||task.version!==(update?2:1)||task.center_code!==null||task.work_scope!=='delivery_team'||task.work_date!==monthly.visibleFrom||task.due_at!==null||m?.workId!=='source:'+seed.id||m?.ownerId!==TARGET.owner_id||JSON.stringify(m.summary)!==JSON.stringify(summary)||(m.progress??null)!==(update?.text??null)||JSON.stringify([...m.sourceKeys].sort())!==JSON.stringify(keys.sort())||(status==='completed'?Date.parse(task.completed_at)!==Date.parse(update.sourceAt):task.completed_at!=null))throw Error('STRESS_MONTHLY_SQL_MISMATCH');
 const actual=task.inputs.personal_monthly;
 for(const key of ['ownerId','familyId','scheduledMonth','scheduledDate','visibleFrom','qualifier','originalSchedule','advanceKind','paymentDate'])if(actual?.[key]!==monthly[key])throw Error('STRESS_MONTHLY_SQL_MISMATCH');
 if(JSON.stringify([actual.targetPeriod?.from,actual.targetPeriod?.through])!==JSON.stringify([monthly.targetPeriod?.from,monthly.targetPeriod?.through]))throw Error('STRESS_MONTHLY_SQL_MISMATCH');
 return [{...seed,status,version:task.version,updated_at:task.updated_at,completed_at:task.completed_at,inputs:{personal_monthly:monthly,personal_work:{...seed.inputs.personal_work,status:status==='completed'?'complete':'pending',summary,progress:update?.text??null,verifiedCompletionAt:status==='completed'?update.sourceAt:null,sourceKeys:keys}}}];
}
