import { classifyKakaoTarget, KAKAO_TRIAGE_VERSION } from './kakao-triage-classify.js';
import { requiresMailPrivacyReview } from './private-mail-images.js';
import { readKakaoPhotoFacts, KAKAO_TRIAGE_PHOTO_VERSION } from './kakao-triage-photo.js';

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const hex = /^[a-f\d]{64}$/;
const positiveInteger = (v) => Number.isSafeInteger(v) && v > 0;
const enc = encodeURIComponent;
const rpc = (db,name,body) => db('rpc/kakao_triage_' + name, {method:'POST',body});
const hold = (reason,retryable=false) => ({label:'보류',scores:null,reason,retryable});
const later = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();

async function fingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(digest,x => x.toString(16).padStart(2,'0')).join('');
}

function observations(manifest,id) {
  if (manifest?.batch_id !== id || !Array.isArray(manifest.messages)) throw Error('KAKAO_MANIFEST');
  const ids = new Set(), sequence = new Set();
  const roomId = manifest.messages[0]?.room_id;
  return manifest.messages.map(m => {
    if (!positiveInteger(m.message_id) || !positiveInteger(m.sequence) || !positiveInteger(m.room_id) ||
        m.room_id !== roomId || typeof m.room_name !== 'string' || !m.room_name.trim() ||
        (m.text != null && typeof m.text !== 'string') ||
        (m.sender_name != null && typeof m.sender_name !== 'string') ||
        (m.sent_at != null && typeof m.sent_at !== 'string') ||
        ids.has(m.message_id) || sequence.has(m.sequence) || !Array.isArray(m.attachments)) throw Error('KAKAO_MANIFEST');
    ids.add(m.message_id);
    sequence.add(m.sequence);
    const attachmentIds = new Set();
    const attachments = m.attachments.map(a => {
      if (typeof a.attachment_id !== 'string' || !a.attachment_id || attachmentIds.has(a.attachment_id) ||
          !positiveInteger(a.ordinal) || !['확보','사진 확보 대기'].includes(a.status)) throw Error('KAKAO_ATTACHMENT');
      if (a.status === '확보' && (!hex.test(a.sha256) || !positiveInteger(a.bytes) ||
          !positiveInteger(a.width) || !positiveInteger(a.height) || typeof a.path !== 'string')) throw Error('KAKAO_ATTACHMENT');
      attachmentIds.add(a.attachment_id);
      // Download attempts/errors may change while the observed photo is still missing.
      return {attachment_id:a.attachment_id,ordinal:a.ordinal,status:a.status,sha256:a.sha256 ?? null,
        path:a.path ?? null,bytes:a.bytes ?? null,width:a.width ?? null,height:a.height ?? null};
    });
    return {room_id:m.room_id,room_name:m.room_name,message_id:m.message_id,sequence:m.sequence,
      text:m.text ?? null,sender_name:m.sender_name ?? null,sent_at:m.sent_at ?? null,attachments};
  });
}

async function ingest(source,db,item) {
  if (!uuid.test(item.id) || typeof item.version !== 'string' || !item.version) throw Error('KAKAO_BATCH');
  const [previous] = await db('kakao_triage_batch?id=eq.' + item.id + '&select=source_version');
  if (previous?.source_version === item.version) return 'unchanged';
  const data = await source.batch(item.id,item.version);
  const written = await rpc(db,'ingest',{p_id:item.id,p_expected:previous?.source_version ?? null,
    p_version:item.version,p_messages:observations(data,item.id)});
  return written ? 'imported' : 'superseded';
}

const permanentPhotoErrors = new Set(['IMAGE_SOURCE','IMAGE_FORMAT','IMAGE_DIMENSIONS','IMAGE_LIMIT','IMAGE_PRIVACY_REVIEW']);
async function photoEvidence(attachment,ctx,processor,budget) {
  const {db,source,ai,fetcher} = ctx;
  const hash = attachment.sha256;
  const where = 'kakao_triage_photo?sha256=eq.' + hash + '&processor=eq.' + enc(processor);
  const lease = crypto.randomUUID();
  if (!budget.available) {
    const [cached] = await db(where + '&select=facts');
    return cached?.facts ?? {deferred:true};
  }
  const claim = await rpc(db,'claim_photo',{p_hash:hash,p_processor:processor,p_lease:lease});
  if (claim.facts) return claim.facts;
  if (!claim.claimed) return {deferred:true};
  budget.available = false;
  let output;
  try {
    const bytes = await source.photo(attachment);
    const facts = await readKakaoPhotoFacts(bytes,attachment,ai,fetcher);
    output = {facts:facts.map(({text,confidence,documentKind})=>({
      text,confidence,...(documentKind ? {documentKind} : {}),
    }))};
  } catch (error) {
    if (!permanentPhotoErrors.has(error?.message)) {
      // Allow retry only after the current lease/backoff. Never cache an outage as missing evidence.
      return {deferred:true};
    }
    // A bad dimension/path in this occurrence must not poison the cache for another use of the same bytes.
    await db(where + '&lease=eq.' + lease,{method:'PATCH',body:{lease:null,lease_until:null}});
    return {facts:[],error:error.message};
  }
  const updated = await db(where + '&lease=eq.' + lease + '&select=sha256',{
    method:'PATCH',prefer:'return=representation',body:{facts:output,lease:null,lease_until:null},
  });
  return updated.length ? output : {deferred:true};
}

