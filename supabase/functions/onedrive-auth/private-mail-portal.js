import { APPROVED_MAIL_TARGET as TARGET } from './private-mail-policy.js';
import { portalWorkInput } from './private-mail-work.js';
import { manualDailyView } from './private-mail-manual.js';
import { dailyBriefingView, dailyReportIdentity } from './private-mail-briefing-model.js';

// Not registered as a public action. Activation/visibility is a separate deployment decision.
export async function syncPersonalPortalWork({work,requestId,scope,visibleFrom}, {ownerId,rpc}) {
  if(ownerId!==TARGET.owner_id)throw Error('OWNER_REQUIRED');
  const tasks=await rpc('private_mail_portal_snapshots',{p_box:TARGET.mailbox_id,p_user:ownerId});
  const current=tasks.find(task=>task.inputs?.personal_work?.workId===work.workId);
  if(current&&work.portalTaskId&&current.id!==work.portalTaskId)throw Error('WORK_LINK_CONFLICT');
  const document=portalWorkInput({...work,
    portalTaskId:current?.id??work.portalTaskId,
    portalVersion:work.portalVersion??current?.version,
  },{ownerId,scope,visibleFrom});
  const task=await rpc('private_mail_portal_upsert',{p_box:TARGET.mailbox_id,p_user:ownerId,p_request:requestId,p_document:document});
  return {saved:true,workId:work.workId,portalTaskId:task.id,version:task.version,task};
}
export async function syncPersonalPortalBatch(items,ctx) {
  const results=[];
  for(const item of items) {
    try{results.push(await syncPersonalPortalWork(item,ctx));}
    catch(error){results.push({saved:false,workId:item.work.workId,code:/^(?:WORK_[A-Z_]+|OWNER_REQUIRED)$/.test(error.message??'')?error.message:'PORTAL_STORAGE_FAILED'});}
  }
  return results;
}
export async function personalPortalDailyView({now,analyses=[],manualEntries={},overrides={}}, {ownerId,rpc}) {
  if(ownerId!==TARGET.owner_id)throw Error('OWNER_REQUIRED');
  const day=dailyReportIdentity(now).day;
  const portalTasks=await rpc('private_mail_portal_snapshots',{p_box:TARGET.mailbox_id,p_user:ownerId,p_day:day});
  const manual=manualDailyView(manualEntries,day,overrides);
  return dailyBriefingView({now,analyses,overrides,manual,portalTasks,portalOwnerId:ownerId});
}
