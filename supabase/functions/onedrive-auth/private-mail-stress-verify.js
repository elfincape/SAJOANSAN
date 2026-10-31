import PostalMime from 'postal-mime';
import { STRESS_FIXTURES, fixtureById } from './private-mail-stress-fixtures.js';
import { emlHeaderText, mailBodyText, mailMessageTimes } from './private-mail-body.js';
import { inspectMailImage, selectMailPhotos } from './private-mail-images.js';
import { loadApprovedRemoteMailImages } from './private-mail-remote-images.js';
import { analyzePrivateMail } from './private-mail-analysis.js';
import { handleManualMessage, manualDailyView } from './private-mail-manual.js';
import { dailyBriefingView, renderDailyBriefing } from './private-mail-briefing-model.js';
import { APPROVED_MAIL_TARGET as TARGET } from './private-mail-policy.js';

const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const day = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const syntheticId = fixture => fixture.remoteUrls?.length ? '11111111-1111-4111-8111-111111111111' : 'f0000000-0000-4000-8000-'+String(STRESS_FIXTURES.indexOf(fixture)+1).padStart(12,'0');
export function stressCatalogue() {
  return STRESS_FIXTURES.map(({id,kind,expected})=>({id,kind,expected}));
}
export async function parseStressMail(fixture, remoteFetcher) {
  const raw = new TextEncoder().encode(fixture.mime);
  const parsed = await PostalMime.parse(raw,{forceRfc822Attachments:true,maxNestingDepth:20,maxPartCount:60});
  const headers = emlHeaderText(raw);
  const text = parsed.text ? mailBodyText(parsed.text,'text') : mailBodyText(parsed.html ?? '','html');
  const bytes = new Map(), files = [];
  for (const [index,attachment] of (parsed.attachments??[]).entries()) {
    const data = new Uint8Array(attachment.content);
    const shape = /^image\//.test(attachment.mimeType) ? inspectMailImage(data) : {};
    bytes.set(index,data);
    files.push({index,name:attachment.filename||'image.png',mediaType:attachment.mimeType,byte_size:data.length,content_hash:await digest(data),contentId:attachment.contentId,disposition:attachment.disposition,...shape});
  }
  const photos = selectMailPhotos({subject:parsed.subject,text,html:parsed.html??'',files});
  const id = syntheticId(fixture);
  const images = photos.selected.map(file=>({id:id+':'+file.index,name:file.name,mediaType:file.mediaType,contentHash:file.content_hash,width:file.width,height:file.height,bytes:bytes.get(file.index)}));
  if (fixture.remoteUrls?.length) images.push(...await loadApprovedRemoteMailImages({html:parsed.html??'',approvedUrls:fixture.remoteUrls,sourceId:id,fetcher:remoteFetcher}));
  const times = mailMessageTimes({headers,sentAt:parsed.date,collectedAt:fixture.now});
  const hasOwner = addresses => (addresses??[]).some(person=>person.address?.toLowerCase()==='owner@example.test');
  const inTo = hasOwner(parsed.to), inCc = hasOwner(parsed.cc);
  const recipientRole = inTo && inCc ? 'both' : inTo ? 'to' : inCc ? 'cc' : 'other';
  return {
    source:{id,uidl_hash:await digest(raw),subject:parsed.subject,sender:parsed.from?.name+' <'+parsed.from?.address+'>',headers,text,images,sent_at:times.sentAt,received_at:times.receivedAt,created_at:fixture.now,related:fixture.related??[],analysisScope:fixture.remoteUrls?.length?'body_remote_images':'body_attachments',ownerContext:{recipientRole,senderIsOwner:parsed.from?.address?.toLowerCase()==='owner@example.test'}},
    parser:{attachments:files.length,selectedImages:photos.selected.map(file=>file.name),excludedImages:photos.excluded.map(file=>({name:file.name,reason:file.reason})),reviewImages:photos.review.map(file=>file.name),textChars:text.length,reportDay:day(times.reportAt),sentAt:times.sentAt,receivedAt:times.receivedAt},
  };
}
function evaluate(fixture, saved, normalized, parser) {
  const expected = fixture.expected, checks = {};
  const mail = fixture.kind==='mail';
  const records = mail ? [...saved.tasks,...saved.issues,...saved.waiting,...saved.updates,...(saved.imageItems?.tasks??[])] : saved.items;
  const links = [...new Set(records.map(item=>item.workRef??item.ref).filter(ref=>ref && (fixture.related??[]).some(candidate=>candidate.ref===ref || candidate.items?.some(item=>item.ref===ref))))];
  const tasks = mail ? saved.tasks.length+(saved.imageItems?.tasks?.length??0) : saved.items.filter(item=>['task','dispatch'].includes(item.kind)&&!item.workRef).length;
  const issues = mail ? saved.issues.length : saved.items.filter(item=>item.kind==='issue').length;
  const confirmed = mail ? saved.review?.needsConfirmation===true || saved.review?.withheldTasks>0 : saved.items.some(item=>item.needsConfirmation);
  if (expected.intent!==undefined) checks.intent = saved.source.intent===expected.intent;
  if (expected.taskCount!==undefined) checks.taskCount = tasks===expected.taskCount;
  if (expected.issueCount!==undefined) checks.issueCount = issues===expected.issueCount;
  if (expected.waitingCount!==undefined) checks.waitingCount = (mail?saved.waiting.length:saved.items.filter(item=>item.kind==='waiting').length)===expected.waitingCount;
  if (expected.classification==='needs_confirmation'||expected.classification==='ambiguous_link') checks.confirmationPreserved = confirmed;
  if (expected.classification==='reference') checks.referenceOnly = normalized.every(item=>item.category==='reference') && tasks===0;
  for (const key of ['dueDate','dueAt','serviceDate']) if(Object.hasOwn(expected,key)) checks[key] = expected[key]===null ? records.every(item=>!item[key]&&!item.due?.[key]) : records.some(item=>item[key]===expected[key]||item.due?.[key]===expected[key]);
  if(expected.link) checks.link = expected.link.mode==='exact' ? expected.link.refs.every(ref=>links.includes(ref)) && links.length===expected.link.refs.length : links.length===0;
  if(expected.parser?.reportDay) checks.reportDay = parser?.reportDay===expected.parser.reportDay;
  if(expected.includedImageNames) checks.imageSelection = expected.includedImageNames.every(name=>parser?.selectedImages.includes(name));
  if(expected.excludedImageNames) checks.signatureExclusion = expected.excludedImageNames.every(name=>parser?.excludedImages.some(file=>file.name===name));
  if(expected.summaryContains){ const visible=JSON.stringify(mail?[saved.summary,saved.imageFacts]:normalized);checks.summaryFacts=expected.summaryContains.every(text=>visible.includes(text)); }
  if(expected.items) checks.independentItems = expected.items.every(wanted=>records.some(item=>Object.entries(wanted).every(([key,value])=>key==='textIncludes'?item.text.includes(value):value===null?item[key]==null:item[key]===value)));
  if(expected.reprocess) checks.referenceAnchor = !mail && saved.referenceDate===expected.reprocess.referenceDate && saved.items.some(item=>item.serviceDate===expected.reprocess.serviceDate);
  if(expected.expectedStatus) checks.status = records.some(item=>(item.workflowStatus??item.status??(item.done?'complete':'pending'))===expected.expectedStatus);
  return {checks,automatedChecksPassed:Object.values(checks).every(Boolean),actual:{newTasks:tasks,issues,links,needsConfirmation:confirmed},manualReviewRequired:expected.mustNot??[]};
}