async function decide(job,ctx,photoProcessor) {
  const {target,before,after} = job;
  if (requiresMailPrivacyReview(target.text)) return hold('원문 개인정보 확인 필요');
  const safeContext = rows => rows.filter(m => !requiresMailPrivacyReview(m.text));
  const base = {roomName:target.room_name,target,before:safeContext(before),after:safeContext(after),
    key:ctx.jevKey,fetcher:ctx.fetcher};
  const ready = target.attachments.filter(a => a.status === '확보');
  const unresolved = target.attachments.length > ready.length;
  let first;
  if (target.text?.trim() || !ready.length) {
    first = await classifyKakaoTarget({...base,facts:[]});
    if (!ready.length || first.retryable || ['업무','참고'].includes(first.label)) return first;
  }
  if ([target, before.at(-1), after[0]].some(m => requiresMailPrivacyReview(m?.text))) {
    return hold('사진의 개인정보 근거 확인 필요');
  }
  const facts = [], budget = {available:true};
  let unreadable = unresolved;
  for (const attachment of ready) {
    const evidence = await photoEvidence(attachment,ctx,photoProcessor,budget);
    if (evidence.deferred) return hold('사진 분석 대기',true);
    if (!evidence.facts.some(f => f.confidence === 'readable')) unreadable = true;
    for (const fact of evidence.facts) {
      facts.push({...fact,attachment_id:attachment.attachment_id});
    }
  }
  if (!facts.some(f => f.confidence === 'readable')) return hold('판독 가능한 사진 근거 부족');
  const decision = await classifyKakaoTarget({...base,facts});
  if (decision.label === '잡담' && unreadable) return hold('일부 사진 근거 확인 대기');
  return decision;
}

export async function runKakaoTriage(ctx,options={}) {
  const {db,source,ai} = ctx;
  const {cursor=null,batchId=null} = options;
  if ((batchId !== null && !uuid.test(batchId)) || (cursor !== null && (typeof cursor !== 'string' || batchId))) {
    throw Error('KAKAO_OPTIONS');
  }
  const photoProcessor = KAKAO_TRIAGE_PHOTO_VERSION + '-' + await fingerprint([ai?.aiProvider ?? null,ai?.aiModel ?? null]);
  const processor = KAKAO_TRIAGE_VERSION + ':' + photoProcessor;
  const page = batchId ? {batches:[await source.stat(batchId)],nextCursor:null} : await source.list(cursor);
  const imported = [];
  for (const item of page.batches) imported.push({batchId:item.id,state:await ingest(source,db,item)});

  const lease = crypto.randomUUID();
  const job = await rpc(db,'claim',{p_batch:batchId,p_processor:processor,p_lease:lease});
  const progress = {imported,nextCursor:page.nextCursor,processed:null};
  if (job.idle) return {...progress,queue:job.summary};
  const {target} = job;
  const key = await fingerprint([processor,target,job.before,job.after]);
  const cached = key === job.previousKey && job.previousResult && !job.previousResult.retryable;
  const result = cached ? job.previousResult : await decide(job,ctx,photoProcessor);
  const refs = {batchId:job.batch,roomId:target.room_id,messageId:target.message_id,
    attachmentIds:target.attachments.map(a=>a.attachment_id)};
  const retryAt = result.retryable ? later(['AUTH','NOT_CONFIGURED'].includes(result.modelError ?? result.reason) ? 900 : 60) : null;
  const written = await db('kakao_triage_message?room_id=eq.' + target.room_id +
    '&message_id=eq.' + target.message_id + '&lease=eq.' + lease + '&select=message_id',{
    method:'PATCH',prefer:'return=representation',body:{
      processor,input_key:key,result,next_run:retryAt,lease:null,lease_until:null,
    },
  });
  // A new observation/neighbor cancels the old lease even if the model finished successfully.
  progress.processed = written.length ? {...refs,...result,retryAt,reused:!!cached} : {...refs,superseded:true};
  return progress;
}