// Fixed corpus only. This adapter deliberately has no production persistence or Graph writer.
export async function runStressCase(caseId,ctx) {
  const fixture = fixtureById(caseId);
  if(!fixture) throw Error('STRESS_CASE_INVALID');
  const ai = await ctx.resolveAiConfiguration();
  if(ai.aiProvider!=='openai'||ai.aiModel!=='gpt-6-luna'||!ai.aiKey) throw Error('STRESS_AI_CONFIGURATION');
  const id = syntheticId(fixture), trace = [], replay = [];
  const transport = async(url,options)=>{
    if(!['https://api.openai.com/v1/responses','https://api.typesafe.ai/v1/systemone'].includes(url)) throw Error('STRESS_DESTINATION');
    const response = await ctx.fetcher(url,{...options,body:options.body.replaceAll('장희성','테스트담당자')});
    const value = await response.clone().json().catch(()=>({}));
    trace.push({provider:url.includes('typesafe')?'typesafe':'openai',httpStatus:response.status,model:value.model??null,status:value.status??null,usage:value.usage??null});
    if(response.ok) replay.push(url.includes('typesafe')?{model:value.model,answers:value.answers,usage:value.usage}:{model:value.model,status:value.status,output:value.output,usage:value.usage,incomplete_details:value.incomplete_details});
    return response;
  };
  const config = await ctx.resolveJevConfiguration(id);
  const jev = async()=>config?{...config,fetcher:transport}:null;
  let saved=null, normalized=[], parser=null, duplicate=null, status=null;
  const prior = structuredClone(fixture.related??[]);
  for(const candidate of prior) if(candidate.source && !candidate.source.uidl) candidate.source.uidl=await digest(new TextEncoder().encode(candidate.source.id));
  if(fixture.kind==='mail') {
    const parsed = await parseStressMail(fixture,ctx.remoteFetcher);
    parser=parsed.parser;
    let leased=false,failed=null;
    const store={claim:async()=>{if(leased||saved)return null;leased=true;return{row:{id,uidl_hash:parsed.source.uidl_hash},lease:'isolated-stress'};},finish:async({analysis})=>{saved=structuredClone(analysis);leased=false;return true;},fail:async({code})=>{failed=code;leased=false;return true;}};
    const args={messageId:id,provider:ai.aiProvider,model:ai.aiModel,key:ai.aiKey,now:fixture.now,ownerName:'테스트담당자',loadMail:async()=>parsed.source,fetcher:transport,resolveJevConfiguration:jev,store};
    const results=await Promise.all([analyzePrivateMail(args),analyzePrivateMail(args)]);
    status=results[0].status;duplicate=results[1].status;
    if(!saved) return{caseId,status:'failed',code:results[0].code??failed,trace,replay,parser,expected:fixture.expected,storage:'isolated-memory',productionBusinessWritten:false,oneNoteWritten:false};
    saved=JSON.parse(JSON.stringify(saved));
    normalized=dailyBriefingView({now:fixture.now,analyses:[...prior.filter(item=>item.source),saved]}).workItems;
  } else {
    const entries=Object.fromEntries(prior.filter(item=>item.entryId).map(item=>[item.entryId,item]));
    const history=[];
    const db=async(path,options={})=>{
      if(path.startsWith('private_mailboxes?'))return[{id:TARGET.mailbox_id,owner_id:TARGET.owner_id,enabled:true,manual_entries:structuredClone(entries)}];
      const b=options.body;
      if(path==='rpc/private_mail_manual_claim') {
        if(entries[id])return{claimed:false,entry:structuredClone(entries[id])};
        entries[id]={entryId:id,text:fixture.text,textHash:b.p_hash,clientRequestId:b.p_request,status:'processing',submittedAt:fixture.now,referenceDate:fixture.referenceDate,items:[]};
        return{claimed:true,entry:structuredClone(entries[id])};
      }
      if(path==='rpc/private_mail_manual_finish'){entries[id]={...entries[id],status:'ready',items:structuredClone(b.p_items),authoredDate:b.p_authored,inference:b.p_inference,updatedAt:fixture.now};return structuredClone(entries[id]);}
      if(path==='rpc/private_mail_manual_fail'){entries[id]={...entries[id],status:'failed',error:b.p_code};return structuredClone(entries[id]);}
      if(path==='rpc/private_mail_manual_jev_review'){entries[id].jevReview=structuredClone(b.p_review);return true;}
      if(path==='rpc/private_mail_history_capture_manual'){history.push(structuredClone(b));return{};}
      if(path.startsWith('private_mail_messages?'))return[];
      throw Error('STRESS_PERSISTENCE_REJECTED');
    };
    const adapter={db,json:Response.json,fail:(code)=>Error(code),fetcher:transport,aiKey:ai.aiKey,aiProvider:ai.aiProvider,aiModel:ai.aiModel,resolveJevConfiguration:jev,enqueueManualReport:async()=>false};
    const body={clientRequestId:id,text:fixture.text,referenceDate:fixture.referenceDate};
    const response=await handleManualMessage('private-mail-manual-add',body,{id:TARGET.owner_id},adapter);
    status=(await response.json()).status;saved=JSON.parse(JSON.stringify(entries[id]));
    if(saved?.status!=='ready')return{caseId,status:'failed',code:saved?.error,trace,replay,expected:fixture.expected,storage:'isolated-memory',productionBusinessWritten:false,oneNoteWritten:false};
    const before=trace.length;
    await handleManualMessage('private-mail-manual-add',body,{id:TARGET.owner_id},adapter);
    duplicate=trace.length===before?'reused':'called_again';
    const manual=manualDailyView(entries,fixture.referenceDate);
    normalized=dailyBriefingView({now:fixture.now,analyses:[],manual}).workItems;
  }
  const note = fixture.kind==='mail' ? renderDailyBriefing({now:fixture.now,analyses:[...prior.filter(item=>item.source),saved]}) : renderDailyBriefing({now:fixture.now,analyses:[],manual:manualDailyView(Object.fromEntries([...prior.filter(item=>item.entryId),saved].map(entry=>[entry.entryId,entry])),fixture.referenceDate)});
  return{caseId,status,expected:fixture.expected,...evaluate(fixture,saved,normalized,parser),parser,normalized,saved,replay,trace,duplicate,noteHtml:note.managedHtml,storage:'isolated-memory',productionBusinessWritten:false,oneNoteWritten:false};
}
